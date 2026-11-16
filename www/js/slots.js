// =========================================================
// Departure date + sessions + time slots
// =========================================================
window.ETC_SESSIONS = [
  {
    id: "morning", name: "Morning", tag: "Peak commute", icon: "sunrise",
    slots: [
      "06:00 AM", "06:30 AM", "07:00 AM", "07:30 AM",
      "08:00 AM", "08:30 AM", "09:00 AM", "09:30 AM",
      "10:00 AM", "10:30 AM", "11:00 AM", "11:30 AM",
    ],
  },
  {
    id: "afternoon", name: "Afternoon", tag: "Mid-day", icon: "sun",
    slots: [
      "12:00 PM", "12:30 PM", "01:00 PM", "01:30 PM",
      "02:00 PM", "02:30 PM", "03:00 PM", "03:30 PM",
    ],
  },
  {
    id: "evening", name: "Evening / Night", tag: "Return peak", icon: "moon",
    slots: [
      "04:00 PM", "04:30 PM", "05:00 PM", "05:30 PM",
      "06:00 PM", "06:30 PM", "07:00 PM", "07:30 PM",
      "08:00 PM", "08:30 PM", "09:00 PM",
    ],
  },
];

window.ETC_Slots = (function () {
  const UI = window.ETC_UI, ICON = window.ETC_ICONS, S = window.ETC_SESSIONS;

  function find(time) {
    if (!time) return null;
    const t = String(time).trim().toUpperCase();
    for (const s of S) {
      const hit = s.slots.find((x) => x === t);
      if (hit) return { time: hit, session: s.id, sessionName: s.name, short: s.name.split(" ")[0] };
    }
    return null;
  }

  function listTimes() {
    // Ordered departure labels used across sessions
    const out = [];
    const seen = new Set();
    try {
      const sessions = [
        ["06:00 AM","06:30 AM","07:00 AM","07:30 AM","08:00 AM","08:30 AM","09:00 AM","09:30 AM","10:00 AM","10:30 AM","11:00 AM","11:30 AM"],
        ["12:00 PM","12:30 PM","01:00 PM","01:30 PM","02:00 PM","02:30 PM","03:00 PM","03:30 PM","04:00 PM","04:30 PM","05:00 PM","05:30 PM"],
        ["06:00 PM","06:30 PM","07:00 PM","07:30 PM","08:00 PM","08:30 PM","09:00 PM"],
      ];
      sessions.forEach((arr) => arr.forEach((t) => { if (!seen.has(t)) { seen.add(t); out.push(t); } }));
    } catch (_) {}
    return out;
  }
  function minutes(time) {
    const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(time || "");
    if (!m) return 0;
    let h = +m[1] % 12; if (m[3].toUpperCase() === "PM") h += 12;
    return h * 60 + +m[2];
  }

  function todayISO() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function maxISO() {
    const d = new Date();
    d.setMonth(d.getMonth() + 4);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function nowMinutes() {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }

  function fmtDateLabel(iso) {
    if (!iso) return "Any date";
    const d = new Date(iso + "T12:00:00");
    if (isNaN(d)) return iso;
    const t = todayISO();
    if (iso === t) return "Today · " + d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const tom = new Date(); tom.setDate(tom.getDate() + 1);
    const tomIso = tom.getFullYear() + "-" + String(tom.getMonth() + 1).padStart(2, "0") + "-" + String(tom.getDate()).padStart(2, "0");
    if (iso === tomIso) return "Tomorrow · " + d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  }

  function upcomingDays(n) {
    const out = [];
    const base = new Date();
    base.setHours(12, 0, 0, 0);
    for (let i = 0; i < n; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      out.push(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"));
    }
    return out;
  }

  /** Is this slot still bookable for the given travel date? */
  function slotStatus(time, dateIso) {
    if (!dateIso || dateIso !== todayISO()) return { ok: true };
    const slotMin = minutes(time);
    const now = nowMinutes();
    // Fully in the past (more than 20 min ago) → blocked
    if (slotMin + 20 < now) return { ok: false, reason: "past" };
    // Within 20 min after departure → grace (agent may still be boarding)
    if (slotMin < now) return { ok: true, grace: true, lateBy: now - slotMin };
    return { ok: true };
  }

  async function isBusClosed(from, to, dateIso, time) {
    if (!window.ETC_FB || !window.ETC_FB.db || !dateIso || !time) return false;
    try {
      await window.ETC_FB.ensureAuth();
      const db = window.ETC_FB.db;
      const strip = (s) => String(s || "").replace(/\s+Terminal$/i, "").trim();
      const snap = await db.collection("buses")
        .where("date", "==", dateIso)
        .limit(40)
        .get();
      let closed = false;
      snap.forEach((doc) => {
        const b = doc.data();
        if (strip(b.from) !== strip(from)) return;
        if (to && strip(b.to) !== strip(to)) return;
        if (b.time && b.time !== time) return;
        if (b.status === "closed") closed = true;
      });
      return closed;
    } catch (_) { return false; }
  }

  async function isAgentActiveAt(terminal) {
    // Strict: only true when an agent for this terminal was seen recently
    if (!window.ETC_FB || !window.ETC_FB.db) return false;
    try {
      await window.ETC_FB.ensureAuth();
      const strip = (s) => String(s || "").replace(/\s+Terminal$/i, "").trim().toLowerCase();
      const want = strip(terminal);
      if (!want) return false;
      const db = window.ETC_FB.db;
      const cutoff = Date.now() - 45 * 60 * 1000; // 45 min
      let active = false;
      const snap = await db.collection("agents").limit(50).get();
      snap.forEach((doc) => {
        const a = doc.data();
        if (strip(a.terminal || a.terminalName || "") !== want) return;
        if (a.active === false && a.onShift === false && a.online === false) return;
        const last = (a.lastSeenAt && a.lastSeenAt.toMillis && a.lastSeenAt.toMillis())
          || (a.lastLoginAt && a.lastLoginAt.toMillis && a.lastLoginAt.toMillis())
          || (typeof a.lastSeenAt === "number" ? a.lastSeenAt : 0)
          || (typeof a.lastLoginAt === "number" ? a.lastLoginAt : 0)
          || 0;
        if (last >= cutoff || a.active === true || a.onShift === true || a.online === true) {
          if (last >= cutoff || a.onShift === true || a.online === true) active = true;
        }
      });
      return active;
    } catch (e) {
      console.warn("[ETC agent check]", e);
      return false;
    }
  }

  function openDate(o) {
    o = o || {};
    const days = upcomingDays(o.days || 14);
    let picked = o.selected || todayISO();
    if (days.indexOf(picked) < 0) picked = days[0];

    const chips = days.map((iso) => {
      const d = new Date(iso + "T12:00:00");
      const wd = d.toLocaleDateString("en-GB", { weekday: "short" });
      const dm = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
      return `<button type="button" class="slot-chip date-chip${iso === picked ? " on" : ""}" data-date="${iso}"><b>${wd}</b><span>${dm}</span></button>`;
    }).join("");

    const ui = UI.overlay(`
      <div class="ov-card slot-card slot-card-tight" role="dialog" aria-label="Choose travel date">
        <div class="slot-top-actions">
          <button type="button" class="slot-cal-btn" id="calPick" aria-label="Open calendar">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><circle cx="16.5" cy="15.5" r="1.6" fill="currentColor" stroke="none"/></svg>
          </button>
          <button class="ov-close slot-close-inline" data-close aria-label="Close">${UI.X}</button>
        </div>
        <h3 class="ov-title">Choose travel date</h3>
        <p class="ov-sub">${o.from && o.to ? UI.esc(o.from) + " → " + UI.esc(o.to) : "When are you travelling?"}</p>
        <input type="date" id="calNative" min="${todayISO()}" max="${maxISO()}" value="${picked}" style="position:absolute;opacity:0;width:0;height:0;pointer-events:none" />
        <div class="slot-date-grid">${chips}</div>
        <div class="slot-foot-stack">
          <button type="button" class="ov-btn" id="dateGo">Continue · ${UI.esc(fmtDateLabel(picked))}</button>
          <button type="button" class="ov-btn ghost full" id="dateAny">Any date</button>
        </div>
      </div>`, { sticky: true, cls: "sheet-ov" });

    const el = ui.el;
    const go = el.querySelector("#dateGo");
    const native = el.querySelector("#calNative");
    function paint() {
      el.querySelectorAll(".date-chip").forEach((b) => b.classList.toggle("on", b.dataset.date === picked));
      go.textContent = "Continue · " + fmtDateLabel(picked);
      if (native) native.value = picked;
    }
    el.addEventListener("click", (e) => {
      const b = e.target.closest(".date-chip");
      if (!b) return;
      picked = b.dataset.date;
      paint();
    });
    el.querySelector("#calPick").onclick = () => {
      try { native.showPicker(); } catch (_) { native.click(); }
    };
    native.addEventListener("change", () => {
      if (native.value && native.value >= todayISO() && native.value <= maxISO()) {
        picked = native.value;
        paint();
      }
    });
    el.querySelector("#dateAny").onclick = () => {
      try { localStorage.removeItem("etc_travel_date"); } catch (_) {}
      ui.close();
      setTimeout(() => o.onPick && o.onPick(null), 180);
    };
    go.onclick = () => {
      try { localStorage.setItem("etc_travel_date", picked); } catch (_) {}
      ui.close();
      setTimeout(() => o.onPick && o.onPick(picked), 180);
    };
    paint();
    return ui;
  }

  function open(o) {
    let picked = find(o.selected);
    const dateIso = o.date || null;

    // Filter / mark past slots for today
    function chipHtml(t) {
      const st = slotStatus(t, dateIso);
      if (!st.ok) {
        return `<button type="button" class="slot-chip off" disabled data-time="${t}" title="Already passed">${t}</button>`;
      }
      return `<button type="button" class="slot-chip" data-time="${t}">${t}</button>`;
    }

    const html = `
      <div class="ov-card slot-card slot-card-tight" role="dialog" aria-label="Choose departure time">
        <button class="ov-close" data-close aria-label="Close">${UI.X}</button>
        <h3 class="ov-title">Choose departure time</h3>
        <p class="ov-sub">${o.from && o.to ? UI.esc(o.from) + " → " + UI.esc(o.to) : ""}${o.dateLabel ? " · " + UI.esc(o.dateLabel) : ""}</p>
        ${S.map((s) => `
          <div class="slot-block-sm">
            <div class="slot-head-sm">
              <span class="slot-ico-sm">${ICON[s.icon] || ""}</span>
              <b>${UI.esc(s.name)}</b>
              <em>${UI.esc(s.tag)}</em>
            </div>
            <div class="slot-chips">
              ${s.slots.map(chipHtml).join("")}
            </div>
          </div>`).join("")}
        <div class="slot-foot-stack">
          <button type="button" class="ov-btn" id="slotGo">${o.allowSkip !== false ? "Any time" : (o.cta || "Proceed")}</button>
        </div>
      </div>`;
    const ui = UI.overlay(html, { sticky: true, cls: "sheet-ov" });
    const el = ui.el, go = el.querySelector("#slotGo");

    function paintGo() {
      if (picked) {
        go.textContent = o.cta || "Proceed";
        go.classList.remove("ghost");
        go.disabled = false;
      } else if (o.allowSkip !== false) {
        go.textContent = "Any time";
        go.classList.remove("ghost");
        go.disabled = false;
      } else {
        go.textContent = o.cta || "Proceed";
        go.disabled = true;
      }
      el.querySelectorAll(".slot-chip[data-time]:not(.off)").forEach((b) => {
        b.classList.toggle("on", !!(picked && b.dataset.time === picked.time));
      });
    }

    el.addEventListener("click", async (e) => {
      const b = e.target.closest(".slot-chip[data-time]:not(.off)");
      if (!b) return;
      const t = b.dataset.time;
      const st = slotStatus(t, dateIso);
      if (!st.ok) {
        UI.toast("That departure has already passed");
        return;
      }
      // Grace window: check if agent closed the bus
      if (st.grace) {
        UI.toast("Checking bus…");
        const closed = await isBusClosed(o.from, o.to, dateIso, t);
        if (closed) {
          UI.toast("This bus is full / already left");
          return;
        }
      }
      // Evening departure (7pm–9pm+) OR booking tonight for today → need active agent
      const eveningSlot = minutes(t) >= 19 * 60;
      const bookingTonight = dateIso === todayISO() && nowMinutes() >= 19 * 60;
      if ((eveningSlot || bookingTonight) && dateIso === todayISO()) {
        UI.toast("Checking agent…");
        const active = await Promise.race([
          isAgentActiveAt(o.from),
          new Promise((r) => setTimeout(() => r(false), 3000)),
        ]);
        if (!active) {
          UI.toast("No agent on duty at this terminal right now");
          return;
        }
      }
      picked = find(t);
      paintGo();
    });

    go.onclick = () => {
      if (!picked && o.allowSkip === false) return;
      const chosen = picked; // null = any time
      ui.close();
      setTimeout(() => o.onProceed && o.onProceed(chosen), 180);
    };
    paintGo();
    return ui;
  }

  function openDateThenTime(o) {
    o = o || {};
    openDate({
      from: o.from, to: o.to, selected: o.date,
      onPick: (date) => {
        if (date == null) {
          if (o.onDone) o.onDone({ date: null, slot: null });
          return;
        }
        open({
          from: o.from, to: o.to,
          title: o.timeTitle || "Choose departure time",
          cta: o.cta || "Proceed",
          allowSkip: o.allowSkip !== false,
          selected: o.selected,
          date: date,
          dateLabel: fmtDateLabel(date),
          onProceed: (slot) => {
            if (o.onDone) o.onDone({ date: date, slot: slot });
          },
        });
      },
    });
  }

  return {
    open, openDate, openDateThenTime, find, minutes, todayISO, fmtDateLabel,
    upcomingDays, maxISO, slotStatus, isBusClosed, isAgentActiveAt, listTimes,
  };
})();
