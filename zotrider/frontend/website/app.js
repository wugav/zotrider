// =====================================================================
// ZotRider — main page logic
// Listings, bookings and messages are stored in Supabase, so everyone
// sees the same rides. Requires all migrations in supabase/migrations.
// =====================================================================
import { supabase } from "./supabase.js";
import { showExploreMap, showRoute, directionsUrl, estimateWalk, miles } from "./maps.js";

const $ = (s) => document.querySelector(s);
const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;

// Campus spots used for pickup areas and "sort by distance"
const SPOTS = {
  "Aldrich Park": [33.6459, -117.8427],
  "Langson Library": [33.647229758673845, -117.8411615903217],
  "Student Center": [33.64888543253606, -117.84221973992533],
  "ARC": [33.64340547333432, -117.82794555671876],
  "Engineering Hall": [33.643573929409044, -117.84142054891757],
  "Mesa Court": [33.65211055119594, -117.84465123919425],
  "Middle Earth": [33.644881144982335, -117.83724014386799],
  "Student Services II": [33.648052761396315, -117.8425526635528],
  "Gateway Study Center": [33.647402033912066, -117.84169842536993],
  "Social Science Lecture Hall": [33.64722282666303, -117.83978042526213],
  "Brandywine": [33.64537929953672, -117.8393061823036],
  "Anteatery": [33.65090690359204, -117.84535040263337],
};
const COLORS = ["#0064A4", "#57C7F5", "#C9A000", "#171A18", "#5B6B7A"];
const TYPE_LABEL = { scooter: "E-Scooter", ebike: "E-Bike", bike: "Bike" };

