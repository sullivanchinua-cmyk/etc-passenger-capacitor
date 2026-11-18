// =========================================================
// ETC Assistant — speech in (SpeechRecognition), speech out
// (speechSynthesis, with a user-pickable voice), a tiny ETC-flavoured
// canned reply engine, a JSON slot-filling booking flow, and a hard
// 5-activation cap on the microphone per device. Typing is always free.
// =========================================================
document.addEventListener("DOMContentLoaded", () => {
  const UI = window.ETC_UI, ICON = window.ETC_ICONS, esc = UI.esc;
  const log = document.getElementById("aiLog");
  const chips = document.getElementById("aiChips");
  const status = document.getElementById("aiStatus");
  const quotaEl = document.getElementById("aiQuota");
  const quotaN = document.getElementById("aiQuotaN");
  const form = document.getElementById("aiForm");
  const textInput = document.getElementById("aiText");
  const micBtn = document.getElementById("aiMic");
  const sendBtn = document.getElementById("aiSend");
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  document.getElementById("aiBack").addEventListener("click", () => { location.href = "index.html"; });

  // ---------- mic/send toggle in the input row ----------
  function paintInputButtons() {
    const hasText = textInput.value.trim().length > 0;
    sendBtn.hidden = !hasText;
    micBtn.hidden = hasText;
  }
  textInput.addEventListener("input", paintInputButtons);
  paintInputButtons();

  // ---------- mic quota (persists on this device; typing doesn't count) ----------
  const LIMIT = 5, KEY = "etc_ai_mic_uses";
  let used = 0;
  try { used = parseInt(localStorage.getItem(KEY), 10) || 0; } catch (_) {}
  function paintQuota() {
    const left = Math.max(0, LIMIT - used);
    quotaN.textContent = left;
    quotaEl.classList.toggle("low", left <= 1);
  }
  paintQuota();

  // ---------- transcript ----------
  function addMsg(role, text) {
    const row = document.createElement("div");
    if (role === "bot") {
      row.className = "ai-msg-row";
      row.innerHTML = `<span class="ai-avatar">${ICON.sparkle}</span><div class="ai-msg bot"></div>`;
      row.querySelector(".ai-msg").textContent = text;
    } else {
      row.className = "ai-msg user";
      row.textContent = text;
    }
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
    if (log.children.length > 1) chips.classList.add("hide");
    return row;
  }
  function addTyping() {
    const row = document.createElement("div");
    row.className = "ai-msg-row";
    row.innerHTML = `<span class="ai-avatar">${ICON.sparkle}</span><div class="ai-msg bot"><div class="ai-typing"><i></i><i></i><i></i></div></div>`;
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
    return row;
  }
  function setStatus(text, cls) {
    status.textContent = text || "";
    status.className = "ai-status" + (text ? " show" : "") + (cls ? " " + cls : "");
  }

  // =========================================================
  // Voice output — pick a nicer default voice, and let the person
  // change it (some device voices sound unpleasant / too robotic).
  // =========================================================
  const VOICE_KEY = "etc_ai_voice";
  let voices = [], chosenVoiceURI = null;
  try { chosenVoiceURI = localStorage.getItem(VOICE_KEY) || null; } catch (_) {}

  function scoreVoice(v) {
    let s = 0;
    if (/^en/i.test(v.lang)) s += 5;
    if (/en-NG|en-GB|en-US/i.test(v.lang)) s += 2;
    if (!v.localService) s += 3;                       // network voices are usually far less robotic
    if (/female|zira|samantha|serena|aria|jenny/i.test(v.name)) s += 2;
    if (/google/i.test(v.name)) s += 2;
    return s;
  }
  function refreshVoices() {
    if (!("speechSynthesis" in window)) return;
    voices = window.speechSynthesis.getVoices() || [];
    if (!chosenVoiceURI && voices.length) {
      const best = voices.slice().sort((a, b) => scoreVoice(b) - scoreVoice(a))[0];
      if (best) chosenVoiceURI = best.voiceURI;
    }
  }
  if ("speechSynthesis" in window) {
    refreshVoices();
    window.speechSynthesis.onvoiceschanged = refreshVoices;
  }

  function showVoicePicker() {
    refreshVoices();
    const list = voices.filter((v) => /^en/i.test(v.lang)).length ? voices.filter((v) => /^en/i.test(v.lang)) : voices;
    const ui = UI.overlay(`
      <div class="ov-card dlg-card" role="dialog" aria-label="Choose assistant voice">
        <button class="ov-close" data-close aria-label="Close">${UI.X}</button>
        <div class="seal">${ICON.headphones}</div>
        <h3>Assistant voice</h3>
        <p>Pick which voice reads replies aloud.</p>
        <div class="ai-voice-list" id="voiceList">
          ${list.length ? list.map((v) => `
            <div class="ai-voice-opt${v.voiceURI === chosenVoiceURI ? " on" : ""}" data-uri="${esc(v.voiceURI)}">
              <i class="dot"></i>
              <div><b>${esc(v.name.replace(/^Google\s*/, ""))}</b><span>${esc(v.lang)}</span></div>
            </div>`).join("") : `<p style="color:var(--mute);font-weight:600;font-size:13px;margin:0">No extra voices found on this device \u2014 using the system default.</p>`}
        </div>
        <button type="button" class="ov-btn" data-close>Done</button>
      </div>`);
    ui.el.querySelectorAll(".ai-voice-opt").forEach((opt) => {
      opt.addEventListener("click", () => {
        chosenVoiceURI = opt.dataset.uri;
        try { localStorage.setItem(VOICE_KEY, chosenVoiceURI); } catch (_) {}
        ui.el.querySelectorAll(".ai-voice-opt").forEach((o) => o.classList.toggle("on", o === opt));
        speak("Hi, this is how I sound now.");
      });
    });
  }
  document.getElementById("aiVoiceBtn").addEventListener("click", showVoicePicker);

  function speak(text) {
    if (!("speechSynthesis" in window)) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; resolve(); };
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        const v = voices.find((x) => x.voiceURI === chosenVoiceURI);
        if (v) u.voice = v;
        u.rate = 1.02; u.pitch = 1.04;
        u.onend = finish; u.onerror = finish;
        setMic("speaking"); setStatus("Speaking\u2026", "speaking");
        window.speechSynthesis.speak(u);
        setTimeout(finish, 9000); // safety net: some browsers/webviews never fire onend
      } catch (_) { finish(); }
    });
  }
  function setMic(state) {
    micBtn.classList.remove("listening", "thinking", "speaking");
    if (state) micBtn.classList.add(state);
    if (!state) setStatus("");
  }

  // =========================================================
  // Tiny ETC-flavoured reply engine (no network needed)
  // =========================================================
  function genericReply(q) {
    const s = q.toLowerCase();
    if (/\b(fare|price|cost|how much)\b/.test(s)) return "Fares start from \u20a6500 depending on the route \u2014 open a route card on the home screen to see its exact fare before booking.";
    if (/\b(track|where.*bus|bus.*now|eta)\b/.test(s)) return "I can't track buses live just yet \u2014 your ticket shows your session and time, and gate staff will call your bus when it's ready to board.";
    if (/\bseat/.test(s)) return "You can pick or change seats any time before you pay, from the Select your seats step on the booking page \u2014 or just tell me the seat you want when booking.";
    if (/\b(support|agent|human|complain|refund)\b/.test(s)) return "For a real person, use the Chat icon on the home screen or the terminal help desk \u2014 I've noted what you asked.";
    if (/\b(luggage|bag|box)\b/.test(s)) return "You can add luggage from the Extras section on the booking page \u2014 prices depend on size.";
    if (/\b(hi|hello|hey)\b/.test(s)) return "Hey! I'm your ETC assistant. Ask me about fares, seats, tickets, or say \u201cbook me a ticket\u201d and I'll walk you through it.";
    if (/thank/.test(s)) return "You're welcome \u2014 safe travels!";
    return "I'm still learning! I can help with fares, seats and tickets, or say \u201cbook me a ticket\u201d and I'll book one with you \u2014 try a suggestion below.";
  }

  // =========================================================
  // Step-by-step JSON booking flow
  //   draft = { from, to, time, seatCode }
  //   "book me a ticket" \u2192 fill what we can parse from the sentence,
  //   then ask (via an overlay) for whatever is still missing, one field
  //   at a time, until we have enough to hand off to the real booking page.
  // =========================================================
  const PLACE_ALIASES = {
    "holy ghost": ["holy ghost", "holyghost", "holy gost", "holy goat"],
    "gariki": ["gariki", "garriki", "gariiki"],
    "abakpa": ["abakpa", "again", "abakpaa", "abarkpa", "abaakpa", "abakpa old", "abakpa loading"],
    "nsukka": ["nsukka", "nsuke", "nsuka", "insuka", "nsukah", "unsukka"],
    "emene": ["emene", "emine", "amene"],
    "ninth mile": ["ninth mile", "9th mile", "ninthmile", "ninth-mile"],
    "agbani": ["agbani", "agbanyi", "abani"],
    "udi / oji": ["udi", "oji", "udi oji", "udi/oji", "udi-oji"],
    "unth new site": ["unth", "unth new site", "unth site"],
    "abakpa (old)": ["abakpa old"],
    "abakpa (loading)": ["abakpa loading", "abakpa park"],
  };
  function lev(a, b) {
    const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
    for (let j = 0; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
      d[i][j] = a[i - 1] === b[j - 1] ? d[i - 1][j - 1] : 1 + Math.min(d[i - 1][j], d[i][j - 1], d[i - 1][j - 1]);
    return d[m][n];
  }
  function findPlace(raw) {
    const s = (raw || "").trim().toLowerCase().replace(/[^a-z0-9 /()]/g, "").trim();
    if (!s) return null;
    const names = Object.keys(window.ETC_PLACES || {});
    let hit = names.find((n) => n.toLowerCase() === s);
    if (hit) return hit;
    for (const n of names) {
      const canon = n.toLowerCase();
      const aliases = PLACE_ALIASES[canon] || [canon];
      if (aliases.some((a) => a === s || s.includes(a) || a.includes(s))) return n;
    }
    let best = null, bestD = 99;
    names.forEach((n) => { const d = lev(s, n.toLowerCase()); if (d < bestD) { bestD = d; best = n; } });
    return bestD <= 2 ? best : null;
  }
  function allSlotTimes() { return (window.ETC_SESSIONS || []).flatMap((s) => s.slots); }
  function toMinutes(h, m, ap) { h = parseInt(h, 10) % 12; if (/pm/i.test(ap)) h += 12; return h * 60 + parseInt(m || "0", 10); }
  function nearestSlot(h, m, ap) {
    const target = toMinutes(h, m, ap);
    let best = null, bestD = Infinity;
    allSlotTimes().forEach((str) => {
      const mm = str.match(/(\d{2}):(\d{2})\s*(AM|PM)/i);
      const d = Math.abs(toMinutes(mm[1], mm[2], mm[3]) - target);
      if (d < bestD) { bestD = d; best = str; }
    });
    return best;
  }
  function parseBookingFields(text) {
    const s = " " + text.toLowerCase() + " ";
    const out = {};
    let m = s.match(/\bfrom\s+(.+?)\s+to\s+(.+?)(?=\s+(?:at|by|around)\b|\s+\d|\s*,|\s+seat\b|$)/i)
      || s.match(/\b([a-z][a-z .()]*?)\s+to\s+([a-z][a-z0-9 .()]*?)(?=\s+(?:at|by|around)\b|\s+\d|\s*,|\s+seat\b|$)/i);
    if (m) { out.from = findPlace(m[1]); out.to = findPlace(m[2]); }
    if (/\bany\s*time\b/i.test(s)) { out.time = null; out.anyTime = true; }
    else {
      const tm = s.match(/\b(\d{1,2})(?::([0-5]\d))?\s*(am|pm)\b/i);
      if (tm) out.time = nearestSlot(tm[1], tm[2], tm[3]);
    }
    const dt = parseDate(s); if (dt) out.date = dt;
    const cm = s.match(/\bfor\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:people|persons|passengers|tickets|of us|adults)?\b/);
    if (cm) { const n = parseCount(cm[1]); if (n) out.count = n; }
    const sm = s.match(/\bseat\s*([1-8])\s*([a-d])\b/i) || s.match(/\b([1-8])\s*([a-d])\b(?!.*\bto\b)/i);
    if (sm) out.seatCode = (sm[1] + sm[2]).toUpperCase();
    return out;
  }

  let draft = null, lastWasVoice = false;
  const CANCEL = { cancelled: true };
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const WORDNUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
  const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const niceDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }); };

  /** "today" / "tomorrow" / "friday" / "20 october" / "oct 20" / "20/10" → YYYY-MM-DD within the next 14 days, else null */
  function parseDate(text) {
    const s = " " + String(text || "").toLowerCase() + " ";
    const t0 = new Date(); t0.setHours(12, 0, 0, 0);
    const add = (n) => { const d = new Date(t0); d.setDate(d.getDate() + n); return d; };
    let d = null;
    if (/\btoday\b/.test(s)) d = add(0);
    else if (/\b(tomorrow|tmrw|tmr)\b/.test(s)) d = add(1);
    else {
      const mi = MONTHS.join("|");
      let m = s.match(new RegExp("\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?(" + mi + ")[a-z]*\\b")) || null;
      let day, mon;
      if (m) { day = +m[1]; mon = MONTHS.indexOf(m[2]); }
      else if ((m = s.match(new RegExp("\\b(" + mi + ")[a-z]*\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b")))) { mon = MONTHS.indexOf(m[1]); day = +m[2]; }
      else if ((m = s.match(/\b(\d{1,2})[\/-](\d{1,2})\b/))) { day = +m[1]; mon = +m[2] - 1; }
      if (day != null && mon >= 0 && mon < 12 && day >= 1 && day <= 31) {
        d = new Date(t0.getFullYear(), mon, day, 12);
        if (d < add(0) && (add(0) - d) > 864e5 * 2) d.setFullYear(d.getFullYear() + 1);
      } else {
        const w = s.match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/);
        if (w) { const diff = (DAYS.indexOf(w[1]) - t0.getDay() + 7) % 7; d = add(diff); }
      }
    }
    if (!d) return null;
    const diff = Math.round((d - add(0)) / 864e5);
    return diff >= 0 && diff <= 13 ? iso(d) : null;
  }
  function parseCount(text) {
    const s = String(text || "").toLowerCase();
    if (/\b(just me|only me|myself|alone|one ticket)\b/.test(s)) return 1;
    const m = s.match(/\b(\d{1,2})\b/); if (m) return +m[1];
    const w = s.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/); return w ? WORDNUM[w[1]] : null;
  }
  function cleanName(v) {
    const s = String(v || "").replace(/^(my name is|name is|it'?s|its|this is|i am|i'm)\s+/i, "").replace(/[^A-Za-z' .-]/g, " ").replace(/\s+/g, " ").trim();
    return s.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
  }
  const maxTickets = () => (window.ETC_BOOK && window.ETC_BOOK.ticketMax) || 40;

  // ---- one question in a pop-up: the assistant SPEAKS it, then LISTENS for the answer ----
  function askOverlay({ title, sub, say, placeholder, chips: chipList, skip, voice = true }) {
    return new Promise((resolve) => {
      const ui = UI.overlay(`
        <div class="ov-card dlg-card" role="dialog" aria-label="${esc(title)}">
          <button class="ov-close" data-close aria-label="Close">${UI.X}</button>
          <div class="seal">${ICON.sparkle}</div>
          <h3>${esc(title)}</h3>
          ${sub ? `<p>${esc(sub)}</p>` : ""}
          ${chipList ? `<div class="ai-ask-chips">${chipList.map((c) => `<button type="button" data-v="${esc(c)}">${esc(c)}</button>`).join("")}</div>` : ""}
          <div class="ai-ask-row">
            <input type="text" class="ai-ask-input" id="askInput" placeholder="${esc(placeholder || "")}" autocomplete="off" enterkeyhint="done" />
            ${voice && SR ? `<button type="button" class="ai-ask-mic" id="askMic" aria-label="Speak your answer">${ICON.mic}</button>` : ""}
          </div>
          <p class="ai-ask-hint" id="askHint"></p>
          <button type="button" class="ov-btn" id="askGo">Continue</button>
          ${skip ? `<button type="button" class="ov-btn ghost" id="askSkip">${esc(skip)}</button>` : ""}
        </div>`, { sticky: true });
      const el = ui.el, input = el.querySelector("#askInput"), hint = el.querySelector("#askHint"), micB = el.querySelector("#askMic");
      let rec = null, auto = 0, closed = false;
      const finish = (v) => {
        if (closed) return; closed = true; clearTimeout(auto);
        try { rec && rec.abort(); } catch (_) {}
        try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (_) {}
        setMic(null); ui.close(); setTimeout(() => resolve(v), 180);
      };
      const go = () => { const v = input.value.trim(); if (!v) { input.focus(); return; } finish(v); };

      function listen() {
        if (closed || !SR || !micB) return;
        if (!draft.micCharged) {            // a whole booking conversation costs ONE of the 5 mic turns
          if (used >= LIMIT) { hint.textContent = "Voice limit reached \u2014 please type your answer."; return; }
          used += 1; try { localStorage.setItem(KEY, String(used)); } catch (_) {} paintQuota(); draft.micCharged = true;
        }
        try { rec = new SR(); } catch (_) { return; }
        rec.lang = "en-NG"; rec.interimResults = true; rec.maxAlternatives = 1;
        micB.classList.add("on"); hint.textContent = "Listening\u2026 speak now";
        rec.onresult = (e) => {
          let t = ""; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
          input.value = t.trim();
          if (e.results[e.results.length - 1].isFinal) {
            hint.textContent = "Got it \u2014 continuing\u2026 (tap the box to edit)";
            clearTimeout(auto); auto = setTimeout(() => { if (!closed && input.value.trim()) go(); }, 1500);
          }
        };
        rec.onerror = (e) => {
          micB.classList.remove("on");
          hint.textContent = e.error === "not-allowed" || e.error === "service-not-allowed" ? "Microphone is blocked \u2014 allow it in your browser, or type your answer."
            : e.error === "no-speech" ? "I didn't hear anything \u2014 tap the mic to try again." : "Tap the mic to try again, or type your answer.";
        };
        rec.onend = () => micB.classList.remove("on");
        try { rec.start(); } catch (_) { micB.classList.remove("on"); }
      }

      el.querySelectorAll(".ai-ask-chips button").forEach((b) => b.addEventListener("click", () => { input.value = b.dataset.v; clearTimeout(auto); go(); }));
      el.querySelector("#askGo").addEventListener("click", go);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
      input.addEventListener("input", () => clearTimeout(auto));
      input.addEventListener("focus", () => clearTimeout(auto));
      if (micB) micB.addEventListener("click", () => { clearTimeout(auto); try { rec && rec.abort(); } catch (_) {} try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (_) {} listen(); });
      if (skip) el.querySelector("#askSkip").addEventListener("click", () => finish(null));
      const x = el.querySelector("[data-close]"); if (x) x.addEventListener("click", () => finish(CANCEL));
      // speak the question, THEN open the mic so it doesn't hear itself
      if (voice) speak(say || sub || title).then(() => { if (!closed) listen(); });
      else setTimeout(() => input.focus(), 260);
    });
  }

  const askRoutePlace = (v) => { const p = parseBookingFields("from " + v); return p.from && p.to ? p : { single: findPlace(v) }; };

  async function advanceBooking() {
    if (!draft) return;
    const abort = () => { draft = null; addMsg("bot", "No problem \u2014 booking cancelled. Say \u201cbook a ticket\u201d whenever you're ready."); };
    const terms = ["Holy Ghost", "Gariki", "Abakpa", "Nsukka"];

    if (!draft.from) {
      const v = await askOverlay({ title: "Where from?", say: "Where are you travelling from?", sub: "Say the terminal you'll leave from.", placeholder: "e.g. Holy Ghost", chips: terms });
      if (v === CANCEL) return abort();
      addMsg("user", v);
      const p = askRoutePlace(v);
      if (p.from) { draft.from = p.from; draft.to = p.to; } else if (p.single) draft.from = p.single;
      addMsg("bot", draft.from ? `Leaving from ${draft.from}.` : "I couldn't place that terminal \u2014 try Holy Ghost, Gariki, Abakpa or Nsukka.");
      return advanceBooking();
    }
    if (!draft.to) {
      const dests = (window.ETC_ROUTES || []).filter((r) => r.from === draft.from).map((r) => r.to).slice(0, 8);
      const v = await askOverlay({ title: "Where to?", say: `Where are you going from ${draft.from}?`, sub: `Travelling from ${draft.from}.`, placeholder: "e.g. Emene", chips: dests });
      if (v === CANCEL) return abort();
      addMsg("user", v);
      const p = findPlace(v);
      if (!p || p === draft.from) addMsg("bot", "I couldn't place that destination \u2014 try again.");
      else if (window.etcFare && window.etcFare(draft.from, p) == null) addMsg("bot", `We don't run ${draft.from} \u2192 ${p} yet \u2014 pick one of the suggested destinations.`);
      else { draft.to = p; addMsg("bot", `${draft.from} \u2192 ${draft.to}, noted.`); }
      return advanceBooking();
    }
    if (window.etcFare && window.etcFare(draft.from, draft.to) == null) { addMsg("bot", `We don't run ${draft.from} \u2192 ${draft.to} yet.`); draft.to = null; return advanceBooking(); }

    if (!draft.date) {
      const d1 = new Date(); d1.setDate(d1.getDate() + 2); const d2 = new Date(); d2.setDate(d2.getDate() + 3);
      const v = await askOverlay({ title: "Which day?", say: "Which day do you want to travel? Today, tomorrow, or another date?", sub: `${draft.from} \u2192 ${draft.to}`, placeholder: "e.g. tomorrow or 20 October",
        chips: ["Today", "Tomorrow", d1.toLocaleDateString("en-GB", { weekday: "long" }), d2.toLocaleDateString("en-GB", { weekday: "long" })] });
      if (v === CANCEL) return abort();
      addMsg("user", v);
      const d = parseDate(v);
      if (!d) addMsg("bot", "I couldn't read that date (I can book up to 14 days ahead) \u2014 try \u201ctomorrow\u201d or \u201c20 October\u201d.");
      else { draft.date = d; addMsg("bot", `Travel date: ${niceDate(d)}.`); }
      return advanceBooking();
    }
    if (!draft.time && !draft.anyTime) {
      const v = await askOverlay({ title: "What time works?", say: "What departure time would you like?", sub: `${draft.from} \u2192 ${draft.to} \u00b7 ${niceDate(draft.date)}`,
        placeholder: "e.g. 9am", chips: ["Any time", "07:30 AM", "10:00 AM", "01:30 PM", "05:30 PM"] });
      if (v === CANCEL) return abort();
      addMsg("user", v);
      if (/any/i.test(v)) { draft.anyTime = true; addMsg("bot", "Got it \u2014 I'll let you choose the time at checkout."); }
      else {
        const tm = v.match(/\b(\d{1,2})(?::([0-5]\d))?\s*(am|pm)?\b/i);
        const t = tm ? nearestSlot(tm[1], tm[2], tm[3] || "am") : null;
        if (!t) addMsg("bot", "I didn't catch a time \u2014 try something like 9am or 2:30pm.");
        else { draft.time = t; addMsg("bot", `Locked in ${t}.`); }
      }
      return advanceBooking();
    }
    if (!draft.count) {
      const v = await askOverlay({ title: "How many tickets?", say: "How many people are travelling?", sub: "Everyone in one booking will be seated together.", placeholder: "e.g. 3", chips: ["1", "2", "3", "4", "5", "6"] });
      if (v === CANCEL) return abort();
      addMsg("user", v);
      const n = parseCount(v);
      if (!n || n < 1 || n > maxTickets()) addMsg("bot", `Tell me a number between 1 and ${maxTickets()}.`);
      else { draft.count = n; draft.names = []; addMsg("bot", n === 1 ? "One ticket." : `${n} tickets \u2014 I'll seat everyone together.`); }
      return advanceBooking();
    }
    if (!draft.namesDone && draft.names.length < draft.count) {
      const i = draft.names.length;
      const v = await askOverlay({
        title: draft.count === 1 ? "Passenger name" : `Passenger ${i + 1} of ${draft.count}`, say: draft.count === 1 ? "What is the passenger's full name?" : `What is the full name of passenger ${i + 1}?`,
        sub: "First and last name, as on their ID.", placeholder: "e.g. Chioma Okeke", skip: draft.count > 1 ? "Skip the rest \u2014 I'll type them" : null });
      if (v === CANCEL) return abort();
      if (v === null) { draft.namesDone = true; addMsg("bot", "Okay \u2014 you can fill in the remaining names on the next page."); return advanceBooking(); }
      addMsg("user", v);
      const nm = cleanName(v);
      if (nm.split(" ").length < 2 && draft.count === 1) { addMsg("bot", "Please give me a first and last name."); return advanceBooking(); }
      if (!nm) { addMsg("bot", "I didn't catch that name \u2014 try again."); return advanceBooking(); }
      draft.names.push(nm); addMsg("bot", `Passenger ${i + 1}: ${nm}.`);
      return advanceBooking();
    }
    if (draft.count === 1 && draft.seatCode === undefined) {
      const v = await askOverlay({ title: "Want to pick a seat?", say: "Do you want to pick a seat? Say a seat like 6B, or skip.", sub: "Type a seat like 6B, or skip for free seating.", placeholder: "e.g. 6B", skip: "Skip \u2014 free seating" });
      if (v === CANCEL) return abort();
      if (v === null) { draft.seatCode = null; addMsg("bot", "Free seating it is."); return advanceBooking(); }
      addMsg("user", v);
      const m = v.match(/\b([1-8])\s*([a-d])\b/i);
      if (!m) { addMsg("bot", "That doesn't look like a seat code (row 1-8, letter A-D) \u2014 let's try again."); draft.seatCode = undefined; }
      else { draft.seatCode = (m[1] + m[2]).toUpperCase(); addMsg("bot", `Seat ${draft.seatCode} noted.`); }
      return advanceBooking();
    }
    finishBooking();
  }

  function finishBooking() {
    const bits = [`${draft.from} \u2192 ${draft.to}`, niceDate(draft.date), draft.time ? draft.time : "choose time at checkout", draft.count === 1 ? "1 ticket" : `${draft.count} tickets (seated together)`];
    if (draft.seatCode) bits.push(`seat ${draft.seatCode}`);
    addMsg("bot", `All set \u2014 taking you to checkout: ${bits.join(" \u00b7 ")}.`);
    const q = new URLSearchParams();
    q.set("from", draft.from); q.set("to", draft.to); q.set("date", draft.date);
    if (draft.time) q.set("slot", draft.time);
    if (draft.seatCode) q.set("seat", draft.seatCode);
    if (draft.count > 1 || draft.names.length) {
      const names = []; for (let i = 0; i < draft.count; i++) names.push(draft.names[i] || `Ticket ${i + 1}`);
      q.set("names", names.join("|"));
    }
    const href = "book.html?" + q.toString();
    draft = null;
    setTimeout(() => { location.href = href; }, 900);
  }

  function isBookingIntent(s) { return /\bbook\b.*\b(ticket|trip|ride|bus|seat)\b|\bbook me\b|\bi want to book\b/i.test(s); }

  // =========================================================
  // Gemini Flash Lite — TYPED questions only.
  // Voice (mic) and the booking flow never touch the key; they stay local.
  // =========================================================
  const GEMINI_KEY = "YOUR_GEMINI_API_KEY_HERE";
  const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=" + GEMINI_KEY;
  const ETC_SYS = "You are ETC Assistant, inside the Enugu Transport Corporation (ETC) passenger app in Enugu, Nigeria. Help passengers with bus routes, terminals, fares (from \u20a6500 depending on route), seats (32-seater CNG city bus, 2x2 layout, 1A/1B priority), luggage, tickets and boarding. Be concise (2-3 sentences) and friendly. If you do not know a live fact (exact fare, departure time, seats left, bus location), say so and point to the route card or booking page instead of guessing. If the passenger wants to book, tell them to say or type \"book me a ticket\".";
  const aiHistory = [];
  const AI_DEBUG = true;          // TEMP: shows why Gemini failed under the reply. Set false when fixed.
  let aiLastError = "";
  async function askGeminiText(q) {
    aiLastError = "";
    aiHistory.push({ role: "user", parts: [{ text: q }] });
    try {
      const r = await fetch(GEMINI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: aiHistory.slice(-8),
          systemInstruction: { parts: [{ text: ETC_SYS }] },
          generationConfig: { maxOutputTokens: 300, temperature: 0.6 }
        })
      });
      const d = await r.json();
      const a = d && d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts && d.candidates[0].content.parts[0].text;
      if (!a) throw new Error("HTTP " + r.status + " " + ((d && d.error && d.error.message) || (d && d.candidates && d.candidates[0] && d.candidates[0].finishReason) || "empty"));
      aiHistory.push({ role: "model", parts: [{ text: a }] });
      return a.trim();
    } catch (e) {
      aiHistory.pop();
      aiLastError = (e && e.name ? e.name + ": " : "") + (e && e.message ? e.message : String(e));
      console.warn("ETC AI text error:", aiLastError);
      return null;
    }
  }

  // =========================================================
  // handling a query (typed or spoken)
  // =========================================================
  let busy = false;
  async function handleQuery(text) {
    text = (text || "").trim();
    if (!text || busy) return;
    busy = true;
    addMsg("user", text);
    textInput.value = ""; paintInputButtons();
    const wasVoice = lastWasVoice; lastWasVoice = false;

    if (isBookingIntent(text) && !draft) {
      setMic("thinking"); setStatus("Thinking\u2026");
      const typingRow = addTyping();
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 250));
      typingRow.remove();
      setMic(null);
      const parsed = parseBookingFields(text);
      draft = { from: parsed.from || null, to: parsed.to || null, date: parsed.date || null, time: parsed.time || null, anyTime: !!parsed.anyTime, count: parsed.count || 0, names: [], namesDone: false, micCharged: wasVoice, seatCode: parsed.seatCode !== undefined ? parsed.seatCode : undefined };
      addMsg("bot", "Sure \u2014 let's get your ticket sorted.");
      busy = false;
      await advanceBooking();
      return;
    }

    setMic("thinking"); setStatus("Thinking\u2026");
    const typingRow = addTyping();
    await new Promise((r) => setTimeout(r, 450 + Math.random() * 350));
    typingRow.remove();
    let answer = null;
    if (!wasVoice) answer = await askGeminiText(text);   // typed only
    if (!answer) {
      answer = genericReply(text);                       // voice + offline fallback
      if (AI_DEBUG && !wasVoice) answer += "\n\n[AI debug v22: " + (aiLastError || "no error") + "]";
    }
    addMsg("bot", answer);
    await speak(answer);
    setMic(null);
    busy = false;
  }

  chips.addEventListener("click", (e) => {
    const b = e.target.closest(".ai-chip");
    if (b) handleQuery(b.dataset.q);
  });
  form.addEventListener("submit", (e) => { e.preventDefault(); handleQuery(textInput.value); });

  // ---------- mic (speech recognition) ----------
  let recognizing = false, recog = null;

  function showLimitOverlay() {
    UI.overlay(`
      <div class="ov-card dlg-card" role="dialog" aria-label="Voice limit reached">
        <button class="ov-close" data-close aria-label="Close">${UI.X}</button>
        <div class="ai-limit-ic">${ICON.micOff}</div>
        <h3>Sorry, you've reached your voice limit</h3>
        <p>You've used all ${LIMIT} microphone turns for the assistant on this device. You can still type your question below.</p>
        <button type="button" class="ov-btn" data-close>Got it</button>
      </div>`);
  }

  function startListening() {
    if (used >= LIMIT) { showLimitOverlay(); return; }
    if (!SR) { addMsg("bot", "Voice input isn't supported in this browser \u2014 you can type your question instead."); return; }
    used += 1;
    try { localStorage.setItem(KEY, String(used)); } catch (_) {}
    paintQuota();

    recog = new SR();
    recog.lang = "en-NG";
    recog.interimResults = false;
    recog.maxAlternatives = 1;
    recognizing = true;
    micBtn.setAttribute("aria-label", "Stop listening");
    setMic("listening"); setStatus("Listening\u2026", "listening");

    recog.onresult = (e) => { lastWasVoice = true; handleQuery(e.results[0][0].transcript); };
    recog.onerror = () => { setMic(null); };
    recog.onend = () => {
      recognizing = false;
      micBtn.setAttribute("aria-label", "Talk");
      if (micBtn.classList.contains("listening")) setMic(null);
    };
    try { recog.start(); } catch (_) { recognizing = false; }
  }
  function stopListening() { if (recog && recognizing) { try { recog.stop(); } catch (_) {} } }

  micBtn.addEventListener("click", () => {
    if (recognizing) { stopListening(); return; }
    if (used >= LIMIT) { showLimitOverlay(); return; }
    startListening();
  });

  // opening greeting
  addMsg("bot", "Hi! I'm your ETC voice assistant. Tap the mic and ask me anything about your trip \u2014 or say \u201cbook me a ticket\u201d and I'll walk you through it.");
});
