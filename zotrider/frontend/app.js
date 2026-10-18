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
// Reviews: stars, "2 hr" style lengths, and the owner's review list
const stars = (n) => "★".repeat(Math.round(n)) + "☆".repeat(5 - Math.round(n));
const lengthText = (m) => m >= 1440 ? `${Math.round(m / 1440)} day${Math.round(m / 1440) > 1 ? "s" : ""}` : m >= 60 ? `${+(m / 60).toFixed(1)} hr` : `${m} min`;
async function loadReviews(s) {
  const box = $("#revs");
  if (!box) return;
  const { data, error } = await supabase.rpc("owner_reviews", { p_owner_id: s.owner_id });
  if (!box.isConnected) return;
  if (error) { box.innerHTML = `<p class="note">Couldn't load reviews: ${esc(friendly(error))}</p>`; return; }
  const head = `<h4>Reviews for @${esc(s.owner_username)}</h4>`;
  if (!data.length) { box.innerHTML = `${head}<p class="note">No reviews yet. Renters can leave one after their ride is returned.</p>`; return; }
  const avg = data.reduce((a, r) => a + r.rating, 0) / data.length;
  box.innerHTML = `${head}<div class="rv-sum"><b>${avg.toFixed(1)}</b><span class="stars" aria-label="${avg.toFixed(1)} out of 5 stars">${stars(avg)}</span><span class="note" style="margin:0">${data.length} review${data.length > 1 ? "s" : ""}</span></div>
    ${data.map((r) => `<div class="rv"><div class="rv-head"><b>@${esc(r.reviewer_username)}</b><span class="stars" aria-label="${r.rating} out of 5 stars">${stars(r.rating)}</span></div>
      <div class="rv-what">Rented ${esc(r.listing_title)} (${esc(TYPE_LABEL[r.listing_type] || "")}) for ${lengthText(r.minutes)} · ${day(r.created_at.slice(0, 10))}</div>
      ${r.comment ? `<p>${esc(r.comment)}</p>` : ""}</div>`).join("")}`;
}

