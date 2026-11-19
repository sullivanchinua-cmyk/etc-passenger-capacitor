/* ETC single-page view router with a live DOM cache.
 *
 * index.html is the SHELL (and the Home view). Every other screen lives in its own view that is KEPT ALIVE:
 *   - tab views  (map, events, history, ai, chat)  : created once, then only shown / hidden
 *     (chat and events are also PRE-LOADED in the background a few seconds after Home is up, so the first tap is instant)
 *   - page views (details, search, book, ticket, notifications, games, chat list / chat room) : stacked on top of the current tab;
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

  // page keys are paths relative to the app folder (where index.html lives)
  var TAB_PAGES = { 'map.html': 1, 'events.html': 1, 'history.html': 1, 'ai.html': 1, 'chat/index.html': 1 };
  var LAYER_PAGES = {
    'details.html': 1, 'search.html': 1, 'book.html': 1, 'ticket.html': 1, 'notifications.html': 1, 'games.html': 1,
    'chat/pages/chat.html': 1, 'chat/pages/chatroom.html': 1
  };
  var KEEP_ONE = /^chat\/pages\//;   // opening a chat page that is already in the stack returns to it instead of stacking a copy
  var HOME = 'index.html';
  var BG = '#DCDDE0';

  var isTop = window.top === window;
  var shell = null;
  try { if (!isTop && window.parent && window.parent.ETC_SPA) shell = window.parent.ETC_SPA; } catch (e) {}

  function dirOf(path) { return path.replace(/[^/]*$/, ''); }
  // the app folder = the folder of index.html (the shell). Views in sub-folders (chat/) use the shell's.
  var APP_ROOT = shell ? shell.root : dirOf(location.pathname);
  /** -> { page, rel } for a same-app url (page is relative to the app folder), or null (other site / outside the app) */
  function parse(url) {
    try {
      var u = new URL(url, location.href);
      if (u.origin !== location.origin) return null;
      if (u.pathname.indexOf(APP_ROOT) !== 0) return null;
      var page = u.pathname.slice(APP_ROOT.length) || HOME;
      return { page: page, rel: page + u.search + u.hash };
    } catch (e) { return null; }
  }
  function known(page) { return page === HOME || !!TAB_PAGES[page] || !!LAYER_PAGES[page]; }

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
    var own = parse(location.href);                         // this view's own address (to let a page reload itself)
    install(function (url) {
      var p = parse(url);
      if (shell.quiet && shell.quiet(window)) return false; // the shell itself is moving this view: let it
      if (!p) return false;                                 // other site: normal navigation
      if (own && p.rel === own.rel) return false;           // same page again (e.g. logout -> reload): let it
      if (known(p.page)) return shell.go(url);
      if (/\.html?$/.test(p.page)) { try { window.top.location.href = url; } catch (e) { return false; } return true; }   // a page the shell does not cache: leave the shell
      return false;                                         // files, downloads, assets: normal
    });
    return;
  }

  // =========================================================================== SHELL MODE
  if (!isTop) return;                                         // framed by something else: do nothing
  var here = location.pathname.split('/').pop() || HOME;
  if (here !== HOME) return;                                  // a page opened on its own: plain old behaviour

  var tabs = {};      // page -> { el, rel }
  var layers = [];    // [{ el, rel, page }]
  var current = 'home';
  var dirty = {};     // tab page -> true when a purchase / ticket change means it must reload next time it is shown
  var hiddenAt = {};  // view key -> when it was last hidden (quick switches do not re-fire pageshow)
  var lastTarget = 'home';
  var QUICK_MS = 20000;
  var rootEl = document.documentElement;

  function keyOf(el) { return el.getAttribute('data-etc-view') || 'home'; }

  function mk(rel, z, preload) {
    var f = document.createElement('iframe');
    f.setAttribute('data-etc-view', rel);
    f.setAttribute('title', rel);
    f.setAttribute('allow', 'geolocation; microphone; camera; autoplay; clipboard-write; fullscreen');
    var base = 'position:fixed;left:0;top:0;width:100%;height:100%;border:0;margin:0;padding:0;' +
      'background:' + BG + ';z-index:' + z + ';display:block;';
    if (preload) {
      // laid out at full size (so the page measures itself correctly) but invisible and untouchable until it is wanted
      f.__pre = true;
      f.style.cssText = base + 'visibility:hidden;pointer-events:none;opacity:1';
    } else {
      f.style.cssText = base + 'opacity:0;transition:opacity .14s ease;will-change:opacity';
    }
    f.addEventListener('load', function () {
      f.style.opacity = '1';
      if (f.__pre) {
        f.__pre = false;
        f.style.visibility = 'visible'; f.style.pointerEvents = '';
        if (lastTarget !== f) f.style.display = 'none';          // finished loading in the background: park it
      }
    });
    f.src = rel;
    document.body.appendChild(f);
    // never leave a blank screen if a load event is missed
    if (!preload) setTimeout(function () { f.style.opacity = '1'; }, 1200);
    return f;
  }
  // windows the shell is moving itself (being closed / pointed at a new address): THEIR navigation must not be
  // intercepted - but every other view keeps working, even a tap a split second later
  var quietWins = [];
  function quietWin(w, ms) {
    if (!w) return;
    quietWins.push(w);
    setTimeout(function () { var i = quietWins.indexOf(w); if (i >= 0) quietWins.splice(i, 1); }, ms);
  }
  function kill(f) {
    try { quietWin(f.contentWindow, 1500); } catch (e) {}
    try { f.src = 'about:blank'; } catch (e) {}
    try { f.parentNode && f.parentNode.removeChild(f); } catch (e) {}
  }
  function wake(win, key) {
    // tell a view (or the shell) it is visible again so it refreshes what it shows.
    // Quick switches (< 20 s away) only get the light "etc:show" - no pageshow / visibilitychange storm, so nothing redraws.
    try {
      win.dispatchEvent(new Event('etc:show'));
      var t = hiddenAt[key];
      if (t && Date.now() - t < QUICK_MS) return;
      win.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      win.document.dispatchEvent(new Event('visibilitychange'));
    } catch (e) {}
  }
  function clearLayers() { while (layers.length) kill(layers.pop().el); }

  function paintTop() {
    // exactly one view is visible: the top page view, else the current tab, else Home (the shell itself)
    var top = layers.length ? layers[layers.length - 1] : null;
    var target = top ? top.el : ((current !== 'home' && tabs[current]) ? tabs[current].el : null);
    var now = Date.now();
    if (target && lastTarget === 'home') hiddenAt.home = now;
    var all = [];
    Object.keys(tabs).forEach(function (k) { all.push(tabs[k].el); });
    layers.forEach(function (l) { all.push(l.el); });
    all.forEach(function (el) {
      if (el === target) return;
      if (el.style.display !== 'none') {
        el.style.display = 'none';
        hiddenAt[keyOf(el)] = now;
        try { el.contentWindow.dispatchEvent(new Event('etc:hide')); } catch (e) {}
      }
    });
    if (target) {
      var was = target.style.display === 'none' || lastTarget !== target;
      target.style.display = 'block';
      target.style.visibility = 'visible'; target.style.pointerEvents = '';
      rootEl.classList.add('etc-view-hidden');                   // Home is covered: pause its animations
      if (was) wake(target.contentWindow, keyOf(target));
    } else {
      rootEl.classList.remove('etc-view-hidden');
      if (lastTarget !== 'home') wake(window, 'home');
    }
    lastTarget = target || 'home';
  }

  function showHome() { clearLayers(); current = 'home'; paintTop(); }
  function showTab(page, rel) {
    clearLayers();
    var t = tabs[page];
    if (!t) { t = tabs[page] = { el: mk(rel, 6000), rel: rel }; }
    else if (t.rel !== rel) { t.rel = rel; t.el.style.opacity = '0'; try { quietWin(t.el.contentWindow, 600); } catch (e) {} t.el.src = rel; }
    else if (dirty[page]) { try { t.el.contentWindow.location.reload(); } catch (e) {} }
    dirty[page] = false;
    current = page;
    paintTop();
  }
  function openLayer(rel, page) {
    var top = layers[layers.length - 1];
    if (top && top.rel === rel) return;
    // chat pages: going "back" to the list / room that is already open returns to it (no stacked copies)
    if (KEEP_ONE.test(page)) {
      for (var i = layers.length - 1; i >= 0; i--) {
        if (layers[i].page === page) {
          while (layers.length - 1 > i) kill(layers.pop().el);
          if (layers[i].rel === rel) { paintTop(); return; }
          kill(layers.pop().el);                                  // same page, different chat: replace it
          break;
        }
      }
    }
    // after paying, the ticket replaces the booking screen (back from the ticket must not return to a finished payment)
    if (page === 'ticket.html' && top && top.page === 'book.html') { kill(layers.pop().el); }
    if (page === 'book.html' || page === 'ticket.html') { dirty['events.html'] = true; dirty['history.html'] = true; }   // a purchase / ticket changes "My tickets"
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

  // ---- background pre-loading: the heavy screens are ready before the first tap ----
  var idle = window.requestIdleCallback || function (f) { return setTimeout(f, 400); };
  function preload(page) {
    if (tabs[page] || !TAB_PAGES[page]) return;
    tabs[page] = { el: mk(page, 6000, true), rel: page };
  }
  function schedulePreload() {
    try {
      if (/[?&]nopreload/.test(location.search)) return;
      var c = navigator.connection; if (c && c.saveData) return;
      var list = [], mem = navigator.deviceMemory || 4, uid = null;
      try { uid = localStorage.getItem('etc_chat_uid'); } catch (e) {}
      if (uid) list.push('chat/index.html');               // chat first (the one that felt slow), only for a signed-in person
      if (mem >= 3) list.push('events.html');              // low-memory phones: the rest loads on first visit, then stays cached
      var i = 0;
      (function next() {
        if (i >= list.length) return;
        if (document.hidden) { setTimeout(next, 3000); return; }
        preload(list[i++]);
        setTimeout(function () { idle(next, { timeout: 6000 }); }, 2500);
      })();
    } catch (e) {}
  }
  function startPreload() { setTimeout(function () { idle(schedulePreload, { timeout: 8000 }); }, 6000); }
  if (document.readyState === 'complete') startPreload(); else window.addEventListener('load', startPreload);

  window.ETC_SPA = { root: APP_ROOT, go: go, back: back, preload: preload, quiet: function (w) { return quietWins.indexOf(w) >= 0; }, current: function () { return current; }, depth: function () { return layers.length; } };
  install(go);
})();
