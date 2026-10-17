const $=s=>document.querySelector(s),RM=matchMedia('(prefers-reduced-motion:reduce)').matches;
const SPOTS={"Aldrich Park":[33.6459,-117.8427],"Langson Library":[33.6476,-117.8412],"Student Center":[33.6491,-117.8426],"ARC":[33.6500,-117.8273],"Engineering Hall":[33.6431,-117.8413],"Mesa Court":[33.6527,-117.8466]};
let S=[
{id:7,t:"bike",n:"Campus Cruiser",m:"Trek FX 2 hybrid",p:3,loc:"Langson Library",c:"#0064A4",avail:1,sp:"21-speed · Lock included",o:"Jordan P.",d:"Comfortable hybrid for Irvine’s bike paths. Lock and light included.",drop:"Return to Langson Library.",b:[[10,12]]},
{id:8,t:"bike",n:"Zot E-Bike",m:"Rad Mini e-bike",p:8,loc:"Student Center",c:"#C9A000",avail:1,sp:"Pedal assist · 25 mi range",o:"Sam L.",d:"Pedal-assist e-bike that makes the hills easy. Helmet included.",drop:"Return to the Student Center rack.",b:[]},
{id:9,t:"scooter",n:"Quick Zip",m:"Segway Ninebot E2",p:0.15,u:"min",loc:"Engineering Hall",c:"#171A18",avail:1,rng:"15 mi",spd:"15 mph",o:"Tina H.",d:"Priced per minute, so it suits quick hops between buildings.",drop:"Return to Engineering Hall or Aldrich Park.",b:[]},
{id:1,n:"Apex Glide",m:"Segway Ninebot Max G2",p:5,loc:"Student Center",c:"#0064A4",avail:1,rng:"34 mi",spd:"22 mph",o:"Maya R.",d:"Smooth, reliable, with a front headlight. Battery charged before every rental.",drop:"Return to the Student Center rack or Langson Library.",b:[[12,14]]},
{id:2,n:"Zot Cruiser",m:"Xiaomi Pro 4",p:4,loc:"Langson Library",c:"#57C7F5",avail:1,rng:"34 mi",spd:"15 mph",o:"Daniel K.",d:"Light and easy to carry. Great for short hops between classes.",drop:"Return to Langson Library or Aldrich Park.",b:[[9,11]]},
{id:3,n:"Night Lime",m:"Apollo City Pro",p:7,loc:"Engineering Hall",c:"#C9A000",avail:1,rng:"40 mi",spd:"30 mph",o:"Priya S.",d:"Faster scooter with dual suspension. Helmet included.",drop:"Return to Engineering Hall only.",b:[[15,18]]},
{id:4,n:"Gray Ghost",m:"Hiboy S2",p:3,loc:"Mesa Court",c:"#5B6B7A",avail:0,rng:"17 mi",spd:"19 mph",o:"Chris T.",d:"Budget-friendly option for quick errands near the residence halls.",drop:"Return to Mesa Court.",b:[[8,22]]},
{id:5,n:"Anteater One",m:"Segway Ninebot F40",p:4,loc:"ARC",c:"#0064A4",avail:1,rng:"25 mi",spd:"18 mph",o:"Leo W.",d:"Sturdy tires, comfortable deck. Good for bumpy paths.",drop:"Return to the ARC or Student Center.",b:[]},
{id:6,n:"Peter’s Pick",m:"NIU KQi3 Pro",p:6,loc:"Aldrich Park",c:"#171A18",avail:1,rng:"31 mi",spd:"20 mph",o:"Ana G.",d:"Folds fast, rides quiet. Pickup right at the park.",drop:"Return to Aldrich Park or Langson Library.",b:[[13,15]]}];
let user={name:"Aldrich Park",ll:SPOTS["Aldrich Park"]},view="list",sel=null;
const hav=(a,b)=>{const r=x=>x*Math.PI/180,R=3958.8,dl=r(b[0]-a[0]),dn=r(b[1]-a[1]);const h=Math.sin(dl/2)**2+Math.cos(r(a[0]))*Math.cos(r(b[0]))*Math.sin(dn/2)**2;return 2*R*Math.asin(Math.sqrt(h))};
const dist=s=>hav(user.ll,SPOTS[s.loc]);
const opts=Object.keys(SPOTS).map(k=>`<option>${k}</option>`).join("");
const geoOpt=`<option value="__geo">Use my current location</option>`;let meLL=null;
$("#loc").innerHTML=geoOpt+opts;$("#heroLoc").innerHTML=geoOpt+opts;$("#loc").value="Aldrich Park";$("#heroLoc").value="Aldrich Park";
const art=s=>`<svg viewBox="0 0 400 240" style="--sc:${s.c}"><use href="#${s.t=="bike"?"bk":"sc"}"/></svg>`,fmt=x=>"$"+(Number.isInteger(x)?x:x.toFixed(2)),hp=s=>s.u=="min"?s.p*60:s.p,cost=(s,m)=>Math.round((s.u=="min"?m*s.p:m/60*s.p)*100)/100;
function list(){
 const max=+$("#max").value,av=$("#av").checked;
 let r=S.filter(s=>hp(s)<=max&&(!av||s.avail)&&($("#type").value=="all"||(s.t||"scooter")==$("#type").value));
 r.sort($("#sort").value=="p"?(a,b)=>hp(a)-hp(b):(a,b)=>dist(a)-dist(b));
 if(!r.length){$("#out").innerHTML=`<div class="msg">No rides match these filters. Try raising the max price or turning off “Available only”.</div>`;return}
 const card=(s,i)=>`<button class="card ${i==0&&view=="list"?"f":""} ${sel==s.id?"hl":""}" data-id="${s.id}" style="transition-delay:${i*60}ms"><div class="art">${art(s)}</div><div class="cb"><span class="tag ${s.avail?"":"n"}">${s.avail?"Available":"Unavailable now"}</span><h3 style="margin-top:12px">${s.n}</h3><div style="font-size:14px;opacity:.75">${s.m}</div><div class="row"><span>${s.loc} · ${dist(s).toFixed(2)} mi</span><span class="price">${fmt(s.p)}<small style="font-size:13px;font-weight:500">/${s.u||"hr"}</small></span></div><div class="row"><span>Owner: ${s.o}</span><span style="font-weight:600;color:var(--gt)">View details →</span></div></div></button>`;
 if(view=="list")$("#out").innerHTML=`<div class="grid">${r.map(card).join("")}</div>`;
 else{
  const xs=Object.values(SPOTS),la=xs.map(x=>x[0]),ln=xs.map(x=>x[1]),mn=[Math.min(...la),Math.min(...ln)],mx=[Math.max(...la),Math.max(...ln)];
  const P=ll=>[60+(ll[1]-mn[1])/(mx[1]-mn[1])*480,350-(ll[0]-mn[0])/(mx[0]-mn[0])*300];
  const you=P(user.ll).map(v=>Math.min(560,Math.max(40,v))),pins=r.map(s=>{const p=P(SPOTS[s.loc]);return `<g class="pin ${sel==s.id?"on":""}" data-id="${s.id}" tabindex="0" role="button" aria-label="${s.n}, ${fmt(s.p)} per ${s.u=="min"?"minute":"hour"}, ${s.loc}"><circle cx="${p[0]}" cy="${p[1]}" r="11" fill="#0064A4" stroke="#FFD200" stroke-width="3"/><text x="${p[0]}" y="${p[1]-20}" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">${fmt(s.p)}</text></g>`}).join("");
  const cur=r.find(s=>s.id==sel)||r[0];
  $("#out").innerHTML=`<div class="mapside"><div class="mapbox"><svg viewBox="0 0 600 400" role="img" aria-label="Demo map of pickup spots"><rect width="600" height="400" fill="var(--card)"/><g fill="none" stroke="var(--line)" stroke-width="3"><circle cx="300" cy="200" r="80"/><path d="M0 120C200 100 380 300 600 280M120 400C200 260 420 100 560 0"/></g><circle cx="${you[0]}" cy="${you[1]}" r="8" fill="#e5484d"/><text x="${you[0]+12}" y="${you[1]+4}" font-size="12" fill="currentColor">You (${user.name})</text>${pins}</svg><p class="note" style="padding:0 16px">Schematic demo map, scaled from approximate coordinates. Not a live map.</p></div><div><div class="grid" style="display:block">${card(cur,1)}</div></div></div>`}
 document.querySelectorAll(".card").forEach(c=>requestAnimationFrame(()=>c.classList.add("in")));
}
$("#out").addEventListener("click",e=>{const p=e.target.closest(".pin"),c=e.target.closest(".card");if(p){sel=+p.dataset.id;list()}else if(c)openD(+c.dataset.id)});
$("#out").addEventListener("keydown",e=>{const p=e.target.closest(".pin");if(p&&(e.key=="Enter"||e.key==" ")){e.preventDefault();sel=+p.dataset.id;list()}});
["sort","av","type"].forEach(i=>$("#"+i).onchange=list);
$("#max").oninput=()=>{$("#maxo").textContent=$("#max").value;list()};
$("#loc").onchange=()=>{const v=$("#loc").value;if(v=="__geo")return geo();if(v=="__me")user={name:"your location",ll:meLL};else user={name:v,ll:SPOTS[v]};$("#geomsg").innerHTML="";list()};
document.querySelectorAll(".seg button").forEach(b=>b.onclick=()=>{view=b.dataset.v;document.querySelectorAll(".seg button").forEach(x=>x.setAttribute("aria-pressed",x==b));list()});
$("#heroGo").onclick=()=>{$("#loc").value=$("#heroLoc").value;if($("#heroLoc").value=="__geo")geo();else $("#loc").onchange();location.hash="#explore"};
function geo(){
 if(!navigator.geolocation){$("#loc").value=SPOTS[user.name]?user.name:"Aldrich Park";$("#geomsg").innerHTML=`<div class="msg">Location isn’t available in this browser. Choose a spot from the list instead.</div>`;return}
 $("#geomsg").innerHTML=`<div class="msg">Waiting for your permission…</div>`;
 navigator.geolocation.getCurrentPosition(p=>{meLL=[p.coords.latitude,p.coords.longitude];user={name:"your location",ll:meLL};if(!$("#loc option[value=__me]"))$("#loc").add(new Option("Your current location","__me"));$("#loc").value="__me";$("#geomsg").innerHTML=`<div class="msg">Using your location. Distances are straight-line estimates to the demo pickup spots.</div>`;list()},
 e=>{$("#loc").value=SPOTS[user.name]?user.name:"__me";$("#geomsg").innerHTML=`<div class="msg">${e.code==1?"Location permission was denied.":"Couldn’t get your location."} Pick your area from the menu to sort by distance.</div>`},{timeout:8000})}