function availableNow(s) {
  const t = today();
    return s.is_active && !s.rented_out && (!s.available_from || s.available_from <= t) && (!s.available_until || s.available_until >= t);
}
// "Available" / "Not available now" / "Rented out"
const statusTag = (s) => s.rented_out
  ? `<span class="tag n">🔒 Rented out</span>`
  : `<span class="tag ${availableNow(s) ? "" : "n"}">${availableNow(s) ? "Available" : "Not available now"}</span>`;
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
  const tag = isMine(s) ? `<span class="tag mine">Your listing${s.rented_out ? " · rented out" : s.is_active ? "" : " · hidden"}</span>` : statusTag(s);
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
        <div>${statusTag(s)}
    <p style="margin-top:12px">${esc(s.description || "No description yet.")}</p>
    <p class="facts"><b>Owner:</b> @${esc(s.owner_username)}${s.owner_review_count ? ` · ★ ${s.owner_rating} (${s.owner_review_count})` : ""}<br>
    <b>Pickup:</b> ${esc(s.pickup_area)} (${walkText(s)} from ${esc(user.name)})<br>
    <b>Return:</b> ${esc(s.return_note || "Same as pickup")}<br>
        ${s.deposit_cents ? `<b>Deposit:</b> ${money(s.deposit_cents)} refundable, paid with the rental<br>` : ""}
    <b>Hours:</b> ${hours}<br><b>Dates:</b> ${esc(dates)}</p></div></div>
    <div class="reviews" id="revs"><p class="note">Loading reviews…</p></div>`;
  // Rented out: locked for everyone until it comes back
  if (s.rented_out) {
    $("#dbody").innerHTML = `${info}<div class="msg">🔒 <b>Rented out right now.</b> ${isMine(s)
      ? "This listing is locked until the ride comes back. When you tap <b>Confirm return</b> in Bookings, it’s removed from ZotRider automatically."
      : "Someone is renting it, so it can’t be booked."}</div>`;
    $("#dd").showModal(); loadReviews(s);
    return;
  }
  if (isMine(s)) {
    $("#dbody").innerHTML = `${info}<div class="msg">This is your listing. Requests for it show up under <b>Bookings</b>.</div>
            <div class="ctas"><button class="btn p" id="editListing">Edit listing</button><button class="btn o" id="toggleActive">${s.is_active ? "Hide this listing" : "Show this listing again"}</button><button class="btn o danger" id="deleteListing">Delete listing</button></div><div class="err" id="berr" role="alert"></div>`;
    $("#editListing").onclick = () => editListing(s);
    $("#deleteListing").onclick = () => deleteListing(s);
    $("#toggleActive").onclick = async () => {
      const { error } = await supabase.from("listings").update({ is_active: !s.is_active }).eq("id", s.id);
      if (error) $("#berr").textContent = friendly(error); else { $("#dd").close(); loadListings(); }
    };
    $("#dd").showModal(); loadReviews(s);
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
  $("#dd").showModal(); loadReviews(s);

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
        $("#bt").textContent = money(c + (s.deposit_cents || 0));
    $("#bl").innerHTML = (s.minute_price_cents && !capped ? `<dt>${centsLabel(s.minute_price_cents)}/min × ${n} min</dt>` : `<dt>Daily rate</dt>`) + `<dd>${money(c)}</dd>`
      + (s.deposit_cents ? `<dt>Refundable deposit</dt><dd>${money(s.deposit_cents)}</dd>` : "");
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
    if (owner && b.status === "completed" && b.deposit_cents > 0 && !b.deposit_returned_at) actions.push(btn("deposit", `Mark ${money(b.deposit_cents)} deposit returned`, "p"));
    if (!owner && ["requested", "accepted", "confirmed"].includes(b.status)) actions.push(btn("cancel", "Cancel booking"));
  const memo = "ZotRider " + String(b.id).slice(0, 8);
  const due = b.subtotal_cents + (b.deposit_cents || 0);   // rental + refundable deposit
  const incl = b.deposit_cents ? ` (includes a ${money(b.deposit_cents)} refundable deposit)` : "";
  const depositNote = b.status === "completed" && b.deposit_cents > 0
    ? b.deposit_returned_at ? `<div class="msg">The ${money(b.deposit_cents)} deposit was returned ✓</div>`
      : owner ? `<div class="msg">Send the ${money(b.deposit_cents)} deposit back to @${esc(other)} with Zelle, then tap <b>Mark deposit returned</b>.</div>`
      : `<div class="msg">The ride is returned, so @${esc(other)} should send back your ${money(b.deposit_cents)} deposit.</div>`
    : "";
  const payNote = !owner && b.status === "accepted"
    ? `<div class="msg">Approved! Pay ${money(due)}${incl} by ${when(b.payment_due_at)} with Zelle. Ask @${esc(other)} for their Zelle email or phone here in the chat, and put "${esc(memo)}" in the memo. Zelle payments usually can't be reversed, so only pay after you've agreed on the details.</div>
       <button class="btn p sm" id="zsent" type="button">I sent it with Zelle</button>`
    : owner && b.status === "accepted"
    ? `<div class="msg">Waiting for @${esc(other)} to pay ${money(due)}${incl} with Zelle (memo "${esc(memo)}"). Check your bank app, then tap <b>Confirm payment received</b>. Pickup details unlock for them after that.</div>`
    : "";
    // Renters can review the owner once the ride is returned
  let reviewBox = "";
  if (!owner && b.status === "completed") {
    const { data: mine } = await supabase.from("reviews").select("rating, comment").eq("booking_id", id).eq("reviewer_id", me.id).maybeSingle();
    reviewBox = mine
      ? `<div class="msg">You rated @${esc(other)} <span class="stars">${stars(mine.rating)}</span>${mine.comment ? `: “${esc(mine.comment)}”` : ""}</div>`
      : `<div class="msg"><b>How was your ride with @${esc(other)}?</b>
          <div class="star-pick" id="rstars" role="group" aria-label="Rating">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}" aria-label="${n} star${n > 1 ? "s" : ""}">★</button>`).join("")}</div>
          <textarea id="rtext" rows="3" maxlength="1000" placeholder="What was the ride like? Was the owner on time?"></textarea>
          <button class="btn p sm" id="rsend" type="button" style="margin-top:10px" disabled>Post review</button></div>`;
  }
  const bubble = (m) => {
    const mine = m.sender_id === me.id;
    return `<div class="bub ${mine ? "mine" : ""}">${esc(m.body)}<time>${new Date(m.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></div>`;
  };
  $("#cbody").innerHTML = `<div class="thread-head"><button class="btn o sm" id="cback">← All bookings</button> <span class="tag ${cls}">${label}</span></div>
    <p class="note" style="margin:12px 0 4px"><b>${esc(b.listing?.title)}</b> · ${when(b.start_at)} → ${new Date(b.end_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · ${money(b.subtotal_cents)}${owner && b.platform_fee_cents ? ` (you receive ${money(b.subtotal_cents - b.platform_fee_cents)})` : ""}</p>
    ${payNote}${pickup}${depositNote}${reviewBox}
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
        const body = `I sent ${money(due)} with Zelle (memo: ${memo}).`;
    const { data: m, error } = await supabase.from("messages").insert({ booking_id: id, sender_id: me.id, body }).select().single();
    if (error) { $("#aerr").textContent = friendly(error); return; }
    addBubble(m);
    $("#zsent").disabled = true;
    $("#zsent").textContent = "Marked as sent";
  });

  $("#cback").onclick = inbox;
  let picked = 0;
    document.querySelectorAll("#rstars button").forEach((bt) => (bt.onclick = () => {
      picked = +bt.dataset.star;
      document.querySelectorAll("#rstars button").forEach((x) => x.classList.toggle("on", +x.dataset.star <= picked));
      $("#rsend").disabled = false;
  }));
  if ($("#rsend")) $("#rsend").onclick = async () => {
    $("#rsend").disabled = true;
    const { error } = await supabase.from("reviews").insert({ booking_id: id, reviewer_id: me.id, reviewee_id: b.owner_id, rating: picked, comment: $("#rtext").value.trim() || null });
    if (error) { $("#aerr").textContent = friendly(error); $("#rsend").disabled = false; return; }
    chat(id); loadListings();
  };
  $("#cform").onsubmit = async (e) => {
    e.preventDefault();
    const body = $("#cin").value.trim();
    if (!body) return;
    $("#cin").value = "";
    const { data: m, error } = await supabase.from("messages").insert({ booking_id: id, sender_id: me.id, body }).select().single();
    if (error) { $("#aerr").textContent = friendly(error); $("#cin").value = body; return; }
    addBubble(m);
  };
  const RPC = { accept: "accept_booking", decline: "decline_booking", pickup: "confirm_pickup", return: "confirm_return", cancel: "cancel_booking", paid: "confirm_payment", deposit: "return_deposit" };
  document.querySelectorAll("[data-act]").forEach((x) => (x.onclick = async () => {
    if (x.dataset.act === "cancel" && !confirm("Cancel this booking?")) return;
        if (x.dataset.act === "return" && !confirm("Confirm the ride is back? This listing will be removed from ZotRider.")) return;
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
// ---------------------------------------------------------------------
// Profile: contact info for Zelle + default listing info
// ---------------------------------------------------------------------
let PROFILE = null; // saved row from profile_details (or null)


// Shared photo picker (profile + listing form): one photo, remove it with ×.
// Items are { file, url } (new) or { path, url } (already uploaded).
function photoPicker(input, preview, items, errEl) {
  input.removeAttribute("multiple");
  const render = () => {
    preview.innerHTML = items.map((it, i) =>
      `<span style="position:relative;display:inline-block"><img src="${esc(it.url)}" alt="Photo"><button type="button" class="x" data-i="${i}" aria-label="Remove photo" style="position:absolute;top:-6px;right:-6px;width:24px;height:24px;font-size:14px;line-height:1">×</button></span>`
    ).join("");
    preview.querySelectorAll("[data-i]").forEach((b) => (b.onclick = () => { items.splice(+b.dataset.i, 1); render(); }));
    input.disabled = items.length >= 1;
  };
  input.onchange = (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > 6 * 1024 * 1024) { if (errEl) errEl.textContent = "The photo must be under 6 MB."; return; }
    if (errEl) errEl.textContent = "";
    items.splice(0, items.length, { file: f, url: URL.createObjectURL(f) });
    render();
  };
  render();
  return render;
}

// Upload new photos and keep the ones already uploaded. Returns storage paths.
async function uploadPhotos(items, prefix = "") {
  const paths = [];
  for (const it of items) {
    if (it.path) { paths.push(it.path); continue; }
    const ext = (it.file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${me.id}/${prefix}${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("listing-photos").upload(path, it.file, { contentType: it.file.type });
    if (error) throw new Error("Photo upload failed: " + friendly(error));
    paths.push(path);
  }
  return paths;
}
async function loadProfile() {
  const { data } = await supabase.from("profile_details").select("*").eq("user_id", me.id).maybeSingle();
  PROFILE = data || null;
  return PROFILE;
}

const mapsLink = (addr) => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(addr);

async function openProfile() {
  $("#pbody").innerHTML = `<p class="note">Loading…</p>`;
  $("#pd").showModal();
  const p = (await loadProfile()) || {};
  const dollars = (c) => (c == null ? "" : c / 100);
  const areaOpts = `<option value="">Choose a campus area…</option>${spotOpts}`;
  const photoItems = (p.default_photo_paths || []).slice(0, 1).map((path) => ({ path, url: photoUrl(path) }));
  $("#pbody").innerHTML = `
    <div class="f">
      <span class="eyebrow">About me</span>
      <p class="note" style="margin:0">Your contact info for Zelle. Only shown to a renter after you approve their booking.</p>
      <label for="pfn">Full name</label>
      <input id="pfn" maxlength="80" value="${esc(p.full_name || "")}" placeholder="Your name">
      <div class="two">
        <div><label for="pph">Phone (Zelle)</label><input id="pph" type="tel" maxlength="30" value="${esc(p.phone || "")}" placeholder="(949) 555-0123"></div>
        <div><label for="pem">Email (Zelle)</label><input id="pem" type="email" maxlength="120" value="${esc(p.contact_email || "")}" placeholder="you@example.com"></div>
      </div>

      <span class="eyebrow" style="margin-top:28px">My ride</span>
      <p class="note" style="margin:0">Fills in the "List your ride" form. You can still change anything for each listing.</p>
      <label for="pty">Type</label>
      <select id="pty"><option value="">Choose…</option><option value="scooter">E-scooter</option><option value="ebike">E-bike</option><option value="bike">Bike</option></select>
      <label for="pti">Listing title</label>
      <input id="pti" maxlength="80" value="${esc(p.default_title || "")}" placeholder="e.g. Zot Cruiser">
      <label for="pmo">Model</label>
      <input id="pmo" maxlength="80" value="${esc(p.default_model || "")}" placeholder="e.g. Xiaomi Pro 4">
      <div class="two">
        <div><label for="prg">Range (mi, optional)</label><input id="prg" type="number" min="1" max="200" value="${p.default_range_miles ?? ""}" placeholder="25"></div>
        <div><label for="psp">Top speed (mph, max 40)</label><input id="psp" type="number" min="1" max="40" value="${p.default_top_speed_mph ?? ""}" placeholder="18"></div>
      </div>
      <label for="pds">Description</label>
      <textarea id="pds" rows="3" maxlength="2000" placeholder="Condition, helmet included, anything renters should know">${esc(p.default_description || "")}</textarea>
      <label for="ppf">Photo</label>
      <input type="file" id="ppf" accept="image/*" multiple>
      <div class="prev" id="ppv">${(p.default_photo_paths || []).map((x) => `<img src="${esc(photoUrl(x))}" alt="">`).join("")}</div>

      <div class="two">
        <div><label for="pmn">Price per minute (¢)</label><input id="pmn" type="number" min="1" max="200" step="1" value="${p.default_minute_cents ?? ""}" placeholder="15"></div>
        <div><label for="pdy">Daily price ($)</label><input id="pdy" type="number" min="1" max="500" step="1" value="${dollars(p.default_daily_cents)}" placeholder="15"></div>
      </div>
      <label for="pdp">Deposit ($)</label>
      <input id="pdp" type="number" min="0" max="500" step="1" value="${dollars(p.default_deposit_cents)}">
      <div class="two">
        <div><label for="pst">Usually available from</label><select id="pst">${hopts(6 * 60, 23 * 60, p.default_daily_start ?? 8 * 60)}</select></div>
        <div><label for="pen">Until</label><select id="pen">${hopts(7 * 60, 24 * 60 - 15, p.default_daily_end ?? 21 * 60)}</select></div>
      </div>

      <label for="ppar">Pickup area (shown publicly, about 100 m)</label>
      <select id="ppar">${areaOpts}</select>
      <label for="ppa">Exact pickup address (private, shown after payment)</label>
      <input id="ppa" maxlength="200" value="${esc(p.default_pickup_address || "")}" placeholder="e.g. Langson Library, Irvine, CA">
      <a class="note" id="ppaLink" target="_blank" rel="noopener">Check on Google Maps ↗</a>

      <label for="prar">Return area (shown publicly)</label>
      <select id="prar">${areaOpts}</select>
      <label for="pra">Exact return address (private, shown after payment)</label>
      <input id="pra" maxlength="200" value="${esc(p.default_return_address || "")}" placeholder="e.g. Same rack as pickup, or an address">
      <a class="note" id="praLink" target="_blank" rel="noopener">Check on Google Maps ↗</a>

      <div class="err" id="perr" role="alert"></div>
    </div>
    <div class="ctas" style="margin-top:20px"><button class="btn p" id="psave">Save profile</button></div>`;

  $("#pty").value = p.default_type || "";
  $("#ppar").value = p.default_pickup_area || "";
  $("#prar").value = p.default_return_area || "";

  // "Check on Google Maps" links: always visible, gray until there's an address
  const link = (inp, a) => {
    const set = () => {
      const v = $(inp).value.trim();
      $(a).href = v ? mapsLink(v) : "#";
      $(a).style.opacity = v ? "1" : "0.4";
      $(a).style.pointerEvents = v ? "auto" : "none";
      $(a).setAttribute("aria-disabled", v ? "false" : "true");
    };
    $(inp).oninput = set;
    set();
  };
  link("#ppa", "#ppaLink");
  link("#pra", "#praLink");

  const renderProfilePhotos = photoPicker($("#ppf"), $("#ppv"), photoItems);

  $("#psave").onclick = async () => {
    const btn = $("#psave");
    const err = (m) => { $("#perr").textContent = m; btn.disabled = false; btn.textContent = "Save profile"; };
    const val = (id) => $(id).value.trim();
    const email = val("#pem"), title = val("#pti"), rg = val("#prg"), sp = val("#psp"), mn = val("#pmn"), dy = val("#pdy");
    const st = +$("#pst").value, en = +$("#pen").value;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err("That email doesn't look right.");
    if (title && title.length < 3) return err("The title needs at least 3 characters.");
    if (rg && (+rg < 1 || +rg > 200)) return err("Range must be 1–200 miles.");
    if (sp && (+sp < 1 || +sp > 40)) return err("Top speed must be between 1 and 40 mph.");
    if (mn && (!Number.isInteger(+mn) || +mn < 1 || +mn > 200)) return err("Price per minute must be a whole number of cents, 1–200¢.");
    if (dy && (+dy < 1 || +dy > 500)) return err("Daily price must be $1–$500.");
    if (en <= st) return err("The end time must be after the start time.");
    btn.disabled = true;
    btn.textContent = "Saving…";

        let paths;
    try { paths = await uploadPhotos(photoItems, "profile-"); } catch (e) { return err(e.message); }

    const row = {
      user_id: me.id,
      full_name: val("#pfn") || null,
      phone: val("#pph") || null,
      contact_email: email || null,
      default_type: $("#pty").value || null,
      default_title: title || null,
      default_model: val("#pmo") || null,
      default_range_miles: rg === "" ? null : Math.round(+rg),
      default_top_speed_mph: sp === "" ? null : Math.round(+sp),
      default_description: val("#pds") || null,
      default_photo_paths: paths,
      default_minute_cents: mn === "" ? null : +mn,
      default_daily_cents: dy === "" ? null : Math.round(+dy * 100),
      default_deposit_cents: val("#pdp") === "" ? 0 : Math.round(+val("#pdp") * 100),
      default_daily_start: st,
      default_daily_end: en,
      default_pickup_area: $("#ppar").value || null,
      default_pickup_address: val("#ppa") || null,
      default_return_area: $("#prar").value || null,
      default_return_address: val("#pra") || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("profile_details").upsert(row);
    if (error) return err("Couldn't save: " + friendly(error));
    PROFILE = row;
        photoItems.splice(0, photoItems.length, ...paths.map((path) => ({ path, url: photoUrl(path) }))); renderProfilePhotos();
    btn.textContent = "Saved ✓";
    setTimeout(() => { btn.disabled = false; btn.textContent = "Save profile"; }, 1500);
  };
}
$("#prof").onclick = openProfile;

// Open "List your ride" with your profile defaults filled in (you can still edit them)
async function openListForm() {
   if (editingId) { L = {}; photos = []; }   // coming from "Edit listing": start a blank form
  editingId = null; keptPhotos = [];
  $("#ld .dh h3").textContent = "List your ride";
  step = 0;
  const fresh = !L.title && !photos.length;   // don't overwrite a form you already started
  if (fresh) {
    const p = PROFILE || (await loadProfile());
    if (p) {
      if (p.default_type) L.type = p.default_type;
      if (p.default_title) L.title = p.default_title;
      if (p.default_model) L.model = p.default_model;
      if (p.default_range_miles) L.range = String(p.default_range_miles);
      if (p.default_top_speed_mph) L.speed = String(p.default_top_speed_mph);
      if (p.default_description) L.description = p.default_description;
      if (p.default_minute_cents) L.minute = String(p.default_minute_cents);
      if (p.default_daily_cents) L.daily = String(p.default_daily_cents / 100);
      if (p.default_deposit_cents) L.deposit = String(p.default_deposit_cents / 100);
      if (p.default_daily_start != null) L.st = p.default_daily_start;
      if (p.default_daily_end != null) L.en = p.default_daily_end;
      if (p.default_pickup_area && SPOTS[p.default_pickup_area]) {
        L.area = p.default_pickup_area;
        L.ll = SPOTS[p.default_pickup_area];
      }
      // Exact addresses go in the private instructions (shown only after payment)
      const notes = [
        p.default_pickup_address && `Pickup: ${p.default_pickup_address}`,
        p.default_return_address && `Return: ${p.default_return_address}`,
      ].filter(Boolean);
      if (notes.length) L.instructions = notes.join(" · ");
      // The public return spot only says the area
      if (p.default_return_area) L.ret = `Return near ${p.default_return_area}`;
      photos = (p.default_photo_paths || []).slice(0, 1).map((path) => ({ path, url: photoUrl(path) }));
    }
  }
  lform();
  $("#ld").showModal();
}
let L = {}, step = 0, photos = [], editingId = null, keptPhotos = [];
// Your profile photo can also be a listing's photo, so never delete it with a listing
const notProfilePhoto = (path) => !path.includes("/profile-");

// New listing: start from your profile's "My ride" details (if you saved any)
async function startListing() {
  if (editingId) { L = {}; photos = []; }
  editingId = null; keptPhotos = []; step = 0;
  $("#ld .dh h3").textContent = "List your ride";
  if (!Object.keys(L).length) {
    const p = PROFILE || (await loadProfile());
    if (p) {
      const area = SPOTS[p.default_pickup_area] ? p.default_pickup_area : null;
      L = {
        type: p.default_type || undefined, title: p.default_title || "", model: p.default_model || "",
        range: p.default_range_miles ?? "", speed: p.default_top_speed_mph ?? "", description: p.default_description || "",
        minute: p.default_minute_cents ?? "", daily: p.default_daily_cents ? p.default_daily_cents / 100 : "",
        st: p.default_daily_start ?? undefined, en: p.default_daily_end ?? undefined,
        instructions: [p.default_pickup_address, p.default_return_address && `Return to: ${p.default_return_address}`].filter(Boolean).join(" · "),
        ret: p.default_return_area || "",
        ...(area ? { area, ll: SPOTS[area] } : {}),
      };
      photos = (p.default_photo_paths || []).slice(0, 1).map((path) => ({ path, url: photoUrl(path) }));
    }
  }
  lform();
  $("#ld").showModal();
}
// Edit: open the same 4-step form, filled in with this listing
async function editListing(s) {
  const { data: pd } = await supabase.from("listing_pickup_details").select("instructions").eq("listing_id", s.id).maybeSingle();
  const spot = SPOTS[s.pickup_area] ? s.pickup_area : null;
  editingId = s.id; keptPhotos = s.photo_paths || [];
  photos = keptPhotos.slice(0, 1).map((path) => ({ path, url: photoUrl(path) }));
  L = {
    type: s.type, title: s.title, model: s.model || "", range: s.range_miles ?? "", speed: s.top_speed_mph ?? "",
    description: s.description || "", minute: s.minute_price_cents ?? "", daily: s.daily_price_cents ? s.daily_price_cents / 100 : "",
    deposit: s.deposit_cents ? s.deposit_cents / 100 : "",
    instructions: pd?.instructions || "", ret: s.return_note || "",
    from: s.available_from || today(), until: s.available_until || "",
    st: toMin(s.daily_start) ?? 8 * 60, en: toMin(s.daily_end) ?? 21 * 60,
    area: s.pickup_area, ll: [s.lat, s.lng],
    pinLL: spot ? null : [s.lat, s.lng], pinArea: spot ? null : String(s.pickup_area).replace(/^Near /, ""),
  };
  step = 0;
  $("#ld .dh h3").textContent = "Edit your ride";
  $("#dd").close();
  lform();
  $("#ld").showModal();
}

// Delete: removed for good if it was never booked, otherwise hidden forever
// (past bookings and reviews still need it)
async function deleteListing(s) {
  if (!confirm(`Delete “${s.title}”? This can’t be undone.`)) return;
  const b = $("#deleteListing");
  b.disabled = true; b.textContent = "Deleting…";
  const { error } = await supabase.rpc("delete_listing", { p_listing_id: s.id });
  if (error) { $("#berr").textContent = friendly(error); b.disabled = false; b.textContent = "Delete listing"; return; }
    const old = (s.photo_paths || []).filter(notProfilePhoto);
  if (old.length) await supabase.storage.from("listing-photos").remove(old);
  $("#dd").close();
  loadListings();
}
function lform() {
  const st = ["Ride", "Location & price", "Availability", "Review"];
  let h = `<div class="prog">${st.map((_, i) => `<i class="${i <= step ? "on" : ""}"></i>`).join("")}</div><span class="eyebrow">Step ${step + 1} of 4 — ${st[step]}</span><div class="f">`;
  if (step === 0) h += `<label for="lt">Type</label><select id="lt"><option value="scooter">E-scooter</option><option value="ebike">E-bike</option><option value="bike">Bike</option></select>
    <label for="ln">Listing title</label><input id="ln" maxlength="80" value="${esc(L.title || "")}" placeholder="e.g. Zot Cruiser"><div class="err" id="e1"></div>
    <label for="lm">Model</label><input id="lm" maxlength="80" value="${esc(L.model || "")}" placeholder="e.g. Xiaomi Pro 4">
    <div class="two"><div><label for="lr">Range (mi, optional)</label><input id="lr" type="number" min="1" max="200" value="${esc(L.range || "")}" placeholder="25"></div><div><label for="ls">Top speed (mph, max 40)</label><input id="ls" type="number" min="1" max="40" value="${esc(L.speed || "")}" placeholder="18"></div></div><div class="err" id="e2"></div>
    <label for="ld2">Description</label><textarea id="ld2" rows="3" maxlength="2000" placeholder="Condition, helmet included, anything renters should know">${esc(L.description || "")}</textarea>
    <label for="lp">Photo</label><input type="file" id="lp" accept="image/*" multiple><div class="prev" id="pv"></div><div class="err" id="e0"></div>`;
  if (step === 1) h += `<div class="two"><div><label for="lpr">Price per minute (¢)</label><input id="lpr" type="number" min="1" max="200" step="1" value="${esc(L.minute || "")}" placeholder="15"></div><div><label for="lpd">Daily price ($)</label><input id="lpd" type="number" min="1" max="500" step="1" value="${esc(L.daily || "")}" placeholder="15"></div></div>
    <p class="note" style="margin:6px 0 0">Fill in one or both. Renters are charged whichever is cheaper.</p><div class="err" id="e3"></div>
    <label for="ldp">Refundable deposit ($, optional)</label><input id="ldp" type="number" min="0" max="500" step="1" value="${esc(L.deposit ?? "")}" placeholder="0"><div class="err" id="e7"></div>
    <label for="lpl">Pickup area (shown publicly, about 100 m)</label><select id="lpl">${geoOpt}${spotOpts}${L.pinLL ? `<option value="__pin">Pinned: near ${esc(L.pinArea)}</option>` : ""}</select>
    <label for="lpi">Exact pickup instructions (private, shown after payment)</label><input id="lpi" maxlength="1000" value="${esc(L.instructions || "")}" placeholder="e.g. Bike rack outside Rohan, blue lock"><a class="note" id="lpiLink" target="_blank" rel="noopener">Check pickup on Google Maps ↗</a>
    <label for="ldr">Return spot</label><input id="ldr" maxlength="200" value="${esc(L.ret || "")}" placeholder="e.g. Return to the same rack"><a class="note" id="ldrLink" target="_blank" rel="noopener">Check return on Google Maps ↗</a><div class="err" id="e4"></div>`;
  if (step === 2) h += `<div class="two"><div><label for="la">Available from</label><input type="date" id="la" min="${today()}" value="${L.from || today()}"></div><div><label for="lb">Until (optional)</label><input type="date" id="lb" min="${today()}" value="${L.until || ""}"></div>
    <div><label for="lst">Daily start</label><select id="lst">${hopts(6 * 60, 23 * 60, L.st ?? 8 * 60)}</select></div><div><label for="len">Daily end</label><select id="len">${hopts(7 * 60, 24 * 60 - 15, L.en ?? 21 * 60)}</select></div></div><div class="err" id="e5"></div>`;
  if (step === 3) {
    const preview = { id: "preview", type: L.type, title: L.title, model: L.model, pickup_area: L.area, minute_price_cents: L.minute ? Math.round(+L.minute) : null, daily_price_cents: L.daily ? Math.round(L.daily * 100) : null, photo_paths: [] };
    h += `<p class="note">This is how your listing will look:</p><div class="grid" style="display:block"><div class="card in" style="cursor:default"><div class="art">${photos[0] ? `<img src="${photos[0].url}" alt="">` : art(preview)}</div><div class="cb"><h3>${esc(L.title)}</h3><div class="model">${esc([TYPE_LABEL[L.type], L.model].filter(Boolean).join(" · "))}</div><div class="row"><span>${esc(L.area)}</span><span class="price">${priceTag(preview)}</span></div><div class="row"><span>${tm(L.st)}–${tm(L.en)} daily · from ${day(L.from)}${L.until ? ` to ${day(L.until)}` : ""}</span></div></div></div></div><div class="err" id="e6" role="alert"></div>`;
  }
  h += `</div><div class="ctas" style="margin-top:20px">${step ? `<button class="btn o" id="lback">Back</button>` : ""}<button class="btn p" id="lnext">${step === 3 ? (editingId ? "Save changes" : "Publish listing") : "Continue"}</button></div>`;
  $("#lbody").innerHTML = h;

  if (step === 0) {
    $("#lt").value = L.type || "scooter";
        photoPicker($("#lp"), $("#pv"), photos, $("#e0"));
  }
  if (step === 1) {
        // "Check on Google Maps" links for pickup and return
    const pick = (text, label) => { const m = text.match(new RegExp(label + ":\\s*([^·]+)", "i")); return m ? m[1].trim() : ""; };
    const setMapLinks = () => {
      const ins = $("#lpi").value.trim(), ret = $("#ldr").value.trim();
      const pickupAddr = pick(ins, "Pickup") || ins;
      const returnAddr = pick(ins, "Return") || ret;
      [["#lpiLink", pickupAddr], ["#ldrLink", returnAddr]].forEach(([a, v]) => {
                if (!$(a)) return;
        $(a).href = v ? mapsLink(v) : "#";
        $(a).style.opacity = v ? "1" : "0.4";
        $(a).style.pointerEvents = v ? "auto" : "none";
        $(a).setAttribute("aria-disabled", v ? "false" : "true");
      });
    };
    $("#lpi").addEventListener("input", setMapLinks);
    $("#ldr").addEventListener("input", setMapLinks);
    setMapLinks();
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
      const dp = $("#ldp").value;
      er("e7", dp && (+dp < 0 || +dp > 500) ? "Deposit must be $0–$500." : "");
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
  const map = { type: "lt", title: "ln", model: "lm", range: "lr", speed: "ls", description: "ld2", minute: "lpr", daily: "lpd", deposit: "ldp", instructions: "lpi", ret: "ldr", from: "la", until: "lb" };
  for (const k in map) { const x = v(map[k]); if (x !== undefined) L[k] = typeof x === "string" ? x.trim() : x; }
  if (v("lst") !== undefined) { L.st = +v("lst"); L.en = +v("len"); }
  if (v("lpl") !== undefined) {
    const p = v("lpl");
    if (p === "__pin") { L.area = `Near ${L.pinArea}`; L.ll = L.pinLL; }
    else if (SPOTS[p]) { L.area = p; L.ll = SPOTS[p]; L.pinLL = null; }
  }
}
async function publish() {
  const editing = editingId, label = editing ? "Save changes" : "Publish listing";
  const btn = $("#lnext"), err = (m) => { $("#e6").textContent = m; btn.disabled = false; btn.textContent = label; };
  btn.disabled = true; btn.textContent = editing ? "Saving…" : "Publishing…";
  // 1. Upload the new photo (a photo that's already uploaded is kept as is)
  let paths;
  try { paths = await uploadPhotos(photos); } catch (e) { return err(e.message); }
  // 2. Save the listing
  const fields = {
    type: L.type, title: L.title, model: L.model || null, description: L.description || null,
    range_miles: L.range ? +L.range : null, top_speed_mph: L.speed ? +L.speed : null,
    minute_price_cents: L.minute ? Math.round(+L.minute) : null, daily_price_cents: L.daily ? Math.round(L.daily * 100) : null,
    deposit_cents: L.deposit ? Math.round(+L.deposit * 100) : 0,
    pickup_area: L.area, approx_location: `SRID=4326;POINT(${L.ll[1]} ${L.ll[0]})`, return_note: L.ret,
    available_from: L.from, available_until: L.until || null, daily_start: toTime(L.st), daily_end: toTime(L.en),
    photo_paths: paths,
  };
  let id = editing;
  if (editing) {
    const { error } = await supabase.from("listings").update(fields).eq("id", editing);
    if (error) return err("Couldn't save: " + friendly(error));
    const removed = keptPhotos.filter((p) => !paths.includes(p) && notProfilePhoto(p));   // photos you swapped out
    if (removed.length) await supabase.storage.from("listing-photos").remove(removed);
  } else {
    const { data, error } = await supabase.from("listings").insert({ owner_id: me.id, ...fields }).select("id").single();
    if (error) return err("Couldn't publish: " + friendly(error));
    id = data.id;
  }
  // 3. Private pickup instructions
  if (L.instructions) await supabase.from("listing_pickup_details").upsert({ listing_id: id, instructions: L.instructions });
  else if (editing) await supabase.from("listing_pickup_details").delete().eq("listing_id", id);

  $("#lbody").innerHTML = editing
    ? `<div class="done"><span class="tag">SAVED</span><h3>Your changes are live.</h3><p>Everyone sees the updated listing in Explore now.</p><button class="btn p" data-close>See it in Explore</button></div>`
    : `<div class="done"><span class="tag">LIVE</span><h3>Your ride is listed.</h3><p>Every signed-in Anteater can see it in Explore now. Requests will show up under Bookings.</p><button class="btn p" data-close>See it in Explore</button></div>`;
  L = {}; photos = []; step = 0; editingId = null; keptPhotos = [];
  loadListings();
}

document.addEventListener("click", (e) => {
    if (e.target.closest("[data-list]")) { openListForm(); }
  if (e.target.closest("[data-close]")) {
    document.querySelectorAll("dialog[open]").forEach((d) => d.close());
    if (e.target.textContent.includes("Explore")) location.hash = "#explore";
  }
});
document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));

// ---------------------------------------------------------------------
// Earnings estimator
// ---------------------------------------------------------------------
const eu = () => { const m = +$("#eh").value, c = +$("#ep").value; $("#eo").textContent = money(m * c); $("#el").textContent = `at ${c}¢/min × ${m} min rented per week`; };
$("#eh").oninput = $("#ep").oninput = eu;

// ---------------------------------------------------------------------
// Scroll effects
// ---------------------------------------------------------------------
const nav = $("#nav"), rt = $("#route"), routeLen = rt.getTotalLength(), mks = [...document.querySelectorAll(".mk")], hv = $("#hv"), story = $("#story");
rt.style.strokeDasharray = routeLen;
const copy = [
  ["01 — Pick up", "Pick up your scooter or bike."],
  ["02 — Ride", "Ride to your destination."],
  ["03 — Return", "Return your scooter or bike."],
];
function tick() {
  const y = scrollY;
  nav.classList.toggle("s", y > 20);
  if (!RM) hv.style.transform = `translate(${-y * 0.12}px,${y * 0.08}px) rotate(${-y * 0.01}deg) scale(${1 + y * 0.0004})`;
  const r = story.getBoundingClientRect(), p = RM ? 1 : Math.min(1, Math.max(0, -r.top / (r.height - innerHeight)));
  rt.style.strokeDashoffset = routeLen * (1 - Math.min(1, p * 1.25));
  [0.02, 0.35, 0.7, 0.45, 0.8].forEach((t, i) => mks[i].classList.toggle("on", p >= t || RM));
  const c = copy[p < 0.4 ? 0 : p < 0.75 ? 1 : 2];
  $("#stepL").textContent = c[0]; $("#stepH").textContent = c[1]; $("#stepP").textContent = c[2] || "";
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