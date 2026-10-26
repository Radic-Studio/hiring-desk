/* Future Ready Group System — shell: sign-in gate, accounts, companies, navigation, profile, Team page.
   Modules (app/modules/*.js) register themselves on FR before boot() runs. */
(() => {
const FR = window.FR, S = FR.S, CFG = FR.CFG;
const { $, $$, esc, toast, logAct, notice, setSync, safeGet, safeSet, when, memberName, avatarHtml, callFunction, LEVEL_LABEL, ROLE_LABEL, ROLE_HELP } = FR;
const SB = () => FR.SB;

/* ---------- access helpers ---------- */
const isGroupAdmin = () => !!S.access?.group_admin;
const roleIn = cid => isGroupAdmin() ? "admin" : (S.access?.companies || {})[cid] || null;
const isCompanyAdmin = cid => roleIn(cid) === "admin";
const canManageTeam = () => isGroupAdmin() || S.companies.some(c => isCompanyAdmin(c.id));
FR.isGroupAdmin = isGroupAdmin; FR.roleIn = roleIn; FR.isCompanyAdmin = isCompanyAdmin;
function applyCompanyAccess() {
  const r = roleIn(S.company);
  S.canWrite = ["admin", "manager", "staff"].includes(r);
  if (S.me) { S.me.canEdit = r === "admin"; S.me.companyRole = r; }
}

/* ---------- navigation: companies × modules × views ---------- */
const SHELL_VIEWS = { team: { id: "team", title: "Team", sub: "Who can use the system, invitations and access requests" } };
function companyModules(cid) { const c = S.companies.find(x => x.id === cid); return (c?.modules || ["hiring"]).map(id => FR.modules[id]).filter(Boolean); }
function viewDef(v) { if (SHELL_VIEWS[v]) return SHELL_VIEWS[v]; for (const m of companyModules(S.company)) { const d = m.views.find(x => x.id === v); if (d) return { ...d, module: m.id }; } return null; }
function buildNav() {
  const mods = companyModules(S.company);
  $("#tabs").innerHTML = mods.map(m => `<div class="nav-group">${mods.length > 1 ? `<div class="nav-head">${esc(m.name)}</div>` : ""}${m.views.map(v => `<button role="tab" data-view="${v.id}">${v.icon || ""}<span class="lbl">${esc(v.nav || v.title)}</span>${v.count ? `<span class="cnt" id="cnt-${v.id}" hidden>0</span>` : ""}</button>`).join("")}</div>`).join("")
    + (canManageTeam() ? `<div class="nav-group"><div class="nav-head">Group</div><button role="tab" data-view="team" id="tab-team"><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="9" r="2.5"/><path d="M15.5 14.2a5 5 0 0 1 6 4.8"/></svg><span class="lbl">Team</span><span class="cnt" id="cnt-team" hidden>0</span></button></div>` : "");
  // one section per view, created once
  const main = $("main");
  for (const m of Object.values(FR.modules)) for (const v of m.views) if (!$("#v-" + v.id)) { const s = document.createElement("section"); s.className = "view"; s.id = "v-" + v.id; s.hidden = true; main.appendChild(s); }
  if (!$("#v-team")) { const s = document.createElement("section"); s.className = "view"; s.id = "v-team"; s.hidden = true; main.appendChild(s); }
  paintCompanySwitch(); paintTeamBadge(); paintCompanyBadge(); paintMobileNav();
}
const CO_ICON = { press: "./app/brand/app_icon_press.svg", events: "./app/brand/app_icon_events.svg" };
function paintCompanyBadge() {
  const b = $("#co-badge"); if (!b) return; const c = S.companies.find(x => x.id === S.company);
  document.body.dataset.company = ["press", "events"].includes(S.company) ? S.company : "group";
  if (!c) { b.hidden = true; return; }
  b.hidden = false; b.innerHTML = `${CO_ICON[c.id] ? `<img src="${CO_ICON[c.id]}" alt="">` : ""}${esc(c.short_name)}`; b.title = c.name;
}
/* phones: five-item bottom bar (first four views of the active module + More), the rest in a sheet */
function paintMobileNav() {
  const btns = [...document.querySelectorAll("#tabs button[data-view]")]; btns.forEach(b => b.classList.remove("bn"));
  const mod = companyModules(S.company).find(m => m.views.some(v => v.id === S.view)) || companyModules(S.company)[0];
  const first = mod ? mod.views.slice(0, 4).map(v => v.id) : [];
  btns.filter(b => first.includes(b.dataset.view)).forEach(b => b.classList.add("bn"));
  let more = $("#tab-more");
  if (!more) { more = document.createElement("button"); more.id = "tab-more"; more.setAttribute("role", "tab"); more.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg><span class="lbl">More</span>'; more.onclick = openMoreSheet; $("#tabs").appendChild(more); }
  more.classList.add("bn"); more.setAttribute("aria-selected", "false");
}
function openMoreSheet() {
  let sh = $("#more-sheet"); const hide = () => { $("#more-sheet")?.remove(); $("#scrim").classList.remove("open"); setTimeout(() => { if (!$("#drawer").classList.contains("open")) $("#scrim").hidden = true; }, 200); };
  if (sh) { hide(); return; }
  sh = document.createElement("div"); sh.className = "more-sheet"; sh.id = "more-sheet";
  const comps = S.companies.filter(c => c.active && roleIn(c.id));
  sh.innerHTML = `${comps.length > 1 ? `<div class="grp"><h4>Company</h4><select id="more-co">${comps.map(c => `<option value="${esc(c.id)}" ${c.id === S.company ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>` : ""}
    ${companyModules(S.company).map(m => `<div class="grp"><h4>${esc(m.name)}</h4>${m.views.map(v => `<button class="item" data-go="${v.id}" aria-selected="${v.id === S.view}">${v.icon || ""}<span>${esc(v.nav || v.title)}</span></button>`).join("")}</div>`).join("")}
    ${canManageTeam() ? `<div class="grp"><h4>Group</h4><button class="item" data-go="team" aria-selected="${S.view === "team"}"><span>Team</span></button></div>` : ""}
    <div class="grp"><h4>Account</h4><button class="item" id="more-profile"><span>${esc(S.me?.name || "")} · edit profile</span></button><button class="item" id="more-out"><span>Sign out</span></button></div>`;
  document.body.appendChild(sh); $("#scrim").hidden = false; requestAnimationFrame(() => $("#scrim").classList.add("open")); $("#scrim").onclick = hide;
  sh.querySelectorAll("[data-go]").forEach(b => b.onclick = () => { hide(); setView(b.dataset.go); });
  $("#more-co")?.addEventListener("change", e => { hide(); switchCompany(e.target.value); });
  $("#more-profile").onclick = () => { hide(); openProfile(false); };
  $("#more-out").onclick = async () => { await SB().auth.signOut(); location.reload(); };
}
function paintCompanySwitch() {
  const el = $("#company-switch"); if (!el) return;
  const list = S.companies.filter(c => c.active && roleIn(c.id));
  if (list.length <= 1) { el.innerHTML = `<div class="co-one"><b>${esc(FR.companyName(S.company) || "Future Ready")}</b></div>`; return; }
  el.innerHTML = `<label class="co-label">Company</label><select id="company-sel" aria-label="Company">${list.map(c => `<option value="${esc(c.id)}" ${c.id === S.company ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>`;
  $("#company-sel").onchange = e => switchCompany(e.target.value);
}
function switchCompany(cid, view) {
  if (!S.companies.some(c => c.id === cid && c.active) || !roleIn(cid)) cid = defaultCompany();
  const changed = cid !== S.company;
  S.company = cid; safeSet("fr_company", cid); applyCompanyAccess(); buildNav();
  if (changed) for (const m of companyModules(cid)) m.onCompany?.();
  FR.paintRole();
  setView(view || (viewDef(S.view) ? S.view : "dashboard"));
}
function defaultCompany() {
  const ok = S.companies.filter(c => c.active && roleIn(c.id)).sort((a, b) => a.order - b.order);
  const saved = safeGet("fr_company");
  return (ok.find(c => c.id === saved) || ok.find(c => c.kind === "group") || ok[0] || {}).id || null;
}
function setView(v, opts = {}) {
  let d = viewDef(v); if (!d) { v = "dashboard"; d = viewDef(v); }
  if (!d) { v = "team"; d = SHELL_VIEWS.team; }
  S.view = v; S.module = d.module || null;
  if (opts.role !== undefined) S.role = opts.role;
  if (opts.filters) S.filters = { q: "", status: "", loc: "", tier: "", avail: "", ...opts.filters };
  for (const t of document.querySelectorAll(".nav button")) t.setAttribute("aria-selected", t.dataset.view === v);
  for (const s of document.querySelectorAll("main .view")) s.hidden = s.id !== "v-" + v;
  $("#page-title").textContent = d.title; $("#page-sub").textContent = d.sub || "";
  $("#dl-btn").hidden = !(d.module && FR.modules[d.module]?.headerDownload);
  if (!/access_token|refresh_token|error=|code=/.test(location.hash + location.search)) { try { history.replaceState(null, "", `#/${S.company}/${v}`); } catch {} }
  window.scrollTo({ top: 0, behavior: "smooth" });
  paintMobileNav();
  FR.render();
}
FR.setView = setView;
function routeFromHash() { const m = (location.hash || "").match(/^#\/([a-z0-9-]+)\/([a-z0-9-]+)/); return m ? { company: m[1], view: m[2] } : { view: (location.hash || "").replace("#", "") }; }
$("#tabs").addEventListener("click", e => { const t = e.target.closest("button[data-view]"); if (t) setView(t.dataset.view); });
$(".foot-site nav").addEventListener("click", e => { const a = e.target.closest("a[data-view]"); if (a) { e.preventDefault(); setView(a.dataset.view); } });
window.addEventListener("hashchange", () => { if (!S.me) return; const r = routeFromHash(); if (r.company && r.company !== S.company) switchCompany(r.company, r.view); else if (r.view && r.view !== S.view) setView(r.view); });

/* ---------- account panel ---------- */
function roleLabel() { if (!S.me) return "Not signed in"; if (isGroupAdmin()) return "Group Admin"; return ROLE_LABEL[S.me.companyRole] || "No access"; }
FR.paintRole = () => {
  const m = S.me, el = $("#me"), lab = roleLabel();
  const cls = lab === "Viewer" ? "view" : m ? "edit" : "";
  const initials = (m?.name || "?").split(" ").map(x => x[0]).slice(0, 2).join("").toUpperCase();
  el.innerHTML = `<div class="avatar">${m?.avatarUrl ? `<img src="${esc(m.avatarUrl)}" alt="">` : esc(initials)}</div><div style="min-width:0"><b>${esc(m?.name || "Guest")}</b><small><span class="role ${cls}">${lab}${lab === "Viewer" ? " · read only" : ""}</span></small></div><span class="chev">▲</span>`;
  if (m && S.canWrite === false) notice("warn", `You have Viewer access in ${FR.companyName(S.company)}: you can read everything and download, but not change records. An Admin can change your role from the Team page.`); else if (m) notice("", "");
};
function togglePop(force) {
  const pop = $("#pop"), btn = $("#me"); const open = force ?? pop.hidden; if (!open) { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); return; }
  const m = S.me, lab = roleLabel();
  const comps = S.companies.filter(c => c.active && roleIn(c.id));
  pop.innerHTML = `<h3>${esc(m?.name || "Guest")} <span class="role ${lab === "Viewer" ? "view" : m ? "edit" : ""}">${lab}</span></h3>
    <p>${m?.email ? esc(m.email) + "<br>" : ""}${m?.position ? esc(m.position) + "<br>" : ""}Sign-in is with Google; there is no separate password.</p>
    ${m ? `<ul>${isGroupAdmin() ? `<li>Group Admin: everything in every company</li>` : comps.map(c => `<li>${esc(c.name)}: ${ROLE_LABEL[roleIn(c.id)]}</li>`).join("") || "<li>No company access yet</li>"}</ul>` : ""}
    <div class="toolbar">${m ? `<button class="btn small" id="pop-profile">Edit profile</button><button class="btn small" id="pop-copy">Copy page link</button><button class="btn small" id="pop-out">Sign out</button>` : ``}<button class="btn small" id="pop-close">Close</button></div>`;
  pop.hidden = false; btn.setAttribute("aria-expanded", "true");
  $("#pop-close").onclick = () => togglePop(false);
  $("#pop-out")?.addEventListener("click", async () => { await SB().auth.signOut(); location.reload(); });
  $("#pop-profile")?.addEventListener("click", () => { togglePop(false); openProfile(false); });
  $("#pop-copy")?.addEventListener("click", async () => { try { await navigator.clipboard.writeText(location.href.split("#")[0]); toast("Link copied"); } catch { toast("Copy the link from your address bar"); } });
}
FR.togglePop = togglePop;
$("#me").addEventListener("click", () => togglePop());
$("#act-btn").addEventListener("click", FR.openActivity);
$("#me-mobile").addEventListener("click", () => { if (S.me) openProfile(false); else toast("Not signed in"); });
document.addEventListener("click", e => { if (!e.target.closest(".foot") && !$("#pop").hidden) togglePop(false); });

/* ---------- gate: sign-in, sign-up, pending, disabled ---------- */
function showGate(msg, note) { $("#gate").hidden = false; if (msg) $("#gate-msg").textContent = msg; $("#gate-note").textContent = note || ""; gateShow.start(); }
const GATE_COPY = {
  in: { title: "Welcome back", msg: "One account for every Future Ready company. Use the Google account your Admin knows.", btn: "Continue with Google" },
  req: { title: "Join the team", msg: "New here? Sign in with Google, tell us your company and the access you need, and an Admin approves it. It takes a minute.", btn: "Start with Google" },
};
function gateMode(mode) {
  const c = GATE_COPY[mode] || GATE_COPY.in;
  $("#gate-title").textContent = c.title; $("#gate-msg").textContent = c.msg;
  const b = $("#gate-google"); if (b) b.lastChild.textContent = c.btn;
  $$("#gate-seg button").forEach(x => { const on = x.dataset.mode === mode; x.classList.toggle("on", on); x.setAttribute("aria-selected", on ? "true" : "false"); });
}
/* ---------- gate slideshow: what the companies do. Photos: Unsplash, free licence (commercial use allowed), served from their CDN. ---------- */
const GATE_SLIDES = [
  { co: "events", f: "flagged/photo-1578905325074-a07c98c5cfd5", by: "Samson Ejim", h: "Traditional marriages, done properly", adH: "Planning a traditional marriage?", adP: "Venue, canopy, décor, catering and the running order, handled end to end." },
  { co: "press", f: "photo-1624698971296-b8b01fd1aab9", by: "Omid Roshan", h: "Offset and digital printing under one roof", adH: "Need it printed this week?", adP: "Programmes, flyers, banners and souvenirs with fast turnaround." },
  { co: "events", f: "photo-1661332306744-70f9ed1a7f40", by: "Tope A. Asokere", h: "Weddings that look like you", adH: "White wedding or traditional?", adP: "We plan both, from the first meeting to the last dance." },
  { co: "press", f: "photo-1581079289196-67865ea83118", by: "Mika Baumeister", h: "Your brand colours, exactly", adH: "Colour-matched printing", adP: "Business cards, letterheads and packaging that match your brand." },
  { co: "events", f: "photo-1742445972540-2f64de4eb4f3", by: "Mexsss", h: "Every detail, on time", adH: "Event coordination", adP: "Timelines, vendors and guests managed so the couple only has to show up." },
  { co: "press", f: "photo-1676474508989-40ddb421e426", by: "Fancy Walls", h: "Banners and large format", adH: "Large-format printing", adP: "Roll-up banners, backdrops, posters and signage for any event or shop." },
  { co: "events", f: "photo-1779308936221-89739e035a53", by: "Simply Thrilled", h: "Stage, drapes and lighting", adH: "Reception décor", adP: "Stage design, draping and lighting that photograph well." },
  { co: "press", f: "photo-1503694978374-8a2fa686963a", by: "Bank Phrom", h: "Printing at scale", adH: "Bulk printing", adP: "Newsletters, booklets and campaign materials in volume." },
  { co: "events", f: "photo-1769812343590-485512e27838", by: "Jonathan Borba", h: "Table settings and décor", adH: "Décor and styling", adP: "Table settings, florals and centrepieces to match your theme." },
  { co: "press", f: "photo-1791220154642-aeddbc273852", by: "Brecht Corbeel", h: "Business cards to souvenirs", adH: "Personalised items", adP: "Jotters, mugs, bags and gift items branded for your occasion." },
  { co: "events", f: "photo-1665944017732-278d6811da07", by: "Chizzyen Shaded", h: "Engagements and introductions", adH: "Small ceremonies too", adP: "Introductions, engagements and private dinners, planned with care." },
  { co: "events", f: "photo-1786426923263-61e9699bfc39", by: "Anik Das", h: "Marquees and canopies", adH: "Outdoor events", adP: "Marquees, canopies, chairs and cooling for open-air functions." },
];
const GATE_CO = { events: "Future Ready Events", press: "Future Ready Press" };
const gateShow = (() => {
  let i = -1, timer = null, built = new Set(), dead = new Set(), slides, dots;
  const img = (f, w) => `https://images.unsplash.com/${f}?auto=format&fit=crop&w=${w}&q=72`;
  const alive = () => GATE_SLIDES.map((_, k) => k).filter(k => !dead.has(k));
  function build(k) {
    if (built.has(k)) return; built.add(k);
    const sd = GATE_SLIDES[k], el = document.createElement("div"); el.className = "slide " + sd.co; el.dataset.k = k;
    const im = new Image(); im.alt = ""; im.decoding = "async"; im.src = img(sd.f, 1400); im.srcset = `${img(sd.f, 800)} 800w, ${img(sd.f, 1400)} 1400w`; im.sizes = "(max-width:900px) 100vw, 620px";
    im.onerror = () => { dead.add(k); el.remove(); if (dead.size >= GATE_SLIDES.length) { $("#gate-ad").hidden = $("#gate-cap").hidden = $("#gate-ctl").hidden = true; stop(); } else if (+el.dataset.k === i) show(1); };
    el.appendChild(im); slides.appendChild(el);
  }
  function paint(k) {
    const sd = GATE_SLIDES[k];
    const ad = $("#gate-ad"); ad.hidden = false; ad.dataset.co = sd.co; $("#gate-ad-chip").textContent = GATE_CO[sd.co]; $("#gate-ad-h").textContent = sd.adH; $("#gate-ad-p").textContent = sd.adP;
    ad.style.animation = "none"; void ad.offsetWidth; ad.style.animation = "";
    const cap = $("#gate-cap"); cap.hidden = false; $("#gate-cap-h").textContent = sd.h; $("#gate-cap-pill").textContent = `${GATE_CO[sd.co]} · Photo: ${sd.by}`;
    cap.style.animation = "none"; void cap.offsetWidth; cap.style.animation = "";
    $("#gate-ctl").hidden = false;
    const live = alive(); dots.innerHTML = live.map(x => `<i class="${x === k ? "on" : ""}"></i>`).join("");
  }
  function show(step) {
    const live = alive(); if (!live.length) return;
    const pos = live.indexOf(i), k = live[((pos < 0 ? 0 : pos + step) + live.length) % live.length];
    build(k); const nxt = live[(live.indexOf(k) + 1) % live.length]; if (nxt !== k) build(nxt);
    i = k; $$("#gate-slides .slide").forEach(el => el.classList.toggle("on", +el.dataset.k === k)); paint(k);
  }
  function tick() { if ($("#gate").hidden || document.hidden) return; show(1); }
  function start() { if (!slides) init(); if (timer) return; if (i < 0) show(1); timer = setInterval(tick, 6500); }
  function stop() { clearInterval(timer); timer = null; }
  function init() {
    slides = $("#gate-slides"); dots = $("#gate-dots"); if (!slides) return;
    $("#gate-prev").onclick = () => { show(-1); restart(); }; $("#gate-next").onclick = () => { show(1); restart(); };
    document.addEventListener("visibilitychange", () => { if (!document.hidden && timer) tick(); });
  }
  function restart() { if (timer) { stop(); start(); } }
  return { start, stop };
})();
function googleProfile(session) {
  const u = session?.user?.user_metadata || {};
  const name = u.full_name || u.name || "";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return { name, avatar: u.avatar_url || u.picture || "", first: u.given_name || parts[0] || "", surname: u.family_name || (parts.length > 1 ? parts[parts.length - 1] : ""), other: parts.length > 2 ? parts.slice(1, -1).join(" ") : "" };
}
function gateState(state, d = {}) {
  const card = $("#gate-card"), title = $("#gate-title"), msg = $("#gate-msg"), body = $("#gate-body"), note = $("#gate-note");
  card.classList.toggle("wide", state === "signup");
  $("#gate").hidden = false; note.textContent = ""; $("#gate-seg").hidden = true; gateShow.start();
  const signout = `<button class="btn small" id="gate-out">Sign out</button>`;
  if (state === "invited") { title.textContent = "You have been invited"; msg.textContent = "Sign in with the Google account that received the invitation email. Your account is ready; you will only be asked for your details."; return; }
  if (state === "signup") {
    const g = d.g || {}, comps = (d.companies || []).filter(c => c.active);
    title.textContent = "Request access";
    msg.textContent = `${d.email} is not on the team yet. Send a request and an Admin will approve it.`;
    body.innerHTML = `<div class="fields">
      <div class="field wide"><label>Your name</label><input id="su-name" value="${esc(g.name || "")}" placeholder="As it should appear to colleagues"></div>
      <div class="field"><label>Company</label><select id="su-company">${comps.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select></div>
      <div class="field"><label>Access you need</label><select id="su-role"><option value="viewer">Viewer — read and download</option><option value="staff">Staff — work on records</option><option value="manager">Manager — create and edit records</option><option value="admin">Admin — everything in the company</option></select></div>
      </div>
      <div class="toolbar" style="justify-content:flex-end"><button class="btn small" id="gate-out">Use another account</button><button class="btn primary" id="su-go">Send request</button></div>`;
    $("#su-go").onclick = async () => {
      const b = $("#su-go"); b.disabled = true; b.textContent = "Sending…";
      const { data, error } = await SB().rpc("request_access", { p_requested: "viewer", p_name: $("#su-name").value.trim(), p_company: $("#su-company").value, p_role: $("#su-role").value });
      if (error) { b.disabled = false; b.textContent = "Send request"; note.textContent = error.message; return; }
      gateState("pending", { me: data });
    };
    $("#gate-out").onclick = () => SB().auth.signOut();
    return;
  }
  if (state === "pending") {
    title.textContent = "Request sent";
    msg.textContent = `An Admin has to approve ${d.me?.email || "your account"} before anything loads. This page checks by itself.`;
    body.innerHTML = `<div class="who"><div class="avatar">${(d.me?.name || "?").slice(0, 1).toUpperCase()}</div><div style="text-align:left"><b>${esc(d.me?.name || d.me?.email || "")}</b><br>Requested: ${esc(ROLE_LABEL[d.me?.requested_role] || "Viewer")}${d.me?.requested_company ? " in " + esc(d.me.requested_company) : ""}</div></div>
      <div class="toolbar" style="justify-content:center">${signout}</div>`;
    $("#gate-out").onclick = () => SB().auth.signOut();
    clearInterval(gateState.poll);
    gateState.poll = setInterval(async () => { const { data } = await SB().rpc("my_member"); if (data && data.status === "active") { clearInterval(gateState.poll); S.entering = false; const { data: { session } } = await SB().auth.getSession(); if (session) enter(session); } }, 20000);
    return;
  }
  if (state === "disabled") { title.textContent = "Access switched off"; msg.textContent = `${d.me?.email || "This account"} has been disabled by an Admin. Ask them to switch it back on.`; body.innerHTML = `<div class="toolbar" style="justify-content:center">${signout}</div>`; $("#gate-out").onclick = () => SB().auth.signOut(); return; }
  if (state === "noaccess") { title.textContent = "No company access yet"; msg.textContent = `${d.me?.email || "Your account"} is active but has not been given a role in any company. Ask an Admin to add you from the Team page.`; body.innerHTML = `<div class="toolbar" style="justify-content:center">${signout}</div>`; $("#gate-out").onclick = () => SB().auth.signOut(); return; }
  if (state === "error") { title.textContent = "Something is wrong"; msg.textContent = d.msg || ""; body.innerHTML = `<div class="toolbar" style="justify-content:center">${signout}</div>`; $("#gate-out").onclick = () => SB().auth.signOut(); }
}

/* ---------- boot ---------- */
async function boot() {
  $("#foot-sheet").href = CFG.sheetUrl || "#";
  $$("#gate-seg button").forEach(b => b.onclick = () => gateMode(b.dataset.mode));
  gateMode("in");
  if (!CFG.supabaseUrl || !CFG.supabaseKey || !window.supabase) { showGate("This copy is not configured.", "config.js must set supabaseUrl and supabaseKey."); setSync(false, "not configured"); return; }
  FR.SB = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
  const inv = new URLSearchParams(location.search).get("invite");
  if (inv) { safeSet("fr_invite", inv); try { history.replaceState(null, "", location.pathname + location.hash); } catch {} }
  if (inv || safeGet("fr_invite")) gateState("invited");
  $("#gate-google").onclick = async () => { showGate("Opening Google sign-in…", ""); const { error } = await SB().auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } }); if (error) showGate("Sign-in failed.", error.message); };
  SB().auth.onAuthStateChange((ev, sess) => { if (ev === "SIGNED_OUT") location.reload(); else if (ev === "SIGNED_IN" && sess && !S.me && !S.entering) enter(sess); });
  const { data: { session } } = await SB().auth.getSession();
  if (!session) { showGate(); setSync(false, "signed out"); FR.paintRole(); return; }
  await enter(session);
}
async function enter(session) {
  if (S.me || S.entering) return; S.entering = true;
  showGate("Checking your access…", "");
  if (/access_token|refresh_token|error=|code=/.test(location.hash + location.search)) { try { history.replaceState(null, "", location.pathname); } catch {} }
  const email = (session.user.email || "").toLowerCase();
  const g = googleProfile(session);
  const fail = (msg) => { setSync(false, "no access"); S.entering = false; gateState("error", { msg }); };
  const { error: accErr } = await SB().rpc("accept_invite");            // activates an invitation (matched by email), stamps the visit
  if (accErr) return fail("Could not check your access: " + accErr.message);
  try { localStorage.removeItem("fr_invite"); } catch {}
  const [{ data: access, error: aErr }, { data: comps, error: cErr }] = await Promise.all([SB().rpc("my_access"), SB().from("companies").select("*").order("order")]);
  if (aErr) return fail("Could not check your access: " + aErr.message);
  if (!access) {
    // not a member: sign-up. Companies are not readable yet (no access), so list them through the public function.
    const { data: pub } = await SB().rpc("public_companies");
    S.entering = false; gateState("signup", { email, g, companies: Array.isArray(pub) && pub.length ? pub : [{ id: "events", name: "Future Ready Event Management", active: true }, { id: "press", name: "Future Ready Press", active: true }, { id: "group", name: "Future Ready Nig. Ltd", active: true }] }); setSync(false, "no access"); return;
  }
  if (access.status === "pending") { S.entering = false; gateState("pending", { me: access }); setSync(false, "awaiting approval"); return; }
  if (access.status === "disabled") { S.entering = false; gateState("disabled", { me: access }); setSync(false, "no access"); return; }
  if (access.status !== "active") return fail(`Account state "${access.status}" is not recognised.`);
  S.access = access; S.companies = cErr ? [] : (comps || []);
  if (!access.group_admin && !Object.keys(access.companies || {}).length) { S.entering = false; gateState("noaccess", { me: access }); setSync(false, "no access"); return; }
  S.me = { id: email, email, name: access.name || g.name || email, avatarUrl: access.photo_url || g.avatar || "", level: access.level, position: access.position || "", profile: access, uid: session.user.id, g };
  S.db = FR.dbShim; S.members = {}; S.team = [];
  const r = routeFromHash();
  S.company = (r.company && roleIn(r.company) && S.companies.some(c => c.id === r.company && c.active)) ? r.company : defaultCompany();
  safeSet("fr_company", S.company); applyCompanyAccess(); buildNav();
  $("#gate").hidden = true; gateShow.stop();
  FR.paintRole(); setSync(true, "live");
  logAct("ok", `Signed in as ${S.me.name} (${roleLabel()}, ${FR.companyName(S.company)})`);
  for (const m of Object.values(FR.modules)) m.start?.();
  loadMembers();
  FR.subscribe("companies", async () => { const { data } = await SB().from("companies").select("*").order("order"); if (data) { S.companies = data; buildNav(); if (S.view === "team") FR.render(); } });
  setView(r.view && viewDef(r.view) ? r.view : "dashboard");
  if (!access.profile_done) openProfile(true);
}
async function loadMembers() {
  const [{ data, error }, { data: cm }] = await Promise.all([
    SB().from("members").select("email,name,level,status,position,photo_url,phone,surname,first_name,other_names,requested_level,requested_company,requested_role,added_at,joined_at,last_seen_at,invited_by,invite_sent_at,profile_done").order("added_at"),
    SB().from("company_members").select("email,company_id,role,added_at"),
  ]);
  if (error) { logAct("bad", "Could not load the team list", error.message); return; }
  S.team = data || []; S.companyMembers = cm || []; S.members = {}; for (const m of S.team) S.members[m.email.toLowerCase()] = m;
  paintTeamBadge();
  if (S.view === "team") FR.render(); else FR.resolveNames();
  // my own access changed under me? reload to pick it up
  const mine = S.members[S.me.email]; if (mine && (mine.status !== "active" || mine.level !== S.me.level)) location.reload();
  if (!loadMembers.sub) { loadMembers.sub = FR.subscribe("members", loadMembers); loadMembers.sub2 = FR.subscribe("company_members", loadMembers); }
}
function pendingForMe() { return (S.team || []).filter(m => m.status === "pending" && (isGroupAdmin() || (m.requested_company && isCompanyAdmin(m.requested_company)))); }
function paintTeamBadge() { const c = $("#cnt-team"); if (!c) return; const n = pendingForMe().length; c.textContent = n; c.hidden = !n; }

/* ---------- profile ---------- */
function openProfile(first) {
  const m = S.me; if (!m) return;
  const p = m.profile || {}, g = m.g || {};
  const v = { surname: p.surname || g.surname || "", first_name: p.first_name || g.first || "", other_names: p.other_names || g.other || "", phone: p.phone || "", position: p.position || "", photo_url: p.photo_url || g.avatar || "" };
  const modal = $("#pf-modal"); $("#pf-scrim").hidden = false;
  const initials = ((v.first_name[0] || "") + (v.surname[0] || "")).toUpperCase() || "?";
  modal.innerHTML = `<h2 id="pf-title">${first ? "Complete your profile" : "Your profile"} <small class="muted" style="font-family:var(--body);font-weight:400;font-size:12px">${esc(m.email)}</small></h2>
    ${first ? `<p class="muted" style="margin:0 0 12px">Colleagues see this on the Team page and next to the records you change. Details from your Google account are filled in; correct anything that is wrong.</p>` : ""}
    <div class="pf-photo" style="margin-bottom:12px"><div class="avatar" id="pf-avatar">${v.photo_url ? `<img src="${esc(v.photo_url)}" alt="">` : esc(initials)}</div>
      <div><input type="file" id="pf-file" accept="image/png,image/jpeg,image/webp" hidden><button class="btn small" id="pf-upload">Upload a photo</button> ${g.avatar ? `<button class="btn small" id="pf-google">Use Google photo</button>` : ""}<p class="hint">JPG, PNG or WebP. It is resized to 256 px.</p></div></div>
    <div class="fields">
      <div class="field"><label>Surname</label><input id="pf-surname" value="${esc(v.surname)}" autocomplete="family-name"></div>
      <div class="field"><label>First name</label><input id="pf-first" value="${esc(v.first_name)}" autocomplete="given-name"></div>
      <div class="field wide"><label>Other names <span class="muted">(optional)</span></label><input id="pf-other" value="${esc(v.other_names)}" autocomplete="additional-name"></div>
      <div class="field"><label>Phone number</label><input id="pf-phone" value="${esc(v.phone)}" inputmode="tel" placeholder="0803 000 0000" autocomplete="tel"></div>
      <div class="field"><label>Position</label><input id="pf-pos" value="${esc(v.position)}" placeholder="e.g. CEO, Managing Director, Lead Supervisor" list="pf-pos-list"><datalist id="pf-pos-list"><option>CEO</option><option>Managing Director</option><option>General Supervisor</option><option>Lead Supervisor</option><option>HR Manager</option><option>Recruiter</option><option>Operations Manager</option><option>Assistant</option></datalist></div>
    </div>
    <p class="hint" id="pf-err" style="color:var(--bad)"></p>
    <div class="toolbar" style="justify-content:flex-end;margin-top:12px">${first ? "" : `<button class="btn" id="pf-cancel">Cancel</button>`}<button class="btn primary" id="pf-save">${first ? "Save and continue" : "Save"}</button></div>`;
  let photo = v.photo_url;
  const setAvatar = url => { photo = url; $("#pf-avatar").innerHTML = url ? `<img src="${esc(url)}" alt="">` : esc(initials); };
  $("#pf-upload").onclick = () => $("#pf-file").click();
  $("#pf-google")?.addEventListener("click", () => setAvatar(g.avatar));
  $("#pf-file").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    $("#pf-upload").disabled = true; $("#pf-upload").textContent = "Uploading…";
    try { setAvatar(await uploadAvatar(f)); toast("Photo uploaded", "ok"); }
    catch (err) { $("#pf-err").textContent = "Photo upload failed: " + (err.message || err); }
    $("#pf-upload").disabled = false; $("#pf-upload").textContent = "Upload a photo";
  };
  $("#pf-cancel")?.addEventListener("click", () => { $("#pf-scrim").hidden = true; });
  $("#pf-save").onclick = async () => {
    const body = { surname: $("#pf-surname").value.trim(), first_name: $("#pf-first").value.trim(), other_names: $("#pf-other").value.trim(), phone: $("#pf-phone").value.trim(), position: $("#pf-pos").value.trim(), photo_url: photo || "" };
    if (!body.surname || !body.first_name) { $("#pf-err").textContent = "Surname and first name are required."; return; }
    if (!body.phone) { $("#pf-err").textContent = "Phone number is required."; return; }
    if (!body.position) { $("#pf-err").textContent = "Position is required."; return; }
    $("#pf-err").textContent = ""; $("#pf-save").disabled = true; $("#pf-save").textContent = "Saving…";
    const { data, error } = await SB().rpc("update_my_profile", { p: body });
    $("#pf-save").disabled = false; $("#pf-save").textContent = first ? "Save and continue" : "Save";
    if (error || !data) { $("#pf-err").textContent = error?.message || "The profile could not be saved. Reload and try again."; return; }
    S.me.profile = data; S.me.name = data.name || S.me.name; S.me.avatarUrl = data.photo_url || S.me.avatarUrl; S.me.position = data.position || "";
    FR.paintRole(); $("#pf-scrim").hidden = true; toast("Profile saved", "ok"); loadMembers();
  };
}
FR.openProfile = openProfile;
async function uploadAvatar(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Choose a JPG, PNG or WebP image");
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("That file is not a readable image")); i.src = URL.createObjectURL(file); });
  const size = 256, c = document.createElement("canvas"); c.width = size; c.height = size;
  const s = Math.min(img.width, img.height), sx = (img.width - s) / 2, sy = (img.height - s) / 2;
  c.getContext("2d").drawImage(img, sx, sy, s, s, 0, 0, size, size);
  const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.88));
  const path = `${S.me.uid}/avatar.jpg`;
  const { error } = await SB().storage.from("avatars").upload(path, blob, { upsert: true, contentType: "image/jpeg", cacheControl: "3600" });
  if (error) throw new Error(error.message);
  const { data } = SB().storage.from("avatars").getPublicUrl(path);
  return data.publicUrl + "?v=" + Date.now();
}
$("#pf-scrim").addEventListener("click", e => { if (e.target === $("#pf-scrim") && $("#pf-cancel")) $("#pf-scrim").hidden = true; });

