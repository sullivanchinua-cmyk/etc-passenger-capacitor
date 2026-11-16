/* =========================================================
   ETC – live fares (shared by Passenger + Agent apps)
   The Executive Dashboard publishes prices to Firestore  config/fares :
     { routes: { "Holy Ghost>Emene": 500, ... }, luggageUnitFee: 500 }
   This script overrides the default fares in window.ETC_ROUTES (and the
   luggage unit fee in window.ETC_BOOK) so both apps charge what the
   executive set.  If the document is missing or unreadable nothing changes.
   Last-known prices are cached in localStorage so the very first render of a
   page already uses them (no flash of the old price).
   Tickets that were already sold keep the price they were sold at.
   Load right AFTER data.js (passenger) / config.js (agent).
   ========================================================= */
(function () {
  "use strict";
  var KEY = "etc_live_fares_v1";
  var TWO_DAYS = 2 * 24 * 60 * 60 * 1000;   // an old price stays visible (struck through) for 2 days
  function findRoute(from, to) {
    var rs = window.ETC_ROUTES || [];
    for (var i = 0; i < rs.length; i++) if (rs[i].from === from && rs[i].to === to) return rs[i];
    return null;
  }
  /** previous price of a route if it changed within the last 2 days, else null */
  window.ETC_fareWas = function (from, to) {
    var r = findRoute(from, to);
    if (!r || r.oldFare == null || r.oldFare === r.fare) return null;
    return Date.now() - r.oldFareAt > TWO_DAYS ? null : r.oldFare;
  };
  function apply(cfg) {
    if (!cfg) return false;
    var changed = false, routes = cfg.routes || {}, prev = cfg.prev || {};
    (window.ETC_ROUTES || []).forEach(function (r) {
      var v = routes[r.from + ">" + r.to];
      if (v != null && isFinite(+v) && +v >= 0 && r.fare !== +v) { r.fare = +v; changed = true; }
    });
    (window.ETC_ROUTES || []).forEach(function (r) {
      var p = prev[r.from + ">" + r.to];
      if (p && isFinite(+p.old) && isFinite(+p.at)) { r.oldFare = +p.old; r.oldFareAt = +p.at; } else { delete r.oldFare; delete r.oldFareAt; }
    });
    var lug = cfg.luggageUnitFee;
    if (window.ETC_BOOK && lug != null && isFinite(+lug) && +lug >= 0 && window.ETC_BOOK.luggageUnitFee !== +lug) { window.ETC_BOOK.luggageUnitFee = +lug; changed = true; }
    changed = true; // always repaint: the "old price" tags may have changed too
    return changed;
  }

  /* Passenger Home: the route cards have their price typed in the HTML, so repaint them from ETC_ROUTES.
     New price big; the previous price small, struck through, for 2 days. */
  function fmt(n) { return "\u20A6" + Number(n).toLocaleString("en-US"); }
  function paintHome() {
    document.querySelectorAll("article[data-from][data-to]").forEach(function (card) {
      var from = card.getAttribute("data-from"), to = card.getAttribute("data-to"), r = findRoute(from, to);
      var p = card.querySelector("p.text-sm");
      if (!r || !p) return;
      card.setAttribute("data-fare", r.fare);
      var node = p.firstChild; while (node && node.nodeType !== 3) node = node.nextSibling;
      if (!node) return;
      node.nodeValue = fmt(r.fare) + " ";
      var old = p.querySelector(".fare-was"); if (old) old.remove();
      var w = window.ETC_fareWas(from, to);
      if (w != null) {
        var s = document.createElement("span");
        s.className = "fare-was"; s.title = "Previous price"; s.textContent = fmt(w);
        s.style.cssText = "font-size:11px;font-weight:500;color:#94a3b8;text-decoration:line-through;text-decoration-thickness:1.5px;margin-right:5px";
        p.insertBefore(s, node.nextSibling);
      }
    });
  }
  window.addEventListener("etc:fares-updated", paintHome);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", paintHome); else paintHome();

  try { apply(JSON.parse(localStorage.getItem(KEY) || "null")); } catch (_) {}

  var tries = 0, iv = setInterval(function () {
    if (window.ETC_FB && window.ETC_FB.db) {
      clearInterval(iv);
      try {
        window.ETC_FB.db.collection("config").doc("fares").onSnapshot(function (snap) {
          if (!snap.exists) return;
          var d = snap.data() || {};
          // price changed since the last time this phone saw the fares -> notification (sound + panel + bell)
          try {
            var before = JSON.parse(localStorage.getItem(KEY) || "null");
            if (before && before.routes && window.EtcNotify && window.EtcNotify.alert) {
              var sent = 0, nowR = d.routes || {};
              Object.keys(nowR).forEach(function (k) {
                var o = before.routes[k], n = nowR[k];
                if (sent >= 3 || o == null || n == null || +o === +n || !isFinite(+o) || !isFinite(+n)) return;
                sent++;
                var up = +n > +o;
                window.EtcNotify.alert({
                  title: (up ? "\uD83D\uDCC8 Fare increased" : "\uD83D\uDCC9 Fare reduced"),
                  body: k.replace(">", " \u2192 ") + ": " + fmt(o) + " \u2192 " + fmt(n),
                  tag: "fare_" + k + "_" + n, type: "alert", url: "/", noteType: "info"
                });
              });
            }
          } catch (_) {}
          try { localStorage.setItem(KEY, JSON.stringify({ routes: d.routes || {}, prev: d.prev || {}, luggageUnitFee: d.luggageUnitFee })); } catch (_) {}
          if (apply(d)) { try { window.dispatchEvent(new Event("etc:fares-updated")); } catch (_) {} }
        }, function () { /* no access yet – keep defaults / cached prices */ });
      } catch (_) {}
    } else if (++tries > 60) clearInterval(iv);
  }, 300);
})();
