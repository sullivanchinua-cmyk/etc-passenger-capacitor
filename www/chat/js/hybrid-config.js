// ============================================================
// ETC CHAT — Firebase wiring (shared Enugu Transit Control project)
//
// The chat is the same account as the app that opened it:
//   passenger app  → the passenger's account (name/email from their profile)
//   agent app      → the agent's login (name, agent ID, terminal)
//   executive dash → the executive's login
// The host app's js/chat-bridge.js saves who is signed in (Firebase uid) in localStorage;
// both live on the same origin as this chat, so the Firebase session is shared too.
// If nobody is signed in the chat still opens as a guest (local profile).
// ============================================================

var ETC_CHAT_ROLE = 'passenger';          // 'passenger' | 'agent' | 'executive'

var FIREBASE_CONFIG = {
  apiKey: "AIzaSyASKGB6sn5aNCD02y1BPn_O0BpkSPUASjM",
  authDomain: "enugu-transport-corporation.firebaseapp.com",
  databaseURL: "https://enugu-transport-corporation-default-rtdb.firebaseio.com",
  projectId: "enugu-transport-corporation",
  storageBucket: "enugu-transport-corporation.firebasestorage.app",
  messagingSenderId: "1018505355734",
  appId: "1:1018505355734:web:724095c1c7e533316a4477",
  measurementId: "G-FVYERHXK13"
};
try { // the host app's own config wins if it is already on the page
  if (window.ETC_FIREBASE_CONFIG && window.ETC_FIREBASE_CONFIG.apiKey) {
    FIREBASE_CONFIG = Object.assign({}, FIREBASE_CONFIG, window.ETC_FIREBASE_CONFIG);
    if (!FIREBASE_CONFIG.databaseURL) FIREBASE_CONFIG.databaseURL = "https://enugu-transport-corporation-default-rtdb.firebaseio.com";
  }
} catch (_) {}

var auth = null;
var db = null;
var fsdb = null;  // Firestore (primary for chat messages)
var currentUser = null;

function _json(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }

// who opened the chat = the account signed in to the host app
function _hostIdentity() {
  var r = ETC_CHAT_ROLE, o = { role: r, uid: null, name: '', email: null, photo: null, bio: '', terminal: '' };
  var uid = null;
  try { if (localStorage.getItem('etc_chat_role') === r) uid = localStorage.getItem('etc_chat_uid'); } catch (e) {}
  o.uid = uid || null;
  if (r === 'agent') {
    var a = _json('etcA_profile') || {};
    o.name = a.name || (a.agentId ? 'Agent ' + a.agentId : 'Gate agent');
    o.email = a.email || null; o.terminal = a.terminal || '';
    o.bio = 'Gate agent' + (o.terminal ? ' · ' + o.terminal : '') + (a.agentId ? ' · ID ' + a.agentId : '');
  } else if (r === 'passenger') {
    var u = _json('etc_user') || {};
    o.name = u.name || u.fullName || [u.first, u.last].filter(Boolean).join(' ') || (u.email ? String(u.email).split('@')[0] : 'Passenger');
    o.email = u.email || null; o.photo = (u.avatar && !/pravatar\.cc/.test(u.avatar)) ? u.avatar : null; o.bio = 'Passenger';
  } else {
    o.name = localStorage.getItem('etc_exec_name') || 'Executive';
    o.email = localStorage.getItem('etc_exec_email') || null; o.photo = localStorage.getItem('etc_exec_avatar') || null; o.bio = 'Executive';
  }
  return o;
}

function _makeGuest() {
  var id = localStorage.getItem('_standaloneGuestId');
  if (!id) { id = 'guest_' + Math.random().toString(36).slice(2, 10); localStorage.setItem('_standaloneGuestId', id); }
  var h = _hostIdentity();
  var name = localStorage.getItem('_standaloneGuestName') || h.name || 'Guest';
  return { uid: id, displayName: name, email: null, isAnonymous: true, photoURL: null, role: ETC_CHAT_ROLE, isGuest: true };
}

// a Firebase user presented with the host-app profile (keeps all Firebase methods)
function _asAccount(fbUser, h) {
  var w = Object.create(fbUser);
  var name = h.name || fbUser.displayName || 'ETC user';
  Object.defineProperty(w, 'displayName', { value: name });
  Object.defineProperty(w, 'email', { value: fbUser.email || h.email || null });
  Object.defineProperty(w, 'photoURL', { value: h.photo || fbUser.photoURL || null });
  w.role = ETC_CHAT_ROLE; w.bio = h.bio; w.terminal = h.terminal;
  return w;
}
// known uid from the host bridge, before Firebase has restored its session (pages boot synchronously)
function _fromCachedUid(h) {
  return { uid: h.uid, displayName: h.name, email: h.email, photoURL: h.photo, isAnonymous: false, role: ETC_CHAT_ROLE, bio: h.bio, terminal: h.terminal };
}

// everybody (passengers, agents, executives) can find and message everybody, in one shared public room
var ETC_CHAT_GROUP = 'all';
window.ETC_CHAT_ROLE = ETC_CHAT_ROLE; window.ETC_CHAT_GROUP = ETC_CHAT_GROUP;
window.etcChatCanSee = function (u) { return !!u; };

var _bootedAsGuest = false;

