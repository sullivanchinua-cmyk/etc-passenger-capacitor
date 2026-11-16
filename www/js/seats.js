// =========================================================
// Seat selector – 32-seater CNG city bus
//   8 rows · A B | AISLE | C D · seats 1A + 1B are priority / wheelchair
//   Several buses: swipe sideways.  Family trips get one whole bus.
// =========================================================
window.ETC_Seats = (function () {
  const UI = window.ETC_UI, B = window.ETC_BOOK, ICON = window.ETC_ICONS;
  const ROWS = 8, COLS = ["A", "B", "C", "D"], COLN = { A: 1, B: 2, C: 4, D: 5 };
  const key = (bus, id) => `${bus}:${id}`;
  const seatOrder = [];
  for (let r = 1; r <= ROWS; r++) COLS.forEach((c) => seatOrder.push(r + c));

  // best block of seats for a family: closest together, priority seats kept free if possible
  function pickTogether(map, n) {
    const isFree = (id) => !map.occupied.has(id);
    let pool = seatOrder.filter((id) => isFree(id) && !B.priority.includes(id));
    if (pool.length < n) pool = seatOrder.filter(isFree);
    let best = 0, span = Infinity;
    for (let i = 0; i + n <= pool.length; i++) {
      const s = seatOrder.indexOf(pool[i + n - 1]) - seatOrder.indexOf(pool[i]);
      if (s < span) { span = s; best = i; }
    }
    return pool.slice(best, best + n);
  }

  /**
   * Seat a whole group together without opening the picker.
   * One bus if it can hold everybody (adjacent seats, row by row), otherwise bus by bus.
   * Soft-holds every seat (like a manual tap). Returns the list of "bus:seat" keys that were secured.
   */
  async function autoAssign(o) {
    const Occ = window.ETC_Occupancy;
    let travelDate = o.date || o.travelDate || null;
    if (!travelDate) { try { travelDate = localStorage.getItem("etc_travel_date"); } catch (_) {} }
    const need0 = Math.max(1, o.count || 1);
    if (Occ) {
      try { await Occ.releaseAllForSession(o.routeKey, travelDate); } catch (_) {}
      try { await Occ.preload(o.routeKey, travelDate); } catch (_) {}
    }
    const picks = [];
    let single = 0;
    for (let b = 1; b <= 6; b++) { if (window.etcBusMap(o.routeKey, b).free >= need0) { single = b; break; } }
    if (single) pickTogether(window.etcBusMap(o.routeKey, single), need0).forEach((id) => picks.push(key(single, id)));
    else {
      let need = need0;
      for (let b = 1; b <= 6 && need > 0; b++) {
        const m = window.etcBusMap(o.routeKey, b), take = Math.min(need, m.free);
        if (take > 0) { pickTogether(m, take).forEach((id) => picks.push(key(b, id))); need -= take; }
      }
    }
    const held = await Promise.all(picks.map(async (k) => {
      if (!Occ) return k;
      const [b, id] = k.split(":");
      try { const r = await Occ.holdSeat(o.routeKey, b, id, travelDate); return r && r.ok ? k : null; } catch (_) { return k; }
    }));
    return held.filter(Boolean);
  }

  /**
   * o = { count, mode:'individual'|'family', routeKey, selected:["1:3A",…], slot:{time,session}, onDone(list) }
   */
  function open(o) {
    const maps = [];
    // Always read live occupancy (cache filled by ETC_Occupancy)
    // Current seats (reselect): yellow pills. Keys "bus:seat" or bare "1A"
    const mineKeys = new Set();
    const mineSeatIdsByBus = {}; // busNo -> Set of seat ids
    function addMine(raw) {
      if (!raw) return;
      const s = String(raw);
      if (s.indexOf(":") >= 0) {
        const [b, id] = s.split(":");
        mineKeys.add(b + ":" + String(id).toUpperCase());
        if (!mineSeatIdsByBus[b]) mineSeatIdsByBus[b] = new Set();
        mineSeatIdsByBus[b].add(String(id).toUpperCase());
      } else {
        const id = s.toUpperCase();
        mineKeys.add("1:" + id);
        if (!mineSeatIdsByBus["1"]) mineSeatIdsByBus["1"] = new Set();
        mineSeatIdsByBus["1"].add(id);
      }
    }
    if (o.allowSeat) addMine(o.allowSeat);
    (o.mineSeats || o.selected || []).forEach(addMine);

    const bus = (n) => {
      const m = window.etcBusMap(o.routeKey, n);
      // Reselect: current seats count as free for this ticket/group
      const mine = mineSeatIdsByBus[String(n)];
      if (mine && mine.size && m.occupied) {
        const occ = new Set(m.occupied);
        mine.forEach((id) => occ.delete(id));
        maps[n - 1] = { n: m.n, all: m.all, occupied: occ, free: m.all.length - occ.size };
        return maps[n - 1];
      }
      maps[n - 1] = m;
      return m;
    };
    const sel = new Set(o.selected || []);
    const slot = o.slot || null;
    const travelDate = o.date || o.travelDate || (function(){ try { return localStorage.getItem("etc_travel_date"); } catch(_){ return null; } })() || null;
    function timeForBus(n) {
      if (!slot || !slot.time) return null;
      if (n <= 1) return slot.time;
      // Overflow buses take the next departure slots after the chosen one
      try {
        const all = (window.ETC_Slots && window.ETC_Slots.listTimes)
          ? window.ETC_Slots.listTimes()
          : null;
        if (all && all.length) {
          const idx = all.findIndex((t) => t === slot.time || (t.time && t.time === slot.time));
          const times = all.map((t) => (typeof t === "string" ? t : t.time));
          const i0 = times.indexOf(slot.time);
          if (i0 >= 0 && times[i0 + n - 1]) return times[i0 + n - 1];
        }
      } catch (_) {}
      return slot.time;
    }
    const busLabel = (n) => {
      const tm = timeForBus(n);
      return tm ? `Bus ${n} · ${tm}` : `Bus ${n}`;
    };
    const usedBuses = [...sel].map((k) => +k.split(":")[0]);
    // Live occupancy for this route
    let stopWatch = null;
    if (window.ETC_Occupancy) {
      window.ETC_Occupancy.preload(o.routeKey, travelDate).then(function(){
        let free = 0, n = 0;
        do { n++; free += (window.etcBusMap(o.routeKey, n).free || 0); } while (n < 6 && free < (o.count || 1));
        if (free < (o.count || 1)) {
          if (window.ETC_UI && window.ETC_UI.toast) window.ETC_UI.toast("Not enough open seats for this departure");
        }
      });
      window.ETC_Occupancy.watch(o.routeKey, travelDate).then(function(stop){ stopWatch = stop; });
    }

    if (o.mode === "family") {
      let t = 1; while (bus(t).free < o.count) t++;          // first bus that can hold everyone
      if (sel.size) {                                          // re-opening: keep what they chose
        return show(range(1, Math.max(t, ...usedBuses)));
      }
      if (t === 1) {                                           // fits in bus 1 – seat them together
        pickTogether(bus(1), o.count).forEach((id) => sel.add(key(1, id)));
        return show([1]);
      }
      const f = bus(1).free;
      const d = UI.overlay(`
        <div class="ov-card dlg-card" role="dialog" aria-label="Move to Bus ${t}">
          <div class="seal">${ICON.users}</div>
          <h3>Bus 1 is full for your family</h3>
          <p>Bus 1 only has ${f} seat${f === 1 ? "" : "s"} left, but your family of ${o.count} needs to sit together. Do you agree to move everyone to Bus ${t}?</p>
          <button class="ov-btn" id="dYes">Yes, move to Bus ${t}</button>
          <button class="ov-btn ghost" id="dNo">No, let me choose</button>
        </div>`, { sticky: true });
      d.el.querySelector("#dYes").onclick = () => {
        pickTogether(bus(t), o.count).forEach((id) => sel.add(key(t, id)));
        d.close(); setTimeout(() => show([t]), 220);
      };
      d.el.querySelector("#dNo").onclick = () => { d.close(); setTimeout(() => show(range(1, t)), 220); };
      return;
    }

    // individual tickets: add buses until everyone has a seat
    let n = 0, free = 0;
    do { n++; free += bus(n).free; } while (free < o.count);
    show(range(1, Math.max(n, ...usedBuses)));

    function show(pages) {
      const count = o.count, multi = pages.length > 1;
      const slides = pages.map((n) => slideHTML(n)).join("");
      const ui = UI.overlay(`
        <div class="seat-card" role="dialog" aria-label="Select seats">
          <button class="ov-close" data-close aria-label="Close">${UI.X}</button>
          <h3>Select your seats</h3>
          <p class="sub">${o.mode === "family" ? `Family trip · ${count} seats together` : `${count} ticket${count === 1 ? "" : "s"} · pick up to ${count} seat${count === 1 ? "" : "s"}`}</p>
          <div class="legend">
            <span class="pill p-av"><i></i>Available</span><span class="pill p-cur"><i></i>Current</span><span class="pill p-oc"><i></i>Occupied</span><span class="pill p-se"><i></i>Selected</span>
          </div>
          <p class="prio-note">${ICON.wheelchair}<span>Seats 1A &amp; 1B · Priority / wheelchair accessible</span></p>
          <div class="bus-meta"><span class="bm-name"><b id="bmName">${busLabel(pages[0])}</b>${slot ? `<em class="bm-sess">${UI.esc(slot.sessionName)}</em>` : ""}</span><span class="left" id="bmLeft"></span></div>
          ${multi ? `<div class="bus-dots" id="dots">${pages.map(() => "<i></i>").join("")}</div>` : ""}
          <div class="bus-pager" id="pager">${slides}</div>
          <div class="seat-foot">
            <div class="chips-row"><div class="chips" id="chips" role="list" aria-label="Selected seats"></div><span class="chips-count" id="chipsCount"></span></div>
            <button class="ov-btn" id="seatDone">Done</button>
          </div>
        </div>
        <div class="seat-toast" id="seatToast"></div>`, { cls: "seat-ov" });
      const el = ui.el, pager = el.querySelector("#pager");
      let idx = 0, tt = 0;

      const toast = (m) => { const t = el.querySelector("#seatToast"); t.textContent = m; t.classList.add("show"); clearTimeout(tt); tt = setTimeout(() => t.classList.remove("show"), 1800); };
      function meta() {
        const n = pages[idx];
        el.querySelector("#bmName").textContent = busLabel(n);
        el.querySelector("#bmLeft").textContent = multi && idx < pages.length - 1 ? `${bus(n).free} seats left · swipe for ${busLabel(pages[idx + 1])} →` : `${bus(n).free} seats left`;
        el.querySelectorAll("#dots i").forEach((d, j) => d.classList.toggle("on", j === idx));
      }
      function chips(scrollToEnd) {
        const list = [...sel].map((k) => k.split(":")).sort((a, b) => a[0] - b[0] || seatOrder.indexOf(a[1]) - seatOrder.indexOf(b[1]));
        const c = el.querySelector("#chips");
        c.innerHTML = list.length
          ? list.map(([b, id]) => `<span role="listitem">${multi || +b > 1 ? `Bus ${b} · ` : ""}${id}</span>`).join("")
          : `<em>No seat chosen yet</em>`;
        el.querySelector("#chipsCount").textContent = `${sel.size} of ${count}`;
        if (scrollToEnd && list.length) requestAnimationFrame(() => c.scrollTo({ left: c.scrollWidth, behavior: "smooth" }));
      }
      pager.addEventListener("scroll", () => {
        const i = Math.round(pager.scrollLeft / pager.clientWidth);
        if (i !== idx) { idx = Math.max(0, Math.min(pages.length - 1, i)); meta(); }
      }, { passive: true });

      let picking = false;
      el.addEventListener("click", async (e) => {
        const b = e.target.closest(".seat"); if (!b || b.classList.contains("oc")) return;
        const k = key(b.dataset.bus, b.dataset.id);
        const busNo = b.dataset.bus, seatId = b.dataset.id;
        if (sel.has(k)) {
          sel.delete(k);
          b.classList.remove("se");
          // Restore yellow if this was original current seat
          if (mineKeys.has(k)) b.classList.add("cur");
          else b.classList.add("av");
          b.setAttribute("aria-pressed", "false");
          if (window.ETC_Occupancy) window.ETC_Occupancy.releaseSeat(o.routeKey, busNo, seatId, travelDate);
          chips(true);
          return;
        }
        // Hard cap — sync before any await so rapid taps cannot overshoot
        if (sel.size >= count) {
          toast(o.mode === "family" ? ("All " + count + " family seats are picked") : ("You've picked all " + count + " seat" + (count === 1 ? "" : "s")));
          return;
        }
        // Reserve slot immediately
        sel.add(k);
        b.classList.remove("av", "cur");
        b.classList.add("se", "pop");
        b.setAttribute("aria-pressed", "true");
        setTimeout(() => b.classList.remove("pop"), 300);
        chips(true);
        // Soft-hold in Firestore (after local reserve)
        if (window.ETC_Occupancy) {
          try {
            const res = await window.ETC_Occupancy.holdSeat(o.routeKey, busNo, seatId, travelDate);
            if (!res.ok) {
              sel.delete(k);
              b.classList.remove("se");
              b.classList.add("oc");
              b.setAttribute("aria-pressed", "false");
              toast("Seat just taken — pick another");
              chips(true);
            }
          } catch (_) {}
        }
        // If another rapid path overflowed, trim
        while (sel.size > count) {
          const extra = [...sel].pop();
          sel.delete(extra);
          const [eb, eid] = extra.split(":");
          const btn = el.querySelector('.seat[data-bus="'+eb+'"][data-id="'+eid+'"]');
          if (btn) {
            btn.classList.remove("se");
            btn.classList.add(mineKeys.has(extra) ? "cur" : "av");
            btn.setAttribute("aria-pressed", "false");
          }
        }
        chips(true);
      });
      let done = false;
      el.querySelector("#seatDone").onclick = () => {
        done = true;
        // Keep soft-holds until payment succeeds (tickets.js will create permanent seats)
        o.onDone([...sel]);
        ui.close();
      };
      // If user closes without Done, release our soft-holds
      const origClose = ui.close;
      ui.close = function() {
        if (!done && window.ETC_Occupancy) {
          window.ETC_Occupancy.releaseAllForSession(o.routeKey, travelDate);
        }
        if (stopWatch) try { stopWatch(); } catch(_){}
        if (unsubOcc) try { unsubOcc(); } catch(_){}
        return origClose.apply(this, arguments);
      };
      // Live repaint when another passenger takes/releases a seat
      let unsubOcc = null;
      if (window.ETC_Occupancy) {
        unsubOcc = window.ETC_Occupancy.onChange(function(rk) {
          if (rk !== o.routeKey) return;
          // refresh maps and reclass seats without destroying selection
          pages.forEach(function(n) {
            const m = bus(n); // refreshes from cache
            el.querySelectorAll('.seat[data-bus="'+n+'"]').forEach(function(btn) {
              const id = btn.dataset.id;
              const k = key(n, id);
              if (sel.has(k)) {
                btn.className = "seat se";
                btn.disabled = false;
                btn.setAttribute("aria-pressed", "true");
              } else if (m.occupied.has(id) && !mineKeys.has(k)) {
                // occupied by someone else — current (mine) seats stay free/yellow
                btn.className = "seat oc";
                btn.disabled = true;
                btn.setAttribute("aria-pressed", "false");
              } else if (mineKeys.has(k)) {
                // Steady yellow current seat (reselect)
                btn.className = "seat cur";
                btn.disabled = false;
                btn.setAttribute("aria-pressed", "false");
              } else {
                btn.className = "seat av";
                btn.disabled = false;
                btn.setAttribute("aria-pressed", "false");
              }
            });
          });
          // drop local sel for seats now occupied by others
          const stolen = [];
          [...sel].forEach(function(k) {
            const parts = k.split(":");
            const m = bus(+parts[0]);
            if (m.occupied.has(parts[1])) {
              sel.delete(k);
              stolen.push(parts[1]);
            }
          });
          if (stolen.length && window.ETC_UI) {
            window.ETC_UI.toast("Sorry, seat " + stolen.join(", ") + " was just taken");
          }
          meta(); chips(false);
        });
      }
      // Load cloud + local seats NOW that UI is listening
      function paintCur() {
        pages.forEach(function(n) {
          el.querySelectorAll('.seat[data-bus="'+n+'"]').forEach(function(btn) {
            const id = btn.dataset.id;
            const k = key(n, id);
            if (sel.has(k) || btn.classList.contains("se")) return;
            if (mineKeys.has(k) && !btn.classList.contains("oc")) {
              btn.classList.remove("av");
              btn.classList.add("cur");
            }
          });
        });
      }
      if (window.ETC_Occupancy && window.ETC_Occupancy.preload) {
        window.ETC_Occupancy.preload(o.routeKey, travelDate).then(function () {
          meta(); chips(false); paintCur();
        });
      }
      meta(); chips(false); paintCur();
    }

    function slideHTML(n) {
      const m = bus(n);
      let seats = "";
      for (let r = 1; r <= ROWS; r++) COLS.forEach((c) => {
        const id = r + c, k = key(n, id), prio = B.priority.includes(id);
        const kMine = key(n, id);
        const isMine = mineKeys.has(kMine) && !sel.has(kMine);
        const st = m.occupied.has(id) ? "oc" : sel.has(kMine) ? "se" : isMine ? "cur" : "av";
        seats += `<button type="button" class="seat ${st}" data-bus="${n}" data-id="${id}" style="grid-column:${COLN[c]};grid-row:${r}" ${st === "oc" ? "disabled" : ""}
          aria-pressed="${st === "se"}" aria-label="Seat ${id}${prio ? ", priority wheelchair accessible" : ""}, ${st === "oc" ? "occupied" : st === "cur" ? "your current seat" : st === "se" ? "selected" : "available"}">${prio ? ICON.wheelchair : ""}<span class="lb">${id}</span></button>`;
      });
      return `<div class="bus-slide"><div class="bus-body">
        <div class="bus-front"><span class="tag">${ICON.wheel}FRONT / DRIVER</span><span class="tag">${ICON.door}ENTRANCE DOOR</span></div>
        <div class="bus-rule"></div>
        <div class="seat-grid"><div class="aisle"><span>AISLE</span></div>${seats}</div>
        <div class="bus-rule" style="margin-top:12px"></div>
        <div class="bus-back">BACK ROW</div></div></div>`;
    }
  }
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  return { open, autoAssign };
})();
