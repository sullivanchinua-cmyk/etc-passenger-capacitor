// =========================================================
// Ticket issuing (after a successful payment)
//   one ticket (= one QR) per passenger · saved to the local store ·
//   one notification per booking · idempotent by payment reference
//   + upload each ticket to Firestore so agents can verify the TOTP
// =========================================================
window.ETC_Tickets = (function () {
  const S = window.ETC_Store, T = window.ETC_Tokens;

  // booking = { reference, from, to, date, slot:{time,sessionName,session}, names[], seatNumbers["2:3A"], family, amount, method, paidAt, luggageItems, luggageFee, fare, email }
  async function issue(b) {
    // Idempotent: already issued for this payment ref
    try {
      const existing = await Promise.race([
        S.ticketsByRef(b.reference),
        new Promise(function (res) { setTimeout(function () { res([]); }, 1500); }),
      ]);
      if (existing && existing.length) return existing;
    } catch (_) {}

    const now = Date.now(), out = [];
    const names = (b.names && b.names.length) ? b.names : ["Passenger"];
    function timeForBusNo(busNo) {
      const primary = (b.slot && b.slot.time) || null;
      if (!primary || !busNo || +busNo <= 1) return primary;
      try {
        const times = (window.ETC_Slots && window.ETC_Slots.listTimes) ? window.ETC_Slots.listTimes() : [];
        const i0 = times.indexOf(primary);
        if (i0 >= 0 && times[i0 + (+busNo) - 1]) return times[i0 + (+busNo) - 1];
      } catch (_) {}
      return primary;
    }
    const secretFn = (T && T.randomSecret) ? T.randomSecret : function () {
      const a = new Uint8Array(20);
      try { crypto.getRandomValues(a); } catch (_) { for (let i = 0; i < 20; i++) a[i] = Math.floor(Math.random() * 256); }
      return Array.from(a).map(function (x) { return x.toString(16).padStart(2, "0"); }).join("");
    };

    for (let i = 0; i < names.length; i++) {
      const sn = (b.seatNumbers || [])[i];
      const parts = sn ? String(sn).split(":") : [null, null];
      const bus = parts[0], seat = parts[1];
      const busNo = bus ? +bus : null;
      const ticketTime = timeForBusNo(busNo);
      const t = {
        id: b.reference + "-" + (i + 1),
        ticketRef: b.reference + "-" + (i + 1),
        reference: b.reference,
        groupRef: b.reference,
        index: i + 1, of: names.length,
        secret: secretFn(),
        name: names[i],
        family: b.family ? (b.family === true ? true : b.family) : null,
        from: b.from, to: b.to, date: b.date,
        time: ticketTime, session: (b.slot && b.slot.sessionName) || null,
        bus: busNo, busNo: busNo, seat: seat || null,
        fare: b.fare, amount: b.amount, method: b.method, paidAt: b.paidAt,
        email: b.email || null,
        luggage: b.luggageItems || 0, luggageFee: b.luggageFee || 0,
        luggageSpace: i === 0 ? (b.luggageSpace || 0) : 0,
        total: b.total || b.amount, createdAt: now + (names.length - i),
        imported: false, status: "booked",
      };
      try { await S.putTicket(t); } catch (e) { console.warn("[ETC issue] putTicket", e); }
      out.push(t);
    }
    if (!out.length) throw new Error("Could not save tickets on this device");

    // Non-blocking note + system notification (control panel / status bar)
    try {
      const first = out[0];
      const when = fmtDate(b.date) + (first.time ? " · " + first.time : "");
      const title = out.length === 1 ? "Your ticket is ready" : out.length + " tickets are ready";
      const body = b.from + " → " + b.to + " · " + when;
      S.putNote({
        id: "n-" + b.reference, type: "ticket", createdAt: now, read: false,
        reference: b.reference, ticketIds: out.map(function (t) { return t.id; }),
        title: title,
        body: body,
      }).catch(function () {});
      if (window.ETC_Push && window.ETC_Push.ticket) {
        window.ETC_Push.ticket(title, body, first && first.id);
      } else if (window.ETC_Push && window.ETC_Push.show) {
        window.ETC_Push.show(title, { body: body, tag: "etc-ticket-" + b.reference, data: { type: "ticket", ticketId: first && first.id, url: first ? "/ticket.html?id=" + encodeURIComponent(first.id) : "/notifications.html" } });
      }
    } catch (_) {}

    // Mark local tickets pending cloud sync, then push (with durable outbox retries)
    try {
      out.forEach(function (tk) { tk.cloudSync = "pending"; tk.cloudSyncAt = Date.now(); });
      for (var i = 0; i < out.length; i++) {
        try { await S.putTicket(out[i]); } catch (_) {}
      }
      enqueueOutbox(out.map(function (tk) { return tk.id; }));
    } catch (_) {}
    try {
      await Promise.race([
        uploadTickets(out),
        new Promise(function (_, rej) { setTimeout(function () { rej(new Error("upload-timeout")); }, 8000); }),
      ]);
    } catch (e) {
      console.warn("[ETC tickets] upload", e);
      // Keep in outbox — background flusher will retry until confirmed
      try { scheduleOutboxFlush(1200); } catch (_) {}
    }
    try {
      if (window.ETC_Occupancy && out.length) {
        const t0 = out[0];
        const rk = (t0.from || "") + ">" + (t0.to || "") + (t0.time ? "@" + t0.time : "");
        if (window.ETC_Occupancy.releaseAllForSession) {
          window.ETC_Occupancy.releaseAllForSession(rk, t0.date).catch(function () {});
        }
        const seats = out.map(function (t) {
          return (t.busNo || t.bus || 1) + ":" + (t.seat || "");
        }).filter(function (s) { return s.indexOf(":") > 0 && !s.endsWith(":"); });
        if (window.ETC_Occupancy.markSeatsTaken) window.ETC_Occupancy.markSeatsTaken(rk, seats);
        // Also mark without time key (book flow sometimes opens seats without @time)
        const rk2 = (t0.from || "") + ">" + (t0.to || "");
        if (rk2 !== rk && window.ETC_Occupancy.markSeatsTaken) window.ETC_Occupancy.markSeatsTaken(rk2, seats);
        if (window.ETC_Occupancy.preload) {
          window.ETC_Occupancy.preload(rk, t0.date).catch(function () {});
        }
      }
    } catch (_) {}

    return out;
  }

  function currentUserMeta() {
    try {
      const u = JSON.parse(localStorage.getItem("etc_user") || "null");
      if (!u) return {};
      const uid = u.firebaseUid || (window.ETC_FB && window.ETC_FB.currentUser && window.ETC_FB.currentUser() && window.ETC_FB.currentUser().uid) || null;
      return { userEmail: u.email || null, userName: u.name || null, firebaseUid: uid };
    } catch (_) { return {}; }
  }


  // ---------- Durable cloud outbox (survives reload / offline / failed batch) ----------
  const OUTBOX_KEY = "etc_ticket_outbox_v1";
  function readOutbox() {
    try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) || "[]") || []; } catch (_) { return []; }
  }
  function writeOutbox(ids) {
    try {
      const uniq = Array.from(new Set((ids || []).map(String).filter(Boolean))).slice(0, 200);
      localStorage.setItem(OUTBOX_KEY, JSON.stringify(uniq));
    } catch (_) {}
  }
  function enqueueOutbox(ids) {
    const cur = readOutbox();
    (ids || []).forEach(function (id) {
      if (id && cur.indexOf(String(id)) < 0) cur.push(String(id));
    });
    writeOutbox(cur);
  }
  function dequeueOutbox(ids) {
    const drop = {};
    (ids || []).forEach(function (id) { drop[String(id)] = 1; });
    writeOutbox(readOutbox().filter(function (id) { return !drop[id]; }));
  }

  var _flushTimer = 0, _flushing = false, _flushAttempts = 0;
  function scheduleOutboxFlush(ms) {
    clearTimeout(_flushTimer);
    _flushTimer = setTimeout(function () { flushOutbox().catch(function () {}); }, ms || 2000);
  }

  async function flushOutbox() {
    if (_flushing) return { ok: false, reason: "busy" };
    const ids = readOutbox();
    if (!ids.length) return { ok: true, count: 0 };
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      scheduleOutboxFlush(8000);
      return { ok: false, reason: "offline" };
    }
    _flushing = true;
    try {
      const list = [];
      for (var i = 0; i < ids.length; i++) {
        try {
          const tk = await S.getTicket(ids[i]);
          if (tk) list.push(tk);
          else dequeueOutbox([ids[i]]);
        } catch (_) {}
      }
      if (!list.length) {
        writeOutbox([]);
        return { ok: true, count: 0 };
      }
      await uploadTickets(list);
      _flushAttempts = 0;
      return { ok: true, count: list.length };
    } catch (e) {
      _flushAttempts++;
      const wait = Math.min(60000, 2000 * Math.pow(1.6, Math.min(_flushAttempts, 8)));
      console.warn("[ETC tickets] outbox flush failed, retry in", Math.round(wait / 1000), "s", e);
      scheduleOutboxFlush(wait);
      return { ok: false, reason: String(e && e.message || e) };
    } finally {
      _flushing = false;
    }
  }

  try {
    function bootFlush() {
      try {
        if (!readOutbox().length) return;
        scheduleOutboxFlush(1500);
        // Gentle heads-up once per session if cloud is lagging
        setTimeout(function () {
          try {
            const n = readOutbox().length;
            if (n > 0 && !sessionStorage.getItem("etc_outbox_toast")) {
              sessionStorage.setItem("etc_outbox_toast", "1");
              if (window.ETC_UI && window.ETC_UI.toast) {
                window.ETC_UI.toast(n === 1 ? "Finishing ticket sync…" : "Finishing sync for " + n + " tickets…");
              }
              scheduleOutboxFlush(500);
            }
          } catch (_) {}
        }, 4000);
      } catch (_) {}
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootFlush);
    else bootFlush();
    window.addEventListener("online", function () { scheduleOutboxFlush(500); });
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && readOutbox().length) scheduleOutboxFlush(800);
    });
    window.addEventListener("pageshow", function () {
      if (readOutbox().length) scheduleOutboxFlush(1000);
    });
  } catch (_) {}

  // ===== ETC-SECRETS-BEGIN: the live-QR secret is kept OUT of the readable ticket document =====
  // tickets/{id} can be read by every signed-in user (the seat map needs it), so the secret lives in
  // ticket_secrets/{id} (rules: only the ticket's owner and staff can open it). If saving it there fails
  // (e.g. the new rules are not published yet) the OLD behaviour is kept for that ticket, so the QR keeps
  // working – nothing breaks, the ticket just stays unprotected until the rules are live.
  function authUid() {
    try {
      const F = window.ETC_FB;
      const u = (F && F.currentUser && F.currentUser()) || (F && F.auth && F.auth.currentUser) || null;
      return u && u.uid ? String(u.uid) : null;
    } catch (_) { return null; }
  }
  async function saveTicketSecrets(db, FV, list) {
    const saved = new Set();
    try {
      const uid = authUid();
      if (!uid) return saved;
      const withSecret = (list || []).filter(function (t) { return t && t.id && t.secret; });
      if (!withSecret.length) return saved;
      const b = db.batch();
      withSecret.forEach(function (t) {
        b.set(db.collection("ticket_secrets").doc(String(t.id)),
          { secret: String(t.secret), uid: uid, ticketId: String(t.id), serverTs: FV.serverTimestamp() }, { merge: true });
      });
      await b.commit();
      withSecret.forEach(function (t) { saved.add(String(t.id)); });
    } catch (e) {
      console.warn("[ETC tickets] secret vault not available - keeping the old behaviour for this batch:", e && e.message);
    }
    return saved;
  }
  async function fetchTicketSecret(id) {
    try {
      if (!id || !window.ETC_FB || !window.ETC_FB.db) return null;
      await window.ETC_FB.ensureAuth();
      const d = await window.ETC_FB.db.collection("ticket_secrets").doc(String(id)).get();
      const v = d && d.exists && d.data() ? d.data().secret : null;
      return v ? String(v) : null;
    } catch (_) { return null; }
  }
  // Old tickets still carry the secret inside tickets/{id}: move it into the vault, then scrub it (once per id).
  const _migratingSecret = {};
  async function migrateLegacySecret(id, secret) {
    if (!id || !secret || _migratingSecret[id]) return;
    _migratingSecret[id] = true;
    try {
      const F = window.ETC_FB;
      if (!F || !F.db) return;
      await F.ensureAuth();
      const ok = await saveTicketSecrets(F.db, F.FieldValue, [{ id: id, secret: secret }]);
      if (ok.has(String(id))) {
        await F.db.collection("tickets").doc(String(id)).set({ secret: F.FieldValue.delete() }, { merge: true });
      }
    } catch (_) {}
  }
  // ===== ETC-SECRETS-END =====

  async function uploadTickets(tickets) {
    if (!tickets || !tickets.length) return;
    // Always remember these IDs until Firebase confirms
    try { enqueueOutbox(tickets.map(function (x) { return x && x.id; })); } catch (_) {}
    if (!window.ETC_FB || !window.ETC_FB.db) {
      console.warn("[ETC tickets] Firebase not ready – ticket stays on phone only");
      scheduleOutboxFlush(3000);
      throw new Error("firebase-not-ready");
    }
    try {
      await Promise.race([
        window.ETC_FB.ensureAuth(),
        new Promise(function (_, rej) { setTimeout(function () { rej(new Error("auth-timeout")); }, 4000); }),
      ]);
    } catch (e) {
      console.warn("[ETC tickets] auth", e);
      // still try write if already signed in
    }
    const db = window.ETC_FB.db;
    const FV = window.ETC_FB.FieldValue;
    const stripTerm = (s) => String(s || "").replace(/\s+Terminal$/i, "").replace(/\s+Park$/i, "").trim();
    const userMeta = currentUserMeta();
    const list = tickets.slice();
    for (let i = 0; i < list.length; i += 40) {
      const chunk = list.slice(i, i + 40);
      const savedSecrets = await saveTicketSecrets(db, FV, chunk);   // ETC-SECRETS
      const batch = db.batch();
      for (const t of chunk) {
        const seatRaw = t.seat || null;
        let seatId = seatRaw ? String(seatRaw) : null;
        if (seatId && seatId.indexOf(":") >= 0) seatId = seatId.split(":").pop();
        if (seatId) seatId = seatId.toUpperCase();
        const busN = t.busNo != null ? +t.busNo : (t.bus != null ? +t.bus : 1);
        const payload = Object.assign({}, t, userMeta, {
          status: t.status || "booked",
          from: stripTerm(t.from),
          to: stripTerm(t.to),
          fromLabel: t.from || null,
          toLabel: t.to || null,
          bus: busN,
          busNo: busN,
          time: t.time || null,
          seat: seatId,
          date: t.date || null,
          luggage: t.luggage != null ? +t.luggage : (t.luggageItems != null ? +t.luggageItems : 0),
          luggageItems: t.luggageItems != null ? +t.luggageItems : (t.luggage != null ? +t.luggage : 0),
          luggageSpace: t.luggageSpace != null ? +t.luggageSpace : 0,
          luggageFee: t.luggageFee != null ? +t.luggageFee : 0,
          name: t.name || null,
          serverTs: FV.serverTimestamp(),
          source: "passenger",
        });
        Object.keys(payload).forEach((k) => { if (payload[k] === undefined) delete payload[k]; });
        // ETC-SECRETS: secret is in the vault -> remove it from the readable ticket document (also cleans old copies)
        if (savedSecrets.has(String(t.id))) { delete payload.secret; payload.secret = FV.delete(); }
        // ETC-OWNER: stamp the signed-in uid on the FIRST upload so the rules can tell the owner from everybody else
        if (!t.ownerUid && t.cloudSync !== "ok") { const ou = authUid(); if (ou) payload.ownerUid = ou; }
        batch.set(db.collection("tickets").doc(String(t.id)), payload, { merge: true });
        if (userMeta.firebaseUid) {
          batch.set(
            db.collection("users").doc(String(userMeta.firebaseUid)).collection("tickets").doc(String(t.id)),
            { ticketId: t.id, reference: t.reference || null, date: t.date || null, serverTs: FV.serverTimestamp() },
            { merge: true }
          );
        }
      }
      await batch.commit();
      console.info("[ETC tickets] uploaded batch", chunk.length);
      // Mark synced + remove from durable outbox
      for (var ci = 0; ci < chunk.length; ci++) {
        try {
          const tk = chunk[ci];
          tk.cloudSync = "ok";
          tk.cloudSyncAt = Date.now();
          await S.putTicket(tk);
          dequeueOutbox([tk.id]);
        } catch (_) {}
      }
    }
  }

  /** How many tickets still waiting for Firebase (for UI / support) */
  function pendingCloudCount() {
    try { return readOutbox().length; } catch (_) { return 0; }
  }

  async function pullMyTickets() {
    if (!window.ETC_FB || !window.ETC_FB.db) return [];
    const meta = currentUserMeta();
    if (!meta.userEmail && !meta.firebaseUid) return [];
    try {
      await window.ETC_FB.ensureAuth();
      const db = window.ETC_FB.db;
      let snap;
      if (meta.userEmail) {
        snap = await db.collection("tickets").where("userEmail", "==", meta.userEmail).limit(100).get();
      } else {
        snap = await db.collection("tickets").where("firebaseUid", "==", meta.firebaseUid).limit(100).get();
      }
      const out = [];
      for (const doc of snap.docs) {
        const cloud = Object.assign({}, doc.data());
        cloud.id = cloud.id || doc.id;
        // Merge with local so secret / refs are never wiped by a cloud pull
        let merged = cloud;
        try {
          if (typeof mergeCloudTicket === "function") {
            merged = await mergeCloudTicket(cloud.id, cloud);
          } else {
            const local = await S.getTicket(cloud.id);
            merged = Object.assign({}, local || {}, cloud);
            if (local && local.secret && !merged.secret) merged.secret = local.secret;
            if (!merged.secret) { const vs = await fetchTicketSecret(cloud.id); if (vs) merged.secret = vs; }   // ETC-SECRETS
            await S.putTicket(merged);
          }
        } catch (_) {
          try { await S.putTicket(cloud); } catch (__) {}
        }
        out.push(merged);
      }
      return out;
    } catch (e) {
      console.warn("[ETC tickets] pullMyTickets failed:", e);
      return [];
    }
  }

  const fmtDate = (d) => { const dt = d ? new Date(d + "T00:00:00") : null; return dt && !isNaN(dt) ? dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "Today"; };

  // ---- Web Share: the link carries the ticket in the URL #fragment (never sent to a server) ----
  const b64 = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unb64 = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));
  function shareLink(t) {
    // In the Android app the page lives on https://localhost, which nobody else can open:
    // point the link at the public web address instead (App Links bring it back into the app).
    const cfg = window.ETC_CONFIG && window.ETC_CONFIG.SHARE_BASE_URL;
    const inApp = window.EtcNative && window.EtcNative.isNative;
    const base = (inApp && cfg ? String(cfg).replace(/\/+$/, "") + "/" : location.href.replace(/[^/]*([?#].*)?$/, "")) + "ticket.html";
    const pay = Object.assign({}, t, { shared: true });
    delete pay.email;
    return `${base}#d=${b64(JSON.stringify(pay))}`;
  }
  async function importFromHash(hash) {
    const m = /[#&]d=([A-Za-z0-9_-]+)/.exec(hash || ""); if (!m) return null;
    try {
      const t = JSON.parse(unb64(m[1]));
      if (!t || !t.id || !t.secret) return null;
      const have = await S.getTicket(t.id);
      if (!have) { t.imported = true; t.createdAt = Date.now(); await S.putTicket(t); }
      return t.id;
    } catch (_) { return null; }
  }
  
  /** Alert if user is 5–15 min late for today's departure */
  function parseTicketMins(timeStr) {
    if (!timeStr) return null;
    let m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(timeStr).trim());
    if (m) {
      let h = +m[1] % 12;
      if (m[3].toUpperCase() === "PM") h += 12;
      return h * 60 + +m[2];
    }
    m = /^(\d{1,2}):(\d{2})$/.exec(String(timeStr).trim());
    if (m) return (+m[1]) * 60 + (+m[2]);
    return null;
  }

  // One definition of "used" – same as the Events page (a no-show counts as used, because
  // used tickets cannot be rescheduled). Anything used must never trigger a reschedule popup.
  function isTicketUsed(t) {
    const st = String((t && t.status) || "").toLowerCase();
    return st === "boarded" || st === "used" || st === "void" || st === "scanned" || st === "noshow";
  }

  function pad2(n) { return String(n).padStart(2, "0"); }

  function minsToHM(mins) {
    const h = Math.floor(mins / 60) % 24;
    const m = mins % 60;
    return pad2(h) + ":" + pad2(m);
  }

  /** Schedule calendar alarms 10 & 5 min before each unused ticket departure */
  let _depSyncBusy = false;
  async function syncDepartureAlarms() {
    if (_depSyncBusy) return; // FIX: never run two syncs at once
    _depSyncBusy = true;
    try {
      if (!S || !S.listTickets) return;
      const all = await S.listTickets();
      const now = new Date();
      const iso = now.getFullYear() + "-" + pad2(now.getMonth() + 1) + "-" + pad2(now.getDate());
      const saver = window.ETC_CalendarAlarms && window.ETC_CalendarAlarms.save;
      if (!saver) return;
      for (const t of all) {
        if (!t || !t.date || !t.time) continue;
        if (isTicketUsed(t)) continue;
        // only today + next 2 days
        if (t.date < iso) continue;
        const dep = parseTicketMins(t.time);
        if (dep == null) continue;
        const note = (t.from || "") + " → " + (t.to || "") + " · " + (t.time || "") + (t.seat ? " · Seat " + t.seat : "");
        [10, 5].forEach(function (before) {
          let alarmMins = dep - before;
          let alarmDate = t.date;
          if (alarmMins < 0) {
            // previous calendar day
            const d = new Date(t.date + "T12:00:00");
            d.setDate(d.getDate() - 1);
            alarmDate = d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
            alarmMins += 24 * 60;
          }
          const time = minsToHM(alarmMins);
          // Only schedule future alarms
          const id = alarmDate + "T" + time;
          const nowId = iso + "T" + pad2(now.getHours()) + ":" + pad2(now.getMinutes());
          if (id < nowId) return;
          saver(alarmDate, time, "Bus in " + before + " min — " + note, "alarm");
        });
      }
    } catch (e) {
      console.warn("[ETC] syncDepartureAlarms", e);
    } finally {
      _depSyncBusy = false;
    }
  }

  async function checkLateTickets() {
    try {
      // Never freeze home – bound all async work
      await Promise.race([
        syncDepartureAlarms().catch(function () {}),
        new Promise(function (r) { setTimeout(r, 1500); }),
      ]);
      const all = await Promise.race([
        S.listTickets(),
        new Promise(function (r) { setTimeout(function () { r([]); }, 1500); }),
      ]);
      const now = new Date();
      const iso = now.getFullYear() + "-" + pad2(now.getMonth() + 1) + "-" + pad2(now.getDate());
      const minsNow = now.getHours() * 60 + now.getMinutes();
      for (const t of all) {
        if (t.date !== iso) continue;
        if (isTicketUsed(t)) continue;
        if (!t.time) continue;
        const dep = parseTicketMins(t.time);
        if (dep == null) continue;
        const until = dep - minsNow; // minutes until departure (negative = past)
        const route = (t.from || "") + " → " + (t.to || "");
        const ui = window.ETC_UI;

        // 10 min and 5 min BEFORE departure
        if (until === 10 || until === 5) {
          const key = "etc_predep_" + t.id + "_" + until + "_" + iso;
          if (sessionStorage.getItem(key)) continue;
          sessionStorage.setItem(key, "1");
          const msg = "Your " + t.time + " bus (" + route + ") leaves in " + until + " minutes. Head to the terminal.";
          if (window.ETC_CalendarAlarms && window.ETC_CalendarAlarms.fire) {
            window.ETC_CalendarAlarms.fire({
              kind: "alarm",
              note: msg,
              date: iso,
              time: minsToHM(minsNow),
              id: key,
            });
          } else if (ui && ui.overlay) {
            ui.overlay(
              '<div class="ov-card dlg-card" role="alertdialog"><h3>Bus leaving soon</h3><p>' + msg + '</p>' +
              '<button type="button" class="ov-btn" data-close>OK</button></div>',
              { sticky: false }
            );
          }
          if ("Notification" in window && Notification.permission === "granted") {
            try { new Notification("🚌 Bus in " + until + " min", { body: msg, tag: key }); } catch (_) {}
          }
          if (navigator.vibrate) try { navigator.vibrate([200, 100, 200]); } catch (_) {}
          continue;
        }

        // AFTER departure (5–45 min late) — reschedule / refund
        const late = minsNow - dep;
        if (late >= 5 && late <= 45) {
          const key = "etc_late_" + t.id + "_" + iso;
          if (sessionStorage.getItem(key)) continue;
          sessionStorage.setItem(key, "1");
          if (!ui || !ui.overlay) continue;
          const ov = ui.overlay(`
            <div class="ov-card dlg-card" role="dialog">
              <h3>You're running late</h3>
              <p>Your ${t.time} bus (${t.from} → ${t.to}) departed about ${late} min ago. Reschedule or request a refund?</p>
              <button type="button" class="ov-btn" id="lateResched">Reschedule ticket</button>
              <button type="button" class="ov-btn ghost" id="lateRefund">Request refund</button>
              <button type="button" class="ov-btn ghost" data-close>Dismiss</button>
            </div>`, { sticky: false });
          try {
            const el = ov && ov.el;
            if (!el) continue;
            const rs = el.querySelector("#lateResched");
            const rf = el.querySelector("#lateRefund");
            if (rs) rs.onclick = () => {
              try { ov.close(); } catch (_) {}
              try { sessionStorage.setItem("etc_reschedule_id", t.id); } catch(_){}
              location.href = "events.html?reschedule=" + encodeURIComponent(t.id);
            };
            if (rf) rf.onclick = async () => {
              try { ov.close(); } catch (_) {}
              try {
                if (window.ETC_FB && window.ETC_FB.db) {
                  await window.ETC_FB.ensureAuth();
                  await window.ETC_FB.db.collection("disputes").add({
            uid: (window.ETC_FB.auth.currentUser || {}).uid || null, 
                    type: "refund", ticketId: t.id, reason: "Missed bus – late arrival",
                    status: "open", clientTs: Date.now(), source: "passenger",
                  });
                }
              } catch (_) {}
              if (ui.toast) ui.toast("Refund request submitted");
            };
          } catch (_) {}
        }
      }
    } catch (e) { console.warn("[ETC late]", e); }
  }


  async function mergeCloudTicket(id, cloud) {
    var local = null;
    try { local = await S.getTicket(id); } catch (_) {}
    if (!local) {
      try {
        var all = await S.listTickets();
        local = (all || []).find(function (x) { return x.id === id; }) || null;
      } catch (_) {}
    }
    var data = Object.assign({}, local || {}, cloud || {}, { id: id });
    // NEVER drop local secret / ticketRef — cloud board patch is status-only
    if (local) {
      if (local.secret && !data.secret) data.secret = local.secret;
      if (local.ticketRef && !data.ticketRef) data.ticketRef = local.ticketRef;
      if (local.reference && !data.reference) data.reference = local.reference;
      if (local.name && !data.name) data.name = local.name;
    }
    // ETC-SECRETS: cloud copy no longer carries the secret -> take it from the vault (own tickets only);
    // a legacy cloud copy that still has it gets moved into the vault and scrubbed.
    if (!data.secret) { const vs = await fetchTicketSecret(id); if (vs) data.secret = vs; }
    if (cloud && cloud.secret) { migrateLegacySecret(id, String(cloud.secret)); }
    try { await S.putTicket(data); } catch (_) {}
    return data;
  }

  async function syncTicketStatus(id) {
    if (!id || !window.ETC_FB || !window.ETC_FB.db) return null;
    try {
      await window.ETC_FB.ensureAuth();
      const doc = await window.ETC_FB.db.collection("tickets").doc(String(id)).get();
      if (!doc.exists) return null;
      return await mergeCloudTicket(id, doc.data());
    } catch (e) {
      console.warn("[ETC tickets] syncTicketStatus", e);
      return null;
    }
  }

  function watchTicketStatus(id, onChange) {
    if (!id || !window.ETC_FB || !window.ETC_FB.db) return function () {};
    var unsub = null;
    try {
      unsub = window.ETC_FB.db.collection("tickets").doc(String(id)).onSnapshot(function (doc) {
        if (!doc.exists) return;
        mergeCloudTicket(id, doc.data()).then(function (data) {
          try { promptSeatReleased(data); } catch (_) {}
          if (onChange) onChange(data);
        });
      }, function (e) { console.warn("[ETC tickets] watch", e); });
    } catch (e) { console.warn(e); }
    return function () { try { if (unsub) unsub(); } catch (_) {} };
  }

  async function applyMissedRide(t) {
    if (!t || !t.id) return t;
    var st = String(t.status || "").toLowerCase();
    if (st === "boarded" || st === "used" || st === "void") return t;
    if (!t.seat && !t.luggageSpace) return t;
    var day = t.date;
    if (!day) return t;
    var now = new Date();
    var iso = now.getFullYear() + "-" + String(now.getMonth()+1).padStart(2,"0") + "-" + String(now.getDate()).padStart(2,"0");
    if (day >= iso) return t;
    t.seat = null;
    t.bus = null;
    t.busNo = null;
    t.luggageSpace = 0;
    t.luggageItems = 0;
    t.luggageFee = 0;
    t.missedRide = true;
    t.seatReleasedAt = Date.now();
    try { await S.putTicket(t); } catch (_) {}
    try {
      if (window.ETC_FB && window.ETC_FB.db) {
        await window.ETC_FB.ensureAuth();
        var FV = window.ETC_FB.FieldValue;
        await window.ETC_FB.db.collection("tickets").doc(String(t.id)).set({
          seat: null, bus: null, busNo: null,
          luggageSpace: 0, luggageItems: 0, luggageFee: 0,
          missedRide: true, seatReleasedAt: FV.serverTimestamp()
        }, { merge: true });
      }
    } catch (_) {}
    return t;
  }


  // Agent released seat (no-show) → same reschedule / refund prompt as late bus
  const _seatReleaseSeen = {};
  function promptSeatReleased(t) {
    if (!t || !t.id) return;
    if (isTicketUsed(t)) return; // used tickets can't be rescheduled – don't show the popup
    const st = String(t.status || "").toLowerCase();
    if (st !== "noshow" && !(t.passengerAlert && t.passengerAlert.type === "seat_released")) return;
    const key = "etc_seatrel_" + t.id;
    if (_seatReleaseSeen[key] || sessionStorage.getItem(key)) return;
    _seatReleaseSeen[key] = 1;
    try { sessionStorage.setItem(key, "1"); } catch (_) {}
    const ui = window.ETC_UI || window.ui;
    if (!ui || !ui.overlay) return;
    const seat = t.seat || (t.passengerAlert && t.passengerAlert.seat) || "";
    let ov;
    try {
      ov = ui.overlay(`
      <div class="ov-card dlg-card" role="dialog">
        <h3>Seat released</h3>
        <p>The terminal agent released your seat${seat ? " (" + seat + ")" : ""} (marked no-show). Reschedule to another time or request a refund?</p>
        <button type="button" class="ov-btn" id="relResched">Reschedule ticket</button>
        <button type="button" class="ov-btn ghost" id="relRefund">Request refund</button>
        <button type="button" class="ov-btn ghost" data-close>Dismiss</button>
      </div>`, { sticky: false });
    } catch (_) { return; }
    try {
      const el = (ov && ov.el) || null;
      if (!el) return;
      const rs = el.querySelector("#relResched");
      const rf = el.querySelector("#relRefund");
      if (rs) rs.onclick = () => {
        try { ov.close && ov.close(); } catch (_) {}
        try { sessionStorage.setItem("etc_reschedule_id", t.id); } catch (_) {}
        location.href = "events.html?reschedule=" + encodeURIComponent(t.id);
      };
      if (rf) rf.onclick = async () => {
        try { ov.close && ov.close(); } catch (_) {}
        try {
          if (window.ETC_FB && window.ETC_FB.db) {
            await window.ETC_FB.ensureAuth();
            await window.ETC_FB.db.collection("disputes").add({
            uid: (window.ETC_FB.auth.currentUser || {}).uid || null, 
              type: "refund", ticketId: t.id, reason: "Agent released seat (no-show)",
              status: "open", clientTs: Date.now(), source: "passenger",
            });
          }
        } catch (_) {}
        if (ui.toast) ui.toast("Refund request submitted");
      };
    } catch (_) {}
  }

  async function checkSeatReleasedAlerts() {
    try {
      if (!window.ETC_Store || !window.ETC_Store.listTickets) return;
      const list = await Promise.race([
        window.ETC_Store.listTickets(),
        new Promise(function (r) { setTimeout(function () { r([]); }, 1500); }),
      ]);
      // At most one prompt per page load
      var shown = false;
      (list || []).forEach(function (t) {
        if (shown) return;
        if (isTicketUsed(t)) return; // used ticket → no seat-released popup
        try {
          var st = String(t && t.status || "").toLowerCase();
          if (st === "noshow" || (t.passengerAlert && t.passengerAlert.type === "seat_released")) {
            promptSeatReleased(t);
            shown = true;
          }
        } catch (_) {}
      });
    } catch (_) {}
  }

  return { issue: issue, shareLink: shareLink, importFromHash: importFromHash, fmtDate: fmtDate, uploadTickets: uploadTickets, pullMyTickets: pullMyTickets, checkLateTickets: checkLateTickets, checkSeatReleasedAlerts: checkSeatReleasedAlerts, promptSeatReleased: promptSeatReleased, syncDepartureAlarms: syncDepartureAlarms, syncTicketStatus: syncTicketStatus, watchTicketStatus: watchTicketStatus, applyMissedRide: applyMissedRide, flushOutbox: flushOutbox, pendingCloudCount: pendingCloudCount, enqueueOutbox: enqueueOutbox };

})();
