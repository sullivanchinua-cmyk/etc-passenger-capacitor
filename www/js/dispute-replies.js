/* =========================================================
   Dispute replies – the executive answers a dispute in the dashboard, the passenger
   sees the reply here and is asked to rate it (1–5 stars + optional comment).
   Disputes are matched by the passenger's account (uid) – or e-mail for older disputes.
   Rating is written back to the dispute so the executive can see it.
   ========================================================= */
(function () {
  "use strict";
  var cache = {}, started = false, open = false;
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  function pending(d) {
    var rs = d.responses || []; if (!rs.length) return false;
    if (d.ratedFor === rs.length) return false;                       // this reply was already rated
    try { if (sessionStorage.getItem("etc_dr_later_" + d._id + "_" + rs.length)) return false; } catch (_) {}
    return true;
  }
  function when(ms) { try { return new Date(+ms).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" }); } catch (_) { return ""; } }
  function ms(v) { return v && v.toMillis ? v.toMillis() : +v || 0; }

  function show(d) {
    var UI = window.ETC_UI; if (!UI || !UI.overlay || open) return;
    if (document.querySelector(".ov.show")) { setTimeout(present, 4000); return; }   // never fight another pop-up
    open = true;
    var rs = d.responses, last = rs[rs.length - 1], stars = 0;
    var ui = UI.overlay(
      '<div class="ov-card dlg-card" role="dialog" aria-label="Reply to your dispute" style="max-height:88vh;overflow:auto">' +
      '<button class="ov-close" data-close aria-label="Close">' + (UI.X || "×") + '</button>' +
      '<h3>We replied to your dispute</h3>' +
      '<p>' + esc(d.reason || d.title || "Dispute") + (d.ticketId ? " · " + esc(d.ticketId) : "") + '</p>' +
      '<div style="text-align:left;background:rgba(17,17,18,.06);border-radius:18px;padding:12px 14px;margin:10px 0">' +
        '<div style="font-size:11.5px;font-weight:700;color:#8A8C90;margin-bottom:4px">ETC Support · ' + esc(when(ms(last.at))) + '</div>' +
        '<div style="font-size:14.5px;font-weight:600;white-space:pre-wrap">' + esc(last.text) + '</div></div>' +
      '<div style="font-size:13px;font-weight:700;margin:12px 0 6px">How was our response?</div>' +
      '<div id="drStars" style="display:flex;justify-content:center;gap:6px;margin-bottom:10px">' +
        [1, 2, 3, 4, 5].map(function (n) { return '<button type="button" data-s="' + n + '" aria-label="' + n + ' star" style="font-size:34px;line-height:1;background:none;border:0;color:#D5D6DA">★</button>'; }).join("") + '</div>' +
      '<textarea id="drNote" rows="2" placeholder="Tell us more (optional)" style="width:100%;border:1px solid rgba(17,17,18,.15);border-radius:16px;padding:10px 12px;font:600 14px inherit;font-family:inherit;outline:none"></textarea>' +
      '<button type="button" class="ov-btn" id="drSend" disabled style="opacity:.45;margin-top:10px">Submit rating</button>' +
      '<button type="button" class="ov-btn ghost" id="drLater">Later</button></div>', { sticky: true });
    var el = ui.el, send = el.querySelector("#drSend");
    el.querySelectorAll("#drStars button").forEach(function (b) {
      b.addEventListener("click", function () {
        stars = +b.getAttribute("data-s");
        el.querySelectorAll("#drStars button").forEach(function (x) { x.style.color = +x.getAttribute("data-s") <= stars ? "#F5B301" : "#D5D6DA"; });
        send.disabled = false; send.style.opacity = "1";
      });
    });
    function done() { open = false; try { ui.close(); } catch (_) {} }
    el.querySelector("#drLater").addEventListener("click", function () { try { sessionStorage.setItem("etc_dr_later_" + d._id + "_" + rs.length, "1"); } catch (_) {} done(); setTimeout(present, 600); });
    var x = el.querySelector("[data-close]"); if (x) x.addEventListener("click", function () { try { sessionStorage.setItem("etc_dr_later_" + d._id + "_" + rs.length, "1"); } catch (_) {} open = false; });
    send.addEventListener("click", function () {
      if (!stars) return; send.disabled = true; send.textContent = "Sending…";
      window.ETC_FB.db.collection("disputes").doc(d._id).set({ rating: stars, ratingComment: (el.querySelector("#drNote").value || "").trim(), ratedAt: Date.now(), ratedFor: rs.length }, { merge: true })
        .then(function () { d.ratedFor = rs.length; done(); if (UI.toast) UI.toast("Thanks for your feedback"); setTimeout(present, 600); })
        .catch(function () { send.disabled = false; send.textContent = "Submit rating"; if (UI.toast) UI.toast("Couldn't send – check your connection"); });
    });
  }
  function present() {
    if (open) return;
    var next = Object.keys(cache).map(function (k) { return cache[k]; }).filter(pending).sort(function (a, b) { return ms(b.lastResponseAt) - ms(a.lastResponseAt); })[0];
    if (next) show(next);
  }
  function handle(snap) {
    snap.forEach(function (doc) {
      var v = doc.data() || {};
      // a new reply from the ETC team -> notification (sound + panel + bell), once per reply
      try {
        var cnt = Array.isArray(v.responses) ? v.responses.length : 0, k = "etc_dr_n_" + doc.id;
        var seenCnt = localStorage.getItem(k);
        if (seenCnt === null) { localStorage.setItem(k, String(cnt)); }
        else if (cnt > +seenCnt) {
          localStorage.setItem(k, String(cnt));
          var last = v.responses[cnt - 1] || {};
          if (window.EtcNotify && window.EtcNotify.alert) window.EtcNotify.alert({
            title: "\uD83D\uDCAC ETC replied to your dispute",
            body: String(last.text || "Tap to read the reply").slice(0, 140),
            tag: "dispute_" + doc.id + "_" + cnt, type: "alert", url: "/notifications.html", noteType: "info"
          });
        }
      } catch (_) {}
      var rs = Array.isArray(v.responses) ? v.responses.map(function (r) { return { text: r.text || "", at: r.at, by: r.by }; }) : [];
      cache[doc.id] = { _id: doc.id, ticketId: v.ticketId, reason: v.reason, title: v.title, responses: rs, ratedFor: v.ratedFor, lastResponseAt: v.lastResponseAt };
    });
    present();
  }
  async function start() {
    if (started) return; var fb = window.ETC_FB; if (!fb || !fb.db) return; started = true;
    try { await fb.ensureAuth(); } catch (_) {}
    var uid = fb.auth && fb.auth.currentUser && fb.auth.currentUser.uid, email = null;
    try { email = (JSON.parse(localStorage.getItem("etc_user") || "null") || {}).email || null; } catch (_) {}
    if (uid) fb.db.collection("disputes").where("uid", "==", uid).onSnapshot(handle, function () {});
    if (email) fb.db.collection("disputes").where("passengerEmail", "==", email).onSnapshot(handle, function () {});
  }
  var tries = 0, iv = setInterval(function () { if (window.ETC_FB && window.ETC_FB.db) { clearInterval(iv); setTimeout(start, 1200); } else if (++tries > 40) clearInterval(iv); }, 400);
})();
