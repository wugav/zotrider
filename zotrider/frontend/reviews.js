// =====================================================================
// ZotRider — Owner reviews page
// Shows every review renters have left for owners, with each owner's
// average, filters (owner, stars) and sorting. Data: all_owner_reviews().
// =====================================================================
import { supabase } from "./supabase.js";

const $ = (s) => document.querySelector(s);
const TYPE_LABEL = { scooter: "E-Scooter", ebike: "E-Bike", bike: "Bike" };
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const stars = (n) => "★".repeat(Math.floor(n)) + "☆".repeat(5 - Math.floor(n));
const lengthText = (m) => m >= 1440 ? `${Math.round(m / 1440)} day${Math.round(m / 1440) > 1 ? "s" : ""}` : m >= 60 ? `${+(m / 60).toFixed(1)} hr` : `${m} min`;
const date = (iso) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

let REVIEWS = [];

async function load() {
  const { data, error } = await supabase.rpc("all_owner_reviews");
  if (error) {
    $("#list").innerHTML = `<div class="msg">Couldn't load reviews: ${esc(error.message)}</div>`;
    return;
  }
  REVIEWS = data;
  if (!REVIEWS.length) {
    $("#owners").innerHTML = "";
    $("#list").innerHTML = `<div class="empty"><h3>No reviews yet.</h3><p class="note">Renters can review an owner after the owner confirms the ride was returned.</p><a class="btn p" href="index.html">Find a ride</a></div>`;
    return;
  }
  owners();
  render();
}

// One card per owner: average stars + number of reviews, best rated first
function owners() {
  const byOwner = new Map();
  for (const r of REVIEWS) {
    const o = byOwner.get(r.owner_id) || { id: r.owner_id, name: r.owner_username, sum: 0, n: 0 };
    o.sum += r.rating; o.n += 1;
    byOwner.set(r.owner_id, o);
  }
  const list = [...byOwner.values()].sort((a, b) => b.sum / b.n - a.sum / a.n || b.n - a.n);
  $("#owners").innerHTML = list.map((o) => {
    const avg = o.sum / o.n;
    return `<button class="rp-owner" type="button" data-owner="${o.id}" aria-pressed="false"><b>@${esc(o.name)}</b>
      <span class="big">${avg.toFixed(1)}</span><span class="stars" aria-label="${avg.toFixed(1)} out of 5 stars">${stars(avg)}</span>
      <small>${o.n} review${o.n > 1 ? "s" : ""}</small></button>`;
  }).join("");
  $("#fOwner").innerHTML = `<option value="">All owners</option>` + list.map((o) => `<option value="${o.id}">@${esc(o.name)}</option>`).join("");
}

function render() {
  const owner = $("#fOwner").value, min = +$("#fStars").value, sort = $("#fSort").value;
  let r = REVIEWS.filter((x) => (!owner || x.owner_id === owner) && (!min || x.rating === min));
  r.sort(sort === "high" ? (a, b) => b.rating - a.rating || b.created_at.localeCompare(a.created_at)
       : sort === "low" ? (a, b) => a.rating - b.rating || b.created_at.localeCompare(a.created_at)
       : (a, b) => b.created_at.localeCompare(a.created_at));

  document.querySelectorAll(".rp-owner").forEach((b) => b.setAttribute("aria-pressed", b.dataset.owner === owner));
  $("#count").textContent = `${r.length} review${r.length === 1 ? "" : "s"}`;
  $("#list").innerHTML = r.length ? r.map((x) => `<article class="rp-card">
      <div class="rp-head"><span class="who"><b>@${esc(x.reviewer_username)}</b> reviewed <b>@${esc(x.owner_username)}</b></span>
        <span class="stars" aria-label="${x.rating} out of 5 stars">${stars(x.rating)}</span></div>
      <div class="rp-what">Rented ${esc(x.listing_title)} (${esc(TYPE_LABEL[x.listing_type] || "")}) for ${lengthText(x.minutes)} · ${date(x.created_at)}</div>
      ${x.comment ? `<p>${esc(x.comment)}</p>` : `<p class="note" style="margin:0">No written review.</p>`}
    </article>`).join("")
    : `<div class="msg">No reviews match these filters.</div>`;
}

$("#owners").addEventListener("click", (e) => {
  const b = e.target.closest("[data-owner]");
  if (!b) return;
  $("#fOwner").value = $("#fOwner").value === b.dataset.owner ? "" : b.dataset.owner;   // tap again to clear
  render();
});
["fOwner", "fStars", "fSort"].forEach((id) => ($("#" + id).onchange = render));

if (window.zrUser) load();
else window.addEventListener("zr:ready", load, { once: true });