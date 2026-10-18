// =====================================================================
// ZotRider Guide — a small chat helper that answers questions about the
// site and can take you to the right place (Explore, List your ride,
// Bookings, Reviews, Profile). Runs entirely in the browser: no API key,
// no cost. Add with: <script type="module" src="helper.js"></script>
// =====================================================================

const CONTACT = "rrajewic@uci.edu";

// ---------------------------------------------------------------------
// Actions the guide can do for you
// ---------------------------------------------------------------------
const onHome = () => !!document.getElementById("explore");
const goHome = (hash = "") => (location.href = "index.html" + hash);
const ACTIONS = {
  explore: { label: "Show me rides", run: () => onHome() ? document.getElementById("explore").scrollIntoView({ behavior: "smooth" }) : goHome("#explore") },
  list:    { label: "List my ride", run: () => { const b = document.querySelector("[data-list]"); b ? b.click() : goHome(); } },
  bookings:{ label: "Open Bookings", run: () => { const b = document.getElementById("msgs"); b ? b.click() : goHome(); } },
  reviews: { label: "See reviews", run: () => (location.href = "reviews.html") },
  profile: { label: "Open my profile", run: () => { const b = document.getElementById("prof"); b ? b.click() : goHome(); } },
  owners:  { label: "Earnings estimator", run: () => onHome() ? document.getElementById("owners")?.scrollIntoView({ behavior: "smooth" }) : goHome("#owners") },
  email:   { label: "Email us", run: () => (location.href = `mailto:${CONTACT}`) },
};