// detail + booking
const tm=m=>{const h=Math.floor(m/60);return `${(h+11)%12+1}:${String(m%60).padStart(2,"0")} ${h<12?"AM":"PM"}`};
const hopts=(a,b,v)=>{let o="";for(let m=a*60;m<=b*60;m+=15)o+=`<option value="${m}" ${m==v?"selected":""}>${tm(m)}</option>`;return o};
function openD(id){
 const s=S.find(x=>x.id==id),today=new Date().toISOString().slice(0,10);
 $("#dt").textContent=s.n;
 $("#dbody").innerHTML=`<div class="two"><div><div class="art" style="border-radius:18px">${art(s)}</div><div class="spec"><span>${s.m}</span>${s.rng?`<span>Range ${s.rng}</span>`:""}${s.spd?`<span>Top ${s.spd}</span>`:""}${s.sp?`<span>${s.sp}</span>`:""}</div></div><div><span class="tag ${s.avail?"":"n"}">${s.avail?"Available":"Unavailable now"}</span> <span class="demo">DEMO LISTING</span><p>${s.d}</p><p style="font-size:14px;margin:0"><b>Owner:</b> ${s.o}<br><b>Pickup:</b> ${s.loc} (${dist(s).toFixed(2)} mi away)<br><b>Return:</b> ${s.drop}<br><b>Unavailable:</b> ${s.b.length?s.b.map(x=>tm(x[0]*60)+"–"+tm(x[1]*60)).join(", ")+" daily":"none listed"}</p></div></div>
 <div class="f two"><div><label for="bd">Date</label><input type="date" id="bd" min="${today}" value="${today}"></div><div></div><div><label for="bs">Start</label><select id="bs">${hopts(7,21,600)}</select></div><div><label for="be">End</label><select id="be">${hopts(8,22,720)}</select></div></div><div class="err" id="berr" role="alert" style="color:#b3261e;font-size:13px;min-height:18px"></div>
 <div class="tot"><div style="font-size:13px;opacity:.8">Estimated total</div><div class="big" id="bt"></div><dl id="bl"></dl></div>
 <button class="btn p" id="bgo" style="width:100%;justify-content:center">Review booking request</button>`;
 const upd=()=>{const a=+$("#bs").value,b=+$("#be").value,e=$("#berr"),go=$("#bgo");let m="";
  if(b<=a)m="End time must be after start time.";
  else if(!s.avail)m="This scooter isn’t available right now.";
  else if(s.b.some(x=>a<x[1]*60&&b>x[0]*60))m="That range overlaps a time the owner marked unavailable.";
  e.textContent=m;go.disabled=!!m;go.style.opacity=m?.5:1;
  const mn=Math.max(0,b-a),c=cost(s,mn);$("#bt").textContent=fmt(c);$("#bl").innerHTML=`<dt>${fmt(s.p)}/${s.u||"hr"} × ${s.u=="min"?mn+" min":(mn/60)+" hr"}</dt><dd>${fmt(c)}</dd><dt>Extra fees</dt><dd>None</dd>`};
 ["bs","be","bd"].forEach(i=>$("#"+i).onchange=upd);upd();
 $("#bgo").onclick=()=>{const a=+$("#bs").value,b=+$("#be").value,d=$("#bd").value;
  $("#dbody").innerHTML=`<h3 style="font-size:34px;margin-bottom:16px">Review your request</h3><div class="tot"><div class="big">${fmt(cost(s,b-a))}</div><dl><dt>Scooter</dt><dd>${s.n}</dd><dt>Date</dt><dd>${d}</dd><dt>Time</dt><dd>${tm(a)} – ${tm(b)}</dd><dt>Pickup</dt><dd>${s.loc}</dd><dt>Return</dt><dd style="max-width:260px">${s.drop}</dd></dl></div><p class="note">Demo only: this request isn’t sent to an owner, and no payment is taken.</p><div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn p" id="bok">Submit demo request</button><button class="btn o" id="bback">Back</button></div>`;
  $("#bback").onclick=()=>openD(id);
  $("#bok").onclick=()=>{const bk={id:Date.now(),sid:s.id,d:d,a:a,b:b,st:"pending",m:[]};B.unshift(bk);thr();$("#dbody").innerHTML=`<div style="text-align:center;padding:30px 0"><span class="tag" style="background:#171A18;color:var(--l)">PENDING · DEMO</span><h3 style="font-size:40px;margin:16px 0">Request staged.</h3><p>With a connected backend, ${s.o} would approve or decline this. Nothing was reserved or charged. Once approved, ${s.o} can share the lock code in chat.</p><div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:16px"><button class="btn p" data-chat="${bk.id}">Message ${s.o}</button><button class="btn o" data-close>Done</button></div></div>`}};
 $("#dd").showModal()}

