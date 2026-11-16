// =========================================================
// ETC Passenger – Firebase bootstrap (compat SDK).
//
// Auth strategy (avoids anonymous account spam):
//   1. Wait for Firebase to restore the previous session (LOCAL persistence).
//   2. Reuse that user (anonymous or email) – never create a new anonymous
//      user if one is already restored.
//   3. Persist { uid, isAnonymous, email } in localStorage as a mirror so
//      we can detect session loss and avoid duplicate sign-ins.
//   4. When the passenger signs up with email, LINK the anonymous account
//      (linkWithCredential) so the same uid is kept – no orphan anonymous users.
//
// Exposes window.ETC_FB = {
//   app, auth, db, FieldValue,
//   ensureAuth(),          // restore or single anonymous
//   linkEmailPassword(email, password),
//   signInEmailPassword(email, password),
//   signOut(),
//   currentUser()
// }
// =========================================================
(function () {
  if (!window.firebase || !window.ETC_FIREBASE_CONFIG) {
    console.warn("[ETC Firebase] SDK or config missing – passenger app will stay fully offline.");
    window.ETC_FB = null;
    return;
  }
  if (window.ETC_FIREBASE_CONFIG.apiKey === "REPLACE_ME") {
    console.warn("[ETC Firebase] config still has REPLACE_ME – fill firebase-config.js first.");
    window.ETC_FB = null;
    return;
  }

  const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(window.ETC_FIREBASE_CONFIG);
  const auth = firebase.auth();
  const db = firebase.firestore();

  // Keep the same user across reloads on this browser
  try {
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
  } catch (_) {}

  db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
    console.warn("[ETC Firebase] persistence not enabled:", err && err.code);
  });

  // After a long time in the background the Firestore socket can be dead. Cycle the network
  // when the page comes back so listeners/reads recover instead of hanging.
  let _hiddenAt = 0;
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { _hiddenAt = Date.now(); return; }
    if (_hiddenAt && Date.now() - _hiddenAt > 60000) {
      db.disableNetwork().then(function () { return db.enableNetwork(); }).catch(function () {});
    }
    _hiddenAt = 0;
  });

  const META_KEY = "etc_fb_meta"; // mirror of last known auth user

  function saveMeta(user) {
    try {
      if (!user) {
        localStorage.removeItem(META_KEY);
        return;
      }
      localStorage.setItem(META_KEY, JSON.stringify({
        uid: user.uid,
        isAnonymous: !!user.isAnonymous,
        email: user.email || null,
        at: Date.now(),
      }));
    } catch (_) {}
  }

  function readMeta() {
    try { return JSON.parse(localStorage.getItem(META_KEY)) || null; } catch (_) { return null; }
  }

  // Resolve once Firebase has restored any existing session
  let readyP = null;
  function whenAuthReady() {
    if (readyP) return readyP;
    readyP = new Promise((resolve) => {
      const unsub = auth.onAuthStateChanged((user) => {
        unsub();
        if (user) saveMeta(user);
        resolve(user || null);
      });
    });
    return readyP;
  }

  let authP = null;
  /**
   * Returns a Firebase user. Prefers restored session.
   * Only creates ONE anonymous user per browser profile, then reuses it.
   */
  async function ensureAuth() {
    if (auth.currentUser) {
      saveMeta(auth.currentUser);
      return auth.currentUser;
    }
    if (authP) return authP;

    authP = (async () => {
      const restored = await whenAuthReady();
      if (restored) {
        saveMeta(restored);
        return restored;
      }
      // No session – create a single anonymous user for this install
      const cred = await auth.signInAnonymously();
      saveMeta(cred.user);
      return cred.user;
    })().catch((e) => {
      authP = null;
      console.warn("[ETC Firebase] ensureAuth failed:", e);
      throw e;
    });

    return authP;
  }

  /**
   * After local signup: attach email/password to the current anonymous uid
   * so we don't leave orphan anonymous accounts in Firebase.
   */
  async function linkEmailPassword(email, password) {
    await ensureAuth();
    const user = auth.currentUser;
    if (!user) throw new Error("No Firebase user");
    const cred = firebase.auth.EmailAuthProvider.credential(email, password);
    if (user.isAnonymous) {
      try {
        const linked = await user.linkWithCredential(cred);
        saveMeta(linked.user);
        return linked.user;
      } catch (e) {
        // Email already in use → sign in to that account instead
        if (e && e.code === "auth/email-already-in-use") {
          const signed = await auth.signInWithEmailAndPassword(email, password);
          saveMeta(signed.user);
          return signed.user;
        }
        throw e;
      }
    }
    // Already has email – just sign in
    const signed = await auth.signInWithEmailAndPassword(email, password);
    saveMeta(signed.user);
    return signed.user;
  }

  async function signInEmailPassword(email, password) {
    const signed = await auth.signInWithEmailAndPassword(email, password);
    saveMeta(signed.user);
    return signed.user;
  }

  async function signOut() {
    try { await auth.signOut(); } catch (_) {}
    // After sign-out, next ensureAuth may create a new anonymous – that's intentional
    // only when a real user fully logs out. Prefer keeping session for ticket uploads.
    saveMeta(null);
    authP = null;
    readyP = null;
  }

  function currentUser() {
    return auth.currentUser;
  }

  window.ETC_FB = {
    app,
    auth,
    db,
    FieldValue: firebase.firestore.FieldValue,
    ensureAuth,
    linkEmailPassword,
    signInEmailPassword,
    signOut,
    currentUser,
    readMeta,
  };
})();