try {
  if (typeof firebase !== 'undefined' && FIREBASE_CONFIG.apiKey) {
    // Always ensure databaseURL is present (host config used to omit it)
    if (!FIREBASE_CONFIG.databaseURL) {
      FIREBASE_CONFIG.databaseURL = "https://enugu-transport-corporation-default-rtdb.firebaseio.com";
    }
    if (!firebase.apps.length) {
      firebase.initializeApp(FIREBASE_CONFIG);
    }
    auth = firebase.auth();
    try {
      // Prefer explicit URL so RTDB works even if the first init on the page
      // (host app) did not include databaseURL in its config.
      var _rtdbUrl = FIREBASE_CONFIG.databaseURL;
      try {
        db = firebase.database(firebase.app(), _rtdbUrl);
      } catch (_e1) {
        db = firebase.database();
      }
      if (db && !db.__etcWrapped) {
        // sending a message in a 1-to-1 thread makes the two people friends, so the conversation shows up in BOTH Friends lists
        var _ref = db.ref.bind(db), _linked = {};
        db.ref = function (p) {
          var r = _ref(p);
          if (typeof p === 'string' && /^chats\/[^\/]+$/.test(p)) {
            var _push = r.push.bind(r);
            r.push = function () {
              try {
                var me = currentUser && currentUser.uid, parts = p.slice(6).split('_');
                if (me && !_linked[p] && String(me).indexOf('guest_') !== 0 && parts.length === 2) {
                  var other = parts[0] === me ? parts[1] : parts[0];
                  if (other && other !== me) {
                    _linked[p] = 1; var ts = Date.now(), upd = {};
                    upd['friends/' + me + '/' + other] = { friendUid: other, since: ts };
                    upd['friends/' + other + '/' + me] = { friendUid: me, since: ts };
                    _ref().update(upd).catch(function () { delete _linked[p]; });
                  }
                }
              } catch (e) {}
              return _push.apply(null, arguments);
            };
          }
          return r;
        };
        db.__etcWrapped = true;
      }
    } catch (e) { console.warn('RTDB unavailable', e); db = null; }
    // Firestore — primary store for chat messages (same backend as passenger/agent/dashboard apps)
    try {
      if (firebase.firestore) {
        fsdb = firebase.firestore();
        try { fsdb.settings({ ignoreUndefinedProperties: true }); } catch (_s) {}
      }
    } catch (e) { console.warn('Firestore unavailable', e); fsdb = null; }
  }
} catch (e) { console.warn('Firebase skipped', e); }

(function () {
  var h = _hostIdentity();
  if (h.uid) currentUser = _fromCachedUid(h);
  else { currentUser = (auth && auth.currentUser) ? _asAccount(auth.currentUser, h) : _makeGuest(); _bootedAsGuest = !!currentUser.isGuest; }
})();

// put me in the shared people directory so others can find / message me
function _registerMe(u) {
  try {
    if (!u || !u.uid || String(u.uid).indexOf('guest_') === 0) return;
    var profile = {
      uid: u.uid,
      name: u.displayName || 'ETC user',
      displayName: u.displayName || 'ETC user',
      email: u.email || null,
      photoURL: u.photoURL || null,
      role: ETC_CHAT_ROLE,
      bio: u.bio || '',
      terminal: u.terminal || null,
      lastSeen: Date.now(),
      updatedAt: Date.now()
    };
    window.currentUserData = Object.assign({}, window.currentUserData || {}, profile);
    // Krisfeet pattern: wait until Firestore bridge owns window.db
    function write() {
      try {
        if (window.db && typeof window.db.ref === 'function') {
          window.db.ref('users/' + u.uid).set(profile);
          return true;
        }
      } catch (e) {}
      return false;
    }
    if (!write()) {
      var tries = 0;
      var iv = setInterval(function () {
        tries++;
        if (write() || tries > 40) clearInterval(iv);
      }, 250);
    }
  } catch (e) {}
}
// Do NOT register immediately — bridge loads after this file (Krisfeet pattern)
setTimeout(function () { try { _registerMe(currentUser); } catch (e) {} }, 600);

if (auth) {
  var _origOn = auth.onAuthStateChanged.bind(auth);
  // pages ask "who is signed in?" – always answer with the host-app account (or a guest), never "nobody" (those pages would bounce away)
  auth.onAuthStateChanged = function (cb) {
    return _origOn(function (u) {
      if (u) cb((window.currentUser && window.currentUser.uid === u.uid) ? window.currentUser : _asAccount(u, _hostIdentity()));
      else cb((window.currentUser && window.currentUser.isGuest) ? window.currentUser : _makeGuest());
    });
  };
  // logging out is done in the main app – the chat must never sign the person out of it
  auth.signOut = function () { return Promise.resolve(); };
  _origOn(function (user) {
    if (user) {
      var h = _hostIdentity();
      try { localStorage.setItem('etc_chat_uid', user.uid); localStorage.setItem('etc_chat_role', ETC_CHAT_ROLE); } catch (_) {}   // next open boots straight as this account
      currentUser = _asAccount(user, h);
      try { window.currentUser = currentUser; } catch (_) {}
      _registerMe(currentUser);
      // the page booted as a guest because the account id was not known yet → restart once as the real account
      if (_bootedAsGuest) {
        _bootedAsGuest = false;
        try { if (!sessionStorage.getItem('_etcChatReloaded')) { sessionStorage.setItem('_etcChatReloaded', '1'); location.reload(); } } catch (_) {}
      }
    } else {
      currentUser = _makeGuest();
      try { window.currentUser = currentUser; } catch (_) {}
    }
  });
  // nobody signed in on this device: use an anonymous Firebase identity so messages still sync
  // Sign in as soon as possible so the first message is not blocked by rules
  setTimeout(function () { try { if (!auth.currentUser && auth.signInAnonymously) auth.signInAnonymously().catch(function () {}); } catch (_) {} }, 400);
  setTimeout(function () { try { if (!auth.currentUser && auth.signInAnonymously) auth.signInAnonymously().catch(function () {}); } catch (_) {} }, 2500);
}

// File storage (Cloudflare R2: uploadFile, deleteFile, refreshExpiredUrls ...) lives in js/r2-storage.js - load it right after this file.
window.currentUser = currentUser;
window.auth = auth;
window.db = db;
window.fsdb = fsdb;


// ══════════════════════════════════════════════════════════════
// BULLETPROOF SEND — bypasses fragile touch/hold handlers
// Writes straight to Firestore public_chat and shows a toast.
// ══════════════════════════════════════════════════════════════


