// =========================================================
// Calendar overlay (home → calendar chip)
//   • navy seal on top = today, or the date you pick
//   • swipe left / double-tap right side  → next month
//   • swipe right / double-tap left side  → previous month
//   • month change turns the page up / down like a wall calendar
//   • slide the year to change it; HOLD the year for the 2010–2040 picker
//     (the calendar rips off, the year sheet drops in)
// The chosen date is kept in localStorage["etc_travel_date"] (YYYY-MM-DD).
// =========================================================
(function () {
  const btn = document.getElementById("calBtn");
  if (!btn) return;

  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const WD = ["M", "T", "W", "T", "F", "S", "S"];
  const Y0 = 2010, Y1 = 2040, KEY = "etc_travel_date";

  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const load = () => { try { const v = localStorage.getItem(KEY); if (v) { const [y, m, d] = v.split("-").map(Number); const dt = new Date(y, m - 1, d); if (!isNaN(dt)) return dt; } } catch (_) {} return null; };
  let sel = load() || today;
  let view = { y: sel.getFullYear(), m: sel.getMonth() };
  let busy = false;

  // ---------- DOM ----------
  const ov = document.createElement("div");
  ov.className = "ov cal-ov";
  ov.setAttribute("aria-hidden", "true");
  ov.innerHTML = `
    <div class="cal-stack">
      <div class="cal-card" id="calCard" role="dialog" aria-label="Calendar">
        <div class="cal-seal" id="calSeal">
          <div class="big"></div>
          <div><div class="wd"></div><div class="my"></div></div>
          <button type="button" class="cal-close" id="calClose" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
        </div>
        <div class="cal-sheet" id="calSheet"></div>
        <p class="cal-hint">Swipe or double-tap sides · hold year · long-press a date for alarm</p>
      </div>
      <div class="cal-card hidden" id="yrCard" role="dialog" aria-label="Choose year">
        <div class="yr-head"><div><h3>Choose year</h3><p>${Y0} – ${Y1}</p></div>
          <button type="button" class="ov-close" id="yrClose" aria-label="Back to calendar" style="position:static"><svg class="ico" width="16" height="16" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
        <div class="yr-grid" id="yrGrid"></div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const $ = (id) => ov.querySelector("#" + id);
  const calCard = $("calCard"), yrCard = $("yrCard"), sheet = $("calSheet"), seal = $("calSeal");

  // ---------- seal ----------
  function paintSeal(bump) {
    seal.querySelector(".big").textContent = sel.getDate();
    seal.querySelector(".wd").textContent = DAYS[sel.getDay()] + (same(sel, today) ? " · Today" : "");
    seal.querySelector(".my").textContent = `${MONTHS[sel.getMonth()]} ${sel.getFullYear()}`;
    if (bump) { seal.classList.remove("bump"); void seal.offsetWidth; seal.classList.add("bump"); }
  }

  // ---------- pages ----------
  function pageEl(y, m, yearAnim) {
    const first = new Date(y, m, 1), off = (first.getDay() + 6) % 7;
    let cells = "";
    for (let i = 0; i < 42; i++) {
      const d = new Date(y, m, 1 - off + i);
      const cls = ["cal-day"];
      if (d.getMonth() !== m) cls.push("out");
      if (same(d, today)) cls.push("today");
      if (same(d, sel)) cls.push("sel");
      cells += `<div class="${cls.join(" ")}" data-d="${iso(d)}"><b>${d.getDate()}</b></div>`;
    }
    const el = document.createElement("div");
    el.className = "cal-page";
    el.dataset.y = y; el.dataset.m = m;
    el.innerHTML = `<div class="cal-head"><div class="cal-month">${MONTHS[m]}</div>
      <button type="button" class="cal-year" aria-label="Year ${y}. Slide to change, hold for all years"><span class="fill"></span><span class="n ${yearAnim || ""}">${y}</span></button></div>
      <div class="cal-wd">${WD.map((w) => `<span>${w}</span>`).join("")}</div><div class="cal-grid">${cells}</div>`;
    return el;
  }
  function show(y, m, dir, yearAnim) {
    view = { y, m };
    const old = sheet.querySelector(".cal-page");
    const fresh = pageEl(y, m, yearAnim);
    if (!old || !dir || busy) { sheet.innerHTML = ""; sheet.appendChild(fresh); return; }
    busy = true;
    const done = () => { old.remove(); fresh.classList.remove("under", "flip-down"); busy = false; };
    if (dir > 0) {                           // next: current page turns up and away
      fresh.classList.add("under"); sheet.appendChild(fresh); old.classList.add("flip-up");
      setTimeout(done, 620);
    } else {                                 // previous: the earlier page turns back down
      old.classList.add("under"); fresh.classList.add("flip-down"); sheet.appendChild(fresh);
      setTimeout(done, 620);
    }
  }
  const step = (dir) => {
    if (busy) return;
    let m = view.m + dir, y = view.y;
    if (m > 11) { m = 0; y++; } if (m < 0) { m = 11; y--; }
    if (y < Y0 || y > Y1) return;
    show(y, m, dir);
  };
  const stepYear = (dir) => {
    if (busy) return;
    const y = view.y + dir;
    if (y < Y0 || y > Y1) return;
    show(y, view.m, dir, dir > 0 ? "slide-l" : "slide-r");
  };

  function pick(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    setSel(new Date(y, m - 1, d), true);
    if (m - 1 !== view.m || y !== view.y) show(y, m - 1, (y * 12 + m - 1) > (view.y * 12 + view.m) ? 1 : -1);
    else markSel();
  }
  function setSel(d, bump) {
    sel = d;
    try { localStorage.setItem(KEY, iso(d)); } catch (_) {}
    paintSeal(bump); markSel();
  }
  function markSel() {
    sheet.querySelectorAll(".cal-day").forEach((c) => c.classList.toggle("sel", c.dataset.d === iso(sel)));
  }

  // ---------- alarm overlay (long-press a date) ----------
  const ALARM_KEY = "etc_alarms";
  const alarmOv = document.createElement("div");
  alarmOv.className = "ov alarm-ov";
  alarmOv.setAttribute("aria-hidden", "true");
  alarmOv.innerHTML = `
    <div class="alarm-card glass-card" role="dialog" aria-label="Set reminder">
      <button type="button" class="ov-close" id="alarmClose" aria-label="Close"><svg class="ico" width="16" height="16" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      <div class="alarm-date" id="alarmDateLabel"></div>
      <p class="alarm-sub">Set a reminder for this travel day</p>
      <label class="alarm-field">
        <span>Time</span>
        <input type="time" id="alarmTime" value="07:00" />
      </label>
      <label class="alarm-field">
        <span>Note (optional)</span>
        <input type="text" id="alarmNote" placeholder="e.g. Holy Ghost → Emene" maxlength="60" />
      </label>
      <div class="alarm-actions">
        <button type="button" class="alarm-btn secondary" id="alarmNotif">Notification only</button>
        <button type="button" class="alarm-btn primary" id="alarmSet">Set alarm</button>
      </div>
      <p class="alarm-hint">Web alarms work best when the app is open or installed as PWA. Background ringing is limited by the browser.</p>
    </div>`;
  document.body.appendChild(alarmOv);
  let alarmDateStr = null;

  function openAlarm(dateStr) {
    alarmDateStr = dateStr;
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    alarmOv.querySelector("#alarmDateLabel").textContent = `${DAYS[dt.getDay()]}, ${MONTHS[m - 1]} ${d}, ${y}`;
    alarmOv.querySelector("#alarmTime").value = "07:00";
    alarmOv.querySelector("#alarmNote").value = "";
    alarmOv.classList.add("show");
    alarmOv.setAttribute("aria-hidden", "false");
  }
  function closeAlarm() {
    alarmOv.classList.remove("show");
    alarmOv.setAttribute("aria-hidden", "true");
    alarmDateStr = null;
  }
  alarmOv.querySelector("#alarmClose").addEventListener("click", closeAlarm);
  alarmOv.addEventListener("click", (e) => { if (e.target === alarmOv) closeAlarm(); });

  function saveAlarm(kind) {
    if (!alarmDateStr) return;
    const time = alarmOv.querySelector("#alarmTime").value || "07:00";
    const note = (alarmOv.querySelector("#alarmNote").value || "").trim();
    const id = `${alarmDateStr}T${time}`;
    let list = [];
    try { list = JSON.parse(localStorage.getItem(ALARM_KEY)) || []; } catch (_) {}
    list = list.filter((a) => a.id !== id);
    list.push({ id, date: alarmDateStr, time, note, kind, created: Date.now() });
    try { localStorage.setItem(ALARM_KEY, JSON.stringify(list)); } catch (_) {}
    // TWA: hand the alarm to the phone's own alarm system so it rings with the app closed (needs this tap)
    try { if (window.ETC_NativeAlarm) window.ETC_NativeAlarm.sync(true); } catch (_) {}
    // Request notification permission & schedule check
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
    scheduleAlarmChecks();
    closeAlarm();
    // brief toast if available
    const toast = document.getElementById("toast");
    if (toast) {
      toast.textContent = kind === "alarm" ? "Alarm saved" : "Notification saved";
      toast.classList.add("show");
      setTimeout(() => toast.classList.remove("show"), 1600);
    }
  }
  alarmOv.querySelector("#alarmSet").addEventListener("click", () => saveAlarm("alarm"));
  alarmOv.querySelector("#alarmNotif").addEventListener("click", () => saveAlarm("notif"));

  // Simple scheduler: check every 30s while page is open; also on focus
  function playAlarmTone(kind) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const beep = (t0, freq, dur) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = freq;
        g.gain.value = 0.0001;
        o.connect(g); g.connect(ctx.destination);
        g.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.start(t0); o.stop(t0 + dur + 0.02);
      };
      const t = ctx.currentTime;
      if (kind === "alarm") {
        beep(t, 880, 0.25); beep(t + 0.3, 880, 0.25); beep(t + 0.6, 988, 0.4);
      } else {
        beep(t, 660, 0.2); beep(t + 0.25, 880, 0.3);
      }
      setTimeout(() => { try { ctx.close(); } catch (_) {} }, 1500);
    } catch (_) {}
  }

  function showAlarmOverlay(a) {
    const title = a.kind === "alarm" ? "Alarm" : "Reminder";
    const body = a.note || ("Travel day " + a.date + " at " + a.time);
    // Prefer UI overlay
    if (window.ETC_UI && window.ETC_UI.overlay) {
      try {
        const ov = window.ETC_UI.overlay(
          '<div class="ov-card dlg-card" role="alertdialog">' +
          '<h3>🚌 ' + title + '</h3>' +
          '<p style="margin:8px 0 16px;font-size:15px;line-height:1.4">' + body + '</p>' +
          '<button type="button" class="ov-btn" data-close>Dismiss</button></div>',
          { sticky: true }
        );
        return;
      } catch (_) {}
    }
    // Fallback modal
    let el = document.getElementById("etcAlarmRing");
    if (!el) {
      el = document.createElement("div");
      el.id = "etcAlarmRing";
      el.style.cssText = "position:fixed;inset:0;z-index:10000;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:20px";
      document.body.appendChild(el);
    }
    el.innerHTML = '<div style="background:#fff;border-radius:20px;padding:22px 20px;max-width:340px;width:100%;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,.25)">' +
      '<h3 style="margin:0 0 8px;font:800 18px system-ui">🚌 ' + title + '</h3>' +
      '<p style="margin:0 0 16px;font:500 14px/1.4 system-ui;color:#334155">' + body + '</p>' +
      '<button type="button" id="etcAlarmDismiss" style="width:100%;height:44px;border:0;border-radius:12px;background:#0f172a;color:#fff;font:700 14px system-ui">Dismiss</button></div>';
    el.style.display = "flex";
    el.querySelector("#etcAlarmDismiss").onclick = function () { el.style.display = "none"; };
  }

  function fireAlarm(a) {
    // TWA: the phone already rings this one (sound, vibration, notification) – only show the in-app card
    if (window.ETC_NativeAlarm && window.ETC_NativeAlarm.handles(a.id)) { showAlarmOverlay(a); return; }
    playAlarmTone(a.kind || "notif");
    if (navigator.vibrate) {
      try { navigator.vibrate(a.kind === "alarm" ? [200, 100, 200, 100, 400] : [150, 80, 150]); } catch (_) {}
    }
    const title = a.kind === "alarm" ? "🚌 ETC Alarm" : "🚌 ETC Reminder";
    const body = a.note || ("Travel day: " + a.date + " at " + a.time);
    // Prefer system notification via ETC_Push / Service Worker so it lands in the phone control panel
    if (window.ETC_Push && typeof window.ETC_Push.show === "function") {
      window.ETC_Push.show(title, {
        body: body,
        tag: a.id,
        requireInteraction: a.kind === "alarm",
        vibrate: a.kind === "alarm" ? [200, 100, 200, 100, 400] : [150, 80, 150],
        icon: "/icons/icon-192.png",
        data: { type: a.kind === "alarm" ? "alarm" : "calendar", url: "/?cal=1" }
      });
    } else if ("Notification" in window && Notification.permission === "granted") {
      try {
        new Notification(title, {
          body: body,
          icon: "/icons/icon-192.png",
          tag: a.id,
          requireInteraction: a.kind === "alarm",
        });
      } catch (_) {}
    }
    showAlarmOverlay(a);
  }

  // FIX: single, idempotent scheduler. Calling scheduleAlarmChecks() never stacks timers
  // and never re-enters itself (the old version re-created the interval AND ran tick()
  // every time an alarm was saved, which looped forever with syncDepartureAlarms).
  let alarmTimer = 0;
  let lastDepSync = 0;
  function alarmTick() {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(ALARM_KEY)) || []; } catch (_) {}
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const curDate = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
    const curHM = pad(now.getHours()) + ":" + pad(now.getMinutes());
    const cur = curDate + "T" + curHM;
    const curMins = now.getHours() * 60 + now.getMinutes();
    let changed = false;
    let ringed = 0; // at most one alarm rings per tick so nothing bursts after a long background
    list.forEach((a) => {
      if (a.fired) return;
      if (a.id > cur) return;
      const ad = String(a.id).split("T")[0];
      const at = String(a.id).split("T")[1] || "00:00";
      if (ad < curDate) { a.fired = true; changed = true; return; } // missed on a past day – silent
      if (ad === curDate) {
        const am = (parseInt(at.slice(0, 2), 10) || 0) * 60 + (parseInt(at.slice(3, 5), 10) || 0);
        if (curMins - am > 10) { a.fired = true; changed = true; return; } // stale (e.g. app was backgrounded) – silent
        if (ringed >= 1) return; // ring the rest on the next tick
        a.fired = true;
        changed = true;
        ringed++;
        try { fireAlarm(a); } catch (_) {}
      }
    });
    if (changed) {
      try { localStorage.setItem(ALARM_KEY, JSON.stringify(list)); } catch (_) {}
    }
    // Sync auto pre-departure alarms from tickets – throttled to once a minute
    if (Date.now() - lastDepSync > 60000) {
      lastDepSync = Date.now();
      try { if (window.ETC_Tickets && window.ETC_Tickets.syncDepartureAlarms) window.ETC_Tickets.syncDepartureAlarms(); } catch (_) {}
    }
  }
  function scheduleAlarmChecks() {
    if (!alarmTimer) alarmTimer = setInterval(function () { if (!document.hidden) alarmTick(); }, 15000);
    alarmTick();
  }
  scheduleAlarmChecks();
  let lastWake = 0;
  function onWake() {
    // focus + visibilitychange often fire together – only react once
    if (document.hidden || Date.now() - lastWake < 1500) return;
    lastWake = Date.now();
    alarmTick();
  }
  window.addEventListener("focus", onWake);
  document.addEventListener("visibilitychange", onWake);
  // Expose for tickets.js
  window.ETC_CalendarAlarms = {
    save: function (date, time, note, kind) {
      const id = date + "T" + time;
      let list = [];
      try { list = JSON.parse(localStorage.getItem(ALARM_KEY)) || []; } catch (_) {}
      const have = list.find(function (a) { return a.id === id; });
      // FIX: if this alarm already exists, leave it alone – re-saving it used to reset
      // `fired` so the same alarm rang again and again.
      if (have) return;
      list.push({ id: id, date: date, time: time, note: note || "", kind: kind || "notif", created: Date.now(), auto: true });
      try { localStorage.setItem(ALARM_KEY, JSON.stringify(list)); } catch (_) {}
      // FIX: no scheduleAlarmChecks() here – that re-entered syncDepartureAlarms in an endless loop.
    },
    fire: fireAlarm,
    schedule: scheduleAlarmChecks,
  };

  // ---------- gestures ----------
  let g = null, lastTap = { t: 0, x: 0, y: 0, prev: null }, longFired = false;
  sheet.addEventListener("pointerdown", (e) => {
    const yr = e.target.closest(".cal-year");
    const cell = e.target.closest(".cal-day");
    g = { x: e.clientX, y: e.clientY, yr: !!yr, cell, btn: yr, timer: 0 };
    longFired = false;
    if (yr) {
      yr.classList.add("holding");
      g.timer = setTimeout(() => { longFired = true; yr.classList.remove("holding"); openYears(); }, 520);
    } else if (cell && !cell.classList.contains("out")) {
      g.timer = setTimeout(() => {
        longFired = true;
        openAlarm(cell.dataset.d);
      }, 520);
    }
  });
  sheet.addEventListener("pointermove", (e) => {
    if (!g || !g.timer) return;
    if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 12) { clearTimeout(g.timer); g.timer = 0; g.btn && g.btn.classList.remove("holding"); }
  });
  const end = (e, cancelled) => {
    if (!g) return;
    clearTimeout(g.timer);
    g.btn && g.btn.classList.remove("holding");
    const dx = e.clientX - g.x, dy = e.clientY - g.y, was = g; g = null;
    if (cancelled || longFired) return;
    if (was.yr) { if (Math.abs(dx) > 26 && Math.abs(dx) > Math.abs(dy)) stepYear(dx < 0 ? 1 : -1); return; }
    if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.3) { step(dx < 0 ? 1 : -1); return; }   // swipe
    if (Math.hypot(dx, dy) > 12) return;
    // tap / double-tap
    const now = Date.now();
    if (now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 46) {
      if (lastTap.prev) setSel(lastTap.prev, false);         // the first tap only "picked" a date – undo it
      const r = sheet.getBoundingClientRect();
      step(e.clientX > r.left + r.width / 2 ? 1 : -1);
      lastTap.t = 0; return;
    }
    lastTap = { t: now, x: e.clientX, y: e.clientY, prev: sel };
    if (was.cell) pick(was.cell.dataset.d);
  };
  sheet.addEventListener("pointerup", (e) => end(e, false));
  sheet.addEventListener("pointercancel", (e) => end(e, true));
  sheet.addEventListener("contextmenu", (e) => e.preventDefault());

  // ---------- year picker + tearing animation ----------
  function zig() {
    const n = 22, pts = ["0% 1.4%"];
    for (let i = 1; i < n; i++) pts.push(`${(i / n * 100).toFixed(1)}% ${(i % 2 ? 0.2 + Math.random() * 0.6 : 2 + Math.random() * 1.6).toFixed(2)}%`);
    pts.push("100% 1.4%", "100% 100%", "0% 100%");
    return `polygon(${pts.join(",")})`;
  }
  function swap(from, to) {
    from.style.clipPath = zig();
    from.classList.add("rip-out");
    to.classList.remove("hidden"); to.classList.add("rip-in");
    setTimeout(() => {
      from.classList.add("hidden"); from.classList.remove("rip-out"); from.style.clipPath = "";
      to.classList.remove("rip-in");
    }, 780);
  }
  const grid = $("yrGrid");
  function buildYears() {
    let h = "";
    for (let y = Y0; y <= Y1; y++) h += `<button type="button" data-y="${y}" class="${y === view.y ? "sel" : ""} ${y === today.getFullYear() ? "now" : ""}">${y}</button>`;
    grid.innerHTML = h;
  }
  function openYears() { buildYears(); swap(calCard, yrCard); }
  grid.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-y]"); if (!b) return;
    show(+b.dataset.y, view.m, 0);
    swap(yrCard, calCard);
  });
  $("yrClose").addEventListener("click", () => swap(yrCard, calCard));

  // ---------- open / close ----------
  function open() {
    view = { y: sel.getFullYear(), m: sel.getMonth() };
    calCard.classList.remove("hidden"); yrCard.classList.add("hidden");
    busy = false; sheet.innerHTML = "";
    paintSeal(false); show(view.y, view.m, 0);
    ov.classList.add("show"); ov.setAttribute("aria-hidden", "false");
  }
  function close() { ov.classList.remove("show"); ov.setAttribute("aria-hidden", "true"); }
  btn.addEventListener("click", open);
  $("calClose").addEventListener("click", close);
  let downOn = null;   // only a press that STARTED on the glass closes it (a long-press release must not)
  ov.addEventListener("pointerdown", (e) => { downOn = e.target; });
  ov.addEventListener("click", (e) => { if (e.target === ov && downOn === ov) close(); });
  document.addEventListener("keydown", (e) => {
    if (!ov.classList.contains("show")) return;
    if (e.key === "Escape") close();
    if (e.key === "ArrowRight") step(1);
    if (e.key === "ArrowLeft") step(-1);
  });
})();

/* Tapped alarm / notification asks for the calendar (?cal=1) */
(function () {
  try {
    if (!/[?&]cal=1/.test(location.search)) return;
    var t = 0, iv = setInterval(function () {
      var b = document.getElementById("calBtn");
      if (b || ++t > 30) { clearInterval(iv); if (b) b.click(); }
    }, 200);
  } catch (_) {}
})();
