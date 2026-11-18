/*!
 * ETC Intro v2 — drop-in intro that morphs into the app.
 *
 * Usage (put in <head>, before the app UI, no defer/async):
 *   <script src="etc-intro.js"
 *           data-home="#app"              // element that holds the app UI (made inert while the intro plays)
 *           data-target="[data-etc-bus]"  // the bus element on Home the intro lands on
 *           data-reveal="[data-etc-reveal]"></script>   // Home items that rise in after the bus lands
 *
 * Everything else (markup, CSS, motion) is in this one file. bus.png must sit next to it.
 * Optional: data-once="session" (play once per app session) or "true" (only first launch ever); data-bus="path/to/bus.png".
 * With no landing target the bus simply drives off along its ground line and fades while Home rises in.
 * Logo animation (Intro v4, no video file): data-logo="assets/intro" (folder holding logo-left.webp + logo-right.webp) plays the
 *   Enugu State Government -> Enugu Smart Bus reveal as a pure Web Animations timeline, then FLIPs it up into the layout as the brand
 *   lockup while the bus drives in. Extras: data-sound="assets/intro/intro-sound.m4a" (optional; silent if the browser blocks it),
 *   data-logo-dock="3300" (ms at which it flies up). ?nologo skips it.
 * API:  ETCIntro.play()  replay · ETCIntro.skip()  jump to app · event 'etc-intro:done' on window
 */