// ---------------------------------------------------------------------
// What the guide knows. Each topic: words that trigger it, an answer,
// buttons that do something, and follow-up suggestions.
// ---------------------------------------------------------------------
const TOPICS = [
  {
    id: "rent", chip: "How do I rent a ride?",
    words: ["rent", "book", "borrow", "find", "ride", "reserve", "request", "get a scooter", "get a bike", "how do i start"],
    answer: `Renting takes 4 steps:
      <ol><li>Find a ride in <b>Explore</b>. Pick your spot so rides are sorted by distance.</li>
      <li>Open it, choose a date, start and end time, and tap <b>Request to book</b>.</li>
      <li>The owner approves. Then you pay them (see “How do I pay?”).</li>
      <li>Once they confirm payment, the exact pickup spot unlocks in <b>Bookings</b>.</li></ol>`,
    actions: ["explore"], next: ["price", "pay", "cancel"],
  },
  {
    id: "price", chip: "How does pricing work?",
    words: ["price", "pricing", "cost", "how much", "cents", "minute", "charge", "fee", "expensive", "cheap", "daily", "per day", "total"],
    answer: `Owners set their own price in <b>cents per minute</b>, a <b>daily price</b>, or both.
      <ul><li>With both, you pay per minute but never more than the daily price for a day.</li>
      <li>Bookings are at least 15 minutes and at most 14 days.</li>
      <li>You see the exact total before you request, and you’re not charged until the owner approves.</li></ul>
      Tip: use the <b>Max ¢/min</b> slider and <b>Lowest price</b> sort in Explore.`,
    actions: ["explore"], next: ["rent", "pay"],
  },
  {
    id: "pay", chip: "How do I pay?",
    words: ["pay", "payment", "zelle", "venmo", "money", "paid", "memo", "charged", "refund"],
    answer: `After the owner approves, open the booking in <b>Bookings</b>. Ask the owner for their Zelle email or phone in the chat, send the amount shown, and put the memo it gives you (like “ZotRider 1a2b3c4d”). Then tap <b>I sent it with Zelle</b>.
      <br><br>Zelle payments usually can’t be undone, so only pay after you’ve agreed on the details in the chat.`,
    actions: ["bookings"], next: ["pickup", "cancel"],
  },
  {
    id: "pickup", chip: "Where do I pick it up?",
    words: ["pickup", "pick up", "where", "location", "address", "find the scooter", "directions", "route", "map", "walk", "return", "drop off", "drop-off"],
    answer: `Each listing shows an approximate pickup area (within about 100 m) and a walking route from where you are. Tap <b>Use my location</b> for a route from your current spot, or <b>Step-by-step</b> for full directions.
      <br><br>The <b>exact</b> pickup spot and instructions appear in <b>Bookings</b> once your payment is confirmed. The listing also says where to return it.`,
    actions: ["explore", "bookings"], next: ["pay", "safety"],
  },
  {
    id: "list", chip: "How do I list my scooter or bike?",
    words: ["list", "listing", "post", "my scooter", "my bike", "my ride", "owner", "lend", "earn", "make money", "sell", "publish"],
    answer: `Tap <b>List your ride</b> and fill in 4 steps:
      <ol><li><b>Ride:</b> type, title, model, top speed (max 40 mph), photos.</li>
      <li><b>Location &amp; price:</b> price per minute and/or per day, pickup area, private pickup instructions, return spot.</li>
      <li><b>Availability:</b> dates and daily hours.</li>
      <li><b>Review</b> and publish. It shows up for everyone right away.</li></ol>
      You approve every request before anyone rides.`,
    actions: ["list", "owners"], next: ["approve", "price"],
  },
  {
    id: "approve", chip: "I got a request. Now what?",
    words: ["approve", "accept", "decline", "request came", "got a request", "needs your reply", "confirm", "pickup confirm", "returned"],
    answer: `Open <b>Bookings</b>. Requests waiting on you say “Needs your reply.”
      <ol><li><b>Approve</b> or <b>Decline</b>.</li>
      <li>When the money arrives, tap <b>Confirm payment received</b>. This unlocks your pickup instructions for the renter.</li>
      <li>Tap <b>Confirm pickup</b> when they take it, and <b>Confirm return</b> when it’s back.</li></ol>
      After the return, the renter can leave you a review.`,
    actions: ["bookings"], next: ["reviews", "cancel"],
  },
  {
    id: "cancel", chip: "Can I cancel?",
    words: ["cancel", "cancellation", "change", "reschedule", "back out", "no show"],
    answer: `Renters can cancel from <b>Bookings</b> until the ride starts. Owners can decline a new request but can’t cancel once they’ve approved it, so only approve what you can honor.
      <br><br>If plans change after you’ve paid, message the other person in the booking chat to sort out a refund.`,
    actions: ["bookings"], next: ["pay", "rent"],
  },
  {
    id: "reviews", chip: "How do reviews work?",
    words: ["review", "reviews", "rating", "stars", "star", "feedback", "trust", "rate"],
    answer: `After the owner confirms the ride was returned, the renter sees a star picker in <b>Bookings</b> and can write a review (one per booking).
      <br><br>Owner ratings appear on listing cards, and every review is on the <b>Reviews</b> page.`,
    actions: ["reviews", "bookings"], next: ["rent", "list"],
  },
  {
    id: "account", chip: "Account and sign-in",
    words: ["account", "login", "log in", "sign in", "sign up", "email", "uci email", "password", "profile", "username", "log out", "logout"],
    answer: `ZotRider is only for Anteaters, so you sign in with Google using your <b>@uci.edu</b> email. No separate password.
      <br><br>Use <b>Profile</b> to update your details and <b>Log out</b> in the top bar to sign out.`,
    actions: ["profile"], next: ["rent", "list"],
  },
  {
    id: "safety", chip: "Safety tips",
    words: ["safe", "safety", "helmet", "rules", "speed", "mph", "law", "accident", "crash", "damage", "broken", "stolen"],
    answer: `<ul><li>Wear a helmet. California law requires one for riders under 18 on bikes and e-scooters, and it’s smart for everyone.</li>
      <li>Follow UCI’s bike and scooter rules: ride on bike paths, not walkways.</li>
      <li>Listings are capped at 40 mph.</li>
      <li>Check the ride over at pickup, and message the owner right away about any damage.</li></ul>
      The links in the footer go to the DMV and UCI safety pages.`,
    actions: [], next: ["pickup", "contact"],
  },
  {
    id: "contact", chip: "Talk to a person",
    words: ["contact", "help", "support", "human", "person", "problem", "issue", "bug", "report", "scam", "email"],
    answer: `For anything I can’t help with, email <b>${CONTACT}</b>. For a problem with a specific booking, message the other person in that booking’s chat first.`,
    actions: ["email"], next: ["cancel", "pay"],
  },
];
const byId = Object.fromEntries(TOPICS.map((t) => [t.id, t]));
const GREETING = ["hi", "hey", "hello", "yo", "sup", "what's up", "whats up"];
const THANKS = ["thanks", "thank you", "ty", "thx", "appreciate"];

