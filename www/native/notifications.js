/**
 * EtcNotify - every notification and reminder of the ETC passenger app + Coal City Chat, as real Android
 * notifications (sound, heads-up banner, notification panel, tap opens the right page).
 *
 *  Sources covered
 *   - Chat messages (Firestore listeners)                         channel "messages"
 *   - Ticket booked / any ETC_Push.* / new Notification(...)       channel "tickets" / "alerts"
 *   - Ticket updates from agents: checked in, cancelled, refunded, seat released, seat/bus changed,
 *     passenger alerts (live ticket listeners)                     channel "tickets"
 *   - Departure reminders: 1 hour before, "running late" 5 min after (scheduled on the phone, work offline)
 *   - Dispute replies, fare / price changes (called from those files through EtcNotify.alert)
 *   - Calendar alarms (native alarm module, see alarm-bridge.js)
 *
 *  PUSH_MODE 'local' : listeners create the notifications while the app process is alive (use the
 *                      background listener switch in the setup screen to keep it alive).
 *  PUSH_MODE 'fcm'   : also registers the phone for Firebase Cloud Messaging; the Cloud Functions in
 *                      /functions then ring the phone even when the app is closed.
 */
(function () {
  var N = window.EtcNative;
  var cfg = window.ETC_CONFIG || {};

  function putNoteSafe(o) {
    try {
      var S = window.ETC_Store;
      if (!S || !S.putNote || o.note === false) return;
      var p = S.putNote({
        id: 'n-' + (o.tag || ('a' + Date.now())), type: o.noteType || 'ticket', createdAt: Date.now(), read: false,
        ticketIds: o.ticketIds || [], title: o.title, body: o.body || ''
      });
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  }

  // ---------- browser (no native layer): keep the old behaviour ------------------
  if (!N || !N.isNative) {
    window.EtcNotify = {
      native: false, start: function () {}, stop: function () { return Promise.resolve(); }, test: function () {},
      alert: function (o) {
        putNoteSafe(o);
        try {
          if (window.ETC_Push && ETC_Push.show) ETC_Push.show(o.title, { body: o.body, tag: o.tag, data: { type: o.type, url: o.url } });
        } catch (e) {}
      },
      show: function () {}, ensurePermission: function () { return Promise.resolve('default'); }
    };
    return;
  }

  var LN = N.plugin('LocalNotifications');
  var PN = N.plugin('PushNotifications');
  var APP = N.plugin('App');
  var CHAT_CH = cfg.NOTIFICATION_CHANNEL || 'messages';
  var MODE = cfg.PUSH_MODE === 'fcm' ? 'fcm' : 'local';
  var CH = { messages: CHAT_CH, tickets: 'tickets', alerts: 'alerts' };

  var isActive = true;
  var floor = Date.now() - 20000;          // ignore chat messages older than this page load
  var unsubs = [], watched = {}, tkUnsubs = {};
  var current = null;                      // uid we are listening for
  var permState = 'default';
  var permissionOk = null;

  if (APP && APP.addListener) APP.addListener('appStateChange', function (s) { isActive = !!(s && s.isActive); if (isActive) afterResume(); });

  // ---------- helpers ----------------------------------------------------
  function getUid() { try { return localStorage.getItem('etc_chat_uid') || null; } catch (e) { return null; } }
  function getFs() {
    try {
      if (window.ETC_FB && window.ETC_FB.db) return window.ETC_FB.db;
      if (window.firebase && firebase.apps && firebase.apps.length && firebase.firestore) return firebase.firestore();
    } catch (e) {}
    return null;
  }
  function hash(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    return Math.abs(h) % 2147483000 + 1;
  }
  function seen(key) {
    var list = [];
    try { list = JSON.parse(localStorage.getItem('etc_notified') || '[]'); } catch (e) {}
    if (list.indexOf(key) !== -1) return true;
    list.push(key);
    try { localStorage.setItem('etc_notified', JSON.stringify(list.slice(-300))); } catch (e) {}
    return false;
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function channelFor(type) {
    if (type === 'chat') return CH.messages;
    if (type === 'ticket' || type === 'ride' || type === 'seat') return CH.tickets;
    return CH.alerts;
  }
  /** web url used by the old code ("/ticket.html?id=1", "/?cal=1", "/chat/") -> path inside the app */
  function toRoute(url) {
    if (!url) return 'index.html';
    var u = String(url).replace(/^https?:\/\/[^/]+/, '').replace(/^\/+/, '');
    if (!u || u.charAt(0) === '?') return 'index.html' + (u || '');
    if (u === 'chat/' || u === 'chat') return 'chat/index.html';
    return u;
  }
  function go(extra) {
    var root = cfg.ROOT_URL || '/';
    if (extra && extra.uid) {
      window.location.href = root + 'chat/pages/chatroom.html?uid=' + encodeURIComponent(extra.uid) + '&name=' + encodeURIComponent(extra.name || 'Chat');
    } else if (extra && extra.route) {
      window.location.href = root + extra.route;
    } else {
      window.location.href = root + 'index.html';
    }
  }
  function preview(m) {
    var t = String(m.text || m.message || '');
    var ft = String(m.fileType || '');
    if (m.viewOnce) return '📷 Photo';
    if (/^image\//.test(ft)) return '📷 Photo';
    if (/^video\//.test(ft)) return '🎥 Video';
    if (/^audio\//.test(ft)) return t.indexOf('🎤') === 0 ? '🎤 Voice message' : '🎵 Audio';
    if (ft) return '📄 ' + (t || 'Document');
    if (t.length > 160) t = t.slice(0, 157) + '…';
    return t || 'New message';
  }

  // ---------- channels + permission --------------------------------------
  function createChannels() {
    if (!LN) return Promise.resolve();
    var defs = [
      { id: CH.messages, name: 'Messages', description: 'New chat messages' },
      { id: CH.tickets, name: 'Tickets & rides', description: 'Ticket ready, check-in, seat and bus changes, departure reminders' },
      { id: CH.alerts, name: 'Alerts', description: 'Price changes, dispute replies and other updates' }
    ];
    return Promise.all(defs.map(function (c) {
      return LN.createChannel({
        id: c.id, name: c.name, description: c.description,
        importance: 5, visibility: 1, vibration: true, lights: true, lightColor: '#1A237E'
      }).catch(function () {});
    }));
  }
  function readPermission() {
    if (!LN) return Promise.resolve(false);
    return LN.checkPermissions().then(function (p) {
      permState = p.display === 'granted' ? 'granted' : (p.display === 'denied' ? 'denied' : 'default');
      permissionOk = permState === 'granted' ? true : (permState === 'denied' ? false : null);
      return permissionOk;
    }).catch(function () { return false; });
  }
  function ensurePermission() {
    if (!LN) return Promise.resolve('denied');
    return readPermission().then(function (ok) {
      if (ok) return 'granted';
      return LN.requestPermissions().then(function (r) {
        permState = r.display === 'granted' ? 'granted' : 'denied';
        permissionOk = permState === 'granted';
        return permState;
      });
    }).catch(function () { return 'denied'; });
  }

  // ---------- posting ------------------------------------------------------
  /** a real Android notification: sound, heads-up, notification panel */
  function post(o) {
    if (!LN || permissionOk === false) return Promise.resolve();
    return LN.schedule({
      notifications: [{
        id: o.id, title: o.title || 'ETC', body: o.body || '',
        channelId: o.channelId || CH.alerts, group: o.group, extra: o.extra || {}
      }]
    }).catch(function (e) { console.warn('[notify]', e && e.message || e); });
  }
  /** chat: in 'fcm' mode the push handles the background, so only show while the app is open */
  function showChat(o) {
    if (MODE === 'fcm' && !isActive) return;
    post({ id: o.id, title: o.title, body: o.body, channelId: CH.messages, group: o.group, extra: o.extra });
  }
  /** same signature as the web Notification / ETC_Push.show used across the passenger app */
  function showFromWeb(title, opts) {
    opts = opts || {};
    var d = opts.data || {};
    var type = d.type || 'alert';
    return post({
      id: hash(opts.tag || (String(title) + Date.now())), title: title, body: opts.body || '',
      channelId: channelFor(type), extra: { route: toRoute(d.url), type: type }
    });
  }
  /** "something the passenger should know": system notification + entry on the in-app bell */
  function alertFn(o) {
    putNoteSafe(o);
    return post({
      id: hash(o.tag || (o.title + Date.now())), title: o.title, body: o.body || '',
      channelId: channelFor(o.type), extra: { route: toRoute(o.url), type: o.type || 'alert' }
    });
  }

  // ---------- 1) chat -------------------------------------------------------
  function attachChat(fs, uid, other) {
    var chatId = [uid, other].sort().join('_');
    var q = fs.collection('etc_rtdb_chats').doc(chatId).collection('messages').orderBy('ts', 'desc').limit(1);
    unsubs.push(q.onSnapshot(function (snap) {
      snap.docChanges().forEach(function (ch) {
        if (ch.type !== 'added') return;
        var m = ch.doc.data() || {};
        if (m.senderUid === uid || m.senderUid === 'gemini' || m.isGemini) return;
        var ts = Number(m.ts || m.timestamp || 0);
        if (ts < floor) return;
        var key = 'c_' + chatId + '_' + ch.doc.id;
        if (seen(key)) return;
        if (isActive && !document.hidden && window.friendUid === other && /chatroom\.html/.test(location.pathname)) return;
        var name = m.senderName || 'New message';
        showChat({ id: hash(key), title: name, body: preview(m), group: 'chat_' + other, extra: { type: 'message', uid: other, name: name } });
      });
    }, function (e) { console.warn('[notify] chat listener', other, e && e.code || e); }));
  }
  function watchFriends(fs, uid) {
    unsubs.push(fs.collection('etc_rtdb_friends').doc(uid).onSnapshot(function (doc) {
      var f = (doc && doc.exists && doc.data()) || {};
      Object.keys(f).forEach(function (other) {
        if (!other || other === uid || watched[other]) return;
        watched[other] = 1;
        attachChat(fs, uid, other);
      });
    }, function (e) { console.warn('[notify] friends listener', e && e.code || e); }));
  }

  // ---------- 2) tickets: live updates from agents ------------------------------
  var DONE = { used: 1, boarded: 1, void: 1, voided: 1, cancelled: 1, canceled: 1, refunded: 1, noshow: 1, no_show: 1, expired: 1 };
  function isDone(t) { return !!DONE[String(t.status || '').toLowerCase()]; }
  function listTickets() {
    var S = window.ETC_Store;
    if (!S || !S.listTickets) return Promise.resolve([]);
    try { return Promise.resolve(S.listTickets()).then(function (r) { return r || []; }).catch(function () { return []; }); } catch (e) { return Promise.resolve([]); }
  }
  function depEpoch(t) {
    var d = String(t.date || '').split('-');
    var m = /(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(String(t.time || ''));
    if (d.length < 3 || !m) return 0;
    var h = +m[1], mi = +m[2];
    if (m[3]) { var pm = /pm/i.test(m[3]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
    return new Date(+d[0], +d[1] - 1, +d[2], h, mi, 0, 0).getTime();
  }
  function ticketMessage(id, d, prev) {
    var status = String(d.status || 'booked').toLowerCase();
    var seat = d.seat || '', bus = d.bus || d.busNo || '';
    var route = 'ticket.html?id=' + encodeURIComponent(id);
    var al = d.passengerAlert;
    var alKey = al ? String(al.type || '') + '|' + String(al.at || al.ts || al.message || '') : '';
    var cur = { status: status, seat: String(seat), bus: String(bus), alert: alKey };
    if (!prev) return { state: cur };
    var msg = null;
    if (cur.alert && cur.alert !== prev.alert) {
      var type = String(al.type || '');
      if (type === 'seat_released') msg = { title: '⚠️ Your seat was released', body: al.message || 'You missed the bus. Tap to reschedule.', url: 'events.html?reschedule=' + encodeURIComponent(id) };
      else msg = { title: '🚌 Update on your ride', body: al.message || 'The agent sent you an update.', url: route };
    } else if (cur.status !== prev.status) {
      if (status === 'boarded' || status === 'used') msg = { title: '✅ You are checked in', body: 'You are on board. Have a safe trip!', url: route };
      else if (status === 'void' || status === 'voided' || status === 'cancelled' || status === 'canceled') msg = { title: 'Ticket cancelled', body: 'Your ticket was cancelled. Tap for details.', url: route };
      else if (status === 'refunded') msg = { title: 'Refund processed', body: 'Your refund has been processed.', url: route };
      else if (status === 'noshow' || status === 'no_show') msg = { title: '⚠️ Seat released', body: 'You missed the bus and your seat was released. Tap to reschedule.', url: 'events.html?reschedule=' + encodeURIComponent(id) };
      else msg = { title: 'Ticket update', body: 'Your ticket status is now "' + status + '".', url: route };
    } else if (cur.seat !== prev.seat || cur.bus !== prev.bus) {
      msg = { title: '🚌 Seat updated', body: 'Seat ' + (seat || '-') + (bus ? ' · Bus ' + bus : '') + '. Tap to see your ticket.', url: route };
    }
    return { state: cur, msg: msg };
  }
  function onTicketSnap(id, snap) {
    if (!snap || !snap.exists) return;
    var d = snap.data() || {};
    var key = 'etc_tkst_' + id;
    var prev = null;
    try { prev = JSON.parse(lsGet(key) || 'null'); } catch (e) {}
    var r = ticketMessage(id, d, prev);
    lsSet(key, JSON.stringify(r.state));
    if (!r.msg) return;
    var tag = 'tk_' + id + '_' + r.state.status + '_' + r.state.seat + '_' + r.state.bus + '_' + r.state.alert;
    if (seen(tag)) return;
    alertFn({ title: r.msg.title, body: r.msg.body, tag: tag, type: 'ticket', url: r.msg.url, ticketIds: [id] });
    scheduleTicketReminders();
  }
  function syncTicketWatchers() {
    var fs = getFs();
    if (!fs) return;
    listTickets().then(function (list) {
      var now = Date.now();
      var wanted = {};
      list.filter(function (t) {
        if (!t || !t.id || isDone(t)) return false;
        var at = depEpoch(t);
        return !at || at > now - 36 * 3600 * 1000;
      }).slice(0, 12).forEach(function (t) { wanted[String(t.id)] = 1; });
      Object.keys(tkUnsubs).forEach(function (id) {
        if (!wanted[id]) { try { tkUnsubs[id](); } catch (e) {} delete tkUnsubs[id]; }
      });
      var ensure = (window.ETC_FB && window.ETC_FB.ensureAuth) ? Promise.resolve(window.ETC_FB.ensureAuth()).catch(function () {}) : Promise.resolve();
      ensure.then(function () {
        Object.keys(wanted).forEach(function (id) {
          if (tkUnsubs[id]) return;
          tkUnsubs[id] = fs.collection('tickets').doc(id).onSnapshot(function (snap) { onTicketSnap(id, snap); },
            function (e) { console.warn('[notify] ticket listener', id, e && e.code || e); });
        });
      });
    });
  }

  // ---------- 3) departure reminders scheduled ON the phone (work offline) -------------
  function scheduleTicketReminders() {
    if (!LN) return;
    listTickets().then(function (list) {
      var now = Date.now();
      var notes = [], cancel = [];
      list.forEach(function (t) {
        if (!t || !t.id) return;
        var idRem = hash('rem60_' + t.id), idLate = hash('late_' + t.id);
        if (isDone(t)) { cancel.push({ id: idRem }, { id: idLate }); return; }
        var dep = depEpoch(t);
        if (!dep) return;
        var route = 'ticket.html?id=' + encodeURIComponent(t.id);
        var where = (t.fromLabel || t.from || '') + (t.to ? ' → ' + (t.toLabel || t.to) : '');
        if (dep - 3600000 > now + 30000) {
          notes.push({ id: idRem, title: '🚌 Your bus leaves in 1 hour', body: (where ? where + ' · ' : '') + (t.time || '') + (t.seat ? ' · Seat ' + t.seat : ''),
            channelId: CH.tickets, extra: { route: route, type: 'ticket' }, schedule: { at: new Date(dep - 3600000), allowWhileIdle: true } });
        }
        if (dep + 300000 > now + 30000 && dep < now + 7 * 86400000) {
          notes.push({ id: idLate, title: '⏰ Running late?', body: 'Your bus left at ' + (t.time || '') + '. Tap to reschedule while your seat is held.',
            channelId: CH.tickets, extra: { route: 'events.html?reschedule=' + encodeURIComponent(t.id), type: 'ticket' }, schedule: { at: new Date(dep + 300000), allowWhileIdle: true } });
        }
      });
      if (cancel.length) LN.cancel({ notifications: cancel }).catch(function () {});
      if (notes.length && permissionOk !== false) LN.schedule({ notifications: notes }).catch(function (e) { console.warn('[notify] reminders', e && e.message || e); });
    });
  }

  // ---------- FCM (optional, closed-app delivery) -------------------------------
  function registerPush(fs, uid) {
    if (!PN || MODE !== 'fcm') return;
    PN.addListener('registration', function (t) {
      if (!t || !t.value) return;
      var tag = uid + ':' + t.value;
      if (lsGet('etc_fcm_saved') === tag) return;
      var data = { tokens: {} };
      data.tokens[t.value] = { platform: 'android', updatedAt: Date.now() };
      fs.collection('etc_rtdb_fcm_tokens').doc(uid).set(data, { merge: true }).then(function () {
        lsSet('etc_fcm_saved', tag); lsSet('etc_fcm_token', t.value);
      }).catch(function (e) { console.warn('[push] token save failed', e && e.code || e); });
    });
    PN.addListener('registrationError', function (e) { console.warn('[push] registration error', e); });
    PN.addListener('pushNotificationActionPerformed', function (a) {
      var d = (a && a.notification && a.notification.data) || {};
      go({ uid: d.uid, name: d.name, route: d.route });
    });
    PN.requestPermissions().then(function (r) {
      if (r.receive === 'granted') return PN.register();
    }).catch(function (e) { console.warn('[push]', e && e.message || e); });
  }

  // ---------- lifecycle --------------------------------------------------
  function start(uid) {
    var fs = getFs();
    if (!fs || !uid) return false;
    current = uid;
    readPermission().then(function () {
      watchFriends(fs, uid);
      if (permissionOk !== false) registerPush(fs, uid);
    });
    return true;
  }
  function stop() {
    unsubs.forEach(function (u) { try { u(); } catch (e) {} });
    unsubs = []; watched = {};
    var uid = current; current = null;
    var tok = lsGet('etc_fcm_token');
    var fs = getFs();
    if (uid && tok && fs && window.firebase && firebase.firestore && firebase.firestore.FieldPath) {
      return fs.collection('etc_rtdb_fcm_tokens').doc(uid)
        .update(new firebase.firestore.FieldPath('tokens', tok), firebase.firestore.FieldValue.delete())
        .catch(function () {})
        .then(function () {
          try { localStorage.removeItem('etc_fcm_saved'); localStorage.removeItem('etc_fcm_token'); } catch (e) {}
          if (PN && PN.unregister) return PN.unregister().catch(function () {});
        });
    }
    return Promise.resolve();
  }
  function afterResume() {
    scheduleTicketReminders();
    syncTicketWatchers();
  }

  // The uid appears once the passenger app has signed in (and goes away on logout).
  var tries = 0;
  var iv = setInterval(function () {
    var uid = getUid();
    if (uid && uid !== current) { stop(); start(uid); }
    else if (!uid && current) { stop(); }
    if (++tries > 600) clearInterval(iv);
  }, 3000);
  setTimeout(function () { var u = getUid(); if (u && !current) start(u); }, 800);
  // tickets: watch + schedule right away, then keep in step with new bookings
  setTimeout(afterResume, 1500);
  setInterval(afterResume, 5 * 60 * 1000);
  setInterval(syncTicketWatchers, 60 * 1000);

  // ---------- startup ------------------------------------------------------
  createChannels().then(readPermission);
  if (LN && LN.addListener) {
    LN.addListener('localNotificationActionPerformed', function (a) {
      go((a && a.notification && a.notification.extra) || {});
    });
  }

  // ---------- make the old web code talk to the phone -----------------------------
  // new Notification(...) (calendar reminders, "Bus in N min") -> real Android notification
  function EtcNotification(title, opts) {
    opts = opts || {};
    showFromWeb(title, { body: opts.body, tag: opts.tag, data: opts.data });
    this.close = function () {};
  }
  Object.defineProperty(EtcNotification, 'permission', { get: function () { return permState; } });
  EtcNotification.requestPermission = function (cb) {
    return ensurePermission().then(function (p) { if (cb) cb(p); return p; });
  };
  try { window.Notification = EtcNotification; } catch (e) {}

  var pushApi = {
    ensurePermission: ensurePermission,
    show: showFromWeb,
    initFCM: function () { return null; },
    alarm: function (note, whenIso) {
      return showFromWeb('🚌 ETC Alarm', { body: note || ('Travel day ' + (whenIso || '')), tag: 'etc-alarm-' + (whenIso || Date.now()), data: { type: 'alarm', url: '/?cal=1' } });
    },
    chat: function (from, text, roomId) {
      return showFromWeb(from || 'Coal City Chat', { body: text || 'New message', tag: 'etc-chat-' + (roomId || ''), data: { type: 'chat', url: '/chat/' } });
    },
    ticket: function (title, body, ticketId) {
      return showFromWeb(title, { body: body, tag: 'etc-ticket-' + (ticketId || Date.now()), data: { type: 'ticket', url: ticketId ? '/ticket.html?id=' + ticketId : '/' } });
    },
    occupancy: function (route, mins) {
      return showFromWeb('🚌 Bus filling up', { body: (route || 'Your route') + ' is almost full' + (mins ? ' (' + mins + ' min to departure)' : ''), tag: 'etc-occ-' + route, data: { type: 'ticket', url: '/' } });
    }
  };
  if (!window.ETC_Push) window.ETC_Push = pushApi;

  window.EtcNotify = {
    native: true,
    start: start, stop: stop,
    show: showFromWeb, alert: alertFn, ensurePermission: ensurePermission, readPermission: readPermission,
    scheduleTicketReminders: scheduleTicketReminders, syncTicketWatchers: syncTicketWatchers,
    hash: hash,
    /** Console helper: EtcNotify.test() */
    test: function () { post({ id: hash('t' + Date.now()), title: 'ETC', body: 'Test notification 🔔', channelId: CH.alerts, extra: {} }); }
  };
})();
