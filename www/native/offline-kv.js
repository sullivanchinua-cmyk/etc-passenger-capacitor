/**
 * Offline safety net for the passenger app's own data (tickets, notes, profile, alarms, settings).
 *
 * The app keeps this data in localStorage / IndexedDB, which already works offline. This file also mirrors it
 * into SQLite (the app's database, not touched by WebView cache clean-ups) and restores it if the WebView
 * storage ever comes back empty. Nothing here needs the internet.
 */
(function () {
  var S = window.EtcSQLite;
  if (!S || !S.ready) return;

  var SKIP = /^(etc_notified|etc_native_|etc_tkst_|etc_fcm_|etc_setup_done|etc_kv_|etc_unread_tick|etc_remote_)/;
  var MAX_BYTES = 400 * 1024;
  var ready = false;

  function mirrorable(k) { return typeof k === 'string' && k.indexOf('etc_') === 0 && !SKIP.test(k); }

  S.ready.then(function (ok) {
    if (!ok) return;
    ready = true;
    // 1) mirror every future write
    try {
      var proto = Storage.prototype;
      var set = proto.setItem, rem = proto.removeItem;
      proto.setItem = function (k, v) {
        set.apply(this, arguments);
        if (this === window.localStorage && mirrorable(k) && String(v).length < MAX_BYTES) S.kvPut(k, v);
      };
      proto.removeItem = function (k) {
        rem.apply(this, arguments);
        if (this === window.localStorage && mirrorable(k)) S.kvDelete(k);
      };
    } catch (e) {}

    // 2) first pass: save what is there now
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (mirrorable(k)) { var v = localStorage.getItem(k); if (v != null && v.length < MAX_BYTES) S.kvPut(k, v); }
      }
    } catch (e) {}

    // 3) restore keys the WebView lost (never overwrite)
    S.kvAll().then(function (all) {
      var restored = 0;
      Object.keys(all).forEach(function (k) {
        try { if (localStorage.getItem(k) == null) { Storage.prototype.setItem.call(localStorage, k, all[k]); restored++; } } catch (e) {}
      });
      if (restored && !sessionStorage.getItem('etc_kv_reloaded')) {
        sessionStorage.setItem('etc_kv_reloaded', '1');
        location.reload();
      }
    });

    wrapStore();
  });

  // tickets + in-app notifications live in IndexedDB (Dexie): mirror them too and restore when empty
  function wrapStore() {
    var tries = 0;
    var iv = setInterval(function () {
      var St = window.ETC_Store;
      if (!St && ++tries < 50) return;
      clearInterval(iv);
      if (!St || St._etcMirrored) return;
      St._etcMirrored = true;
      function wrap(name, coll, idOf, delName) {
        var orig = St[name];
        if (typeof orig !== 'function') return;
        St[name] = function (obj) {
          try { if (obj) S.storePut(coll, idOf(obj), obj); } catch (e) {}
          return orig.apply(this, arguments);
        };
        if (delName && typeof St[delName] === 'function') {
          var od = St[delName];
          St[delName] = function (id) { try { S.storeDelete(coll, id); } catch (e) {} return od.apply(this, arguments); };
        }
      }
      wrap('putTicket', 'tickets', function (t) { return t.id; }, 'deleteTicket');
      wrap('putNote', 'notes', function (n) { return n.id; }, 'deleteNote');

      // restore when the local database is empty but SQLite still has the rows
      Promise.resolve(St.listTickets ? St.listTickets() : []).then(function (list) {
        if (list && list.length) { list.forEach(function (t) { S.storePut('tickets', t.id, t); }); return; }
        S.storeAll('tickets').then(function (rows) { rows.forEach(function (t) { try { orig(St, 'putTicket', t); } catch (e) {} }); });
        function orig(St2, n, o) { return St2[n].call(St2, o); }
      }).catch(function () {});
    }, 100);
  }
})();