// Pick the topic whose trigger words best match what was typed
function match(text) {
  const q = " " + text.toLowerCase().replace(/[^a-z0-9¢$ ]/g, " ").replace(/\s+/g, " ") + " ";
  let best = null, bestScore = 0;
  for (const t of TOPICS) {
    let score = 0;
    for (const w of t.words) if (q.includes(" " + w + " ") || (w.length > 4 && q.includes(w))) score += w.split(" ").length + 1;
    if (score > bestScore) { best = t; bestScore = score; }
  }
  return best;
}

// ---------------------------------------------------------------------
// The chat window
// ---------------------------------------------------------------------
const css = `
.zg-fab{position:fixed;right:20px;bottom:20px;z-index:60;display:flex;align-items:center;gap:8px;padding:12px 18px;border:0;border-radius:99px;
  background:var(--g,#0064A4);color:#fff;font:600 15px/1 Inter,system-ui,sans-serif;cursor:pointer;box-shadow:0 10px 30px rgba(0,40,80,.3);transition:transform .2s}
.zg-fab:hover{transform:translateY(-2px)}.zg-fab svg{width:20px;height:20px}
.zg-panel{position:fixed;right:20px;bottom:20px;z-index:61;width:min(380px,calc(100vw - 32px));height:min(560px,calc(100vh - 40px));display:flex;flex-direction:column;
  background:var(--card,#fff);color:var(--ink,#101A26);border:1px solid var(--line,#D5E3EC);border-radius:22px;box-shadow:0 24px 60px rgba(0,30,60,.3);overflow:hidden;
  font:400 15px/1.5 Inter,system-ui,sans-serif}
.zg-panel[hidden]{display:none}
.zg-head{display:flex;align-items:center;gap:10px;padding:14px 16px;background:var(--g,#0064A4);color:#fff}
.zg-head b{font-size:16px}.zg-head small{display:block;opacity:.8;font-size:12px}
.zg-head .zg-x{margin-left:auto;width:34px;height:34px;border-radius:50%;border:0;background:rgba(255,255,255,.15);color:#fff;font-size:20px;cursor:pointer}
.zg-dot{width:36px;height:36px;border-radius:50%;background:var(--l,#FFD200);color:#171A18;display:grid;place-items:center;font-weight:800}
.zg-log{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px}
.zg-b{max-width:88%;padding:10px 14px;border-radius:16px;font-size:14px}
.zg-b ol,.zg-b ul{margin:6px 0;padding-left:20px}.zg-b li{margin:3px 0}
.zg-bot{align-self:flex-start;background:var(--bg,#F3F8FB);border:1px solid var(--line,#D5E3EC);border-bottom-left-radius:4px}
.zg-me{align-self:flex-end;background:var(--g,#0064A4);color:#fff;border-bottom-right-radius:4px}
.zg-acts{display:flex;flex-wrap:wrap;gap:6px;align-self:flex-start}
.zg-act{padding:8px 14px;border-radius:99px;border:0;background:var(--l,#FFD200);color:#171A18;font:600 13px/1 Inter,system-ui,sans-serif;cursor:pointer}
.zg-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 10px}
.zg-chip{padding:7px 12px;border-radius:99px;border:1px solid var(--line,#D5E3EC);background:transparent;color:var(--ink,#101A26);font:500 13px/1.2 Inter,system-ui,sans-serif;cursor:pointer;text-align:left}
.zg-chip:hover{border-color:var(--gt,#0064A4);color:var(--gt,#0064A4)}
.zg-form{display:flex;gap:8px;padding:12px;border-top:1px solid var(--line,#D5E3EC)}
.zg-form input{flex:1;min-width:0;padding:10px 14px;border-radius:99px;border:1px solid var(--line,#D5E3EC);background:var(--bg,#F3F8FB);color:inherit;font:inherit}
.zg-form button{padding:0 16px;border-radius:99px;border:0;background:var(--g,#0064A4);color:#fff;font-weight:600;cursor:pointer}
@media (prefers-reduced-motion:reduce){.zg-fab{transition:none}}
`;
document.head.append(Object.assign(document.createElement("style"), { textContent: css }));

