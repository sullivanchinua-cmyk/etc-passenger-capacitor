/**
 * ETC setup screen: the permissions and settings that let alarms and notifications work with the app
 * closed, offline, or in the background. Shown once on first launch; open it any time with
 * EtcSetup.open() (the notifications page and the calendar alarm sheet have a button for it).
 */
(function () {
  'use strict';
  var N = window.EtcNative;
  var AL = (N && N.isNative) ? N.plugin('EtcAlarm') : null;
  if (!AL) { window.EtcSetup = { open: function () {} }; return; }

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function status() {
    return Promise.all([
      AL.status(),
      window.EtcNotify && EtcNotify.readPermission ? EtcNotify.readPermission() : Promise.resolve(true)
    ]).then(function (r) {
      var s = r[0] || {};
      s.notifications = !!(s.notifications && r[1] !== false);
      return s;
    });
  }

  var STEPS = [
    { key: 'notifications', icon: '🔔', title: 'Notifications with sound',
      text: 'Tickets, seat updates, price changes, replies and chat messages appear in the notification panel and ring.',
      ok: function (s) { return !!s.notifications; },
      act: function () { return window.EtcNotify.ensurePermission().then(function (p) { if (p !== 'granted') return AL.openNotificationSettings(); }); } },
    { key: 'exactAlarm', icon: '⏰', title: 'Alarms exactly on time',
      text: 'Lets your calendar and bus alarms ring at the exact minute, even in battery saver.',
      ok: function (s) { return !!s.exactAlarm; }, act: function () { return AL.requestExactAlarm(); } },
    { key: 'fullScreen', icon: '📱', title: 'Alarm screen over the lock screen',
      text: 'Wakes the screen and shows Dismiss / Snooze when an alarm rings.',
      ok: function (s) { return !!s.fullScreen; }, act: function () { return AL.requestFullScreen(); } },
    { key: 'batteryIgnored', icon: '🔋', title: 'Allow background activity',
      text: 'Stops Android from putting ETC to sleep, so alerts keep arriving while the app is in the background.',
      ok: function (s) { return !!s.batteryIgnored; }, act: function () { return AL.requestBattery(); } },
    { key: 'keepAlive', icon: '📡', title: 'Background listener',
      text: 'Keeps ETC listening for ticket updates, price changes and chat while you use other apps. Shows a small silent notification.',
      ok: function (s) { return !!s.keepAlive; },
      act: function (s) { return s.keepAlive ? AL.stopKeepAlive() : AL.startKeepAlive(); },
      label: function (s) { return s.keepAlive ? 'On' : 'Turn on'; }, toggle: true },
    { key: 'autostart', icon: '🚀', title: 'Auto-start (Tecno, Infinix, itel, Xiaomi, Oppo, Vivo…)',
      text: 'These phones can stop apps in the background. Open the screen and allow ETC to auto-start / run in background.',
      ok: function () { return null; }, act: function () { return AL.openAutostart(); }, label: function () { return 'Open'; } }
  ];

  var root = null;

  function row(step, s) {
    var ok = step.ok(s);
    var label = step.label ? step.label(s) : (ok ? 'Done' : 'Allow');
    var badge = ok === true ? '#16a34a' : '#1a237e';
    var btnText = ok === true && !step.toggle ? '✓ ' + label : label;
    return '<div style="display:flex;gap:12px;align-items:flex-start;padding:14px 0;border-bottom:1px solid rgba(17,17,18,.08)">' +
      '<div style="font-size:24px;line-height:1">' + step.icon + '</div>' +
      '<div style="flex:1;min-width:0"><div style="font-weight:700;font-size:15px;color:#111112">' + esc(step.title) + '</div>' +
      '<div style="font-size:12.5px;color:#6b7280;margin-top:3px;line-height:1.4">' + esc(step.text) + '</div></div>' +
      '<button data-k="' + step.key + '" style="flex-shrink:0;border:none;border-radius:999px;padding:8px 14px;font-weight:700;font-size:13px;color:#fff;background:' + badge + '">' + esc(btnText) + '</button></div>';
  }

  function render(s) {
    if (!root) return;
    var body = root.querySelector('#_etcSetupBody');
    body.innerHTML = STEPS.map(function (st) { return row(st, s); }).join('');
    STEPS.forEach(function (st) {
      var b = body.querySelector('[data-k="' + st.key + '"]');
      if (!b) return;
      b.onclick = function () {
        b.disabled = true;
        Promise.resolve(st.act(s)).catch(function () {}).then(function () { return refresh(); });
      };
    });
  }
  function refresh() { return status().then(render); }

  function open() {
    if (root) return;
    root = document.createElement('div');
    root.id = '_etcSetup';
    root.style.cssText = 'position:fixed;inset:0;z-index:99990;background:rgba(17,17,18,.55);display:flex;align-items:flex-end;justify-content:center;font-family:inherit';
    root.innerHTML =
      '<div style="background:#fff;border-radius:24px 24px 0 0;width:100%;max-width:520px;max-height:92vh;display:flex;flex-direction:column">' +
        '<div style="padding:20px 20px 6px"><div style="font-size:19px;font-weight:800;color:#111112">Never miss your bus 🚌</div>' +
        '<div style="font-size:13px;color:#6b7280;margin-top:4px">Turn these on so alarms and alerts ring online or offline, even when the app is closed.</div></div>' +
        '<div id="_etcSetupBody" style="padding:0 20px;overflow-y:auto;flex:1"></div>' +
        '<div style="padding:14px 20px 22px;display:flex;gap:10px">' +
          '<button id="_etcTestAlarm" style="flex:1;border:1px solid #1a237e;background:#fff;color:#1a237e;border-radius:999px;padding:12px;font-weight:700;font-size:14px">Test alarm (8s)</button>' +
          '<button id="_etcSetupDone" style="flex:1;border:none;background:linear-gradient(135deg,#0B0F3A,#1a237e);color:#fff;border-radius:999px;padding:12px;font-weight:700;font-size:14px">Done</button>' +
        '</div></div>';
    document.body.appendChild(root);
    var closer = function () { close(); };
    N.pushBack(closer);
    function close() { N.popBack(closer); if (root) { root.remove(); root = null; } lsSet('etc_setup_done', '1'); }
    root.querySelector('#_etcSetupDone').onclick = close;
    root.querySelector('#_etcTestAlarm').onclick = function () {
      AL.ringNow({ kind: 'alarm', delayMs: 8000, title: '🚌 ETC test alarm', body: 'Lock your phone and wait: it will ring loudly.' });
      var t = root.querySelector('#_etcTestAlarm'); t.textContent = 'Ringing in 8s…';
    };
    refresh();
  }

  N.onResume(function () { if (root) refresh(); });
  window.EtcSetup = { open: open, status: status };

  // first launch: walk the person through it once (home page only)
  if (!lsGet('etc_setup_done') && /(^|\/)(index\.html)?$/.test(location.pathname) && location.pathname.indexOf('/chat/') === -1) {
    setTimeout(function () { if (!lsGet('etc_setup_done')) open(); }, 2500);
  }

  // entry points: notifications page + calendar alarm sheet
  document.addEventListener('DOMContentLoaded', function () {
    var list = document.getElementById('list');
    if (list && /notifications\.html$/.test(location.pathname)) {
      var b = document.createElement('button');
      b.textContent = '⚙️ Notification & alarm settings';
      b.style.cssText = 'width:100%;margin-top:14px;padding:13px;border:none;border-radius:16px;background:#111112;color:#fff;font-weight:700;font-size:14px';
      b.onclick = open;
      list.parentNode.insertBefore(b, list);
    }
    function patchHint() {
      var hint = document.querySelector('.alarm-hint:not([data-etc])');
      if (!hint) return;
      hint.setAttribute('data-etc', '1');
      hint.innerHTML = 'Alarms ring even when the app is closed or offline. <a href="#" style="color:#1a237e;font-weight:700;text-decoration:underline">Check settings</a>';
      hint.querySelector('a').onclick = function (e) { e.preventDefault(); open(); };
    }
    patchHint();
    new MutationObserver(patchHint).observe(document.body, { childList: true, subtree: true });
  });
})();
