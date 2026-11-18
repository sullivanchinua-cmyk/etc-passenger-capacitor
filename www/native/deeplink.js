/**
 * Ticket links that open the app (like a TikTok link).
 *
 *   https://<SHARE_BASE_URL host>/ticket.html#d=<code>     (what "Share" sends on WhatsApp etc.)
 *   etcbus://ticket?d=<code>                                (fallback scheme, used by the web page's "Open in app" button)
 *
 * In the Android app: Android hands the link to the app (App Link / etcbus://), this file catches it
 * (Capacitor "appUrlOpen", or getLaunchUrl() on a cold start) and opens ticket.html with the code.
 * ticket.js then registers the ticket on this phone (or finds the one already saved), so tapping the
 * same link again always lands on the same ticket and its live QR.
 *
 * In a normal browser on Android: shows a small "Open in ETC app" bar when the page was opened from a link.
 */
(function () {
  'use strict';
  if (window.__etcDeepLink) return;
  window.__etcDeepLink = true;

  var cap = window.Capacitor;
  var isNative = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
  var CFG = window.ETC_CONFIG || {};
  var me = document.currentScript && document.currentScript.src || '';
  var ROOT = CFG.ROOT_URL || (me ? me.replace(/native\/deeplink\.js(\?.*)?$/, '') : (location.origin + '/'));
  var PKG = 'enugubustransit.com';

  function extract(url) {
    var m = /[#?&]d=([A-Za-z0-9_-]{20,})/.exec(String(url || ''));
    return m ? m[1] : null;
  }
  function ss(k, v) {
    try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) {}
    return null;
  }

  // ---------------------------------------------------------------- browser (web) side
  if (!isNative) {
    var code = extract(location.href);
    if (!code || !/Android/i.test(navigator.userAgent) || !/ticket\.html/.test(location.pathname)) return;
    var openUrl = 'intent://ticket?d=' + code + '#Intent;scheme=etcbus;package=' + PKG +
      ';S.browser_fallback_url=' + encodeURIComponent(location.href) + ';end';
    var bar = function () {
      if (document.getElementById('etc-open-app')) return;
      var a = document.createElement('a');
      a.id = 'etc-open-app';
      a.href = openUrl;
      a.textContent = 'Open in ETC app';
      a.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(18px + var(--sab,0px));z-index:2147483000;' +
        'background:#0B0F3A;color:#fff;font:700 14px/1 system-ui,sans-serif;padding:14px 22px;border-radius:999px;' +
        'text-decoration:none;box-shadow:0 8px 24px rgba(11,15,58,.35)';
      document.body.appendChild(a);
    };
    if (document.body) bar(); else document.addEventListener('DOMContentLoaded', bar);
    return;
  }

  // ---------------------------------------------------------------- Android app side
  var app = null;
  try { app = (cap.Plugins && cap.Plugins.App) || cap.registerPlugin('App'); } catch (e) {}
  if (!app) return;

  function go(url) {
    var d = extract(url);
    if (!d) return false;
    // the same link can arrive twice on a cold start (launch url + event): ignore the repeat
    var last = ss('etc_dl_last'), now = Date.now();
    if (last) {
      var p = last.split('|');
      if (p[0] === d.slice(-48) && now - (+p[1] || 0) < 4000) return true;
    }
    ss('etc_dl_last', d.slice(-48) + '|' + now);
    // ?go= makes it a fresh page load even when ticket.html is already open
    location.href = ROOT + 'ticket.html?go=' + now + '#d=' + d;
    return true;
  }

  // app was already running (or in the background) and a link was tapped
  try {
    app.addListener('appUrlOpen', function (ev) { if (ev && ev.url) go(ev.url); });
  } catch (e) {}

  // app was closed and the link started it - only once per app start, not on every page change
  if (!ss('etc_dl_boot') && app.getLaunchUrl) {
    ss('etc_dl_boot', '1');
    app.getLaunchUrl().then(function (r) { if (r && r.url) go(r.url); }).catch(function () {});
  }
})();
