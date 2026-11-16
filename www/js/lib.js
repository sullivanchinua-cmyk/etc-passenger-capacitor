// Loads third-party libs with fallbacks: ./vendor/<file> first (drop the files there for
// true offline use), then two CDNs. Resolves with the global, or null if all fail.
window.ETC_LIB = (function () {
  const SRC = {
    qrcode: { g: "QRCode", u: ["vendor/qrcode.min.js", "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js", "https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"] },
    dexie:  { g: "Dexie",  u: ["vendor/dexie.min.js", "https://cdn.jsdelivr.net/npm/dexie@3.2.7/dist/dexie.min.js", "https://unpkg.com/dexie@3.2.7/dist/dexie.min.js"] },
  };
  const cache = {};
  function tag(url) {
    return new Promise((res, rej) => { const s = document.createElement("script"); s.src = url; s.async = true; s.onload = res; s.onerror = () => { s.remove(); rej(new Error(url)); }; document.head.appendChild(s); });
  }
  function load(name) {
    const d = SRC[name];
    if (window[d.g]) return Promise.resolve(window[d.g]);
    if (cache[name]) return cache[name];
    return (cache[name] = (async () => {
      for (const u of d.u) { try { await tag(u); if (window[d.g]) return window[d.g]; } catch (_) {} }
      cache[name] = null; return null;
    })());
  }
  return { load };
})();
