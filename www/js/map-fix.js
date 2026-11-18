/* Makes the OpenStreetMap / Leaflet maps reliable:
 *  - re-measures the map whenever its box changes size, the view is shown again, the keyboard/rotation changes
 *    (a map measured while hidden or mid-animation draws grey or half-empty tiles)
 *  - retries tiles that failed to load (slow / dropped mobile connection) instead of leaving holes
 *  - re-checks a moment after start, because the page's layout settles after first paint
 * Usage: ETC_MapFix.harden(map, tileLayer, mapElement)
 */
(function () {
  'use strict';
  function harden(map, tiles, el) {
    if (!map) return;
    var t = null;
    function fix() {
      clearTimeout(t);
      t = setTimeout(function () { try { map.invalidateSize({ animate: false }); } catch (e) {} }, 60);
    }
    // 1) size changes
    try {
      if (window.ResizeObserver && el) new ResizeObserver(fix).observe(el);
    } catch (e) {}
    window.addEventListener('resize', fix);
    window.addEventListener('orientationchange', function () { setTimeout(fix, 250); });
    window.addEventListener('pageshow', fix);
    window.addEventListener('etc:show', fix);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) fix(); });
    // 2) layout settling after first paint
    [150, 500, 1200, 2500].forEach(function (ms) { setTimeout(fix, ms); });
    window.addEventListener('load', fix);

    // 3) failed tiles: retry up to 3 times with a growing pause
    if (tiles && tiles.on) {
      tiles.on('tileerror', function (ev) {
        var tile = ev && ev.tile; if (!tile) return;
        var n = (tile._etcTry || 0) + 1;
        if (n > 3) return;
        tile._etcTry = n;
        var src = tile.src;
        setTimeout(function () {
          try { tile.src = ''; tile.src = src.split('#')[0] + (src.indexOf('?') < 0 ? '?' : '&') + 'r=' + n; } catch (e) {}
        }, 900 * n);
      });
    }
    // 4) coming back online: reload the tiles that are missing
    window.addEventListener('online', function () { try { tiles && tiles.redraw && tiles.redraw(); } catch (e) {} fix(); });
  }
  window.ETC_MapFix = { harden: harden };
})();
