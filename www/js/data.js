// =========================================================
// Route data shared by the search page
// (same routes + fares as the cards on Home)
// =========================================================
window.ETC_ROUTES = [
  // Holy Ghost terminal (7 routes)
  { from: "Holy Ghost", to: "Emene", fare: 500, routes: 7 },
  { from: "Holy Ghost", to: "Gariki", fare: 500, routes: 7 },
  { from: "Holy Ghost", to: "Abakpa", fare: 500, routes: 7 },
  { from: "Holy Ghost", to: "Ninth Mile", fare: 500, routes: 7 },
  { from: "Holy Ghost", to: "Agbani", fare: 900, routes: 7 },
  { from: "Holy Ghost", to: "Udi / Oji", fare: 1200, routes: 7 },
  { from: "Holy Ghost", to: "Nsukka", fare: 1500, routes: 7 },
  // Gariki terminal (4 routes)
  { from: "Gariki", to: "Holy Ghost", fare: 500, routes: 4 },
  { from: "Gariki", to: "Agbani", fare: 500, routes: 4 },
  { from: "Gariki", to: "Emene", fare: 800, routes: 4 },
  { from: "Gariki", to: "Abakpa", fare: 900, routes: 4 },
  // Abakpa terminal (4 routes)
  { from: "Abakpa", to: "Holy Ghost", fare: 500, routes: 4 },
  { from: "Abakpa", to: "Gariki", fare: 900, routes: 4 },
  { from: "Abakpa", to: "Agbani", fare: 1500, routes: 4 },
  { from: "Abakpa", to: "Nsukka", fare: 2000, routes: 4 },
  // Nsukka terminal (3 routes)
  { from: "Nsukka", to: "UNTH New Site", fare: 600, routes: 3 },
  { from: "Nsukka", to: "Abakpa (Old)", fare: 900, routes: 3 },
  { from: "Nsukka", to: "Abakpa (Loading)", fare: 2000, routes: 3 },
];

// =========================================================
// Place coordinates  (APPROXIMATE – check each one on the ground
// and edit here; every page reads from this one list)
// =========================================================
window.ETC_PLACES = {
  // terminals
  "Holy Ghost":       { lat: 6.4402, lng: 7.4942, terminal: true },
  "Gariki":           { lat: 6.4375, lng: 7.5045, terminal: true },
  "Abakpa":           { lat: 6.4720, lng: 7.5560, terminal: true },
  "Nsukka":           { lat: 6.8561, lng: 7.3881, terminal: true },
  // destinations
  "Emene":            { lat: 6.4760, lng: 7.5800 },
  "Ninth Mile":       { lat: 6.5340, lng: 7.4320 },
  "Agbani":           { lat: 6.3050, lng: 7.5400 },
  "Udi / Oji":        { lat: 6.3180, lng: 7.4250 },
  "UNTH New Site":    { lat: 6.3520, lng: 7.4260 },
  "Abakpa (Old)":     { lat: 6.4700, lng: 7.5500 },
  "Abakpa (Loading)": { lat: 6.4690, lng: 7.5520 },
};

// =========================================================
// Travel-time model. Leaflet only draws maps – it cannot time a trip.
// OSRM gives the road distance + driving time; the rest are estimates
// built on it. Tune the numbers here.
// =========================================================
window.ETC_EST = {
  carFactor: 1.15,     // OSRM assumes free-flowing roads; add Enugu traffic
  busFactor: 1.45,     // bus = car time + stops + loading
  kekeKmh: 22,         // tricycle (keke) average speed, city roads
  walkKmh: 5,          // walking speed
  kekeMaxKm: 30,       // tricycles / walking are not offered beyond this
  walkMaxKm: 30,
};

window.etcModes = function (distKm, driveMin) {
  const E = window.ETC_EST;
  return {
    car:  driveMin * E.carFactor,
    bus:  driveMin * E.busFactor,
    keke: distKm > E.kekeMaxKm ? null : (distKm / E.kekeKmh) * 60,
    walk: distKm > E.walkMaxKm ? null : (distKm / E.walkKmh) * 60,
  };
};