// chat
let B=[],roleO=false;
const esc=t=>String(t).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const thr=()=>{$("#mc").textContent=B.length?"("+B.length+")":""};
function inbox(){
 $("#ct").textContent="Messages";
 $("#cbody").innerHTML=B.length?`<div style="display:grid;gap:10px">${B.map(b=>{const s=S.find(x=>x.id==b.sid),l=b.m[b.m.length-1];return `<button class="card in" data-th="${b.id}" style="padding:16px;display:block;width:100%"><b>${esc(s.n)}</b> <span class="tag ${b.st=="confirmed"?"":"n"}">${b.st=="confirmed"?"Confirmed · demo":"Pending · demo"}</span><div class="row"><span>${esc(s.o)} · ${b.d}, ${tm(b.a)}–${tm(b.b)}</span></div><div class="row"><span>${l?(l.k=="lock"?"Lock code shared":esc(l.t)):"No messages yet"}</span></div></button>`}).join("")}</div>`:`<p>No conversations yet. After you request a booking you can message the owner here, ask for the lock code and more.</p>`;
 if(!$("#cd").open)$("#cd").showModal()}
function chat(id){
 const b=B.find(x=>x.id==id),s=S.find(x=>x.id==b.sid),me=roleO?"o":"r",conf=b.st=="confirmed";
 $("#ct").textContent=roleO?"Renter (owner preview)":s.o;
 const msg=m=>{if(m.f=="s")return `<div class="note" style="text-align:center;margin:4px 0">${esc(m.t)}</div>`;const mine=m.f==me,al=mine?"flex-end":"flex-start";
  if(m.k=="lock")return `<div class="tot" style="align-self:${al};margin:0"><div style="font-size:13px;opacity:.8">Lock code from ${esc(s.o)}</div><div class="big" style="font-size:34px">${roleO?esc(m.t):"••••"}</div>${roleO?"":`<button class="btn p" data-rev="${esc(m.t)}" style="margin-top:8px;min-height:40px;padding:8px 16px">Reveal code</button>`}</div>`;
  return `<div class="bub" style="align-self:${al};background:${mine?"var(--g)":"var(--card)"};color:${mine?"#fff":"inherit"};border:1px solid ${mine?"var(--g)":"var(--line)"}">${esc(m.t)}</div>`};
 const chips=["Can I get the lock code?","Where exactly is the pickup spot?","Is a helmet included?","How should I lock it when I return it?"];
 const tools=roleO?(conf?`<div style="display:flex;gap:8px;margin-bottom:10px"><input id="lkc" maxlength="8" placeholder="Lock code" aria-label="Lock code" style="flex:1;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px;min-height:46px"><button class="btn o" id="lkb">Share lock code</button></div>`:`<button class="btn o" id="appr" style="margin-bottom:10px">Approve request</button>`):`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">${chips.map(c=>`<button class="btn o" data-q="${c}" style="min-height:38px;padding:6px 12px;font-size:13px">${c}</button>`).join("")}</div>`;
 $("#cbody").innerHTML=`<button class="btn o" id="cback" style="min-height:40px;padding:8px 14px">← All chats</button> <span class="tag ${conf?"":"n"}">${conf?"Confirmed · demo":"Pending · demo"}</span>
 <p class="note" style="margin:10px 0 4px"><span class="demo">DEMO</span> Messages stay in this browser tab and aren’t delivered to anyone. Use the toggle to preview the owner’s side.</p>
 <label class="note" style="display:flex;gap:8px;align-items:center;margin:0"><input type="checkbox" id="role" ${roleO?"checked":""}> Preview as owner</label>
 <div id="log" style="display:flex;flex-direction:column;gap:8px;min-height:160px;max-height:40vh;overflow:auto;padding:12px 0">${b.m.length?b.m.map(msg).join(""):`<p class="note">Say hi, or ask about the lock code, pickup details and anything else.</p>`}</div>${tools}
 <div style="display:flex;gap:8px"><input id="cin" aria-label="Message" placeholder="Type a message" style="flex:1;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px;min-height:46px"><button class="btn p" id="csend">Send</button></div>`;
 const lg=$("#log");lg.scrollTop=lg.scrollHeight;
 const send=t=>{t=(t||"").trim();if(!t)return;b.m.push({f:me,t});if(!roleO&&!conf&&/lock|code/i.test(t))b.m.push({f:"s",t:"Owners share the lock code after approving your request. You’ll see it here."});chat(id);$("#cin").focus()};
 $("#csend").onclick=()=>send($("#cin").value);$("#cin").onkeydown=e=>{if(e.key=="Enter")send($("#cin").value)};
 $("#cback").onclick=inbox;$("#role").onchange=()=>{roleO=$("#role").checked;chat(id)};
 document.querySelectorAll("[data-q]").forEach(x=>x.onclick=()=>send(x.dataset.q));
 if($("#appr"))$("#appr").onclick=()=>{b.st="confirmed";b.m.push({f:"s",t:"Request approved by "+s.o+" (demo)."});chat(id)};
 if($("#lkb"))$("#lkb").onclick=()=>{const v=$("#lkc").value.trim();if(!v){$("#lkc").focus();return}b.m.push({f:"o",k:"lock",t:v});chat(id)};
 if(!$("#cd").open)$("#cd").showModal()}