const fab = Object.assign(document.createElement("button"), { className: "zg-fab", type: "button" });
fab.setAttribute("aria-label", "Open the ZotRider guide");
fab.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>Need help?`;

const panel = document.createElement("section");
panel.className = "zg-panel";
panel.hidden = true;
panel.setAttribute("role", "dialog");
panel.setAttribute("aria-label", "ZotRider guide");
panel.innerHTML = `
  <div class="zg-head"><span class="zg-dot" aria-hidden="true">Z</span><div><b>ZotRider Guide</b><small>Ask me how anything works</small></div>
    <button class="zg-x" type="button" aria-label="Close guide">×</button></div>
  <div class="zg-log" aria-live="polite"></div>
  <div class="zg-chips"></div>
  <form class="zg-form"><input aria-label="Ask a question" placeholder="Ask a question…" maxlength="200" autocomplete="off"><button>Send</button></form>`;
document.body.append(fab, panel);

const log = panel.querySelector(".zg-log"), chips = panel.querySelector(".zg-chips"), input = panel.querySelector("input");
const scroll = () => (log.scrollTop = log.scrollHeight);

function say(html, who = "bot") {
  const d = document.createElement("div");
  d.className = `zg-b zg-${who}`;
  if (who === "me") d.textContent = html; else d.innerHTML = html;
  log.append(d); scroll();
}
function actions(ids) {
  if (!ids?.length) return;
  const row = document.createElement("div");
  row.className = "zg-acts";
  ids.forEach((id) => {
    const b = Object.assign(document.createElement("button"), { className: "zg-act", type: "button", textContent: ACTIONS[id].label + " →" });
    b.onclick = () => { close(); ACTIONS[id].run(); };
    row.append(b);
  });
  log.append(row); scroll();
}
function suggest(ids) {
  chips.innerHTML = "";
  ids.forEach((id) => {
    const t = byId[id];
    const c = Object.assign(document.createElement("button"), { className: "zg-chip", type: "button", textContent: t.chip });
    c.onclick = () => ask(t.chip, t);
    chips.append(c);
  });
}
function answer(t) {
  say(t.answer);
  actions(t.actions);
  suggest(t.next);
}
function ask(text, topic) {
  say(text, "me");
  const q = text.toLowerCase().trim();
  setTimeout(() => {
    if (topic) return answer(topic);
    if (THANKS.some((w) => q.includes(w))) { say("Anytime! Anything else?"); return suggest(["rent", "list", "pay"]); }
    const t = match(q);
    if (t) return answer(t);
    if (GREETING.some((w) => q === w || q.startsWith(w + " "))) { say("Hey! What can I help you with?"); return suggest(["rent", "list", "price", "pay"]); }
    say(`I’m not sure about that one. Try one of these, or email <b>${CONTACT}</b>.`);
    suggest(["rent", "list", "price", "pay", "contact"]);
  }, 250);
}

let started = false;
function open() {
  panel.hidden = false; fab.hidden = true;
  if (!started) {
    started = true;
    say("Hi! I’m the ZotRider guide 🛴 I can explain how renting and listing work, or take you where you need to go. What would you like to do?");
    suggest(["rent", "list", "price", "pay", "pickup", "reviews"]);
  }
  input.focus();
}
function close() { panel.hidden = true; fab.hidden = false; fab.focus(); }

fab.onclick = open;
panel.querySelector(".zg-x").onclick = close;
panel.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
panel.querySelector("form").onsubmit = (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  ask(text);
};