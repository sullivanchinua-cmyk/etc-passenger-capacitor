/* ETC Passenger PWA / TWA Service Worker  (v10 – full offline)
 *
 * What works with no connection (after the first online launch):
 *   - the whole app shell: every page, script, stylesheet, photo, icon and the intro sound
 *   - third-party libraries the pages load from CDNs (Tailwind, Google font, Firebase SDK, Leaflet,
 *     QR + Dexie for tickets, jsPDF) – kept in their own cache so app updates don't re-download them
 *   - map tiles you have already looked at (last ~150)
 *   - the TWA start_url ("/?source=pwa") is always answered from cache, so the app opens offline
 * Never cached on purpose: Firestore / Auth / FCM / routing API calls (Firestore keeps its own offline
 * copy through enablePersistence).
 *
 * Release rule: change CACHE_VERSION whenever any file in PRECACHE changes.
 */
const CACHE_VERSION = "etc-v10-20261118-spa-views";
const CDN_CACHE = "etc-cdn-v1";
const TILE_CACHE = "etc-tiles-v1";
const TILE_MAX = 150;

const abs = (p) => new URL(p, self.registration.scope).href;

const PRECACHE = [
  "",
  "ai.html",
  "book.html",
  "details.html",
  "events.html",
  "games.html",
  "history.html",
  "index.html",
  "map.html",
  "notifications.html",
  "offline.html",
  "route-card-component.html",
  "search.html",
  "ticket.html",
  "manifest.webmanifest",
  "css/ai.css",
  "css/pay.css",
  "css/styles.css",
  "css/tickets.css",
  "js/ai.js",
  "js/book.js",
  "js/calendar.js",
  "js/native-alarm.js",
  "js/chat-bridge.js",
  "js/chess-engine.js",
  "js/data.js",
  "js/details.js",
  "js/dispute-replies.js",
  "js/dock.js",
  "js/etc-intro.js",
  "js/events.js",
  "js/fares-live.js",
  "js/firebase-config.js",
  "js/firebase-init.js",
  "js/home.js",
  "js/icons.js",
  "js/lib.js",
  "js/safe-area.js",
  "js/spa.js",
  "js/map-fix.js",
  "native/deeplink.js",
  "js/machine.js",
  "js/map.js",
  "js/nav.js",
  "js/notifications.js",
  "js/occupancy.js",
  "js/pay-flow.js",
  "js/pay-validate.js",
  "js/pay.js",
  "js/paystack-mock.js",
  "js/perf-probe.js",
  "js/profile.js",
  "js/push.js",
  "js/qrlive.js",
  "js/search.js",
  "js/seats.js",
  "js/slots.js",
  "js/store.js",
  "js/ticket.js",
  "js/tickets.js",
  "js/tokens.js",
  "js/ui.js",
  "assets/bus.png",
  "assets/bus-shadow.png",
  "assets/terminals/abakpa-bg.jpg",
  "assets/terminals/abakpa.jpg",
  "assets/terminals/gariki-bg.jpg",
  "assets/terminals/gariki.jpg",
  "assets/terminals/holy-ghost-1-bg.jpg",
  "assets/terminals/holy-ghost-1.jpg",
  "assets/terminals/holy-ghost-2-bg.jpg",
  "assets/terminals/holy-ghost-2.jpg",
  "assets/terminals/holy-ghost-3-bg.jpg",
  "assets/terminals/holy-ghost-3.jpg",
  "assets/terminals/nsukka-bg.jpg",
  "assets/terminals/nsukka.jpg",
  "assets/intro/intro-sound.m4a",
  "assets/intro/logo-left.webp",
  "assets/intro/logo-right.webp",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-192.png",
  "icons/maskable-512.png",
  "icons/mono-192.png"
];

// Third-party files fetched once at install, then kept (own cache, survives app updates)
const FONTS_CSS = "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap";
const CDN_PRECACHE = [
  "https://cdn.tailwindcss.com",
  FONTS_CSS,
  "https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore-compat.js",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js",
  "https://cdn.jsdelivr.net/npm/dexie@3.2.7/dist/dexie.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  "https://i.pravatar.cc/88?img=12"
];