document.addEventListener("click",e=>{const c=e.target.closest("[data-chat]"),t=e.target.closest("[data-th]"),r=e.target.closest("[data-rev]");
 if(c){$("#dd").close();roleO=false;chat(+c.dataset.chat)}
 else if(t){roleO=false;chat(+t.dataset.th)}
 else if(r){r.previousElementSibling.textContent=r.dataset.rev;r.remove()}});
$("#msgs").onclick=inbox;
// listing flow
let L={},step=0,photos=[];
function lform(){
 const st=["Ride","Location & price","Availability","Review"];
 let h=`<div class="prog">${st.map((_,i)=>`<i class="${i<=step?"on":""}"></i>`).join("")}</div><span class="eyebrow">Step ${step+1} of 4 — ${st[step]}</span><div class="f">`;
 if(step==0)h+=`<label for="lt">Type</label><select id="lt"><option value="scooter">Scooter</option><option value="bike">Bike</option></select><label for="ln">Name</label><input id="ln" value="${L.n||""}" placeholder="e.g. Zot Cruiser or Campus Bike"><div class="err" id="e1"></div><label for="lm">Model</label><input id="lm" value="${L.m||""}" placeholder="e.g. Xiaomi Pro 4"><div class="err" id="e2"></div><div class="two"><div><label for="lr">Range (mi, optional)</label><input id="lr" value="${L.r||""}" placeholder="25"></div><div><label for="ls">Top speed (mph, optional)</label><input id="ls" value="${L.s||""}" placeholder="18"></div></div><label for="ld2">Description</label><textarea id="ld2" rows="3" placeholder="Condition, helmet included, anything renters should know">${L.d||""}</textarea><label for="lp">Photos</label><input type="file" id="lp" accept="image/*" multiple><div class="prev" id="pv"></div>`;
 if(step==1)h+=`<div class="two"><div><label for="lpr">Price</label><input id="lpr" type="number" min="0.01" step="0.01" value="${L.p||""}" placeholder="4 or 0.15"></div><div><label for="lu">Unit</label><select id="lu"><option value="hr">per hour</option><option value="min">per minute</option></select></div></div><div class="err" id="e3"></div><label for="lpl">Pickup location</label><select id="lpl">${geoOpt}${opts}${SPOTS["Pinned location"]?`<option value="Pinned location">Pinned location (your current location)</option>`:""}</select><label for="ldr">Permitted drop-off</label><input id="ldr" value="${L.dr||""}" placeholder="e.g. Return to Langson Library rack"><div class="err" id="e4"></div>`;
 if(step==2)h+=`<div class="two"><div><label for="la">Available from</label><input type="date" id="la" value="${L.a||""}"></div><div><label for="lb">Until</label><input type="date" id="lb" value="${L.b||""}"></div><div><label for="lst">Daily start</label><select id="lst">${hopts(7,21,L.st||540)}</select></div><div><label for="len">Daily end</label><select id="len">${hopts(8,22,L.en||1080)}</select></div></div><div class="err" id="e5"></div>`;
 if(step==3)h+=`<p class="note">Live preview of your listing:</p><div class="grid" style="display:block"><div class="card in" style="cursor:default"><div class="art">${photos[0]?`<img src="${photos[0]}" alt="" style="width:100%;height:100%;object-fit:cover">`:art({c:"#0064A4",t:L.t})}</div><div class="cb"><h3>${L.n}</h3><div>${L.m}</div><div class="row"><span>${L.pl} · ${L.dr}</span><span class="price">${fmt(+L.p)}/${L.u||"hr"}</span></div><div class="row"><span>${L.a} → ${L.b}, ${tm(L.st)}–${tm(L.en)}</span></div></div></div></div><p class="note">Demo only: publishing adds this to the list on this page for this session. It is not saved or shared.</p>`;
 h+=`</div><div style="display:flex;gap:10px;margin-top:20px">${step?`<button class="btn o" id="lback">Back</button>`:""}<button class="btn p" id="lnext">${step==3?"Publish (demo)":"Continue"}</button></div>`;
 $("#lbody").innerHTML=h;
 if(step==1){$("#lu").value=L.u||"hr";$("#lpl").value=L.pl||"Aldrich Park";$("#lpl").onchange=()=>{if($("#lpl").value!="__geo")return;const bad=()=>{$("#lpl").value="Aldrich Park";$("#e3").textContent="Couldn’t get your location. Choose a campus spot."};navigator.geolocation?navigator.geolocation.getCurrentPosition(p=>{SPOTS["Pinned location"]=[p.coords.latitude,p.coords.longitude];if(!$("#lpl option[value='Pinned location']"))$("#lpl").add(new Option("Pinned location (your current location)","Pinned location"));$("#lpl").value="Pinned location"},bad,{timeout:8000}):bad()}}
 if(step==0)$("#lt").value=L.t||"scooter";
 if(step==0){const sh=()=>$("#pv").innerHTML=photos.map(p=>`<img src="${p}" alt="Photo preview">`).join("");sh();$("#lp").onchange=e=>{photos=[...e.target.files].slice(0,4).map(f=>URL.createObjectURL(f));sh()}}
 if(step)$("#lback").onclick=()=>{keep();step--;lform()};
 $("#lnext").onclick=()=>{
  let ok=true;const er=(i,m)=>{$("#"+i).textContent=m;if(m)ok=false};
  if(step==0){er("e1",$("#ln").value.trim()?"":"Give your scooter a name.");er("e2",$("#lm").value.trim()?"":"Enter the model.")}
  if(step==1){er("e3",+$("#lpr").value>0?"":"Enter a price above $0.");er("e4",$("#ldr").value.trim()?"":"Describe where renters can return it.");if($("#lpl").value=="__geo")er("e3","Choose a pickup location.")}
  if(step==2){const a=$("#la").value,b=$("#lb").value;er("e5",!a||!b?"Choose both dates.":b<a?"End date must be after the start date.":+$("#len").value<=+$("#lst").value?"Daily end must be after daily start.":"")}
  if(!ok)return;keep();
  if(step<3){step++;lform()}else{
   S.unshift({id:Date.now(),t:L.t||"scooter",u:L.u||"hr",n:L.n,m:L.m+" (your listing)",p:+L.p,loc:L.pl,c:"#0064A4",avail:1,rng:L.r?L.r+" mi":"",spd:L.s?L.s+" mph":"",o:"You",d:L.d||"No description.",drop:L.dr,b:[]});
   $("#lbody").innerHTML=`<div style="text-align:center;padding:30px 0"><span class="tag" style="background:#171A18;color:var(--l)">DEMO</span><h3 style="font-size:40px;margin:16px 0">Listing added.</h3><p>It now shows in Explore for this session only.</p><button class="btn p" data-close>See it in Explore</button></div>`;L={};photos=[];step=0;list()}};
}
function keep(){const g=i=>$("#"+i)?$("#"+i).value:undefined,m={t:"lt",u:"lu",n:"ln",m:"lm",r:"lr",s:"ls",d:"ld2",p:"lpr",pl:"lpl",dr:"ldr",a:"la",b:"lb",st:"lst",en:"len"};for(const k in m){const v=g(m[k]);if(v!==undefined)L[k]=v}}
document.querySelectorAll("[data-list]").forEach(b=>b.onclick=()=>{step=0;lform();$("#ld").showModal()});
document.addEventListener("click",e=>{if(e.target.closest("[data-close]")){document.querySelectorAll("dialog[open]").forEach(d=>d.close());if(e.target.textContent.includes("Explore"))location.hash="#explore"}});
document.querySelectorAll("dialog").forEach(d=>d.addEventListener("click",e=>{if(e.target==d)d.close()}));

