// Small shared helpers for the booking overlays
window.ETC_UI = (function () {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /** Remove every leftover overlay that can freeze the UI (orphans from prior visits / bfcache). */
  function clearOrphans() {
    try {
      document.querySelectorAll(".ov.show, .ov.cal-ov.show, .rate-ov, .pay-root.show, [data-etc-overlay], [data-etc-ghost-shield], .lock-ov").forEach(function (n) {
        try { n.classList.remove("show"); } catch (_) {}
        // Keep calendar shell; strip freezers
        if (n.classList && n.classList.contains("cal-ov")) {
          try { n.classList.remove("show"); n.setAttribute("aria-hidden", "true"); } catch (_) {}
          return;
        }
        if (n.classList && n.classList.contains("profile-ov")) {
          try { n.classList.remove("show", "locked"); n.style.pointerEvents = ""; n.setAttribute("aria-hidden", "true"); } catch (_) {}
          return;
        }
        try { n.remove(); } catch (_) {}
      });
      // Keep calendar root if present, but force it closed
      document.querySelectorAll(".cal-ov").forEach(function (n) {
        try { n.classList.remove("show"); n.setAttribute("aria-hidden", "true"); } catch (_) {}
      });
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
      document.documentElement.classList.remove("map-open");
      window.__etcOvDepth = 0;
    } catch (_) {}
  }

  // Run ASAP + on pageshow (bfcache restore) so second entry never stays frozen
  try {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", clearOrphans);
    } else {
      clearOrphans();
    }
    window.addEventListener("pageshow", function () { clearOrphans(); });
    // Coming back from another tab/app: if no overlay is really open, make sure the page can scroll
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) return;
      if (!document.querySelector(".ov.show, .rate-ov, .pay-root.show")) {
        document.body.style.overflow = "";
        document.documentElement.style.overflow = "";
        window.__etcOvDepth = 0;
      }
    });
  } catch (_) {}

  // glass overlay: blurred backdrop + card. returns { el, close }
  function overlay(html, opts) {
    opts = opts || {};
    // Never stack freezers – close any existing non-calendar overlay first
    try {
      document.querySelectorAll(".ov.show:not(.cal-ov)").forEach(function (n) {
        try { n.classList.remove("show"); n.remove(); } catch (_) {}
        window.__etcOvDepth = Math.max(0, (window.__etcOvDepth || 1) - 1);
      });
      document.querySelectorAll(".rate-ov").forEach(function (n) { try { n.remove(); } catch (_) {} });
    } catch (_) {}

    const el = document.createElement("div");
    el.className = "ov" + (opts.cls ? " " + opts.cls : "");
    el.setAttribute("data-etc-overlay", "1");
    el.innerHTML = html;
    document.body.appendChild(el);
    // Soft lock scroll while open.
    // FIX: remember the ORIGINAL overflow only once. Before, a 2nd overlay saved "hidden" as the
    // "previous" value, so closing it left the page permanently unscrollable (looked like a freeze).
    if (!window.__etcOvDepth) { window.__etcOvDepth = 0; window.__etcOvPrev = document.body.style.overflow || ""; }
    if (window.__etcOvPrev === "hidden") window.__etcOvPrev = "";
    window.__etcOvDepth++;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { el.classList.add("show"); });
    });
    var closed = false;
    const close = function () {
      if (closed) return;
      closed = true;
      try { el.classList.remove("show"); } catch (_) {}
      window.__etcOvDepth = Math.max(0, (window.__etcOvDepth || 1) - 1);
      if (!window.__etcOvDepth) document.body.style.overflow = window.__etcOvPrev || "";
      setTimeout(function () {
        try { el.remove(); } catch (_) {}
        try { opts.onClose && opts.onClose(); } catch (_) {}
      }, 280);
    };
    // Always allow backdrop tap to dismiss (ignore sticky freezers)
    el.addEventListener("click", function (e) {
      if (e.target === el) close();
    });
    el.querySelectorAll("[data-close]").forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        close();
      });
    });
    // Escape key
    const onKey = function (e) {
      if (e.key === "Escape") { close(); window.removeEventListener("keydown", onKey); }
    };
    window.addEventListener("keydown", onKey);
    // Safety auto-dismiss after 45s so UI can never stay locked forever
    if (opts.sticky !== "force") {
      setTimeout(function () { try { close(); } catch (_) {} }, opts.maxMs || 45000);
    }
    return { el: el, close: close };
  }

  var tt = 0, toastEl = null;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "ov-toast";
      toastEl.setAttribute("role", "status");
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(tt);
    tt = setTimeout(function () { toastEl.classList.remove("show"); }, 2200);
  }

  // v10: tell the passenger when the connection drops / returns (the app keeps working from saved data)
  window.addEventListener("offline", function () { toast("You're offline – saved pages and tickets still work"); });
  window.addEventListener("online", function () { toast("Back online"); });

  const X = '<svg class="ico" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  return { esc: esc, overlay: overlay, toast: toast, X: X, clearOrphans: clearOrphans };
})();