// ── RTDB-compatible helpers (work with Firestore bridge window.db) ──────────
window.getFromFirebase = async function getFromFirebase(path, limit) {
  try {
    var _db = window.db;
    if (!_db || !_db.ref) return [];
    var ref = _db.ref(path);
    if (limit && ref.limitToLast) ref = ref.limitToLast(limit);
    var snap = await ref.once('value');
    if (!snap || !snap.exists || !snap.exists()) return [];
    var rows = [];
    if (typeof snap.forEach === 'function') {
      snap.forEach(function (c) {
        var v = c.val() || {};
        rows.push(Object.assign({ id: c.key }, typeof v === 'object' ? v : { value: v }));
      });
    } else {
      var raw = snap.val();
      if (raw && typeof raw === 'object') {
        Object.keys(raw).forEach(function (k) {
          var v = raw[k];
          rows.push(Object.assign({ id: k }, typeof v === 'object' && v ? v : { value: v }));
        });
      }
    }
    return rows.reverse ? rows.reverse() : rows;
  } catch (err) {
    console.warn('getFromFirebase', path, err);
    return [];
  }
};

window.getUserProfile = async function getUserProfile(uid) {
  try {
    var id = uid || (window.currentUser && window.currentUser.uid) || (typeof currentUser !== 'undefined' && currentUser && currentUser.uid);
    if (!id) return null;
    var _db = window.db;
    if (_db && _db.ref) {
      var snap = await _db.ref('users/' + id).once('value');
      var profile = snap && snap.val ? snap.val() : null;
      if (profile) {
        if ((!uid || (window.currentUser && uid === window.currentUser.uid)) && profile) {
          window.currentUserData = profile;
        }
        return profile;
      }
    }
    // Firestore direct fallback
    var f = window.fsdb || (typeof fsdb !== 'undefined' ? fsdb : null);
    if (f) {
      var ds = await f.collection('etc_rtdb_users').doc(id).get();
      if (ds.exists) {
        var p = ds.data() || {};
        if (!uid || (window.currentUser && uid === window.currentUser.uid)) window.currentUserData = p;
        return p;
      }
    }
    return null;
  } catch (e) { return null; }
};

window.updateFirebase = async function updateFirebase(path, updates) {
  try {
    var _db = window.db;
    if (!_db || !_db.ref) return { success: false, error: 'No db' };
    await _db.ref(path).update(updates);
    return { success: true };
  } catch (err) { return { success: false, error: err.message }; }
};

window.deleteFromFirebase = async function deleteFromFirebase(path) {
  try {
    var _db = window.db;
    if (!_db || !_db.ref) return { success: false };
    await _db.ref(path).remove();
    return { success: true };
  } catch (err) { return { success: false, error: err.message }; }
};

window.listenToFirebase = function listenToFirebase(path, callback) {
  var _db = window.db;
  if (!_db || !_db.ref) return;
  _db.ref(path).on('value', function (snap) {
    var rows = [];
    if (snap && snap.forEach) {
      snap.forEach(function (c) { rows.push(Object.assign({ id: c.key }, c.val() || {})); });
    }
    callback(rows.reverse());
  });
};

// Expose bare names for classic scripts
try {
  if (typeof getFromFirebase === 'undefined') getFromFirebase = window.getFromFirebase;
} catch (_) {}
try {
  if (typeof getUserProfile === 'undefined') getUserProfile = window.getUserProfile;
} catch (_) {}



// ── WhatsApp-style optimistic media (show blur bubble, then clear when uploaded) ──
window.etcOptimisticId = function () {
  return 'tmp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
};

window.etcSendTextNow = async function (text, extra) {
  if (!text && !(extra && extra.message)) return false;
  // Prevent double attach sends (poll/event/contact/location)
  var _lockKey = String(text || '').slice(0, 120);
  if (window._etcTextSendLock && window._etcTextSendLock === _lockKey) return false;
  window._etcTextSendLock = _lockKey;
  setTimeout(function () { if (window._etcTextSendLock === _lockKey) window._etcTextSendLock = null; }, 2500);

  var cu = window.currentUser || (typeof currentUser !== 'undefined' ? currentUser : {}) || {};
  var name = (window.currentUserData && window.currentUserData.name) || cu.displayName || cu.name || 'User';
  var msgObj = Object.assign({
    message: text || null,
    timestamp: Date.now(),
    ts: Date.now(),
    senderId: cu.uid || 'anon',
    senderUid: cu.uid || 'anon',
    senderName: name,
    senderEmail: cu.email || '',
    senderAvatar: (window.currentUserData && window.currentUserData.photoURL) || cu.photoURL || null,
    reactions: {}
  }, extra || {});
  if (window._homeViewOnce) { msgObj.viewOnce = true; window._homeViewOnce = false; }

  // Optimistic bubble IMMEDIATELY (poll / event / location / contact / text)
  var tmpId = 'tmp_txt_' + Date.now() + '_' + Math.floor(Math.random() * 9999);
  try {
    var box = document.getElementById('chatMessages');
    if (box && typeof renderPublicMsg === 'function') {
      msgObj.id = tmpId;
      if (!document.getElementById('pm_' + tmpId)) renderPublicMsg(msgObj, box);
      try { window.scrollTo(0, document.body.scrollHeight); } catch (e) {}
    }
  } catch (ePaint) { console.warn('etcSendTextNow paint', ePaint); }

  try {
    if (typeof showToast === 'function') showToast('Sending…');
    var result = await window.saveToFirebase('public_chat', msgObj);
    if (result && result.success === false) {
      try {
        var bad = document.getElementById('pm_' + tmpId);
        if (bad) bad.remove();
      } catch (_) {}
      try { if (typeof showToast === 'function') showToast('Could not send: ' + (result.error || ''), 'error'); } catch (_) {}
      return false;
    }
    // Swap tmp id for real id if needed
    try {
      if (result && result.id && result.id !== tmpId) {
        var el = document.getElementById('pm_' + tmpId);
        if (el) {
          el.id = 'pm_' + result.id;
          el.setAttribute('data-msgid', result.id);
        }
      }
    } catch (_) {}
    try { if (typeof showToast === 'function') showToast('Sent ✓'); } catch (_) {}
    // @gemini
    try {
      if (text && String(text).toLowerCase().indexOf('@gemini') >= 0) {
        if (!window._homeChatHistory) window._homeChatHistory = [];
        window._homeChatHistory.push(text);
        setTimeout(function () { window.etcRunGemini(text); }, 200);
      }
    } catch (_g) { console.warn('gemini text', _g); }
    return true;
  } catch (e) {
    try {
      var bad2 = document.getElementById('pm_' + tmpId);
      if (bad2) bad2.remove();
    } catch (_) {}
    try { if (typeof showToast === 'function') showToast('Send failed', 'error'); } catch (_) {}
    return false;
  }
};

