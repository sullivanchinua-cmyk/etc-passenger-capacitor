// =========================================================
// Shared bottom nav – the white pill glides to the tapped tab,
// then the page opens. (Pages are separate files, so we let the
// glide play for a moment before navigating.)
// =========================================================
(function () {
  const nav = document.querySelector(".etc-nav");
  if (!nav) return;

  const tabs = Array.from(nav.querySelectorAll(".etc-tab"));
  const ownIndex = Number(nav.dataset.active);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let leaving = false;

  function setActive(i) {
    nav.dataset.active = String(i);
    nav.style.setProperty("--i", i);
    tabs.forEach((t, k) => {
      t.classList.toggle("is-active", k === i);
      if (k === i) t.setAttribute("aria-current", "page");
      else t.removeAttribute("aria-current");
    });
  }

  // Initial state is set in the HTML; enable animations after first paint
  setActive(ownIndex);
  requestAnimationFrame(() => requestAnimationFrame(() => nav.classList.remove("no-anim")));

  tabs.forEach((tab, i) => {
    tab.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      if (leaving || i === ownIndex) return;
      leaving = true;
      setActive(i);
      const href = tab.getAttribute("href");
      setTimeout(() => { window.location.href = href; }, reduceMotion ? 0 : 300);
    });
  });

  // Back/forward cache or a cached view shown again (js/spa.js): restore this page's own tab
  window.addEventListener("etc:show", () => {
    leaving = false;
    nav.classList.add("no-anim");
    setActive(ownIndex);
    requestAnimationFrame(() => requestAnimationFrame(() => nav.classList.remove("no-anim")));
  });
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) {
      leaving = false;
      nav.classList.add("no-anim");
      setActive(ownIndex);
      requestAnimationFrame(() => requestAnimationFrame(() => nav.classList.remove("no-anim")));
    }
  });
})();