/* ---------- Team page (Group Admins: everything; company Admins: their company) ---------- */
const roleOpts = (sel, withNone) => (withNone ? `<option value="">No access</option>` : "") + ["viewer", "staff", "manager", "admin"].map(r => `<option value="${r}" ${sel === r ? "selected" : ""}>${ROLE_LABEL[r]}</option>`).join("");
function cmRole(email, cid) { return (S.companyMembers.find(x => x.email.toLowerCase() === email.toLowerCase() && x.company_id === cid) || {}).role || ""; }
FR.renderTeam = function renderTeam() {
  const el = $("#v-team"); if (!canManageTeam()) { el.innerHTML = ""; return; }
  const cid = S.company, team = S.team || [], me = S.me.email, ga = isGroupAdmin();
  const comps = S.companies.filter(c => c.active).sort((a, b) => a.order - b.order);
  const manageable = ga ? comps : comps.filter(c => isCompanyAdmin(c.id));
  const groupAdmins = team.filter(m => m.level === "editor" && m.status === "active");
  const pending = pendingForMe(), invited = team.filter(m => m.status === "invited" && (ga || cmRole(m.email, cid)));
  const inCompany = team.filter(m => (m.status === "active" || m.status === "disabled") && m.level !== "editor" && cmRole(m.email, cid));
  const others = ga ? team.filter(m => (m.status === "active" || m.status === "disabled") && m.level !== "editor" && !cmRole(m.email, cid)) : [];
  const personLine = m => `<small>${esc(m.position || "No position yet")} · ${esc(m.email)}${m.phone ? " · " + esc(m.phone) : ""}</small>`;
  const row = (m, opts = {}) => {
    const isMe = m.email.toLowerCase() === me, lastGA = m.level === "editor" && m.status === "active" && groupAdmins.length <= 1;
    const cRole = cmRole(m.email, cid);
    return `<div class="member ${isMe ? "me-row" : ""} ${m.status === "disabled" ? "off" : ""}">${avatarHtml(m)}
      <div style="min-width:0"><b>${esc(memberName(m))} ${isMe ? '<span class="pill accent flat">you</span>' : ""} ${m.status === "disabled" ? '<span class="pill warn flat">disabled</span>' : ""}${m.level === "editor" ? ' <span class="pill ok flat">Group Admin</span>' : ""}</b>
        ${personLine(m)}
        <small>${opts.showCompanies ? esc(S.companyMembers.filter(x => x.email.toLowerCase() === m.email.toLowerCase()).map(x => `${FR.companyShort(x.company_id)}: ${ROLE_LABEL[x.role]}`).join(" · ") || "no company roles") + " · " : ""}joined ${when(m.joined_at || m.added_at)}${m.last_seen_at ? " · last seen " + when(m.last_seen_at) : ""}${m.profile_done ? "" : " · profile not completed"}</small></div>
      <div class="acts">
        ${opts.companyRole ? `<select data-crole="${esc(m.email)}" aria-label="Role in ${esc(FR.companyName(cid))}">${roleOpts(cRole, true)}</select>` : ""}
        ${ga && m.level !== "editor" ? `<button class="btn small" data-make-ga="${esc(m.email)}" title="Full access to every company">Make Group Admin</button>` : ""}
        ${ga && m.level === "editor" && !lastGA ? `<button class="btn small" data-unmake-ga="${esc(m.email)}">Remove Group Admin</button>` : ""}
        ${ga && !lastGA ? (m.status === "disabled" ? `<button class="btn small" data-enable="${esc(m.email)}">Enable</button>` : `<button class="btn small" data-disable="${esc(m.email)}">Disable</button>`) : ""}
        ${ga && !lastGA ? `<button class="btn small danger" data-remove="${esc(m.email)}">Remove</button>` : ""}
        ${lastGA ? `<span class="hint" style="margin:0">last Group Admin</span>` : ""}
      </div></div>`;
  };
  el.innerHTML = `
    <div class="team-grid">
      <div class="card"><h2>Invite someone <small>they get an email with a personal link</small></h2>
        <div class="fields">
          <div class="field wide"><label>Google email address</label><input id="iv-email" type="email" placeholder="name@gmail.com" autocomplete="off"></div>
          <div class="field"><label>Name <span class="muted">(optional)</span></label><input id="iv-name" placeholder="Used in the email greeting"></div>
          <div class="field"><label>Company</label><select id="iv-company">${manageable.map(c => `<option value="${esc(c.id)}" ${c.id === cid ? "selected" : ""}>${esc(c.name)}</option>`).join("")}${ga ? `<option value="__group">Whole group (Group Admin)</option>` : ""}</select></div>
          <div class="field wide"><label>Role</label><select id="iv-role">${roleOpts("viewer", false)}</select><p class="hint" id="iv-help">${ROLE_HELP.viewer}</p></div>
        </div>
        <p class="hint" id="iv-err" style="color:var(--bad)"></p>
        <div class="toolbar" style="justify-content:flex-end;margin-top:8px"><button class="btn primary" id="iv-send">Send invitation</button></div></div>
      <div class="card"><h2>Access requests <small>${pending.length ? pending.length + " waiting" : "none waiting"}</small></h2>
        <div class="team-list">${pending.map(m => { const k = esc(m.email).replace(/[^a-z0-9]/gi, "_"); const rc = m.requested_company && manageable.some(c => c.id === m.requested_company) ? m.requested_company : (manageable[0] || {}).id; return `<div class="member">${avatarHtml(m)}<div style="min-width:0"><b>${esc(memberName(m))}</b><small>${esc(m.email)} · asked for ${ROLE_LABEL[m.requested_role] || "Viewer"}${m.requested_company ? " in " + esc(FR.companyName(m.requested_company)) : ""} · ${when(m.added_at)}</small></div>
          <div class="acts"><select id="apc-${k}" aria-label="Company">${manageable.map(c => `<option value="${esc(c.id)}" ${c.id === rc ? "selected" : ""}>${esc(c.short_name)}</option>`).join("")}${ga ? `<option value="__group">Group Admin</option>` : ""}</select><select id="apr-${k}" aria-label="Role">${roleOpts(m.requested_role || "viewer", false)}</select><button class="btn small primary" data-approve="${esc(m.email)}">Approve</button><button class="btn small danger" data-remove="${esc(m.email)}">Decline</button></div></div>`; }).join("") || `<p class="muted">When someone signs in with Google without an invitation, their request appears here.</p>`}</div></div>
    </div>
    ${invited.length ? `<div class="card"><h2>Invitations sent <small>not yet accepted</small></h2><div class="team-list">${invited.map(m => `<div class="member">${avatarHtml(m)}<div style="min-width:0"><b>${esc(memberName(m))}</b><small>${esc(m.email)} · ${m.level === "editor" ? "Group Admin" : S.companyMembers.filter(x => x.email.toLowerCase() === m.email.toLowerCase()).map(x => `${FR.companyShort(x.company_id)}: ${ROLE_LABEL[x.role]}`).join(", ") || "no role yet"} · invited ${when(m.invited_at || m.added_at)}${m.invite_sent_at ? "" : " · email not confirmed sent"}</small></div>
      <div class="acts"><button class="btn small" data-resend="${esc(m.email)}">Resend email</button>${ga ? `<button class="btn small danger" data-remove="${esc(m.email)}">Cancel</button>` : ""}</div></div>`).join("")}</div></div>` : ""}
    <div class="card"><h2>${esc(FR.companyName(cid))} <small>${inCompany.length} with a role here</small></h2><div class="team-list">${inCompany.map(m => row(m, { companyRole: true })).join("") || `<p class="muted">Nobody has a role in this company yet. Invite someone above, or give an existing member a role below.</p>`}</div></div>
    ${ga ? `<div class="card"><h2>Group Admins <small>full access to every company</small></h2><div class="team-list">${groupAdmins.map(m => row(m)).join("")}</div></div>` : ""}
    ${ga && others.length ? `<div class="card"><h2>Members of other companies <small>give them a role in ${esc(FR.companyShort(cid))} with the dropdown</small></h2><div class="team-list">${others.map(m => row(m, { companyRole: true, showCompanies: true })).join("")}</div></div>` : ""}
    ${ga ? `<div class="card"><h2>Companies <small>what the group is made of</small></h2>
      <div class="team-list">${comps.map(c => `<div class="member"><div class="avatar">${esc(c.short_name.slice(0, 2).toUpperCase())}</div><div style="min-width:0"><b>${esc(c.name)}</b><small>${esc(c.short_name)} · ${c.kind === "group" ? "parent company" : "company"} · modules: ${(c.modules || []).join(", ")}</small></div>
        <div class="acts">${c.kind !== "group" ? `<button class="btn small" data-co-toggle="${esc(c.id)}" data-active="${c.active ? 1 : 0}">${c.active ? "Deactivate" : "Activate"}</button>` : ""}</div></div>`).join("")}</div>
      <div class="fields" style="margin-top:12px"><div class="field"><label>New company name</label><input id="co-name" placeholder="e.g. Future Ready Logistics"></div><div class="field"><label>Short name</label><input id="co-short" placeholder="e.g. Logistics"></div></div>
      <div class="toolbar" style="justify-content:flex-end;margin-top:8px"><button class="btn" id="co-add">Add company</button></div></div>` : ""}`;
  const busy = (b, on, label) => { if (!b) return; b.disabled = on; if (label) b.textContent = label; };
  $("#iv-role").onchange = () => { $("#iv-help").textContent = ROLE_HELP[$("#iv-role").value] || ""; };
  $("#iv-company").onchange = () => { const grp = $("#iv-company").value === "__group"; $("#iv-role").disabled = grp; $("#iv-help").textContent = grp ? "Group Admin: everything in every company, can make other Group Admins" : ROLE_HELP[$("#iv-role").value]; };
  $("#iv-send").onclick = async () => {
    const email = $("#iv-email").value.trim().toLowerCase(), name = $("#iv-name").value.trim(), co = $("#iv-company").value, role = $("#iv-role").value; $("#iv-err").textContent = "";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { $("#iv-err").textContent = "Enter a valid email address."; return; }
    busy($("#iv-send"), true, "Sending…");
    const out = await callFunction("invite-member", co === "__group" ? { email, name, level: "editor" } : { email, name, level: "viewer", company: co, role });
    busy($("#iv-send"), false, "Send invitation");
    if (out.error && !out.status) { $("#iv-err").textContent = out.detail || out.error; logAct("bad", `Invitation to ${email} failed`, out.detail || out.error); return; }
    if (out.status === "sent") { toast(`Invitation sent to ${email}`, "ok"); $("#iv-email").value = ""; $("#iv-name").value = ""; }
    else if (out.status === "active") toast(`${email} is already a member; role in ${FR.companyShort(co)} set to ${ROLE_LABEL[role]}`, "ok");
    else { toast(`Invitation recorded, but the email failed: ${out.error || "unknown"}`, "warn"); logAct("warn", `Invitation email to ${email} failed`, out.error || ""); }
    loadMembers();
  };
  el.querySelectorAll("[data-approve]").forEach(b => b.onclick = async () => {
    const email = b.dataset.approve, k = email.replace(/[^a-z0-9]/gi, "_"), co = $("#apc-" + k).value, role = $("#apr-" + k).value; busy(b, true, "Approving…");
    const { error } = await SB().rpc("admin_approve", co === "__group" ? { p_email: email, p_group_admin: true } : { p_email: email, p_company: co, p_role: role });
    if (error) { toast(error.message, "bad"); busy(b, false, "Approve"); return; }
    toast(`${email} approved${co === "__group" ? " as Group Admin" : ` as ${ROLE_LABEL[role]} in ${FR.companyShort(co)}`}`, "ok"); loadMembers();
  });
  el.querySelectorAll("[data-remove]").forEach(b => b.onclick = async () => {
    const email = b.dataset.remove; if (!confirm(`Remove ${email} from the system? They will no longer be able to sign in.`)) return; busy(b, true, "Removing…");
    const { error } = await SB().rpc("admin_remove_member", { p_email: email });
    if (error) { toast(error.message, "bad"); busy(b, false, "Remove"); return; }
    toast(`${email} removed`, "ok"); loadMembers();
  });
  el.querySelectorAll("[data-disable],[data-enable]").forEach(b => b.onclick = async () => {
    const email = b.dataset.disable || b.dataset.enable, status = b.dataset.disable ? "disabled" : "active"; busy(b, true, "…");
    const { error } = await SB().rpc("admin_set_member", { p_email: email, p_status: status });
    if (error) { toast(error.message, "bad"); busy(b, false, status === "disabled" ? "Disable" : "Enable"); return; }
    toast(`${email} ${status === "disabled" ? "disabled" : "enabled"}`, "ok"); loadMembers();
  });
  el.querySelectorAll("[data-make-ga],[data-unmake-ga]").forEach(b => b.onclick = async () => {
    const email = b.dataset.makeGa || b.dataset.unmakeGa, level = b.dataset.makeGa ? "editor" : "viewer";
    if (level === "editor" && !confirm(`Make ${email} a Group Admin? They will have full access to every company, the same as you.`)) return;
    busy(b, true, "…");
    const { error } = await SB().rpc("admin_set_member", { p_email: email, p_level: level });
    if (error) { toast(error.message, "bad"); loadMembers(); return; }
    toast(level === "editor" ? `${email} is now a Group Admin` : `${email} is no longer a Group Admin`, "ok"); logAct("ok", `${email} group level set to ${LEVEL_LABEL[level]}`); loadMembers();
  });
  el.querySelectorAll("[data-crole]").forEach(sel => sel.onchange = async () => {
    const email = sel.dataset.crole, role = sel.value || null;
    const { error } = await SB().rpc("admin_set_company_role", { p_email: email, p_company: cid, p_role: role });
    if (error) { toast(error.message, "bad"); loadMembers(); return; }
    toast(role ? `${email} is now ${ROLE_LABEL[role]} in ${FR.companyShort(cid)}` : `${email} removed from ${FR.companyShort(cid)}`, "ok"); loadMembers();
    if (email.toLowerCase() === me) location.reload();
  });
  el.querySelectorAll("[data-resend]").forEach(b => b.onclick = async () => {
    const m = S.members[b.dataset.resend.toLowerCase()] || {}; const cr = S.companyMembers.find(x => x.email.toLowerCase() === b.dataset.resend.toLowerCase());
    busy(b, true, "Sending…"); const out = await callFunction("invite-member", m.level === "editor" ? { email: b.dataset.resend, level: "editor" } : { email: b.dataset.resend, level: "viewer", company: cr?.company_id, role: cr?.role }); busy(b, false, "Resend email");
    if (out.status === "sent") toast("Invitation email sent again", "ok"); else toast("Could not send: " + (out.detail || out.error || "unknown"), "bad");
    loadMembers();
  });
  el.querySelectorAll("[data-co-toggle]").forEach(b => b.onclick = async () => {
    const c = S.companies.find(x => x.id === b.dataset.coToggle); if (!c) return; const next = b.dataset.active !== "1";
    if (!next && !confirm(`Deactivate ${c.name}? Its data stays; it disappears from the company list until reactivated.`)) return;
    const { error } = await SB().rpc("admin_save_company", { p_id: c.id, p_name: c.name, p_short: c.short_name, p_active: next });
    if (error) { toast(error.message, "bad"); return; } toast(`${c.name} ${next ? "activated" : "deactivated"}`, "ok");
  });
  $("#co-add")?.addEventListener("click", async () => {
    const name = $("#co-name").value.trim(), short = $("#co-short").value.trim(); if (!name) { toast("Enter the company name", "warn"); return; }
    const { error } = await SB().rpc("admin_save_company", { p_id: name, p_name: name, p_short: short || name, p_active: true });
    if (error) { toast(error.message, "bad"); return; } toast(`${name} added`, "ok"); $("#co-name").value = ""; $("#co-short").value = "";
  });
};

document.addEventListener("keydown", e => { if (e.key === "Escape") { FR.modules[S.module]?.closeDrawer?.(); togglePop(false); if (!$("#dl-scrim").hidden) FR.modules.hiring?.closeDownload?.(); if (!$("#act-scrim").hidden) $("#act-scrim").hidden = true; } });
boot();
})();