/** Insert a temporary bubble immediately (blur + spinner), return its DOM id */
window.etcShowUploadingBubble = function (opts) {
  opts = opts || {};
  var box = document.getElementById('chatMessages');
  if (!box || typeof renderPublicMsg !== 'function') return null;
  var id = opts.id || window.etcOptimisticId();
  var cu = window.currentUser || {};
  var localUrl = opts.localUrl || null;
  var msg = {
    id: id,
    message: opts.message || null,
    fileUrl: localUrl,
    fileType: opts.fileType || 'image/jpeg',
    fileName: opts.fileName || null,
    senderId: cu.uid || 'anon',
    senderName: (window.currentUserData && window.currentUserData.name) || cu.displayName || 'You',
    senderAvatar: (window.currentUserData && window.currentUserData.photoURL) || null,
    timestamp: Date.now(),
    ts: Date.now(),
    reactions: {},
    _uploading: true,
    viewOnce: !!opts.viewOnce
  };
  try {
    if (!document.getElementById('pm_' + id)) renderPublicMsg(msg, box);
    var el = document.getElementById('pm_' + id);
    if (el) {
      el.classList.add('_etcUploading');
      // Blur overlay + spinner on media
      var media = el.querySelector('img, video');
      if (media) {
        media.style.filter = 'blur(8px) brightness(0.7)';
        media.style.transition = 'filter .35s ease';
      }
      if (!el.querySelector('._etcUpSpin')) {
        var spin = document.createElement('div');
        spin.className = '_etcUpSpin';
        spin.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:36px;height:36px;border:3px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:_etcSpin .8s linear infinite;z-index:5;pointer-events:none';
        var host = el.querySelector('[id^="bubble_"]') || el;
        if (host && getComputedStyle(host).position === 'static') host.style.position = 'relative';
        host.appendChild(spin);
      }
    }
    setTimeout(function () { try { window.scrollTo(0, document.body.scrollHeight); } catch (e) {} }, 30);
  } catch (e) { console.warn('etcShowUploadingBubble', e); }
  return id;
};

window.etcFinishUploadingBubble = function (tmpId, finalUrl, finalId) {
  var el = document.getElementById('pm_' + tmpId);
  if (!el) return;
  el.classList.remove('_etcUploading');
  var spin = el.querySelector('._etcUpSpin');
  if (spin) spin.remove();
  var media = el.querySelector('img, video');
  if (media && finalUrl) {
    media.src = finalUrl;
    media.style.filter = 'none';
  }
  if (finalId && finalId !== tmpId) {
    el.id = 'pm_' + finalId;
  }
};

// Inject spinner CSS once
(function () {
  if (document.getElementById('_etcUpCss')) return;
  function inject() {
    if (document.getElementById('_etcUpCss')) return;
    var s = document.createElement('style');
    s.id = '_etcUpCss';
    s.textContent = '@keyframes _etcSpin{to{transform:translate(-50%,-50%) rotate(360deg)}}._etcUploading{opacity:.95}';
    (document.head || document.documentElement).appendChild(s);
  }
  if (document.head) inject(); else document.addEventListener('DOMContentLoaded', inject);
})();

