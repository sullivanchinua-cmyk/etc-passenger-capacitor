// =========================================================
// Profile overlay – premium glass sheet
// =========================================================
(function () {
  const btn = document.getElementById("profileBtn");
  if (!btn) return;

  const USER_KEY = "etc_user";
  function loadUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY)) || null; } catch (_) { return null; }
  }
  const DEFAULT_AV = "https://i.pravatar.cc/88?img=12";
  function syncHeaderAvatar(src) {
    const hdr = document.getElementById("hdrAvatar") || btn.querySelector("img");
    if (!hdr) return;
    const u = loadUser();
    const url = src || (u && u.avatar) || DEFAULT_AV;
    if (hdr.src !== url) hdr.src = url;
  }

  const ov = document.createElement("div");
  ov.className = "ov profile-ov";
  ov.setAttribute("aria-hidden", "true");
  ov.innerHTML = `
    <div class="profile-card" id="profCard" role="dialog" aria-label="Profile">
      <div class="profile-top">
        <div class="profile-avatar-wrap">
          <img class="profile-avatar" id="profAvatar" src="https://i.pravatar.cc/128?img=12" alt="" />
          <button type="button" class="profile-avatar-plus" id="profAvatarPlus" aria-label="Upload photo" title="Upload photo">
            <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
          </button>
          <input type="file" id="profAvatarFile" accept="image/*" hidden />
        </div>
        <div class="profile-meta">
          <h3 id="profName">Guest Rider</h3>
          <p id="profSub">Tap Login or Sign up</p>
        </div>
        <button type="button" class="profile-close" id="profClose" aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <div class="profile-body">
        <div class="profile-actions" id="profAuth">
          <button type="button" class="p-btn primary" id="profLogin">Login</button>
          <button type="button" class="p-btn ghost" id="profSignup">Sign up</button>
        </div>
        <div class="profile-menu">
          <button type="button" class="profile-item" id="profHistory">
            <span class="ic"><svg viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg></span>
            Receipt History
            <span class="chev"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></span>
          </button>
          <button type="button" class="profile-item" id="profDispute">
            <span class="ic"><svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/></svg></span>
            Report Dispute
            <span class="chev"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></span>
          </button>
          <button type="button" class="profile-item" id="profGames">
            <span class="ic"><svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="3"/><path d="M6 12h4M8 10v4M15 11h.01M18 13h.01"/></svg></span>
            Waiting Games
            <span class="chev"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></span>
          </button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(ov);

  function isUnlocked(u) {
    return !!(u && u.name && u.unlocked !== false);
  }
  function paint() {
    const u = loadUser();
    const card = ov.querySelector("#profCard");
    const av = ov.querySelector("#profAvatar");
    const name = ov.querySelector("#profName");
    const sub = ov.querySelector("#profSub");
    const auth = ov.querySelector("#profAuth");
    if (isUnlocked(u)) {
      card?.classList.add("is-in");
      name.textContent = u.name;
      sub.textContent = u.email || "Signed in";
      if (u.avatar && String(u.avatar).indexOf("pravatar") === -1) {
        av.src = u.avatar;
        syncHeaderAvatar(u.avatar);
      }
      pullAvatarFromFirebase().then(function (a) {
        if (a) { av.src = a; syncHeaderAvatar(a); }
      });
      auth.className = "profile-actions is-logout";
      auth.innerHTML = `<button type="button" class="p-btn logout-btn" id="profLogout">Log out</button>`;
      ov.querySelector("#profLogout")?.addEventListener("click", () => {
        try {
          const cur = loadUser() || {};
          cur.unlocked = false;
          localStorage.setItem(USER_KEY, JSON.stringify(cur));
        } catch (_) {}
        paint();
      });
    } else {
      card?.classList.remove("is-in");
      name.textContent = u && u.name ? u.name : "Guest Rider";
      sub.textContent = u && u.name ? "Locked · tap Login" : "Tap Login or Sign up";
      av.src = (u && u.avatar) || "https://i.pravatar.cc/128?img=12";
      auth.className = "profile-actions";
      auth.innerHTML = `
        <button type="button" class="p-btn primary" id="profLogin">Login</button>
        <button type="button" class="p-btn ghost" id="profSignup">Sign up</button>`;
      ov.querySelector("#profLogin")?.addEventListener("click", () => openAuth("login"));
      ov.querySelector("#profSignup")?.addEventListener("click", () => openAuth("signup"));
    }
    syncHeaderAvatar();
  }

  // Avatar upload — compress + save local + Firebase users/{uid}
  function compressAvatar(dataUrl, maxSide, quality) {
    return new Promise((resolve) => {
      const im = new Image();
      im.onload = () => {
        let w = im.width, h = im.height;
        if (w > maxSide || h > maxSide) {
          if (w > h) { h = Math.round(h * maxSide / w); w = maxSide; }
          else { w = Math.round(w * maxSide / h); h = maxSide; }
        }
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(im, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", quality || 0.72));
      };
      im.onerror = () => resolve(dataUrl);
      im.src = dataUrl;
    });
  }
  async function pushAvatarToFirebase(dataUrl) {
    try {
      if (!window.ETC_FB || !window.ETC_FB.db) return;
      await window.ETC_FB.ensureAuth();
      const user = window.ETC_FB.currentUser && window.ETC_FB.currentUser();
      const u = loadUser() || {};
      const uid = (user && user.uid) || u.firebaseUid;
      const FV = window.ETC_FB.FieldValue;
      const payload = {
        avatar: dataUrl,
        name: u.name || null,
        email: (u.email || "").toLowerCase() || null,
        avatarUpdatedAt: FV.serverTimestamp(),
      };
      // Save under uid AND email so login on another device / auth mode still finds it
      if (uid) await window.ETC_FB.db.collection("users").doc(String(uid)).set(payload, { merge: true });
      if (u.email) {
        const ek = "email_" + String(u.email).toLowerCase().replace(/[^a-z0-9@._-]/g, "_");
        await window.ETC_FB.db.collection("users").doc(ek).set(payload, { merge: true });
      }
    } catch (e) { console.warn("[ETC profile] avatar upload", e); }
  }
  async function pullAvatarFromFirebase() {
    try {
      if (!window.ETC_FB || !window.ETC_FB.db) return null;
      await window.ETC_FB.ensureAuth();
      const user = window.ETC_FB.currentUser && window.ETC_FB.currentUser();
      const u = loadUser() || {};
      const uid = (user && user.uid) || u.firebaseUid;
      let av = null;
      if (uid) {
        const doc = await window.ETC_FB.db.collection("users").doc(String(uid)).get();
        if (doc.exists && doc.data().avatar) av = doc.data().avatar;
      }
      if (!av && u.email) {
        const ek = "email_" + String(u.email).toLowerCase().replace(/[^a-z0-9@._-]/g, "_");
        const doc2 = await window.ETC_FB.db.collection("users").doc(ek).get();
        if (doc2.exists && doc2.data().avatar) av = doc2.data().avatar;
      }
      if (av) {
        u.avatar = av;
        localStorage.setItem(USER_KEY, JSON.stringify(u));
        syncHeaderAvatar(av);
        return av;
      }
    } catch (e) { console.warn("[ETC profile] avatar pull", e); }
    return null;
  }
  (function wireAvatarUpload() {
    const plus = ov.querySelector("#profAvatarPlus");
    const file = ov.querySelector("#profAvatarFile");
    const img = ov.querySelector("#profAvatar");
    if (!plus || !file) return;
    function pick(e) {
      e.preventDefault();
      e.stopPropagation();
      file.click();
    }
    plus.addEventListener("pointerdown", pick);
    plus.addEventListener("click", pick);
    file.addEventListener("change", () => {
      const f = file.files && file.files[0];
      if (!f || !f.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = () => {
        compressAvatar(reader.result, 240, 0.65).then((small) => {
          img.src = small;
          try {
            const u = loadUser() || {};
            u.avatar = small;
            if (!u.name) u.unlocked = false;
            localStorage.setItem(USER_KEY, JSON.stringify(u));
          } catch (_) {}
          syncHeaderAvatar(small);
          pushAvatarToFirebase(small);
          const toast = document.getElementById("toast");
          if (toast) {
            toast.textContent = "Photo saved";
            toast.classList.add("show");
            setTimeout(() => toast.classList.remove("show"), 1800);
          }
        });
      };
      reader.readAsDataURL(f);
      file.value = "";
    });
  })();


  function open() {
    paint();
    ov.classList.add("show");
    ov.setAttribute("aria-hidden", "false");
  }
  function close() {
    ov.classList.remove("show");
    ov.setAttribute("aria-hidden", "true");
  }
  btn.addEventListener("click", open);
  ov.querySelector("#profClose").addEventListener("click", close);
  let downOn = null;
  ov.addEventListener("pointerdown", (e) => { downOn = e.target; });
  ov.addEventListener("click", (e) => { if (e.target === ov && downOn === ov) close(); });

  // =========================================================
  // Auth: signup (name → passcode/password) · login (matching lock)
  // =========================================================
  function saveUser(data) {
    try { localStorage.setItem(USER_KEY, JSON.stringify(data)); } catch (_) {}
  }
  function openAuth(mode) {
    // also exposed as window.ETC_Profile.openAuth
    if (mode === "login") {
      const u = loadUser();
      if (!u || !u.name) {
        openAuth("signup");
        return;
      }
      if (u.security === "passcode" && u.passcode) {
        openLockScreen({ mode: "login", type: "passcode", user: u });
        return;
      }
      if (u.security === "password" && u.password) {
        openLockScreen({ mode: "login", type: "password", user: u });
        return;
      }
      // No lock set – unlock immediately
      try {
        u.unlocked = true;
        localStorage.setItem(USER_KEY, JSON.stringify(u));
      } catch (_) {}
      paint();
      return;
    }
    // Signup: collect name/email first
    const form = document.createElement("div");
    form.className = "ov show sheet-ov";
    form.innerHTML = `
      <div class="alarm-card glass-card" style="max-width:340px">
        <button type="button" class="ov-close" id="authClose" aria-label="Close"><svg class="ico" width="16" height="16" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
        <div class="alarm-date">Create account</div>
        <p class="alarm-sub">Email + passcode · works across your phones</p>
        <label class="alarm-field"><span>Name</span><input type="text" id="authName" placeholder="Your name" autocomplete="name"/></label>
        <label class="alarm-field"><span>Email</span><input type="email" id="authEmail" placeholder="you@email.com" autocomplete="email"/></label>
        <p id="authErr" style="color:#c00;font-size:12px;font-weight:600;min-height:16px;margin:4px 0 0"></p>
        <button type="button" class="alarm-btn primary" id="authGo" style="width:100%;margin-top:8px">Continue</button>
      </div>`;
    document.body.appendChild(form);
    form.querySelector("#authClose").onclick = () => form.remove();
    form.onclick = (e) => { if (e.target === form) form.remove(); };
    form.querySelector("#authGo").onclick = async () => {
      const name = form.querySelector("#authName").value.trim() || "Rider";
      const email = form.querySelector("#authEmail").value.trim().toLowerCase();
      const err = form.querySelector("#authErr");
      const go = form.querySelector("#authGo");
      if (!email || !email.includes("@")) {
        if (err) err.textContent = "Enter a valid email";
        return;
      }
      // Already used on this phone?
      try {
        const local = JSON.parse(localStorage.getItem(USER_KEY) || "null");
        if (local && local.email && local.email.toLowerCase() === email && local.passcode) {
          if (err) err.textContent = "This email is already on this phone — use Login";
          return;
        }
      } catch (_) {}
      // Already registered in Firebase?
      if (window.ETC_FB && window.ETC_FB.auth) {
        go.disabled = true;
        go.textContent = "Checking…";
        try {
          const methods = await window.ETC_FB.auth.fetchSignInMethodsForEmail(email);
          if (methods && methods.length) {
            if (err) err.textContent = "Account already used — please Login instead";
            go.disabled = false;
            go.textContent = "Continue";
            return;
          }
        } catch (e) {
          console.warn("[ETC signup] email check:", e);
          // network fail – still allow local signup
        }
        go.disabled = false;
        go.textContent = "Continue";
      }
      form.remove();
      openLockScreen({
        mode: "setup",
        type: "passcode",
        draft: {
          name,
          email,
          avatar: (loadUser() && loadUser().avatar) || `https://i.pravatar.cc/128?u=${encodeURIComponent(email || name)}`
        }
      });
    };
  }

  /**
   * iPhone-style glass lock screen
   * opts: { mode: 'setup'|'login', type: 'passcode'|'password', user?, draft? }
   */
  function openLockScreen(opts) {
    // Fully close profile so no menu item can receive a ghost click
    close();
    ov.classList.add("locked");
    ov.style.pointerEvents = "none";

    const root = document.createElement("div");
    root.className = "ov show sheet-ov lock-ov";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", opts.mode === "setup" ? "Set security" : "Unlock");
    root.addEventListener("pointerdown", (e) => e.stopPropagation());
    root.addEventListener("click", (e) => e.stopPropagation());

    let type = opts.type || "passcode"; // passcode | password
    let phase = opts.mode === "setup" ? "create" : "enter"; // create | confirm | enter
    let buffer = "";
    let firstCode = "";
    let busy = false;
    const LEN = 6;

    function unlockProfileLayer() {
      try {
        ov.classList.remove("locked");
        ov.style.pointerEvents = "";
        ov.style.removeProperty("pointer-events");
      } catch (_) {}
      // Kill any leftover ghost shields / lock sheets
      try {
        document.querySelectorAll("[data-etc-ghost-shield], .lock-ov").forEach(function (n) {
          try { n.remove(); } catch (_) {}
        });
      } catch (_) {}
    }

    /** Absorb the synthetic click that follows removing a fullscreen overlay on mobile */
    function ghostShield(ms, then) {
      const shield = document.createElement("div");
      shield.setAttribute("aria-hidden", "true");
      shield.setAttribute("data-etc-ghost-shield", "1");
      Object.assign(shield.style, {
        position: "fixed", inset: "0", zIndex: "99999",
        background: "transparent", touchAction: "none", pointerEvents: "auto"
      });
      const block = (e) => { e.preventDefault(); e.stopPropagation(); };
      shield.addEventListener("pointerdown", block, true);
      shield.addEventListener("click", block, true);
      shield.addEventListener("touchstart", block, true);
      document.body.appendChild(shield);
      var finished = false;
      const kill = () => {
        if (finished) return;
        finished = true;
        try { shield.remove(); } catch (_) {}
        if (typeof then === "function") {
          const fn = then;
          then = null;
          try { fn(); } catch (_) {}
        }
      };
      setTimeout(kill, Math.min(ms || 280, 350));
      document.addEventListener("visibilitychange", function onVis() {
        if (!document.hidden) { kill(); document.removeEventListener("visibilitychange", onVis); }
      });
      window.addEventListener("pagehide", function onHide() {
        kill(); window.removeEventListener("pagehide", onHide);
      });
    }

    function finishLock(successMsg) {
      unlockProfileLayer();
      root.remove();
      // Absorb ghost click; return to home (do not reopen profile)
      ghostShield(480, () => {
        paint(); // keep dock avatar / state in sync, profile stays closed
        if (successMsg) toast(successMsg);
      });
    }

    function titleText() {
      if (opts.mode === "login") {
        return type === "password" ? "Enter Password" : "Enter Passcode";
      }
      if (type === "password") {
        return phase === "confirm" ? "Confirm Password" : "Create Password";
      }
      return phase === "confirm" ? "Confirm Passcode" : "Create Passcode";
    }

    function render() {
      const dots = Array.from({ length: LEN }, (_, i) =>
        `<i class="lock-dot"${i < buffer.length ? ' data-on="1"' : ""}></i>`
      ).join("");

      const isPass = type === "password";
      root.innerHTML = `
        <div class="lock-sheet">
          ${opts.mode === "setup" ? `<button type="button" class="lock-skip" id="lockSkip">Skip</button>` : ""}
          <button type="button" class="lock-close" id="lockClose" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
          <div class="lock-icon" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>
            </svg>
          </div>
          <h2 class="lock-title" id="lockTitle">${titleText()}</h2>
          <p class="lock-hint" id="lockHint">${
            opts.mode === "login"
              ? "Welcome back"
              : phase === "confirm"
                ? "Enter it one more time"
                : "Protect your ETC account"
          }</p>

          ${isPass ? `
            <div class="lock-pass-wrap">
              <input type="password" id="lockPassInput" class="lock-pass-input"
                placeholder="${phase === "confirm" ? "Confirm password" : "Password"}"
                autocomplete="${opts.mode === "login" ? "current-password" : "new-password"}"
                maxlength="64"/>
              <button type="button" class="lock-pass-go" id="lockPassGo">Continue</button>
            </div>
          ` : `
            <div class="lock-dots" id="lockDots" aria-live="polite">${dots}</div>
            <div class="lock-pad" id="lockPad">
              ${[1,2,3,4,5,6,7,8,9,"",0,"del"].map((k) => {
                if (k === "") return `<span class="lock-key empty"></span>`;
                if (k === "del") return `<button type="button" class="lock-key del" data-k="del" aria-label="Delete"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 6h11a2 2 0 012 2v8a2 2 0 01-2 2H8l-5-6 5-6z"/><path d="M11 10l4 4M15 10l-4 4"/></svg></button>`;
                return `<button type="button" class="lock-key" data-k="${k}"><span>${k}</span></button>`;
              }).join("")}
            </div>
          `}

          <div class="lock-footer">
            <button type="button" class="lock-toggle" id="lockToggle">${isPass ? "Passcode" : "Password"}</button>
            ${opts.mode === "login" ? `<button type="button" class="lock-toggle ghost" id="lockCancel">Cancel</button>` : ""}
          </div>
        </div>`;

      // wire
      root.querySelector("#lockClose")?.addEventListener("click", () => {
        unlockProfileLayer(); root.remove(); open();
      });
      root.querySelector("#lockCancel")?.addEventListener("click", () => {
        unlockProfileLayer(); root.remove(); open();
      });
      root.querySelector("#lockSkip")?.addEventListener("click", () => {
        if (opts.mode === "setup" && opts.draft) {
          saveUser({ ...opts.draft, security: "none", unlocked: true });
          finishLock("Account created · no lock");
        }
      });
      root.querySelector("#lockToggle")?.addEventListener("click", () => {
        type = type === "passcode" ? "password" : "passcode";
        buffer = "";
        firstCode = "";
        phase = opts.mode === "setup" ? "create" : "enter";
        render();
        if (type === "password") {
          setTimeout(() => root.querySelector("#lockPassInput")?.focus(), 80);
        }
      });

      if (isPass) {
        const inp = root.querySelector("#lockPassInput");
        const go = root.querySelector("#lockPassGo");
        const submitPass = () => {
          const v = (inp.value || "").trim();
          if (v.length < 4) {
            shake();
            toast("Use at least 4 characters");
            return;
          }
          handleSecret(v);
        };
        go.onclick = submitPass;
        inp.onkeydown = (e) => { if (e.key === "Enter") submitPass(); };
        setTimeout(() => inp?.focus(), 60);
      } else {
        function onKey(k) {
          if (busy) return;
          if (k === "del") {
            if (!buffer.length) return;
            buffer = buffer.slice(0, -1);
            paintDots();
            return;
          }
          if (buffer.length >= LEN) return;
          buffer += k;
          paintDots();
          if (buffer.length === LEN) {
            busy = true;
            const code = buffer;
            // Tiny pause so the 6th dot paints first
            requestAnimationFrame(() => setTimeout(() => {
              handleSecret(code);
              if (document.body.contains(root)) busy = false;
            }, 40));
          }
        }
        root.querySelectorAll(".lock-key[data-k]").forEach((btn) => {
          let last = 0;
          const fire = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const now = performance.now();
            if (now - last < 40) return; // ignore ghost double-taps
            last = now;
            btn.classList.add("is-down");
            onKey(btn.dataset.k);
          };
          const lift = () => btn.classList.remove("is-down");
          // pointerdown = react the instant the finger lands (pointerup waited for the lift = felt slow)
          btn.addEventListener("pointerdown", fire, { passive: false });
          btn.addEventListener("pointerup", lift);
          btn.addEventListener("pointercancel", lift);
          btn.addEventListener("pointerleave", lift);
          btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); }, { passive: false });
        });
      }
    }

    function paintDots() {
      const el = root.querySelector("#lockDots");
      if (!el) return;
      const dots = el.children;
      if (dots.length !== LEN) {
        el.innerHTML = Array.from({ length: LEN }, () => `<i class="lock-dot"></i>`).join("");
      }
      // attribute (not class) toggles: class changes make the Tailwind CDN rescan the whole page
      for (let i = 0; i < LEN; i++) {
        if (i < buffer.length) el.children[i].setAttribute("data-on", "1");
        else el.children[i].removeAttribute("data-on");
      }
    }

    function shake() {
      const sheet = root.querySelector(".lock-sheet");
      sheet?.classList.remove("shake");
      void sheet?.offsetWidth;
      sheet?.classList.add("shake");
      buffer = "";
      paintDots();
      const inp = root.querySelector("#lockPassInput");
      if (inp) inp.value = "";
    }

    function handleSecret(secret) {
      if (opts.mode === "login") {
        const u = opts.user;
        const ok =
          (type === "passcode" && secret === u.passcode) ||
          (type === "password" && secret === u.password);
        if (!ok) {
          shake();
          toast("Incorrect · try again");
          return;
        }
        try {
          u.unlocked = true;
          localStorage.setItem(USER_KEY, JSON.stringify(u));
        } catch (_) {}
        // Reuse same Firebase account (email if available)
        if (window.ETC_FB && u.email && secret) {
          const pw = secret.length >= 6 ? secret : (secret + "etcetc").slice(0, 8);
          window.ETC_FB.signInEmailPassword(u.email, pw).then(function (fu) {
            try {
              u.firebaseUid = fu.uid;
              localStorage.setItem(USER_KEY, JSON.stringify(u));
            } catch (_) {}
            // Restore cloud profile photo after login
            pullAvatarFromFirebase().then(function (av) {
              if (av) { try { u.avatar = av; localStorage.setItem(USER_KEY, JSON.stringify(u)); } catch(_){} paint(); }
            });
          }).catch(function () {
            // Offline / wrong cloud password – local unlock still OK
            pullAvatarFromFirebase().then(function () { paint(); });
          });
        } else if (window.ETC_FB) {
          window.ETC_FB.ensureAuth().catch(function () {});
        }
        pullAvatarFromFirebase().then(function(){ paint(); syncHeaderAvatar(); });
        finishLock("Welcome back, " + (u.name || "Rider"));
        return;
      }

      // setup
      if (phase === "create") {
        firstCode = secret;
        phase = "confirm";
        buffer = "";
        render();
        return;
      }
      // confirm
      if (secret !== firstCode) {
        shake();
        toast("Didn’t match · try again");
        phase = "create";
        firstCode = "";
        buffer = "";
        setTimeout(render, 400);
        return;
      }
      const data = {
        ...opts.draft,
        security: type,
        passcode: type === "passcode" ? secret : undefined,
        password: type === "password" ? secret : undefined,
        unlocked: true
      };
      // Link email to Firebase first – if account already exists, stop and ask to Login
      if (window.ETC_FB && data.email && secret) {
        const pw = secret.length >= 6 ? secret : (secret + "etcetc").slice(0, 8);
        window.ETC_FB.linkEmailPassword(data.email, pw).then(function (fu) {
          data.firebaseUid = fu.uid;
          saveUser(data);
          finishLock(type === "passcode" ? "Passcode set" : "Password set");
        }).catch(function (e) {
          console.warn("[ETC profile] Firebase link failed:", e);
          const code = e && e.code;
          if (code === "auth/email-already-in-use" || code === "auth/credential-already-in-use") {
            toast("Account already used — please Login");
            unlockProfileLayer();
            root.remove();
            return;
          }
          // Offline / other: still save locally so booking works offline
          saveUser(data);
          finishLock(type === "passcode" ? "Passcode set (offline)" : "Password set (offline)");
        });
        return;
      }
      saveUser(data);
      if (window.ETC_FB) window.ETC_FB.ensureAuth().catch(function () {});
      finishLock(type === "passcode" ? "Passcode set" : "Password set");
    }

    function toast(msg) {
      const t = document.getElementById("toast");
      if (!t) return;
      t.textContent = msg;
      t.classList.add("show");
      setTimeout(() => t.classList.remove("show"), 1800);
    }

    document.body.appendChild(root);
    render();
  }

  // Keep header avatar in sync on load
  setTimeout(function(){ pullAvatarFromFirebase(); }, 800);
  syncHeaderAvatar();

  // History → new page
  ov.querySelector("#profHistory").addEventListener("click", (e) => {
    if (ov.classList.contains("locked")) { e.preventDefault(); e.stopPropagation(); return; }
    close();
    location.href = "history.html";
  });

  // Dispute – custom glass issue picker (no native select popup)
  ov.querySelector("#profDispute").addEventListener("click", () => {
    close();
    const ISSUES = [
      "Wrong fare charged",
      "Missed bus / delay",
      "Driver behaviour",
      "Payment not reflected",
      "Other"
    ];
    let issue = ISSUES[0];
    const d = document.createElement("div");
    d.className = "ov show sheet-ov";
    d.innerHTML = `
      <div class="alarm-card glass-card">
        <button type="button" class="ov-close" id="disClose" aria-label="Close"><svg class="ico" width="16" height="16" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
        <div class="alarm-date">Report a Dispute</div>
        <p class="alarm-sub">Tell us what went wrong. We’ll review it.</p>
        <label class="alarm-field"><span>Ticket / Receipt ID</span><input type="text" id="disId" placeholder="e.g. ETC-2026-0042"/></label>
        <div class="alarm-field">
          <span>Issue</span>
          <button type="button" class="issue-trigger" id="disTypeBtn" aria-haspopup="listbox" aria-expanded="false">
            <span id="disTypeLabel">${ISSUES[0]}</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M6 9l6 6 6-6"/></svg>
          </button>
          <div class="issue-menu" id="disTypeMenu" role="listbox" hidden></div>
        </div>
        <label class="alarm-field"><span>Details</span><textarea id="disNote" rows="3" placeholder="Describe the issue…" style="padding:12px 16px;border-radius:16px;border:1.5px solid rgba(17,17,18,.08);background:#fff;font:500 14px var(--font);resize:vertical"></textarea></label>
        <button type="button" class="alarm-btn primary" id="disSubmit" style="width:100%;margin-top:8px">Submit dispute</button>
      </div>`;
    document.body.appendChild(d);

    const menu = d.querySelector("#disTypeMenu");
    const btn = d.querySelector("#disTypeBtn");
    const label = d.querySelector("#disTypeLabel");
    menu.innerHTML = ISSUES.map((t, i) =>
      `<button type="button" class="issue-opt${i === 0 ? " on" : ""}" role="option" data-v="${t}">
        <span>${t}</span>
        <span class="issue-radio" aria-hidden="true"></span>
      </button>`
    ).join("");

    function closeMenu() {
      menu.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    }
    btn.onclick = (e) => {
      e.stopPropagation();
      const open = menu.hidden;
      menu.hidden = !open;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    };
    menu.querySelectorAll(".issue-opt").forEach((opt) => {
      opt.onclick = (e) => {
        e.stopPropagation();
        issue = opt.dataset.v;
        label.textContent = issue;
        menu.querySelectorAll(".issue-opt").forEach((x) => x.classList.toggle("on", x === opt));
        closeMenu();
      };
    });
    d.querySelector("#disClose").onclick = () => d.remove();
    d.onclick = (e) => {
      if (e.target === d) d.remove();
      else if (!menu.hidden && !menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) closeMenu();
    };
    d.querySelector("#disSubmit").onclick = async () => {
      const payload = {
        id: d.querySelector("#disId").value.trim(),
        type: issue,
        note: d.querySelector("#disNote").value.trim(),
        at: Date.now()
      };
      let list = [];
      try { list = JSON.parse(localStorage.getItem("etc_disputes")) || []; } catch (_) {}
      list.unshift(payload);
      try { localStorage.setItem("etc_disputes", JSON.stringify(list.slice(0, 50))); } catch (_) {}

      // Upload to Firestore so dashboard & agents see it
      try {
        if (window.ETC_FB && window.ETC_FB.db) {
          await window.ETC_FB.ensureAuth();
          const u = (function(){ try { return JSON.parse(localStorage.getItem("etc_user")) || null; } catch(_){ return null; } })();
          await window.ETC_FB.db.collection("disputes").add({
            uid: (window.ETC_FB.auth.currentUser || {}).uid || null, 
            ticketId: payload.id || null,
            title: (payload.type || "Dispute") + (payload.id ? " — " + payload.id : ""),
            reason: payload.type || null,
            message: payload.note || "",
            meta: payload.note || "",
            status: "open",
            source: "passenger",
            passengerName: u && u.name || null,
            passengerEmail: u && u.email || null,
            clientTs: payload.at,
            serverTs: window.ETC_FB.FieldValue.serverTimestamp()
          });
        }
      } catch (e) { console.warn("[ETC dispute] upload failed:", e); }

      d.remove();
      const toast = document.getElementById("toast");
      if (toast) {
        toast.textContent = "Dispute submitted";
        toast.classList.add("show");
        setTimeout(() => toast.classList.remove("show"), 1800);
      }
    };
  });

  // Games
  ov.querySelector("#profGames").addEventListener("click", (e) => {
    if (ov.classList.contains("locked")) { e.preventDefault(); e.stopPropagation(); return; }
    close();
    location.href = "games.html";
  });


  // After login, bfcache / background can restore a frozen ghost-shield or .locked profile.
  // Always clear interaction blockers on load / pageshow / visibility.
  function etcClearLoginFreeze() {
    try {
      ov.classList.remove("locked", "show");
      ov.style.pointerEvents = "";
      ov.style.removeProperty("pointer-events");
      ov.setAttribute("aria-hidden", "true");
    } catch (_) {}
    try {
      document.querySelectorAll("[data-etc-ghost-shield], .lock-ov, .ov.lock-ov").forEach(function (n) {
        try { n.remove(); } catch (_) {}
      });
    } catch (_) {}
    try {
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
    } catch (_) {}
  }
  try {
    etcClearLoginFreeze();
    document.addEventListener("DOMContentLoaded", etcClearLoginFreeze);
    window.addEventListener("pageshow", etcClearLoginFreeze);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) etcClearLoginFreeze();
    });
    // Stay usable after reopen – never leave an invisible lock wall
    try {
      const u = loadUser();
      if (u && u.name) {
        u.unlocked = true;
        localStorage.setItem(USER_KEY, JSON.stringify(u));
      }
    } catch (_) {}
    window.addEventListener("pagehide", etcClearLoginFreeze);
  } catch (_) {}

  // Initial paint listeners for auth buttons
  paint();

  window.ETC_Profile = {
    openAuth: openAuth,
    isLoggedIn: function () {
      try {
        const u = JSON.parse(localStorage.getItem(USER_KEY) || "null");
        return !!(u && u.name && u.unlocked !== false);
      } catch (_) { return false; }
    },
    open: open,
  };
})();

;(function ETC_AVATAR_BOOT(){
  function run(){ try { if (typeof pullAvatarFromFirebase === "function") pullAvatarFromFirebase(); } catch(_){} }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function(){ setTimeout(run, 600); });
  else setTimeout(run, 600);
})();