(function () {
  'use strict';
  if (window.ETCIntro) return;

  var S = document.currentScript;
  var D = (S && S.dataset) || {};
  var BASE = S && S.src ? S.src.replace(/[^\/?#]*([?#].*)?$/, '') : '';
  var Q = new URLSearchParams(location.search);

  var CFG = {
    bus: D.bus || BASE + 'bus.png',
    home: D.home || '',
    target: D.target || '[data-etc-bus]',
    reveal: D.reveal || '[data-etc-reveal]',
    once: D.once === 'true' || D.once === 'session',   // true = first launch ever, session = once per app session
    onceSession: D.once === 'session',
    manual: D.manual === 'true',      // true = don't auto-start
    logo: (Q.has('nologo') || Q.has('novideo')) ? '' : (D.logo || ''),   // folder with the logo layers played before the bus scene ('' = none)
    sound: D.sound || '',
    logoDock: parseFloat(D.logoDock) || 3300,                 // ms where the lockup has settled and flies into the layout
    debug: Q.has('introdebug')        // test hook: frames are paused and seekable
  };

  var ANGLE = 10;                      // ground-line angle of the bus photo, degrees
  var TAN = Math.tan(ANGLE * Math.PI / 180);
  var EXPO = 'cubic-bezier(.16,1,.3,1)';
  var IOS = 'cubic-bezier(.32,.72,0,1)';
  var BRAKE = 'cubic-bezier(.3,.55,.25,1)';

  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  var CSS = '\
#etc-intro{position:fixed;inset:0;z-index:2147483000;overflow:hidden;color:#fff;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;\
padding:0 24px max(40px,calc(var(--sab, 0px) + 24px));font-family:"Plus Jakarta Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;\
-webkit-font-smoothing:antialiased;user-select:none;-webkit-user-select:none;touch-action:manipulation}\
:where(#etc-intro *){box-sizing:border-box;margin:0;padding:0}\
html.etc-intro-lock,html.etc-intro-lock body{overflow:hidden!important;overscroll-behavior:none}\
#etc-intro .ei-x{visibility:hidden}\
#etc-intro.ei-run .ei-x,#etc-intro.ei-static .ei-x{visibility:visible}\
.ei-bg{position:absolute;inset:0;z-index:0;overflow:hidden;background:\
radial-gradient(ellipse 90% 60% at 50% 34%,rgba(11,40,60,.6) 0%,transparent 65%),\
radial-gradient(ellipse 70% 40% at 50% 82%,rgba(0,80,90,.28) 0%,transparent 55%),\
linear-gradient(180deg,#05070f 0%,#0a0e1a 42%,#05070f 100%)}\
.ei-p{position:absolute;bottom:-12px;border-radius:50%;background:rgba(78,205,196,.45);animation:ei-rise linear infinite;will-change:transform,opacity}\
@keyframes ei-rise{0%{transform:translate3d(0,0,0);opacity:0}12%{opacity:.7}88%{opacity:.35}100%{transform:translate3d(0,-110vh,0);opacity:0}}\
.ei-stage{position:absolute;left:0;right:0;top:calc(6% + var(--sat, 0px));height:56%;display:flex;align-items:center;justify-content:center;z-index:2}\
.ei-slot{--W:min(92vw,460px,calc(38dvh * 2.05));position:relative;width:var(--W)}\
.ei-floor{position:absolute;left:50%;top:86%;width:300vw;height:calc(var(--W) * .6);transform:translateX(-50%) rotate(-' + ANGLE + 'deg);\
-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 30%,#000 70%,transparent 100%);mask-image:linear-gradient(90deg,transparent 0,#000 30%,#000 70%,transparent 100%)}\
.ei-lane{position:absolute;left:0;right:0}\
.ei-fly{position:relative;width:100%;will-change:transform}\
.ei-bus{position:relative;width:100%;will-change:transform}\
.ei-pitch{position:relative;width:100%;transform-origin:50% 92%}\
.ei-img{display:block;width:100%;height:auto;pointer-events:none;-webkit-user-drag:none}\
.ei-shadow{position:absolute;left:-2%;top:77%;width:96%;height:17%;border-radius:50%;transform:rotate(-' + ANGLE + 'deg);\
background:radial-gradient(ellipse at 50% 50%,rgba(0,0,0,.7) 0%,rgba(0,0,0,.35) 45%,transparent 72%)}\
.ei-glow{position:absolute;left:6%;top:82%;width:84%;height:20%;border-radius:50%;transform:rotate(-' + ANGLE + 'deg);\
background:radial-gradient(ellipse at 50% 50%,rgba(78,205,196,.42) 0%,transparent 68%)}\
.ei-copy{position:relative;z-index:5;width:100%;max-width:380px;text-align:center}\
.ei-brand{display:inline-flex;align-items:center;gap:8px;margin-bottom:18px}\
.ei-mark{width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;font-style:italic;color:rgba(255,255,255,.75)}\
.ei-brand-name{font-size:13px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.55)}\
.ei-h1{font-size:clamp(26px,7vw,32px);font-weight:800;line-height:1.2;letter-spacing:-.02em;margin-bottom:12px}\
.ei-line{display:block;overflow:hidden;padding-bottom:.14em;margin-bottom:-.14em}\
.ei-in{display:block}\
.ei-grad{background:linear-gradient(90deg,#fff 40%,#4ecdc4 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent}\
.ei-sub{font-size:15px;font-weight:500;line-height:1.5;color:rgba(255,255,255,.58);margin:0 auto 32px;max-width:300px}\
.ei-cta-wrap{display:inline-block;pointer-events:none}\
.ei-cta-wrap.ei-on{pointer-events:auto}\
.ei-cta{display:inline-flex;align-items:center;gap:12px;background:linear-gradient(135deg,#4ecdc4 0%,#2a9d8f 100%);color:#041012;font-family:inherit;font-weight:700;font-size:16px;line-height:1;\
padding:16px 28px 16px 18px;border-radius:999px;border:0;cursor:pointer;text-decoration:none;box-shadow:0 8px 28px rgba(78,205,196,.35),0 2px 8px rgba(0,0,0,.3);\
transition:transform .35s ' + EXPO + ',box-shadow .35s ' + EXPO + ';-webkit-tap-highlight-color:transparent}\
.ei-cta:active{transform:scale(.96);box-shadow:0 4px 16px rgba(78,205,196,.3),0 1px 4px rgba(0,0,0,.3)}\
.ei-cta:focus-visible,.ei-skip:focus-visible{outline:2px solid #fff;outline-offset:3px}\
.ei-cta-ic{width:36px;height:36px;border-radius:50%;background:rgba(4,16,18,.18);display:flex;align-items:center;justify-content:center;flex-shrink:0}\
.ei-cta-ic svg{width:18px;height:18px;stroke:#041012;stroke-width:2.4;fill:none;stroke-linecap:round;stroke-linejoin:round}\
.ei-cta-arrows{letter-spacing:-2px;opacity:.7;font-weight:600;margin-left:6px}\
.ei-skip{position:absolute;z-index:6;right:8px;top:calc(var(--sat, 0px) + 6px);min-width:56px;min-height:44px;padding:0 14px;background:none;border:0;font-family:inherit;font-weight:600;font-size:13px;line-height:1;color:rgba(255,255,255,.6);cursor:pointer;-webkit-tap-highlight-color:transparent}\
.ei-vid{position:absolute;z-index:1;left:0;right:0;margin:0 auto;display:block;--vw:min(92vw,560px);--vh:calc(var(--vw) * .5556);width:var(--vw);height:var(--vh);top:calc(47% - var(--vh) / 2);\
opacity:0;transform-origin:0 0;pointer-events:none;contain:layout}\
.ei-vid>*{position:absolute;pointer-events:none;-webkit-user-drag:none;user-select:none}\
.ei-lg{top:32.3%;height:37.7%;will-change:transform,opacity,filter}\
.ei-lg-l{left:4.17%;width:48.15%}.ei-lg-r{left:55.2%;width:43.17%}\
.ei-lg img{display:block;width:100%;height:100%}\
.ei-lg svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}\
.ei-lg img{position:absolute;inset:0}\
.ei-streak{top:30%;height:40%;width:9%;left:0;background:linear-gradient(90deg,transparent,rgba(120,255,170,.0) 10%,rgba(200,255,225,.95) 50%,rgba(120,255,170,0) 90%,transparent);filter:blur(10px);mix-blend-mode:screen;opacity:0}\
#etc-intro.ei-docked .ei-vid{--vw:min(62vw,260px);top:calc(var(--sat, 0px) + 60px - var(--vh) / 2)}\
#etc-intro.ei-vrun .ei-skip{visibility:visible}\
@media (max-height:600px){.ei-sub{display:none}.ei-brand{margin-bottom:10px}.ei-h1{font-size:22px;margin-bottom:14px}.ei-stage{height:64%}}\
';

  var HTML = '\
<div class="ei-bg"><div class="ei-particles"></div></div>\
<button class="ei-skip ei-x" type="button" aria-label="Skip intro">Skip</button>\
<div class="ei-stage"><div class="ei-slot">\
  <div class="ei-floor ei-x">\
    <i class="ei-lane" style="top:calc(var(--W)*.12);height:2px;background:repeating-linear-gradient(90deg,rgba(78,205,196,.34) 0 26px,transparent 26px 62px)"></i>\
    <i class="ei-lane" style="top:calc(var(--W)*.27);height:3px;background:repeating-linear-gradient(90deg,rgba(78,205,196,.26) 0 44px,transparent 44px 104px)"></i>\
    <i class="ei-lane" style="top:calc(var(--W)*.46);height:4px;background:repeating-linear-gradient(90deg,rgba(78,205,196,.18) 0 70px,transparent 70px 160px)"></i>\
  </div>\
  <div class="ei-fly"><div class="ei-bus ei-x">\
    <div class="ei-shadow"></div><div class="ei-glow"></div>\
    <div class="ei-pitch"><img class="ei-img" alt="ETC electric bus" decoding="async"></div>\
  </div></div>\
</div></div>\
<div class="ei-copy">\
  <div class="ei-brand ei-x"><div class="ei-mark">E</div><span class="ei-brand-name">Enugu Transit Control</span></div>\
  <h1 class="ei-h1"><span class="ei-line"><span class="ei-in ei-x">Smart. Safe.</span></span><span class="ei-line"><span class="ei-in ei-grad ei-x">Affordable.</span></span></h1>\
  <p class="ei-sub ei-x">Book seats on modern electric buses across Enugu in seconds.</p>\
  <div class="ei-cta-wrap ei-x"><button class="ei-cta" type="button"><span class="ei-cta-ic"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span><span>Get Started<span class="ei-cta-arrows">&gt;&gt;&gt;</span></span></button></div>\
</div>';

  var st = null; // current run

  function injectCSS() {
    if (document.getElementById('etc-intro-css')) return;
    var s = document.createElement('style');
    s.id = 'etc-intro-css';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  function qa(sel) { try { return sel ? [].slice.call(document.querySelectorAll(sel)) : []; } catch (e) { return []; } }
  function store() { return CFG.onceSession ? sessionStorage : localStorage; }
  var KEY = 'etc_intro_seen';
  function seen() {
    try { if (store().getItem(KEY) === '1') return true; } catch (e) {}
    if (!CFG.onceSession) { try { return document.cookie.indexOf(KEY + '=1') > -1; } catch (e) {} }   // backup in case storage was cleared or blocked
    return false;
  }
  function mark() {
    try { store().setItem(KEY, '1'); } catch (e) {}
    if (!CFG.onceSession) { try { document.cookie = KEY + '=1; max-age=315360000; path=/; SameSite=Lax'; } catch (e) {} }
  }

  function play(opts) {
    if (st) return st.promise;
    var o = Object.assign({}, CFG, opts || {});
    injectCSS();
    document.documentElement.classList.add('etc-intro-lock');

    var root = document.createElement('div');
    root.id = 'etc-intro';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Welcome to ETC');
    root.innerHTML = HTML;
    (document.body || document.documentElement).appendChild(root);

    var $ = function (s) { return root.querySelector(s); };
    var el = {
      bg: $('.ei-bg'), particles: $('.ei-particles'), skip: $('.ei-skip'), slot: $('.ei-slot'), floor: $('.ei-floor'),
      fly: $('.ei-fly'), bus: $('.ei-bus'), pitch: $('.ei-pitch'), img: $('.ei-img'), shadow: $('.ei-shadow'), glow: $('.ei-glow'),
      copy: $('.ei-copy'), brand: $('.ei-brand'), ins: [].slice.call(root.querySelectorAll('.ei-in')), sub: $('.ei-sub'),
      ctaWrap: $('.ei-cta-wrap'), cta: $('.ei-cta')
    };

    for (var i = 0; i < 10; i++) {
      var p = document.createElement('i');
      p.className = 'ei-p';
      var sz = 2 + Math.random() * 2.5;
      p.style.cssText = 'left:' + (Math.random() * 100) + '%;width:' + sz + 'px;height:' + sz + 'px;animation-duration:' + (9 + Math.random() * 8) + 's;animation-delay:-' + (Math.random() * 12) + 's';
      el.particles.appendChild(p);
    }

    // Logo reveal, built from two transparent layers (no video file). The layers start decoding right away, in parallel with the fonts and the bus picture.
    var vid = null, vidReady = Promise.resolve(false), snd = null;
    if (o.logo && !o.debug) {
      var base = o.logo.replace(/\/+$/, '') + '/';
      var ringSvg = function (cx, cy, r, w, col, cls) {
        return '<svg class="' + cls + '" viewBox="0 0 ' + (cls === 'ei-halo' ? '416' : '373') + ' 181" aria-hidden="true"><circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" pathLength="1" fill="none" stroke="' + col + '" stroke-width="' + w + '" stroke-linecap="round" stroke-dasharray="1 1" stroke-dashoffset="1" style="filter:drop-shadow(0 0 5px ' + col + ')"/></svg>';
      };
      vid = document.createElement('div');
      vid.className = 'ei-vid';
      vid.setAttribute('aria-hidden', 'true');
      vid.innerHTML =
        '<div class="ei-lg ei-lg-l"><img alt="" decoding="async" src="' + base + 'logo-left.webp">' + ringSvg(75.5, 90.5, 84, 3, '#7dffb0', 'ei-halo') + '</div>' +
        '<div class="ei-streak"></div>' +
        '<div class="ei-lg ei-lg-r"><img alt="" decoding="async" src="' + base + 'logo-right.webp">' + ringSvg(84.5, 90.5, 77, 3.5, '#ffffff', 'ei-rr') + '</div>';
      root.insertBefore(vid, el.skip);
      el.vid = vid;
      var imgs = [].slice.call(vid.querySelectorAll('img'));
      vidReady = new Promise(function (res) {
        Promise.all(imgs.map(function (im) { return im.decode ? im.decode() : Promise.resolve(); })).then(function () { res(true); }, function () { res(false); });
        setTimeout(function () { res(false); }, 2600);   // slow connection: never hold the app hostage
      });
      if (o.sound) { try { snd = new Audio(o.sound); snd.preload = 'auto'; } catch (e) { snd = null; } }
    }

    // The app may not be parsed yet (script sits in <head>), so bind to it once the DOM is ready.
    var home = [], target = null, prevTargetVis = '', bound = false;
    function bindApp() {
      if (bound) return;
      bound = true;
      home = qa(o.home);
      target = qa(o.target)[0] || null;
      prevTargetVis = target ? target.style.visibility : '';
      if (target) target.style.visibility = 'hidden';
      home.forEach(function (h) { h.inert = true; h.setAttribute('aria-hidden', 'true'); });
    }

    var run = { phase: 'loading', enter: [], morph: [], vfx: [], timers: [], root: root, el: el, entered: false, skipShown: false, raf: 0 };
    st = run;
    var resolveDone;
    run.promise = new Promise(function (r) { resolveDone = r; });

    function A(list, node, kf, t) {
      var a = node.animate(kf, Object.assign({ fill: 'both' }, t));
      if (o.debug) a.pause();
      list.push(a);
      return a;
    }

    /* ---------- ENTRANCE ---------- */
    function enter() {
      if (run.entered || run.phase === 'morph' || run.phase === 'done') return;
      run.entered = true;
      bindApp();
      root.classList.add('ei-run');
      run.phase = 'entering';
      var vw = innerWidth;
      var sw = el.slot.getBoundingClientRect().width;
      var off = (vw + sw) / 2 + 40;
      var L = run.enter;
      var rise = function (n, d, dur, y) {
        A(L, n, [{ opacity: 0, transform: 'translate3d(0,' + (y || 14) + 'px,0)' }, { opacity: 1, transform: 'translate3d(0,0,0)' }], { delay: d, duration: dur || 900, easing: EXPO });
      };

      // Bus drives in along the photo's own ground line (from upper-right, nose toward lower-left), braking to a stop.
      var busA = A(L, el.bus,
        [{ transform: 'translate3d(' + off + 'px,' + (-off * TAN) + 'px,0)' }, { transform: 'translate3d(0,0,0)' }],
        { delay: 150, duration: 2800, easing: BRAKE });

      // Weight transfer: nose dips under braking, rocks back, settles.
      A(L, el.pitch, [
        { transform: 'rotate(0deg)', offset: 0, easing: 'ease-in-out' },
        { transform: 'rotate(-1.4deg)', offset: .32, easing: 'ease-in-out' },
        { transform: 'rotate(.6deg)', offset: .58, easing: 'ease-in-out' },
        { transform: 'rotate(-.22deg)', offset: .78, easing: 'ease-in-out' },
        { transform: 'rotate(0deg)', offset: 1 }
      ], { delay: 500, duration: 3000, easing: 'linear' });

      [el.shadow, el.glow].forEach(function (n) {
        A(L, n, [{ opacity: 0 }, { opacity: 1 }], { delay: 250, duration: 1100, easing: 'ease-out' });
      });
      A(L, el.floor, [{ opacity: 0 }, { opacity: 1 }], { delay: 300, duration: 1100, easing: 'ease-out' });

      rise(el.brand, 1100, 900, 12);
      el.ins.forEach(function (n, k) {
        A(L, n, [{ transform: 'translate3d(0,108%,0)' }, { transform: 'translate3d(0,0,0)' }], { delay: 1250 + k * 110, duration: 1100, easing: EXPO });
      });
      rise(el.sub, 1600, 1000, 14);
      A(L, el.ctaWrap, [{ opacity: 0, transform: 'translate3d(0,16px,0) scale(.96)' }, { opacity: 1, transform: 'translate3d(0,0,0) scale(1)' }], { delay: 1800, duration: 1000, easing: EXPO });
      if (!run.skipShown) A(L, el.skip, [{ opacity: 0 }, { opacity: 1 }], { delay: 1000, duration: 700 });

      run.timers.push(setTimeout(function () { el.ctaWrap.classList.add('ei-on'); }, 2100));

      // Idle: a slow breath once the bus is parked.
      var startIdle = function () {
        if (run.phase !== 'entering' && run.phase !== 'ready') return;
        run.phase = 'ready';
        run.idle = [
          el.img.animate([{ transform: 'translate3d(0,0,0)' }, { transform: 'translate3d(0,-3px,0)' }], { duration: 2800, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' }),
          el.glow.animate([{ opacity: .65 }, { opacity: 1 }], { duration: 2800, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' })
        ];
      };
      if (!o.debug) busA.finished.then(startIdle, function () {});
      run.startIdle = startIdle;
    }

    /* ---------- LOGO ANIMATION → FLIP INTO THE LAYOUT ---------- */
    function dropVid() {            // layers unavailable / finished with: leave no trace
      if (!vid) return;
      run.vfx.forEach(function (a) { try { a.cancel(); } catch (e) {} });
      stopSound();
      vid.remove();
      vid = null; el.vid = null;
    }

    function stopSound() { if (snd) { try { snd.pause(); } catch (e) {} } }

    function fadeAudio(ms) {
      if (!snd || snd.paused) return;
      var v0 = snd.volume, t0 = performance.now();
      (function step(now) {
        var k = Math.min(1, (now - t0) / ms);
        try { snd.volume = v0 * (1 - k); } catch (e) {}
        if (k < 1) requestAnimationFrame(step); else stopSound();
      })(t0);
    }

    // Enugu State Government mark rises in, a halo draws round the emblem, a light streak sweeps across,
    // the mark slides left and the Enugu Smart Bus roundel draws itself in beside it.
    function playLogo() {
      var V = run.vfx, L = vid.querySelector('.ei-lg-l'), R = vid.querySelector('.ei-lg-r'), K = vid.querySelector('.ei-streak');
      var halo = vid.querySelector('.ei-halo circle'), rr = vid.querySelector('.ei-rr circle');
      vid.style.opacity = '1';
      // sound is a bonus: most browsers need a tap first, so a blocked play() is simply ignored
      if (snd) { try { var pr = snd.play(); if (pr && pr.catch) pr.catch(function () { snd = null; }); } catch (e) { snd = null; } }

      // 1. the mark rises in, dim, then comes up to full brightness (it starts centred: the lockup is not complete yet)
      A(V, L, [
        { opacity: 0, transform: 'translate3d(45.19%,0,0) scale(.9)', filter: 'brightness(.35)', offset: 0 },
        { opacity: 1, transform: 'translate3d(45.19%,0,0) scale(1)', filter: 'brightness(.5)', offset: .55 },
        { opacity: 1, transform: 'translate3d(45.19%,0,0) scale(1)', filter: 'brightness(1)', offset: 1 }
      ], { duration: 1500, easing: EXPO });
      A(V, R, [{ opacity: 0 }, { opacity: 0 }], { duration: 1800 });

      // 2. halo draws round the emblem, spins, then lets go
      var emblemCx = 75.5, emblemCy = 90.5;
      A(V, halo, [{ strokeDashoffset: 1, opacity: 0, offset: 0 }, { strokeDashoffset: .95, opacity: 1, offset: .06 }, { strokeDashoffset: 0, opacity: 1, offset: 1 }], { delay: 250, duration: 1000, easing: 'cubic-bezier(.65,0,.35,1)' });
      halo.style.transformOrigin = emblemCx + 'px ' + emblemCy + 'px';
      A(V, halo, [{ transform: 'rotate(0deg)' }, { transform: 'rotate(300deg)' }], { delay: 250, duration: 1500, easing: 'cubic-bezier(.4,0,.2,1)' });
      A(V, halo, [{ opacity: 1 }, { opacity: 0 }], { delay: 1500, duration: 500, easing: 'ease-out' });

      // 3. the light streak sweeps across and leads the new mark in
      A(V, K, [
        { opacity: 0, transform: 'translate3d(405%,0,0)', offset: 0 },
        { opacity: 1, transform: 'translate3d(590%,0,0)', offset: .25 },
        { opacity: 1, transform: 'translate3d(870%,0,0)', offset: .8 },
        { opacity: 0, transform: 'translate3d(995%,0,0)', offset: 1 }
      ], { delay: 1350, duration: 1200, easing: 'cubic-bezier(.45,0,.2,1)' });

      // 4. the State mark slides left into the lockup (`translate` is its own property, so it never fights the entrance `transform` above)
      A(V, L, [{ translate: '0 0' }, { translate: '-45.19% 0' }], { delay: 1500, duration: 1150, easing: IOS });

      // 5. Enugu Smart Bus wipes in behind the streak, its roundel drawing itself
      A(V, R, [
        { opacity: 0, clipPath: 'inset(0 100% 0 0)', transform: 'translate3d(-5%,0,0)', filter: 'drop-shadow(0 0 14px rgba(90,255,160,.85))' },
        { opacity: 1, clipPath: 'inset(0 0% 0 0)', transform: 'translate3d(0,0,0)', filter: 'drop-shadow(0 0 0 rgba(90,255,160,0))' }
      ], { delay: 1650, duration: 1250, easing: 'cubic-bezier(.3,.6,.2,1)' });
      A(V, rr, [{ strokeDashoffset: 1, opacity: 0, offset: 0 }, { strokeDashoffset: .95, opacity: 1, offset: .06 }, { strokeDashoffset: 0, opacity: 1, offset: 1 }], { delay: 1750, duration: 900, easing: 'cubic-bezier(.65,0,.35,1)' });
      A(V, rr, [{ opacity: 1 }, { opacity: 0 }], { delay: 2750, duration: 450, easing: 'ease-out' });
    }

    function splash() {
      bindApp();
      run.phase = 'splash';
      run.skipShown = true;
      root.classList.add('ei-vrun');
      A(run.vfx, el.skip, [{ opacity: 0 }, { opacity: 1 }], { delay: 900, duration: 700 });
      playLogo();
      run.timers.push(setTimeout(dock, o.logoDock));
    }

    // FLIP: First (big, centred) → flip the layout (CSS class) → Last (small, docked) → Invert with a transform → Play to identity.
    // The same live element keeps animating the whole way, so nothing is snapshotted or swapped.
    function dock() {
      if (run.phase !== 'splash' || !vid) return;
      run.phase = 'docking';
      var first = vid.getBoundingClientRect();                 // F
      root.classList.add('ei-docked');                         // L  (pure CSS: new size + position)
      var last = vid.getBoundingClientRect();
      var sx = first.width / last.width;                       // the lockup's aspect ratio never changes, so one uniform scale is exact
      var dx = first.left - last.left, dy = first.top - last.top;
      A(run.vfx, vid, [                                         // I + P
        { transform: 'translate3d(' + dx + 'px,' + dy + 'px,0) scale(' + sx + ')' },
        { transform: 'translate3d(0,0,0) scale(1)' }
      ], { duration: 1100, easing: IOS, fill: 'backwards' });
      // the rest of the intro takes over while the lockup is still on its way up
      run.timers.push(setTimeout(enter, 280));
    }

    // reduced motion: no flight, just the finished lockup sitting in its place.
    function parkVid() {
      root.classList.add('ei-docked');
      vid.style.opacity = '1';
    }

    /* ---------- MORPH TO HOME ---------- */
    function morph() {
      if (run.phase === 'morph' || run.phase === 'done') return run.promise;
      bindApp();
      var noBus = !run.entered;       // skipped while the clip was still playing: the bus never drove in
      run.phase = 'morph';
      run.timers.forEach(clearTimeout);
      cancelAnimationFrame(run.raf);
      mark();                          // from here the person is on their way to Home: never show the intro again
      el.ctaWrap.style.pointerEvents = 'none';
      el.skip.style.pointerEvents = 'none';
      if (!noBus) root.classList.add('ei-run');
      fadeAudio(380);

      var vw = innerWidth, vh = innerHeight;
      var from = el.fly.getBoundingClientRect();
      var tr = !noBus && target ? target.getBoundingClientRect() : null;
      var hasTarget = !!(tr && tr.width > 4 && tr.height > 4);
      run.landed = hasTarget;
      var fcx = from.left + from.width / 2, fcy = from.top + from.height / 2;
      var tcx, tcy, sc;
      if (hasTarget) {
        tcx = tr.left + tr.width / 2; tcy = tr.top + tr.height / 2;
        sc = Math.min(tr.width / from.width, tr.height / from.height);
      } else { // no landing spot on Home: dock toward the top and dissolve
        tcx = vw / 2; tcy = vh * 0.09; sc = 0.34;
      }
      var dx = tcx - fcx, dy = tcy - fcy;
      var M = run.morph;

      // let the app take taps and screen readers again
      home.forEach(function (h) { h.inert = false; h.removeAttribute('aria-hidden'); });

      // settle the idle bob to rest so the hand-off is pixel-exact
      if (run.idle) {
        var cur = getComputedStyle(el.img).transform;
        run.idle.forEach(function (a) { a.cancel(); });
        run.idle = null;
        if (cur && cur !== 'none') A(M, el.img, [{ transform: cur }, { transform: 'none' }], { duration: 350, easing: EXPO });
      }

      if (reduce) {
        A(M, root, [{ opacity: 1 }, { opacity: 0 }], { duration: 300, easing: 'ease-out' });
        var rw = A(M, el.fly, [{ opacity: 1 }, { opacity: 1 }], { duration: 300 });
        return arm(rw);
      }

      // copy leaves upward
      A(M, el.copy, [{ opacity: 1, transform: 'translate3d(0,0,0)' }, { opacity: 0, transform: 'translate3d(0,-28px,0)' }], { duration: 420, easing: 'cubic-bezier(.4,0,1,1)' });
      A(M, el.skip, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 });
      A(M, el.floor, [{ opacity: 1 }, { opacity: 0 }], { duration: 500, easing: 'ease-out' });
      // the lockup leaves with the copy (single end keyframe = animate from wherever it is right now, even mid-flight)
      if (vid) A(M, vid, [{ opacity: 0, translate: '0 -26px' }], { duration: noBus ? 320 : 420, easing: 'cubic-bezier(.4,0,1,1)' });

      var fly, revealAt;
      if (noBus) {
        // skipped during the clip: the dark scene simply closes like an iris on the middle of the screen
        var ncx = vw / 2, ncy = vh * .47;
        fly = A(M, el.bg,
          [{ clipPath: 'circle(' + Math.hypot(vw, vh) + 'px at ' + ncx + 'px ' + ncy + 'px)' }, { clipPath: 'circle(0px at ' + ncx + 'px ' + ncy + 'px)' }],
          { delay: 120, duration: 900, easing: 'cubic-bezier(.5,0,.15,1)' });
        revealAt = 260;
      } else if (hasTarget) {
        // light and shadow let go of the bus, which flies to its place on Home
        [el.shadow, el.glow].forEach(function (n) { A(M, n, [{ opacity: 1 }, { opacity: 0 }], { duration: 650, easing: 'ease-out' }); });
        fly = A(M, el.fly,
          [{ transform: 'translate3d(0,0,0) scale(1)' }, { transform: 'translate3d(' + dx + 'px,' + dy + 'px,0) scale(' + sc + ')' }],
          { delay: 120, duration: 1150, easing: IOS });
        // the dark scene collapses into the bus, opening Home from the edges in
        var R = Math.hypot(vw, vh);
        A(M, el.bg,
          [{ clipPath: 'circle(' + R + 'px at ' + (vw / 2) + 'px ' + (vh * .4) + 'px)' }, { clipPath: 'circle(0px at ' + tcx + 'px ' + tcy + 'px)' }],
          { delay: 80, duration: 1050, easing: 'cubic-bezier(.5,0,.15,1)' });
        revealAt = 420;
      } else {
        // The bus keeps driving along its own ground line, pulls away (accelerating) and fades,
        // while the night scene drains out after it and Home rises in underneath.
        var span = (vw + from.width) / 2 + 60;
        var ex = -span, ey = span * TAN, T = 1500, D0 = 60;
        fly = A(M, el.fly,
          [{ transform: 'translate3d(0,0,0) scale(1)' }, { transform: 'translate3d(' + ex + 'px,' + ey + 'px,0) scale(1.06)' }],
          { delay: D0, duration: T, easing: 'cubic-bezier(.55,.02,.8,.45)' });
        A(M, el.fly,
          [{ opacity: 1, offset: 0 }, { opacity: 1, offset: .38 }, { opacity: 0, offset: .92 }, { opacity: 0, offset: 1 }],
          { delay: D0, duration: T, easing: 'linear' });
        // nose lifts a touch as the bus pulls away
        A(M, el.pitch, [
          { transform: 'rotate(0deg)', offset: 0, easing: 'ease-out' },
          { transform: 'rotate(.9deg)', offset: .35, easing: 'ease-in-out' },
          { transform: 'rotate(.4deg)', offset: 1 }
        ], { delay: D0, duration: T, easing: 'linear' });
        // the dark scene closes like an iris, chasing the bus as it drives away; it stays solid (no murky half-fade)
        var R2 = Math.hypot(vw, vh), bx = fcx + ex * .5, by = fcy + ey * .5;
        A(M, el.bg,
          [{ clipPath: 'circle(' + R2 + 'px at ' + (vw / 2) + 'px ' + (vh * .4) + 'px)' }, { clipPath: 'circle(0px at ' + bx + 'px ' + by + 'px)' }],
          { delay: 100, duration: 1300, easing: 'cubic-bezier(.5,0,.15,1)' });
        revealAt = 380;
      }

      // Home content settles in (only what is on screen; uses `translate` so it never fights an element's own transform)
      var shown = qa(o.reveal).filter(function (n) { var r = n.getBoundingClientRect(); return !(r.bottom < -40 || r.top > vh + 40); });
      shown.forEach(function (n, k) {
        var holdsBus = hasTarget && n.contains(target);
        A(M, n, holdsBus
            ? [{ opacity: 0 }, { opacity: 1 }]
            : [{ opacity: 0, translate: '0 24px' }, { opacity: 1, translate: '0 0' }],
          holdsBus
            ? { delay: 150, duration: 600, easing: 'ease-out', fill: 'backwards' }
            : { delay: revealAt + Math.min(k, 8) * 70, duration: 950, easing: EXPO, fill: 'backwards' });
      });
      return arm(fly);
    }

    function arm(a) {
      if (!o.debug) a.finished.then(finish, function () {});
      return run.promise;
    }

    function finish() {
      if (run.phase === 'done') return;
      run.phase = 'done';
      run.timers.forEach(clearTimeout);
      cancelAnimationFrame(run.raf);
      stopSound();
      if (target) target.style.visibility = prevTargetVis;
      home.forEach(function (h) { h.inert = false; h.removeAttribute('aria-hidden'); });
      // the real bus is back under the flying one; a short cross-fade hides any resampling difference
      var xf = run.landed && !o.debug ? el.fly.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'linear', fill: 'forwards' }).finished.catch(function () {}) : Promise.resolve();
      xf.then(function () { requestAnimationFrame(function () {
        root.remove();
        document.documentElement.classList.remove('etc-intro-lock');
        mark();
        st = null;
        window.dispatchEvent(new CustomEvent('etc-intro:done'));
        resolveDone();
      }); });
    }

    run.morph_ = morph;
    run.dock_ = dock;
    run.finish = finish;

    el.cta.addEventListener('click', function (e) { e.preventDefault(); morph(); });
    el.skip.addEventListener('click', function () { morph(); });
    document.addEventListener('keydown', function onKey(e) {
      if (run.phase === 'done') return document.removeEventListener('keydown', onKey);
      if (e.key === 'Escape' || e.key === 'Enter') morph();
    });

    // wait for the picture (and fonts, briefly) so nothing pops in mid-motion
    el.img.src = o.bus;
    var domReady = document.readyState === 'loading'
      ? new Promise(function (r) { document.addEventListener('DOMContentLoaded', r, { once: true }); })
      : Promise.resolve();
    var ready = Promise.all([
      domReady,
      el.img.decode ? el.img.decode().catch(function () {}) : Promise.resolve(),
      document.fonts && document.fonts.ready ? Promise.race([document.fonts.ready, new Promise(function (r) { setTimeout(r, 450); })]) : Promise.resolve()
    ]);
    Promise.race([ready, domReady.then(function () { return new Promise(function (r) { setTimeout(r, 1800); }); })]).then(function () {
      if (run.phase !== 'loading') return;
      if (reduce) {
        bindApp(); root.classList.add('ei-static'); run.phase = 'ready'; el.ctaWrap.classList.add('ei-on');
        if (vid) vidReady.then(function (ok) { if (!ok) dropVid(); else if (vid) parkVid(); });
        return;
      }
      if (!vid) { enter(); return; }
      vidReady.then(function (ok) {
        if (run.phase !== 'loading') return;
        if (!ok) { dropVid(); enter(); return; }       // clip missing or too slow: the normal intro, exactly as before
        splash();
      });
    });

    return run.promise;
  }

  function skip() { if (st) { st.morph_(); } }

  function seek(list, t) { list.forEach(function (a) { a.pause(); a.currentTime = t; }); }

  window.ETCIntro = {
    play: play,
    skip: skip,
    _seekEnter: function (t) { if (st) seek(st.enter, t); },
    _seekMorph: function (t) { if (st) seek(st.morph, t); },
    _morph: function () { if (st) st.morph_(); },
    _dock: function () { if (st && st.dock_) st.dock_(); },
    _finish: function () { if (st) st.finish(); },
    _phase: function () { return st ? st.phase : 'none'; }
  };

  function boot() {
    if (CFG.manual) return;
    if (CFG.once && seen() && !Q.has('intro')) return;
    play();
  }
  // Start immediately when possible so the app never flashes before the intro.
  if (document.documentElement) boot();
})();
