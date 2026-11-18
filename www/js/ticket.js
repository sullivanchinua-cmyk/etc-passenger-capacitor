// =========================================================
// Ticket + receipt page
//   • live QR: new token every 30 s
//   • Family / single: original premium swipe cards (unchanged)
//   • Add-tickets multi: 2×2 grid → tap to enlarge → merge to one
// =========================================================
(function () {
  const $ = (id) => document.getElementById(id);
  const UI = window.ETC_UI, I = window.ETC_ICONS, S = window.ETC_Store, TK = window.ETC_Tickets, esc = UI.esc;
  const naira = window.etcNaira || ((n) => "₦" + Number(n).toLocaleString("en-NG"));
  const view = $("view"), tabs = $("tabs");
  let list = [], cur = 0, activeTicketId = null;
  let multiMode = "grid"; // grid | focus | merged  (add-tickets only)
  let focusIdx = 0;
  let familyJoined = false; // set true only for family bookings (one code first)

  $("backBtn").addEventListener("click", () => {
    if (history.length > 1 && document.referrer) history.back();
    else location.href = "events.html";
  });

  const fmtDate = TK.fmtDate;
  const two = (n) => String(n).padStart(2, "0");
  const clock = () => {
    const d = new Date();
    return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
  };
  const nm = (t) =>
    /^(Ticket|Member|Passenger) \d+$/i.test(t.name || "") ? `Passenger ${t.index}` : t.name;
  const seatText = (t) => (t.seat ? `Bus ${t.bus || 1} · Seat ${t.seat}` : "Free seating");

  function isUsed(t) {
    if (!t) return false;
    const st = (t.status || "").toLowerCase();
    if (st === "boarded" || st === "void" || st === "noshow" || st === "used") return true;
    if (t.date) {
      const today = new Date();
      const iso =
        today.getFullYear() +
        "-" +
        String(today.getMonth() + 1).padStart(2, "0") +
        "-" +
        String(today.getDate()).padStart(2, "0");
      if (t.date < iso) return true;
    }
    return false;
  }

  // Original premium boarding-pass card (family + single + focus)
  function card(t, i) {
    return `<article class="tk-card${isUsed(t) ? " is-used" : ""}" data-i="${i}" aria-label="Ticket ${t.index} of ${t.of}">
      <div class="tk-head">
        <div class="tk-brand"><span class="tk-logo">ETC</span><span>${
          t.of > 1 ? `Ticket ${t.index} of ${t.of}` : "Boarding pass"
        }</span>${t.imported ? '<em class="tk-tag">Shared with you</em>' : ""}</div>
        <div class="tk-route"><div><small>From</small><b>${esc(t.from)}</b></div><span class="tk-arrow">${
      I.arrowRight || ""
    }</span><div><small>To</small><b>${esc(t.to)}</b></div></div>
      </div>
      <div class="tk-notch"><i></i><span></span><i></i></div>
      <div class="tk-meta">
        <div><small>Passenger</small><b>${esc(nm(t))}</b></div>
        <div><small>Date</small><b>${esc(fmtDate(t.date))}</b></div>
        <div><small>Departs</small><b>${esc(t.time || "Any time")}</b></div>
        <div><small>${esc(t.session ? t.session.split(" ")[0] : "Session")}</small><b>${esc(
      seatText(t)
    )}</b></div>
      </div>
      <div class="tk-qrwrap">
        <div class="tk-qrbox">
          <div class="tk-qr" id="qr-${i}" aria-label="Live boarding QR code"><div class="qr-fallback">Loading code…</div><div class="tk-scan" aria-hidden="true"></div></div>
          ${isUsed(t) ? '<span class="tk-used-stamp" aria-hidden="true">USED</span>' : ""}
        </div>
        <div class="tk-live"><span class="dot"></span><b class="live-clock">--:--:--</b><span class="live-sec">· refreshes in <b>--</b>s</span></div>
        <div class="tk-bar" aria-hidden="true"><i></i></div>
        <p class="tk-note">Show this live code at the gate. Screenshots stop working after 30 seconds.</p>
      </div>
      <div class="tk-actions">
        <button type="button" class="tk-btn" data-share="${i}">${I.share || ""}<span>Share ticket</span></button>
        <button type="button" class="tk-btn ghost" data-recpt>${I.receipt || ""}<span>Receipt</span></button>
      </div>
    </article>`;
  }

  const isFamily = () => list.length > 1 && list.every((t) => t.family != null && t.family !== false && t.family !== "");
  const isMultiAdd = () => list.length > 1 && !isFamily();

  function renderOriginalPager() {
    view.innerHTML = `<div class="tk-pager" id="pager">${list.map(card).join("")}</div>${
      list.length > 1
        ? `<div class="tk-dots" id="dots">${list
            .map((_, i) => `<i class="${i === cur ? "on" : ""}"></i>`)
            .join("")}</div>`
        : ""
    }
      <div class="tk-actions tk-actions-final">
        <button type="button" class="tk-btn ghost" data-go="events">${I.ticket || ""}<span>View tickets</span></button>
        <button type="button" class="tk-btn" data-go="home">${I.home || ""}<span>Done</span></button>
      </div>`;
    list.forEach((t, i) => window.ETC_QRLive.mount($("qr-" + i), t, 210));
    const pager = $("pager");
    if (!pager) return;
    pager.addEventListener(
      "scroll",
      () => {
        const i = Math.round(pager.scrollLeft / pager.clientWidth);
        if (i !== cur) {
          cur = i;
          document.querySelectorAll("#dots i").forEach((d, k) => d.classList.toggle("on", k === i));
        }
      },
      { passive: true }
    );
    if (cur) pager.scrollTo({ left: cur * pager.clientWidth });
  }

  function renderTickets() {
    try {
      if (multiMode === "focus" && list[focusIdx]) activeTicketId = list[focusIdx].id;
      else if (list[cur]) activeTicketId = list[cur].id;
    } catch (_) {}

    // Single ticket: original card
    if (list.length <= 1) {
      renderOriginalPager();
      return;
    }

    // FAMILY: one QR by default; Separate → swipe cards
    if (isFamily()) {
      if (familyJoined) {
        const t0 = list[0];
        view.innerHTML = `
        <div class="tk-multi-bar">
          <p class="tk-multi-label">${list.length} family · one code</p>
          <button type="button" class="tk-pill" id="tkFamSep">Separate</button>
        </div>
        <article class="tk-card tk-card-solo">
          <div class="tk-head">
            <div class="tk-brand"><span class="tk-logo">ETC</span><span>Family pass · ${list.length}</span></div>
            <div class="tk-route"><div><small>From</small><b>${esc(t0.from)}</b></div><span class="tk-arrow">${I.arrowRight || ""}</span><div><small>To</small><b>${esc(t0.to)}</b></div></div>
          </div>
          <div class="tk-notch"><i></i><span></span><i></i></div>
          <div class="tk-meta">
            <div><small>Family</small><b>${list.length} members</b></div>
            <div><small>Date</small><b>${esc(fmtDate(t0.date))}</b></div>
            <div><small>Departs</small><b>${esc(t0.time || "Any time")}</b></div>
            <div><small>Seats</small><b>${esc(list.map((x) => x.seat || "–").filter(Boolean).join(", ") || "Together")}</b></div>
          </div>
          <div class="tk-qrwrap">
            <div class="tk-qr" id="qr-family"><div class="qr-fallback">Loading…</div><div class="tk-scan" aria-hidden="true"></div></div>
            ${list.every(isUsed) ? '<span class="tk-used-stamp" aria-hidden="true">USED</span>' : ""}
            <div class="tk-live"><span class="dot"></span><b class="live-clock">--:--:--</b><span class="live-sec">· refreshes in <b>--</b>s</span></div>
            <div class="tk-bar" aria-hidden="true"><i></i></div>
            <p class="tk-note">One live code for the family. Agent can board the whole group from this pass.</p>
          </div>
          <div class="tk-actions">
            <button type="button" class="tk-btn" data-share-all="1">${I.share || ""}<span>Share links</span></button>
            <button type="button" class="tk-btn ghost" data-recpt>${I.receipt || ""}<span>Receipt</span></button>
          </div>
        </article>
        <div class="tk-actions tk-actions-final" style="margin-top:14px">
          <button type="button" class="tk-btn ghost" data-go="events">${I.ticket || ""}<span>View tickets</span></button>
          <button type="button" class="tk-btn" data-go="home">${I.home || ""}<span>Done</span></button>
        </div>`;
        window.ETC_QRLive.mount($("qr-family"), t0, 210, { groupBoard: true });
        $("tkFamSep").onclick = () => { familyJoined = false; renderTickets(); };
        return;
      }
      // Separated family → original swipe cards + Join button
      view.innerHTML = `
        <div class="tk-multi-bar">
          <p class="tk-multi-label">${list.length} family tickets</p>
          <button type="button" class="tk-pill solid" id="tkFamJoin">Join as one</button>
        </div>
        <div class="tk-pager" id="pager">${list.map(card).join("")}</div>
        <div class="tk-dots" id="dots">${list.map((_, i) => `<i class="${i === cur ? "on" : ""}"></i>`).join("")}</div>
        <div class="tk-actions tk-actions-final">
          <button type="button" class="tk-btn ghost" data-go="events">${I.ticket || ""}<span>View tickets</span></button>
          <button type="button" class="tk-btn" data-go="home">${I.home || ""}<span>Done</span></button>
        </div>`;
      list.forEach((t, i) => window.ETC_QRLive.mount($("qr-" + i), t, 210));
      const pager = $("pager");
      if (pager) {
        pager.addEventListener("scroll", () => {
          const i = Math.round(pager.scrollLeft / pager.clientWidth);
          if (i !== cur) { cur = i; activeTicketId = list[i] ? list[i].id : activeTicketId; document.querySelectorAll("#dots i").forEach((d, k) => d.classList.toggle("on", k === i)); }
        }, { passive: true });
        if (cur) pager.scrollTo({ left: cur * pager.clientWidth });
      }
      $("tkFamJoin").onclick = () => { familyJoined = true; renderTickets(); };
      return;
    }

    // Add-tickets multi (not family)
    if (!isMultiAdd()) {
      renderOriginalPager();
      return;
    }

    if (multiMode === "merged") {
      const t0 = list[0];
      view.innerHTML = `
        <div class="tk-multi-bar">
          <p class="tk-multi-label">${list.length} tickets · group code</p>
          <button type="button" class="tk-pill" id="tkSeparate">Separate</button>
        </div>
        <article class="tk-card tk-card-solo">
          <div class="tk-head">
            <div class="tk-brand"><span class="tk-logo">ETC</span><span>Group boarding pass</span></div>
            <div class="tk-route"><div><small>From</small><b>${esc(t0.from)}</b></div><span class="tk-arrow">${
        I.arrowRight || ""
      }</span><div><small>To</small><b>${esc(t0.to)}</b></div></div>
          </div>
          <div class="tk-notch"><i></i><span></span><i></i></div>
          <div class="tk-meta">
            <div><small>Passengers</small><b>${list.length}</b></div>
            <div><small>Date</small><b>${esc(fmtDate(t0.date))}</b></div>
            <div><small>Departs</small><b>${esc(t0.time || "Any time")}</b></div>
            <div><small>Ref</small><b class="mono" style="font-size:12px">${esc(
              (t0.reference || "").slice(0, 14)
            )}</b></div>
          </div>
          <div class="tk-qrwrap">
            <div class="tk-qr" id="qr-merged"><div class="qr-fallback">Loading…</div><div class="tk-scan" aria-hidden="true"></div></div>
            ${list.every(isUsed) ? '<span class="tk-used-stamp" aria-hidden="true">USED</span>' : (list.some(isUsed) ? '<span class="tk-used-stamp tk-used-sm" aria-hidden="true">PARTIAL</span>' : "")}
            <div class="tk-live"><span class="dot"></span><b class="live-clock">--:--:--</b><span class="live-sec">· refreshes in <b>--</b>s</span></div>
            <div class="tk-bar" aria-hidden="true"><i></i></div>
            <p class="tk-note">One live code for the group. Agent boards from this reference.</p>
          </div>
          <div class="tk-actions">
            <button type="button" class="tk-btn" data-share-all="1">${I.share || ""}<span>Share all links</span></button>
            <button type="button" class="tk-btn ghost" data-recpt>${I.receipt || ""}<span>Receipt</span></button>
          </div>
        </article>
        <div class="tk-actions tk-actions-final" style="margin-top:14px">
          <button type="button" class="tk-btn ghost" data-go="events">${I.ticket || ""}<span>View tickets</span></button>
          <button type="button" class="tk-btn" data-go="home">${I.home || ""}<span>Done</span></button>
        </div>`;
      window.ETC_QRLive.mount($("qr-merged"), t0, 210, { groupBoard: true });
      $("tkSeparate").onclick = () => {
        multiMode = "grid";
        renderTickets();
      };
      return;
    }

    if (multiMode === "focus") {
      const t = list[focusIdx] || list[0];
      view.innerHTML = `
        <div class="tk-multi-bar">
          <button type="button" class="tk-pill" id="tkBackGrid">← All</button>
          <p class="tk-multi-label">${esc(nm(t))} · ${focusIdx + 1}/${list.length}</p>
          <button type="button" class="tk-pill" id="tkMergeBtn">Merge</button>
        </div>
        ${card(t, focusIdx)}`;
      window.ETC_QRLive.mount($("qr-" + focusIdx), t, 210);
      $("tkBackGrid").onclick = () => {
        multiMode = "grid";
        renderTickets();
      };
      $("tkMergeBtn").onclick = () => runMergeAnimation();
      return;
    }

    // Premium 2×2 grid
    view.innerHTML = `
      <div class="tk-multi-bar">
        <p class="tk-multi-label">${list.length} tickets</p>
        <button type="button" class="tk-pill solid" id="tkMergeBtn">Merge to one</button>
      </div>
      <div class="tk-grid2">
        ${list
          .map(
            (t, i) => `
          <div class="tk-cell${isUsed(t) ? " is-used" : ""}" data-focus="${i}">
            <p class="tk-cell-name">${esc(nm(t))}</p>
            <div class="tk-cell-qr tk-qrwrap${isUsed(t) ? " is-used" : ""}">
              <div class="tk-qr-draw" id="qr-${i}"><div class="qr-fallback">…</div></div>
              ${isUsed(t) ? '<span class="tk-used-stamp tk-used-sm" aria-hidden="true">USED</span>' : ""}
            </div>
            ${isUsed(t)
              ? `<button type="button" class="tk-cell-share tk-cell-view" data-focus="${i}"><span>View details</span></button>`
              : `<button type="button" class="tk-cell-share" data-share="${i}">${I.share || ""}<span>Share</span></button>`
            }
          </div>`
          )
          .join("")}
      </div>
      <div class="tk-actions tk-actions-final" style="margin-top:16px">
        <button type="button" class="tk-btn ghost" data-go="events">${I.ticket || ""}<span>View tickets</span></button>
        <button type="button" class="tk-btn" data-go="home">${I.home || ""}<span>Done</span></button>
      </div>
      <div class="tk-actions" style="margin-top:8px">
        <button type="button" class="tk-btn" data-share-all="1">${I.share || ""}<span>Share all</span></button>
      </div>`;
        list.forEach((t, i) => {
      const box = $("qr-" + i);
      if (!box) return;
      try { window.ETC_QRLive.mount(box, t, 108); } catch (_) {}
      // Stamp lives on parent .tk-qrwrap — never wiped by QR redraw
      const wrap = box.closest(".tk-qrwrap");
      if (wrap && isUsed(t) && !wrap.querySelector(".tk-used-stamp")) {
        const st = document.createElement("span");
        st.className = "tk-used-stamp tk-used-sm";
        st.setAttribute("aria-hidden", "true");
        st.textContent = "USED";
        wrap.appendChild(st);
      }
    });
    view.querySelectorAll("[data-focus]").forEach((cell) => {
      cell.addEventListener("click", (e) => {
        if (e.target.closest("[data-share]")) return;
        focusIdx = +cell.dataset.focus;
        multiMode = "focus"; activeTicketId = (list[focusIdx] && list[focusIdx].id) || activeTicketId;
        renderTickets();
      });
    });
    $("tkMergeBtn").onclick = () => runMergeAnimation();
  }

  function runMergeAnimation() {
    const overlay = document.createElement("div");
    overlay.className = "tk-merge-ov";
    overlay.innerHTML = `<div class="tk-merge-ring"></div><p>Merging ${list.length} codes…</p>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("on"));
    setTimeout(() => {
      overlay.classList.remove("on");
      setTimeout(() => {
        overlay.remove();
        multiMode = "merged";
        renderTickets();
      }, 220);
    }, 700);
  }

  function copyBtn(v) {
    if (!v) return "";
    return `<button type="button" class="rc-copy" data-copy="${esc(String(v))}" aria-label="Copy code"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg><span>Copy</span></button>`;
  }
  async function copyText(v) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(v); return true; } } catch (_) {}
    try {
      const ta = document.createElement("textarea");
      ta.value = v; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, v.length);
      const ok = document.execCommand("copy"); ta.remove(); return ok;
    } catch (_) { return false; }
  }

  function renderReceipt() {
    // Resolve the one passenger currently being viewed
    const paramsId = (function(){ try { return new URLSearchParams(location.search).get("id"); } catch(_){ return null; } })();
    let focusTicket = null;
    if (activeTicketId) focusTicket = list.find(function(x){ return x.id === activeTicketId; }) || null;
    if (!focusTicket && multiMode === "focus" && typeof focusIdx === "number" && list[focusIdx]) focusTicket = list[focusIdx];
    if (!focusTicket && typeof cur === "number" && list[cur]) focusTicket = list[cur];
    if (!focusTicket && paramsId) focusTicket = list.find(function(x){ return x.id === paramsId; }) || null;
    if (!focusTicket && list.length === 1) focusTicket = list[0];
    if (focusTicket) activeTicketId = focusTicket.id;
    // Merged ONLY when user merged, or family is joined as one code
    const mergedView = multiMode === "merged" || (isFamily() && familyJoined === true);
    // Resolve which passenger the footer ref is for
    // Priority: focused cell → carousel index → activeTicketId → URL id → first
    let helpRef = "";
    if (mergedView) {
      const pay = (list[0] && list[0].reference) || "";
      helpRef = pay ? (String(pay) + "-G") : String((list[0] && list[0].id) || "");
    } else {
      // Always a per-passenger unique id (…-1, …-2, …)
      const who = focusTicket || (list[cur] || list[0]);
      if (who) {
        // Prefer explicit ticketRef; fall back to id; last resort build from reference+index
        helpRef = String(who.ticketRef || who.id || "");
        if ((!who.ticketRef || who.ticketRef === who.reference) && who.reference && who.index) {
          helpRef = String(who.reference) + "-" + String(who.index);
        }
      }
    }
    const t0 = list[0],
      n = list.length,
      fare = t0.fare || t0.amount,
      lug = t0.luggageFee || 0,
      total = t0.total || fare * n + lug;
    const paid = t0.paidAt
      ? new Date(t0.paidAt).toLocaleString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "–";
    const methodName =
      {
        card: "Debit / credit card",
        intl_card: "International card",
        transfer: "Bank transfer",
        ussd: "USSD",
        wallet: "Mobile money / wallet",
        qr: "QR code",
        apple_pay: "Apple Pay",
        bank_debit: "Direct bank debit",
      }[t0.method] ||
      t0.method ||
      "–";
    view.innerHTML = `<div class="rc-card">
      <div class="rc-top"><span class="rc-check">${I.check || ""}</span><h2>Payment received</h2><p>${naira(
      total
    )}</p></div>
      <div class="rc-rows">
        <div><span>Payment ref</span><b class="mono">${esc(t0.reference)}</b></div>
        <div><span>Paid on</span><b>${esc(paid)}</b></div>
        <div><span>Paid with</span><b>${esc(methodName)}</b></div>
        <div><span>Route</span><b>${esc(t0.from)} → ${esc(t0.to)}</b></div>
        <div><span>Travel</span><b>${esc(fmtDate(t0.date))}${t0.time ? " · " + esc(t0.time) : ""}</b></div>
        ${t0.email ? `<div><span>Receipt to</span><b>${esc(t0.email)}</b></div>` : ""}
      </div>
      <p class="rc-h">Items</p>
      <div class="rc-rows">
        ${list
          .map(function (t) {
            const used = isUsed(t);
            // Current ticket bold; merged = all unused bold; used stay normal
            const bold = mergedView ? !used : (focusTicket && t.id === focusTicket.id);
            const nameHtml = bold
              ? "<strong style=\"font-weight:800;color:#0f172a\">" + esc(nm(t)) + (t.seat ? " · " + esc(t.seat) : "") + "</strong>"
              : esc(nm(t)) + (t.seat ? " · " + esc(t.seat) : "");
            const usedTag = used ? ' <em style="color:#b91c1c;font-size:12px;font-style:normal">· Used</em>' : "";
            return "<div><span>" + nameHtml + usedTag + "</span><b>" + naira(fare) + "</b></div>";
          })
          .join("")}
        ${
          lug
            ? `<div><span>Additional luggage${t0.luggage ? ` (${t0.luggage})` : ""}</span><b>${naira(
                lug
              )}</b></div>`
            : ""
        }
        <div class="rc-total"><span>Total paid</span><b>${naira(total)}</b></div>
      </div>
      <div class="rc-ref">
        <p class="rc-ref-note">${mergedView
          ? "Group ref (boards all remaining — show at gate if phone is off):"
          : "Ticket ref (show at gate if phone is off):"}</p>
        <p class="rc-ref-code">${esc(helpRef)}</p>
        ${helpRef ? `<button type="button" class="rc-pill" data-copy="${esc(String(helpRef))}" aria-label="Copy ticket ref"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg><span>Copy</span></button>` : ""}
      </div>
    </div>`;
  }


  // Live status from agent scans → USED stamp + stop TOTP
  function startStatusWatches() {
    if (!window.ETC_Tickets || !window.ETC_Tickets.watchTicketStatus) return;
    var renderTimer = 0;
    function statusKey(t) {
      return String((t && t.status) || "").toLowerCase();
    }
    function isUsedStatus(st) {
      st = String(st || "").toLowerCase();
      return st === "boarded" || st === "used" || st === "void" || st === "scanned";
    }
    function applyUpdated(updated) {
      if (!updated || !updated.id) return;
      const i = list.findIndex(function (x) { return x.id === updated.id; });
      if (i < 0) return;
      const prev = list[i];
      const prevSt = statusKey(prev);
      const nextSt = statusKey(updated);
      // Merge without dropping local-only fields
      list[i] = Object.assign({}, prev, updated);
      if (prev.secret && !list[i].secret) list[i].secret = prev.secret;
      if (prev.ticketRef && !list[i].ticketRef) list[i].ticketRef = prev.ticketRef;
      if (prev.reference && !list[i].reference) list[i].reference = prev.reference;
      // Only refresh UI when status actually changes (stops flicker / instant close)
      if (prevSt === nextSt) {
        try { if (window.ETC_QRLive && window.ETC_QRLive.updateTicket) window.ETC_QRLive.updateTicket(null, list[i]); } catch (_) {}
        return;
      }
      try { if (window.ETC_QRLive && window.ETC_QRLive.updateTicket) window.ETC_QRLive.updateTicket(null, list[i]); } catch (_) {}
      // Debounce full re-render so rapid cloud events don't thrash the page
      clearTimeout(renderTimer);
      renderTimer = setTimeout(function () {
        try { renderTickets(); } catch (_) {}
      }, 280);
    }
    list.forEach(function (t) {
      window.ETC_Tickets.watchTicketStatus(t.id, applyUpdated);
    });
    function poll() {
      list.forEach(function (t) {
        // Skip tickets already marked used locally
        if (isUsedStatus(t.status)) return;
        if (window.ETC_Tickets.syncTicketStatus) {
          window.ETC_Tickets.syncTicketStatus(t.id).then(function (u) {
            if (!u) return;
            if (isUsedStatus(u.status)) applyUpdated(u);
          }).catch(function () {});
        }
      });
    }
    // First poll after a short delay so initial paint is not interrupted
    setTimeout(poll, 1500);
    setInterval(poll, 6000);
  }

  function setTab(name) {
    tabs.querySelectorAll("[data-tab]").forEach((b) => {
      const on = b.dataset.tab === name;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on);
    });
    if (name === "receipt") renderReceipt();
    else renderTickets();
    window.scrollTo({ top: 0 });
  }
  tabs.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) setTab(b.dataset.tab);
  });

  view.addEventListener("click", async (e) => {
    const go = e.target.closest("[data-go]");
    if (go) {
      location.href = go.dataset.go === "events" ? "events.html" : "index.html";
      return;
    }
    const cp = e.target.closest("[data-copy]");
    if (cp) {
      const ok = await copyText(cp.dataset.copy);
      UI.toast(ok ? "Code copied" : "Couldn’t copy – press and hold the code instead");
      if (ok) { const lab = cp.querySelector("span"); if (lab) { lab.textContent = "Copied"; cp.classList.add("done"); setTimeout(function () { lab.textContent = "Copy"; cp.classList.remove("done"); }, 1600); } }
      return;
    }
    const rc = e.target.closest("[data-recpt]");
    if (rc) return setTab("receipt");
    const all = e.target.closest("[data-share-all]");
    if (all) {
      const text = list.map((t) => `${nm(t)}: ${TK.shareLink(t)}`).join("\n");
      try {
        if (window.EtcNative && window.EtcNative.isNative && window.EtcNative.shareText) { await window.EtcNative.shareText("Your ETC boarding links:\n" + text, "ETC tickets"); return; }
        if (navigator.share) await navigator.share({ title: "ETC tickets", text: "Your ETC boarding links:\n" + text });
        else {
          await navigator.clipboard.writeText(text);
          UI.toast("All ticket links copied");
        }
      } catch (err) {
        if (err && err.name !== "AbortError") {
          try {
            await navigator.clipboard.writeText(text);
            UI.toast("All ticket links copied");
          } catch (_) {}
        }
      }
      return;
    }
    const sh = e.target.closest("[data-share]");
    if (!sh) return;
    const t = list[+sh.dataset.share],
      url = TK.shareLink(t);
    const data = {
      title: "ETC bus ticket",
      text: `${t.name} · ${t.from} → ${t.to}${t.time ? " · " + t.time : ""}. Open this link to get the live boarding QR.`,
      url,
    };
    try {
      if (window.EtcNative && window.EtcNative.isNative && window.EtcNative.shareText) { await window.EtcNative.shareText(data.text + "\n" + url, data.title); return; }
      if (navigator.share) await navigator.share(data);
      else {
        await navigator.clipboard.writeText(url);
        UI.toast("Ticket link copied");
      }
    } catch (err) {
      if (err && err.name !== "AbortError") {
        try {
          await navigator.clipboard.writeText(url);
          UI.toast("Ticket link copied");
        } catch (_) {
          UI.toast("Couldn’t share – try again");
        }
      }
    }
  });

  window.ETC_QRLive.onTick((sec) => {
    document.querySelectorAll(".live-clock").forEach((el) => (el.textContent = clock()));
    document.querySelectorAll(".live-sec b").forEach((el) => (el.textContent = sec));
    document.querySelectorAll(".tk-bar i").forEach((el) => {
      el.style.width = (sec / 30) * 100 + "%";
      el.classList.toggle("low", sec <= 5);
    });
  });

  (async function init() {
    const q = new URLSearchParams(location.search);
    let id = q.get("id");
    if (!id && location.hash.indexOf("d=") >= 0) {
      id = await TK.importFromHash(location.hash);
      if (id) history.replaceState(null, "", "ticket.html?id=" + encodeURIComponent(id));
    }
    const t = id ? await S.getTicket(id) : null;
    if (!t) {
      view.innerHTML = `<div class="tk-empty"><h3>Ticket not found</h3><p>It may have been saved on another device. Open your ticket link again, or check the Events tab.</p><a class="tk-btn" href="events.html" style="text-decoration:none;margin-top:14px">Go to Events</a></div>`;
      return;
    }
    list = t.imported ? [t] : await S.ticketsByRef(t.reference);
    if (!list.length) list = [t];
    // Ensure every ticket has a unique ticketRef (…-1, …-2, …) for receipt / phone-off
    list = list.map(function (x, i) {
      var idx = x.index != null ? x.index : (i + 1);
      var ref = x.reference || (x.id && String(x.id).replace(/-\d+$/, "")) || "";
      var unique = ref ? (ref + "-" + idx) : (x.id || ("T-" + idx));
      if (!x.ticketRef || x.ticketRef === x.reference || x.ticketRef === ref) {
        x = Object.assign({}, x, { ticketRef: unique, index: idx });
        // persist quietly
        try { S.putTicket(x); } catch (_) {}
      }
      // If id accidentally equals payment ref only, keep id but ticketRef is unique
      if (!x.id || x.id === ref) {
        x = Object.assign({}, x, { id: unique });
        try { S.putTicket(x); } catch (_) {}
      }
      return x;
    });
    cur = Math.max(0, list.findIndex((x) => x.id === t.id));
    if (cur < 0) cur = 0;
    activeTicketId = (list[cur] && list[cur].id) || t.id;
    tabs.hidden = false;
    // Family → one joined QR first. Add-tickets → grid of separate QRs.
    if (list.length > 1 && list.every((t) => t.family != null && t.family !== false && t.family !== "")) {
      familyJoined = true;
      multiMode = "grid"; // unused for family; familyJoined drives UI
    } else if (list.length > 1) {
      familyJoined = false;
      multiMode = "grid"; // always show multi grid on open — never jump to passenger 1 only
    }
    try {
      const q = new URLSearchParams(location.search);
      // Only open a single passenger if ?focus=1 (explicit)
      if (q.get("focus") === "1" && list.length > 1) {
        const pid = q.get("id");
        const ix = list.findIndex((x) => x.id === pid);
        if (ix >= 0) {
          focusIdx = ix;
          multiMode = "focus";
          activeTicketId = list[ix].id;
        }
      }
    } catch (_) {}
    setTab("ticket");
    startStatusWatches();
  })();
})();
