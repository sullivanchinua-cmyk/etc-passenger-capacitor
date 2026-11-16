/**
 * ETC alarm bridge (Capacitor edition) - replaces the old TWA intent:// bridge but keeps the same
 * window.ETC_NativeAlarm contract that js/calendar.js already uses.
 *
 * Every upcoming alarm / reminder in localStorage "etc_alarms" (calendar alarms and the automatic
 * pre-departure alarms from tickets) is handed to the native EtcAlarm plugin, which schedules it with
 * AlarmManager. The phone then rings it with the app CLOSED, the phone in Doze, and NO internet.
 */
(function () {
  'use strict';
  var N = window.EtcNative;
  var AL = (N && N.isNative) ? N.plugin('EtcAlarm') : null;
  var LIST_KEY = 'etc_alarms', HASH = 'etc_native_sync_hash', IDS = 'etc_native_sync_ids';

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function readList() { try { return JSON.parse(lsGet(LIST_KEY)) || []; } catch (e) { return []; } }
  function toEpoch(a) {
    var d = String(a.date).split('-'), t = String(a.time || '00:00').split(':');
    return new Date(+d[0], +d[1] - 1, +d[2], +t[0] || 0, +t[1] || 0, 0, 0).getTime();
  }
  function build() {
    var now = Date.now(), out = [];
    readList().forEach(function (a) {
      if (a.fired) return;
      var at = toEpoch(a);
      if (!(at > now)) return;
      out.push({
        id: a.id, at: at, kind: a.kind === 'alarm' ? 'alarm' : 'notif',
        title: a.kind === 'alarm' ? '🚌 ETC Alarm' : '🚌 ETC Reminder',
        body: a.note || ('Travel day: ' + a.date + ' at ' + a.time),
        route: 'index.html?cal=1'
      });
    });
    return out;
  }
  function handledIds() { try { return JSON.parse(lsGet(IDS)) || []; } catch (e) { return []; } }

  var api = {
    isNative: function () { return !!AL; },
    // true when this alarm is already on the phone's alarm clock, so the page must not ring it a second time
    handles: function (id) { return !!AL && handledIds().indexOf(id) !== -1; },
    sync: function (force) {
      if (!AL) return false;
      var alarms = build();
      var hash = alarms.map(function (a) { return a.id + '@' + a.at + '|' + a.body; }).join(';');
      if (!force && hash === (lsGet(HASH) || '')) return false;
      var prevIds = lsGet(IDS);
      lsSet(IDS, JSON.stringify(alarms.map(function (a) { return a.id; })));   // optimistic: the page must not double-ring
      AL.sync({ alarms: alarms }).then(function () { lsSet(HASH, hash); })
        .catch(function (e) {
          console.warn('[alarm] sync failed', e && e.message || e);
          if (prevIds !== null) lsSet(IDS, prevIds);
        });
      return true;
    },
    ringTest: function (delayMs) { return AL ? AL.ringNow({ kind: 'alarm', delayMs: delayMs || 8000 }) : Promise.resolve(); }
  };
  if (!window.ETC_NativeAlarm || AL) window.ETC_NativeAlarm = api;
  if (!AL) return;

  // Alarms the phone already rang while the app was closed must not ring again inside the page.
  function retireHandled() {
    var list = readList(), ids = handledIds(), now = Date.now(), changed = false;
    list.forEach(function (a) {
      if (!a.fired && ids.indexOf(a.id) !== -1 && toEpoch(a) < now - 120000) { a.fired = true; changed = true; }
    });
    if (changed) lsSet(LIST_KEY, JSON.stringify(list));
  }

  function tick() { retireHandled(); api.sync(false); }
  setTimeout(function () { tick(); api.sync(true); }, 900);
  setInterval(tick, 20000);
  N.onResume(tick);
  window.addEventListener('storage', function (e) { if (e.key === LIST_KEY) api.sync(false); });
  document.addEventListener('pointerup', function () { api.sync(false); }, { capture: true, passive: true });

  // A tapped alarm / notification asks for a page (e.g. the calendar)
  function open(route) {
    if (!route) return;
    var here = location.pathname.replace(/^\//, '') + location.search;
    if (here === route) return;
    var root = (window.ETC_CONFIG && ETC_CONFIG.ROOT_URL) || '/';
    location.href = root + route;
  }
  AL.consumeLaunchRoute().then(function (r) { if (r && r.route) open(r.route); }).catch(function () {});
  if (AL.addListener) AL.addListener('launchRoute', function (e) { if (e && e.route) open(e.route); });
})();