window.etcSendNow = async function (ev) {
  // Capture text early for @gemini (send button uses this path, not sendChatMessage)
  var _etcGeminiPending = null;
  try {
    var _inpG = document.getElementById('chatInput');
    var _tG = (_inpG && _inpG.value) ? _inpG.value.trim() : '';
    if (!_tG && window._homePendingText) _tG = String(window._homePendingText);
    if (_tG && _tG.toLowerCase().indexOf('@gemini') >= 0) _etcGeminiPending = _tG;
  } catch (_eG0) {}
  // If view-once mode is active, mark flag
  if (window._hmVoMode) {
    window._homeViewOnce = true;
  }

  try {
    if (ev && ev.preventDefault) ev.preventDefault();
    if (ev && ev.stopPropagation) ev.stopPropagation();
  } catch (_) {}

  var input = document.getElementById('chatInput');
  var text = (input && input.value) ? input.value.trim() : '';
  var extra = window._homePendingText || null;
  var file = (typeof currentChatFile !== 'undefined') ? currentChatFile : null;

  if (!text && !extra && !file) {
    try { if (typeof showToast === 'function') showToast('Type a message first', 'error'); } catch (_) {}
    return false;
  }

  // Edit mode
  if (input && input.dataset && input.dataset.editingId && text) {
    var eId = input.dataset.editingId;
    try {
      if (window.etcUpdateMessage) await window.etcUpdateMessage('public_chat/' + eId, { message: text, edited: true, editTs: Date.now() });
      input.value = '';
      delete input.dataset.editingId;
      var bar = document.getElementById('_pubEditBar'); if (bar) bar.style.display = 'none';
      if (typeof showToast === 'function') showToast('✏️ Message updated');
    } catch (e) {
      if (typeof showToast === 'function') showToast('Edit failed: ' + (e.message || e), 'error');
    }
    return true;
  }

  var finalMsg = extra ? (extra + (text ? '\n' + text : '')) : text;
  window._homePendingText = null;

  // Clear input immediately (WhatsApp behaviour) — restore on failure
  if (input) {
    input.value = '';
    try { input.style.height = 'auto'; } catch (_) {}
  }
  try { if (typeof updateHomeMicSend === 'function') updateHomeMicSend(); } catch (_) {}
  try { if (typeof onHomeChatType === 'function') onHomeChatType(); } catch (_) {}

  // Optional file upload — WhatsApp style: show blurred bubble first, then clear
  var fileUrl = null, fileType = null, fileName = null, fileKey = null;
  var _optId = null, _localBlob = null;
  if (file && typeof uploadFile === 'function') {
    try {
      _localBlob = URL.createObjectURL(file);
      _optId = window.etcShowUploadingBubble({
        localUrl: _localBlob,
        fileType: file.type || 'application/octet-stream',
        fileName: file.name,
        message: finalMsg || null,
        viewOnce: !!window._homeViewOnce
      });
      if (input) input.value = '';
      try { if (typeof clearChatFile === 'function') clearChatFile(); } catch (_) {}
      try { if (typeof updateHomeMicSend === 'function') updateHomeMicSend(); } catch (_) {}
      var up = await uploadFile(file, 'chat');
      if (up && up.success) {
        fileUrl = up.url; fileType = up.fileType || (file.type || null);
        fileName = up.fileName || file.name; fileKey = up.key || null;
      } else {
        if (_optId) {
          var bad = document.getElementById('pm_' + _optId);
          if (bad) bad.remove();
        }
        if (input && finalMsg) input.value = finalMsg;
        if (typeof showToast === 'function') showToast('Upload failed', 'error');
        return false;
      }
    } catch (e) {
      if (_optId) {
        var bad2 = document.getElementById('pm_' + _optId);
        if (bad2) bad2.remove();
      }
      if (input && finalMsg) input.value = finalMsg;
      if (typeof showToast === 'function') showToast('Upload error: ' + (e.message || e), 'error');
      return false;
    }
    currentChatFile = null;
  }

  if (!finalMsg && !fileUrl) return false;

  var cu = window.currentUser || (typeof currentUser !== 'undefined' ? currentUser : null);
  var name = (cu && (cu.displayName || cu.name)) || (window.currentUserData && window.currentUserData.name) || 'Guest';
  var msgObj = {
    message: finalMsg || null,
    fileUrl: fileUrl, fileType: fileType, fileName: fileName, fileKey: fileKey,
    senderId: cu && cu.uid ? cu.uid : 'anon',
    senderUid: cu && cu.uid ? cu.uid : 'anon',
    senderName: name,
    senderEmail: cu && cu.email ? cu.email : '',
    senderAvatar: (window.currentUserData && window.currentUserData.photoURL) || (cu && cu.photoURL) || null,
    timestamp: Date.now(),
    ts: Date.now(),
    reactions: {},
    viewOnce: !!window._homeViewOnce
  };
  if (window._pubReply) {
    var r = window._pubReply;
    msgObj.replyTo = { id: r.id, senderName: r.senderName, text: r.viewOnce ? '' : (r.text || ''), fileUrl: r.viewOnce ? null : (r.fileUrl || null), fileType: r.fileType || null, viewOnce: !!r.viewOnce };
    try { if (typeof clearPubReply === 'function') clearPubReply(); } catch (_) {}
  }

  try {
    if (typeof showToast === 'function') showToast('Sending…');
    var result = await window.saveToFirebase('public_chat', msgObj);
    if (result && (result.success || result.id || result.key)) {
      // already cleared input above
      window._homeViewOnce = false;
      if (_optId) window.etcFinishUploadingBubble(_optId, fileUrl, result && result.id);
      if (typeof showToast === 'function') showToast('Sent ✓');
      // @gemini trigger — always after a successful-looking save
      try {
        if (finalMsg && finalMsg.toLowerCase().indexOf('@gemini') >= 0) {
          if (!window._homeChatHistory) window._homeChatHistory = [];
          window._homeChatHistory.push(finalMsg);
          setTimeout(function(){ window.etcRunGemini(finalMsg); }, 200);
        }
      } catch (_g) { console.error('gemini trigger', _g); }
      // Optimistic render if listener is slow
      try {
        if (!_optId && typeof renderPublicMsg === 'function') {
          var box = document.getElementById('chatMessages');
          if (box && result.id) {
            msgObj.id = result.id;
            if (!document.getElementById('pm_' + result.id)) renderPublicMsg(msgObj, box);
            setTimeout(function () { window.scrollTo(0, document.body.scrollHeight); }, 50);
          }
        }
      } catch (_) {}
      return true;
    }
    if (typeof showToast === 'function') showToast('Could not send' + (result && result.error ? (': ' + result.error) : ''), 'error');
    return false;
  } catch (e) {
    console.error('etcSendNow', e);
    if (typeof showToast === 'function') showToast('Send failed: ' + (e.message || e), 'error');
    return false;
  }

  // Fire @gemini after send completes (send button path)
  try {
    if (typeof _etcGeminiPending !== 'undefined' && _etcGeminiPending) {
      setTimeout(function () { window.etcRunGemini(_etcGeminiPending); }, 200);
    }
  } catch (_eG1) {}
};

