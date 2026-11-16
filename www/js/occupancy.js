// =========================================================
// Live seat occupancy (Firestore + local fallback)
//   • Confirmed tickets (status booked/boarded) → hard occupied
//   • Soft holds while a passenger is picking seats (3 min TTL)
//   • Live listeners so every phone updates when anyone selects / pays
//   • etcBusMap() reads from this cache so the existing seat UI works
// =========================================================
window.ETC_Occupancy = (function () {
  const HOLD_MS = 3 * 60 * 1000; // 3 minutes soft hold
  // cache[routeKey][busNo] = Set of seat ids e.g. "3A"
  const cache = {};
  const listeners = {}; // routeKey → unsubscribe
  const subs = new Set(); // UI callbacks
  let sessionId = null;

  function getSessionId() {
    if (sessionId) return sessionId;
    try {
      sessionId = localStorage.getItem("etc_occ_sid");
      if (!sessionId) {
        sessionId = "s_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        localStorage.setItem("etc_occ_sid", sessionId);
      }
    } catch (_) {
      sessionId = "s_" + Date.now().toString(36);
    }
    return sessionId;
  }

  function stripTerm(s) {
    return String(s || "")
      .replace(/\s+Terminal$/i, "")
      .replace(/\s+Park$/i, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function normTime(t) {
    if (t == null || t === "") return "";
    let s = String(t).trim().toUpperCase().replace(/\s+/g, " ");
    // 11:30AM → 11:30 AM
    s = s.replace(/(\d)(AM|PM)$/i, "$1 $2");
    // drop leading zero on hour: 09:00 AM → 9:00 AM (optional both ways)
    const m = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
    if (m) {
      const h = String(+m[1]);
      const mm = m[2];
      const ap = m[3] ? " " + m[3].toUpperCase() : "";
      return h + ":" + mm + ap;
    }
    return s;
  }

  function timesMatch(a, b) {
    if (!a || !b) return true; // missing time = don't filter out
    return normTime(a) === normTime(b);
  }

  function parseRouteKey(routeKey) {
    // "Holy Ghost>Emene@07:30" or "Holy Ghost>Emene"
    const at = String(routeKey || "").indexOf("@");
    const base = at >= 0 ? routeKey.slice(0, at) : routeKey;
    const time = at >= 0 ? routeKey.slice(at + 1) : null;
    const parts = base.split(">");
    return { from: parts[0] || "", to: parts[1] || "", time };
  }

  function today() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function ensureCache(routeKey) {
    if (!cache[routeKey]) cache[routeKey] = {};
    return cache[routeKey];
  }

  function setOccupied(routeKey, busNo, seat, on) {
    if (!seat) return;
    const c = ensureCache(routeKey);
    const b = String(busNo || 1);
    if (!c[b]) c[b] = new Set();
    // Normalize "1:3A" → "3A"
    let seatId = String(seat).trim();
    if (seatId.indexOf(":") >= 0) seatId = seatId.split(":").pop();
    seatId = seatId.toUpperCase();
    if (on) c[b].add(seatId);
    else c[b].delete(seatId);
  }

  function ticketMatchesRoute(t, from, to, time) {
    if (from && stripTerm(t.from) !== stripTerm(from)) return false;
    if (to && t.to && stripTerm(t.to) !== stripTerm(to)) return false;
    if (time && t.time && !timesMatch(t.time, time)) return false;
    return true;
  }

  function seatFromTicket(t) {
    if (!t) return null;
    let seat = t.seat || null;
    if (!seat && t.seatNumbers) {
      const sn = Array.isArray(t.seatNumbers) ? t.seatNumbers[0] : t.seatNumbers;
      if (sn) seat = String(sn).indexOf(":") >= 0 ? String(sn).split(":")[1] : sn;
    }
    if (!seat) return null;
    seat = String(seat).trim();
    if (seat.indexOf(":") >= 0) seat = seat.split(":").pop();
    return seat.toUpperCase();
  }

  function busFromTicket(t) {
    if (t.busNo != null) return +t.busNo;
    if (t.bus != null) return +t.bus;
    if (t.seat && String(t.seat).indexOf(":") >= 0) return +String(t.seat).split(":")[0] || 1;
    return 1;
  }

  function rebuildFromDocs(routeKey, ticketDocs, holdDocs) {
    const c = ensureCache(routeKey);
    Object.keys(c).forEach((k) => { c[k] = new Set(); });
    (ticketDocs || []).forEach((t) => {
      const seat = seatFromTicket(t);
      if (!seat) return;
      const st = String(t.status || "booked").toLowerCase();
      if (st === "void" || st === "cancelled") return;
      // noshow loses seat; boarded/booked keep it
      if (st === "noshow") return;
      setOccupied(routeKey, busFromTicket(t), seat, true);
    });
    const now = Date.now();
    (holdDocs || []).forEach((h) => {
      if (h.expiresAt && h.expiresAt < now) return;
      if (h.sessionId === getSessionId()) return;
      if (!h.seat) return;
      setOccupied(routeKey, h.bus || 1, h.seat, true);
    });
    emit(routeKey);
  }

  function emit(routeKey) {
    subs.forEach((fn) => {
      try { fn(routeKey, cache[routeKey] || {}); } catch (e) { console.error(e); }
    });
  }

  function onChange(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  }

  function busMap(routeKey, n) {
    const rows = 8, cols = ["A", "B", "C", "D"];
    const all = [];
    for (let r = 1; r <= rows; r++) cols.forEach((c) => all.push(r + c));
    const c = ensureCache(routeKey);
    const occupied = new Set(c[String(n)] ? [...c[String(n)]] : []);
    return { n, all, occupied, free: all.length - occupied.size };
  }

  /** Merge local device tickets into occupancy (works offline / before cloud catches up). */
  async function mergeLocalTickets(routeKey, travelDate) {
    try {
      if (!window.ETC_Store || !window.ETC_Store.listTickets) return [];
      const { from, to, time } = parseRouteKey(routeKey);
      const day = travelDate || today();
      const all = await window.ETC_Store.listTickets();
      return (all || []).filter((t) => {
        if ((t.date || "") !== day) return false;
        if (!ticketMatchesRoute(t, from, to, time)) return false;
        const st = String(t.status || "booked").toLowerCase();
        if (st === "void" || st === "cancelled" || st === "noshow") return false;
        return !!seatFromTicket(t);
      });
    } catch (_) {
      return [];
    }
  }

  async function watch(routeKey, travelDate) {
    if (!window.ETC_FB || !window.ETC_FB.db) {
      // offline: still apply local tickets
      const local = await mergeLocalTickets(routeKey, travelDate);
      rebuildFromDocs(routeKey, local, []);
      return () => {};
    }
    if (listeners[routeKey]) return listeners[routeKey];

    const { from, to, time } = parseRouteKey(routeKey);
    const day = travelDate || today();
    let unsubTickets = null, unsubHolds = null;
    let tickets = [], holds = [];

    const apply = async () => {
      const local = await mergeLocalTickets(routeKey, day);
      const byId = {};
      local.forEach((t) => { byId[t.id || (t.reference + "-" + t.index)] = t; });
      tickets.forEach((t) => { byId[t.id || (t.reference + "-" + t.index)] = t; });
      rebuildFromDocs(routeKey, Object.values(byId), holds);
    };

    try {
      await window.ETC_FB.ensureAuth();
      const db = window.ETC_FB.db;

      unsubTickets = db.collection("tickets")
        .where("date", "==", day)
        .onSnapshot((snap) => {
          tickets = [];
          snap.forEach((doc) => {
            const t = Object.assign({ id: doc.id }, doc.data());
            if (!ticketMatchesRoute(t, from, to, time)) return;
            tickets.push(t);
          });
          apply();
        }, (e) => console.warn("[ETC occ] tickets watch:", e));

      unsubHolds = db.collection("holds")
        .where("day", "==", day)
        .onSnapshot((snap) => {
          holds = [];
          const now = Date.now();
          snap.forEach((doc) => {
            const h = doc.data();
            if (from && h.from && stripTerm(h.from) !== stripTerm(from)) return;
            if (to && h.to && stripTerm(h.to) !== stripTerm(to)) return;
            if (time && h.time && !timesMatch(h.time, time)) return;
            if (h.expiresAt && h.expiresAt < now) return;
            holds.push(h);
          });
          apply();
        }, (e) => console.warn("[ETC occ] holds watch:", e));
    } catch (e) {
      console.warn("[ETC occ] watch failed:", e);
      const local = await mergeLocalTickets(routeKey, day);
      rebuildFromDocs(routeKey, local, []);
    }

    // Seed immediately from local while cloud loads
    apply();

    const stop = () => {
      try { if (unsubTickets) unsubTickets(); } catch (_) {}
      try { if (unsubHolds) unsubHolds(); } catch (_) {}
      delete listeners[routeKey];
    };
    listeners[routeKey] = stop;
    return stop;
  }

  function unwatch(routeKey) {
    if (listeners[routeKey]) {
      listeners[routeKey]();
      delete listeners[routeKey];
    }
  }

  async function holdSeat(routeKey, busNo, seat, travelDate) {
    const { from, to, time } = parseRouteKey(routeKey);
    const day = travelDate || today();
    let seatId = String(seat || "").trim();
    if (seatId.indexOf(":") >= 0) seatId = seatId.split(":").pop();
    seatId = seatId.toUpperCase();
    // Local immediately — never block seat picker or payment
    const cmap = busMap(routeKey, busNo);
    if (cmap.occupied.has(seatId)) {
      return { ok: false, reason: "taken" };
    }
    setOccupied(routeKey, busNo, seatId, true);

    // Soft cloud hold is best-effort only (no passenger name/ticket — just seat lock)
    // Real ticket docs are written ONLY after payment in ETC_Tickets.issue → uploadTickets
    const id = [day, stripTerm(from), stripTerm(to), busNo, seatId].join("_").replace(/\s+/g, "");
    if (window.ETC_FB && window.ETC_FB.db) {
      (async function () {
        try {
          await Promise.race([
            window.ETC_FB.ensureAuth(),
            new Promise(function (_, rej) { setTimeout(function () { rej(new Error("auth-timeout")); }, 1500); }),
          ]);
          const db = window.ETC_FB.db;
          const ref = db.collection("holds").doc(id);
          const snap = await Promise.race([
            ref.get(),
            new Promise(function (_, rej) { setTimeout(function () { rej(new Error("get-timeout")); }, 1500); }),
          ]);
          if (snap && snap.exists) {
            const h = snap.data();
            if (h.sessionId !== getSessionId() && h.expiresAt > Date.now()) {
              // Someone else holds it — mark taken locally
              setOccupied(routeKey, busNo, seatId, true);
              return;
            }
          }
          await ref.set({
            day: day,
            from: stripTerm(from),
            to: stripTerm(to),
            time: time || null,
            bus: +busNo,
            seat: seatId,
            sessionId: getSessionId(),
            expiresAt: Date.now() + HOLD_MS,
            createdAt: Date.now(),
            // Explicitly NO passenger name / ticket id before payment
          });
        } catch (_) { /* local hold still valid */ }
      })();
    }
    return { ok: true };
  }

  async function releaseSeat(routeKey, busNo, seat, travelDate) {
    const { from, to } = parseRouteKey(routeKey);
    const day = travelDate || today();
    let seatId = String(seat || "").trim();
    if (seatId.indexOf(":") >= 0) seatId = seatId.split(":").pop();
    seatId = seatId.toUpperCase();
    const id = [day, stripTerm(from), stripTerm(to), busNo, seatId].join("_").replace(/\s+/g, "");
    try {
      if (window.ETC_FB && window.ETC_FB.db) {
        await window.ETC_FB.ensureAuth();
        await window.ETC_FB.db.collection("holds").doc(id).delete();
      }
    } catch (_) {}
    // Do not clear if a real ticket owns the seat
  }

  async function releaseAllForSession(routeKey, travelDate) {
    if (!window.ETC_FB || !window.ETC_FB.db) return;
    try {
      await window.ETC_FB.ensureAuth();
      const day = travelDate || today();
      const sid = getSessionId();
      const snap = await window.ETC_FB.db.collection("holds").where("day", "==", day).where("sessionId", "==", sid).get();
      const batch = window.ETC_FB.db.batch();
      snap.forEach((doc) => batch.delete(doc.ref));
      if (!snap.empty) await batch.commit();
    } catch (e) {
      console.warn("[ETC occ] releaseAll", e);
    }
  }

  async function preload(routeKey, travelDate) {
    const { from, to, time } = parseRouteKey(routeKey);
    const day = travelDate || today();
    let tickets = await mergeLocalTickets(routeKey, day);
    if (window.ETC_FB && window.ETC_FB.db) {
      try {
        await Promise.race([
          window.ETC_FB.ensureAuth(),
          new Promise(function (_, rej) { setTimeout(function () { rej(new Error("auth-timeout")); }, 2500); }),
        ]).catch(function () {});
        const snap = await Promise.race([
          window.ETC_FB.db.collection("tickets").where("date", "==", day).limit(300).get(),
          new Promise(function (_, rej) { setTimeout(function () { rej(new Error("query-timeout")); }, 4000); }),
        ]);
        const byId = {};
        tickets.forEach((t) => { byId[t.id || (t.reference + "-" + t.index)] = t; });
        snap.forEach((doc) => {
          const t = Object.assign({ id: doc.id }, doc.data());
          // Match route; if time missing on either side, still include
          if (!ticketMatchesRoute(t, from, to, time)) return;
          byId[t.id || doc.id] = t;
        });
        tickets = Object.values(byId);
      } catch (e) {
        console.warn("[ETC occ] preload:", e);
      }
    }
    rebuildFromDocs(routeKey, tickets, []);
    // Also populate cache key without @time so book seat UI always sees them
    if (time) {
      const base = from + ">" + to;
      rebuildFromDocs(base, tickets, []);
    }
    return busMap(routeKey, 1);
  }

  /** Immediately mark seats occupied (call right after successful booking). */
  function markSeatsTaken(routeKey, seatKeys) {
    // seatKeys: ["1:3A", "1:3B"] or ["3A"]
    (seatKeys || []).forEach((k) => {
      const s = String(k);
      if (s.indexOf(":") >= 0) {
        const [bus, seat] = s.split(":");
        setOccupied(routeKey, bus, seat, true);
      } else {
        setOccupied(routeKey, 1, s, true);
      }
    });
    emit(routeKey);
  }

  return {
    busMap,
    watch,
    unwatch,
    holdSeat,
    releaseSeat,
    releaseAllForSession,
    preload,
    onChange,
    getSessionId,
    markSeatsTaken,
    setOccupied,
  };
})();

// Override global etcBusMap so seats.js / book.js pick up live data
window.etcBusMap = function (routeKey, n) {
  if (window.ETC_Occupancy) return window.ETC_Occupancy.busMap(routeKey, n);
  const rows = 8, cols = ["A", "B", "C", "D"];
  const all = [];
  for (let r = 1; r <= rows; r++) cols.forEach((c) => all.push(r + c));
  return { n, all, occupied: new Set(), free: all.length };
};
