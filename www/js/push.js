/* ETC Push + system notifications
 * - Requests Notification permission
 * - Initializes Firebase Cloud Messaging (FCM) when available
 * - Exposes window.ETC_Push.show(title, opts) that prefers Service Worker notification
 * - Saves FCM token to localStorage + optional Firestore users/{uid}/fcmTokens
 *
 * Wire:
 *  - Calendar alarms already call Notification; this upgrades them via SW when possible
 *  - Chat / occupancy / ticket booking should call ETC_Push.show or rely on server FCM
 */
(function () {
  "use strict";

  const VAPID_KEY = null; // Optional: paste your Web Push certificate key from Firebase Console > Project settings > Cloud Messaging > Web Push certificates
  // Without VAPID_KEY, getToken still works in many setups if the messagingSenderId is present; for production set it.

  function log() {
    if (window.ETC_DEBUG) console.log.apply(console, ["[ETC Push]"].concat([].slice.call(arguments)));
  }

  async function ensurePermission() {
    if (window.EtcNotify && window.EtcNotify.native) return window.EtcNotify.ensurePermission();
    if (!("Notification" in window)) return "unsupported";
    if (Notification.permission === "granted") return "granted";
    if (Notification.permission === "denied") return "denied";
    try {
      return await Notification.requestPermission();
    } catch (_) {
      return Notification.permission;
    }
  }

  async function showViaSW(title, options) {
    if (!("serviceWorker" in navigator)) return false;
    try {
      const reg = await navigator.serviceWorker.ready;
      if (reg && reg.showNotification) {
        await reg.showNotification(title, options || {});
        return true;
      }
      // fallback message to SW
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: "SHOW_NOTIFICATION", title: title, options: options });
        return true;
      }
    } catch (e) {
      log("SW show failed", e);
    }
    return false;
  }

  async function show(title, opts) {
    opts = opts || {};
    if (window.EtcNotify && window.EtcNotify.native) return window.EtcNotify.show(title, opts);   // Capacitor app: real Android notification
    const options = {
      body: opts.body || "",
      icon: opts.icon || "/icons/icon-192.png",
      badge: opts.badge || "/icons/mono-192.png",
      tag: opts.tag || "etc-" + Date.now(),
      renotify: !!opts.renotify,
      requireInteraction: !!opts.requireInteraction,
      vibrate: opts.vibrate || [120, 60, 120],
      data: opts.data || { url: opts.url || "/" },
      image: opts.image,
      actions: opts.actions
    };
    const perm = await ensurePermission();
    if (perm !== "granted") {
      log("permission not granted:", perm);
      return false;
    }
    // Prefer SW so it appears in system tray / control panel even when app is backgrounded
    if (await showViaSW(title, options)) return true;
    try {
      new Notification(title, options);
      return true;
    } catch (e) {
      log("Notification ctor failed", e);
      return false;
    }
  }

  async function initFCM() {
    if (window.EtcNotify && window.EtcNotify.native) return null;   // Capacitor app uses native FCM (native/notifications.js)
    if (!window.firebase || !window.ETC_FIREBASE_CONFIG) {
      log("Firebase not ready");
      return null;
    }
    try {
      // Load messaging compat if not present
      if (!firebase.messaging) {
        await new Promise(function (resolve, reject) {
          const s = document.createElement("script");
          s.src = "https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js";
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      }
      if (!firebase.apps.length && window.ETC_FIREBASE_CONFIG) {
        firebase.initializeApp(window.ETC_FIREBASE_CONFIG);
      }
      const messaging = firebase.messaging();
      // Use our SW
      const reg = await navigator.serviceWorker.ready;
      const tokenOpts = { serviceWorkerRegistration: reg };
      if (VAPID_KEY) tokenOpts.vapidKey = VAPID_KEY;

      const token = await messaging.getToken(tokenOpts);
      if (token) {
        try { localStorage.setItem("etc_fcm_token", token); } catch (_) {}
        log("FCM token", token.slice(0, 20) + "…");
        // Persist under user if signed in
        try {
          const uid = (window.ETC_FB && window.ETC_FB.auth && window.ETC_FB.auth.currentUser && window.ETC_FB.auth.currentUser.uid) || localStorage.getItem("etc_chat_uid");
          if (uid && window.ETC_FB && window.ETC_FB.db) {
            const ref = window.ETC_FB.db.collection("users").doc(uid).collection("fcmTokens").doc(token.slice(0, 24));
            await ref.set({ token: token, updatedAt: Date.now(), platform: "web", ua: navigator.userAgent }, { merge: true });
          }
        } catch (e) { log("token persist", e); }
      }

      messaging.onMessage(function (payload) {
        log("foreground message", payload);
        const n = (payload && payload.notification) || {};
        const d = (payload && payload.data) || {};
        show(n.title || "ETC Bus", {
          body: n.body || d.body || "New message",
          icon: n.icon || "/icons/icon-192.png",
          tag: d.tag || "etc-fcm",
          data: Object.assign({ url: d.url || "/" }, d),
          requireInteraction: d.kind === "alarm"
        });
      });

      return token;
    } catch (e) {
      log("FCM init error", e);
      return null;
    }
  }

  // Public API
  window.ETC_Push = {
    ensurePermission: ensurePermission,
    show: show,
    initFCM: initFCM,
    // Convenience helpers used by calendar / occupancy / chat
    alarm: function (note, whenIso) {
      return show("🚌 ETC Alarm", {
        body: note || "Travel reminder",
        tag: "etc-alarm-" + (whenIso || Date.now()),
        requireInteraction: true,
        vibrate: [200, 100, 200, 100, 400],
        data: { type: "alarm", url: "/?cal=1" }
      });
    },
    chat: function (from, text, roomId) {
      return show(from || "Chat", {
        body: text || "New message",
        tag: "etc-chat-" + (roomId || "general"),
        data: { type: "chat", chatId: roomId || "", url: "/chat/" }
      });
    },
    ticket: function (title, body, ticketId) {
      return show(title || "Ticket booked", {
        body: body || "Your ticket is ready",
        tag: "etc-ticket-" + (ticketId || Date.now()),
        data: { type: "ticket", ticketId: ticketId || "", url: ticketId ? "/ticket.html?id=" + encodeURIComponent(ticketId) : "/notifications.html" }
      });
    },
    occupancy: function (route, mins) {
      return show("Bus almost full", {
        body: (route || "Your route") + " — about " + (mins || 10) + " minutes until full capacity",
        tag: "etc-occ-" + (route || "x"),
        data: { type: "occupancy", url: "/" }
      });
    }
  };

  // Auto-init after load (non-blocking)
  window.addEventListener("load", function () {
    setTimeout(function () {
      ensurePermission().then(function (p) {
        if (p === "granted") initFCM();
      });
    }, 2500);
  });
})();
