/* ETC single-page view router with a live DOM cache.
 *
 * index.html is the SHELL (and the Home view). Every other screen lives in its own view that is KEPT ALIVE:
 *   - tab views  (map.html, events.html)  : created once, then only shown / hidden
 *   - page views (details, search, book, ticket, notifications) : stacked on top of the current tab;
 *     going back removes only the top one - the view underneath is exactly as you left it
 *     (same scroll position, same inputs, same map), nothing is reloaded or redrawn.
 *
 * Views are same-origin <iframe>s inside the shell, so every page keeps running its own scripts, CSS and ids
 * unchanged (no id clashes between cached views). Navigation (links, location.href=..., back buttons) is caught
 * with the Navigation API and turned into show/hide. If the Navigation API is missing, or anything throws,
 * nothing is intercepted and the app navigates the old way (full page loads) - it never gets stuck.
 *
 * The same file runs in two modes:
 *    shell  (top window = index.html)      -> window.ETC_SPA = { go, back, current }
 *    view   (inside one of the iframes)    -> aliases the shell's native layer, routes navigation to the shell
 */
(function () {
  'use strict';
  if (window.__etcSpaLoaded) return;
  window.__etcSpaLoaded = true;

  var TAB_PAGES = { 'map.html': 1, 'events.html': 1 };
  var LAYER_PAGES = { 'details.html': 1, 'search.html': 1, 'book.html': 1, 'ticket.html': 1, 'notifications.html': 1 };
  var HOME = 'index.html';
  var BG = '#DCDDE0';

  var isTop = window.top === window;
  var shell = null;
  try { if (!isTop && window.parent && window.parent.ETC_SPA) shell = window.parent.ETC_SPA; } catch (e) {}

  function rootPath() { return location.pathname.replace(/[^/]*$/, ''); }
  /** -> { page, rel } for a same-app url, or null (other site / not in this folder) */
  function parse(url) {
    try {
      var u = new URL(url, location.href);
      if (u.origin !== location.origin) return null;
      if (u.pathname.replace(/[^/]*$/, '') !== rootPath()) return null;
      var page = u.pathname.split('/').pop() || HOME;
      return { page: page, rel: page + u.search + u.hash };
    } catch (e) { return null; }
  }

  function install(handler) {
    var nav = window.navigation;
    if (!nav || !nav.addEventListener) return false;
    nav.addEventListener('navigate', function (e) {
      try {
        if (!e.cancelable || e.hashChange || e.downloadRequest || e.formData) return;
        if (e.navigationType === 'traverse' || e.navigationType === 'reload') return;
        if (e.destination && e.destination.sameDocument) return;
        if (handler(e.destination.url)) e.preventDefault();
      } catch (err) { /* never block navigation because of a bug here */ }
    });
    return true;
  }

  // =========================================================================== VIEW MODE
  if (shell) {
    window.__etcChild = true;
    // the shell owns the native layer (Capacitor, notifications, alarms, SQLite) - views just use it
    try { if (!window.Capacitor && window.parent.Capacitor) window.Capacitor = window.parent.Capacitor; } catch (e) {}
    ['ETC_CONFIG', 'EtcNative', 'EtcSQLite', 'EtcNotify', 'ETC_Push', 'ETC_NativeAlarm', 'EtcSetup'].forEach(function (k) {
      try { if (window.parent[k] && !window[k]) window[k] = window.parent[k]; } catch (e) {}
    });
    document.documentElement.classList.add('etc-in-view');
    // on-screen back buttons call history.back() / read history.length
    try { window.history.back = function () { shell.back(); }; } catch (e) {}
    try { Object.defineProperty(History.prototype, 'length', { configurable: true, get: function () { return 2; } }); } catch (e) {}
    install(function (url) {
      var p = parse(url);
      if (shell.quiet && shell.quiet()) return false;         // the shell itself is moving this view: let it
      if (!p) return false;                                   // other site: normal navigation
      if (p.page === HOME || TAB_PAGES[p.page] || LAYER_PAGES[p.page]) return shell.go(url);
      try { window.top.location.href = url; } catch (e) { return false; }   // history / games / ai / chat: leave the shell
      return true;
    });
    return;
  }

  // =========================================================================== SHELL MODE
  if (!isTop) return;                                         // framed by something else: do nothing
  var here = location.pathname.split('/').pop() || HOME;
  if (here !== HOME) return;                                  // a page opened on its own: plain old behaviour

  var tabs = {};      // page -> { el, rel, dirty }
  var layers = [];    // [{ el, rel, page }]
  var current = 'home';
  var dirtyEvents = false;

  function mk(rel, z) {
    var f = document.createElement('iframe');
    f.setAttribute('data-etc-view', rel);
    f.setAttribute('title', rel);
    f.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;border:0;margin:0;padding:0;' +
      'background:' + BG + ';z-index:' + z + ';display:block;opacity:0;transition:opacity .14s ease';
    f.addEventListener('load', function () { f.style.opacity = '1'; });
    f.src = rel;
    document.body.appendChild(f);
    // never leave a blank screen if a load event is missed
    setTimeout(function () { f.style.opacity = '1'; }, 1200);
    return f;
  }
  var quietUntil = 0;
  function quietFor(ms) { quietUntil = Date.now() + ms; }
  function kill(f) {
    quietFor(600);
    try { f.src = 'about:blank'; } catch (e) {}
    try { f.parentNode && f.parentNode.removeChild(f); } catch (e) {}
  }
  function wake(win) {
    // tell a view (or the shell) it is visible again so it refreshes what it shows
    try {
      win.dispatchEvent(new Event('etc:show'));
      win.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      win.document.dispatchEvent(new Event('visibilitychange'));
    } catch (e) {}
  }
  function hideAllTabs() { Object.keys(tabs).forEach(function (k) { tabs[k].el.style.display = 'none'; }); }
  function clearLayers() { while (layers.length) kill(layers.pop().el); }

  function paintTop() {
    // exactly one view is visible: the top page view, else the current tab, else Home (the shell itself)
    var top = layers.length ? layers[layers.length - 1] : null;
    hideAllTabs();
    layers.forEach(function (l, i) { l.el.style.display = (i === layers.length - 1) ? 'block' : 'none'; });
    if (top) { wake(top.el.contentWindow); return; }
    if (current !== 'home' && tabs[current]) { tabs[current].el.style.display = 'block'; wake(tabs[current].el.contentWindow); return; }
    wake(window);
  }

  function showHome() { clearLayers(); current = 'home'; paintTop(); }
  function showTab(page, rel) {
    clearLayers();
    var t = tabs[page];
    if (!t) { t = tabs[page] = { el: mk(rel, 6000), rel: rel }; }
    else if (t.rel !== rel) { t.rel = rel; t.el.style.opacity = '0'; quietFor(600); t.el.src = rel; }
    else if (page === 'events.html' && dirtyEvents) { try { t.el.contentWindow.location.reload(); } catch (e) {} }
    if (page === 'events.html') dirtyEvents = false;
    current = page;
    paintTop();
  }
  function openLayer(rel, page) {
    var top = layers[layers.length - 1];
    if (top && top.rel === rel) return;
    // after paying, the ticket replaces the booking screen (back from the ticket must not return to a finished payment)
    if (page === 'ticket.html' && top && top.page === 'book.html') { kill(layers.pop().el); }
    if (page === 'book.html' || page === 'ticket.html') dirtyEvents = true;   // a purchase / ticket changes "My tickets"
    layers.push({ el: mk(rel, 6100 + layers.length), rel: rel, page: page });
    paintTop();
  }
  function popLayer() { var l = layers.pop(); if (l) kill(l.el); paintTop(); }

  function go(url) {
    var p = parse(url);
    if (!p) return false;
    if (p.page === HOME) {
      if (/[?&](cal|open|chat|intro)=/.test(p.rel)) return false;   // Home with special parameters: let it reload
      showHome(); return true;
    }
    if (TAB_PAGES[p.page]) { showTab(p.page, p.rel); return true; }
    if (LAYER_PAGES[p.page]) { openLayer(p.rel, p.page); return true; }
    return false;
  }
  function back() {
    if (layers.length) { popLayer(); return true; }
    if (current !== 'home') { showHome(); return true; }
    return false;
  }

  window.ETC_SPA = { go: go, back: back, quiet: function () { return Date.now() < quietUntil; }, current: function () { return current; }, depth: function () { return layers.length; } };
  install(go);
})();
