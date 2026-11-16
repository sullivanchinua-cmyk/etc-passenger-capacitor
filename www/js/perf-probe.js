// =========================================================
// ETC perf probe – ONLY loads when the URL has ?perf=1
// Shows a tiny box in the top-left corner: FPS, worst frame, long tasks, layout shift,
// and WHICH script caused the last slow frame. Screenshot it while the page jitters.
// =========================================================
(function () {
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;top:56px;left:6px;z-index:2147483647;pointer-events:none;background:rgba(0,0,0,.78);color:#7CFC9A;font:11px/1.35 monospace;padding:6px 8px;border-radius:8px;max-width:86vw;white-space:pre-wrap";
  document.documentElement.appendChild(box);
  let frames = 0, last = performance.now(), worst = 0, prev = performance.now(), fps = 0, long = 0, cls = 0, lastLoaf = "–", lastShift = "–";
  (function loop(t) {
    frames++; worst = Math.max(worst, t - prev); prev = t;
    if (t - last >= 500) { fps = Math.round(frames * 1000 / (t - last)); frames = 0; last = t; draw(); setTimeout(() => { worst = 0; }, 1500); }
    requestAnimationFrame(loop);
  })(performance.now());
  function draw() {
    box.textContent = "FPS " + fps + "   worst frame " + Math.round(worst) + "ms\nlong tasks " + long + "   layout shift " + cls.toFixed(3) + "\nslow frame: " + lastLoaf + "\nlast shift: " + lastShift;
  }
  function obs(type, cb) { try { new PerformanceObserver((l) => l.getEntries().forEach(cb)).observe({ type: type, buffered: true }); return true; } catch (_) { return false; } }
  obs("longtask", () => { long++; });
  obs("layout-shift", (e) => {
    if (e.hadRecentInput) return;
    cls += e.value;
    const n = e.sources && e.sources[0] && e.sources[0].node;
    if (n) lastShift = e.value.toFixed(3) + " " + (n.id ? "#" + n.id : (n.className && String(n.className).slice(0, 30)) || n.nodeName);
  });
  const hasLoaf = obs("long-animation-frame", (e) => {
    const sc = (e.scripts || []).slice().sort((a, b) => b.duration - a.duration)[0];
    lastLoaf = Math.round(e.duration) + "ms " + (sc ? (String(sc.sourceURL || sc.invoker || "?").split("/").pop() + " " + (sc.sourceFunctionName || sc.invokerType || "")) : "(rendering/style/layout – no script)");
  });
  if (!hasLoaf) lastLoaf = "(this browser can't name the slow script)";
  draw();
})();