/** Re-wire the mic/send button: tap=send, hold~700ms=toggle view-once (WebView-safe). */
window.etcWireSendButton = function () {
  var btn = document.getElementById('homeMicSendBtn');
  if (!btn || btn._etcWired) return;
  btn._etcWired = true;
  try {
    btn.removeAttribute('ontouchstart');
    btn.removeAttribute('ontouchend');
    btn.removeAttribute('ontouchcancel');
    btn.removeAttribute('onmousedown');
    btn.removeAttribute('onmouseup');
    btn.removeAttribute('onmouseleave');
    btn.onclick = null;
  } catch (_) {}

  var holdTimer = null, held = false, lastTap = 0;

  function updateVoUi() {
    try {
      if (typeof _hmUpdateBtn === 'function') _hmUpdateBtn();
      else if (typeof window._hmUpdateBtn === 'function') window._hmUpdateBtn();
    } catch (_) {}
    var vo = document.getElementById('homeVoOnceSVG');
    var send = document.getElementById('homeSendSVG');
    var mic = document.getElementById('homeMicSVG');
    var badge = document.getElementById('homeVoBadge');
    var voMode = !!window._hmVoMode;
    if (voMode) {
      if (mic) mic.style.display = 'none';
      if (send) send.style.display = 'none';
      if (vo) vo.style.display = '';
      if (badge) badge.style.display = 'block';
    } else {
      if (vo) vo.style.display = 'none';
      if (badge) badge.style.display = 'none';
      var inp = document.getElementById('chatInput');
      var has = (inp && inp.value.trim()) || window._homePendingText || (typeof currentChatFile !== 'undefined' && currentChatFile);
      if (mic) mic.style.display = has ? 'none' : '';
      if (send) send.style.display = has ? '' : 'none';
    }
  }

  function onStart(e) {
    held = false;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(function () {
      held = true;
      window._hmVoMode = !window._hmVoMode;
      if (typeof _hmVoMode !== 'undefined') { try { _hmVoMode = window._hmVoMode; } catch (_) {} }
      if (navigator.vibrate) try { navigator.vibrate(40); } catch (_) {}
      updateVoUi();
      /* silent VO mode toggle — badge on button is enough */
    }, 700);
  }
  function onCancel() {
    clearTimeout(holdTimer);
  }
  function onEnd(e) {
    clearTimeout(holdTimer);
    try { if (e) { e.preventDefault(); e.stopPropagation(); } } catch (_) {}
    if (held) { held = false; return; }
    var now = Date.now();
    if (now - lastTap < 500) return;
    lastTap = now;
    var inp = document.getElementById('chatInput');
    var has = (inp && inp.value.trim()) || window._homePendingText || (typeof currentChatFile !== 'undefined' && currentChatFile);
    if (has) {
      if (window._hmVoMode) {
        // view-once send path
        if (typeof _hmSendVO === 'function') {
          try { _hmSendVO(); } catch (err) { window.etcSendNow(e); }
        } else {
          // mark viewOnce on next send
          window._homeViewOnce = true;
          window.etcSendNow(e);
        }
        window._hmVoMode = false;
        updateVoUi();
      } else {
        window.etcSendNow(e);
      }
    } else if (typeof WaEmojiPanel !== 'undefined' && WaEmojiPanel.openVoiceSheet) {
      WaEmojiPanel.openVoiceSheet();
    }
  }

  btn.addEventListener('touchstart', onStart, { passive: true });
  btn.addEventListener('mousedown', onStart);
  btn.addEventListener('touchend', onEnd, { passive: false });
  btn.addEventListener('mouseup', onEnd);
  btn.addEventListener('touchcancel', onCancel);
  btn.addEventListener('mouseleave', onCancel);
  console.log('✅ Send button wired (tap=send, hold=view-once)');
};


// Auto-wire after chat UI is injected (and on a short interval as safety net)
(function () {
  var tries = 0;
  var iv = setInterval(function () {
    tries++;
    if (document.getElementById('homeMicSendBtn')) {
      window.etcWireSendButton();
      if (tries > 3) clearInterval(iv);
    }
    if (tries > 40) clearInterval(iv);
  }, 500);
})();

window.FIREBASE_CONFIG = FIREBASE_CONFIG;

window.showToast = window.showToast || function(msg, type) {
  var t = document.getElementById('_stToast');
  if (!t) {
    t = document.createElement('div');
    t.id = '_stToast';
    t.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);z-index:99999;background:#1f2937;color:#fff;padding:10px 18px;border-radius:14px;font-size:14px;font-weight:600;box-shadow:0 8px 30px #000a;opacity:0;transition:opacity .2s;max-width:90vw;text-align:center;pointer-events:none';
    document.body.appendChild(t);
  }
  t.textContent = msg || '';
  t.style.background = type === 'error' ? '#7f1d1d' : '#1f2937';
  t.style.opacity = '1';
  clearTimeout(t._tm);
  t._tm = setTimeout(function(){ t.style.opacity = '0'; }, 2200);
};

// ── Shared write helpers (Firestore-first — same backend as main ETC apps) ──
// Chat messages, friend requests, etc. go to Cloud Firestore so they work
// even when Realtime Database is missing or locked down by rules.
window.ETC_USE_FIRESTORE = true;

function _etcEnsureFs() {
  if (fsdb) return fsdb;
  try {
    if (typeof firebase !== 'undefined' && firebase.firestore) {
      fsdb = firebase.firestore();
      window.fsdb = fsdb;
    }
  } catch (e) {}
  return fsdb;
}

function _etcEnsureAuthReady() {
  return (async function () {
    if (typeof auth === 'undefined' || !auth) return null;
    if (auth.currentUser) return auth.currentUser;
    try { if (auth.signInAnonymously) auth.signInAnonymously().catch(function () {}); } catch (_) {}
    for (var i = 0; i < 24 && !auth.currentUser; i++) {
      await new Promise(function (r) { setTimeout(r, 250); });
    }
    return auth.currentUser || null;
  })();
}

/** Map RTDB-style path to Firestore collection / doc writes */
async function _etcFsWrite(path, data, mode) {
  var f = _etcEnsureFs();
  if (!f) throw new Error('Firestore not ready');
  var parts = String(path || '').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  if (!parts.length) throw new Error('Empty path');
  // Strip undefined fields (Firestore rejects them)
  var clean = {};
  Object.keys(data || {}).forEach(function (k) {
    if (data[k] !== undefined) clean[k] = data[k];
  });
  if (clean.timestamp == null) clean.timestamp = Date.now();
  clean._room = parts[0];

  if (mode === 'push' || mode === 'add') {
    // public_chat -> collection public_chat
    // private_chats/uidA_uidB -> collection private_chats / doc uidA_uidB / collection messages
    // friends/uid -> collection friends / doc uid / collection items  OR simple friends as collection
    if (parts.length === 1) {
      var ref = await f.collection(parts[0]).add(clean);
      return { success: true, id: ref.id, key: ref.id };
    }
    if (parts.length === 2) {
      // e.g. friends/{uid} or notifications/{uid} -> subcollection "items"
      var ref2 = await f.collection(parts[0]).doc(parts[1]).collection('items').add(clean);
      return { success: true, id: ref2.id, key: ref2.id };
    }
    if (parts.length >= 3) {
      var col = f.collection(parts[0]).doc(parts[1]);
      for (var i = 2; i < parts.length - 1; i += 2) {
        col = col.collection(parts[i]).doc(parts[i + 1]);
      }
      var last = parts[parts.length - 1];
      // treat last as collection name for push
      var ref3 = await (parts.length % 2 === 1
        ? f.collection(parts[0]).doc(parts[1]).collection(parts[2]).add(clean)
        : col.collection(last).add(clean));
      return { success: true, id: ref3.id, key: ref3.id };
    }
  }
  if (mode === 'set' || mode === 'update') {
    if (parts.length === 1) throw new Error('Need document id for set/update');
    if (parts.length === 2) {
      await f.collection(parts[0]).doc(parts[1]).set(clean, { merge: true });
      return { success: true, id: parts[1], key: parts[1] };
    }
    // public_chat/{id}
    if (parts.length === 2) {
      await f.collection(parts[0]).doc(parts[1]).set(clean, { merge: true });
      return { success: true, id: parts[1] };
    }
    var docRef = f.collection(parts[0]).doc(parts[1]);
    for (var j = 2; j < parts.length - 1; j += 2) {
      docRef = docRef.collection(parts[j]).doc(parts[j + 1]);
    }
    if (parts.length === 3) {
      await f.collection(parts[0]).doc(parts[1]).collection('items').doc(parts[2]).set(clean, { merge: mode === 'update' });
    } else {
      await f.collection(parts[0]).doc(parts[1]).set(clean, { merge: true });
    }
    return { success: true, id: parts[parts.length - 1] };
  }
  throw new Error('Unknown mode');
}

