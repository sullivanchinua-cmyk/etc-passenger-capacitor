// =========================================================
// Route details
//   • HTML5 geolocation → blue pin (you)
//   • Leaflet map + OSRM roads
//       blue line   : you → terminal
//       orange line : terminal → destination
//   • travel-time estimates (car, bus, tricycle, walking)
//   • tap / double-tap the map: opens full screen, again to close
// =========================================================
(function () {
  const $ = (id) => document.getElementById(id);
  const ICON = window.ETC_ICONS, PLACES = window.ETC_PLACES;
  const q = new URLSearchParams(location.search);
  let start = q.get("from") || "Holy Ghost";     // terminal
  let end = q.get("to") || "Emene";               // destination
  let user = null;                                // { lat, lng }
  let geoState = "asking";                        // asking | ok | denied | unsupported
  let renderId = 0;

  const YOU = "#2563EB", TRIP = "#F97316";

  // ---------- map ----------
  const map = L.map("dMap", {
    zoomControl: false, attributionControl: true, doubleClickZoom: false, tap: false,
    dragging: false, touchZoom: false, scrollWheelZoom: false, boxZoom: false, keyboard: false,
  }).setView([6.4584, 7.5464], 12);
  map.attributionControl.setPrefix(false);
  const baseTiles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap", keepBuffer: 4, updateWhenIdle: false }).addTo(map);
  if (window.ETC_MapFix) ETC_MapFix.harden(map, baseTiles, document.getElementById("dMap"));
  const layer = L.layerGroup().addTo(map);
  let lastBounds = null;

  const divIcon = (html, size, anchor) => L.divIcon({ className: "etc-marker", html, iconSize: size, iconAnchor: anchor });
  const stopIcon = (svg) => divIcon(`<div class="stop-pin">${svg}</div>`, [34, 34], [17, 17]);
  const youIcon = () => divIcon(`<div class="you-pin">${ICON.youPin}</div>`, [34, 44], [17, 43]);

  function fit() {
    if (!lastBounds) return;
    const open = $("mapWrap").classList.contains("open");
    map.invalidateSize();
    map.fitBounds(lastBounds, { padding: open ? [70, 50] : [34, 34], animate: false, maxZoom: 16 });
  }

  // tap or double-tap toggles full screen (debounced so a double-tap = one toggle)
  let lastToggle = 0;
  function setOpen(open) {
    const wrap = $("mapWrap");
    wrap.classList.toggle("open", open);
    document.documentElement.classList.toggle("map-open", open);
    ["dragging", "touchZoom", "scrollWheelZoom"].forEach((h) => (open ? map[h].enable() : map[h].disable()));
    if (open) window.scrollTo(0, 0);
    // keep the map sized while the height animates, then re-fit
    const t0 = performance.now();
    (function tick() {
      map.invalidateSize();
      if (performance.now() - t0 < 460) requestAnimationFrame(tick); else fit();
    })();
  }
  map.on("click", () => {
    const now = Date.now();
    if (now - lastToggle < 420) return;
    lastToggle = now;
    setOpen(!$("mapWrap").classList.contains("open"));
  });

  // ---------- markers + roads ----------
  const cache = {};
  const routeOf = (a, b) => {
    const k = `${a.lat},${a.lng}|${b.lat},${b.lng}`;
    return (cache[k] = cache[k] || window.etcRoute(a, b));
  };

  function line(r, color) {
    L.polyline(r.coords, {
      color, weight: 5, opacity: 0.95, lineCap: "round", lineJoin: "round", dashArray: r.approx ? "2 10" : null,
    }).addTo(layer);
  }

  // ---------- estimate tiles ----------
  const MODES = [["car", "Car"], ["bus", "Bus"], ["keke", "Tricycle"], ["walk", "Walking"]];
  function tiles(route) {
    const m = route ? window.etcModes(route.km, route.min) : null;
    return MODES.map(([k, label]) => {
      const val = m ? window.etcFmtMin(m[k]) : "–";
      const dim = !m || m[k] == null ? " dim" : "";
      return `<div class="est"><span class="ic">${ICON[k]}</span><div><p class="k">${label}</p><p class="v${dim}">${val}</p></div></div>`;
    }).join("");
  }
  const km = (r) => (r.km < 10 ? r.km.toFixed(1) : Math.round(r.km)) + " km";

  function needLocationMsg() {
    if (geoState === "asking") return "Locating you…";
    const why = geoState === "unsupported" ? "This device can’t share its location." : "Location is off.";
    return `${why} <button type="button" id="retryGeo">Allow location</button> to see times from where you are.`;
  }

  // ---------- main draw ----------
  async function render() {
    const id = ++renderId;
    const A = PLACES[start], B = PLACES[end];
    $("fromName").textContent = start + (PLACES[start] && PLACES[start].terminal ? " Terminal" : "");
    $("toName").textContent = end + (PLACES[end] && PLACES[end].terminal ? " Terminal" : "");
    const fare = window.etcFare(start, end) ?? window.etcFare(end, start);
    $("amount").textContent = fare != null ? window.etcNaira(fare) : "–";

    layer.clearLayers();
    if (!A || !B) { $("estSub").textContent = "This place has no map position yet."; $("estMain").innerHTML = tiles(null); return; }

    L.marker([A.lat, A.lng], { icon: stopIcon(ICON.bus), keyboard: false }).addTo(layer).bindPopup(`<b>${start}</b>`);
    L.marker([B.lat, B.lng], { icon: stopIcon(ICON.pin), keyboard: false }).addTo(layer).bindPopup(`<b>${end}</b>`);
    lastBounds = L.latLngBounds([[A.lat, A.lng], [B.lat, B.lng]]);
    fit();

    $("estMain").innerHTML = tiles(null);
    $("estSub").innerHTML = user ? "From your location to " + end : needLocationMsg();

    // terminal → destination (orange)
    const legB = await routeOf(A, B);
    if (id !== renderId) return;
    line(legB, TRIP);
    lastBounds = L.latLngBounds(legB.coords);
    fit();

    let legA = null, legC = null;
    if (user) {
      [legA, legC] = await Promise.all([routeOf(user, A), routeOf(user, B)]);
      if (id !== renderId) return;
      line(legA, YOU);
      L.marker([user.lat, user.lng], { icon: youIcon(), zIndexOffset: 1000, keyboard: false }).addTo(layer).bindPopup("You are here");
      // only zoom out to include you when you're reasonably close to the route
      if (window.etcHaversine(user, A) < 60) lastBounds = lastBounds.extend([user.lat, user.lng]);
      fit();
      $("estMain").innerHTML = tiles(legC);
    }
    fillOverlay(legA, legB);
  }

  // ---------- overlay ----------
  function fillOverlay(legA, legB) {
    const startLabel = start;
    let html = `<h3>You → ${startLabel}</h3>`;
    if (legA) html += `<p class="sub">${km(legA)} · to reach the terminal</p><div class="est-grid">${tiles(legA)}</div>`;
    else html += `<p class="sub">${needLocationMsg()}</p><div class="est-grid">${tiles(null)}</div>`;
    html += `<h3>${startLabel} → ${end}</h3><p class="sub">${km(legB)} · terminal to destination</p><div class="est-grid">${tiles(legB)}</div>`;
    html += `<p class="sub" style="margin-top:14px">Times are estimates and can change with traffic.</p>`;
    $("ovBody").innerHTML = html;
  }
  const ov = $("ov");
  const openOv = () => { ov.classList.add("show"); ov.setAttribute("aria-hidden", "false"); };
  const closeOv = () => { ov.classList.remove("show"); ov.setAttribute("aria-hidden", "true"); };
  $("moreBtn").addEventListener("click", openOv);
  $("ovClose").addEventListener("click", closeOv);
  ov.addEventListener("click", (e) => { if (e.target === ov) closeOv(); });

  // ---------- geolocation ----------
  function locate() {
    if (!("geolocation" in navigator)) { geoState = "unsupported"; return render(); }
    geoState = "asking";
    navigator.geolocation.getCurrentPosition(
      (p) => { user = { lat: p.coords.latitude, lng: p.coords.longitude }; geoState = "ok"; render(); },
      () => { geoState = "denied"; render(); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  }
  document.addEventListener("click", (e) => { if (e.target.id === "retryGeo") { closeOv(); locate(); } });

  // ---------- book: date first, then departure time (agent check is inside slots on evening times)
  $("bookBtn").addEventListener("click", () => {
    const lbl = (n) => n + (PLACES[n] && PLACES[n].terminal ? " Terminal" : "");
    window.ETC_Slots.openDateThenTime({
      from: lbl(start), to: lbl(end),
      cta: "Proceed", allowSkip: true,
      onDone: async ({ date, slot }) => {
        // If rescheduling an old ticket, notify agent + void old seats
        const rs = new URLSearchParams(location.search).get("reschedule");
        if (rs && window.ETC_FB && window.ETC_FB.db) {
          try {
            await window.ETC_FB.ensureAuth();
            const db = window.ETC_FB.db;
            const old = await db.collection("tickets").doc(rs).get();
            if (old.exists) {
              const ot = old.data();
              await db.collection("tickets").doc(rs).set({
                status: "rescheduled", rescheduledAt: Date.now(), seat: null,
              }, { merge: true });
              await db.collection("agent_alerts").add({
                type: "reschedule",
                terminal: String(ot.from || start).replace(/\s+Terminal$/i, "").trim(),
                message: (ot.name || "Passenger") + " rescheduled ticket " + rs + (ot.seat ? " (seat " + ot.seat + " freed)" : ""),
                ticketId: rs, ts: Date.now(), seen: false,
              });
            }
          } catch (e) { console.warn("[ETC reschedule]", e); }
        }
        let q = `from=${encodeURIComponent(start)}&to=${encodeURIComponent(end)}`;
        if (date) q += `&date=${encodeURIComponent(date)}`;
        else { try { localStorage.removeItem("etc_travel_date"); } catch(_){} }
        location.href = slot
          ? `book.html?${q}&slot=${encodeURIComponent(slot.time)}`
          : `book.html?${q}`;
      },
    });
  });

  // ---------- swap + back ----------
  let spin = 0;
  $("swapBtn").addEventListener("click", () => {
    [start, end] = [end, start];
    spin += 180;
    $("swapBtn").querySelector("svg").style.transform = `rotate(${spin}deg)`;
    render();
  });
  $("backBtn").addEventListener("click", () => { if (history.length > 1) history.back(); else location.href = "index.html"; });

  render();
  locate();
})();