// earnings
const eu=()=>{const h=+$("#eh").value,p=+$("#ep").value;$("#eo").textContent="$"+h*p;$("#el").textContent=`at $${p}/hr × ${h} hrs rented per week`};$("#eh").oninput=$("#ep").oninput=eu;

// scroll
const nav=$("#nav"),rt=$("#route"),L2=rt.getTotalLength(),mks=[...document.querySelectorAll(".mk")],hv=$("#hv"),story=$("#story");
rt.style.strokeDasharray=L2;
const copy=[["02 — Move","Follow the route.","Rides live all over campus. Scroll to trace a ride from Aldrich Park outward."],["03 — Explore","Listings light up.","Nearby rides appear with price and distance as the route reaches them."],["04 — Choose","Pick yours.","Compare, pick a time, and see the total before you request."]];
function tick(){const y=scrollY;nav.classList.toggle("s",y>20);
 if(!RM)hv.style.transform=`translate(${-y*.12}px,${y*.08}px) rotate(${-y*.01}deg) scale(${1+y*.0004})`;
 const r=story.getBoundingClientRect(),p=RM?1:Math.min(1,Math.max(0,-r.top/(r.height-innerHeight)));
 rt.style.strokeDashoffset=L2*(1-Math.min(1,p*1.25));
 [.02,.35,.7,.45,.8].forEach((t,i)=>mks[i].classList.toggle("on",p>=t||RM));
 const c=copy[p<.4?0:p<.75?1:2];$("#stepL").textContent=c[0];$("#stepH").textContent=c[1];$("#stepP").textContent=c[2]}
addEventListener("scroll",()=>requestAnimationFrame(tick),{passive:true});tick();
const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add("in");io.unobserve(e.target)}}),{threshold:.15});
document.querySelectorAll(".rv").forEach((el,i)=>{el.style.transitionDelay=i%3*120+"ms";io.observe(el)});
list();
const LOGO="assets/logo.png";
document.querySelectorAll("[data-logo]").forEach(i=>i.src=LOGO);{const l=document.createElement("link");l.rel="icon";l.href=LOGO;document.head.appendChild(l)}