const isCdn = (u) =>
  u.hostname === "cdn.tailwindcss.com" ||
  u.hostname === "fonts.googleapis.com" ||
  u.hostname === "fonts.gstatic.com" ||
  u.hostname === "unpkg.com" ||
  u.hostname === "cdnjs.cloudflare.com" ||
  u.hostname === "cdn.jsdelivr.net" ||
  u.hostname === "i.pravatar.cc" ||
  (u.hostname === "www.gstatic.com" && u.pathname.indexOf("/firebasejs/") === 0);
const isTile = (u) => /^[abc]\.tile\.openstreetmap\.org$/.test(u.hostname);

// ---------- helpers ----------
// CORS first (small, readable copy); some hosts refuse it, so fall back to an opaque copy (fine for <script>/<img>)
async function cdnFetch(url) {
  try { return await fetch(new Request(url, { mode: "cors", credentials: "omit" })); }
  catch (_) { return await fetch(new Request(url, { mode: "no-cors" })); }
}
async function cdnStore(url) {
  const key = new URL(url).href;
  const res = await cdnFetch(key);
  if (res && (res.ok || res.type === "opaque")) {
    const cache = await caches.open(CDN_CACHE);
    await cache.put(key, res.clone());
  }
  return res;
}
// Slice a cached full file into a 206 – audio / video ask for byte ranges
async function rangeFrom(res, req) {
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") || "");
  if (!m) return res;
  const buf = await res.clone().arrayBuffer();
  const size = buf.byteLength;
  const start = m[1] === "" ? Math.max(0, size - parseInt(m[2], 10)) : parseInt(m[1], 10);
  const end = m[1] === "" || m[2] === "" ? size - 1 : Math.min(parseInt(m[2], 10), size - 1);
  if (start >= size) return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + size } });
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      "Content-Type": res.headers.get("Content-Type") || "application/octet-stream",
      "Content-Range": "bytes " + start + "-" + end + "/" + size,
      "Content-Length": String(end - start + 1)
    }
  });
}

// ---------- install ----------
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // one missing file must not abort the rest (cache.addAll is all-or-nothing)
    await Promise.allSettled(PRECACHE.map(async (p) => {
      const res = await fetch(new Request(abs(p), { cache: "reload" }));
      if (!res.ok || res.redirected) throw new Error("precache " + p + " " + res.status);
      await cache.put(abs(p), res);
    }));
    await Promise.allSettled(CDN_PRECACHE.map(cdnStore));
    // Google font files named inside the font stylesheet
    try {
      const css = await (await cdnStore(FONTS_CSS)).clone().text();
      const urls = (css.match(/https:\/\/fonts\.gstatic\.com[^)'"\s]+/g) || []);
      await Promise.allSettled(urls.map(cdnStore));
    } catch (_) {}
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => /^etc-v/.test(k) && k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ---------- fetch ----------
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    event.respondWith(req.mode === "navigate" ? handleNavigate(event, url) : handleAsset(event));
  } else if (isCdn(url)) {
    event.respondWith(handleCdn(event));
  } else if (isTile(url)) {
    event.respondWith(handleTile(event));
  }
  // everything else (Firestore, Auth, FCM, routing API …) goes straight to the network
});

// Pages: network first (3.5 s), then the saved copy, then offline.html. Query strings are ignored for the
// saved copy – "/?source=pwa" (TWA start_url) and "details.html?from=…" all find their page.
async function matchPage(cache, url) {
  const p = url.pathname;
  const tries = p.endsWith("/") ? [p, p + "index.html"] : [p, p + ".html", p + "/index.html"];
  for (const t of tries) {
    const hit = await cache.match(new URL(t, url.origin).href);
    if (hit) return hit;
  }
  return undefined;
}
async function handleNavigate(event, url) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await matchPage(cache, url);
  const net = fetch(event.request).then(async (res) => {
    // a redirected response cannot be stored for a navigation – keep only plain 200 pages
    if (res && res.ok && !res.redirected && res.type === "basic") {
      await cache.put(new URL(url.pathname, url.origin).href, res.clone());
    }
    return res;
  });
  event.waitUntil(net.catch(() => {}));      // keep refreshing the saved copy even after we answered
  if (!cached) {
    return net.catch(async () => (await cache.match(abs("offline.html"))) || Response.error());
  }
  const slow = new Promise((r) => setTimeout(() => r(cached), 3500));
  return Promise.race([net.then((res) => (res.ok || res.type === "opaqueredirect" ? res : cached)).catch(() => cached), slow]);
}

