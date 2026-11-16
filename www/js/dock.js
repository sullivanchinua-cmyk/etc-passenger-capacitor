// =========================================================
// Home scroll dock – v9: scroll-driven CSS (falls back to the JS path)
// Search pill compresses into a circle; filter/logo fade.
// v10: everything – including the pill – uses transform + opacity only (compositor).
// =========================================================
(function () {
  const $ = (s) => document.querySelector(s);
  const row = $("#sRow"), pill = $("#searchPill"), filter = $("#filterBtn");
  const sentinel = $("#dockSentinel"), logo = $("#logoBtn"), hdrSearch = $("#hdrSearch");
  const band = $("#dockBand"), greeting = $("#greeting");
  if (!row || !pill || !sentinel) return;

  const CIRCLE = 48;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const smoothstep = (a, b, v) => {
    const t = clamp((v - a) / (b - a));
    return t * t * (3 - 2 * t);
  };
  const easeInOut = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t));

  // ---------------------------------------------------------------------------------------------
  // v9 – scroll-driven CSS path (Chrome / Android 115+).
  // The browser ties the header animation to the scroll position itself, so nothing waits for
  // JavaScript between your finger and the header (the old path updated one frame behind the scroll,
  // which is what felt stiff). JS only measures once and toggles the shadow.
  // Add  ?dock=js  to the page URL to force the old JS path – handy for comparing on a phone.
  // Browsers without support (iPhone Safari, old Android) automatically keep the old path below.
  // ---------------------------------------------------------------------------------------------
  const forced = new URLSearchParams(location.search).get("dock");
  const useCSS = forced !== "js" && !!(window.CSS && CSS.supports && CSS.supports("animation-timeline: scroll()"));
  if (useCSS) {
    const root = document.documentElement;
    let dd = 140, shadowOn = null;
    const shadowCheck = () => {
      const on = window.scrollY > dd * 0.25;
      if (on !== shadowOn) { shadowOn = on; pill.classList.toggle("dk-shadow", on); }
    };
    const measureCSS = () => {
      dd = Math.max(48, sentinel.getBoundingClientRect().top + window.scrollY);
      root.style.setProperty("--dist", dd + "px");
      shadowCheck();
    };
    root.classList.add("dock-css");
    window.addEventListener("scroll", shadowCheck, { passive: true });
    let lastW = window.innerWidth;
    window.addEventListener("resize", () => { if (window.innerWidth !== lastW) { lastW = window.innerWidth; measureCSS(); } });
    window.addEventListener("load", measureCSS);
    window.addEventListener("pageshow", measureCSS);
    if (document.readyState === "complete") measureCSS(); else requestAnimationFrame(measureCSS);
    return;
  }

  let dist = 1, target = 0, cur = 0, raf = 0, shadowOn = null;

  // v10: the pill never changes width. Its middle bar is scaled (scaleX) and its right circle is
  // translated – transform only, same as the CSS path.
  const mid = pill.querySelector(".sp-mid"), capR = pill.querySelector(".sp-capr");
  if (mid) mid.style.willChange = "transform";
  if (capR) capR.style.willChange = "transform";
  if (filter) filter.style.willChange = "opacity, transform";
  if (logo) logo.style.willChange = "opacity, transform";
  if (hdrSearch) hdrSearch.style.willChange = "opacity, transform";
  if (greeting) greeting.style.willChange = "opacity, transform"; // own layer → the big title fades without re-drawing text
  if (band) band.style.willChange = "opacity";

  function measure() {
    dist = Math.max(48, sentinel.getBoundingClientRect().top + window.scrollY);
    aim(true);
  }

  // v7: render is LOCKED to the scroll position (one write per frame, no lerp).
  // The old "chase" easing lagged behind the native scroll, so the header and the
  // "Enugu Bus Trip" fade kept moving after your finger had stopped = jitter.
  function aim(instant) {
    target = clamp(window.scrollY / dist);
    if (instant || reduce) { cur = target; render(); raf = 0; return; }
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function frame() {
    raf = 0;
    cur = target;
    render();
  }

  const put = (el, prop, val) => {
    if (!el) return;
    const k = "_" + prop;
    if (el[k] !== val) {
      el[k] = val;
      el.style[prop] = val;
    }
  };
  const r1 = (n) => Math.round(n * 10) / 10;

  function render() {
    // Shrink window: start almost immediately, finish before full dock
    const shrink = easeInOut(clamp((cur - 0.01) / 0.72));
    put(mid, "transform", `scaleX(${(1 - shrink).toFixed(4)})`);
    put(capR, "transform", `translateX(calc(${(-shrink).toFixed(4)} * (100% - ${CIRCLE}px)))`);

    // shadow switches on once, instead of being re-painted every frame
    const sh = cur > 0.25;
    if (sh !== shadowOn) { shadowOn = sh; pill.classList.toggle("dk-shadow", sh); }

    // Filter tucks away under profile
    const tuck = smoothstep(0.45, 0.9, cur);
    put(filter, "opacity", (1 - tuck).toFixed(2));
    put(filter, "transform", `scale(${(1 - 0.28 * tuck).toFixed(2)})`);
    put(filter, "pointerEvents", tuck > 0.45 ? "none" : "auto");

    // Logo + bell step aside
    const step = smoothstep(0.55, 0.95, cur);
    [logo, hdrSearch].forEach((el) => {
      put(el, "opacity", (1 - step).toFixed(2));
      put(el, "transform", `scale(${(1 - 0.12 * step).toFixed(2)})`);
      put(el, "pointerEvents", step > 0.55 ? "none" : "auto");
    });

    // Greeting fades; dock band fades in
    const g = smoothstep(0, 0.45, cur);
    put(greeting, "opacity", (1 - g).toFixed(2));
    put(greeting, "transform", `translate3d(0,${(14 * g).toFixed(1)}px,0) scale(${(1 - 0.035 * g).toFixed(3)})`);
    put(band, "opacity", smoothstep(0.3, 0.85, cur).toFixed(2));
  }

  window.addEventListener("scroll", () => aim(false), { passive: true });
  let lastIW = window.innerWidth;
  window.addEventListener("resize", () => {
    // v8: the browser fires "resize" when its URL bar slides in/out while you scroll – that forced a layout
    // every frame. Only re-measure when the WIDTH really changed (rotation, split screen).
    if (window.innerWidth === lastIW) return;
    lastIW = window.innerWidth;
    measure();
  });
  window.addEventListener("load", measure);
  window.addEventListener("pageshow", measure);

  // First paint after layout
  if (document.readyState === "complete") measure();
  else requestAnimationFrame(measure);
})();
