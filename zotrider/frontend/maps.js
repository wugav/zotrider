// =====================================================================
// Campus map + walking routes for ZotRider. Free, no API key needed.
//  - Map: OpenStreetMap tiles shown with Leaflet (UCI's real buildings and paths)
//  - Routes: OSRM walking routes from routing.openstreetmap.de
//  - If the route service is busy or offline, falls back to an estimate
// Usage rules for both services: show the attribution (done below), keep
// requests light (max 1 route request per second, results are cached).
// =====================================================================
const LEAFLET = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/";
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ROUTER = "https://routing.openstreetmap.de/routed-foot/route/v1/driving/";
const ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors · Routes: <a href="https://routing.openstreetmap.de/about.html" target="_blank" rel="noopener">FOSSGIS OSRM</a>';
const UCI = [33.6461, -117.8427];

const WALK_M_PER_MIN = 80;    // ~3 mph walking pace
const DETOUR = 1.3;           // paths are ~30% longer than a straight line

// ---------------------------------------------------------------------
// Distance helpers
// ---------------------------------------------------------------------
export function metersBetween(a, b) {
  const r = (x) => (x * Math.PI) / 180, R = 6371000;
  const dl = r(b[0] - a[0]), dn = r(b[1] - a[1]);
  const h = Math.sin(dl / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// Quick estimate used on cards and when the route service is unavailable
export function estimateWalk(from, to) {
  const meters = metersBetween(from, to) * DETOUR;
  return { meters, minutes: Math.max(1, Math.round(meters / WALK_M_PER_MIN)), path: [from, to], estimated: true };
}
export const miles = (m) => (m / 1609.34).toFixed(m < 1609 ? 2 : 1);

// Full step-by-step directions on openstreetmap.org (opens in a new tab)
export function directionsUrl(from, to) {
  return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=${from[0]},${from[1]};${to[0]},${to[1]}`;
}

// ---------------------------------------------------------------------
// Walking route (real footpaths). Cached, and spaced ≥1 s apart.
// ---------------------------------------------------------------------
const cache = new Map();
let lastRequest = 0;
export async function walkingRoute(from, to) {
  const key = `${from}|${to}`;
  if (cache.has(key)) return cache.get(key);
  const wait = 1100 - (Date.now() - lastRequest);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();

  const url = `${ROUTER}${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Route service unavailable");
  const json = await res.json();
  const r = json.routes?.[0];
  if (json.code !== "Ok" || !r) throw new Error("No walking route found");
  const route = {
    meters: r.distance,
    minutes: Math.max(1, Math.round(r.duration / 60)),
    path: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    estimated: false,
  };
  cache.set(key, route);
  return route;
}

// ---------------------------------------------------------------------
// Leaflet loading + shared map pieces
// ---------------------------------------------------------------------
let loading = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const css = Object.assign(document.createElement("link"), { rel: "stylesheet", href: LEAFLET + "leaflet.min.css" });
      const js = Object.assign(document.createElement("script"), { src: LEAFLET + "leaflet.min.js" });
      js.onload = () => resolve(window.L);
      js.onerror = () => { loading = null; reject(new Error("The campus map couldn't load. Check your connection.")); };
      document.head.append(css, js);
    });
  }
  return loading;
}
function newMap(L, el, center, zoom) {
  const map = L.map(el, { scrollWheelZoom: false, zoomSnap: 0.5 }).setView(center, zoom);
  L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
  return map;
}
function pinIcon(L, text, on = false) {
  const el = document.createElement("div");
  el.className = "gpin" + (on ? " on" : "");
  el.textContent = text;
  return L.divIcon({ html: el, className: "pin-wrap", iconSize: [0, 0] });
}
const youIcon = (L) => L.divIcon({ html: '<div class="gyou" title="You"></div>', className: "pin-wrap", iconSize: [0, 0] });

// ---------------------------------------------------------------------
// Explore map: a price pin per listing + you. Created once and reused.
// ---------------------------------------------------------------------
let exploreMap = null, exploreEl = null, layer = null, lastKey = "";
export async function showExploreMap(host, listings, me, selectedId, onSelect) {
  const L = await loadLeaflet();
  if (!exploreEl) {
    exploreEl = document.createElement("div");
    exploreEl.className = "gmap";
    host.replaceChildren(exploreEl);
    exploreMap = newMap(L, exploreEl, UCI, 15.5);
    layer = L.layerGroup().addTo(exploreMap);
  } else {
    host.replaceChildren(exploreEl);
    exploreMap.invalidateSize();
  }

  layer.clearLayers();
  listings.forEach((s) => {
    L.marker([s.lat, s.lng], { icon: pinIcon(L, s.priceLabel, s.id === selectedId), title: s.title, zIndexOffset: s.id === selectedId ? 1000 : 0, keyboard: true })
      .on("click", () => onSelect(s.id))
      .addTo(layer);
  });
  L.marker(me.ll, { icon: youIcon(L), title: "You", interactive: false }).addTo(layer);

  // Re-fit only when the set of listings or your location changes
  const key = listings.map((s) => s.id).join() + me.ll;
  if (key !== lastKey) {
    lastKey = key;
    const pts = [...listings.map((s) => [s.lat, s.lng]), me.ll];
    exploreMap.fitBounds(L.latLngBounds(pts), { padding: [50, 50], maxZoom: 17 });
  }
}

// ---------------------------------------------------------------------
// Route map in a listing: draws the walking path from you to pickup.
// Returns { meters, minutes, estimated }.
// ---------------------------------------------------------------------
export async function showRoute(host, from, to) {
  const L = await loadLeaflet();
  const el = document.createElement("div");
  el.className = "gmap small";
  host.replaceChildren(el);
  const map = newMap(L, el, to, 16);

  let route;
  try { route = await walkingRoute(from, to); }
  catch { route = estimateWalk(from, to); }

  L.polyline(route.path, route.estimated
    ? { color: "#0064A4", weight: 4, dashArray: "6 8", opacity: 0.8 }     // dashed = estimate
    : { color: "#0064A4", weight: 6, opacity: 0.9 }).addTo(map);
  L.marker(from, { icon: youIcon(L), title: "You", interactive: false }).addTo(map);
  L.marker(to, { icon: pinIcon(L, "Pickup", true), title: "Pickup area", interactive: false }).addTo(map);
  map.fitBounds(L.latLngBounds([from, to, ...route.path]), { padding: [30, 30], maxZoom: 18 });
  return route;
}