// Same-origin files: serve the saved copy instantly and refresh it in the background
async function handleAsset(event) {
  const req = event.request;
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(req);
  if (req.headers.has("range")) {
    return cached ? rangeFrom(cached, req) : fetch(req);
  }
  const net = fetch(req).then(async (res) => {
    if (res && res.ok && res.status === 200 && !res.redirected) await cache.put(req, res.clone());
    return res;
  });
  if (cached) { event.waitUntil(net.catch(() => {})); return cached; }
  try { return await net; }
  catch (err) {
    const alt = await cache.match(req, { ignoreSearch: true });
    if (alt) return alt;
    throw err;
  }
}

// CDN files: saved copy first, refreshed in the background
async function handleCdn(event) {
  const key = new URL(event.request.url).href;
  const cache = await caches.open(CDN_CACHE);
  const cached = await cache.match(key, { ignoreVary: true });
  const net = cdnFetch(key).then(async (res) => {
    if (res && (res.ok || res.type === "opaque")) await cache.put(key, res.clone());
    return res;
  });
  if (cached) { event.waitUntil(net.catch(() => {})); return cached; }
  return net.catch(() => Response.error());
}

// Map tiles: keep the ones already seen (small cap so storage stays tiny)
async function handleTile(event) {
  const key = event.request.url;
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(key);
  if (cached) return cached;
  try {
    const res = await fetch(new Request(key, { mode: "cors", credentials: "omit" }));
    if (res.ok) {
      event.waitUntil((async () => {
        await cache.put(key, res.clone());
        const keys = await cache.keys();
        for (let i = 0; i < keys.length - TILE_MAX; i++) await cache.delete(keys[i]);
      })());
    }
    return res;
  } catch (_) {
    try { return await fetch(event.request); } catch (__) { return Response.error(); }
  }
}

// ---------- Push / Notifications ----------
self.addEventListener("push", (event) => {
  let data = { title: "ETC Bus", body: "You have a new update", icon: "/icons/icon-192.png", badge: "/icons/mono-192.png", tag: "etc-general", data: { url: "/" } };
  try {
    if (event.data) {
      const payload = event.data.json();
      data = Object.assign(data, payload);
      if (payload.notification) {
        data.title = payload.notification.title || data.title;
        data.body = payload.notification.body || data.body;
        data.icon = payload.notification.icon || data.icon;
        data.image = payload.notification.image;
      }
      if (payload.data) data.data = Object.assign(data.data || {}, payload.data);
    }
  } catch (e) {
    try {
      data.body = event.data.text();
    } catch (_) {}
  }

  const options = {
    body: data.body,
    icon: data.icon || "/icons/icon-192.png",
    badge: data.badge || "/icons/mono-192.png",
    image: data.image,
    tag: data.tag || "etc-" + Date.now(),
    renotify: !!data.renotify,
    requireInteraction: !!data.requireInteraction || data.kind === "alarm",
    vibrate: data.kind === "alarm" ? [200, 100, 200, 100, 400] : [120, 60, 120],
    data: data.data || { url: "/" },
    actions: data.actions || [
      { action: "open", title: "Open" },
      { action: "dismiss", title: "Dismiss" }
    ]
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const action = event.action;
  if (action === "dismiss") return;

  let target = "/";
  try {
    const d = event.notification.data || {};
    target = d.url || d.click_action || "/";
    if (d.type === "chat" || d.chatId) target = "/chat/" + (d.chatId ? "?room=" + encodeURIComponent(d.chatId) : "");
    if (d.type === "ticket" || d.ticketId) target = "/ticket.html?id=" + encodeURIComponent(d.ticketId || "");
    if (d.type === "occupancy") target = "/?view=home";
    if (d.type === "alarm" || d.type === "calendar") target = "/?cal=1";
  } catch (_) {}

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.includes(self.location.origin) && "focus" in c) {
          c.postMessage({ type: "etc-notification-click", data: event.notification.data });
          return c.focus().then(() => c.navigate ? c.navigate(target) : null);
        }
      }
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});

self.addEventListener("notificationclose", (event) => {
  // optional analytics
});

// Allow page to ask SW to show a local notification (for alarms when tab is backgrounded)
self.addEventListener("message", (event) => {
  const msg = event.data || {};
  if (msg.type === "SHOW_NOTIFICATION") {
    const { title, options } = msg;
    event.waitUntil(self.registration.showNotification(title || "ETC", options || {}));
  }
  if (msg.type === "SKIP_WAITING") self.skipWaiting();
});