window.saveToFirebase = async function (path, data) {
  try {
    await _etcEnsureAuthReady();
    // Prefer RTDB-compatible db (Firestore bridge from firestore-chat-bridge.js)
    var _db = (typeof window !== 'undefined' && window.db) ? window.db : (typeof db !== 'undefined' ? db : null);
    if (_db && typeof _db.ref === 'function') {
      var ref = _db.ref(path).push(data);
      // bridge returns Thenable-like with key; RTDB returns ThenableReference
      var key = null;
      if (ref && typeof ref.then === 'function') {
        var resolved = await ref;
        key = (resolved && (resolved.key || resolved.id)) || (ref.key) || null;
      } else if (ref && ref.key) {
        key = ref.key;
        if (typeof ref.then === 'function') await ref;
      }
      if (!key && ref && ref.key) key = ref.key;
      return { success: true, id: key, key: key };
    }
    // Direct Firestore fallback
    if (_etcEnsureFs()) {
      return await _etcFsWrite(path, data, 'push');
    }
    var _noDb = 'Chat database not ready. Refresh and try again.';
    try { if (typeof showToast === 'function') showToast(_noDb, 'error'); } catch (_) {}
    return { success: false, error: _noDb };
  } catch (e) {
    var msg = (e && e.message) ? e.message : String(e);
    console.warn('saveToFirebase failed:', path, msg, e);
    try { if (typeof showToast === 'function') showToast('Could not send: ' + msg, 'error'); } catch (_) {}
    return { success: false, error: msg };
  }
};

window.etcUpdateMessage = async function (pathWithId, updates) {
  try {
    await _etcEnsureAuthReady();
    if (_etcEnsureFs()) {
      var parts = String(pathWithId).replace(/^\/+|\/+$/g, '').split('/');
      if (parts.length < 2) throw new Error('Bad path');
      var clean = {};
      Object.keys(updates || {}).forEach(function (k) { if (updates[k] !== undefined) clean[k] = updates[k]; });
      await fsdb.collection(parts[0]).doc(parts[1]).set(clean, { merge: true });
      return { success: true };
    }
    if (db) { await db.ref(pathWithId).update(updates); return { success: true }; }
    return { success: false, error: 'No database' };
  } catch (e) {
    return { success: false, error: (e && e.message) || String(e) };
  }
};

window.etcDeleteMessage = async function (pathWithId) {
  try {
    if (_etcEnsureFs()) {
      var parts = String(pathWithId).replace(/^\/+|\/+$/g, '').split('/');
      if (parts.length >= 2) await fsdb.collection(parts[0]).doc(parts[1]).delete();
      return { success: true };
    }
    if (db) { await db.ref(pathWithId).remove(); return { success: true }; }
    return { success: false };
  } catch (e) {
    return { success: false, error: (e && e.message) || String(e) };
  }
};

window.fsdb = fsdb;

if (typeof window.sendNotification !== 'function') {
  window.sendNotification = function (userId, text) {
    try {
      if (!userId || !db) return;
      db.ref('notifications/' + userId).push({ text: text, from: currentUser ? currentUser.uid : null, timestamp: Date.now(), read: false }).catch(function () {});
    } catch (e) {}
  };
}


/** Offline message cache — keep public_chat history on device */
window.etcCacheMessages = function (msgs) {
  try {
    var key = 'etc_chat_cache_public';
    var list = Array.isArray(msgs) ? msgs : [];
    // Cap cache size
    if (list.length > 400) list = list.slice(list.length - 400);
    localStorage.setItem(key, JSON.stringify(list.map(function (m) {
      return {
        id: m.id, message: m.message || m.text || null, text: m.text || m.message || null,
        fileUrl: m.fileUrl || null, fileType: m.fileType || null, fileName: m.fileName || null,
        senderId: m.senderId || m.senderUid || null, senderUid: m.senderUid || m.senderId || null,
        senderName: m.senderName || null, senderEmail: m.senderEmail || null,
        senderAvatar: m.senderAvatar || null, timestamp: m.timestamp || m.ts || Date.now(),
        ts: m.ts || m.timestamp || Date.now(), viewOnce: !!m.viewOnce, reactions: m.reactions || {},
        isGemini: !!m.isGemini, replyTo: m.replyTo || null
      };
    })));
  } catch (e) { console.warn('etcCacheMessages', e); }
};
window.etcCacheUpsert = function (msg) {
  try {
    if (!msg || !msg.id) return;
    var key = 'etc_chat_cache_public';
    var list = [];
    try { list = JSON.parse(localStorage.getItem(key) || '[]') || []; } catch (e) { list = []; }
    var found = false;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === msg.id) { list[i] = Object.assign({}, list[i], msg); found = true; break; }
    }
    if (!found) list.push(msg);
    if (list.length > 400) list = list.slice(list.length - 400);
    localStorage.setItem(key, JSON.stringify(list));
  } catch (e) {}
};
window.etcLoadCachedMessages = function () {
  try {
    return JSON.parse(localStorage.getItem('etc_chat_cache_public') || '[]') || [];
  } catch (e) { return []; }
};


