// =========================================================
// Home – terminals (vertical), routes (horizontal swipe)
// =========================================================

document.addEventListener("DOMContentLoaded", () => {

  // View details
  document.querySelectorAll(".view-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const card = btn.closest(".card");
      const { from, to } = card.dataset;
      location.href = `details.html?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    });
  });

  // Bookmark – empty until the user taps it; remembered on this device
  const STORE_KEY = "etc_saved_routes";
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch (_) { saved = []; }

  const keyOf = (card) => `${card.dataset.from}>${card.dataset.to}`;

  document.querySelectorAll(".bookmark-btn").forEach(btn => {
    const card = btn.closest(".card");
    const isSaved = saved.includes(keyOf(card));
    btn.classList.toggle("saved", isSaved);
    btn.setAttribute("aria-pressed", String(isSaved));

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = keyOf(card);
      const nowSaved = !btn.classList.contains("saved");
      btn.classList.toggle("saved", nowSaved);
      btn.setAttribute("aria-pressed", String(nowSaved));
      saved = saved.filter(k => k !== key);
      if (nowSaved) saved.push(key);
      try { localStorage.setItem(STORE_KEY, JSON.stringify(saved)); } catch (_) {}
    });
  });
});

// Top bell / chatbot / chat buttons – placeholders until those features exist
document.addEventListener("DOMContentLoaded", () => {
  const toast = document.getElementById("toast");
  let timer = 0;
  document.querySelectorAll("[data-toast]").forEach((b) => {
    b.addEventListener("click", () => {
      if (!toast) return;
      toast.textContent = b.dataset.toast;
      toast.classList.add("show");
      clearTimeout(timer);
      timer = setTimeout(() => toast.classList.remove("show"), 1800);
    });
  });
});

// Holy Ghost photo strip – slides horizontally on its own (the route cards keep their own swipe).
// v6: never animates while the finger is on the screen or the page is moving – a moving strip
// competed with the scroll and made swiping feel jittery.
document.addEventListener("DOMContentLoaded", () => {
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let busyUntil = 0, touching = false;
  const bump = (ms) => { busyUntil = Math.max(busyUntil, Date.now() + ms); };
  window.addEventListener("scroll", () => bump(900), { passive: true });
  window.addEventListener("touchstart", () => { touching = true; }, { passive: true });
  window.addEventListener("touchend", () => { touching = false; bump(900); }, { passive: true });
  window.addEventListener("touchcancel", () => { touching = false; }, { passive: true });
  document.querySelectorAll(".swipe-row").forEach((r) => r.addEventListener("scroll", () => bump(900), { passive: true }));

  document.querySelectorAll(".media[data-slides]").forEach((box, k) => {
    const n = parseInt(box.dataset.slides, 10) || 1;
    const track = box.querySelector(".slide-track");
    const dots = box.querySelectorAll(".slide-dots .dot");
    if (n < 2 || !track) return;
    let i = 0, timer = 0;
    const go = (to, first) => {
      i = (to + n) % n;
      if (!first) {
        // v7: the track only gets its own GPU layer while it is actually sliding.
        // A permanent layer on every card made horizontal swiping heavy and jittery.
        track.style.willChange = "transform";
        clearTimeout(track._wc);
        track._wc = setTimeout(() => { track.style.willChange = "auto"; }, 700);
      }
      track.style.transform = `translate3d(${-i * 100}%,0,0)`;
      dots.forEach((d, j) => { if (j === i) d.setAttribute("data-on", "1"); else d.removeAttribute("data-on"); });
    };
    go(0, true);
    if (reduce) return;
    const start = () => { stop(); timer = setInterval(() => { if (!touching && Date.now() > busyUntil && !document.hidden) go(i + 1); }, 4200 + k * 300); };
    const stop = () => clearInterval(timer);
    if ("IntersectionObserver" in window) {
      new IntersectionObserver((es) => es.forEach((e) => (e.isIntersecting ? start() : stop())), { threshold: 0.35 }).observe(box);
    } else start();
  });
});

// Bell → Notifications (tickets land here). Red dot = unread.
document.addEventListener("DOMContentLoaded", () => {
  const bell = document.getElementById("hdrSearch"), dot = document.getElementById("bellDot");
  if (!bell) return;
  const paint = () => {
    let n = 0; try { n = parseInt(localStorage.getItem("etc_unread"), 10) || 0; } catch (_) {}
    if (dot) dot.classList.toggle("on", n > 0);
    bell.setAttribute("aria-label", n > 0 ? `Notifications, ${n} new` : "Notifications");
  };
  bell.addEventListener("click", () => { location.href = "notifications.html"; });
  paint();
  window.addEventListener("pageshow", paint);
  window.addEventListener("etc:show", paint);
});


// ---- Route ratings (Firebase) — Play Store style, v8 ----
// How it works now:
//   route_ratings/{route}            -> { sum, count }   = ALL users together (average = sum / count)
//   route_ratings/{route}/votes/{uid} -> { stars, note } = ONE vote per Firebase user (stable uid)
// Saving / removing a vote is ONE transaction that changes the vote AND the totals together,
// so the average can never drift. The badge always shows the average of everybody;
// your own stars are shown only inside the rate sheet ("Your rating").
(function () {
  const STAR_PATH = 'M12 2.5l2.9 6.2 6.8.8-5 4.7 1.3 6.7L12 17.5l-6 3.4 1.3-6.7-5-4.7 6.8-.8z';
  const CACHE_KEY = "etc_rating_cache_v2";
  const MY_KEY = "etc_my_votes_v2";
  const LABELS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];

  let stats = {};            // docId -> { sum, count }
  try { stats = JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch (_) { stats = {}; }
  const badges = [];         // { badge, key, id, numEl, pathEl }
  let lastRefresh = 0, refreshing = false;

  const FB = () => (window.ETC_FB && window.ETC_FB.db ? window.ETC_FB : null);
  const docId = (key) => encodeURIComponent(String(key)).replace(/%/g, "_").slice(0, 700);
  const toast = (m) => { try { window.ETC_UI && window.ETC_UI.toast && window.ETC_UI.toast(m); } catch (_) {} };

  function routeKeyFromCard(card) {
    const d = (card && card.dataset) || {};
    if (d.from && d.to) return d.from + ">" + d.to;           // stable: no more guessing from card text
    const t = (card && card.textContent || "").trim();
    const m = t.match(/([A-Za-z][A-Za-z\s]+)\s*→\s*([A-Za-z][A-Za-z\s]+)/);
    return m ? (m[1].trim() + ">" + m[2].trim()).replace(/\s+/g, " ") : "route";
  }
  const avgOf = (st) => {
    const count = Math.max(0, parseInt(st && st.count, 10) || 0);
    const sum = Math.max(0, +(st && st.sum) || 0);
    if (count <= 0 || sum <= 0) return { avg: 0, count: 0 };
    return { avg: Math.min(5, sum / count), count: count };
  };
  const myVotes = () => { try { return JSON.parse(localStorage.getItem(MY_KEY)) || {}; } catch (_) { return {}; } };
  const setMyVote = (uid, id, stars) => {
    try {
      const all = myVotes(); all[uid] = all[uid] || {};
      if (stars > 0) all[uid][id] = stars; else delete all[uid][id];
      localStorage.setItem(MY_KEY, JSON.stringify(all));
    } catch (_) {}
  };

  // Update text/fill only (no innerHTML, no class churn → no layout work while scrolling)
  function paint(b) {
    const r = avgOf(stats[b.id]);
    const label = r.count > 0 ? r.avg.toFixed(1) : "0.0";
    if (b.numEl.textContent !== label) b.numEl.textContent = label;
    b.pathEl.setAttribute("fill", r.count > 0 ? "#0f172a" : "none");
    if (r.count > 0) b.badge.setAttribute("data-rated", "1"); else b.badge.removeAttribute("data-rated");
    b.badge.title = r.count > 0 ? label + " · " + r.count + " rating" + (r.count === 1 ? "" : "s") : "Tap to rate this route";
  }
  const paintAll = () => badges.forEach(paint);

  // ONE read for every route (was 2 reads x 18 cards = 36 on every Home load)
  async function refresh(force) {
    const fb = FB();
    if (!fb || refreshing) return;
    if (!force && Date.now() - lastRefresh < 30000) return;
    refreshing = true;
    try {
      await fb.ensureAuth();
      const snap = await fb.db.collection("route_ratings").get();
      const next = {};
      snap.forEach((d) => { const v = d.data() || {}; next[d.id] = { sum: +v.sum || 0, count: parseInt(v.count, 10) || 0 }; });
      stats = next;
      lastRefresh = Date.now();
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(stats)); } catch (_) {}
      paintAll();
    } catch (e) {
      console.warn("[ETC rating] refresh", e);
      // fallback if the rules only allow single-document reads: read each route's total directly
      try {
        const next = Object.assign({}, stats);
        await Promise.all(badges.map(async (b) => {
          const d = await fb.db.collection("route_ratings").doc(b.id).get();
          if (d.exists) { const v = d.data() || {}; next[b.id] = { sum: +v.sum || 0, count: parseInt(v.count, 10) || 0 }; }
        }));
        stats = next; lastRefresh = Date.now();
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(stats)); } catch (_) {}
        paintAll();
      } catch (_) {}
    }
    refreshing = false;
  }

  async function saveVote(key, stars, note) {
    const fb = FB(); if (!fb) return false;
    try {
      const user = await fb.ensureAuth();
      const uid = user.uid, id = docId(key);
      const ref = fb.db.collection("route_ratings").doc(id);
      const voteRef = ref.collection("votes").doc(uid);
      const FV = fb.FieldValue;
      const tot = await fb.db.runTransaction(async (tx) => {
        const agg = await tx.get(ref);
        const vote = await tx.get(voteRef);
        const prev = vote.exists ? (+vote.data().stars || 0) : 0;
        const d = agg.exists ? agg.data() : {};
        let sum = Math.max(0, +d.sum || 0), count = Math.max(0, parseInt(d.count, 10) || 0);
        sum += stars - prev;
        if (!prev) count += 1;
        tx.set(voteRef, { stars: stars, note: note || "", user: uid, routeKey: key, updatedAt: FV.serverTimestamp() }, { merge: true });
        tx.set(ref, { sum: sum, count: count, routeKey: key, updatedAt: FV.serverTimestamp() }, { merge: true });
        return { sum: sum, count: count };
      });
      stats[id] = tot; setMyVote(uid, id, stars);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(stats)); } catch (_) {}
      paintAll();
      return true;
    } catch (e) { console.warn("[ETC rating] save", e); return false; }
  }

  async function removeVote(key) {
    const fb = FB(); if (!fb) return false;
    try {
      const user = await fb.ensureAuth();
      const uid = user.uid, id = docId(key);
      const ref = fb.db.collection("route_ratings").doc(id);
      const voteRef = ref.collection("votes").doc(uid);
      const FV = fb.FieldValue;
      const tot = await fb.db.runTransaction(async (tx) => {
        const agg = await tx.get(ref);
        const vote = await tx.get(voteRef);
        const d = agg.exists ? agg.data() : {};
        let sum = Math.max(0, +d.sum || 0), count = Math.max(0, parseInt(d.count, 10) || 0);
        if (!vote.exists) return { sum: sum, count: count };      // nothing of mine to remove – never touch other people's votes
        const prev = +vote.data().stars || 0;
        sum = Math.max(0, sum - prev); count = Math.max(0, count - 1);
        if (count === 0) sum = 0;
        tx.delete(voteRef);
        tx.set(ref, { sum: sum, count: count, routeKey: key, updatedAt: FV.serverTimestamp() }, { merge: true });
        return { sum: sum, count: count };
      });
      stats[id] = tot; setMyVote(uid, id, 0);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(stats)); } catch (_) {}
      paintAll();
      return true;
    } catch (e) { console.warn("[ETC rating] remove", e); return false; }
  }

  async function readMyVote(key) {
    const fb = FB(); if (!fb) return 0;
    try {
      const user = await Promise.race([fb.ensureAuth(), new Promise((_, rj) => setTimeout(rj, 4000))]);
      const v = await Promise.race([
        fb.db.collection("route_ratings").doc(docId(key)).collection("votes").doc(user.uid).get(),
        new Promise((_, rj) => setTimeout(rj, 4000)),
      ]);
      const stars = v.exists ? (+v.data().stars || 0) : 0;
      setMyVote(user.uid, docId(key), stars);
      return stars;
    } catch (_) {
      const u = fb.auth && fb.auth.currentUser;
      return u ? ((myVotes()[u.uid] || {})[docId(key)] || 0) : 0;
    }
  }

  async function openRateSheet(key) {
    if (!FB()) { toast("Ratings need an internet connection"); return; }
    if (document.querySelector(".rate-ov")) return;
    const id = docId(key);
    const r = avgOf(stats[id]);
    let my = 0, pick = 0;
    const ov = document.createElement("div");
    ov.className = "rate-ov";
    const stars = [1, 2, 3, 4, 5].map((n) =>
      '<button type="button" class="rate-pick-star" data-n="' + n + '" aria-label="' + n + ' stars"><svg width="36" height="36" viewBox="0 0 24 24"><path d="' + STAR_PATH + '" fill="none" stroke="#CBD5E1" stroke-width="1.5" stroke-linejoin="round"/></svg></button>').join("");
    ov.innerHTML = '<div class="rate-ov-card"><h3>Rate this route</h3><div class="rate-sheet">' +
      '<p class="rate-sheet-route">' + key.replace(">", " → ") + '</p>' +
      '<p class="rate-sheet-avg">' + (r.count > 0 ? "Everyone: <b>" + r.avg.toFixed(1) + "</b> ★ · " + r.count + " rating" + (r.count === 1 ? "" : "s") : "No ratings yet — be the first") + '</p>' +
      '<p class="rate-sheet-hint" id="rateHint">Tap a star to rate</p>' +
      '<div class="rate-sheet-stars" id="rateStars">' + stars + '</div>' +
      '<textarea class="rate-sheet-note" id="rateNote" rows="2" maxlength="280" placeholder="Optional comment (what was the trip like?)"></textarea>' +
      '<button type="button" class="btn rate-sheet-submit" id="rateSubmit" disabled>Submit rating</button>' +
      '<button type="button" class="rate-sheet-remove" id="rateRemove" hidden>Remove my rating</button>' +
      '</div><button type="button" class="btn btn-ghost" id="rateClose">Cancel</button></div>';
    document.body.appendChild(ov);
    try { document.body.style.overflow = "hidden"; } catch (_) {}
    const $ = (s) => ov.querySelector(s);
    const close = () => { try { ov.remove(); } catch (_) {} try { document.body.style.overflow = ""; } catch (_) {} };
    ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
    $("#rateClose").onclick = close;
    const submit = $("#rateSubmit"), hint = $("#rateHint"), rm = $("#rateRemove");
    const paintStars = () => {
      ov.querySelectorAll(".rate-pick-star").forEach((b) => {
        const on = +b.dataset.n <= pick, p = b.querySelector("path");
        p.setAttribute("fill", on ? "#0f172a" : "none"); p.setAttribute("stroke", on ? "#0f172a" : "#CBD5E1");
      });
      hint.textContent = pick ? (my && pick === my ? "Your rating · " : "") + LABELS[pick] : "Tap a star to rate";
      submit.disabled = !pick || pick === my;
      submit.textContent = my ? "Update rating" : "Submit rating";
      rm.hidden = !my;
    };
    $("#rateStars").addEventListener("click", (e) => {
      const b = e.target.closest(".rate-pick-star"); if (!b) return;
      pick = +b.dataset.n; paintStars();
    });
    submit.onclick = async () => {
      if (!pick) return;
      submit.disabled = true; submit.textContent = "Saving…";
      const ok = await saveVote(key, pick, ($("#rateNote").value || "").trim().slice(0, 280));
      if (ok) { toast(my ? "Rating updated" : "Thanks for your rating!"); close(); }
      else { paintStars(); toast("Could not save — check your connection"); }
    };
    rm.onclick = async () => {
      rm.disabled = true;
      const ok = await removeVote(key);
      if (ok) { toast("Your rating was removed"); close(); } else { rm.disabled = false; toast("Could not remove — try again"); }
    };
    paintStars();
    my = await readMyVote(key);           // your own stars, from YOUR vote document only
    if (my) pick = my;
    paintStars();
  }

  function wire() {
    document.querySelectorAll(".rating-badge").forEach(function (badge) {
      if (badge.dataset.wired === "1") return;
      badge.dataset.wired = "1";
      const card = badge.closest("article, .card") || badge.parentElement;
      const key = routeKeyFromCard(card);
      badge.dataset.routeKey = key;
      // build the badge structure once, then only ever change text/fill
      badge.innerHTML = '<svg class="rate-star" width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><path d="' + STAR_PATH + '" fill="none" stroke="#0f172a" stroke-width="1.8" stroke-linejoin="round"/></svg><span class="rate-num">0.0</span>';
      const b = { badge: badge, key: key, id: docId(key), numEl: badge.querySelector(".rate-num"), pathEl: badge.querySelector("path") };
      badges.push(b);
      paint(b);                                           // instant paint from the local cache
      badge.style.cursor = "pointer";
      badge.setAttribute("role", "button");
      badge.setAttribute("tabindex", "0");
      badge.addEventListener("pointerdown", (e) => e.stopPropagation());
      badge.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openRateSheet(key); });
      badge.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openRateSheet(key); } });
    });
    // fetch the shared totals once things have settled, then again when you come back to the app
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 900));
    idle(() => refresh(true), { timeout: 3000 });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(false); });
    window.addEventListener("pageshow", () => refresh(false));
  }

  if (!document.getElementById("etc-rate-css")) {
    const st = document.createElement("style");
    st.id = "etc-rate-css";
    st.textContent = '' +
      '.rate-sheet{padding:4px 0 8px}' +
      '.rate-sheet-route{margin:0 0 4px;font:700 15px/1.3 system-ui,sans-serif;color:#0f172a;text-align:center}' +
      '.rate-sheet-avg{margin:0 0 10px;font:500 13px/1.3 system-ui,sans-serif;color:#64748b;text-align:center}' +
      '.rate-sheet-avg b{color:#0f172a}' +
      '.rate-sheet-hint{margin:0 0 12px;font:600 13px/1.3 system-ui,sans-serif;color:#64748b;text-align:center;min-height:1.2em}' +
      '.rate-sheet-stars{display:flex;justify-content:center;gap:8px;margin-bottom:14px}' +
      '.rate-pick-star{border:0;background:transparent;padding:4px;cursor:pointer;border-radius:10px;line-height:0}' +
      '.rate-pick-star:active{transform:scale(0.92)}' +
      '.rate-sheet-note{width:100%;box-sizing:border-box;border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px;font:400 14px/1.4 system-ui,sans-serif;resize:vertical;margin-bottom:12px;min-height:64px}' +
      '.rate-sheet-submit{width:100%}' +
      '.rate-sheet-submit:disabled{opacity:0.45}' +
      '.rate-sheet-remove{display:block;width:100%;margin:10px 0 0;border:0;background:transparent;color:#b91c1c;font:600 13px system-ui,sans-serif;padding:8px}' +
      '.rate-sheet-remove[hidden]{display:none}' +
      '.rate-ov{position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,.45);display:flex;align-items:flex-end;justify-content:center;padding:16px}' +
      '.rate-ov-card{background:#fff;border-radius:20px 20px 16px 16px;padding:20px 18px;width:min(420px,100%);box-shadow:0 20px 50px rgba(0,0,0,.2)}' +
      '.rate-ov-card h3{margin:0 0 8px;font:800 18px/1.2 system-ui,sans-serif;text-align:center}';
    document.head.appendChild(st);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();

// v7: decode all card photos up-front (a few at a time) so swiping to the next route never
// stalls while a photo is decoded for the first time.
(function () {
  const run = () => {
    const imgs = Array.from(document.querySelectorAll(".card .media img"));
    let k = 0, lastScroll = 0;
    // v10: never decode photos while the page or a card row is moving – wait until it has been still
    window.addEventListener("scroll", () => { lastScroll = performance.now(); }, { passive: true, capture: true });
    const next = () => {
      if (k >= imgs.length) return;
      if (performance.now() - lastScroll < 400) { setTimeout(next, 250); return; }
      const im = imgs[k++];
      try { im.loading = "eager"; } catch (_) {}
      const done = () => setTimeout(next, 60);
      if (im.decode) im.decode().then(done, done); else done();
    };
    next();
  };
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 700));
  window.addEventListener("load", () => idle(run, { timeout: 2500 }));
})();