let me = null;                 // signed-in user
let LISTINGS = [];             // from browse_listings()
let loadError = "";
let user = { name: "Aldrich Park", ll: SPOTS["Aldrich Park"] };
let view = "list", sel = null, meLL = null, mapFailed = false;

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (cents) => "$" + (cents % 100 ? (cents / 100).toFixed(2) : cents / 100);
const hav = (a, b) => {
  const r = (x) => (x * Math.PI) / 180, R = 3958.8;
  const dl = r(b[0] - a[0]), dn = r(b[1] - a[1]);
  const h = Math.sin(dl / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const dist = (s) => hav(user.ll, [s.lat, s.lng]);
// "~0.3 mi · 6 min walk" — quick estimate from where you are (no network call)
const walkText = (s) => { const e = estimateWalk(user.ll, [s.lat, s.lng]); return `~${miles(e.meters)} mi · ${e.minutes} min walk`; };
const colorFor = (s) => COLORS[[...s.id].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
const photoUrl = (path) => supabase.storage.from("listing-photos").getPublicUrl(path).data.publicUrl;
const isMine = (s) => me && s.owner_id === me.id;

// Times: minutes since midnight <-> "10:00 AM" and "HH:MM:SS"
const tm = (m) => { const h = Math.floor(m / 60); return `${((h + 11) % 12) + 1}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
const toMin = (t) => (t ? +t.slice(0, 2) * 60 + +t.slice(3, 5) : null);
const toTime = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const hopts = (a, b, v) => { let o = ""; for (let m = a; m <= b; m += 15) o += `<option value="${m}" ${m == v ? "selected" : ""}>${tm(m)}</option>`; return o; };
const localISO = (dateStr, minutes) => { const [y, mo, d] = dateStr.split("-").map(Number); return new Date(y, mo - 1, d, Math.floor(minutes / 60), minutes % 60); };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const when = (iso) => new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const day = (d) => new Date(d + "T12:00:00").toLocaleDateString([], { month: "short", day: "numeric" });
const friendly = (error) => (error?.message || String(error)).replace(/^.*?ERROR:\s*/, "");

// Price rules — identical to quote_price() in the database.
// For filtering/sorting, a daily-only price counts as if spread over 8 hours.
const perMinute = (s) => s.minute_price_cents ?? Math.ceil(s.daily_price_cents / 480);
const centsLabel = (c) => `${c}¢`;
function cost(s, minutes) {
  const m = Math.ceil(minutes), perMin = s.minute_price_cents, day = s.daily_price_cents;
  if (!day) return m * perMin;
  if (!perMin) return Math.ceil(m / 1440) * day;
  return Math.floor(m / 1440) * day + Math.min((m % 1440) * perMin, day);
}
const priceTag = (s) =>
  s.minute_price_cents
    ? `${centsLabel(s.minute_price_cents)}<small>/min</small>${s.daily_price_cents ? `<small class="pd"> · ${money(s.daily_price_cents)}/day</small>` : ""}`
    : `${money(s.daily_price_cents)}<small>/day</small>`;

function availableNow(s) {
  const t = today();
  return s.is_active && (!s.available_from || s.available_from <= t) && (!s.available_until || s.available_until >= t);
}
function art(s) {
  if (s.photo_paths?.length) return `<img src="${esc(photoUrl(s.photo_paths[0]))}" alt="" loading="lazy">`;
  return `<svg viewBox="0 0 400 240" style="--sc:${colorFor(s)}"><use href="#${s.type === "scooter" ? "sc" : "bk"}"/></svg>`;
}

// ---------------------------------------------------------------------
// Explore: load + render listings
// ---------------------------------------------------------------------
async function loadListings() {
  const { data, error } = await supabase.rpc("browse_listings");
  if (error) { loadError = friendly(error); LISTINGS = []; }
  else { loadError = ""; LISTINGS = data; }
  list();
}

const spotOpts = Object.keys(SPOTS).map((k) => `<option>${k}</option>`).join("");
const geoOpt = `<option value="__geo">Use my current location</option>`;
$("#loc").innerHTML = geoOpt + spotOpts;
$("#heroLoc").innerHTML = geoOpt + spotOpts;
$("#loc").value = $("#heroLoc").value = "Aldrich Park";

function card(s, i) {
  const featured = i === 0 && view === "list";
  const tag = isMine(s) ? `<span class="tag mine">Your listing${s.is_active ? "" : " · hidden"}</span>`
    : `<span class="tag ${availableNow(s) ? "" : "n"}">${availableNow(s) ? "Available" : "Not available now"}</span>`;
  const rating = s.owner_review_count ? ` · ★ ${s.owner_rating}` : "";
  return `<button class="card ${featured ? "f" : ""} ${sel === s.id ? "hl" : ""}" data-id="${s.id}" style="transition-delay:${i * 60}ms">
    <div class="art">${art(s)}</div>
    <div class="cb">${tag}
      <h3 style="margin-top:12px">${esc(s.title)}</h3>
      <div class="model">${esc([TYPE_LABEL[s.type], s.model].filter(Boolean).join(" · "))}</div>
      <div class="row"><span>${esc(s.pickup_area)} · ${walkText(s)}</span><span class="price">${priceTag(s)}</span></div>
      <div class="row"><span>@${esc(s.owner_username)}${rating}</span><span class="more">View details →</span></div>
    </div></button>`;
}

function list() {
  const out = $("#out");
  if (loadError) { out.innerHTML = `<div class="msg">Couldn't load rides: ${esc(loadError)}</div>`; return; }
  const max = +$("#max").value, onlyAvail = $("#av").checked, type = $("#type").value;
  let r = LISTINGS.filter((s) => perMinute(s) <= max && (!onlyAvail || availableNow(s)) && (type === "all" || s.type === type));
  r.sort($("#sort").value === "p" ? (a, b) => perMinute(a) - perMinute(b) : (a, b) => dist(a) - dist(b));

  if (!LISTINGS.length) {
    out.innerHTML = `<div class="empty"><h3>No rides listed yet.</h3><p>Be the first Anteater to list a scooter or bike.</p><button class="btn p" data-list>List your ride</button></div>`;
    return;
  }
  if (!r.length) { out.innerHTML = `<div class="msg">No rides match these filters. Try raising the max price or turning off “Available only”.</div>`; return; }

  if (view === "list") out.innerHTML = `<div class="grid">${r.map(card).join("")}</div>`;
  else if (!mapFailed) {
    const cur = r.find((s) => s.id === sel) || r[0];
    out.innerHTML = `<div class="mapside"><div class="mapbox" id="gmapHost"><p class="note" style="padding:16px">Loading map…</p></div><div><div class="grid" style="display:block">${card(cur, 1)}</div></div></div>`;
    const pinsData = r.map((s) => ({ ...s, priceLabel: s.minute_price_cents ? `${centsLabel(s.minute_price_cents)}/min` : `${money(s.daily_price_cents)}/day` }));
    showExploreMap($("#gmapHost"), pinsData, user, cur.id, (id) => { sel = id; list(); })
      .catch(() => { mapFailed = true; list(); });   // offline: fall back to the simple sketch map
  } else {
    const pts = [...Object.values(SPOTS), ...r.map((s) => [s.lat, s.lng]), user.ll];
    const la = pts.map((x) => x[0]), ln = pts.map((x) => x[1]);
    const mn = [Math.min(...la), Math.min(...ln)], mx = [Math.max(...la), Math.max(...ln)];
    const P = (ll) => [60 + ((ll[1] - mn[1]) / (mx[1] - mn[1] || 1)) * 480, 350 - ((ll[0] - mn[0]) / (mx[0] - mn[0] || 1)) * 300];
    const you = P(user.ll);
    const pins = r.map((s) => {
      const p = P([s.lat, s.lng]);
      return `<g class="pin ${sel === s.id ? "on" : ""}" data-id="${s.id}" tabindex="0" role="button" aria-label="${esc(s.title)}, ${esc(s.pickup_area)}"><circle cx="${p[0]}" cy="${p[1]}" r="11" fill="#0064A4" stroke="#FFD200" stroke-width="3"/><text x="${p[0]}" y="${p[1] - 20}" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">${centsLabel(perMinute(s))}/min</text></g>`;
    }).join("");
    const cur = r.find((s) => s.id === sel) || r[0];
    out.innerHTML = `<div class="mapside"><div class="mapbox"><svg viewBox="0 0 600 400" role="img" aria-label="Map of pickup spots"><rect width="600" height="400" fill="var(--card)"/><g fill="none" stroke="var(--line)" stroke-width="3"><circle cx="300" cy="200" r="80"/><path d="M0 120C200 100 380 300 600 280M120 400C200 260 420 100 560 0"/></g><circle cx="${you[0]}" cy="${you[1]}" r="8" fill="#e5484d"/><text x="${you[0] + 12}" y="${you[1] + 4}" font-size="12" fill="currentColor">You (${esc(user.name)})</text>${pins}</svg><p class="note" style="padding:0 16px">Simple sketch map (the campus map couldn't load).</p></div><div><div class="grid" style="display:block">${card(cur, 1)}</div></div></div>`;
  }
  document.querySelectorAll(".card").forEach((c) => requestAnimationFrame(() => c.classList.add("in")));
}

$("#out").addEventListener("click", (e) => {
  const p = e.target.closest(".pin"), c = e.target.closest(".card");
  if (p) { sel = p.dataset.id; list(); } else if (c) openDetail(c.dataset.id);
});
$("#out").addEventListener("keydown", (e) => {
  const p = e.target.closest(".pin");
  if (p && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); sel = p.dataset.id; list(); }
});
["sort", "av", "type"].forEach((i) => ($("#" + i).onchange = list));
$("#max").oninput = () => { $("#maxo").textContent = $("#max").value + "¢"; list(); };
$("#loc").onchange = () => {
  const v = $("#loc").value;
  if (v === "__geo") return geo();
  user = v === "__me" ? { name: "your location", ll: meLL } : { name: v, ll: SPOTS[v] };
  $("#geomsg").innerHTML = "";
  list();
};
document.querySelectorAll(".seg button").forEach((b) => (b.onclick = () => {
  view = b.dataset.v;
  document.querySelectorAll(".seg button").forEach((x) => x.setAttribute("aria-pressed", x === b));
  list();
}));
$("#heroGo").onclick = () => {
  $("#loc").value = $("#heroLoc").value;
  if ($("#heroLoc").value === "__geo") geo(); else $("#loc").onchange();
  location.hash = "#explore";
};
function geo() {
  const back = () => ($("#loc").value = SPOTS[user.name] ? user.name : "Aldrich Park");
  if (!navigator.geolocation) { back(); $("#geomsg").innerHTML = `<div class="msg">Location isn’t available in this browser. Choose a spot instead.</div>`; return; }
  $("#geomsg").innerHTML = `<div class="msg">Waiting for your permission…</div>`;
  navigator.geolocation.getCurrentPosition((p) => {
    meLL = [p.coords.latitude, p.coords.longitude];
    user = { name: "your location", ll: meLL };
    if (!$("#loc option[value=__me]")) $("#loc").add(new Option("Your current location", "__me"));
    $("#loc").value = "__me";
    $("#geomsg").innerHTML = `<div class="msg">Using your location. Distances are straight-line estimates.</div>`;
    list();
  }, (e) => { back(); $("#geomsg").innerHTML = `<div class="msg">${e.code === 1 ? "Location permission was denied." : "Couldn’t get your location."} Pick your area from the menu.</div>`; }, { timeout: 8000 });
}

// ---------------------------------------------------------------------
// Listing details + booking request
// ---------------------------------------------------------------------
async function openDetail(id) {
  const s = LISTINGS.find((x) => x.id === id);
  if (!s) return;
  $("#dt").textContent = s.title;
  const specs = [s.model, s.range_miles && `Range ${s.range_miles} mi`, s.top_speed_mph && `Top ${s.top_speed_mph} mph`].filter(Boolean);
  const hours = s.daily_start && s.daily_end ? `${tm(toMin(s.daily_start))}–${tm(toMin(s.daily_end))} daily` : "Any time";
  const dates = s.available_until ? `${s.available_from ? day(s.available_from) : "Now"} – ${day(s.available_until)}`
    : s.available_from && s.available_from > today() ? `From ${day(s.available_from)}` : "Ongoing";
  const gallery = s.photo_paths?.length > 1 ? `<div class="prev">${s.photo_paths.map((p) => `<img src="${esc(photoUrl(p))}" alt="">`).join("")}</div>` : "";
  const info = `<div class="two"><div><div class="art" style="border-radius:18px">${art(s)}</div>${gallery}<div class="spec">${specs.map((x) => `<span>${esc(x)}</span>`).join("")}</div></div>
    <div><span class="tag ${availableNow(s) ? "" : "n"}">${availableNow(s) ? "Available" : "Not available now"}</span>
    <p style="margin-top:12px">${esc(s.description || "No description yet.")}</p>
    <p class="facts"><b>Owner:</b> @${esc(s.owner_username)}${s.owner_review_count ? ` · ★ ${s.owner_rating} (${s.owner_review_count})` : ""}<br>
    <b>Pickup:</b> ${esc(s.pickup_area)} (${walkText(s)} from ${esc(user.name)})<br>
    <b>Return:</b> ${esc(s.return_note || "Same as pickup")}<br>
    <b>Hours:</b> ${hours}<br><b>Dates:</b> ${esc(dates)}</p></div></div>`;

  if (isMine(s)) {
    $("#dbody").innerHTML = `${info}<div class="msg">This is your listing. Requests for it show up under <b>Bookings</b>.</div>
      <button class="btn o" id="toggleActive">${s.is_active ? "Hide this listing" : "Show this listing again"}</button> <div class="err" id="berr" role="alert"></div>`;
    $("#toggleActive").onclick = async () => {
      const { error } = await supabase.from("listings").update({ is_active: !s.is_active }).eq("id", s.id);
      if (error) $("#berr").textContent = friendly(error); else { $("#dd").close(); loadListings(); }
    };
    $("#dd").showModal();
    return;
  }

  const open = toMin(s.daily_start) ?? 7 * 60, close = toMin(s.daily_end) ?? 22 * 60;
  const minDate = [today(), s.available_from].filter(Boolean).sort().pop();
  // Default to the next bookable slot: later today if there's time, otherwise the next day
  const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
  let defDate = minDate, defStart = open;
  if (minDate === today()) {
    const next = Math.ceil((nowMin + 15) / 15) * 15;
    if (next + 60 <= close) defStart = Math.max(open, next);
    else { const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1); defDate = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; }
  }
  const defEnd = Math.min(defStart + 120, close);
  const getThere = `<div class="getting"><div class="getting-head"><b>Getting there</b><span class="ctas"><button class="btn o sm" id="useLoc" type="button">Use my location</button><a class="btn o sm" id="fullDir" target="_blank" rel="noopener" href="${esc(directionsUrl(user.ll, [s.lat, s.lng]))}">Step-by-step ↗</a></span></div>
    <div id="routeMap"></div><p class="note" id="routeInfo" style="margin:8px 0 0">Estimated ${walkText(s)} from ${esc(user.name)}.</p></div>`;
  $("#dbody").innerHTML = `${info}${getThere}
    <div class="f two"><div><label for="bd">Date</label><input type="date" id="bd" min="${minDate}" ${s.available_until ? `max="${s.available_until}"` : ""} value="${defDate}"></div><div></div>
    <div><label for="bs">Start</label><select id="bs">${hopts(open, close - 60, defStart)}</select></div>
    <div><label for="be">End</label><select id="be">${hopts(open + 60, close, defEnd)}</select></div></div>
    <p class="note" id="busy" style="margin:8px 0 0"></p>
    <div class="f"><label for="bn">Message to @${esc(s.owner_username)} (optional)</label><textarea id="bn" rows="2" maxlength="500" placeholder="Hi! I need it for my 10 AM class."></textarea></div>
    <div class="err" id="berr" role="alert"></div>
    <div class="tot"><div style="font-size:13px;opacity:.8">Estimated total</div><div class="big" id="bt"></div><dl id="bl"></dl></div>
    <button class="btn p" id="bgo" style="width:100%">Request to book</button>
    <p class="note" style="margin-top:10px">You won't be charged until @${esc(s.owner_username)} approves.</p>`;
  $("#dd").showModal();

  // Walking route on the campus map, from you to the pickup area
  const drawRoute = () => {
    $("#routeInfo").textContent = `Finding a walking route from ${user.name}…`;
    $("#fullDir").href = directionsUrl(user.ll, [s.lat, s.lng]);
    showRoute($("#routeMap"), user.ll, [s.lat, s.lng])
      .then((r) => {
        const how = r.estimated ? "Estimated" : "Walking route:";
        $("#routeInfo").textContent = `${how} ${r.minutes} min · ${miles(r.meters)} mi from ${user.name}. The pickup pin is approximate (within about 100 m); the exact spot is shared after you pay.`;
      })
      .catch(() => { $("#routeMap").innerHTML = ""; $("#routeInfo").textContent = `Estimated ${walkText(s)} from ${user.name}.`; });
  };
  drawRoute();
  $("#useLoc").onclick = () => {
    if (!navigator.geolocation) { $("#routeInfo").textContent = "Location isn’t available in this browser."; return; }
    $("#useLoc").disabled = true; $("#routeInfo").textContent = "Waiting for your permission…";
    navigator.geolocation.getCurrentPosition((p) => {
      meLL = [p.coords.latitude, p.coords.longitude];
      user = { name: "your location", ll: meLL };
      if (!$("#loc option[value=__me]")) $("#loc").add(new Option("Your current location", "__me"));
      $("#loc").value = "__me";
      $("#useLoc").disabled = false;
      drawRoute(); list();
    }, (e) => { $("#useLoc").disabled = false; $("#routeInfo").textContent = e.code === 1 ? "Location permission was denied. Routes start from the spot chosen in Explore." : "Couldn’t get your location."; }, { timeout: 8000 });
  };

  // Already-booked times for this ride
  const { data: busy = [] } = await supabase.rpc("listing_busy_times", { p_listing_id: s.id });
  const range = () => { const d = $("#bd").value; return [localISO(d, +$("#bs").value), localISO(d, +$("#be").value)]; };
  const upd = () => {
    const [a, b] = range(), mins = (b - a) / 60000, e = $("#berr"), go = $("#bgo");
    const clash = (busy || []).find((x) => a < new Date(x.end_at) && b > new Date(x.start_at));
    let m = "";
    if (!$("#bd").value) m = "Choose a date.";
    else if (mins <= 0) m = "End time must be after start time.";
    else if (mins < 15) m = "Bookings must be at least 15 minutes.";
    else if (a < new Date()) m = "That time has already passed.";
    else if (clash) m = `Already booked ${when(clash.start_at)} – ${new Date(clash.end_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`;
    e.textContent = m; go.disabled = !!m;
    const n = Math.max(0, Math.round(mins)), c = cost(s, n);
    const capped = s.minute_price_cents && s.daily_price_cents && n * s.minute_price_cents > s.daily_price_cents;
    $("#bt").textContent = money(c);
    $("#bl").innerHTML = (s.minute_price_cents && !capped ? `<dt>${centsLabel(s.minute_price_cents)}/min × ${n} min</dt>` : `<dt>Daily rate</dt>`) + `<dd>${money(c)}</dd>`;
  };
  $("#busy").textContent = busy?.length ? `Already booked: ${busy.map((x) => when(x.start_at)).join(", ")}` : "";
  ["bs", "be", "bd"].forEach((i) => ($("#" + i).onchange = upd));
  upd();

  $("#bgo").onclick = async () => {
    const [a, b] = range();
    $("#bgo").disabled = true; $("#bgo").textContent = "Sending…";
    const { data, error } = await supabase.rpc("request_booking", { p_listing_id: s.id, p_start: a.toISOString(), p_end: b.toISOString(), p_note: $("#bn").value.trim() || null });
    if (error) { $("#berr").textContent = friendly(error); $("#bgo").disabled = false; $("#bgo").textContent = "Request to book"; return; }
    if ($("#bn").value.trim()) await supabase.from("messages").insert({ booking_id: data.id, sender_id: me.id, body: $("#bn").value.trim() });
    $("#dbody").innerHTML = `<div class="done"><span class="tag">REQUEST SENT</span><h3>Waiting for @${esc(s.owner_username)}.</h3>
      <p>${when(data.start_at)} → ${new Date(data.end_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · ${money(data.subtotal_cents)}</p>
      <p class="note">You'll pay once they approve. Track it under Bookings.</p>
      <div class="ctas center"><button class="btn p" data-chat="${data.id}">Message @${esc(s.owner_username)}</button><button class="btn o" data-close>Done</button></div></div>`;
    refreshBadge();
  };
}

// ---------------------------------------------------------------------
// Bookings inbox + chat
// ---------------------------------------------------------------------
const STATUS = {
  requested: ["Requested", "n"], accepted: ["Approved · awaiting payment", ""], confirmed: ["Paid", ""],
  active: ["Riding now", ""], completed: ["Completed", "n"], declined: ["Declined", "n"],
  cancelled: ["Cancelled", "n"], expired: ["Expired", "n"],
};
const BOOKING_SELECT = "*, listing:listings(id,title,type,pickup_area), renter:profiles!bookings_renter_id_fkey(username), owner:profiles!bookings_owner_id_fkey(username)";
let chatChannel = null;

async function refreshBadge() {
  const { count } = await supabase.from("bookings").select("id", { count: "exact", head: true }).eq("owner_id", me.id).eq("status", "requested");
  $("#mc").textContent = count ? `(${count})` : "";
}

async function inbox() {
  if (chatChannel) { supabase.removeChannel(chatChannel); chatChannel = null; }
  $("#ct").textContent = "Bookings";
  $("#cbody").innerHTML = `<p class="note">Loading…</p>`;
  if (!$("#cd").open) $("#cd").showModal();
  const { data, error } = await supabase.from("bookings").select(BOOKING_SELECT).order("start_at", { ascending: false });
  if (error) { $("#cbody").innerHTML = `<div class="msg">Couldn't load bookings: ${esc(friendly(error))}</div>`; return; }
  if (!data.length) { $("#cbody").innerHTML = `<p>No bookings yet. Request a ride in Explore, or list yours so others can book it.</p>`; return; }
  const row = (b) => {
    const owner = b.owner_id === me.id, other = owner ? b.renter?.username : b.owner?.username, [label, cls] = STATUS[b.status];
    const action = owner && b.status === "requested" ? `<span class="tag act">Needs your reply</span>` : "";
    return `<button class="card in inbox-row" data-th="${b.id}"><div class="row" style="margin:0"><b>${esc(b.listing?.title)}</b><span>${action} <span class="tag ${cls}">${label}</span></span></div>
      <div class="row"><span>${owner ? "Renter" : "Owner"}: @${esc(other)} · ${when(b.start_at)}</span><span>${money(b.subtotal_cents)}</span></div></button>`;
  };
  $("#cbody").innerHTML = `<div class="inbox">${data.map(row).join("")}</div>`;
}

async function chat(id) {
  if (chatChannel) { supabase.removeChannel(chatChannel); chatChannel = null; }
  if (!$("#cd").open) $("#cd").showModal();
  const [{ data: b, error }, { data: msgs = [] }] = await Promise.all([
    supabase.from("bookings").select(BOOKING_SELECT).eq("id", id).single(),
    supabase.from("messages").select("*").eq("booking_id", id).order("created_at"),
  ]);
  if (error) { $("#cbody").innerHTML = `<div class="msg">${esc(friendly(error))}</div>`; return; }
  const owner = b.owner_id === me.id, other = owner ? b.renter?.username : b.owner?.username, [label, cls] = STATUS[b.status];
  $("#ct").textContent = `@${other}`;

  let pickup = "";
  if (!owner && ["confirmed", "active"].includes(b.status)) {
    const { data: pd } = await supabase.from("listing_pickup_details").select("instructions").eq("listing_id", b.listing_id).maybeSingle();
    const ls = LISTINGS.find((x) => x.id === b.listing_id);
    const dir = ls ? `<a class="btn p sm" style="margin-top:10px" target="_blank" rel="noopener" href="${esc(directionsUrl(user.ll, [ls.lat, ls.lng]))}">Directions to pickup ↗</a>` : "";
    if (pd?.instructions || dir) pickup = `<div class="tot" style="margin:10px 0"><div style="font-size:13px;opacity:.8">Pickup instructions</div><div>${esc(pd?.instructions || "Message the owner for the exact spot.")}</div>${dir}</div>`;
  }
  const btn = (act, text, kind = "o") => `<button class="btn ${kind} sm" data-act="${act}">${text}</button>`;
  const actions = [];
  if (owner && b.status === "requested") actions.push(btn("accept", "Approve", "p"), btn("decline", "Decline"));
  if (owner && b.status === "accepted") actions.push(btn("paid", "Confirm payment received", "p"));
  if (owner && b.status === "confirmed") actions.push(btn("pickup", "Confirm pickup", "p"));
  if (owner && b.status === "active") actions.push(btn("return", "Confirm return", "p"));
    if (!owner && ["requested", "accepted", "confirmed"].includes(b.status)) actions.push(btn("cancel", "Cancel booking"));
  const memo = "ZotRider " + String(b.id).slice(0, 8);
  const payNote = !owner && b.status === "accepted"
    ? `<div class="msg">Approved! Pay ${money(b.subtotal_cents)} by ${when(b.payment_due_at)} with Zelle. Ask @${esc(other)} for their Zelle email or phone here in the chat, and put "${esc(memo)}" in the memo. Zelle payments usually can't be reversed, so only pay after you've agreed on the details.</div>
       <button class="btn p sm" id="zsent" type="button">I sent it with Zelle</button>`
    : owner && b.status === "accepted"
    ? `<div class="msg">Waiting for @${esc(other)} to pay ${money(b.subtotal_cents)} with Zelle (memo "${esc(memo)}"). Check your bank app, then tap <b>Confirm payment received</b>. Pickup details unlock for them after that.</div>`
    : "";

  const bubble = (m) => {
    const mine = m.sender_id === me.id;
    return `<div class="bub ${mine ? "mine" : ""}">${esc(m.body)}<time>${new Date(m.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></div>`;
  };
  $("#cbody").innerHTML = `<div class="thread-head"><button class="btn o sm" id="cback">← All bookings</button> <span class="tag ${cls}">${label}</span></div>
    <p class="note" style="margin:12px 0 4px"><b>${esc(b.listing?.title)}</b> · ${when(b.start_at)} → ${new Date(b.end_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · ${money(b.subtotal_cents)}${owner && b.platform_fee_cents ? ` (you receive ${money(b.subtotal_cents - b.platform_fee_cents)})` : ""}</p>
    ${payNote}${pickup}
    ${actions.length ? `<div class="ctas" style="margin:10px 0">${actions.join("")}</div>` : ""}<div class="err" id="aerr" role="alert"></div>
    <div id="log" class="log">${msgs.length ? msgs.map(bubble).join("") : `<p class="note" id="nomsg">No messages yet. Say hi!</p>`}</div>
    <form id="cform" class="composer"><input id="cin" aria-label="Message" placeholder="Type a message" maxlength="2000" autocomplete="off"><button class="btn p" id="csend">Send</button></form>`;
  const log = $("#log");
  log.scrollTop = log.scrollHeight;
  const shown = new Set(msgs.map((m) => m.id));
  const addBubble = (m) => {
    if (shown.has(m.id)) return;   // already on screen (e.g. my own message echoed back live)
    shown.add(m.id);
    $("#nomsg")?.remove();
    log.insertAdjacentHTML("beforeend", bubble(m));
    log.scrollTop = log.scrollHeight;
  };
  $("#zsent")?.addEventListener("click", async () => {
    const body = `I sent ${money(b.subtotal_cents)} with Zelle (memo: ${memo}).`;
    const { data: m, error } = await supabase.from("messages").insert({ booking_id: id, sender_id: me.id, body }).select().single();
    if (error) { $("#aerr").textContent = friendly(error); return; }
    addBubble(m);
    $("#zsent").disabled = true;
    $("#zsent").textContent = "Marked as sent";
  });

  $("#cback").onclick = inbox;
  $("#cform").onsubmit = async (e) => {
    e.preventDefault();
    const body = $("#cin").value.trim();
    if (!body) return;
    $("#cin").value = "";
    const { data: m, error } = await supabase.from("messages").insert({ booking_id: id, sender_id: me.id, body }).select().single();
    if (error) { $("#aerr").textContent = friendly(error); $("#cin").value = body; return; }
    addBubble(m);
  };
  const RPC = { accept: "accept_booking", decline: "decline_booking", pickup: "confirm_pickup", return: "confirm_return", cancel: "cancel_booking", paid: "confirm_payment" };
  document.querySelectorAll("[data-act]").forEach((x) => (x.onclick = async () => {
    if (x.dataset.act === "cancel" && !confirm("Cancel this booking?")) return;
    x.disabled = true;
    const { error } = await supabase.rpc(RPC[x.dataset.act], { p_booking_id: id });
    if (error) { $("#aerr").textContent = friendly(error); x.disabled = false; return; }
    chat(id); refreshBadge();
  }));

  // Live: new messages and status changes for this booking
  chatChannel = supabase.channel(`booking-${id}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `booking_id=eq.${id}` }, (p) => addBubble(p.new))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "bookings", filter: `id=eq.${id}` }, () => chat(id))
    .subscribe();
}

document.addEventListener("click", (e) => {
  const c = e.target.closest("[data-chat]"), t = e.target.closest("[data-th]");
  if (c) { $("#dd").close(); chat(c.dataset.chat); }
  else if (t) chat(t.dataset.th);
});
$("#msgs").onclick = inbox;
$("#cd").addEventListener("close", () => { if (chatChannel) { supabase.removeChannel(chatChannel); chatChannel = null; } });

// ---------------------------------------------------------------------
// List your ride (4 steps) → saved to Supabase
// ---------------------------------------------------------------------
let L = {}, step = 0, photos = [];
function lform() {
  const st = ["Ride", "Location & price", "Availability", "Review"];
  let h = `<div class="prog">${st.map((_, i) => `<i class="${i <= step ? "on" : ""}"></i>`).join("")}</div><span class="eyebrow">Step ${step + 1} of 4 — ${st[step]}</span><div class="f">`;
  if (step === 0) h += `<label for="lt">Type</label><select id="lt"><option value="scooter">E-scooter</option><option value="ebike">E-bike</option><option value="bike">Bike</option></select>
    <label for="ln">Listing title</label><input id="ln" maxlength="80" value="${esc(L.title || "")}" placeholder="e.g. Zot Cruiser"><div class="err" id="e1"></div>
    <label for="lm">Model</label><input id="lm" maxlength="80" value="${esc(L.model || "")}" placeholder="e.g. Xiaomi Pro 4">
    <div class="two"><div><label for="lr">Range (mi, optional)</label><input id="lr" type="number" min="1" max="200" value="${esc(L.range || "")}" placeholder="25"></div><div><label for="ls">Top speed (mph, max 40)</label><input id="ls" type="number" min="1" max="40" value="${esc(L.speed || "")}" placeholder="18"></div></div><div class="err" id="e2"></div>
    <label for="ld2">Description</label><textarea id="ld2" rows="3" maxlength="2000" placeholder="Condition, helmet included, anything renters should know">${esc(L.description || "")}</textarea>
    <label for="lp">Photos (up to 4)</label><input type="file" id="lp" accept="image/*" multiple><div class="prev" id="pv"></div><div class="err" id="e0"></div>`;
  if (step === 1) h += `<div class="two"><div><label for="lpr">Price per minute (¢)</label><input id="lpr" type="number" min="1" max="200" step="1" value="${esc(L.minute || "")}" placeholder="15"></div><div><label for="lpd">Daily price ($)</label><input id="lpd" type="number" min="1" max="500" step="1" value="${esc(L.daily || "")}" placeholder="15"></div></div>
    <p class="note" style="margin:6px 0 0">Fill in one or both. Renters are charged whichever is cheaper.</p><div class="err" id="e3"></div>
    <label for="lpl">Pickup area (shown publicly, about 100 m)</label><select id="lpl">${geoOpt}${spotOpts}${L.pinLL ? `<option value="__pin">Pinned: near ${esc(L.pinArea)}</option>` : ""}</select>
    <label for="lpi">Exact pickup instructions (private, shown after payment)</label><input id="lpi" maxlength="1000" value="${esc(L.instructions || "")}" placeholder="e.g. Bike rack outside Rohan, blue lock">
    <label for="ldr">Return spot</label><input id="ldr" maxlength="200" value="${esc(L.ret || "")}" placeholder="e.g. Return to the same rack"><div class="err" id="e4"></div>`;
  if (step === 2) h += `<div class="two"><div><label for="la">Available from</label><input type="date" id="la" min="${today()}" value="${L.from || today()}"></div><div><label for="lb">Until (optional)</label><input type="date" id="lb" min="${today()}" value="${L.until || ""}"></div>
    <div><label for="lst">Daily start</label><select id="lst">${hopts(6 * 60, 23 * 60, L.st ?? 8 * 60)}</select></div><div><label for="len">Daily end</label><select id="len">${hopts(7 * 60, 24 * 60 - 15, L.en ?? 21 * 60)}</select></div></div><div class="err" id="e5"></div>`;
  if (step === 3) {
    const preview = { id: "preview", type: L.type, title: L.title, model: L.model, pickup_area: L.area, minute_price_cents: L.minute ? Math.round(+L.minute) : null, daily_price_cents: L.daily ? Math.round(L.daily * 100) : null, photo_paths: [] };
    h += `<p class="note">This is how your listing will look:</p><div class="grid" style="display:block"><div class="card in" style="cursor:default"><div class="art">${photos[0] ? `<img src="${photos[0].url}" alt="">` : art(preview)}</div><div class="cb"><h3>${esc(L.title)}</h3><div class="model">${esc([TYPE_LABEL[L.type], L.model].filter(Boolean).join(" · "))}</div><div class="row"><span>${esc(L.area)}</span><span class="price">${priceTag(preview)}</span></div><div class="row"><span>${tm(L.st)}–${tm(L.en)} daily · from ${day(L.from)}${L.until ? ` to ${day(L.until)}` : ""}</span></div></div></div></div><div class="err" id="e6" role="alert"></div>`;
  }
  h += `</div><div class="ctas" style="margin-top:20px">${step ? `<button class="btn o" id="lback">Back</button>` : ""}<button class="btn p" id="lnext">${step === 3 ? "Publish listing" : "Continue"}</button></div>`;
  $("#lbody").innerHTML = h;

  if (step === 0) {
    $("#lt").value = L.type || "scooter";
    const show = () => ($("#pv").innerHTML = photos.map((p) => `<img src="${p.url}" alt="Photo preview">`).join(""));
    show();
    $("#lp").onchange = (e) => {
      const files = [...e.target.files].slice(0, 4);
      const tooBig = files.find((f) => f.size > 6 * 1024 * 1024);
      $("#e0").textContent = tooBig ? "Each photo must be under 6 MB." : "";
      photos = files.filter((f) => f.size <= 6 * 1024 * 1024).map((f) => ({ file: f, url: URL.createObjectURL(f) }));
      show();
    };
  }
  if (step === 1) {
    $("#lpl").value = L.pinLL ? "__pin" : L.area && SPOTS[L.area] ? L.area : "Aldrich Park";
    $("#lpl").onchange = () => {
      if ($("#lpl").value !== "__geo") return;
      const bad = () => { $("#lpl").value = "Aldrich Park"; $("#e3").textContent = "Couldn’t get your location. Choose a campus spot."; };
      if (!navigator.geolocation) return bad();
      navigator.geolocation.getCurrentPosition((p) => {
        L.pinLL = [p.coords.latitude, p.coords.longitude];
        L.pinArea = Object.keys(SPOTS).sort((a, b) => hav(L.pinLL, SPOTS[a]) - hav(L.pinLL, SPOTS[b]))[0];
        keep(); lform();
      }, bad, { timeout: 8000 });
    };
  }
  if (step) $("#lback").onclick = () => { keep(); step--; lform(); };
  $("#lnext").onclick = async () => {
    let ok = true;
    const er = (i, m) => { $("#" + i).textContent = m; if (m) ok = false; };
    if (step === 0) {
      er("e1", $("#ln").value.trim().length >= 3 ? "" : "Give your ride a title (at least 3 characters).");
      const mph = $("#ls").value;
      er("e2", mph && (+mph < 1 || +mph > 40) ? "Top speed must be between 1 and 40 mph." : "");
    }
    if (step === 1) {
      const hr = +$("#lpr").value, dy = +$("#lpd").value;
      er("e3", !hr && !dy ? "Enter a price per minute, a daily price, or both." : hr && (hr < 1 || hr > 200 || !Number.isInteger(hr)) ? "Price per minute must be a whole number of cents, 1–200¢." : dy && (dy < 1 || dy > 500) ? "Daily price must be $1–$500." : $("#lpl").value === "__geo" ? "Choose a pickup area." : "");
      er("e4", $("#ldr").value.trim() ? "" : "Say where renters should return it.");
    }
    if (step === 2) {
      const a = $("#la").value, b = $("#lb").value;
      er("e5", !a ? "Choose a start date." : b && b < a ? "The end date must be after the start date." : +$("#len").value <= +$("#lst").value ? "Daily end must be after daily start." : "");
    }
    if (!ok) return;
    keep();
    if (step < 3) { step++; lform(); return; }
    await publish();
  };
}
function keep() {
  const v = (i) => ($("#" + i) ? $("#" + i).value : undefined);
  const map = { type: "lt", title: "ln", model: "lm", range: "lr", speed: "ls", description: "ld2", minute: "lpr", daily: "lpd", instructions: "lpi", ret: "ldr", from: "la", until: "lb" };
  for (const k in map) { const x = v(map[k]); if (x !== undefined) L[k] = typeof x === "string" ? x.trim() : x; }
  if (v("lst") !== undefined) { L.st = +v("lst"); L.en = +v("len"); }
  if (v("lpl") !== undefined) {
    const p = v("lpl");
    if (p === "__pin") { L.area = `Near ${L.pinArea}`; L.ll = L.pinLL; }
    else if (SPOTS[p]) { L.area = p; L.ll = SPOTS[p]; L.pinLL = null; }
  }
}
async function publish() {
  const btn = $("#lnext"), err = (m) => { $("#e6").textContent = m; btn.disabled = false; btn.textContent = "Publish listing"; };
  btn.disabled = true; btn.textContent = "Publishing…";
  // 1. Upload photos to listing-photos/<your id>/...
  const paths = [];
  for (const p of photos) {
    const ext = (p.file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${me.id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("listing-photos").upload(path, p.file, { contentType: p.file.type });
    if (error) return err("Photo upload failed: " + friendly(error));
    paths.push(path);
  }
  // 2. Save the listing
  const { data, error } = await supabase.from("listings").insert({
    owner_id: me.id, type: L.type, title: L.title, model: L.model || null, description: L.description || null,
    range_miles: L.range ? +L.range : null, top_speed_mph: L.speed ? +L.speed : null,
    minute_price_cents: L.minute ? Math.round(+L.minute) : null, daily_price_cents: L.daily ? Math.round(L.daily * 100) : null,
    pickup_area: L.area, approx_location: `SRID=4326;POINT(${L.ll[1]} ${L.ll[0]})`, return_note: L.ret,
    available_from: L.from, available_until: L.until || null, daily_start: toTime(L.st), daily_end: toTime(L.en),
    photo_paths: paths,
  }).select("id").single();
  if (error) return err("Couldn't publish: " + friendly(error));
  // 3. Private pickup instructions
  if (L.instructions) await supabase.from("listing_pickup_details").insert({ listing_id: data.id, instructions: L.instructions });

  $("#lbody").innerHTML = `<div class="done"><span class="tag">LIVE</span><h3>Your ride is listed.</h3><p>Every signed-in Anteater can see it in Explore now. Requests will show up under Bookings.</p><button class="btn p" data-close>See it in Explore</button></div>`;
  L = {}; photos = []; step = 0;
  loadListings();
}
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-list]")) { step = 0; lform(); $("#ld").showModal(); }
  if (e.target.closest("[data-close]")) {
    document.querySelectorAll("dialog[open]").forEach((d) => d.close());
    if (e.target.textContent.includes("Explore")) location.hash = "#explore";
  }
});
document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));

// ---------------------------------------------------------------------
// Earnings estimator
// ---------------------------------------------------------------------
const eu = () => { const h = +$("#eh").value, c = +$("#ep").value; $("#eo").textContent = money(h * 60 * c); $("#el").textContent = `at ${c}¢/min × ${h} hrs rented per week`; };
$("#eh").oninput = $("#ep").oninput = eu;

// ---------------------------------------------------------------------
// Scroll effects
// ---------------------------------------------------------------------
const nav = $("#nav"), rt = $("#route"), routeLen = rt.getTotalLength(), mks = [...document.querySelectorAll(".mk")], hv = $("#hv"), story = $("#story");
rt.style.strokeDasharray = routeLen;
const copy = [
  ["01 — Move", "Follow the route.", "Rides are parked all over campus. Scroll to trace a ride from Aldrich Park outward."],
  ["02 — Explore", "Listings light up.", "Nearby rides appear with price and distance as the route reaches them."],
  ["03 — Choose", "Pick yours.", "Compare, pick a time, and see the total before you request."],
];
function tick() {
  const y = scrollY;
  nav.classList.toggle("s", y > 20);
  if (!RM) hv.style.transform = `translate(${-y * 0.12}px,${y * 0.08}px) rotate(${-y * 0.01}deg) scale(${1 + y * 0.0004})`;
  const r = story.getBoundingClientRect(), p = RM ? 1 : Math.min(1, Math.max(0, -r.top / (r.height - innerHeight)));
  rt.style.strokeDashoffset = routeLen * (1 - Math.min(1, p * 1.25));
  [0.02, 0.35, 0.7, 0.45, 0.8].forEach((t, i) => mks[i].classList.toggle("on", p >= t || RM));
  const c = copy[p < 0.4 ? 0 : p < 0.75 ? 1 : 2];
  $("#stepL").textContent = c[0]; $("#stepH").textContent = c[1]; $("#stepP").textContent = c[2];
}
addEventListener("scroll", () => requestAnimationFrame(tick), { passive: true });
tick();
const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0.15 });
document.querySelectorAll(".rv").forEach((el, i) => { el.style.transitionDelay = (i % 3) * 120 + "ms"; io.observe(el); });

// ---------------------------------------------------------------------
// Start once auth-guard.js confirms the user
// ---------------------------------------------------------------------
async function start(u) {
  me = u;
  $("#out").innerHTML = `<p class="note">Loading rides…</p>`;
  await loadListings();
  refreshBadge();
  // New, edited or hidden listings show up for everyone without refreshing
  supabase.channel("listings-feed")
    .on("postgres_changes", { event: "*", schema: "public", table: "listings" }, () => loadListings())
    .subscribe();
  // Owners: new requests update the Bookings badge live
  supabase.channel("my-requests")
    .on("postgres_changes", { event: "*", schema: "public", table: "bookings", filter: `owner_id=eq.${me.id}` }, () => refreshBadge())
    .subscribe();
}
if (window.zrUser) start(window.zrUser);
else window.addEventListener("zr:ready", () => start(window.zrUser), { once: true });