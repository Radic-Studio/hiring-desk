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

/* ---------- navigation: companies × modules × views ----------
   Sidebar = Home + the modules this person can use in the selected company (+ Group admin pages).
   Inside a module, its sections are links under the page title. Every page has a real address:
   #/<company>/<view>[/<record id>], so a page or a filtered record can be bookmarked or shared. */
const ICON = {
  home: '<svg viewBox="0 0 24 24"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/></svg>',
  team: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="9" r="2.5"/><path d="M15.5 14.2a5 5 0 0 1 6 4.8"/></svg>',
  deleted: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/></svg>',
  conflicts: '<svg viewBox="0 0 24 24"><path d="M7 4v10M7 14l-3-3M7 14l3-3M17 20V10M17 10l-3 3M17 10l3 3"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
};
const SHELL_VIEWS = {
  home: { id: "home", title: "Home", sub: "What needs attention today, across the modules you use" },
  team: { id: "team", title: "Team", sub: "Who can use the system, invitations and access requests" },
  deleted: { id: "deleted", title: "Recently deleted", sub: "Deleted records stay here until a Group Admin restores them or removes them for good" },
  conflicts: { id: "conflicts", title: "Conflicts", sub: "Saves that clashed with someone else's change to the same field, waiting for a decision" } };
S.lastView = S.lastView || {};
// Hiring is a group-level function: only Group Admins (CEO, Directors, General Supervisor) see it, whichever company is selected.
function companyModules(cid) { const c = S.companies.find(x => x.id === cid); return (c?.modules || ["hiring"]).filter(id => id !== "hiring" || isGroupAdmin()).map(id => FR.modules[id]).filter(Boolean); }
FR.companyModules = companyModules;
function viewDef(v) { if (SHELL_VIEWS[v]) return SHELL_VIEWS[v]; for (const m of companyModules(S.company)) { const d = m.views.find(x => x.id === v); if (d) return { ...d, module: m.id }; } return null; }
const href = (v, param) => `#/${S.company}/${v}${param ? "/" + encodeURIComponent(param) : ""}`;
FR.href = href;
const modFirstView = m => S.lastView[m.id] && m.views.some(v => v.id === S.lastView[m.id]) ? S.lastView[m.id] : m.views.find(v => !v.hidden).id;
function buildNav() {
  const mods = companyModules(S.company);
  const item = (id, view, label, icon, extra = "") => `<a class="nav-item" href="${href(view)}" data-nav="${id}" data-view="${view}" title="${esc(label)}">${icon || ""}<span class="lbl">${esc(label)}</span>${extra}</a>`;
  $("#tabs").innerHTML = `<div class="nav-group">${item("home", "home", "Home", ICON.home, `<span class="cnt" id="cnt-home" hidden>0</span>`)}${mods.map(m => item(m.id, modFirstView(m), m.name, m.icon)).join("")}</div>`
    + (canManageTeam() || isGroupAdmin() ? `<div class="nav-group"><div class="nav-head">Group</div>${canManageTeam() ? item("team", "team", "Team", ICON.team, `<span class="cnt" id="cnt-team" hidden>0</span>`) : ""}${isGroupAdmin() ? item("deleted", "deleted", "Recently deleted", ICON.deleted, `<span class="cnt" id="cnt-deleted" hidden>0</span>`) + item("conflicts", "conflicts", "Conflicts", ICON.conflicts, `<span class="cnt" id="cnt-conflicts" hidden>0</span>`) : ""}</div>` : "");
  // phones: Home + up to three modules + More (opens the full menu)
  const bn = $("#bottom-nav");
  bn.innerHTML = [item("home", "home", "Home", ICON.home), ...mods.slice(0, 3).map(m => item(m.id, modFirstView(m), m.name, m.icon))].join("").replace(/class="nav-item"/g, 'class="bn-item"')
    + `<button type="button" class="bn-item" id="bn-more" aria-label="More: companies, team and account">${ICON.more}<span class="lbl">More</span></button>`;
  bn.hidden = false; $("#bn-more").onclick = () => sideOpen(true);
  // one section per view, created once
  const main = $("main");
  for (const m of Object.values(FR.modules)) for (const v of m.views) if (!$("#v-" + v.id)) { const s = document.createElement("section"); s.className = "view"; s.id = "v-" + v.id; s.hidden = true; main.appendChild(s); }
  for (const v of Object.keys(SHELL_VIEWS)) if (!$("#v-" + v)) { const s = document.createElement("section"); s.className = "view"; s.id = "v-" + v; s.hidden = true; main.appendChild(s); }
  paintCompanySwitch(); paintTeamBadge(); paintCompanyBadge(); paintDeletedBadge(); FR.paintConflictBadge?.(); markNav();
}
function markNav() {
  const d = viewDef(S.view) || {}; const cur = d.module || S.view;
  for (const a of document.querySelectorAll("#tabs [data-nav], #bottom-nav [data-nav]")) { const on = a.dataset.nav === cur; if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); }
  // module links remember the last section used
  for (const m of companyModules(S.company)) for (const a of document.querySelectorAll(`[data-nav="${m.id}"]`)) a.setAttribute("href", href(modFirstView(m)));
}
function paintSubnav(d) {
  const nav = $("#subnav"); const m = d.module && FR.modules[d.module];
  if (!m) { nav.hidden = true; nav.innerHTML = ""; return; }
  const cur = d.parent || d.id;
  const keep = {}; for (const c of nav.querySelectorAll(".cnt")) keep[c.id] = [c.textContent, c.hidden];
  nav.setAttribute("aria-label", `${m.name} sections`);
  nav.innerHTML = m.views.filter(v => !v.hidden && (!v.can || v.can())).map(v => `<a href="${href(v.id)}" data-view="${v.id}" ${v.id === cur ? 'aria-current="page"' : ""}>${esc(v.nav || v.title)}${v.count ? `<span class="cnt" id="cnt-${v.id}" hidden>0</span>` : ""}</a>`).join("");
  for (const [id, [t, h]] of Object.entries(keep)) { const c = document.getElementById(id); if (c) { c.textContent = t; c.hidden = h; } }
  nav.hidden = false;
}
function paintPrimary(d) {
  const b = $("#primary-btn"); const p = d.primary && (typeof d.primary === "function" ? d.primary() : d.primary);
  if (!p || (p.can && !p.can())) { b.hidden = true; b.onclick = null; return; }
  b.hidden = false; b.textContent = p.label; b.onclick = () => p.run();
}
FR.paintPrimary = () => { const d = viewDef(S.view); if (d) paintPrimary(d); };
function paintDeletedBadge() { const c = $("#cnt-deleted"); if (!c) return; const n = DEL.open.length; c.textContent = n; c.hidden = !n; }
const CO_ICON = { press: "./app/brand/app_icon_press.svg", events: "./app/brand/app_icon_events.svg" };
function paintCompanyBadge() {
  const b = $("#co-badge"); if (!b) return; const c = S.companies.find(x => x.id === S.company);
  document.body.dataset.company = ["press", "events"].includes(S.company) ? S.company : "group";
  if (!c) { b.hidden = true; return; }
  b.hidden = false; b.innerHTML = `${CO_ICON[c.id] ? `<img src="${CO_ICON[c.id]}" alt="">` : ""}${esc(c.short_name)}`; b.title = c.name;
}
/* sidebar: collapsible rail on desktop, slide-in drawer below 900 px */
const sideOpen = on => { document.body.classList.toggle("side-open", on); $("#side-scrim").hidden = !on; if (on) setTimeout(() => $("#side-close")?.focus(), 50); };
function initSide() {
  if (safeGet("fr_side") === "collapsed") document.body.classList.add("side-collapsed");
  $("#side-toggle").onclick = () => { const on = document.body.classList.toggle("side-collapsed"); safeSet("fr_side", on ? "collapsed" : "open"); $("#side-toggle").title = $("#side-toggle").ariaLabel = on ? "Expand menu" : "Collapse menu"; };
  $("#menu-btn").onclick = () => sideOpen(true);
  $("#side-close").onclick = () => sideOpen(false);
  $("#side-scrim").onclick = () => sideOpen(false);
}
function paintCompanySwitch() {
  const el = $("#company-switch"); if (!el) return;
  const list = S.companies.filter(c => c.active && roleIn(c.id));
  if (list.length <= 1) { el.innerHTML = `<div class="co-one"><span class="co-label">Company</span><b>${esc(FR.companyName(S.company) || "Future Ready")}</b></div>`; return; }
  const cur = list.find(c => c.id === S.company);
  el.innerHTML = `<label class="co-label" for="company-sel">Company</label><select id="company-sel">${list.map(c => `<option value="${esc(c.id)}" ${c.id === S.company ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select><button class="co-mini" id="co-mini" title="${esc(cur?.name || "")} · expand to switch">${esc((cur?.short_name || "FR").slice(0, 2).toUpperCase())}</button>`;
  $("#company-sel").onchange = e => switchCompany(e.target.value);
  $("#co-mini").onclick = () => $("#side-toggle").click();
}
function switchCompany(cid, view, param) {
  if (!S.companies.some(c => c.id === cid && c.active) || !roleIn(cid)) cid = defaultCompany();
  const changed = cid !== S.company;
  S.company = cid; safeSet("fr_company", cid); applyCompanyAccess(); buildNav();
  if (changed) for (const m of companyModules(cid)) m.onCompany?.();
  FR.paintRole();
  setView(view || (viewDef(S.view) ? S.view : "home"), { param });
}
function defaultCompany() {
  const ok = S.companies.filter(c => c.active && roleIn(c.id)).sort((a, b) => a.order - b.order);
  const saved = safeGet("fr_company");
  return (ok.find(c => c.id === saved) || ok.find(c => c.kind === "group") || ok[0] || {}).id || null;
}
function setView(v, opts = {}) {
  if ((v === "deleted" || v === "conflicts") && !isGroupAdmin()) v = "home";
  if (v === "dashboard" && !viewDef("dashboard")) v = "home";
  let d = viewDef(v); if (!d) { v = "home"; d = viewDef(v); }
  const moved = v !== S.view;
  S.view = v; S.module = d.module || null; S.param = opts.param ?? (moved ? null : S.param);
  if (d.module && !d.hidden) S.lastView[d.module] = v;
  if (opts.role !== undefined) S.role = opts.role;
  if (opts.filters) S.filters = { q: "", status: "", loc: "", tier: "", avail: "", ...opts.filters };
  for (const s of document.querySelectorAll("main .view")) s.hidden = s.id !== "v-" + v;
  const mod = d.module && FR.modules[d.module];
  // context line: company, module (unless the company is named after it), and the list a record page belongs to (a link back)
  const par = d.parent && viewDef(d.parent);
  $("#crumb").innerHTML = [esc(FR.companyName(S.company) || ""), mod && !FR.companyName(S.company).toLowerCase().endsWith(mod.name.toLowerCase()) ? esc(mod.name) : "", par ? `<a href="${href(par.id)}" data-nav data-view="${par.id}">${esc(par.title)}</a>` : ""].filter(Boolean).join(" · ");
  $("#page-title").textContent = d.title; $("#page-sub").textContent = d.sub || "";
  $("#dl-btn").hidden = !(d.module && FR.modules[d.module]?.headerDownload && !d.hidden);
  paintSubnav(d); paintPrimary(d); markNav();
  if (!/access_token|refresh_token|error=|code=/.test(location.hash + location.search)) { try { history.replaceState(null, "", href(v, S.param)); } catch {} }
  if (moved) window.scrollTo({ top: 0 });
  sideOpen(false);
  document.title = `${d.title} · Future Ready`;
  FR.render();
  if (moved && opts.focus !== false) { const h = $("#page-title"); h.tabIndex = -1; if (document.activeElement && document.activeElement.closest && document.activeElement.closest("#tabs, #subnav, #bottom-nav")) h.focus({ preventScroll: true }); }
}
FR.setView = setView;
FR.openRecord = (view, id) => setView(view, { param: id });
function routeFromHash() { const m = (location.hash || "").match(/^#\/([a-z0-9-]+)\/([a-z0-9-]+)(?:\/([^/?#]+))?/); return m ? { company: m[1], view: m[2], param: m[3] ? decodeURIComponent(m[3]) : null } : { view: (location.hash || "").replace("#", "") }; }
// links carry real addresses; a plain click is routed here so the page does not reload or scroll
document.addEventListener("click", e => {
  const a = e.target.closest("#tabs a[data-view], #subnav a[data-view], #bottom-nav a[data-view], #crumb a[data-view]");
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
  e.preventDefault(); setView(a.dataset.view);
});
window.addEventListener("hashchange", () => { if (!S.me) return; const r = routeFromHash(); if (r.company && r.company !== S.company) switchCompany(r.company, r.view, r.param); else if (r.view && (r.view !== S.view || (r.param || null) !== (S.param || null))) setView(r.view, { param: r.param }); });

/* ---------- Home: what needs attention today ----------
   Each module may offer attention(): [{ id, level: "bad"|"warn"|"info", label, count, hint, go, items: [{ title, meta, go }] }].
   Home shows the counts first (each opens the filtered list), then the concrete records, most urgent first. */
const LEVEL_ORDER = { bad: 0, warn: 1, info: 2 };
function groupAttention() {
  const out = [];
  const pend = pendingForMe();
  if (pend.length) out.push({ id: "team", level: "warn", label: "Access requests", count: pend.length, hint: "waiting for approval", go: () => setView("team"), items: pend.slice(0, 4).map(m => ({ title: FR.memberName(m), meta: `asked for ${ROLE_LABEL[m.requested_role] || "access"}${m.requested_company ? " in " + FR.companyShort(m.requested_company) : ""}`, go: () => setView("team") })) });
  const cf = FR.openConflictCount?.() || 0;
  if (cf && isGroupAdmin()) out.push({ id: "conflicts", level: "warn", label: "Conflicts", count: cf, hint: "saves waiting for a decision", go: () => setView("conflicts"), items: [] });
  return out;
}
FR.renderHome = function renderHome() {
  const el = $("#v-home"); if (!el || !S.me) return;
  const mods = companyModules(S.company);
  const groups = [...mods.flatMap(m => (m.attention?.() || []).map(g => ({ ...g, module: m.name }))), ...groupAttention()];
  const live = groups.filter(g => g.count > 0).sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || b.count - a.count);
  const items = live.flatMap(g => (g.items || []).map(it => ({ ...it, level: g.level, group: g.label, module: g.module }))).sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  const loading = mods.some(m => m.ready && !m.ready());
  const hour = new Date().getHours(); const first = (S.me.name || "").split(" ")[0];
  const n = live.reduce((s, g) => s + g.count, 0); const c = $("#cnt-home"); if (c) { c.textContent = n; c.hidden = !n; }
  el.innerHTML = `<p class="lead">${hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"}, ${esc(first)}. ${loading ? "Loading your work…" : live.length ? `${n} thing${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} attention in ${esc(FR.companyName(S.company))}.` : `Nothing needs attention in ${esc(FR.companyName(S.company))} right now.`}</p>
    ${loading && !live.length ? `<div class="stat-row">${[1, 2, 3, 4].map(() => `<div class="stat sk"><span class="skeleton" style="width:60%"></span><span class="skeleton" style="width:30%;height:26px"></span></div>`).join("")}</div>` : ""}
    ${groups.length ? `<div class="stat-row">${groups.sort((a, b) => (b.count > 0) - (a.count > 0) || LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]).slice(0, 8).map((g, i) => `<button type="button" class="stat ${g.count ? g.level : "clear"}" data-g="${i}"><span class="stat-label">${esc(g.label)}</span><span class="stat-value">${g.count}</span><span class="stat-hint">${esc(g.count ? g.hint || "" : "all clear")}${mods.length > 1 && g.module ? ` · ${esc(g.module)}` : ""}</span></button>`).join("")}</div>` : ""}
    <section class="panel" aria-labelledby="att-h"><div class="panel-head"><h2 id="att-h">Needs attention</h2><span class="muted">${items.length ? `${Math.min(items.length, 12)} of ${items.length}, most urgent first` : ""}</span></div>
      ${items.length ? `<ul class="att-list">${items.slice(0, 12).map((it, i) => `<li><span class="lv ${it.level}" aria-hidden="true"></span><button type="button" class="att-main" data-i="${i}"><b>${esc(it.title)}</b><span>${esc(it.meta || "")}</span></button><span class="att-tag">${esc(it.group)}</span></li>`).join("")}</ul>`
        : `<div class="empty-inline">${loading ? "Checking…" : "All clear. New work will appear here as it comes in."}</div>`}
    </section>
    <section class="panel" aria-labelledby="go-h"><div class="panel-head"><h2 id="go-h">Go to</h2></div><div class="go-grid">${mods.map(m => `<a class="go-card" href="${href(modFirstView(m))}" data-go="${m.id}">${m.icon || ""}<span><b>${esc(m.name)}</b><small>${esc(m.views.filter(v => !v.hidden).map(v => v.nav || v.title).slice(0, 4).join(" · "))}</small></span></a>`).join("")}</div></section>`;
  const sorted = groups;
  el.querySelectorAll("[data-g]").forEach(b => b.onclick = () => sorted[+b.dataset.g].go?.());
  el.querySelectorAll(".att-main").forEach(b => b.onclick = () => items[+b.dataset.i].go?.());
  el.querySelectorAll("[data-go]").forEach(a => a.onclick = e => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); setView(modFirstView(FR.modules[a.dataset.go])); });
};
// modules call this when their data changes so Home and its badge stay current
FR.attentionChanged = () => { clearTimeout(FR.attentionChanged.t); FR.attentionChanged.t = setTimeout(() => { if (S.view === "home") FR.renderHome(); else { const mods = companyModules(S.company); const n = [...mods.flatMap(m => m.attention?.() || []), ...groupAttention()].reduce((s, g) => s + (g.count > 0 ? g.count : 0), 0); const c = $("#cnt-home"); if (c) { c.textContent = n; c.hidden = !n; } } }, 120); };

/* ---------- global search ----------
   One box for everything this person may see: modules offer search(q) → [{ title, meta, go }] from the data
   already on screen (so it obeys the same access rules). Results are grouped by module; arrows + Enter work. */
const GS = { results: [], active: -1 };
function runSearch(q) {
  const box = $("#gsearch"), pop = $("#gsearch-pop"), list = $("#gsearch-list"), empty = $("#gsearch-empty");
  q = q.trim(); GS.active = -1;
  if (q.length < 2) { pop.hidden = true; box.setAttribute("aria-expanded", "false"); box.removeAttribute("aria-activedescendant"); return; }
  const groups = companyModules(S.company).map(m => ({ m, rows: (m.search?.(q) || []).slice(0, 6) })).filter(g => g.rows.length);
  GS.results = groups.flatMap(g => g.rows.map(r => ({ ...r, module: g.m.name })));
  let i = 0;
  list.innerHTML = groups.map(g => `<li role="presentation" class="gs-head">${esc(g.m.name)}</li>${g.rows.map(r => `<li role="option" id="gs-${i}" data-i="${i++}" aria-selected="false"><b>${esc(r.title)}</b><span>${esc(r.meta || "")}</span></li>`).join("")}`).join("");
  empty.hidden = !!GS.results.length; empty.textContent = `Nothing matches "${q}". Search by name, phone, email, or a job, quote or receipt number.`;
  pop.hidden = false; box.setAttribute("aria-expanded", "true");
  list.querySelectorAll("[role=option]").forEach(o => o.onmousedown = e => { e.preventDefault(); pickSearch(+o.dataset.i); });
}
function pickSearch(i) { const r = GS.results[i]; if (!r) return; closeSearch(true); r.go(); }
function closeSearch(clear) { $("#gsearch-pop").hidden = true; $("#gsearch").setAttribute("aria-expanded", "false"); $("#gsearch").removeAttribute("aria-activedescendant"); if (clear) $("#gsearch").value = ""; document.body.classList.remove("search-open"); }
function moveSearch(d) {
  const opts = [...document.querySelectorAll("#gsearch-list [role=option]")]; if (!opts.length) return;
  GS.active = (GS.active + d + opts.length) % opts.length;
  opts.forEach((o, k) => o.setAttribute("aria-selected", k === GS.active)); $("#gsearch").setAttribute("aria-activedescendant", opts[GS.active].id); opts[GS.active].scrollIntoView({ block: "nearest" });
}
(function initSearch() {
  const box = $("#gsearch"); let t = null;
  box.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => runSearch(box.value), 120); });
  box.addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { e.preventDefault(); if ($("#gsearch-pop").hidden) runSearch(box.value); moveSearch(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveSearch(-1); }
    else if (e.key === "Enter") { e.preventDefault(); pickSearch(GS.active >= 0 ? GS.active : 0); }
    else if (e.key === "Escape") { e.stopPropagation(); closeSearch(true); box.blur(); }
  });
  box.addEventListener("blur", () => setTimeout(() => closeSearch(false), 120));
  $("#search-btn").onclick = () => { document.body.classList.add("search-open"); box.focus(); };
  document.addEventListener("keydown", e => { if (e.key === "/" && !e.target.closest("input,textarea,select,[contenteditable]") && S.me && !FR.drawer.isOpen()) { e.preventDefault(); document.body.classList.add("search-open"); box.focus(); } });
})();

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
    <p>${m?.email ? esc(m.email) + "<br>" : ""}${m?.position ? esc(m.position) + "<br>" : ""}Sign in with your email and password, or with Google. Change your password from Edit profile.</p>
    ${m ? `<ul>${isGroupAdmin() ? `<li>Group Admin: everything in every company</li>` : comps.map(c => `<li>${esc(c.name)}: ${ROLE_LABEL[roleIn(c.id)]}</li>`).join("") || "<li>No company access yet</li>"}</ul>` : ""}
    <div class="toolbar">${m ? `<button class="btn small" id="pop-profile">Edit profile</button><button class="btn small" id="pop-copy">Copy page link</button><button class="btn small" id="pop-out">Sign out</button>` : ``}<button class="btn small" id="pop-close">Close</button></div>`;
  pop.hidden = false; btn.setAttribute("aria-expanded", "true");
  $("#pop-close").onclick = () => togglePop(false);
  $("#pop-out")?.addEventListener("click", async () => { if (FR.outboxBeforeSignOut && !(await FR.outboxBeforeSignOut())) return; await SB().auth.signOut(); location.reload(); });
  $("#pop-profile")?.addEventListener("click", () => { togglePop(false); openProfile(false); });
  $("#pop-copy")?.addEventListener("click", async () => { try { await navigator.clipboard.writeText(location.href.split("#")[0]); toast("Link copied"); } catch { toast("Copy the link from your address bar"); } });
}
FR.togglePop = togglePop;
$("#me").addEventListener("click", () => togglePop());
$("#act-btn").addEventListener("click", FR.openActivity);
document.addEventListener("click", e => { if (!e.target.closest(".foot") && !$("#pop").hidden) togglePop(false); });

/* ---------- gate: sign-in, sign-up, pending, disabled ---------- */
function showGate(msg, note) { $("#gate").hidden = false; if (msg) $("#gate-msg").textContent = msg; $("#gate-note").textContent = note || ""; gateShow.start(); }
const GOOGLE_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#fff" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4z"/><path fill="#fff" opacity=".8" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"/><path fill="#fff" opacity=".6" d="M6.4 13.9a6 6 0 0 1 0-3.8V7.5H3.1a10 10 0 0 0 0 9z"/><path fill="#fff" opacity=".9" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.5l3.3 2.6C7.2 7.7 9.4 5.9 12 5.9z"/></svg>`;
const googleBtn = (label = "Continue with Google") => `<div class="or"><span>or</span></div><button type="button" class="btn gbtn" id="gate-google">${GOOGLE_SVG}${esc(label)}</button>`;
const pwField = (id, label, auto, extra = "") => `<div class="field"><label for="${id}">${label}</label><div class="pw"><input id="${id}" type="password" autocomplete="${auto}" minlength="8" required ${extra}><button type="button" class="eye" data-for="${id}" aria-label="Show password">Show</button></div></div>`;
const redirectTo = () => location.origin + location.pathname;
// Supabase error text → plain words
function authErr(e) {
  const m = String(e?.message || e || "");
  if (e?.name === "AuthRetryableFetchError" || (e?.status >= 500) || /failed to fetch|networkerror|load failed|^\{\}$/i.test(m))
    return navigator.onLine === false ? "This device is offline. Connect to the internet, then try again." : "The sign-in service is not answering right now. Wait a minute, then try again.";
  if (/invalid login credentials/i.test(m)) return "Wrong email or password.";
  if (/email not confirmed/i.test(m)) return "Confirm your email first: open the message we sent you, then sign in.";
  if (/already registered|already been registered/i.test(m)) return "That email already has an account. Sign in, or use Forgot password.";
  if (/rate limit|too many/i.test(m)) return "Too many attempts. Wait a few minutes and try again.";
  if (/password should be|weak|at least/i.test(m)) return "Use a longer password: at least 8 characters.";
  if (/same password|different from the old/i.test(m)) return "Choose a password you have not used here before.";
  return m || "Something went wrong. Try again.";
}
async function googleSignIn() {
  showGate("Opening Google sign-in…", "");
  const { error } = await SB().auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirectTo() } });
  if (error) showGate("Sign-in failed.", authErr(error));
}
function wireGateBody(root) {
  $$(".eye", root).forEach(b => b.onclick = () => { const i = $("#" + b.dataset.for); const show = i.type === "password"; i.type = show ? "text" : "password"; b.textContent = show ? "Hide" : "Show"; });
  $("#gate-google", root)?.addEventListener("click", googleSignIn);
}
function busy(btn, on, label) { btn.disabled = on; btn.textContent = on ? "Please wait…" : label; }
// The note (errors, confirmations) lives under whichever form is showing; park it outside before a form is replaced.
function parkNote() { let n = $("#gate-note"); if (!n) { n = document.createElement("p"); n.className = "hint"; n.id = "gate-note"; } $("#gate-card").insertBefore(n, $("#gate-card .fine")); n.textContent = ""; return n; }
function gateMode(mode, d = {}) {
  const title = $("#gate-title"), msg = $("#gate-msg"), body = $("#gate-body"), note = parkNote();
  $("#gate-seg").hidden = false;
  queueMicrotask(() => { const f = $("#gate-form"); if (f) f.appendChild(note); });
  $$("#gate-seg button").forEach(x => { const on = x.dataset.mode === (mode === "req" ? "req" : "in"); x.classList.toggle("on", on); x.setAttribute("aria-selected", on ? "true" : "false"); });
  if (mode === "req") {
    title.textContent = "Join the team"; msg.textContent = "Create your account, confirm your email, then choose the company and access you need. An Admin approves it.";
    body.innerHTML = `<form id="gate-form" novalidate>
      <div class="field"><label for="su-name">Your name</label><input id="su-name" autocomplete="name" required placeholder="As colleagues know you"></div>
      <div class="field"><label for="su-email">Email</label><input id="su-email" type="email" autocomplete="email" required placeholder="you@example.com"></div>
      ${pwField("su-pass", "Password", "new-password", 'placeholder="At least 8 characters"')}
      ${pwField("su-pass2", "Confirm password", "new-password")}
      <button class="btn primary" type="submit" id="gate-go">Create account</button>
      </form>${googleBtn("Continue with Google instead")}`;
    wireGateBody(body);
    $("#gate-form").onsubmit = async e => {
      e.preventDefault();
      const name = $("#su-name").value.trim(), email = $("#su-email").value.trim().toLowerCase(), p1 = $("#su-pass").value, p2 = $("#su-pass2").value;
      if (!name) return note.textContent = "Your name is required.";
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return note.textContent = "That is not a valid email address.";
      if (p1.length < 8) return note.textContent = "Use at least 8 characters for the password.";
      if (p1 !== p2) return note.textContent = "The two passwords do not match.";
      note.textContent = ""; const b = $("#gate-go"); busy(b, true);
      const { data, error } = await SB().auth.signUp({ email, password: p1, options: { data: { full_name: name }, emailRedirectTo: redirectTo() } });
      busy(b, false, "Create account");
      if (error) return note.textContent = authErr(error);
      if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) return note.textContent = authErr({ message: "already registered" });
      if (data?.session) return; // confirmation switched off in Supabase: the SIGNED_IN event takes over
      gateMode("check", { email });
    };
    return;
  }
  if (mode === "forgot") {
    title.textContent = "Reset your password"; msg.textContent = "Enter your email and we will send a link to choose a new password.";
    body.innerHTML = `<form id="gate-form" novalidate>
      <div class="field"><label for="fp-email">Email</label><input id="fp-email" type="email" autocomplete="email" required placeholder="you@example.com"></div>
      <button class="btn primary" type="submit" id="gate-go">Send reset link</button>
      <button class="btn link" type="button" id="gate-back">Back to sign in</button></form>`;
    $("#gate-back").onclick = () => gateMode("in");
    $("#gate-form").onsubmit = async e => {
      e.preventDefault(); const email = $("#fp-email").value.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return note.textContent = "That is not a valid email address.";
      const b = $("#gate-go"); busy(b, true);
      const { error } = await SB().auth.resetPasswordForEmail(email, { redirectTo: redirectTo() });
      busy(b, false, "Send reset link");
      if (error) return note.textContent = authErr(error);
      title.textContent = "Check your inbox"; msg.textContent = `If ${email} has an account, a reset link is on its way. It works once and expires in an hour.`;
      parkNote(); body.innerHTML = `<button class="btn" type="button" id="gate-back">Back to sign in</button>`; $("#gate-back").onclick = () => gateMode("in");
    };
    return;
  }
  if (mode === "check") {
    const email = d.email || "";
    title.textContent = "Check your inbox"; msg.textContent = `We sent a confirmation link to ${email}. Open it, then come back and sign in. Look in Spam if it has not arrived in two minutes.`;
    body.innerHTML = `<div class="toolbar"><button class="btn" type="button" id="gate-resend">Send it again</button><button class="btn link" type="button" id="gate-back">Back to sign in</button></div>`;
    $("#gate-back").onclick = () => gateMode("in");
    $("#gate-resend").onclick = async () => { const b = $("#gate-resend"); busy(b, true); const { error } = await SB().auth.resend({ type: "signup", email, options: { emailRedirectTo: redirectTo() } }); busy(b, false, "Send it again"); note.textContent = error ? authErr(error) : "Sent again."; };
    return;
  }
  if (mode === "recover") {
    $("#gate-seg").hidden = true;
    title.textContent = "Choose a new password"; msg.textContent = `For ${d.email || "your account"}. At least 8 characters.`;
    body.innerHTML = `<form id="gate-form" novalidate>${pwField("np-pass", "New password", "new-password")}${pwField("np-pass2", "Confirm new password", "new-password")}<button class="btn primary" type="submit" id="gate-go">Save password</button></form>`;
    wireGateBody(body);
    $("#gate-form").onsubmit = async e => {
      e.preventDefault(); const p1 = $("#np-pass").value, p2 = $("#np-pass2").value;
      if (p1.length < 8) return note.textContent = "Use at least 8 characters.";
      if (p1 !== p2) return note.textContent = "The two passwords do not match.";
      const b = $("#gate-go"); busy(b, true);
      const { error } = await SB().auth.updateUser({ password: p1 });
      busy(b, false, "Save password");
      if (error) return note.textContent = authErr(error);
      S.recovering = false; toast("Password saved", "ok");
      const { data: { session } } = await SB().auth.getSession(); if (session) enter(session);
    };
    return;
  }
  // default: sign in
  title.textContent = "Welcome back"; msg.textContent = "One account for every Future Ready company.";
  body.innerHTML = `<form id="gate-form" novalidate>
    <div class="field"><label for="si-email">Email</label><input id="si-email" type="email" autocomplete="username" required placeholder="you@example.com"></div>
    ${pwField("si-pass", "Password", "current-password")}
    <div class="row"><button class="btn link" type="button" id="gate-forgot">Forgot password?</button></div>
    <button class="btn primary" type="submit" id="gate-go">Sign in</button>
    </form>${googleBtn()}`;
  wireGateBody(body);
  $("#gate-forgot").onclick = () => gateMode("forgot");
  $("#gate-form").onsubmit = async e => {
    e.preventDefault(); const email = $("#si-email").value.trim().toLowerCase(), password = $("#si-pass").value;
    if (!email || !password) return note.textContent = "Enter your email and password.";
    note.textContent = ""; const b = $("#gate-go"); busy(b, true);
    const { error } = await SB().auth.signInWithPassword({ email, password });
    if (error) { busy(b, false, "Sign in"); note.textContent = authErr(error); return; }
    // SIGNED_IN event → enter()
  };
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
const hasPassword = () => !!(S.session?.user?.identities || []).some(i => i.provider === "email");
function googleProfile(session) {
  const u = session?.user?.user_metadata || {};
  const name = u.full_name || u.name || "";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return { name, avatar: u.avatar_url || u.picture || "", first: u.given_name || parts[0] || "", surname: u.family_name || (parts.length > 1 ? parts[parts.length - 1] : ""), other: parts.length > 2 ? parts.slice(1, -1).join(" ") : "" };
}
function gateState(state, d = {}) {
  const card = $("#gate-card"), title = $("#gate-title"), msg = $("#gate-msg"), body = $("#gate-body"), note = parkNote();
  card.classList.toggle("wide", state === "signup");
  $("#gate").hidden = false; note.textContent = ""; $("#gate-seg").hidden = true; gateShow.start();
  const signout = `<button class="btn small" id="gate-out">Sign out</button>`;
  if (state === "invited") { gateMode("in"); $("#gate-seg").hidden = false; title.textContent = "You have been invited"; msg.textContent = "Sign in, or create an account, with the email address that received the invitation. Your access is ready; you will only be asked for your details."; return; }
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
  $("#foot-sheet").href = CFG.sheetUrl || "#"; initSide();
  $$("#gate-seg button").forEach(b => b.onclick = () => gateMode(b.dataset.mode));
  gateMode("in");
  S.recovering = /type=recovery/.test(location.hash);
  if (!CFG.supabaseUrl || !CFG.supabaseKey || !window.supabase) { showGate("This copy is not configured.", "config.js must set supabaseUrl and supabaseKey."); setSync(false, "not configured"); return; }
  FR.SB = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
  const inv = new URLSearchParams(location.search).get("invite");
  if (inv) { safeSet("fr_invite", inv); try { history.replaceState(null, "", location.pathname + location.hash); } catch {} }
  if (inv || safeGet("fr_invite")) gateState("invited");
  SB().auth.onAuthStateChange((ev, sess) => {
    if (ev === "SIGNED_OUT") location.reload();
    else if (ev === "PASSWORD_RECOVERY" && sess) { S.recovering = true; try { history.replaceState(null, "", location.pathname); } catch {} gateMode("recover", { email: sess.user?.email }); showGate(); }
    else if (ev === "SIGNED_IN" && sess && !S.me && !S.entering && !S.recovering) enter(sess);
  });
  const { data: { session } } = await SB().auth.getSession();
  if (S.recovering && session) { gateMode("recover", { email: session.user?.email }); showGate(); setSync(false, "signed out"); return; }
  if (!session) { showGate(); setSync(false, "signed out"); FR.paintRole(); return; }
  await enter(session);
}
async function enter(session) {
  if (S.me || S.entering) return; S.entering = true; S.session = session;
  parkNote(); showGate("Checking your access…", ""); $("#gate-title").textContent = "One moment"; $("#gate-body").innerHTML = ""; $("#gate-seg").hidden = true;
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
  FR.statusStart?.();   // Live / Degraded / Offline and backup health
  FR.outboxStart?.();   // changes left on this device from an earlier session are sent now
  for (const m of Object.values(FR.modules)) m.start?.();
  loadMembers(); if (isGroupAdmin()) { loadDeleted(); FR.loadConflicts?.(); }
  FR.subscribe("companies", async () => { const { data } = await SB().from("companies").select("*").order("order"); if (data) { S.companies = data; buildNav(); if (S.view === "team") FR.render(); } });
  setView(r.view && viewDef(r.view) ? r.view : "home", { param: r.param });
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
function paintTeamBadge() { FR.attentionChanged?.(); const c = $("#cnt-team"); if (!c) return; const n = pendingForMe().length; c.textContent = n; c.hidden = !n; }

/* ---------- profile ---------- */
function openProfile(first) {
  const m = S.me; if (!m) return;
  const p = m.profile || {}, g = m.g || {};
  const v = { surname: p.surname || g.surname || "", first_name: p.first_name || g.first || "", other_names: p.other_names || g.other || "", phone: p.phone || "", position: p.position || "", photo_url: p.photo_url || g.avatar || "" };
  const modal = $("#pf-modal"); $("#pf-scrim").hidden = false;
  const initials = ((v.first_name[0] || "") + (v.surname[0] || "")).toUpperCase() || "?";
  modal.innerHTML = `<h2 id="pf-title">${first ? "Complete your profile" : "Your profile"} <small class="muted" style="font-family:var(--body);font-weight:400;font-size:12px">${esc(m.email)}</small></h2>
    ${first ? `<p class="muted" style="margin:0 0 12px">Colleagues see this on the Team page and next to the records you change. Anything we already know is filled in; correct what is wrong.</p>` : ""}
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
    <div class="toolbar" style="justify-content:flex-end;margin-top:12px">${first ? "" : `<button class="btn" id="pf-cancel">Cancel</button>`}<button class="btn primary" id="pf-save">${first ? "Save and continue" : "Save"}</button></div>
    ${first ? "" : `<details class="pf-pass"><summary>${hasPassword() ? "Change password" : "Set a password"}</summary>
      <p class="hint">${hasPassword() ? "You will stay signed in here; other devices will need the new password." : "Lets you sign in with your email and a password as well as with Google."}</p>
      <div class="fields">${pwField("pf-pass", "New password", "new-password")}${pwField("pf-pass2", "Confirm new password", "new-password")}</div>
      <p class="hint" id="pf-pass-err" style="color:var(--bad)"></p>
      <div class="toolbar" style="justify-content:flex-end"><button class="btn" id="pf-pass-save">Save password</button></div></details>`}`;
  wireGateBody(modal);
  $("#pf-pass-save")?.addEventListener("click", async () => {
    const p1 = $("#pf-pass").value, p2 = $("#pf-pass2").value, err = $("#pf-pass-err");
    if (p1.length < 8) return err.textContent = "Use at least 8 characters.";
    if (p1 !== p2) return err.textContent = "The two passwords do not match.";
    err.textContent = ""; const b = $("#pf-pass-save"); busy(b, true);
    const { error } = await SB().auth.updateUser({ password: p1 });
    busy(b, false, "Save password");
    if (error) return err.textContent = authErr(error);
    $("#pf-pass").value = $("#pf-pass2").value = ""; toast("Password saved", "ok");
  });
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
/* ---------- Recently deleted (Group Admins) ---------- */
const ENTITY_LABEL = { roles: "Hiring role", candidates: "Candidate", issues: "Data issue", staff: "Staff record", staff_documents: "Staff document", leave_requests: "Leave request",
  press_customers: "Press customer", press_rate_items: "Rate card item", press_jobs: "Press job", press_payments: "Payment", press_materials: "Material", press_files: "Job file", customer_requests: "Customer request" };
const DEL = { open: [], history: [], showHistory: false };
async function loadDeleted() {
  if (!isGroupAdmin()) return;
  const [{ data: open }, { data: hist }] = await Promise.all([
    SB().from("deletions").select("*").is("restored_at", null).is("purged_at", null).order("deleted_at", { ascending: false }).limit(300),
    SB().from("deletions").select("*").or("restored_at.not.is.null,purged_at.not.is.null").order("deleted_at", { ascending: false }).limit(50),
  ]);
  DEL.open = open || []; DEL.history = hist || [];
  paintDeletedBadge();
  if (S.view === "deleted") FR.renderDeleted();
  if (!loadDeleted.sub) loadDeleted.sub = FR.subscribe("deletions", loadDeleted);
}
const who = e => { const m = e && S.members[String(e).toLowerCase()]; return m ? memberName(m) : (e || "?"); };
const childText = ch => Object.entries(ch || {}).map(([k, n]) => `${n} ${(ENTITY_LABEL[k] || k).toLowerCase()}${n === 1 ? "" : "s"}`).join(", ");
FR.renderDeleted = function renderDeleted() {
  const el = $("#v-deleted"); if (!el) return;
  if (!isGroupAdmin()) { el.innerHTML = `<p class="muted">Only Group Admins can see deleted records.</p>`; return; }
  const row = (d, live) => `<div class="member del-row" data-id="${d.id}">
      <div class="avatar" title="${esc(ENTITY_LABEL[d.entity] || d.entity)}">${esc((ENTITY_LABEL[d.entity] || "?").slice(0, 1))}</div>
      <div style="min-width:0"><b>${esc(d.label || "(no name)")}</b><small>${esc(ENTITY_LABEL[d.entity] || d.entity)}${d.company_id ? " · " + esc(FR.companyShort(d.company_id) || d.company_id) : ""}${Object.keys(d.children || {}).length ? " · with " + esc(childText(d.children)) : ""}</small>
        <small>Deleted by ${esc(who(d.deleted_by))} · ${when(d.deleted_at)}${d.restored_at ? ` · restored by ${esc(who(d.restored_by))} ${when(d.restored_at)}` : ""}${d.purged_at ? ` · removed for good by ${esc(who(d.purged_by))} ${when(d.purged_at)}` : ""}</small></div>
      ${live ? `<div class="acts"><button class="btn small primary" data-restore="${d.id}">Restore</button><button class="btn small danger" data-purge="${d.id}">Delete permanently</button></div>` : ""}
      <div class="del-confirm" id="pc-${d.id}" style="grid-column:1/-1"></div></div>`;
  el.innerHTML = `<div class="card"><h2>Deleted records <small>${DEL.open.length} waiting · nothing is removed automatically</small></h2>
      ${DEL.open.length ? `<div class="team-list">${DEL.open.map(d => row(d, true)).join("")}</div>` : `<p class="muted">Nothing deleted. When someone deletes a record anywhere in the system it appears here, with everything deleted along with it.</p>`}</div>
    <div class="card"><h2>Restored and removed <button class="btn small" id="del-hist">${DEL.showHistory ? "Hide" : "Show"} the last ${DEL.history.length}</button></h2>
      ${DEL.showHistory ? (DEL.history.length ? `<div class="team-list">${DEL.history.map(d => row(d, false)).join("")}</div>` : `<p class="muted">None yet.</p>`) : ""}</div>`;
  $("#del-hist").onclick = () => { DEL.showHistory = !DEL.showHistory; FR.renderDeleted(); };
  el.querySelectorAll("[data-restore]").forEach(b => b.onclick = async () => {
    const d = DEL.open.find(x => x.id === b.dataset.restore); b.disabled = true; b.textContent = "Restoring…";
    const { error } = await SB().rpc("restore_deleted", { p_batch: d.id });
    if (error) { b.disabled = false; b.textContent = "Restore"; toast(error.message, "bad"); return; }
    toast(`${d.label} restored${Object.keys(d.children || {}).length ? " with " + childText(d.children) : ""}`, "ok"); logAct("ok", `Restored: ${d.label}`, ENTITY_LABEL[d.entity] || d.entity); loadDeleted();
  });
  el.querySelectorAll("[data-purge]").forEach(b => b.onclick = () => {
    const d = DEL.open.find(x => x.id === b.dataset.purge); const box = $("#pc-" + d.id);
    box.innerHTML = `<div class="confirm"><b>Delete permanently? This cannot be undone.</b><span>Type <b>${esc(d.label)}</b> to confirm. Stored files are not removed by this.</span>
      <input id="pt-${d.id}" autocomplete="off" style="padding:8px 10px;border:1px solid var(--line-2);border-radius:8px"><div class="toolbar"><button class="btn small danger" id="py-${d.id}" disabled>Delete permanently</button><button class="btn small" id="pn-${d.id}">Keep</button></div></div>`;
    const inp = $("#pt-" + d.id), yes = $("#py-" + d.id);
    inp.oninput = () => { yes.disabled = inp.value.trim().toLowerCase() !== d.label.trim().toLowerCase(); }; inp.focus();
    $("#pn-" + d.id).onclick = () => { box.innerHTML = ""; };
    yes.onclick = async () => { yes.disabled = true; const { error } = await SB().rpc("purge_deleted", { p_batch: d.id, p_confirm: inp.value });
      if (error) { yes.disabled = false; toast(error.message, "bad"); return; } toast(`${d.label} removed for good`, "warn"); logAct("warn", `Removed for good: ${d.label}`, ENTITY_LABEL[d.entity] || d.entity); loadDeleted(); };
  });
};

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
          <div class="field wide"><label>Email address</label><input id="iv-email" type="email" placeholder="name@example.com" autocomplete="off"></div>
          <div class="field"><label>Name <span class="muted">(optional)</span></label><input id="iv-name" placeholder="Used in the email greeting"></div>
          <div class="field"><label>Company</label><select id="iv-company">${manageable.map(c => `<option value="${esc(c.id)}" ${c.id === cid ? "selected" : ""}>${esc(c.name)}</option>`).join("")}${ga ? `<option value="__group">Whole group (Group Admin)</option>` : ""}</select></div>
          <div class="field wide"><label>Role</label><select id="iv-role">${roleOpts("viewer", false)}</select><p class="hint" id="iv-help">${ROLE_HELP.viewer}</p></div>
        </div>
        <p class="hint" id="iv-err" style="color:var(--bad)"></p>
        <div class="toolbar" style="justify-content:flex-end;margin-top:8px"><button class="btn primary" id="iv-send">Send invitation</button></div></div>
      <div class="card"><h2>Access requests <small>${pending.length ? pending.length + " waiting" : "none waiting"}</small></h2>
        <div class="team-list">${pending.map(m => { const k = esc(m.email).replace(/[^a-z0-9]/gi, "_"); const rc = m.requested_company && manageable.some(c => c.id === m.requested_company) ? m.requested_company : (manageable[0] || {}).id; return `<div class="member">${avatarHtml(m)}<div style="min-width:0"><b>${esc(memberName(m))}</b><small>${esc(m.email)} · asked for ${ROLE_LABEL[m.requested_role] || "Viewer"}${m.requested_company ? " in " + esc(FR.companyName(m.requested_company)) : ""} · ${when(m.added_at)}</small></div>
          <div class="acts"><select id="apc-${k}" aria-label="Company">${manageable.map(c => `<option value="${esc(c.id)}" ${c.id === rc ? "selected" : ""}>${esc(c.short_name)}</option>`).join("")}${ga ? `<option value="__group">Group Admin</option>` : ""}</select><select id="apr-${k}" aria-label="Role">${roleOpts(m.requested_role || "viewer", false)}</select><button class="btn small primary" data-approve="${esc(m.email)}">Approve</button><button class="btn small danger" data-remove="${esc(m.email)}">Decline</button></div></div>`; }).join("") || `<p class="muted">When someone creates an account without an invitation, their request appears here.</p>`}</div></div>
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