/** Stable identity across re-login (email preferred, else device id) — for polls + view-once */
window.etcStableUid = function () {
  try {
    var cu = window.currentUser || (typeof currentUser !== 'undefined' ? currentUser : null) || {};
    if (cu.email) {
      return 'em_' + String(cu.email).toLowerCase().replace(/[^a-z0-9@._+\-]/g, '');
    }
    var d = localStorage.getItem('etc_stable_uid');
    if (d) return d;
    d = 'dev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('etc_stable_uid', d);
    return d;
  } catch (e) {
    var cu2 = window.currentUser || {};
    return cu2.uid || 'anon';
  }
};
window.etcStableName = function () {
  try {
    return (window.currentUserData && window.currentUserData.name) ||
      (window.currentUser && (currentUser.displayName || currentUser.name)) || 'User';
  } catch (e) { return 'User'; }
};


/** Bulletproof @gemini — paints loading + reply even if GeminiChat module fails */
window.etcRunGemini = function (userText) {
  try {
    if (!userText || String(userText).toLowerCase().indexOf('@gemini') < 0) return;
    var prompt = String(userText).replace(/@gemini/gi, '').trim() || 'Say a friendly hello to the ETC chat.';
    var box = document.getElementById('chatMessages');
    var thinkId = '_gcThink_' + Date.now();

    // Loading bubble (always visible)
    if (box) {
      var tw = document.createElement('div');
      tw.id = thinkId;
      tw.setAttribute('data-gemini-loading', '1');
      tw.style.cssText = 'display:flex;align-items:flex-start;gap:10px;padding:8px 4px;margin:6px 0;';
      tw.innerHTML =
        '<div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#0B0F3A,#1a237e);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:14px;flex-shrink:0">G</div>' +
        '<div style="background:#1f2937;border-radius:14px;padding:12px 16px;display:flex;gap:6px;align-items:center;min-width:70px">' +
          '<span style="width:8px;height:8px;border-radius:50%;background:#93c5fd;display:inline-block;animation:_etcGemPulse 1s infinite"></span>' +
          '<span style="width:8px;height:8px;border-radius:50%;background:#93c5fd;display:inline-block;animation:_etcGemPulse 1s infinite .2s"></span>' +
          '<span style="width:8px;height:8px;border-radius:50%;background:#93c5fd;display:inline-block;animation:_etcGemPulse 1s infinite .4s"></span>' +
        '</div>';
      box.appendChild(tw);
      try { window.scrollTo(0, document.body.scrollHeight); } catch (e) {}
    }
    try { if (typeof showToast === 'function') showToast('🤖 Gemini…'); } catch (e) {}

    // Inject pulse CSS once
    if (!document.getElementById('_etcGemPulseCss')) {
      var s = document.createElement('style');
      s.id = '_etcGemPulseCss';
      s.textContent = '@keyframes _etcGemPulse{0%,80%,100%{opacity:.3;transform:scale(.85)}40%{opacity:1;transform:scale(1)}}';
      (document.head || document.documentElement).appendChild(s);
    }

    var key = 'YOUR_GEMINI_API_KEY_HERE';
    var model = 'gemini-3.1-flash-lite';
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + key;
    var system = 'You are the official AI assistant inside the Enugu Transport Corporation (ETC) chat for passengers. Help with bus routes, terminals, fares, tickets around Enugu, Nigeria. Be witty, supportive and concise.';

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: system }] },
        generationConfig: { maxOutputTokens: 500, temperature: 0.85 }
      })
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var el = document.getElementById(thinkId);
      if (el) el.remove();
      var answer = null;
      try {
        var parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
        if (parts) {
          answer = '';
          for (var i = 0; i < parts.length; i++) if (parts[i] && parts[i].text) answer += parts[i].text;
        }
      } catch (e) {}
      if (!answer) {
        answer = '⚠️ Gemini: ' + ((data.error && data.error.message) || 'no reply');
        console.warn('Gemini raw', data);
      }
      // Paint reply
      var msg = {
        id: 'gemini_' + Date.now(),
        message: answer,
        senderId: 'gemini-ai',
        senderUid: 'gemini-ai',
        senderName: 'Gemini AI',
        senderEmail: 'gemini@ai',
        isGemini: true,
        timestamp: Date.now(),
        ts: Date.now(),
        reactions: {}
      };
      try {
        var box2 = document.getElementById('chatMessages');
        if (box2 && typeof renderPublicMsg === 'function') {
          renderPublicMsg(msg, box2);
          try { window.scrollTo(0, document.body.scrollHeight); } catch (e) {}
        }
      } catch (ePaint) { console.error(ePaint); }
      // Save once
      try {
        if (window.saveToFirebase) window.saveToFirebase('public_chat', msg).catch(function () {});
        else if (window.db && window.db.ref) window.db.ref('public_chat').push(msg);
      } catch (e) {}
    })
    .catch(function (err) {
      var el = document.getElementById(thinkId);
      if (el) el.remove();
      console.error('Gemini fetch', err);
      try { if (typeof showToast === 'function') showToast('Gemini failed: ' + (err.message || err), 'error'); } catch (e) {}
      try {
        var box3 = document.getElementById('chatMessages');
        if (box3 && typeof renderPublicMsg === 'function') {
          renderPublicMsg({
            id: 'gemini_err_' + Date.now(),
            message: '⚠️ Could not reach Gemini. Check network.',
            senderId: 'gemini-ai', senderName: 'Gemini AI', isGemini: true,
            timestamp: Date.now(), reactions: {}
          }, box3);
        }
      } catch (e) {}
    });
  } catch (e) {
    console.error('etcRunGemini', e);
  }
};