window.etcFmtMin = function (m) {
  if (m == null || !isFinite(m)) return "N/A";
  m = Math.round(m);
  if (m < 1) return "<1 min";
  if (m < 60) return m + " min";
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
};

window.etcNaira = (n) => "₦" + Number(n).toLocaleString();

window.etcFare = function (from, to) {
  const r = window.ETC_ROUTES.find((x) => x.from === from && x.to === to) ||
            window.ETC_ROUTES.find((x) => x.from === to && x.to === from);
  return r ? r.fare : null;
};

// straight-line km (fallback when OSRM can't be reached)
window.etcHaversine = function (a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

// OSRM public server (driving). Returns { km, min, coords:[[lat,lng]...], approx }
window.etcRoute = async function (a, b) {
  const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 9000);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    const j = await res.json();
    const r = j.routes && j.routes[0];
    if (!r) throw new Error("no route");
    return { km: r.distance / 1000, min: r.duration / 60, coords: r.geometry.coordinates.map((c) => [c[1], c[0]]), approx: false };
  } catch (_) {
    const km = window.etcHaversine(a, b) * 1.3;          // road is longer than a straight line
    return { km, min: (km / 40) * 60, coords: [[a.lat, a.lng], [b.lat, b.lng]], approx: true };
  } finally { clearTimeout(t); }
};

// saved (bookmarked) routes + booked tickets, kept on this device
window.etcSaved = function () {
  try { return JSON.parse(localStorage.getItem("etc_saved_routes")) || []; } catch (_) { return []; }
};
// booked tickets: [{ from, to, date: "2026-09-20", seats: 2 }]  (written by the booking flow later)
window.etcBooked = function () {
  try { return JSON.parse(localStorage.getItem("etc_booked_tickets")) || []; } catch (_) { return []; }
};

// =========================================================
// Booking rules (v5) – PLACEHOLDER numbers, change them here
// =========================================================
window.ETC_BOOK = {
  busSeats: 32,          // 32-seater CNG city bus (8 rows x A B | C D)
  ticketMax: 40,         // most tickets one booking can hold
  familyMin: 2,
  familyMax: 12,         // a family must fit in ONE bus, so keep this well under 32
  trunkPerBus: 12,       // trunk space units per bus
  luggageUnitFee: 500,   // ₦ per space unit  (small bag = 1 unit, box = 2, ...)
  priority: ["1A", "1B"] // priority / wheelchair seats
};
window.ETC_LUGGAGE = [
  { id: "bag",      name: "Small bag", icon: "bag",      space: 1 },
  { id: "box",      name: "Box",       icon: "box",      space: 2 },
  { id: "suitcase", name: "Luggage",   icon: "suitcase", space: 2 },
  { id: "duffel",   name: "Baggage",   icon: "duffel",   space: 3 },
];
window.ETC_SIZES = [ { k: "S", label: "Small", space: 1 }, { k: "M", label: "Medium", space: 2 }, { k: "L", label: "Large", space: 3 } ];

// ---- seat map: all seats free by default.
// When Firebase tickets exist for this route/date they can mark seats occupied.
// (No random mock occupancy.)
window.etcBusMap = function (routeKey, n) {
  const B = window.ETC_BOOK, rows = 8, cols = ["A", "B", "C", "D"];
  const all = [];
  for (let r = 1; r <= rows; r++) cols.forEach((c) => all.push(r + c));
  const occupied = new Set(); // real occupancy can be filled from Firestore tickets later
  const free = all.length - occupied.size;
  return { n, all, occupied, free };
};

// how many buses a booking of `count` people needs on this route (family = always one bus)
window.etcBusesFor = function (routeKey, count, family) {
  if (family) { let t = 1; while (window.etcBusMap(routeKey, t).free < count) t++; return t; }
  let n = 0, free = 0;
  do { n++; free += window.etcBusMap(routeKey, n).free; } while (free < count);
  return n;
};
