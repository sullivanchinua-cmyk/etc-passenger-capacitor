// Events tab = "My tickets"
// Long-press or ⋯ menu → Reschedule / Reselect seat / Refund / Buy more
(function () {
  const S = window.ETC_Store, I = window.ETC_ICONS, TK = window.ETC_Tickets, UI = window.ETC_UI;
  const esc = UI.esc, box = document.getElementById("evList");
  if (!box) return;

  const today = () => {
    const n = new Date();
    return n.getFullYear() + "-" + String(n.getMonth() + 1).padStart(2, "0") + "-" + String(n.getDate()).padStart(2, "0");
  };
  const isUsed = (t) => {
    const st = String((t && t.status) || "").toLowerCase();
    return st === "boarded" || st === "void" || st === "noshow" || st === "used";
  };

  function row(t, past) {
    const a = document.createElement("div");
    a.className = "nt" + (past || isUsed(t) ? " past" : "");
    a.setAttribute("role", "link");
    a.dataset.tid = t.id;
    const usedBadge = isUsed(t) ? " · Used" : "";
    a.innerHTML =
      `<button type="button" class="nt-main" data-open="${esc(t.id)}">` +
      `<span class="tx"><b>${esc(t.from)} → ${esc(t.to)}</b>` +
      `<span>${esc(TK.fmtDate(t.date))}${t.time ? " · " + esc(t.time) : ""}</span>` +
      `<small>${esc(/^(Ticket|Member|Passenger) \d+$/i.test(t.name || "") ? "Passenger " + (t.index || 1) : t.name)}` +
      `${t.seat ? ` · Bus ${t.bus || 1} · Seat ${esc(t.seat)}` : " · Free seating"}${usedBadge}` +
      `${t.imported ? " · Shared with you" : ""}</small></span>` +
      `<span class="thumb" aria-hidden="true"></span></button>`;
    return a;
  }

  function bindRow(el, t) {
    const main = el.querySelector(".nt-main");
    let timer = null;
    let longFired = false;
    const start = (e) => {
      longFired = false;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        longFired = true;
        try { if (navigator.vibrate) navigator.vibrate(10); } catch (_) {}
        openTicketActions(t);
      }, 550);
    };
    const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
    if (main) {
      main.addEventListener("touchstart", start, { passive: true });
      main.addEventListener("touchmove", cancel, { passive: true });
      main.addEventListener("touchend", cancel);
      main.addEventListener("touchcancel", cancel);
      main.addEventListener("mousedown", (e) => { if (e.button === 0) start(e); });
      main.addEventListener("mouseup", cancel);
      main.addEventListener("mouseleave", cancel);
      main.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        cancel();
        longFired = true;
        openTicketActions(t);
      });
      main.addEventListener("click", (e) => {
        if (longFired) {
          e.preventDefault();
          e.stopPropagation();
          longFired = false;
          return;
        }
        location.href = "ticket.html?id=" + encodeURIComponent(t.id);
      });
    }
  }

  const svgCal = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>';
  const svgSeat = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round"><path d="M6 13V7a3 3 0 016 0v6"/><path d="M4 15h12a2 2 0 012 2v2H4v-2a2 2 0 012-2z"/><path d="M8 19v2M14 19v2"/></svg>';
  const svgCash = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/></svg>';
  const svgPlus = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
  let actionsOpen = false;
  function openTicketActions(t) {
    if (actionsOpen) return;
    if (!UI || !UI.overlay) {
      alert("Menu unavailable");
      return;
    }
    const used = isUsed(t);
    const html = `
      <div class="ov-card tact-card">
        <button type="button" class="ov-x" id="tactClose" aria-label="Close">${I.close || "×"}</button>
        <h3 class="ov-title">${esc(t.from)} → ${esc(t.to)}</h3>
        <p class="ov-sub">${esc(t.time || "Any time")}${t.seat ? " · Seat " + esc(t.seat) : ""}${used ? " · Used" : ""}</p>
        <div class="tact-list">
          <button type="button" class="tact" data-a="reschedule" ${used ? "disabled" : ""}>
            <span class="tact-ic">${svgCal}</span><span><b>Reschedule</b><em>${used ? "Not available for used tickets" : "Pick a new date, time & seat"}</em></span>
          </button>
          <button type="button" class="tact" data-a="reselect" ${used ? "disabled" : ""}>
            <span class="tact-ic">${svgSeat}</span><span><b>Reselect seat</b><em>${used ? "Not available" : "Pick a free seat on this bus"}</em></span>
          </button>
          <button type="button" class="tact" data-a="refund" disabled>
            <span class="tact-ic">${svgCash}</span><span><b>Refund</b><em>Coming soon</em></span>
          </button>
          <button type="button" class="tact" data-a="more">
            <span class="tact-ic">${svgPlus}</span><span><b>Buy more tickets</b><em>Same route</em></span>
          </button>
        </div>
      </div>`;
    actionsOpen = true;
    const ov = UI.overlay(html, { cls: "tact-ov" });
    const prevClose = ov.close;
    ov.close = function () { actionsOpen = false; prevClose(); };
    ov.el.querySelector("#tactClose").onclick = ov.close;
    ov.el.querySelectorAll("[data-a]").forEach((btn) => {
      btn.onclick = () => {
        if (btn.disabled) return;
        const a = btn.dataset.a;
        ov.close();
        if (a === "reschedule") startReschedule(t);
        else if (a === "reselect") openReselectSeat(t);
        else if (a === "more") {
          location.href = "details.html?from=" + encodeURIComponent(t.from) + "&to=" + encodeURIComponent(t.to);
        }
      };
    });
  }


  /** For family / add-ticket groups: pick which tickets to change (Change all by default). */
  async function pickGroupTickets(seed, actionLabel) {
    const all = (window.ETC_Store && window.ETC_Store.listTickets)
      ? await window.ETC_Store.listTickets()
      : [];
    const ref = seed.reference;
    let peers = ref
      ? all.filter((x) => x.reference === ref && !isUsed(x))
      : [seed];
    if (!peers.length) peers = [seed];
    if (peers.length === 1) return peers;
    return new Promise((resolve) => {
      let selected = new Set(peers.map((p) => p.id)); // default: all
      function paintList(box) {
        box.innerHTML = peers.map((p) => {
          const on = selected.has(p.id);
          return `<button type="button" class="gpick-item${on ? " on" : ""}" data-id="${esc(p.id)}">
            <span class="gpick-check">${on ? "✓" : ""}</span>
            <span><b>${esc(p.name || ("Passenger " + (p.index || "")))}</b>
            <em>${esc(p.seat || "No seat")} · ${esc(p.time || "Any time")}</em></span>
          </button>`;
        }).join("");
        box.querySelectorAll(".gpick-item").forEach((btn) => {
          btn.onclick = () => {
            const id = btn.dataset.id;
            if (selected.has(id)) selected.delete(id); else selected.add(id);
            // morph header button
            const go = ov.el.querySelector("#gpickGo");
            if (go) go.textContent = selected.size === peers.length ? "Change all · Continue" : ("Change " + selected.size + " · Continue");
            paintList(box);
          };
        });
      }
      const html = `
        <div class="ov-card gpick-card">
          <button type="button" class="ov-x" id="gpickClose">${I.close || "×"}</button>
          <h3 class="ov-title">${esc(actionLabel || "Choose tickets")}</h3>
          <p class="ov-sub">This booking has ${peers.length} tickets. Change all, or pick who to update.</p>
          <div class="gpick-list" id="gpickList"></div>
          <button type="button" class="ov-btn" id="gpickGo">Change all · Continue</button>
        </div>
        <style>
          .gpick-list { display: flex; flex-direction: column; gap: 8px; margin: 14px 0; max-height: 42vh; overflow: auto; }
          .gpick-item { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left;
            padding: 12px 14px; border-radius: 14px; border: 1.5px solid #e2e8f0; background: #fff;
            font-family: inherit; cursor: pointer; transition: .15s; }
          .gpick-item.on { border-color: #0f172a; background: #f8fafc; }
          .gpick-check { width: 28px; height: 28px; border-radius: 50%; border: 2px solid #cbd5e1;
            display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 14px; flex-shrink: 0; }
          .gpick-item.on .gpick-check { background: #0f172a; color: #fff; border-color: #0f172a; }
          .gpick-item b { display: block; font-size: 14px; }
          .gpick-item em { display: block; font-size: 12px; color: #64748b; font-style: normal; margin-top: 2px; }
        </style>`;
      const ov = UI.overlay(html);
      const box = ov.el.querySelector("#gpickList");
      paintList(box);
      ov.el.querySelector("#gpickClose").onclick = () => { ov.close(); resolve(null); };
      ov.el.querySelector("#gpickGo").onclick = () => {
        const out = peers.filter((p) => selected.has(p.id));
        ov.close();
        resolve(out.length ? out : null);
      };
    });
  }

  async function startReschedule(t) {
    if (isUsed(t)) { UI.toast("Used tickets cannot be rescheduled"); return; }
    const group = await pickGroupTickets(t, "Reschedule tickets");
    if (!group || !group.length) return;
    const seed = group[0];
    const date = await pickTravelDate(seed.date);
    if (!date) return;
    const slot = await pickDepartureTime(seed, date);
    if (!slot) return;
    const routeKey = (seed.from || "") + ">" + (seed.to || "") + (slot.time ? "@" + slot.time : "");
    try {
      if (window.ETC_Occupancy) {
        await window.ETC_Occupancy.preload(routeKey, date);
        if (window.ETC_Occupancy.watch) window.ETC_Occupancy.watch(routeKey, date);
      }
    } catch (_) {}
    if (!window.ETC_Seats) { UI.toast("Seat picker unavailable"); return; }
    window.ETC_Seats.open({
      count: group.length,
      mode: group.length > 1 ? "group" : "individual",
      routeKey: routeKey,
      selected: [],
      slot: slot,
      date: date,
      onDone: async function (seats) {
        const list = seats || [];
        for (let i = 0; i < group.length; i++) {
          const sn = list[i] != null ? String(list[i]) : (list[0] != null ? String(list[0]) : null);
          const parts = sn ? sn.split(":") : [];
          const busNo = parts[0] ? +parts[0] : null;
          const seat = parts[1] || null;
          await applyReschedule(group[i], { date: date, slot: slot, busNo: busNo, seat: seat });
        }
        try { location.reload(); } catch (_) {}
      },
    });
  }

  function pickTravelDate(current) {
    return new Promise((resolve) => {
      const base = current && /^\d{4}-\d{2}-\d{2}$/.test(current) ? current : today();
      const max = new Date();
      max.setMonth(max.getMonth() + 4);
      const maxIso = max.getFullYear() + "-" + String(max.getMonth() + 1).padStart(2, "0") + "-" + String(max.getDate()).padStart(2, "0");
      const html = `
        <div class="ov-card">
          <button type="button" class="ov-x" id="rdClose">${I.close || "×"}</button>
          <h3 class="ov-title">Choose travel date</h3>
          <p class="ov-sub">Reschedule within the next 4 months</p>
          <input type="date" id="rdDate" class="text-in" value="${esc(base)}" min="${today()}" max="${maxIso}"
            style="margin:12px 0;width:100%;padding:14px;border-radius:14px;border:1px solid #e2e8f0;font-size:16px"/>
          <button type="button" class="ov-btn" id="rdGo">Continue</button>
        </div>`;
      const ov = UI.overlay(html);
      ov.el.querySelector("#rdClose").onclick = () => { ov.close(); resolve(null); };
      ov.el.querySelector("#rdGo").onclick = () => {
        const v = ov.el.querySelector("#rdDate").value;
        ov.close();
        resolve(v || null);
      };
    });
  }

  function pickDepartureTime(t, date) {
    return new Promise((resolve) => {
      const times = (window.ETC_Slots && window.ETC_Slots.listTimes) ? window.ETC_Slots.listTimes() : [
        "06:00 AM","06:30 AM","07:00 AM","07:30 AM","08:00 AM","08:30 AM","09:00 AM","09:30 AM",
        "10:00 AM","10:30 AM","11:00 AM","11:30 AM","12:00 PM","12:30 PM","01:00 PM","01:30 PM",
        "02:00 PM","02:30 PM","03:00 PM","03:30 PM","04:00 PM","04:30 PM","05:00 PM","05:30 PM",
        "06:00 PM","06:30 PM","07:00 PM","07:30 PM","08:00 PM","08:30 PM","09:00 PM"
      ];
      const now = new Date();
      const isToday = date === today();
      const filtered = times.filter((tm) => {
        if (!isToday) return true;
        const m = window.ETC_Slots && window.ETC_Slots.minutes ? window.ETC_Slots.minutes(tm) : null;
        if (m == null) return true;
        return m > now.getHours() * 60 + now.getMinutes();
      });
      const list = filtered.length ? filtered : times;
      const html = `
        <div class="ov-card" style="max-height:80vh;overflow:auto">
          <button type="button" class="ov-x" id="rtClose">${I.close || "×"}</button>
          <h3 class="ov-title">Choose departure time</h3>
          <p class="ov-sub">${esc(t.from)} → ${esc(t.to)} · ${esc(date)}</p>
          <div class="rt-grid" id="rtGrid">
            ${list.map((tm) => `<button type="button" class="rt-chip" data-t="${esc(tm)}">${esc(tm)}</button>`).join("")}
          </div>
        </div>`;
      const ov = UI.overlay(html);
      ov.el.querySelector("#rtClose").onclick = () => { ov.close(); resolve(null); };
      ov.el.querySelectorAll("[data-t]").forEach((b) => {
        b.onclick = () => {
          ov.close();
          resolve({ time: b.dataset.t, sessionName: sessionOf(b.dataset.t), session: sessionKey(b.dataset.t) });
        };
      });
    });
  }

  function sessionOf(time) {
    const m = window.ETC_Slots && window.ETC_Slots.minutes ? window.ETC_Slots.minutes(time) : 12 * 60;
    if (m < 12 * 60) return "Morning peak";
    if (m < 17 * 60) return "Afternoon";
    return "Evening / Night";
  }
  function sessionKey(time) {
    const m = window.ETC_Slots && window.ETC_Slots.minutes ? window.ETC_Slots.minutes(time) : 12 * 60;
    if (m < 12 * 60) return "morning";
    if (m < 17 * 60) return "afternoon";
    return "evening";
  }

  async function applyReschedule(t, opts) {
    const date = opts.date, slot = opts.slot, busNo = opts.busNo, seat = opts.seat;
    const all = await S.listTickets();
    const ticket = all.find((x) => x.id === t.id);
    if (!ticket) { UI.toast("Ticket not found"); return; }
    if (isUsed(ticket)) { UI.toast("Used tickets cannot be rescheduled"); return; }

    const prev = { date: ticket.date, time: ticket.time, seat: ticket.seat, bus: ticket.bus };
    ticket.date = date;
    ticket.time = slot && slot.time;
    ticket.session = slot && (slot.sessionName || slot.session);
    ticket.bus = busNo;
    ticket.busNo = busNo;
    ticket.seat = seat;
    // Reschedule releases old luggage reservation
    ticket.luggageSpace = 0;
    ticket.luggageItems = 0;
    ticket.luggageFee = 0;
    ticket.missedRide = false;
    ticket.rescheduledAt = Date.now();
    ticket.previousSchedule = prev;
    ticket.status = "booked";
    await S.putTicket(ticket);

    try {
      if (window.ETC_FB && window.ETC_FB.db) {
        await window.ETC_FB.ensureAuth();
        const FV = window.ETC_FB.FieldValue;
        await window.ETC_FB.db.collection("tickets").doc(String(ticket.id)).set({
          date: ticket.date,
          time: ticket.time,
          session: ticket.session,
          bus: busNo,
          busNo: busNo,
          seat: seat,
          luggageSpace: 0,
          luggageItems: 0,
          luggageFee: 0,
          missedRide: false,
          rescheduledAt: FV.serverTimestamp(),
          previousSchedule: prev,
          status: "booked",
        }, { merge: true });
        // Notify agent
        try {
          await window.ETC_FB.db.collection("agent_alerts").add({
            type: "reschedule",
            ticketId: ticket.id,
            from: ticket.from,
            to: ticket.to,
            date: ticket.date,
            time: ticket.time,
            seat: seat,
            bus: busNo,
            previous: prev,
            createdAt: FV.serverTimestamp(),
          });
        } catch (_) {}
      }
    } catch (e) {
      console.warn("[ETC reschedule]", e);
    }
    UI.toast("Rescheduled to " + date + (slot && slot.time ? " · " + slot.time : "") + (seat ? " · " + seat : ""));
    location.reload();
  }

  async function openReselectSeat(t) {
    if (isUsed(t)) { UI.toast("Used tickets cannot change seats"); return; }
    if (!window.ETC_Seats || !window.ETC_Occupancy) {
      UI.toast("Seat picker unavailable");
      return;
    }
    const group = await pickGroupTickets(t, "Reselect seats");
    if (!group || !group.length) return;
    const seed = group[0];
    const routeKey = (seed.from || "") + ">" + (seed.to || "") + (seed.time ? "@" + seed.time : "");
    const travelDate = seed.date || today();
    try {
      await window.ETC_Occupancy.preload(routeKey, travelDate);
      if (window.ETC_Occupancy.watch) window.ETC_Occupancy.watch(routeKey, travelDate);
    } catch (_) {}
    const mineSeats = group.map(function (g) {
      const bus = g.busNo != null ? g.busNo : (g.bus != null ? g.bus : 1);
      return g.seat ? (bus + ":" + g.seat) : null;
    }).filter(Boolean);
    window.ETC_Seats.open({
      count: group.length,
      mode: group.length > 1 ? "group" : "individual",
      routeKey: routeKey,
      selected: [],
      mineSeats: mineSeats,
      allowSeat: group.length === 1 && group[0].seat ? group[0].seat : null,
      slot: seed.time ? { time: seed.time, sessionName: seed.session || "" } : null,
      date: travelDate,
      onDone: async function (seats) {
        if (!seats || !seats.length) return;
        const all = await S.listTickets();
        for (let i = 0; i < group.length; i++) {
          const sn = seats[i] != null ? String(seats[i]) : String(seats[0]);
          const parts = sn.split(":");
          const busNo = +parts[0] || 1;
          const seat = parts[1];
          if (!seat) continue;
          const ticket = all.find((x) => x.id === group[i].id);
          if (!ticket || isUsed(ticket)) continue;
          const prev = ticket.seat;
          ticket.seat = seat;
          ticket.bus = busNo;
          ticket.busNo = busNo;
          ticket.seatUpdatedAt = Date.now();
          await S.putTicket(ticket);
          try {
            if (window.ETC_FB && window.ETC_FB.db) {
              await window.ETC_FB.ensureAuth();
              const FV = window.ETC_FB.FieldValue;
              await window.ETC_FB.db.collection("tickets").doc(String(ticket.id)).set({
                seat: seat, bus: busNo, busNo: busNo,
                seatUpdatedAt: FV.serverTimestamp(),
                previousSeat: prev || null,
              }, { merge: true });
            }
          } catch (e) { console.warn(e); }
        }
        UI.toast("Seats updated for " + group.length + " ticket(s)");
        location.reload();
      },
    });
  }

  // Styles
  if (!document.getElementById("tact-css")) {
    const s = document.createElement("style");
    s.id = "tact-css";
    s.textContent = `
      .nt { position: relative; display: block; }
      .nt-main { display: flex; align-items: center; gap: 12px; width: 100%; padding: 0; border: 0;
        background: transparent; text-align: left; font: inherit; color: inherit; cursor: pointer; }
      .nt-more { display: none !important; position: absolute; top: 10px; right: 10px; z-index: 3; width: 36px; height: 36px;
        border: 0; border-radius: 50%; background: rgba(15,23,42,.06); font-size: 18px; font-weight: 700;
        color: #334155; cursor: pointer; line-height: 1; }
      .nt .thumb { pointer-events: none; }
      .tact-list { display: flex; flex-direction: column; gap: 8px; padding: 4px 0 8px; }
      .tact { display: flex; align-items: center; gap: 14px; width: 100%; padding: 16px 16px; border: 0;
        border-radius: 18px; background: #fff; text-align: left; font-family: inherit;
        color: inherit; cursor: pointer; box-shadow: 0 2px 12px rgba(17,17,18,.05);
        border: 1px solid rgba(15,23,42,.06); }
      .tact:disabled { opacity: .4; }
      .tact-ic { width: 40px; height: 40px; display: flex; align-items: center; justify-content: center;
        border-radius: 12px; background: #f1f5f9; flex-shrink: 0; }
      .tact-ic svg { display: block; }
      .tact b { display: block; font-size: 15px; font-weight: 800; }
      .tact em { display: block; font-size: 12px; color: #64748b; font-style: normal; margin-top: 2px; }
      .rt-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 12px; }
      .rt-chip { padding: 12px 8px; border: 0; border-radius: 14px; background: #f1f5f9; font-weight: 700;
        font-size: 13px; cursor: pointer; font-family: inherit; }
      .rt-chip:active { background: #111114; color: #fff; }
    `;
    document.head.appendChild(s);
  }

  // Late-notification deep link
  const params = new URLSearchParams(location.search);
  const reschedId = params.get("reschedule");
  try {
    const sid = sessionStorage.getItem("etc_reschedule_id");
    if (sid && !reschedId) params.set("reschedule", sid);
  } catch (_) {}

  async function loadAndPaint() {
    let all = [];
    try { all = await S.listTickets(); } catch (_) { all = []; }
    // Paint LOCAL tickets immediately (fast, no network)
    renderTicketList(all);
    // Background: pull cloud + sync status, then repaint if changed
    (async function bg() {
      try {
        if (window.ETC_Tickets && window.ETC_Tickets.pullMyTickets) {
          await Promise.race([
            window.ETC_Tickets.pullMyTickets(),
            new Promise((r) => setTimeout(r, 4000)),
          ]);
        }
      } catch (_) {}
      try {
        let cur = await S.listTickets();
        if (window.ETC_Tickets && window.ETC_Tickets.applyMissedRide) {
          // Only check a few recent past tickets — don't block UI
          const pastish = cur.filter((t) => (t.date || "") < today()).slice(0, 8);
          await Promise.all(pastish.map((t) => window.ETC_Tickets.applyMissedRide(t).catch(() => null)));
        }
        if (window.ETC_Tickets && window.ETC_Tickets.syncTicketStatus) {
          const need = cur.filter((t) => !isUsed(t)).slice(0, 12);
          await Promise.all(need.map((t) => window.ETC_Tickets.syncTicketStatus(t.id).catch(() => null)));
        }
        const next = await S.listTickets();
        renderTicketList(next);
      } catch (e) { console.warn("[ETC events] bg", e); }
    })();
  }

  function renderTicketList(all) {
    box.innerHTML = "";
    box._qrN = 0;
    if (!all || !all.length) {
      box.innerHTML = `<div class="nt-empty">${I.qr}<h3>No tickets yet</h3><p>Book a trip and your QR ticket will be saved here.</p></div>`;
      return;
    }
    const up = all.filter((t) => (t.date || today()) >= today() && !isUsed(t))
      .sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.index || 0) - (b.index || 0));
    const past = all.filter((t) => (t.date || today()) < today() || isUsed(t));
    // Collapse multi-ticket / family bookings into ONE row per payment reference
    function groupByRef(arr) {
      const map = new Map();
      const order = [];
      arr.forEach((t) => {
        const key = t.reference || t.id;
        if (!map.has(key)) {
          map.set(key, []);
          order.push(key);
        }
        map.get(key).push(t);
      });
      return order.map((k) => {
        const peers = map.get(k).slice().sort((a, b) => (a.index || 0) - (b.index || 0));
        return { seed: peers[0], peers: peers, count: peers.length };
      });
    }

    function rowGroup(g, past) {
      const t = g.seed;
      const a = document.createElement("div");
      const allUsed = g.peers.every(isUsed);
      a.className = "nt" + (past || allUsed ? " past" : "");
      a.setAttribute("role", "link");
      a.dataset.tid = t.id;
      const usedN = g.peers.filter(isUsed).length;
      const usedBadge = allUsed ? " · Used" : (usedN ? " · " + usedN + "/" + g.count + " used" : "");
      const paxLabel = g.count > 1
        ? (g.count + " passengers")
        : (esc(/^(Ticket|Member|Passenger) \d+$/i.test(t.name || "") ? "Passenger " + (t.index || 1) : t.name));
      const seats = g.peers.map((x) => x.seat).filter(Boolean);
      const seatTxt = seats.length
        ? " · " + (seats.length <= 3 ? seats.join(", ") : seats.length + " seats")
        : " · Free seating";
      a.innerHTML =
        `<button type="button" class="nt-main" data-open="${esc(t.id)}">` +
        `<span class="tx"><b>${esc(t.from)} → ${esc(t.to)}</b>` +
        `<span>${esc(TK.fmtDate(t.date))}${t.time ? " · " + esc(t.time) : ""}</span>` +
        `<small>${paxLabel}${seatTxt}${usedBadge}` +
        `${t.imported ? " · Shared with you" : ""}</small></span>` +
        `<span class="thumb" aria-hidden="true"></span></button>`;
      return a;
    }

    const section = (title, arr, isPast) => {
      if (!arr.length) return;
      const groups = groupByRef(arr);
      const h = document.createElement("p");
      h.className = "ev-h";
      h.innerHTML = `${title}<span class="ev-count">${groups.length}</span>`;
      box.appendChild(h);
      groups.forEach((g) => {
        const el = rowGroup(g, isPast);
        box.appendChild(el);
        bindRow(el, g.seed);
        const thumb = el.querySelector(".thumb");
        const showUsed = g.peers.every(isUsed);
        if (!isPast && !showUsed && window.ETC_QRLive) {
          // Limit live thumbs so Events stays fast with many tickets
          const n = (box._qrN = (box._qrN || 0) + 1);
          if (n <= 6) {
            const live = g.peers.find((x) => !isUsed(x)) || g.seed;
            window.ETC_QRLive.mount(thumb, live, 66);
          } else if (thumb) {
            thumb.innerHTML = '<span class="thumb-ph" aria-hidden="true"></span>';
          }
        } else if (thumb) {
          thumb.style.position = "relative";
          thumb.style.overflow = "hidden";
          if (showUsed) {
            thumb.classList.add("is-used");
            thumb.innerHTML = '<div class="nt-qr-draw"></div>';
            const draw = thumb.querySelector(".nt-qr-draw");
            const live = g.peers.find((x) => isUsed(x)) || g.seed;
            if (window.ETC_QRLive && live && draw) {
              try { window.ETC_QRLive.mount(draw, live, 66); } catch (_) {}
            } else if (draw) {
              draw.innerHTML = '<span class="nt-qr-ghost" aria-hidden="true"></span>';
            }
            const st = document.createElement("span");
            st.className = "nt-used-stamp";
            st.textContent = "USED";
            thumb.appendChild(st);
          } else {
            thumb.innerHTML = I.qr || "";
            thumb.classList.remove("is-used");
          }
        }
      });
    };
    section("My tickets", up, false);
    section("Past trips", past, true);

    if (window.ETC_Tickets && window.ETC_Tickets.checkLateTickets) {
      setTimeout(function () { try { if (window.ETC_Tickets && window.ETC_Tickets.checkLateTickets) window.ETC_Tickets.checkLateTickets(); } catch(_){} try { if (window.ETC_Tickets && window.ETC_Tickets.checkSeatReleasedAlerts) window.ETC_Tickets.checkSeatReleasedAlerts(); } catch(_){} }, 800);
    }

    // Deep-link reschedule from late notification
    const rid = params.get("reschedule") || (function () {
      try { return sessionStorage.getItem("etc_reschedule_id"); } catch (_) { return null; }
    })();
    if (rid) {
      try { sessionStorage.removeItem("etc_reschedule_id"); } catch (_) {}
      const t = all.find((x) => x.id === rid);
      if (t && !isUsed(t)) setTimeout(() => startReschedule(t), 400);
      else if (t && isUsed(t)) UI.toast("Used tickets cannot be rescheduled");
    }
  }

  loadAndPaint();
})();
