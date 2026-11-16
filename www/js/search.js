// =========================================================
// Search page – Starting point + Destination (+ swap)
// =========================================================
(function () {
  const ROUTES = window.ETC_ROUTES || [];
  const STOPS = Array.from(new Set(ROUTES.flatMap((r) => [r.from, r.to]))).sort((a, b) => a.localeCompare(b));

  const fromIn = document.getElementById("fromInput");
  const toIn = document.getElementById("toInput");
  const panel = document.getElementById("panel");
  const swapBtn = document.getElementById("swapBtn");
  const swapArrows = document.getElementById("swapArrows");
  let active = "from";
  let spin = 0;

  const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const stopOf = (v) => STOPS.find((s) => norm(s) === norm(v)) || null;
  const routeOf = (a, b) => ROUTES.find((r) => r.from === a && r.to === b) || null;
  const naira = (n) => "₦" + Number(n).toLocaleString();
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const inputs = { from: fromIn, to: toIn };
  const other = (k) => (k === "from" ? "to" : "from");

  const PIN = '<svg class="ico" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>';

  function suggestionsFor(key) {
    const el = inputs[key];
    const exact = stopOf(el.value);
    const q = exact ? "" : norm(el.value);            // a finished box shows the full list again
    let list = STOPS;
    let fares = null;
    const fromVal = stopOf(fromIn.value);
    if (key === "to" && fromVal) {
      const from = ROUTES.filter((r) => r.from === fromVal);
      list = from.map((r) => r.to);
      fares = Object.fromEntries(from.map((r) => [r.to, r.fare]));
    }
    return { list: list.filter((s) => !q || norm(s).includes(q)), fares, hasOrigin: key === "to" && !!fromVal, origin: fromVal };
  }

  function render() {
    document.querySelectorAll(".clear").forEach((b) => { b.hidden = !inputs[b.dataset.clear].value; });
    const a = stopOf(fromIn.value), b = stopOf(toIn.value);
    const focused = document.activeElement === fromIn || document.activeElement === toIn;

    let html = "";
    if (a && b && !focused) {
      if (a === b) {
        html = `<p class="panel-msg">Your starting point and destination are the same. Pick a different destination.</p>`;
      } else {
        const r = routeOf(a, b);
        if (r) {
          html = `
          <div class="bg-soft-300 rounded-[26px] border border-white/50 p-4 shadow-sm">
            <p class="text-[13px] font-semibold text-mute mb-1">Direct route</p>
            <div class="flex justify-between items-end gap-2">
              <div class="min-w-0">
                <p class="text-[17px] font-bold uppercase leading-snug">${esc(r.from)} → ${esc(r.to)}</p>
                <p class="text-sm font-semibold mt-0.5">${naira(r.fare)} <span class="text-mute font-medium">· ${r.routes} routes</span></p>
              </div>
              <button class="result-btn bg-ink text-white text-[13px] font-medium rounded-full px-4 py-2.5 whitespace-nowrap shrink-0">View details</button>
            </div>
          </div>`;
        } else {
          const from = ROUTES.filter((x) => x.from === a);
          html = `<p class="panel-msg">There is no direct route from <b>${esc(a)}</b> to <b>${esc(b)}</b> yet.` +
                 (from.length ? ` Routes from ${esc(a)} go to: ${from.map((x) => esc(x.to)).join(", ")}.` : ` No routes leave ${esc(a)} yet.`) + `</p>`;
        }
      }
    } else {
      const s = suggestionsFor(active);
      const label = active === "from" ? "Choose a starting point" : (s.hasOrigin ? `Where to from ${esc(s.origin)}?` : "Choose a destination");
      if (s.list.length) {
        html = `<p class="panel-label">${label}</p>` + s.list.map((name) =>
          `<button type="button" class="sugg" data-name="${esc(name)}">${PIN}<span>${esc(name)}</span>${s.fares ? `<span class="meta">${naira(s.fares[name])}</span>` : ""}</button>`).join("");
      } else {
        html = `<p class="panel-msg">${s.hasOrigin ? `No routes leave ${esc(s.origin)} yet.` : "No matching stop. Try Holy Ghost, Gariki, Abakpa or Nsukka."}</p>`;
      }
    }
    panel.innerHTML = `<div class="panel-in">${html}</div>`;
  }

  function choose(key, name) {
    inputs[key].value = name;
    const o = other(key);
    if (!stopOf(inputs[o].value)) { inputs[o].focus(); }   // the other box still needs filling
    else { inputs[key].blur(); render(); }
    render();
  }

  Object.entries(inputs).forEach(([key, el]) => {
    el.addEventListener("focus", () => { active = key; el.select(); render(); });
    el.addEventListener("input", render);
    el.addEventListener("blur", () => setTimeout(render, 0));
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const first = panel.querySelector(".sugg");
      if (!stopOf(el.value) && first) return choose(key, first.dataset.name);
      const o = other(key);
      if (!stopOf(inputs[o].value)) inputs[o].focus(); else el.blur();
    });
  });

  // tapping a suggestion: mousedown so the input doesn't lose focus first
  panel.addEventListener("mousedown", (e) => { if (e.target.closest(".sugg")) e.preventDefault(); });
  panel.addEventListener("click", (e) => {
    const s = e.target.closest(".sugg");
    if (s) return choose(active, s.dataset.name);
    if (e.target.closest(".result-btn")) {
      const a = stopOf(fromIn.value), b = stopOf(toIn.value), r = routeOf(a, b);
      if (r) location.href = `details.html?from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}`;
    }
  });

  document.querySelectorAll(".clear").forEach((btn) => {
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => { const el = inputs[btn.dataset.clear]; el.value = ""; el.focus(); render(); });
  });

  swapBtn.addEventListener("click", () => {
    const t = fromIn.value; fromIn.value = toIn.value; toIn.value = t;
    spin += 180;
    swapBtn.querySelector("svg").style.transform = `rotate(${spin}deg)`;
    render();
  });

  document.getElementById("backBtn").addEventListener("click", () => {
    if (history.length > 1) history.back(); else location.href = "index.html";
  });

  fromIn.focus();
  render();
})();
