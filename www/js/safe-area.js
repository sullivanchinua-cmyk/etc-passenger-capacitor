/* ETC safe area - ONE place that keeps every page clear of the Android status bar
 * (clock, battery, signal) and the bottom navigation bar, and paints both in navy.
 *
 * Load it first in <head> of every page:   <script src="js/safe-area.js"></script>
 *
 * It sets two CSS variables on <html>:
 *     --sat   height of the status bar          (top inset)
 *     --sab   height of the bottom system bar   (bottom inset)
 * Everything in the app uses var(--sat) / var(--sab) instead of env(safe-area-inset-*),
 * because the Android WebView often reports env() as 0 - Capacitor then publishes the real
 * numbers as --safe-area-inset-top / --safe-area-inset-bottom, so we read both and take the larger.
 * The last good numbers are cached, so the next page already starts with the right padding.
 */
(function () {
  'use strict';
  if (window.__etcSafeArea) return;
  window.__etcSafeArea = true;

  var NAVY = '#0B0F3A';
  var root = document.documentElement;
  var KEY_T = 'etc_sat', KEY_B = 'etc_sab';

  function num(v) { v = parseFloat(v); return isFinite(v) && v > 0 ? v : 0; }
  function ls(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {}
    return null;
  }

  // 1) first paint: last known values (0 on the very first launch)
  var top = num(ls(KEY_T)), bottom = num(ls(KEY_B));

  // 2) CSS: the base rules every page gets
  var css =
    ':root{--sat:' + top + 'px;--sab:' + bottom + 'px;--etc-navy:' + NAVY + '}' +
    // page content starts below the status bar (home keeps its own header offsets, see styles.css)
    'body:not(.home-lite):not(.etc-sa-own){padding-top:var(--sat,0px)!important}' +
    // fixed / sticky top bars (Tailwind "top-0" bars in chat) sit below the status bar
    'nav.fixed.top-0,header.fixed.top-0,nav.sticky.top-0,header.sticky.top-0{top:var(--sat,0px)!important}' +
    // navy strips drawn behind the system bars (never take taps)
    '#etc-sa-top,#etc-sa-bot{position:fixed;left:0;right:0;background:' + NAVY + ';pointer-events:none;z-index:2147483647;display:none}' +
    '#etc-sa-top{top:0;height:var(--sat,0px)}' +
    '#etc-sa-bot{bottom:0;height:var(--sab,0px)}';
  var st = document.createElement('style');
  st.id = 'etc-safe-area-css';
  st.appendChild(document.createTextNode(css));
  (document.head || root).appendChild(st);

  // 3) the two navy strips (shown only when the inset is > 0)
  function ensureBars() {
    if (!document.body) return;
    ['etc-sa-top', 'etc-sa-bot'].forEach(function (id) {
      if (!document.getElementById(id)) {
        var d = document.createElement('div');
        d.id = id; d.setAttribute('aria-hidden', 'true');
        document.body.appendChild(d);
      }
    });
    document.getElementById('etc-sa-top').style.display = top > 0 ? 'block' : 'none';
    document.getElementById('etc-sa-bot').style.display = bottom > 0 ? 'block' : 'none';
  }

  // 4) measure: env() and Capacitor's --safe-area-inset-* , whichever is bigger
  function probe(side) {
    var el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
      'padding-' + side + ':max(env(safe-area-inset-' + side + ',0px),var(--safe-area-inset-' + side + ',0px))';
    (document.body || root).appendChild(el);
    var v = num(getComputedStyle(el)[side === 'top' ? 'paddingTop' : 'paddingBottom']);
    el.parentNode && el.parentNode.removeChild(el);
    return v;
  }
  function apply() {
    var t = probe('top'), b = probe('bottom');
    // keep a previous good value if a late re-measure briefly reports 0 while the keyboard is open
    if (t > 0 || !top) top = t;
    if (b > 0 || !bottom) bottom = b;
    root.style.setProperty('--sat', top + 'px');
    root.style.setProperty('--sab', bottom + 'px');
    ls(KEY_T, String(top)); ls(KEY_B, String(bottom));
    ensureBars();
  }

  function start() {
    apply();
    // Capacitor publishes its numbers a moment after load, and again on rotation
    [120, 400, 1000, 2500].forEach(function (ms) { setTimeout(apply, ms); });
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', function () { setTimeout(apply, 200); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) apply(); });
  }
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
