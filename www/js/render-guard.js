/* ETC render guard - stops white flashes, keyboard artifacts and layer flicker.
 *
 * Load it FIRST in <head> of every page (right after safe-area.js):  <script src="js/render-guard.js"></script>
 * (chat pages use ../js/render-guard.js).  It does five things:
 *
 *  1. BASE BACKGROUND - <html> gets the theme colour the instant the page starts parsing, so the WebView never
 *     shows its default white before the stylesheet arrives (white flash on opening a view / closing the keyboard).
 *  2. GPU LAYERS - overlays, sheets, cards and fixed bars are promoted to their own compositor layer
 *     (translateZ(0) + will-change only on the things that animate), and animations are limited to
 *     transform / opacity.  Heavy backdrop blur on full-screen overlays is dropped - re-blurring the page behind
 *     the overlay on every tap was what made the luggage bubbles flicker.
 *  3. KEYBOARD - while the keyboard opens or closes, transitions are paused for a moment and a repaint is forced
 *     once the viewport has settled, so the old "white strip at the bottom until the view resizes" cannot show.
 *  4. VIEWPORT VARS - --vvh (visual viewport height) and html.kb-open so CSS can follow the keyboard without JS layout.
 *  5. HIDDEN VIEW SAFETY - when the app keeps this page alive in the background (js/spa.js) nothing animates or repaints
 *     while it is hidden.
 */
(function () {
  'use strict';
  if (window.__etcRenderGuard) return;
  window.__etcRenderGuard = true;

  var BG = '#DCDDE0';            // theme base (matches body gradient end colour + native window colour)
  var root = document.documentElement;

  // ---- 1 + 2: CSS --------------------------------------------------------------------------------
  var css =
    // solid base colour on the canvas: shows through while content loads and while the viewport resizes
    'html{background-color:' + BG + ';min-height:100%}' +
    'body{background-color:' + BG + ';min-height:100vh;min-height:100dvh}' +
    // stop the rubber-band / overscroll edge from flashing white
    'html,body{overscroll-behavior:none}' +
    // overlays: compositor layer, no live blur (blur was re-rendered on every DOM change underneath)
    '.ov{-webkit-backdrop-filter:none!important;backdrop-filter:none!important;background:rgba(214,215,219,.72)!important;' +
      'will-change:opacity;-webkit-backface-visibility:hidden;backface-visibility:hidden}' +
    '.ov-card{will-change:transform;transform:translate3d(0,14px,0) scale(.96);-webkit-backface-visibility:hidden;backface-visibility:hidden}' +
    '.ov.show .ov-card{transform:translate3d(0,0,0) scale(1)}' +
    // anything that slides / fades in: its own layer from the start (no first-frame re-raster)
    '.pay-root,.sheet,.cal-ov,.profile-ov,.ov-toast,.book-btn,.etc-nav{-webkit-backface-visibility:hidden;backface-visibility:hidden}' +
    // luggage / steppers: no layout-affecting transitions, only compositor ones
    '.lug,.stepper,.stepper button,.size-seg button{transition-property:transform,opacity,background-color,color!important}' +
    '.lug .q,.stepper .q{contain:layout paint;min-width:30px;display:inline-block;text-align:center}' +
    '.tk-scroll{contain:content;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}' +
    // while the keyboard moves, nothing animates (prevents half-finished transitions being captured as artifacts)
    'html.kb-moving *,html.kb-moving *::before,html.kb-moving *::after{transition:none!important;animation-duration:0s!important}' +
    // cached view that is currently hidden by the shell: zero work
    'html.etc-view-hidden *{animation-play-state:paused!important}';
  var st = document.createElement('style');
  st.id = 'etc-render-guard-css';
  st.appendChild(document.createTextNode(css));
  (document.head || root).appendChild(st);

  // inside a cached view the shell paints the same base colour behind it
  try { if (window.parent && window.parent !== window) window.parent.document.documentElement.style.backgroundColor = BG; } catch (e) {}

  // ---- 3 + 4: keyboard ---------------------------------------------------------------------------
  var vv = window.visualViewport;
  var settleT = 0, movingT = 0, lastH = vv ? vv.height : window.innerHeight, baseH = Math.max(lastH, window.innerHeight);

  function setVars() {
    var h = vv ? vv.height : window.innerHeight;
    root.style.setProperty('--vvh', h + 'px');
    if (h > baseH) baseH = h;
    var open = h < baseH - 120;
    if (root.classList.contains('kb-open') !== open) root.classList.toggle('kb-open', open);
  }
  function forceRepaint() {
    // make the compositor re-draw the whole canvas at the new size (cures the stale white strip).
    // will-change:opacity forces a fresh layer WITHOUT creating a containing block (fixed bars/buttons must not move).
    try {
      void document.body.offsetHeight;
      root.style.willChange = 'opacity';
      requestAnimationFrame(function () { requestAnimationFrame(function () { root.style.willChange = ''; }); });
      window.scrollTo(window.pageXOffset || 0, window.pageYOffset || 0);
    } catch (e) {}
  }
  function onViewportChange() {
    var h = vv ? vv.height : window.innerHeight;
    if (Math.abs(h - lastH) < 2) return;
    lastH = h;
    setVars();
    root.classList.add('kb-moving');
    clearTimeout(movingT);
    movingT = setTimeout(function () { root.classList.remove('kb-moving'); }, 260);
    clearTimeout(settleT);
    settleT = setTimeout(forceRepaint, 120);      // after the resize has settled
  }
  if (vv) { vv.addEventListener('resize', onViewportChange, { passive: true }); }
  window.addEventListener('resize', onViewportChange, { passive: true });
  // closing the keyboard: repaint right away, and again once the native resize is done
  document.addEventListener('focusout', function (e) {
    var t = e.target;
    if (!t || !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && !t.isContentEditable) return;
    root.classList.add('kb-moving');
    clearTimeout(movingT);
    movingT = setTimeout(function () { root.classList.remove('kb-moving'); }, 320);
    requestAnimationFrame(forceRepaint);
    setTimeout(forceRepaint, 160);
    setTimeout(forceRepaint, 380);
  }, true);

  // ---- 5: hidden-view bookkeeping (spa.js fires etc:hide / etc:show) ----------------------------
  window.addEventListener('etc:hide', function () { root.classList.add('etc-view-hidden'); });
  window.addEventListener('etc:show', function () { root.classList.remove('etc-view-hidden'); forceRepaint(); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setVars); else setVars();
})();
