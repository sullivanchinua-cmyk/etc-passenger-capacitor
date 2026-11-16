/* =========================================================
   ETC – chat bridge (host app → chat)
   Remembers WHICH account opened the app so the chat (same origin, ./chat/) is signed in
   as that same person: Firebase uid + role in localStorage. Logging out clears it.
   ========================================================= */
(function () {
  "use strict";
  var ROLE = "passenger";
  function save(u) {
    try {
      if (u && u.uid) { localStorage.setItem("etc_chat_uid", u.uid); localStorage.setItem("etc_chat_role", ROLE); if (u.email && ROLE === "executive") localStorage.setItem("etc_exec_email", u.email); }
      else { localStorage.removeItem("etc_chat_uid"); localStorage.removeItem("etc_chat_role"); }
    } catch (_) {}
  }
  function extra() {}
  var tries = 0, iv = setInterval(function () {
    var fb = window.ETC_FB;
    if (fb && fb.auth) {
      clearInterval(iv);
      try { fb.auth.onAuthStateChanged(function (u) { save(u); extra(); }); } catch (_) {}
      if (fb.auth.currentUser) { save(fb.auth.currentUser); extra(); }
    } else if (++tries > 80) clearInterval(iv);
  }, 300);
})();
