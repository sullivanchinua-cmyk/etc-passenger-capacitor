// =========================================================
// Booking screen
//   tickets · family trip · luggage · seats · confirm
// v6: departure time → seats (labelled per bus) → Paystack checkout (dummy) → tickets + QR
// =========================================================
(function () {
  const $ = (id) => document.getElementById(id);
  const UI = window.ETC_UI, ICON = window.ETC_ICONS, B = window.ETC_BOOK, P = window.ETC_PLACES;
  const naira = window.etcNaira, esc = UI.esc;
  const q = new URLSearchParams(location.search);
  // Persist travel date from route details (date picker)
  (function () {
    const d = q.get("date");
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
      try { localStorage.setItem("etc_travel_date", d); } catch (_) {}
    }
  })();
  let from = q.get("from") || "Holy Ghost";
  let to = q.get("to") || "Emene";
  const fareOf = () => { const f = window.etcFare(from, to); return f != null ? f : 500; };
  // departure time chosen on the route page (?slot=07:30 AM). Each time has its own buses/occupancy.
  let slot = window.ETC_Slots.find(q.get("slot"));
  const routeKey = () => `${from}>${to}${slot ? "@" + slot.time : ""}`;

  // ---------- booking state ----------
  const st = {
    mode: "individual",                 // "individual" | "family"
    tickets: ["Ticket 1"],
    family: { name: "", members: [] },
    std: {},                            // luggage id -> qty
    custom: [],                         // [{name, size, space}]
    seats: [],                          // ["1:3A", …]
  };
  // names handed off from the AI assistant (?names=Chioma Okeke|Ada Eze|Ticket 3)
  {
    const nm = (q.get("names") || "").split("|").map((s) => s.trim()).filter(Boolean).slice(0, B.ticketMax);
    if (nm.length) st.tickets = nm;
  }
  // pre-selected seat handed off from the AI assistant (?seat=6B) — only valid once a time is
  // known, since seats are assigned per bus/departure.
  {
    const seatQ = (q.get("seat") || "").trim().toUpperCase();
    if (slot && /^[1-8][A-D]$/.test(seatQ)) st.seats = [`1:${seatQ}`];
  }
  const count = () => (st.mode === "family" ? st.family.members.length : st.tickets.length);
  const busesNeeded = () => (st.mode === "family" ? 1 : window.etcBusesFor(routeKey(), count(), false));   // a family shares one bus, one trunk
  const trunkCap = () => B.trunkPerBus * busesNeeded();
  const stdSpace = (id) => window.ETC_LUGGAGE.find((x) => x.id === id).space;
  const lugUsed = () => Object.keys(st.std).reduce((s, id) => s + (st.std[id] || 0) * stdSpace(id), 0) + st.custom.reduce((s, c) => s + c.space, 0);
  const lugItems = () => Object.values(st.std).reduce((s, n) => s + (n || 0), 0) + st.custom.length;
  const lugFee = () => lugUsed() * B.luggageUnitFee;
  const total = () => count() * fareOf() + lugFee();
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

  // luggage that no longer fits (fewer tickets → fewer buses → smaller trunk) is dropped
  function fitLuggage() {
    let dropped = false;
    while (lugUsed() > trunkCap()) {
      dropped = true;
      if (st.custom.length) st.custom.pop();
      else { const id = Object.keys(st.std).reverse().find((k) => st.std[k] > 0); st.std[id]--; }
    }
    if (dropped) UI.toast("Some luggage was removed to fit the trunk");
  }

  // ---------- main screen ----------
  const label = (n) => n + (P[n] && P[n].terminal ? " Terminal" : "");
  function render() {
    $("fromName").textContent = label(from);
    $("toName").textContent = label(to);

    const sv = $("slotVal");
    $("slotIcon").innerHTML = ICON[slot ? { morning: "sunrise", afternoon: "sun", evening: "moon" }[slot.session] : "clock"];
    { const sv0 = $("slotIcon").firstChild; if (sv0 && sv0.setAttribute) { sv0.setAttribute("width", "30"); sv0.setAttribute("height", "30"); } }
    sv.innerHTML = slot ? `<b>${esc(slot.time)}</b> · ${esc(slot.sessionName)}` : `Choose a <b>time</b>`;

    const n = count();
    const tk = $("tkSummary");
    if (st.mode === "family") {
      tk.hidden = false;
      tk.innerHTML = `${ICON.users}<span>Family trip · ${plural(n, "member")}</span><span class="m">names are set in Family trip</span>`;
    } else if (n > 1) {
      tk.hidden = false;
      tk.innerHTML = `${ICON.ticket}<span>${plural(n, "ticket")} added</span><span class="m">${esc(st.tickets.slice(0, 2).join(", "))}${n > 2 ? "…" : ""}</span>`;
    } else tk.hidden = true;

    $("seatSub").innerHTML = st.seats.length
      ? `<b>${plural(st.seats.length, "seat")}</b> chosen${st.seats.length < n ? " · rest free seating" : ""}`
      : `From <b>${naira(fareOf())}</b>`;
    $("lugSub").innerHTML = lugItems() ? `<b>${plural(lugItems(), "item")}</b> · ${naira(lugFee())}` : `From <b>${naira(B.luggageUnitFee)}</b>`;
    $("famSub").textContent = st.mode === "family"
      ? `${st.family.name ? st.family.name + " · " : ""}${plural(n, "member")} · one bus`
      : "Everyone seated together on one bus";
    $("bookBtn").textContent = `Book ${plural(n, "ticket")} at ${naira(total())}`;
  }

  // ---------- tickets overlay ----------
  function openTickets() {
    const names = st.mode === "individual" ? st.tickets.slice() : ["Ticket 1"];
    const ui = UI.overlay(`
      <div class="ov-card" role="dialog" aria-label="Add tickets">
        <button class="ov-close" data-close aria-label="Close">${UI.X}</button>
        <h3 class="ov-title">Add tickets</h3>
        <p class="ov-sub">${esc(label(from))} → ${esc(label(to))} · ${naira(fareOf())} per ticket</p>
        <div class="stepper-box"><span class="lbl">How many tickets?</span>
          <div class="stepper"><button type="button" id="tMinus" aria-label="Fewer tickets">${ICON.minus}</button><span class="q" id="tQ">1</span><button type="button" id="tPlus" aria-label="More tickets">${ICON.plus}</button></div></div>
        <p class="field-lbl">Ticket names</p>
        <div class="tk-scroll" id="tList"></div>
        <div class="ov-foot">
          <div class="ov-total"><span id="tCalc"></span><b id="tTotal"></b></div>
          <button type="button" class="ov-btn" id="tSave">Save tickets</button>
        </div>
      </div>`);
    const el = ui.el, list = el.querySelector("#tList");
    const row = (i) => {
      const r = document.createElement("div"); r.className = "tk-row";
      r.innerHTML = `<span class="i">${i + 1}</span><input type="text" maxlength="24" value="${esc(names[i])}" placeholder="Ticket ${i + 1}" aria-label="Name for ticket ${i + 1}" /><span class="p">${naira(fareOf())}</span>`;
      const inp = r.querySelector("input");
      inp.addEventListener("input", () => (names[i] = inp.value));
      inp.addEventListener("blur", () => { if (!inp.value.trim()) { inp.value = `Ticket ${i + 1}`; names[i] = inp.value; } });
      inp.addEventListener("focus", () => inp.select());
      return r;
    };
    names.forEach((_, i) => list.appendChild(row(i)));
    function sync(bump) {
      const n = names.length;
      el.querySelector("#tQ").textContent = n;
      el.querySelector("#tMinus").disabled = n <= 1;
      el.querySelector("#tPlus").disabled = n >= B.ticketMax;
      el.querySelector("#tCalc").textContent = `${plural(n, "ticket")} × ${naira(fareOf())}`;
      const t = el.querySelector("#tTotal"); t.textContent = naira(n * fareOf());
      if (bump) { t.classList.remove("pulse"); void t.offsetWidth; t.classList.add("pulse"); }
    }
    el.querySelector("#tPlus").onclick = () => { if (names.length >= B.ticketMax) return; names.push(`Ticket ${names.length + 1}`); const r = row(names.length - 1); list.appendChild(r); r.scrollIntoView({ block: "nearest" }); sync(true); };
    el.querySelector("#tMinus").onclick = () => { if (names.length <= 1) return; names.pop(); list.lastElementChild.remove(); sync(true); };
    el.querySelector("#tSave").onclick = () => {
      const cleaned = names.map((n, i) => (n.trim() ? n.trim() : `Ticket ${i + 1}`));
      const was = count(), wasMode = st.mode;
      st.mode = "individual"; st.tickets = cleaned;
      if (wasMode !== "individual" || cleaned.length < st.seats.length || cleaned.length !== was) st.seats = wasMode !== "individual" ? [] : st.seats.slice(0, cleaned.length);
      fitLuggage(); render(); ui.close();
      if (wasMode !== "individual" || cleaned.length !== was) {
        st.seatsManual = false;
        if (cleaned.length < 2 && window.ETC_Occupancy) { try { window.ETC_Occupancy.releaseAllForSession(routeKey(), travelDate()); } catch (_) {} }
        autoSeats();
      }
    };
    sync(false);
  }

  // ---------- family trip overlay ----------
  function openFamily() {
    const fam = st.mode === "family";
    const names = fam ? st.family.members.slice() : ["Member 1", "Member 2"];
    let famName = fam ? st.family.name : "";
    const ui = UI.overlay(`
      <div class="ov-card" role="dialog" aria-label="Family trip">
        <button class="ov-close" data-close aria-label="Close">${UI.X}</button>
        <h3 class="ov-title">Family trip</h3>
        <p class="ov-sub">${esc(label(from))} → ${esc(label(to))} · ${naira(fareOf())} per member</p>
        <p class="field-lbl">Family name</p>
        <input class="text-in" id="fName" type="text" maxlength="28" placeholder="e.g. Ezeugo family" value="${esc(famName)}" />
        <div class="stepper-box"><span class="lbl">Family members</span>
          <div class="stepper"><button type="button" id="fMinus" aria-label="Fewer members">${ICON.minus}</button><span class="q" id="fQ">2</span><button type="button" id="fPlus" aria-label="More members">${ICON.plus}</button></div></div>
        <p class="field-lbl">Member names</p>
        <div class="tk-scroll" id="fList"></div>
        <p class="ov-note">Family trips are seated together on one bus. If Bus 1 can’t hold everyone, we’ll ask before moving you to the next bus.</p>
        <div class="ov-foot">
          <div class="ov-total"><span id="fCalc"></span><b id="fTotal"></b></div>
          <button type="button" class="ov-btn" id="fSave">Save family trip</button>
          ${fam ? `<button type="button" class="ov-btn ghost" id="fRemove">Remove family trip</button>` : ""}
        </div>
      </div>`);
    const el = ui.el, list = el.querySelector("#fList");
    el.querySelector("#fName").addEventListener("input", (e) => (famName = e.target.value));
    const row = (i) => {
      const r = document.createElement("div"); r.className = "tk-row";
      r.innerHTML = `<span class="i">${i + 1}</span><input type="text" maxlength="24" value="${esc(names[i])}" placeholder="Member ${i + 1}" aria-label="Name of member ${i + 1}" /><span class="p">${naira(fareOf())}</span>`;
      const inp = r.querySelector("input");
      inp.addEventListener("input", () => (names[i] = inp.value));
      inp.addEventListener("blur", () => { if (!inp.value.trim()) { inp.value = `Member ${i + 1}`; names[i] = inp.value; } });
      inp.addEventListener("focus", () => inp.select());
      return r;
    };
    names.forEach((_, i) => list.appendChild(row(i)));
    function sync(bump) {
      const n = names.length;
      el.querySelector("#fQ").textContent = n;
      el.querySelector("#fMinus").disabled = n <= B.familyMin;
      el.querySelector("#fPlus").disabled = n >= B.familyMax;
      el.querySelector("#fCalc").textContent = `${plural(n, "member")} × ${naira(fareOf())}`;
      const t = el.querySelector("#fTotal"); t.textContent = naira(n * fareOf());
      if (bump) { t.classList.remove("pulse"); void t.offsetWidth; t.classList.add("pulse"); }
    }
    el.querySelector("#fPlus").onclick = () => { if (names.length >= B.familyMax) return; names.push(`Member ${names.length + 1}`); const r = row(names.length - 1); list.appendChild(r); r.scrollIntoView({ block: "nearest" }); sync(true); };
    el.querySelector("#fMinus").onclick = () => { if (names.length <= B.familyMin) return; names.pop(); list.lastElementChild.remove(); sync(true); };
    el.querySelector("#fSave").onclick = () => {
      st.mode = "family"; st.family = { name: famName.trim(), members: names.map((n, i) => (n.trim() ? n.trim() : `Member ${i + 1}`)) };
      st.seats = []; fitLuggage(); render(); ui.close();
    };
    const rm = el.querySelector("#fRemove");
    if (rm) rm.onclick = () => { st.mode = "individual"; st.family = { name: "", members: [] }; st.seats = []; if (!st.tickets.length) st.tickets = ["Ticket 1"]; fitLuggage(); render(); ui.close(); };
    sync(false);
  }

  // ---------- shared trunk (Firestore, per bus / date / time) ----------
  let remoteTrunkUsed = 0; // space already taken by other bookings on this bus
  function busTrunkKey() {
    let date = null;
    try { date = localStorage.getItem("etc_travel_date"); } catch (_) {}
    const bus = st.seats.length ? st.seats[0].split(":")[0] : "1";
    const time = (slot && slot.time) || "anytime";
    return [date || "any", from, to, bus, time].join("_").replace(/\s+/g, "");
  }
  async function refreshRemoteTrunk() {
    remoteTrunkUsed = 0;
    if (!window.ETC_FB || !window.ETC_FB.db) return;
    try {
      await Promise.race([
        window.ETC_FB.ensureAuth(),
        new Promise(function (_, rej) { setTimeout(function () { rej(new Error("auth-timeout")); }, 2500); }),
      ]);
      let date = null;
      try { date = localStorage.getItem("etc_travel_date"); } catch (_) {}
      if (!date) {
        const n = new Date();
        date = n.getFullYear() + "-" + String(n.getMonth()+1).padStart(2,"0") + "-" + String(n.getDate()).padStart(2,"0");
      }
      const strip = (s) => String(s || "").replace(/\s+Terminal$/i, "").trim().toLowerCase();
      const wantFrom = strip(from), wantTo = strip(to);
      // date-only query (avoids composite index); filter client-side
      const snap = await window.ETC_FB.db.collection("tickets")
        .where("date", "==", date)
        .limit(120)
        .get();
      const busNo = st.seats.length ? +st.seats[0].split(":")[0] : 1;
      const time = slot && slot.time;
      const normT = (x) => {
        if (!x) return "";
        let s = String(x).trim().toUpperCase().replace(/\s+/g, " ").replace(/(\d)(AM|PM)$/i, "$1 $2");
        return s;
      };
      snap.forEach((doc) => {
        const t = doc.data();
        if (strip(t.from) !== wantFrom) return;
        if (wantTo && t.to && strip(t.to) !== wantTo) return;
        if (time && t.time && normT(t.time) !== normT(time)) return;
        const bn = t.bus != null ? +t.bus : (t.busNo != null ? +t.busNo : 1);
        if (bn !== busNo) return;
        remoteTrunkUsed += Number(t.luggageSpace || t.luggage || 0);
      });
    } catch (e) { console.warn("[ETC trunk]", e); }
  }
  function effectiveTrunkCap() {
    // capacity minus what others already booked (not counting this draft)
    return Math.max(0, trunkCap() - remoteTrunkUsed);
  }

  // ---------- luggage overlay ----------
  async function openLuggage() {
    await refreshRemoteTrunk();
    const ui = UI.overlay(`
      <div class="ov-card" role="dialog" aria-label="Additional luggage">
        <button class="ov-close" data-close aria-label="Close">${UI.X}</button>
        <h3 class="ov-title">Additional luggage</h3>
        <p class="ov-sub">Pick what you’re bringing. Space in the trunk is limited.</p>
        <div class="trunk" id="trunk"><div class="row"><span>Trunk space</span><span id="trTxt"></span></div><div class="bar"><i id="trBar"></i></div></div>
        <div class="tk-scroll" style="max-height:44dvh">
          <div class="lug-grid" id="lugGrid"></div>
        </div>
        <p class="lug-full" id="lugFull" hidden>Trunk is full — remove something to add more.</p>
        <div class="ov-foot">
          <div class="ov-total"><span id="lCalc"></span><b id="lTotal"></b></div>
          <button type="button" class="ov-btn" id="lDone">Done</button>
        </div>
      </div>`);
    const el = ui.el, grid = el.querySelector("#lugGrid");
    let size = "M";

    // ---- built ONCE: the grid is never torn down on a tap (that rebuild was the flicker) ----
    grid.innerHTML = window.ETC_LUGGAGE.map((it) => `<div class="lug" data-lug="${it.id}"><div class="top"><span class="ic">${ICON[it.icon]}</span><div><p class="nm">${it.name}</p><p class="mt">${it.space} space · ${naira(it.space * B.luggageUnitFee)}</p></div></div>
          <div class="stepper"><button type="button" data-a="-" data-id="${it.id}" disabled aria-label="Remove ${it.name}">${ICON.minus}</button><span class="q">0</span><button type="button" data-a="+" data-id="${it.id}" aria-label="Add ${it.name}">${ICON.plus}</button></div></div>`).join("") + `
        <div class="lug custom-add"><div class="top"><span class="ic">${ICON.custom}</span><div><p class="nm">Custom item</p><p class="mt">Anything else — name it and pick a size</p></div></div>
          <input class="text-in" id="cName" style="margin:6px 0 0" type="text" maxlength="24" placeholder="e.g. Generator, Bag of rice" />
          <div class="size-seg">${window.ETC_SIZES.map((s) => `<button type="button" data-size="${s.k}" class="${s.k === size ? "on" : ""}">${s.label} · ${s.space}</button>`).join("")}</div>
          <button type="button" class="ov-btn" id="cAdd" style="height:44px">Add item</button>
          <div class="cust-list" id="custList"></div>
        </div>`;
    const rows = {};                       // id -> { q, minus, plus }
    grid.querySelectorAll("[data-lug]").forEach((row) => {
      rows[row.dataset.lug] = { q: row.querySelector(".q"), minus: row.querySelector('[data-a="-"]'), plus: row.querySelector('[data-a="+"]') };
    });
    const custList = grid.querySelector("#custList");
    const refs = {
      trTxt: el.querySelector("#trTxt"), trBar: el.querySelector("#trBar"), trunk: el.querySelector("#trunk"),
      full: el.querySelector("#lugFull"), calc: el.querySelector("#lCalc"), total: el.querySelector("#lTotal"), add: grid.querySelector("#cAdd")
    };
    const setText = (n, v) => { if (n.textContent !== v) n.textContent = v; };      // touch the DOM only when something really changed
    const setDis = (n, v) => { if (n.disabled !== v) n.disabled = v; };

    let custKey = null;
    function paintCustom() {
      const key = JSON.stringify(st.custom);
      if (key === custKey) return;
      custKey = key;
      custList.innerHTML = st.custom.map((c, i) => `<div class="ci"><span>${esc(c.name)}</span><span style="color:#8A8C90;font-weight:600">${c.space} · ${naira(c.space * B.luggageUnitFee)}</span><button type="button" data-rm="${i}" aria-label="Remove ${esc(c.name)}">${ICON.close}</button></div>`).join("");
    }

    // updates numbers / disabled states IN PLACE - no innerHTML, no re-created nodes, no re-layout of the grid
    function paint() {
      const mine = lugUsed();
      const totalCap = trunkCap();
      const totalUsed = Math.min(totalCap, (remoteTrunkUsed || 0) + mine);
      const left = Math.max(0, totalCap - totalUsed);
      window.ETC_LUGGAGE.forEach((it) => {
        const r = rows[it.id], qn = st.std[it.id] || 0;
        setText(r.q, String(qn));
        setDis(r.minus, !qn);
        setDis(r.plus, it.space > left);
      });
      paintCustom();
      setText(refs.trTxt, totalCap
        ? `${totalUsed} of ${totalCap} used` + (remoteTrunkUsed ? ` (${remoteTrunkUsed} by other passengers)` : "")
        : "0 of 0 used");
      refs.trBar.style.transform = "scaleX(" + (totalCap ? Math.min(1, totalUsed / totalCap) : 0) + ")";   // compositor-only (was width)
      refs.trunk.classList.toggle("full", left <= 0);
      if (refs.full.hidden !== (left > 0)) refs.full.hidden = left > 0;
      setText(refs.calc, plural(lugItems(), "item"));
      setText(refs.total, naira(lugFee()));
      setDis(refs.add, left < 1);
    }
    // the booking page behind the overlay refreshes on the next frame, after the overlay has already painted
    let renderQ = 0;
    const renderSoon = () => { if (renderQ) return; renderQ = requestAnimationFrame(() => { renderQ = 0; render(); }); };

    grid.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b || b.disabled) return;
      if (b.dataset.a) {
        const id = b.dataset.id, sp = stdSpace(id);
        if (b.dataset.a === "+") { if (lugUsed() + sp <= effectiveTrunkCap()) st.std[id] = (st.std[id] || 0) + 1; }
        else st.std[id] = Math.max(0, (st.std[id] || 0) - 1);
        paint(); renderSoon();
      } else if (b.dataset.size) { size = b.dataset.size; grid.querySelectorAll("[data-size]").forEach((x) => x.classList.toggle("on", x.dataset.size === size)); }
      else if (b.dataset.rm !== undefined) { st.custom.splice(+b.dataset.rm, 1); paint(); renderSoon(); }
      else if (b.id === "cAdd") {
        const sp = window.ETC_SIZES.find((s) => s.k === size).space;
        if (lugUsed() + sp > effectiveTrunkCap()) { UI.toast(remoteTrunkUsed ? "Trunk is full for this bus" : "Not enough trunk space for that size"); return; }
        const inp = grid.querySelector("#cName");
        const nm = (inp.value || "").trim() || "Custom item";
        st.custom.push({ name: nm, size, space: sp }); inp.value = ""; paint(); renderSoon();
      }
    });
    el.querySelector("#lDone").onclick = ui.close;
    paint();
  }

  // ---------- seats ----------
  function pickSlot(then) {
    let curDate = null;
    try { curDate = localStorage.getItem("etc_travel_date"); } catch (_) {}
    window.ETC_Slots.openDateThenTime({
      from: label(from), to: label(to),
      date: curDate,
      selected: slot && slot.time,
      cta: then ? "Continue" : "Save",
      allowSkip: false,
      onDone: ({ date, slot: c }) => {
        if (date) {
          try { localStorage.setItem("etc_travel_date", date); } catch (_) {}
          const u = new URL(location.href);
          u.searchParams.set("date", date);
          history.replaceState(null, "", u);
        }
        if (!c) return;
        if (!slot || slot.time !== c.time) { st.seats = []; }
        slot = c; render(); st.seatsManual = false; autoSeats();
        const u2 = new URL(location.href); u2.searchParams.set("slot", c.time); history.replaceState(null, "", u2);
        if (then) then();
      },
    });
  }
  // no time chosen yet ("Any time") → seats can't be picked (each departure time has its own
  // buses), so explain that instead of silently forcing the time picker open.
  function seatsNeedTime() {
    const ui = UI.overlay(`
      <div class="ov-card dlg-card" role="dialog" aria-label="Choose a departure time">
        <button class="ov-close" data-close aria-label="Close">${UI.X}</button>
        <div class="seal">${ICON.clock}</div>
        <h3>Choose a departure time first</h3>
        <p>Seats are assigned per bus, and each departure time has its own buses. Pick a time to see and choose your seat.</p>
        <button type="button" class="ov-btn" id="seatTimeGo">Choose departure time</button>
      </div>`);
    ui.el.querySelector("#seatTimeGo").addEventListener("click", () => { ui.close(); setTimeout(() => pickSlot(), 180); });
  }

  // ---------- multi-ticket bookings: seat everyone TOGETHER automatically ----------
  // adjacent seats (row by row), all on one bus when it fits; the passenger can still open "Select your seats" to change them.
  let autoTimer = 0, autoRun = 0;
  function autoSeats() {
    clearTimeout(autoTimer);
    autoTimer = setTimeout(async () => {
      const n = count();
      if (st.mode !== "individual" || !slot || n < 2 || st.seatsManual || !window.ETC_Seats || !window.ETC_Seats.autoAssign) return;
      const run = ++autoRun;
      let list = [];
      try { list = await window.ETC_Seats.autoAssign({ count: n, routeKey: routeKey() }); } catch (_) {}
      if (run !== autoRun || st.mode !== "individual" || count() !== n || st.seatsManual) return;
      st.seats = list; render();
      UI.toast(list.length >= n ? `${n} seats picked together` : "Not enough seats together – the rest will be free seating");
    }, 250);
  }

  function openSeats() {
    if (!slot) { seatsNeedTime(); return; }
    window.ETC_Seats.open({
      count: count(), mode: st.mode, routeKey: routeKey(), selected: st.seats, slot,
      onDone: (list) => {
        const prevBus = st.seats.length ? String(st.seats[0]).split(":")[0] : null;
        st.seatsManual = true;   // passenger chose by hand – stop auto-seating
        st.seats = list;
        const newBus = list.length ? String(list[0]).split(":")[0] : null;
        // Bus changed → luggage capacity is for the new bus; drop overflow + refresh remote trunk
        if (prevBus && newBus && prevBus !== newBus) {
          remoteTrunkUsed = 0;
          fitLuggage();
          UI.toast("Luggage capacity follows the new bus");
        }
        render();
      },
    });
  }


  // ---------- require local login before booking ----------
  function isPassengerLoggedIn() {
    if (window.ETC_Profile && window.ETC_Profile.isLoggedIn) return window.ETC_Profile.isLoggedIn();
    try {
      const u = JSON.parse(localStorage.getItem("etc_user") || "null");
      return !!(u && u.name && u.unlocked !== false);
    } catch (_) { return false; }
  }

  /** Glass login / sign-up gate (works on book page without profile DOM) */
  function openBookLoginGate() {
    const ICON = window.ETC_ICONS || {};
    const USER_KEY = "etc_user";
    const readUser = () => { try { return JSON.parse(localStorage.getItem(USER_KEY) || "null"); } catch (_) { return null; } };
    const saveUser = (u) => { try { localStorage.setItem(USER_KEY, JSON.stringify(u)); } catch (_) {} };

    function showChoice() {
      const ui = UI.overlay(`
        <div class="alarm-card glass-card book-login-card" role="dialog" aria-label="Login required" style="width:100%">
          <button type="button" class="ov-close" data-close aria-label="Close">${UI.X || "×"}</button>
          <img class="login-lock" src="assets/lock.gif" alt="" width="72" height="72" style="display:block;margin:0 auto 12px" />
<h3>Login to book</h3>
          <p class="alarm-sub">Sign in or create an account to continue.</p>
          <button type="button" class="alarm-btn primary" id="bkLgIn" style="width:100%;margin-bottom:8px">Log in</button>
          <button type="button" class="alarm-btn" id="bkLgUp" style="width:100%">Sign up</button>
        </div>`, { sticky: true, cls: "sheet-ov" });
      ui.el.querySelector("#bkLgIn").onclick = () => { ui.close(); setTimeout(showLogin, 180); };
      ui.el.querySelector("#bkLgUp").onclick = () => { ui.close(); setTimeout(showSignup, 180); };
    }

    function showSignup() {
      const ui = UI.overlay(`
        <div class="alarm-card glass-card" role="dialog" aria-label="Create account" style="max-width:340px;width:100%">
          <button type="button" class="ov-close" data-close aria-label="Close">${UI.X || "×"}</button>
          <div class="alarm-date">Create account</div>
          <p class="alarm-sub">Email + 6-digit passcode</p>
          <label class="alarm-field"><span>Name</span><input type="text" id="bkName" placeholder="Your name" autocomplete="name"/></label>
          <label class="alarm-field"><span>Email</span><input type="email" id="bkEmail" placeholder="you@email.com" autocomplete="email"/></label>
          <label class="alarm-field"><span>Passcode (6 digits)</span><input type="password" id="bkCode" inputmode="numeric" maxlength="6" placeholder="••••••" autocomplete="new-password"/></label>
          <p id="bkErr" style="color:#c00;font-size:12px;font-weight:600;min-height:16px;margin:4px 0 0"></p>
          <button type="button" class="alarm-btn primary" id="bkGo" style="width:100%;margin-top:8px">Create account</button>
          <button type="button" class="alarm-btn" id="bkBack" style="width:100%;margin-top:8px">Back</button>
        </div>`, { sticky: true, cls: "sheet-ov" });
      ui.el.querySelector("#bkBack").onclick = () => { ui.close(); setTimeout(showChoice, 180); };
      ui.el.querySelector("#bkGo").onclick = async () => {
        const name = (ui.el.querySelector("#bkName").value || "").trim() || "Rider";
        const email = (ui.el.querySelector("#bkEmail").value || "").trim().toLowerCase();
        const code = (ui.el.querySelector("#bkCode").value || "").trim();
        const err = ui.el.querySelector("#bkErr");
        if (!email || !email.includes("@")) { err.textContent = "Enter a valid email"; return; }
        if (!/^\d{6}$/.test(code)) { err.textContent = "Passcode must be 6 digits"; return; }
        // Firebase: already used?
        if (window.ETC_FB && window.ETC_FB.auth) {
          try {
            const methods = await window.ETC_FB.auth.fetchSignInMethodsForEmail(email);
            if (methods && methods.length) { err.textContent = "Account already used — Log in"; return; }
          } catch (_) {}
        }
        const data = {
          name, email, security: "passcode", passcode: code, unlocked: true,
          avatar: "https://i.pravatar.cc/128?u=" + encodeURIComponent(email)
        };
        saveUser(data);
        if (window.ETC_FB && window.ETC_FB.linkEmailPassword) {
          try {
            const fu = await window.ETC_FB.linkEmailPassword(email, code);
            data.firebaseUid = fu.uid; saveUser(data);
          } catch (e) {
            if (e && (e.code === "auth/email-already-in-use" || e.code === "auth/credential-already-in-use")) {
              err.textContent = "Account already used — Log in"; return;
            }
          }
        }
        ui.close();
        UI.toast("Account created — tap Book again");
        if (window.ETC_Tickets && window.ETC_Tickets.pullMyTickets) window.ETC_Tickets.pullMyTickets().catch(function(){});
      };
    }

    function showLogin() {
      const existing = readUser();
      const ui = UI.overlay(`
        <div class="alarm-card glass-card" role="dialog" aria-label="Log in" style="max-width:340px;width:100%">
          <button type="button" class="ov-close" data-close aria-label="Close">${UI.X || "×"}</button>
          <div class="alarm-date">Log in</div>
          <p class="alarm-sub">${existing && existing.email ? "Welcome back" : "Enter your email and passcode"}</p>
          <label class="alarm-field"><span>Email</span><input type="email" id="bkEmail" value="${existing && existing.email ? UI.esc(existing.email) : ""}" placeholder="you@email.com" autocomplete="email"/></label>
          <label class="alarm-field"><span>Passcode</span><input type="password" id="bkCode" inputmode="numeric" maxlength="6" placeholder="••••••" autocomplete="current-password"/></label>
          <p id="bkErr" style="color:#c00;font-size:12px;font-weight:600;min-height:16px;margin:4px 0 0"></p>
          <button type="button" class="alarm-btn primary" id="bkGo" style="width:100%;margin-top:8px">Log in</button>
          <button type="button" class="alarm-btn" id="bkBack" style="width:100%;margin-top:8px">Back</button>
        </div>`, { sticky: true, cls: "sheet-ov" });
      ui.el.querySelector("#bkBack").onclick = () => { ui.close(); setTimeout(showChoice, 180); };
      ui.el.querySelector("#bkGo").onclick = async () => {
        const email = (ui.el.querySelector("#bkEmail").value || "").trim().toLowerCase();
        const code = (ui.el.querySelector("#bkCode").value || "").trim();
        const err = ui.el.querySelector("#bkErr");
        let u = readUser();
        if (u && u.email && u.email.toLowerCase() === email && u.passcode === code) {
          u.unlocked = true; saveUser(u);
          if (window.ETC_FB && window.ETC_FB.signInEmailPassword) {
            try { await window.ETC_FB.signInEmailPassword(email, code); } catch (_) {}
          }
          ui.close();
          UI.toast("Welcome back — tap Book again");
        if (window.ETC_Tickets && window.ETC_Tickets.pullMyTickets) window.ETC_Tickets.pullMyTickets().catch(function(){});
          return;
        }
        // Try Firebase then save local session
        if (window.ETC_FB && window.ETC_FB.signInEmailPassword) {
          try {
            const fu = await window.ETC_FB.signInEmailPassword(email, code);
            saveUser({
              name: (u && u.name) || email.split("@")[0],
              email, security: "passcode", passcode: code, unlocked: true,
              firebaseUid: fu.uid,
              avatar: "https://i.pravatar.cc/128?u=" + encodeURIComponent(email)
            });
            ui.close();
            UI.toast("Logged in — tap Book again");
        if (window.ETC_Tickets && window.ETC_Tickets.pullMyTickets) window.ETC_Tickets.pullMyTickets().catch(function(){});
            return;
          } catch (e) {
            err.textContent = "Incorrect email or passcode";
            return;
          }
        }
        err.textContent = "Incorrect email or passcode";
      };
    }

    showChoice();
  }

  function requirePassengerLogin() {
    if (isPassengerLoggedIn()) return true;
    openBookLoginGate();
    return false;
  }

  // ---------- book → pay → tickets ----------
  const passengerNames = () => {
    const raw = st.mode === "family" ? st.family.members.slice() : st.tickets.slice();
    const first = ($("pFirst").value || "").trim(), last = ($("pLast").value || "").trim(), full = `${first} ${last}`.trim();
    if (st.mode === "individual" && full && /^Ticket 1$/i.test(raw[0])) raw[0] = full;     // primary passenger typed above
    return raw;
  };
  const travelDate = () => {
    let d = null;
    try { d = localStorage.getItem("etc_travel_date"); } catch (_) {}
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    // Local calendar day (avoid UTC shift near midnight in WAT)
    const n = new Date();
    return n.getFullYear() + "-" + String(n.getMonth() + 1).padStart(2, "0") + "-" + String(n.getDate()).padStart(2, "0");
  };

  // ---------- confirm booking overlay ----------
  function confirmBooking(then) {
    const n = count(), t = total();
    const busNum = st.seats.length ? st.seats[0].split(":")[0] : "1";
    const seatLine = st.seats.length ? `${plural(st.seats.length, "seat")} chosen` : "Free seating (no seats chosen)";
    const timeLine = slot ? `${esc(slot.sessionName.split(" ")[0])} · ${esc(slot.time)} · Bus ${esc(busNum)}` : "Any time";
    const ui = UI.overlay(`
      <div class="ov-card dlg-card" role="dialog" aria-label="Confirm booking">
        <div class="seal">${ICON.ticket}</div>
        <h3>Confirm booking</h3>
        <p>Are you sure you want to book ${plural(n, "ticket")} at ${naira(t)}?</p>
        <p class="lines">${timeLine}<br>${esc(seatLine)}</p>
        <button type="button" class="ov-btn" id="cfGo">Continue</button>
        <button type="button" class="ov-btn ghost" id="cfNo">Cancel</button>
      </div>`, { sticky: true });
    ui.el.querySelector("#cfGo").addEventListener("click", () => { ui.close(); setTimeout(then, 180); });
    ui.el.querySelector("#cfNo").addEventListener("click", ui.close);
  }

  function startPayment() {
    if (!requirePassengerLogin()) return;
    confirmBooking(openPayment);
  }
  function openPayment() {
    const n = count(), t = total(), names = passengerNames(), date = travelDate();
    const timeKey = slot ? slot.time : "any";
    const id = window.ETC_Tokens.sha256hex(JSON.stringify({ from, to, slot: timeKey, names, seats: st.seats, t, date, lug: lugItems() })).slice(0, 16);
    const summaryTime = slot ? `${slot.time} · ${slot.sessionName}` : "Any time";
    window.ETC_Pay.open({
      order: { id, amount: t, description: `${label(from)} → ${label(to)}`, summary: `${summaryTime} · ${plural(n, "ticket")}${st.seats.length ? " · " + plural(st.seats.length, "seat") : ""}${lugItems() ? " · luggage" : ""}` },
      onSuccess: async (result) => {
        // Create ticket immediately — no network awaits before issue
        const tid = (result.reference || "ETC") + "-1";
        let tickets = null;
        try {
          tickets = await window.ETC_Tickets.issue({
            reference: result.reference, from: label(from), to: label(to), date, slot, names, seatNumbers: st.seats,
            family: st.mode === "family" ? st.family.name || true : false, fare: fareOf(), amount: fareOf(), total: t,
            method: result.method, paidAt: result.paidAt, email: result.email, luggageItems: lugItems(), luggageFee: lugFee(), luggageSpace: lugUsed(),
          });
        } catch (e) {
          console.warn("[ETC book] issue", e);
        }
        try {
          if (window.ETC_Occupancy && window.ETC_Occupancy.markSeatsTaken) {
            window.ETC_Occupancy.markSeatsTaken(routeKey(), st.seats || []);
          }
        } catch (_) {}
        try { saveBooking(result.reference, n, t, names, date); } catch (_) {}
        const id = (tickets && tickets[0] && tickets[0].id) || tid;
        return { url: "ticket.html?id=" + encodeURIComponent(id) };
      },
    });
  }
  function saveBooking(reference, n, t, names, date) {
    let list = [];
    try { list = JSON.parse(localStorage.getItem("etc_booked_tickets")) || []; } catch (_) {}
    if (list.some((x) => x.reference === reference)) return;              // paid twice-detected → one entry
    list.unshift({
      reference, from, to, date, seats: n, amount: t, time: slot && slot.time, session: slot && slot.sessionName,
      names, family: st.mode === "family" ? st.family.name || true : false,
      seatNumbers: st.seats, luggageItems: lugItems(),
    });
    try { localStorage.setItem("etc_booked_tickets", JSON.stringify(list)); } catch (_) {}
  }

  // ---------- wire up ----------
  $("seatIcon").innerHTML = ICON.seats;
  $("lugIcon").innerHTML = ICON.luggage;
  $("famIcon").innerHTML = ICON.users;
  ["chev1", "chev2", "chev3", "slotChg"].forEach((id) => ($(id).innerHTML = ICON.chev));
  ["lugIcon", "famIcon"].forEach((id) => { const s = $(id).firstChild; s.setAttribute("width", "28"); s.setAttribute("height", "28"); });
  $("addTickets").addEventListener("click", openTickets);
  $("famBtn").addEventListener("click", openFamily);
  $("lugBtn").addEventListener("click", openLuggage);
  $("seatBtn").addEventListener("click", openSeats);
  $("bookBtn").addEventListener("click", startPayment);
  $("slotBtn").addEventListener("click", () => pickSlot());

  let spin = 0;
  $("swapBtn").addEventListener("click", () => {
    [from, to] = [to, from]; st.seats = [];
    spin += 180; $("swapBtn").querySelector("svg").style.transform = `rotate(${spin}deg)`;
    render();
  });
  $("backBtn").addEventListener("click", () => { if (history.length > 1) history.back(); else location.href = "index.html"; });
  // primary passenger typed/said in the assistant → pre-fill the name boxes
  {
    const first = st.tickets[0] && !/^Ticket \d+$/i.test(st.tickets[0]) ? String(st.tickets[0]).split(/\s+/) : null;
    if (first && first.length) { $("pFirst").value = first[0]; $("pLast").value = first.slice(1).join(" "); }
  }
  render();
  if (count() > 1) autoSeats();   // multi-ticket booking arrived pre-filled → seat everyone together
})();
