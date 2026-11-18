// =========================================================
// Map tab – live location (HTML5 geolocation + Leaflet),
// terminals, and the booked / saved routes list
// =========================================================
document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);
  const ICON = window.ETC_ICONS, PLACES = window.ETC_PLACES;

  const map = L.map("liveMap", { zoomControl: false, attributionControl: true }).setView([6.4584, 7.5464], 12);
  map.attributionControl.setPrefix(false);
  map.attributionControl.setPosition("topleft");
  const baseTiles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap", keepBuffer: 4, updateWhenIdle: false }).addTo(map);
  if (window.ETC_MapFix) ETC_MapFix.harden(map, baseTiles, document.getElementById("liveMap"));

  const divIcon = (html, size, anchor) => L.divIcon({ className: "etc-marker", html, iconSize: size, iconAnchor: anchor });

  // terminals (black bus markers)
  Object.entries(PLACES).filter(([, p]) => p.terminal).forEach(([name, p]) => {
    L.marker([p.lat, p.lng], { icon: divIcon(`<div class="stop-pin">${ICON.bus}</div>`, [34, 34], [17, 17]), keyboard: false })
      .addTo(map).bindPopup(`<b>${name} Terminal</b>`);
  });

  // ---------- live location ----------
  let me = null, halo = null, following = true, watchId = null, firstFix = true;
  map.on("dragstart", () => { following = false; });

  function onFix(pos) {
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;
    const ll = [lat, lng];
    if (!me) {
      me = L.marker(ll, { icon: divIcon(`<div class="you-pin">${ICON.youPin}</div>`, [34, 44], [17, 43]), zIndexOffset: 1000, keyboard: false }).addTo(map);
      halo = L.circle(ll, { radius: accuracy, color: "#2563EB", weight: 1, fillColor: "#2563EB", fillOpacity: 0.12 }).addTo(map);
    } else { me.setLatLng(ll); halo.setLatLng(ll).setRadius(accuracy); }
    $("coords").textContent = `${lat.toFixed(5)}°, ${lng.toFixed(5)}°`;
    $("acc").textContent = `Live · accurate to ${Math.round(accuracy)} m`;
    if (firstFix) { map.setView(ll, 15); firstFix = false; }
    else if (following) map.panTo(ll, { animate: true });
  }
  function onErr(err) {
    $("coords").textContent = err.code === 1 ? "Location is off" : "Can’t find you yet";
    $("acc").textContent = err.code === 1 ? "Allow location in browser settings" : "Trying again…";
    if (err.code === 1 && watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  }
  function startWatch() {
    if (!("geolocation" in navigator)) { $("coords").textContent = "No location support"; $("acc").textContent = "This device can’t share its location"; return; }
    if (watchId != null) return;
    watchId = navigator.geolocation.watchPosition(onFix, onErr, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  }
  $("locateBtn").addEventListener("click", () => {
    following = true;
    if (watchId == null) { firstFix = true; startWatch(); }
    else if (me) map.setView(me.getLatLng(), Math.max(map.getZoom(), 16), { animate: true });
  });
  window.addEventListener("pagehide", () => { if (watchId != null) navigator.geolocation.clearWatch(watchId); });
  startWatch();

  // ---------- booked + saved list ----------
  const label = (n) => n;
  function items() {
    const booked = window.etcBooked().map((b) => ({
      from: b.from, to: b.to, kind: "booked",
      sub: `${fmtDate(b.date)} | ${b.seats || 1} ${(b.seats || 1) === 1 ? "Seat" : "Seats"}`,
    }));
    const bookedKeys = new Set(booked.map((b) => `${b.from}>${b.to}`));
    const saved = window.etcSaved().filter((k) => !bookedKeys.has(k)).map((k) => {
      const [from, to] = k.split(">");
      const fare = window.etcFare(from, to);
      return { from, to, kind: "saved", sub: "Saved" + (fare != null ? ` | ${window.etcNaira(fare)}` : "") };
    });
    return booked.concat(saved).filter((i) => i.from && i.to);
  }
  function fmtDate(d) {
    const dt = d ? new Date(d) : null;
    return dt && !isNaN(dt) ? dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "Booked";
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  const sheet = $("sheet"), list = $("list"), more = $("seeMore");
  function renderList() {
    const it = items();
    if (!it.length) {
      list.style.maxHeight = "none";
      list.innerHTML = `<p class="m-empty">Nothing here yet. Tap the bookmark on a route to save it, and your booked tickets will show up here too.</p>`;
      more.hidden = true;
      return;
    }
    list.style.maxHeight = "";
    list.innerHTML = it.map((i) => `
      <a class="m-item" href="details.html?from=${encodeURIComponent(i.from)}&to=${encodeURIComponent(i.to)}">
        <span class="ic">${ICON.clip}</span>
        <span class="min-w-0"><span class="t block">${esc(label(i.from))} - ${esc(label(i.to))}</span><span class="s block">${esc(i.sub)}</span></span>
        <span class="go">${ICON.chev}</span>
      </a>`).join("");
    more.hidden = it.length < 2;
  }
  function toggle() {
    const open = sheet.classList.toggle("expanded");
    more.textContent = open ? "See less" : "See more";
  }
  more.addEventListener("click", toggle);
  $("handle").addEventListener("click", () => { if (!more.hidden) toggle(); });
  window.addEventListener("pageshow", renderList);
  renderList();
});
