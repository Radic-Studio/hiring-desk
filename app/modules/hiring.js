/* Future Ready Group System — Hiring module.
   Carried over from the original single-file hiring desk. Works on the active company's roles, candidates and issues
   (S.roles / S.cands / S.issues are the company-scoped views of S.all, set by scope()). Shared helpers come from FR (core.js). */
(() => {
const FR = window.FR, S = FR.S, CFG = FR.CFG;
const { $, esc, toast, logAct, fmtDate, notice, setSync, setCount, write, resolveNames, callFunction } = FR;
const paintRole = (...a) => FR.paintRole(...a), setView = (...a) => FR.setView(...a);
const SHEET_URL = CFG.sheetUrl || "#";
const FORM_URL = CFG.formUrl || "";
const LOCS = ["Close to office", "Within Enugu", "Outside Enugu Town", "Other state", "Unknown"];
const AVAIL = ["Immediately", "In one week", "Within a month", "Not available"];
const QUALS = ["MBA/MSc", "BSc", "B.Tech", "B.A.", "HND", "Degree", "OND", "Diploma", "SSCE", "Unknown"];
const STATES = ["Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno","Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","FCT (Abuja)","Gombe","Imo","Jigawa","Kaduna","Kano","Katsina","Kebbi","Kogi","Kwara","Lagos","Nasarawa","Niger","Ogun","Ondo","Osun","Oyo","Plateau","Rivers","Sokoto","Taraba","Yobe","Zamfara"];
const DEFAULT_SETTINGS = {
  location: { "Close to office": 40, "Within Enugu": 30, "Outside Enugu Town": 15, "Other state": 5, "Unknown": 10 },
  qualification: { "MBA/MSc": 25, "BSc": 20, "B.Tech": 20, "B.A.": 20, "HND": 20, "Degree": 15, "OND": 10, "Diploma": 10, "SSCE": 5, "Unknown": 0 },
  availability: { "Immediately": 25, "In one week": 15, "Within a month": 8, "Not available": 0 },
  relocation: 10
};
S.settings = S.settings || DEFAULT_SETTINGS;
// Fallback role definitions for the two original roles, used until roles/* documents load.
const LEGACY_ROLES = { bd: { name: "Business Developer", qualWeight: 1, top: 10, second: 20 }, gd: { name: "Graphic Designer", qualWeight: 0.5, top: 10, second: 25 } };
const waNumber = p => { const d = String(p || "").replace(/\D/g, ""); return d.startsWith("0") ? "234" + d.slice(1) : d; };
const waHref = c => { const first = (c.name || "").split(" ")[0], rl = roleOf(c.role); return c.phone ? `https://wa.me/${waNumber(c.phone)}?text=${encodeURIComponent(`Good day ${first}, this is Future Ready Nigeria Ltd regarding your Jobberman application for the ${rl.name} role. Please take two minutes to answer a few questions so we can move your application forward: ${FORM_URL}\n\nIf you prefer, reply here with how soon you could resume and where you currently live. Our office is at Udeorji Street, Obiagu, Enugu.`)}` : ""; };
const ro = () => S.canWrite === false;
const roleOf = id => S.roles[id] || S.all.roles[id] || LEGACY_ROLES[id] || { name: id, qualWeight: 1, top: 10, second: 20 };
const roleName = id => roleOf(id).name;
const allRoleIds = () => Object.keys(S.roles).sort((a, b) => (roleOf(a).order ?? 99) - (roleOf(b).order ?? 99) || roleName(a).localeCompare(roleName(b)));
const roleIds = () => allRoleIds().filter(r => roleOf(r).status !== "closed");
const byRole = r => Object.values(S.cands).filter(c => c.role === r);

/* ---------- normalisation (same rules used to build the original register) ---------- */
function normQual(q) {
  q = String(q || "").trim(); if (!q) return "Unknown"; const u = q.toUpperCase();
  if (/^(MBA|MSC|M\.SC|MASTER)/.test(u)) return "MBA/MSc"; if (/^B\.?SC/.test(u)) return "BSc"; if (/^B\.?TECH/.test(u)) return "B.Tech"; if (/^B\.?A\b|^BA\b/.test(u)) return "B.A.";
  if (/^HND/.test(u)) return "HND"; if (/^OND|^ND\b/.test(u)) return "OND"; if (/^DIPLOMA/.test(u)) return "Diploma"; if (/^SSCE|^WAEC|^NECO|^O.?LEVEL/.test(u)) return "SSCE"; if (/DEGREE|^B\.?ENG|^LLB|^B\.?ED/.test(u)) return "Degree"; return "Unknown";
}
const STATE_MAP = [["jos","Plateau"],["plateau","Plateau"],["lagos","Lagos"],["ikeja","Lagos"],["surulere","Lagos"],["lekki","Lagos"],["ikorodu","Lagos"],["ekiti","Ekiti"],["ogun","Ogun"],["abeokuta","Ogun"],["edo","Edo"],["benin","Edo"],["port harcourt","Rivers"],["rivers","Rivers"],["warri","Delta"],["asaba","Delta"],["delta","Delta"],["abuja","FCT (Abuja)"],["fct","FCT (Abuja)"],["anambra","Anambra"],["awka","Anambra"],["onitsha","Anambra"],["nnewi","Anambra"],["ibadan","Oyo"],["oyo","Oyo"],["imo","Imo"],["owerri","Imo"],["akure","Ondo"],["ondo","Ondo"],["abia","Abia"],["aba","Abia"],["umuahia","Abia"],["ebonyi","Ebonyi"],["abakaliki","Ebonyi"],["kaduna","Kaduna"],["kano","Kano"],["uyo","Akwa Ibom"],["akwa ibom","Akwa Ibom"],["calabar","Cross River"],["cross river","Cross River"],["benue","Benue"],["makurdi","Benue"],["nsukka","Enugu"],["enugu","Enugu"]];
const CLOSE = ["ogui road", "okpara avenue", "obiagu", "ogui", "asata", "uwani", "new haven", "coal camp", "zik avenue"];
const IN_TOWN = ["achara layout", "trans-ekulu", "trans ekulu", "independence layout", "enugu south", "enugu north", "enugu east", "abakpa", "thinkers corner", "gra", "emene", "nike lake", "maryland", "agbani road", "ugwuaji", "golf estate", "new layout"];
function classify(addr) {
  if (!addr) return ["Unknown", ""]; const a = String(addr).toLowerCase(); let state = "";
  for (const [k, s] of STATE_MAP) if (a.includes(k)) { state = s; break; }
  if (state && state !== "Enugu") return ["Other state", state];
  if (CLOSE.some(k => a.includes(k))) return ["Close to office", "Enugu"];
  if (IN_TOWN.some(k => a.includes(k))) return ["Within Enugu", "Enugu"];
  if (a.trim() === "enugu" || /^enugu[\s,.]*(nigeria)?[\s.]*$/.test(a.trim())) return ["Within Enugu", "Enugu"];
  if (a.includes("enugu")) return ["Unknown", "Enugu"];
  return ["Unknown", state];
}

/* ---------- scoring ---------- */
function compute() {
  const st = S.settings, out = {}; const list = Object.values(S.cands);
  for (const c of list) {
    const r = roleOf(c.role);
    const locPts = st.location[c.location] ?? 0;
    const qualPts = (st.qualification[c.qualification] ?? 0) * (r.qualWeight ?? 1);
    const pre = locPts + qualPts + (Number(c.adjust) || 0);
    const availPts = c.status === "contacted" ? (st.availability[c.availability] ?? 0) : 0;
    const reloPts = c.relocation === "Yes" ? st.relocation : 0;
    let eligible;
    if (c.manual === "Yes") eligible = true; else if (c.manual === "No") eligible = false;
    else eligible = c.status === "contacted" && ["Immediately", "In one week", "Within a month"].includes(c.availability) && (["Close to office", "Within Enugu"].includes(c.location) || c.relocation === "Yes");
    out[c.id] = { locPts, qualPts, pre, availPts, reloPts, eligible, final: pre + availPts + reloPts };
  }
  for (const rid of allRoleIds()) {
    const r = roleOf(rid);
    byRole(rid).sort((a, b) => out[b.id].pre - out[a.id].pre || a.sn - b.sn).forEach((c, i) => { const o = out[c.id]; o.rank = i + 1; o.tier = o.rank <= (r.top ?? 10) ? "Top 10" : o.rank <= (r.second ?? 20) ? "Second Tier" : "Others"; });
  }
  const order = allRoleIds();
  list.filter(c => out[c.id].eligible).sort((a, b) => out[b.id].final - out[a.id].final || order.indexOf(a.role) - order.indexOf(b.role) || a.sn - b.sn).forEach((c, i) => { out[c.id].combined = i + 1; });
  for (const c of list) {
    const o = out[c.id]; const crit = [];
    if (["Close to office", "Within Enugu"].includes(c.location)) crit.push(c.location); else if (c.relocation === "Yes") crit.push("Will relocate from " + (c.state || "another state"));
    if (c.availability) crit.push(c.availability);
    if (c.qualification && c.qualification !== "Unknown") crit.push(c.qualification);
    if (c.manual === "Yes") crit.push("Manually shortlisted");
    o.criteria = crit;
  }
  return out;
}

function render() {
  if (!S.me) return;
  const comp = compute();
  setCount("candidates", Object.keys(S.cands).length);
  setCount("interview", Object.values(comp).filter(o => o.eligible).length);
  setCount("issues", Object.values(S.issues).filter(i => !i.resolved).length);
  setCount("history", allRoleIds().filter(r => roleOf(r).status === "closed").length);
  $("#foot-stamp").textContent = S.loaded ? `${Object.keys(S.cands).length} candidate${Object.keys(S.cands).length === 1 ? "" : "s"} ·${roleIds().length} role${roleIds().length === 1 ? "" : "s"}` : "";
  if (S.module !== "hiring") return;
  if (S.view === "dashboard") renderDashboard(comp);
  if (S.view === "candidates") renderCandidates(comp);
  if (S.view === "interview") renderInterview(comp);
  if (S.view === "issues") renderIssues();
  if (S.view === "import") renderImport();
  if (S.view === "history") renderHistory(comp);
}
function pillStatus(c) {
  if (c.status === "contacted") return `<span class="pill ok">Contacted</span>${c.selfReported ? ` <span class="pill info flat" title="Answered the follow-up form; details not yet confirmed by a person">Self-reported</span>` : ""}`;
  if (c.status === "awaiting" || (c.lastEmailStatus === "sent" && c.status !== "attempted")) return `<span class="pill accent" title="Outreach email sent ${esc(fmtDate(c.emailedAt))}; updates automatically when they answer the form">Awaiting reply</span>`;
  if (c.status === "attempted") return `<span class="pill warn">No answer ×${c.attempts || 1}</span>`;
  return `<span class="pill">Not contacted</span>`;
}
function pillLoc(l) { const k = { "Close to office": "ok", "Within Enugu": "accent", "Outside Enugu Town": "warn", "Other state": "bad", "Unknown": "" }[l] ?? ""; return `<span class="pill ${k} flat">${esc(l || "Unknown")}</span>`; }
function pillAvail(a) { if (!a) return `<span class="muted">—</span>`; const k = a === "Immediately" ? "ok" : a === "Not available" ? "bad" : "warn"; return `<span class="pill ${k} flat">${esc(a)}</span>`; }
function pillTier(t) { const k = t === "Top 10" ? "ok" : t === "Second Tier" ? "warn" : ""; return `<span class="pill ${k} flat">${esc(t)}</span>`; }
function pillRole(rid) { const i = roleIds().indexOf(rid); return `<span class="pill ${["info", "accent", "ok", "warn"][i % 4]} flat">${esc(roleName(rid))}</span>`; }
const effStatus = c => c.status === "contacted" || c.status === "attempted" ? c.status : (c.status === "awaiting" || c.lastEmailStatus === "sent") ? "awaiting" : "pending";
const flagged = id => Object.values(S.issues).some(i => i.candidateId === id && !i.resolved);

/* ---- candidates ---- */
function renderCandidates(comp) {
  const el = $("#v-candidates"); const f = S.filters;
  const ids = roleIds(); const viewingClosed = S.role && roleOf(S.role).status === "closed"; if (!S.role || (!ids.includes(S.role) && !viewingClosed)) S.role = ids[0] || null;
  if (!el.dataset.built) {
    el.dataset.built = "1";
    el.innerHTML = `<div class="chips" id="chips"></div>
      <div class="toolbar">
      <input type="search" id="q" placeholder="Search name, phone, email, address" aria-label="Search">
      <select id="fs" aria-label="Status"><option value="">All statuses</option><option value="pending">Not contacted</option><option value="awaiting">Awaiting reply</option><option value="attempted">No answer</option><option value="contacted">Contacted</option></select>
      <select id="fa" aria-label="Availability"><option value="">Any availability</option>${AVAIL.map(a => `<option>${a}</option>`).join("")}</select>
      <select id="fl" aria-label="Location"><option value="">All locations</option>${LOCS.map(l => `<option>${l}</option>`).join("")}</select>
      <select id="ft" aria-label="Tier"><option value="">All tiers</option><option>Top 10</option><option>Second Tier</option><option>Others</option></select>
      <button class="btn small" id="clear">Clear</button><span class="muted" id="n"></span><span style="margin-left:auto;display:inline-flex;gap:8px"><button class="btn small" id="dl-list" hidden>Download this list</button><button class="btn small primary" id="add-cand" hidden>+ Add candidate</button></span></div>
      <div id="selbar" hidden></div>
      <div class="table-wrap"><table><thead><tr><th class="sel"><input type="checkbox" id="sel-all" aria-label="Select all shown"></th><th>#</th><th>Candidate</th><th>Location</th><th>Qualification</th><th>Status</th><th>Availability</th><th>Score</th><th>Tier</th><th></th></tr></thead><tbody id="tb"></tbody></table></div>
      <div class="cards" id="cd"></div>`;
    $("#sel-all").addEventListener("change", e => { const ids = [...$("#tb").querySelectorAll("input[data-sel]")].map(x => x.dataset.sel); for (const id of ids) { if (e.target.checked) S.sel.add(id); else S.sel.delete(id); } renderCandidates(compute()); });
    el.addEventListener("change", e => { const cb = e.target.closest("input[data-sel]"); if (!cb) return; if (cb.checked) S.sel.add(cb.dataset.sel); else S.sel.delete(cb.dataset.sel); renderSelbar(); });
    el.addEventListener("click", e => { if (e.target.closest("#sel-clear")) { S.sel.clear(); renderCandidates(compute()); } if (e.target.closest("#sel-email")) openEmail([...S.sel]); });
    $("#q").addEventListener("input", e => { f.q = e.target.value.toLowerCase(); renderCandidates(compute()); });
    for (const [id, k] of [["fs", "status"], ["fa", "avail"], ["fl", "loc"], ["ft", "tier"]]) $("#" + id).addEventListener("change", e => { f[k] = e.target.value; renderCandidates(compute()); });
    $("#clear").addEventListener("click", () => { S.filters = { q: "", status: "", loc: "", tier: "", avail: "" }; renderCandidates(compute()); });
    $("#add-cand").addEventListener("click", () => openAddDrawer(S.role));
    $("#dl-list").addEventListener("click", () => openDownload(filterLabel(S.filters) ? { kind: "filtered" } : { kind: "role", role: S.role }));
    $("#chips").addEventListener("click", e => { const m = e.target.closest("[data-rolemenu]"); if (m) { openRoleMenu(m.dataset.rolemenu); return; } const c = e.target.closest("[data-role]"); if (c) { S.role = c.dataset.role; S.sel.clear(); renderCandidates(compute()); } const a = e.target.closest("[data-go]"); if (a) setView("import"); });
    el.addEventListener("click", e => { if (e.target.closest("[data-wa]")) return; const r = e.target.closest("[data-id]"); if (r) openDrawer(r.dataset.id); });
  }
  $("#q").value = f.q; $("#fs").value = f.status; $("#fa").value = f.avail; $("#fl").value = f.loc; $("#ft").value = f.tier;
  $("#add-cand").hidden = true; FR.paintPrimary?.();
  $("#dl-list").hidden = !DL || !S.role || !S.loaded;
  $("#chips").innerHTML = (viewingClosed ? `<span class="pill warn flat">Viewing ended role: ${esc(roleName(S.role))}</span>` : "") + ids.map(r => `<button class="chip" data-role="${esc(r)}" aria-pressed="${r === S.role}">${esc(roleName(r))}<span class="cnt">${byRole(r).length}</span></button>`).join("") + (ro() ? "" : `<button class="chip add" data-go="import">+ Import a role</button>`) + (ro() || !S.role ? "" : `<button class="chip" data-rolemenu="${esc(S.role)}" style="margin-left:auto">Role settings</button>`);
  const all = S.role ? byRole(S.role) : [];
  const rows = all.filter(c => {
    const o = comp[c.id];
    if (f.status && effStatus(c) !== f.status) return false;
    if (f.avail && (c.availability || "") !== f.avail) return false;
    if (f.loc && (c.location || "Unknown") !== f.loc) return false;
    if (f.tier && o.tier !== f.tier) return false;
    if (f.q && !(c.name + " " + c.phone + " " + c.email + " " + c.address).toLowerCase().includes(f.q)) return false;
    return true;
  }).sort((a, b) => comp[a.id].rank - comp[b.id].rank);
  $("#n").textContent = `${rows.length} of ${all.length}`;
  const maxPre = Math.max(1, ...all.map(c => comp[c.id].pre)); const top = roleOf(S.role).top ?? 10;
  if (!S.loaded) { $("#tb").innerHTML = `<tr><td colspan="10"><div class="skeleton"></div></td></tr>`.repeat(5); $("#cd").innerHTML = ""; return; }
  if (!ids.length) { $("#tb").innerHTML = `<tr><td colspan="10" class="muted">No roles yet. Import a Jobberman export to begin.</td></tr>`; $("#cd").innerHTML = ""; return; }
  $("#tb").innerHTML = rows.map(c => { const o = comp[c.id]; return `<tr data-id="${c.id}" class="${effStatus(c)}">
    <td class="sel" onclick="event.stopPropagation()"><input type="checkbox" data-sel="${c.id}" ${S.sel.has(c.id) ? "checked" : ""} ${ro() ? "disabled" : ""} aria-label="Select ${esc(c.name)}"></td>
    <td><span class="rank ${o.rank <= top ? "top" : ""}">${o.rank}</span></td>
    <td class="name"><button type="button" class="rowlink" data-id="${c.id}">${esc(c.name)}</button>${flagged(c.id) ? ` <span class="pill bad flat" title="See Issues">!</span>` : ""}${c.emailedAt ? ` <span class="pill ${c.lastEmailStatus === "sent" ? "accent" : c.lastEmailStatus === "unknown" ? "warn" : "bad"} flat" title="${esc(c.lastEmailStatus === "sent" ? "Outreach email sent " + fmtDate(c.emailedAt) : c.lastEmailStatus === "unknown" ? "Send outcome unknown; check your Sent folder" : "Last send failed")}">${c.lastEmailStatus === "sent" ? "Emailed" : c.lastEmailStatus === "unknown" ? "Email?" : "Email failed"}</span>` : ""}<span class="sub">${esc(c.address || "No address in register")}</span></td>
    <td>${pillLoc(c.location)}<span class="sub">${esc(c.state || "")}</span></td>
    <td>${esc(c.qualification)}</td><td>${pillStatus(c)}</td><td>${pillAvail(c.availability)}</td>
    <td><span class="num">${o.pre}</span><div class="bar"><i style="width:${Math.round(o.pre / maxPre * 100)}%"></i></div></td>
    <td>${pillTier(o.tier)}</td><td><span class="row-acts">${c.phone && !ro() ? `<a class="btn small wa-btn" href="${waHref(c)}" target="_blank" rel="noopener" data-wa="${c.id}" aria-label="WhatsApp ${esc(c.name)}">WhatsApp</a>` : ""}<button class="btn small" data-id="${c.id}">${ro() ? "View" : "Log"}</button></span></td></tr>`; }).join("") || `<tr><td colspan="10" class="muted">Nothing matches these filters.</td></tr>`;
  $("#sel-all").checked = rows.length > 0 && rows.every(c => S.sel.has(c.id)); $("#sel-all").disabled = ro();
  renderSelbar();
  $("#cd").innerHTML = rows.map(c => { const o = comp[c.id]; return `<div class="ccard ${c.status || ""}" data-id="${c.id}">
    <div class="row"><b><label onclick="event.stopPropagation()" style="display:inline-flex;gap:8px;align-items:center"><input type="checkbox" data-sel="${c.id}" ${S.sel.has(c.id) ? "checked" : ""} ${ro() ? "disabled" : ""} style="width:16px;height:16px;accent-color:var(--accent)"></label><span class="rank ${o.rank <= top ? "top" : ""}">${o.rank}</span> &nbsp;<button type="button" class="rowlink" data-id="${c.id}">${esc(c.name)}</button></b>${pillStatus(c)}${c.emailedAt ? ` <span class="pill accent flat">Emailed</span>` : ""}</div>
    <div class="row">${pillLoc(c.location)}<span class="muted">${esc(c.qualification)}</span><span class="num">${o.pre} pts</span></div>
    <div class="row"><span class="num muted">${esc(c.phone || "no phone")}</span>${pillTier(o.tier)}</div>${c.phone && !ro() ? `<div class="row"><a class="btn small wa-btn" href="${waHref(c)}" target="_blank" rel="noopener" data-wa="${c.id}">WhatsApp</a><a class="btn small" href="tel:${esc(String(c.phone).replace(/[^\d+]/g, ""))}" data-wa="${c.id}">Call</a></div>` : ""}</div>`; }).join("");
}

/* ---- second interview ---- */
function renderInterview(comp) {
  const el = $("#v-interview");
  const open = new Set(roleIds());
  const list = Object.values(S.cands).filter(c => comp[c.id].eligible && open.has(c.role)).sort((a, b) => comp[a.id].combined - comp[b.id].combined);
  if (!list.length) { el.innerHTML = `<div class="empty"><h2>No one has qualified yet</h2><p>A candidate appears here once a call is logged where they are available and either live in Enugu or will relocate. An editor can also force someone onto the list from their record (Shortlist override → Yes).</p></div>`; return; }
  const hired = list.filter(c => c.interview?.outcome === "Hired").length, invited = list.filter(c => c.interview?.invitedAt).length;
  el.innerHTML = `<div class="toolbar"><span class="muted">${list.length} candidate${list.length === 1 ? "" : "s"}, best first · ${invited} invited · ${hired} hired</span><span style="margin-left:auto;display:inline-flex;gap:8px">${ro() ? "" : `<button class="btn small primary" id="si-invite">Invite to interview</button>`}${DL ? `<button class="btn small" id="dl-si">Download shortlist</button>` : ""}</span></div>
  <div class="hint">"Invite to interview" emails everyone on this list who has not been invited yet, using the interview template (you can edit it before sending). Open a name to record the interview date and outcome.</div>
  <div class="table-wrap"><table><thead><tr><th>Rank</th><th>Candidate</th><th>Role</th><th>Phone</th><th>Location</th><th>Availability</th><th>Final</th><th>Interview</th><th>Why</th></tr></thead><tbody>
  ${list.map(c => { const o = comp[c.id]; return `<tr data-id="${c.id}"><td><span class="rank ${o.combined <= 3 ? "top" : ""}">${o.combined}</span></td>
    <td class="name"><button type="button" class="rowlink" data-id="${c.id}">${esc(c.name)}</button><span class="sub">${esc(c.email)}</span></td><td>${pillRole(c.role)}</td>
    <td class="num">${esc(c.phone)}</td><td>${pillLoc(c.location)}</td><td>${pillAvail(c.availability)}</td><td class="num"><b>${o.final}</b></td>
    <td>${pillInterview(c)}</td>
    <td><div class="crit">${o.criteria.map(x => `<span class="pill flat">${esc(x)}</span>`).join("")}</div></td></tr>`; }).join("")}</tbody></table></div>
  <div class="cards">${list.map(c => { const o = comp[c.id]; return `<div class="ccard" data-id="${c.id}"><div class="row"><b><span class="rank ${o.combined <= 3 ? "top" : ""}">${o.combined}</span> &nbsp;<button type="button" class="rowlink" data-id="${c.id}">${esc(c.name)}</button></b><span class="num">${o.final}</span></div>
    <div class="row">${pillRole(c.role)}${pillAvail(c.availability)}</div><div class="crit">${o.criteria.map(x => `<span class="pill flat">${esc(x)}</span>`).join("")}</div></div>`; }).join("")}</div>`;
  el.onclick = e => { if (e.target.closest("#dl-si")) { openDownload({ kind: "interview" }); return; } if (e.target.closest("#si-invite")) { const ids = list.filter(c => !c.interview?.invitedAt && c.email).map(c => c.id); if (!ids.length) { toast("Everyone on the list has been invited already (or has no email)", "warn"); return; } openEmail(ids, "interview"); return; } const r = e.target.closest("[data-id]"); if (r) openDrawer(r.dataset.id); };
}
function pillInterview(c) { const i = c.interview || {}; const k = { Hired: "ok", Rejected: "bad", "On hold": "warn", Pending: "accent" }[i.outcome] || ""; return i.outcome ? `<span class="pill ${k} flat">${esc(i.outcome)}</span>${i.date ? `<span class="sub">${esc(i.date)}</span>` : ""}` : i.invitedAt ? `<span class="pill accent flat">Invited</span><span class="sub">${esc(fmtDate(i.invitedAt))}</span>` : `<span class="muted">—</span>`; }

/* ---- issues ---- */
function renderIssues() {
  const el = $("#v-issues");
  const list = Object.values(S.issues).sort((a, b) => (a.resolved - b.resolved) || a.name.localeCompare(b.name));
  const open = list.filter(i => !i.resolved).length;
  el.innerHTML = `<div class="banner"><b>${open} open</b><span class="muted">${ro() ? "Only editors can resolve these." : "Fix each one before trusting that candidate's phone, email or location. Type what you did, then tick the box."}</span></div>
  <div class="card">${list.map(i => `<div class="issue ${i.resolved ? "resolved" : ""}" data-iid="${i.id}">
    <input type="checkbox" ${i.resolved ? "checked" : ""} ${ro() ? "disabled" : ""} aria-label="Resolved: ${esc(i.name)}, ${esc(i.issue)}" data-act="resolve">
    <div class="what"><div><button type="button" class="rowlink" data-id="${esc(i.candidateId)}">${esc(i.name)}</button> <span class="muted">· ${esc(i.role)}</span> <span class="pill ${/phone/i.test(i.issue) ? "bad" : /address|qualification/i.test(i.issue) ? "warn" : "info"} flat">${esc(i.issue)}</span></div>
      <div>${esc(i.detail)}</div><div class="muted">Action: ${esc(i.action)}</div>
      ${i.resolved ? `<div class="muted">Resolved${i.resolution ? ": " + esc(i.resolution) : ""}${i.resolvedAt ? " · " + fmtDate(i.resolvedAt) : ""}</div>` : ro() ? "" : `<input type="text" placeholder="What did you do? (saved when you tick the box)" aria-label="What was done for ${esc(i.name)}" value="${esc(i.resolution || "")}" data-act="note">`}
    </div></div>`).join("") || `<div class="muted">No issues recorded.</div>`}</div>`;
  el.onclick = async e => {
    const b = e.target.closest("button[data-id]"); if (b) { openDrawer(b.dataset.id); return; }
    const cb = e.target.closest("input[data-act=resolve]"); if (!cb) return;
    const row = cb.closest("[data-iid]"), i = S.issues[row.dataset.iid]; const note = row.querySelector("input[data-act=note]");
    const body = { ...i, resolved: cb.checked, resolution: note ? note.value.trim() : i.resolution || "", resolvedAt: cb.checked ? new Date().toISOString() : null, resolvedBy: cb.checked ? S.me?.id || null : null };
    delete body.id;
    await write(S.db.doc("issues/" + i.id), body, cb.checked ? "Issue resolved" : "Issue reopened");
  };
}

/* ---- dashboard ---- */
const charts = {};
function chart(id, type, data, opts = {}) {
  const ctx = $("#" + id); if (!ctx || !window.Chart) return;
  const css = getComputedStyle(document.documentElement);
  const fg = css.getPropertyValue("--muted").trim(), line = css.getPropertyValue("--line").trim();
  if (charts[id]) { charts[id].data = data; charts[id].update(); return; }
  Chart.defaults.font.family = css.getPropertyValue("--body"); Chart.defaults.color = fg;
  charts[id] = new Chart(ctx, { type, data, options: { responsive: true, maintainAspectRatio: false, animation: { duration: 700, easing: "easeOutQuart" }, plugins: { legend: { position: "bottom", labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: "circle" } } },
    scales: { x: { stacked: !!opts.stacked, grid: { display: false }, border: { display: false } }, y: { stacked: !!opts.stacked, beginAtZero: true, ticks: { precision: 0 }, grid: { color: line }, border: { display: false } } }, ...opts.extra } });
}
function countUp(el, to) {
  const from = Number(el.dataset.v || 0); el.dataset.v = to; if (from === to || matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = to; return; }
  const t0 = performance.now(), d = 600; const step = t => { const p = Math.min(1, (t - t0) / d), e = 1 - Math.pow(1 - p, 3); el.textContent = Math.round(from + (to - from) * e); if (p < 1) requestAnimationFrame(step); }; requestAnimationFrame(step);
}
function renderDashboard(comp) {
  const el = $("#v-dashboard");
  const all = Object.values(S.cands), n = all.length, ids = roleIds();
  const contacted = all.filter(c => c.status === "contacted").length, attempted = all.filter(c => c.status === "attempted").length, awaiting = all.filter(c => effStatus(c) === "awaiting").length;
  const avail = all.filter(c => c.availability === "Immediately").length, elig = Object.values(comp).filter(o => o.eligible).length;
  const openIssues = Object.values(S.issues).filter(i => !i.resolved).length;
  const today = new Date().toISOString().slice(0, 10);
  const due = all.filter(c => c.nextAction && c.nextAction <= today && c.status !== "contacted").sort((a, b) => a.nextAction.localeCompare(b.nextAction));
  const nextUp = all.filter(c => (c.status || "pending") !== "contacted").sort((a, b) => (a.role === b.role ? comp[a.id].rank - comp[b.id].rank : ids.indexOf(a.role) - ids.indexOf(b.role))).slice(0, 8);
  if (!el.dataset.built) {
    el.dataset.built = "1";
    el.innerHTML = `<div class="banner info" id="demo-note" hidden></div>
    <div class="grid-2">
      <section class="panel" aria-labelledby="nu-h"><div class="panel-head"><h2 id="nu-h">Call next</h2><span class="muted">best-ranked people not yet reached</span></div><ul class="att-list" id="nextup"></ul></section>
      <section class="panel" aria-labelledby="due-h"><div class="panel-head"><h2 id="due-h">Follow-ups due</h2><span class="muted" id="due-n"></span></div><ul class="att-list" id="due"></ul></section>
    </div>
    <div class="tiles" id="tiles"></div>
    <div class="card"><h2>Roles <small>tap one to open its candidates</small></h2><div class="chips" id="role-tiles"></div></div>
    <div class="grid2">
      <div class="card"><h2>Contact progress</h2><div class="chart-box"><canvas id="ch-progress"></canvas></div></div>
      <div class="card"><h2>Where candidates are <small>confirm on the call</small></h2><div class="chart-box"><canvas id="ch-loc"></canvas></div></div>
      <div class="card"><h2>Availability <small>as recorded</small></h2><div class="chart-box"><canvas id="ch-avail"></canvas></div></div>
      <div class="card"><h2>Priority tiers</h2><div class="chart-box"><canvas id="ch-tier"></canvas></div></div>
    </div>
    <div class="card"><details class="settings"><summary>Scoring rules</summary><div id="settings-body"></div></details></div>`;
    el.addEventListener("click", e => {
      if (e.target.closest("[data-wa]")) return;
      const r = e.target.closest("[data-id]"); if (r) { openDrawer(r.dataset.id); return; }
      const t = e.target.closest("[data-tile]"); if (t) { const k = t.dataset.tile;
        if (k === "contacted") setView("candidates", { filters: { status: "contacted" } });
        else if (k === "avail") setView("candidates", { filters: { avail: "Immediately" } });
        else if (k === "interview") setView("interview"); else if (k === "issues") setView("issues"); else setView("candidates", { filters: {} }); return; }
      const ch = e.target.closest("[data-role]"); if (ch) setView("candidates", { role: ch.dataset.role, filters: {} });
    });
  }
  const tiles = [["contacted", "Contacted", contacted, `of ${n} candidates · ${awaiting} awaiting reply · ${attempted} no answer · ${Math.max(0, n - contacted - attempted - awaiting)} untouched`, "hero accent"],
    ["all", "Candidates", n, ids.map(r => `${byRole(r).length} ${roleName(r).toLowerCase()}`).join(" · ") || "none yet", ""],
    ["avail", "Available now", avail, "said Immediately", ""], ["interview", "Second interview", elig, "meet the criteria", "accent"], ["issues", "Open issues", openIssues, "data to fix", ""]];
  if (!$("#tiles").children.length) $("#tiles").innerHTML = tiles.map(([k, l, v, s, cls]) => `<button class="tile ${cls}" data-tile="${k}"><span class="label">${l}</span><span class="value" data-v="0">0</span><span class="sub"></span>${k === "contacted" ? `<div class="progress"><i style="width:0%"></i></div>` : ""}</button>`).join("");
  tiles.forEach(([k, l, v, s]) => { const t = $(`[data-tile="${k}"]`); countUp(t.querySelector(".value"), v); t.querySelector(".sub").textContent = s; const p = t.querySelector(".progress i"); if (p) p.style.width = (n ? Math.round(contacted / n * 100) : 0) + "%"; });
  const demoRoles = ids.filter(r => FR.isDemo(roleName(r)));   // clearly labelled test data for presentations
  const dn = $("#demo-note"); dn.hidden = !demoRoles.length;
  if (demoRoles.length) dn.textContent = `These figures include ${demoRoles.map(r => { const k = byRole(r).length; return `${k} test candidate${k === 1 ? "" : "s"} in "${roleName(r)}"`; }).join(" and ")}. They are DEMO records, not real applicants.`;
  $("#role-tiles").innerHTML = ids.map(r => { const rs = byRole(r), done = rs.filter(c => c.status === "contacted").length; return `<button class="chip" data-role="${esc(r)}">${esc(roleName(r))}<span class="cnt">${done}/${rs.length} contacted</span></button>`; }).join("") || `<span class="muted">No roles yet.</span>`;
  $("#nextup").innerHTML = nextUp.map(c => `<li><span class="rank ${comp[c.id].rank <= (roleOf(c.role).top ?? 10) ? "top" : ""}" aria-label="Rank ${comp[c.id].rank}">${comp[c.id].rank}</span><button type="button" class="att-main" data-id="${c.id}"><b>${esc(c.name)}</b><span>${esc(roleName(c.role))} · ${esc(c.location || "Unknown")}${c.phone ? " · " + esc(c.phone) : ""}</span></button><span class="att-tag">${c.phone && !ro() ? `<a class="btn small wa-btn" href="${waHref(c)}" target="_blank" rel="noopener" data-wa="${c.id}" aria-label="WhatsApp ${esc(c.name)}">WhatsApp</a>` : pillStatus(c)}</span></li>`).join("") || `<li class="empty-inline">${S.loaded ? "Everyone has been contacted." : "Loading…"}</li>`;
  $("#due-n").textContent = due.length ? `${due.length} today or overdue` : "";
  $("#due").innerHTML = due.slice(0, 8).map(c => `<li><span class="lv ${c.nextAction < today ? "bad" : "warn"}" aria-hidden="true"></span><button type="button" class="att-main" data-id="${c.id}"><b>${esc(c.name)}</b><span>${c.nextAction < today ? "was due " : "due "}${esc(FR.fmtDate ? new Date(c.nextAction + "T12:00:00").toLocaleDateString("en-NG", { day: "numeric", month: "short" }) : c.nextAction)}${c.notes ? " · " + esc(c.notes.slice(0, 60)) : ""}</span></button><span class="att-tag">${pillStatus(c)}</span></li>`).join("") || `<li class="empty-inline">Nothing due. Set a next-action date on a candidate you need to call back.</li>`;
  const css = getComputedStyle(document.documentElement), A = css.getPropertyValue("--accent").trim(), I = css.getPropertyValue("--info").trim(), OK = css.getPropertyValue("--ok").trim(), W = css.getPropertyValue("--warn").trim(), B = css.getPropertyValue("--bad").trim(), M = css.getPropertyValue("--line-2").trim();
  const PAL = [I, A, OK, W, "#0e7490", "#be185d"];
  const labels = ids.map(roleName);
  chart("ch-progress", "bar", { labels, datasets: [
    { label: "Contacted", data: ids.map(r => byRole(r).filter(c => c.status === "contacted").length), backgroundColor: OK, borderRadius: 4 },
    { label: "Awaiting reply", data: ids.map(r => byRole(r).filter(c => effStatus(c) === "awaiting").length), backgroundColor: A, borderRadius: 4 },
    { label: "No answer", data: ids.map(r => byRole(r).filter(c => c.status === "attempted").length), backgroundColor: W, borderRadius: 4 },
    { label: "Not yet", data: ids.map(r => byRole(r).filter(c => effStatus(c) === "pending").length), backgroundColor: M, borderRadius: 4 }] }, { stacked: true, extra: { indexAxis: "y" } });
  chart("ch-loc", "bar", { labels: LOCS, datasets: ids.map((r, i) => ({ label: roleName(r), data: LOCS.map(l => byRole(r).filter(c => (c.location || "Unknown") === l).length), backgroundColor: PAL[i % PAL.length], borderRadius: 4 })) });
  const av = AVAIL.map(a => all.filter(c => c.availability === a).length), rec = all.filter(c => !c.availability).length;
  chart("ch-avail", "bar", { labels: ["All candidates"], datasets: [...AVAIL, "Not yet recorded"].map((a, i) => ({ label: a, data: [[...av, rec][i]], backgroundColor: [OK, W, I, B, M][i], borderRadius: 4 })) }, { stacked: true, extra: { indexAxis: "y" } });
  chart("ch-tier", "bar", { labels: ["Top 10", "Second Tier", "Others"], datasets: ids.map((r, i) => ({ label: roleName(r), data: ["Top 10", "Second Tier", "Others"].map(t => byRole(r).filter(c => comp[c.id].tier === t).length), backgroundColor: PAL[i % PAL.length], borderRadius: 4 })) });
  renderSettings();
}
function renderSettings() {
  const st = S.settings, locked = ro() || !S.me?.canEdit, ids = roleIds();
  const tbl = (title, obj, key) => `<div><h3>${title}</h3><table>${Object.entries(obj).map(([k, v]) => `<tr><td>${esc(k)}</td><td><input type="number" step="0.5" value="${v}" data-k="${key}" data-f="${esc(k)}" ${locked ? "disabled" : ""}></td></tr>`).join("")}</table></div>`;
  $("#settings-body").innerHTML = `<p class="muted">Points drive every ranking. ${locked ? "Only an Editor can change them." : "Edit and press Save; rankings recompute for everyone."}</p>
  <div class="pts">${tbl("Location", st.location, "location")}${tbl("Qualification", st.qualification, "qualification")}${tbl("Availability", st.availability, "availability")}
  <div><h3>Per role</h3><table><tr><th></th><th>Qual. weight</th><th>Top tier ≤</th><th>2nd tier ≤</th></tr>${ids.map(r => { const o = roleOf(r); return `<tr><td>${esc(o.name)}</td><td><input type="number" step="0.1" value="${o.qualWeight ?? 1}" data-role="${esc(r)}" data-rk="qualWeight" ${locked ? "disabled" : ""}></td><td><input type="number" value="${o.top ?? 10}" data-role="${esc(r)}" data-rk="top" ${locked ? "disabled" : ""}></td><td><input type="number" value="${o.second ?? 20}" data-role="${esc(r)}" data-rk="second" ${locked ? "disabled" : ""}></td></tr>`; }).join("")}
  <tr><td>Relocation bonus</td><td colspan="3"><input type="number" value="${st.relocation}" data-k="relocation" ${locked ? "disabled" : ""}></td></tr></table></div></div>
  ${locked ? "" : `<p><button class="btn primary" id="save-settings">Save scoring rules</button></p>`}`;
  $("#save-settings")?.addEventListener("click", async () => {
    const ns = JSON.parse(JSON.stringify(st));
    for (const inp of $("#settings-body").querySelectorAll("input[data-k]")) { const v = Number(inp.value); if (Number.isNaN(v)) continue; if (inp.dataset.f) ns[inp.dataset.k][inp.dataset.f] = v; else ns[inp.dataset.k] = v; }
    if (!await write(S.db.doc("settings/scoring"), ns, "Scoring rules saved")) return;
    for (const r of ids) {
      const o = { ...roleOf(r) }; let changed = !S.roles[r];
      for (const inp of $("#settings-body").querySelectorAll(`input[data-role="${CSS.escape(r)}"]`)) { const v = Number(inp.value); if (!Number.isNaN(v) && o[inp.dataset.rk] !== v) { o[inp.dataset.rk] = v; changed = true; } }
      if (changed) { delete o.id; await write(S.db.doc("roles/" + r), o, `${o.name} updated`); }
    }
  });
}

/* ---------- Excel backup ---------- */
function buildWorkbook() {
  const comp = compute(), X = window.XLSX, wb = X.utils.book_new();
  const cols = ["S/N", "Full Name", "Phone", "Email", "Address (register)", "Qualification", "Location", "State", "Status", "Attempts", "Mode", "Availability", "Can relocate", "Shortlist override", "Adjust", "Portfolio", "Next action", "Notes", "Last update", "Location pts", "Qualification pts", "Pre-call score", "Pre-call rank", "Tier", "Availability pts", "Relocation pts", "Final score", "Eligible", "Combined rank"];
  const row = c => { const o = comp[c.id]; return [c.sn, c.name, c.phone, c.email, c.address, c.qualification, c.location, c.state, c.status === "contacted" ? "Contacted" : c.status === "attempted" ? "No answer" : "Not contacted", c.attempts || 0, c.mode, c.availability, c.relocation, c.manual, c.adjust || 0, c.portfolio || "", c.nextAction, c.notes, c.lastContact ? fmtDate(c.lastContact) : "", o.locPts, o.qualPts, o.pre, o.rank, o.tier, o.availPts, o.reloPts, o.final, o.eligible ? "Yes" : "No", o.combined ?? ""]; };
  for (const r of allRoleIds()) {
    const ws = X.utils.aoa_to_sheet([cols, ...byRole(r).sort((a, b) => comp[a.id].rank - comp[b.id].rank).map(row)]);
    ws["!cols"] = [4, 28, 13, 30, 36, 13, 18, 13, 14, 8, 9, 15, 11, 10, 7, 24, 11, 34, 16, 8, 8, 8, 8, 12, 8, 8, 8, 8, 8].map(w => ({ wch: w })); ws["!freeze"] = { xSplit: 2, ySplit: 1 };
    X.utils.book_append_sheet(wb, ws, roleName(r).slice(0, 31).replace(/[\\/?*\[\]:]/g, " "));
  }
  const si = Object.values(S.cands).filter(c => comp[c.id].eligible).sort((a, b) => comp[a.id].combined - comp[b.id].combined);
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([["Rank", "Full Name", "Role", "Phone", "Email", "Location", "State", "Qualification", "Availability", "Can relocate", "Final score", "Criteria met", "Notes"], ...si.map(c => { const o = comp[c.id]; return [o.combined, c.name, roleName(c.role), c.phone, c.email, c.location, c.state, c.qualification, c.availability, c.relocation, o.final, o.criteria.join(" | "), c.notes]; })]), "Second Interview");
  const is = Object.values(S.issues).sort((a, b) => (a.resolved - b.resolved) || a.name.localeCompare(b.name));
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([["Full Name", "Role", "Issue", "Detail", "Action required", "Resolved", "Resolution", "Resolved at"], ...is.map(i => [i.name, i.role, i.issue, i.detail, i.action, i.resolved ? "Yes" : "No", i.resolution || "", i.resolvedAt ? fmtDate(i.resolvedAt) : ""])]), "Issues");
  const hist = []; for (const c of Object.values(S.cands)) for (const h of c.history || []) hist.push([h.ts, c.name, roleName(c.role), h.summary]); hist.sort((a, b) => b[0].localeCompare(a[0]));
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([["When", "Candidate", "Role", "What changed"], ...hist.map(h => [fmtDate(h[0]), h[1], h[2], h[3]])]), "Call Log");
  const st = S.settings, sr = [["Table", "Item", "Points"]];
  for (const [t, obj] of [["Location", st.location], ["Qualification", st.qualification], ["Availability", st.availability]]) for (const [k, v] of Object.entries(obj)) sr.push([t, k, v]);
  sr.push(["Relocation bonus", "", st.relocation]); for (const r of roleIds()) { const o = roleOf(r); sr.push(["Role: " + o.name, "qualification weight / top / second", `${o.qualWeight ?? 1} / ${o.top ?? 10} / ${o.second ?? 20}`]); }
  sr.push([], ["Exported", new Date().toLocaleString("en-NG"), ""], ["Source", "Future Ready Hiring Desk (live database)", ""]);
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(sr), "Scoring Rules");
  return X.write(wb, { type: "array", bookType: "xlsx" });
}
function buildCSV() {
  const comp = compute(); const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const cols = ["Role", "S/N", "Full Name", "Phone", "Email", "Address", "Qualification", "Location", "State", "Status", "Attempts", "Mode", "Availability", "Can relocate", "Shortlist override", "Adjust", "Portfolio", "Next action", "Notes", "Last update", "Pre-call score", "Pre-call rank", "Tier", "Final score", "Eligible", "Combined rank"];
  const rows = [cols.map(q).join(",")];
  for (const r of allRoleIds()) for (const c of byRole(r).sort((a, b) => comp[a.id].rank - comp[b.id].rank)) { const o = comp[c.id];
    rows.push([roleName(r), c.sn, c.name, c.phone, c.email, c.address, c.qualification, c.location, c.state, c.status === "contacted" ? "Contacted" : c.status === "attempted" ? "No answer" : "Not contacted", c.attempts || 0, c.mode, c.availability, c.relocation, c.manual, c.adjust || 0, c.portfolio || "", c.nextAction, c.notes, c.lastContact ? fmtDate(c.lastContact) : "", o.pre, o.rank, o.tier, o.final, o.eligible ? "Yes" : "No", o.combined ?? ""].map(q).join(",")); }
  return "﻿" + rows.join("\r\n");
}
function buildPDF() {
  const comp = compute(); const { jsPDF } = window.jspdf; const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const all = Object.values(S.cands), n = all.length, contacted = all.filter(c => c.status === "contacted").length, elig = Object.values(comp).filter(o => o.eligible).length;
  const stamp = new Date().toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
  const head = (title, sub) => { doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(16, 24, 40); doc.text(title, 40, 46); doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(102, 112, 133); doc.text(sub, 40, 62); };
  head("Future Ready Nigeria Ltd · Hiring Desk", `Candidate screening report · ${stamp} · Office: Udeorji Street, Obiagu, Enugu`);
  doc.setFontSize(11); doc.setTextColor(16, 24, 40);
  doc.text(`${n} candidates across ${roleIds().length} role(s) · ${contacted} contacted · ${elig} eligible for second interview · ${Object.values(S.issues).filter(i => !i.resolved).length} open data issues`, 40, 90);
  const si = all.filter(c => comp[c.id].eligible).sort((a, b) => comp[a.id].combined - comp[b.id].combined);
  const tbl = (startY, title, headRow, body) => { doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(16, 24, 40); doc.text(title, 40, startY); doc.autoTable({ startY: startY + 8, head: [headRow], body, styles: { font: "helvetica", fontSize: 8, cellPadding: 4, textColor: [16, 24, 40], overflow: "linebreak" }, headStyles: { fillColor: [16, 24, 40], textColor: 255, fontStyle: "bold" }, alternateRowStyles: { fillColor: [247, 248, 250] }, margin: { left: 40, right: 40 } }); return doc.lastAutoTable.finalY + 28; };
  let y = tbl(112, "Second interview shortlist", ["#", "Name", "Role", "Phone", "Location", "Availability", "Final", "Why"], si.length ? si.map(c => { const o = comp[c.id]; return [o.combined, c.name, roleName(c.role), c.phone, c.location, c.availability, o.final, o.criteria.join(" · ")]; }) : [["", "No one has qualified yet", "", "", "", "", "", ""]]);
  for (const r of roleIds()) {
    doc.addPage(); head(roleName(r), `${byRole(r).length} applicants, in pre-call priority order · ${byRole(r).filter(c => c.status === "contacted").length} contacted`);
    tbl(84, "Ranked list", ["Rank", "Name", "Phone", "Location", "Qualification", "Status", "Availability", "Score", "Tier"], byRole(r).sort((a, b) => comp[a.id].rank - comp[b.id].rank).map(c => { const o = comp[c.id]; return [o.rank, c.name, c.phone, c.location, c.qualification, c.status === "contacted" ? "Contacted" : c.status === "attempted" ? `No answer ×${c.attempts || 1}` : "Not contacted", c.availability || "", o.pre, o.tier]; }));
  }
  const open = Object.values(S.issues).filter(i => !i.resolved).sort((a, b) => a.name.localeCompare(b.name));
  if (open.length) { doc.addPage(); head("Open data issues", `${open.length} to resolve`); tbl(84, "Issues", ["Candidate", "Role", "Issue", "Detail", "Action"], open.map(i => [i.name, i.role, i.issue, i.detail, i.action])); }
  const pages = doc.getNumberOfPages(); for (let p = 1; p <= pages; p++) { doc.setPage(p); doc.setFontSize(8); doc.setTextColor(152, 162, 179); doc.text(`Future Ready Hiring Desk · generated ${stamp} · page ${p} of ${pages}`, 40, doc.internal.pageSize.getHeight() - 20); }
  return doc.output("arraybuffer");
}
/* ---------- scoped exports: a scope becomes sections, sections become xlsx / csv / pdf ---------- */
const STATUS_TXT = c => c.status === "contacted" ? "Contacted" : c.status === "attempted" ? `No answer ×${c.attempts || 1}` : effStatus(c) === "awaiting" ? "Awaiting reply" : "Not contacted";
const ROW_HEAD = ["Rank", "S/N", "Full Name", "Phone", "Email", "Address", "Qualification", "Location", "State", "Status", "Mode", "Availability", "Can relocate", "Shortlist override", "Adjust", "Portfolio", "Next action", "Notes", "Last update", "Location pts", "Qualification pts", "Pre-call score", "Tier", "Availability pts", "Relocation pts", "Final score", "Eligible", "Combined rank"];
const rowOf = (c, o) => [o.rank, c.sn, c.name, c.phone, c.email, c.address, c.qualification, c.location, c.state, STATUS_TXT(c), c.mode, c.availability, c.relocation, c.manual, c.adjust || 0, c.portfolio || "", c.nextAction, c.notes, c.lastContact ? fmtDate(c.lastContact) : "", o.locPts, o.qualPts, o.pre, o.tier, o.availPts, o.reloPts, o.final, o.eligible ? "Yes" : "No", o.combined ?? ""];
function applyFilters(list, comp, f) {
  return list.filter(c => { const o = comp[c.id];
    if (f.status && effStatus(c) !== f.status) return false; if (f.avail && (c.availability || "") !== f.avail) return false;
    if (f.loc && (c.location || "Unknown") !== f.loc) return false; if (f.tier && o.tier !== f.tier) return false;
    if (f.q && !(c.name + " " + c.phone + " " + c.email + " " + c.address).toLowerCase().includes(f.q)) return false; return true; });
}
const filterLabel = f => [f.status && ({ pending: "not contacted", awaiting: "awaiting reply", attempted: "no answer", contacted: "contacted" }[f.status]), f.avail, f.loc, f.tier, f.q && `"${f.q}"`].filter(Boolean).join(", ");
const slug = s => String(s).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
function exportData(scope) {
  const comp = compute(), date = new Date().toISOString().slice(0, 10);
  if (scope.kind === "role" || scope.kind === "filtered") {
    const f = scope.kind === "filtered" ? scope.filters : {}; const list = applyFilters(byRole(scope.role), comp, f).sort((a, b) => comp[a.id].rank - comp[b.id].rank);
    const rn = roleName(scope.role), fl = scope.kind === "filtered" ? filterLabel(f) : "";
    return { name: `${slug(rn)}${fl ? "-" + slug(fl) : ""}-${date}`, title: rn, subtitle: `${list.length} candidate${list.length === 1 ? "" : "s"}${fl ? " · filtered: " + fl : ""} · pre-call priority order`,
      sections: [{ title: rn + (fl ? " (" + fl + ")" : ""), head: ROW_HEAD, rows: list.map(c => rowOf(c, comp[c.id])), pdfCols: [0, 2, 3, 7, 6, 9, 11, 21, 22] },
        { title: "Open issues", head: ["Candidate", "Issue", "Detail", "Action"], rows: Object.values(S.issues).filter(i => !i.resolved && list.some(c => c.id === i.candidateId)).map(i => [i.name, i.issue, i.detail, i.action]) }] };
  }
  if (scope.kind === "interview") {
    const list = Object.values(S.cands).filter(c => comp[c.id].eligible).sort((a, b) => comp[a.id].combined - comp[b.id].combined);
    return { name: `Second-Interview-${date}`, title: "Second interview shortlist", subtitle: `${list.length} candidate${list.length === 1 ? "" : "s"} who met the criteria, best first`,
      sections: [{ title: "Shortlist", head: ["Rank", "Full Name", "Role", "Phone", "Email", "Location", "State", "Qualification", "Availability", "Can relocate", "Pre-call score", "Final score", "Criteria met", "Notes"], rows: list.map(c => { const o = comp[c.id]; return [o.combined, c.name, roleName(c.role), c.phone, c.email, c.location, c.state, c.qualification, c.availability, c.relocation, o.pre, o.final, o.criteria.join(" · "), c.notes]; }), pdfCols: [0, 1, 2, 3, 5, 8, 11, 12] }] };
  }
  if (scope.kind === "candidate") {
    const c = S.cands[scope.id], o = comp[c.id];
    const kv = [["Full name", c.name], ["Role", roleName(c.role)], ["Register number", c.sn], ["Phone", c.phone], ["Email", c.email], ["Address (register)", c.address], ["Qualification", c.qualification], ["Location", c.location], ["State", c.state], ["Status", STATUS_TXT(c)], ["Mode of contact", c.mode], ["Availability", c.availability], ["Can relocate", c.relocation], ["Shortlist override", c.manual || "Automatic"], ["Portfolio / CV", c.portfolio || ""], ["Next action date", c.nextAction], ["Notes", c.notes], ["Last update", c.lastContact ? fmtDate(c.lastContact) : ""],
      ["Location points", o.locPts], ["Qualification points", o.qualPts], ["Manual adjustment", c.adjust || 0], ["Pre-call score", o.pre], ["Pre-call rank", `${o.rank} of ${byRole(c.role).length} (${o.tier})`], ["Availability points", o.availPts], ["Relocation points", o.reloPts], ["Final score", o.final], ["Eligible for second interview", o.eligible ? "Yes" : "No"], ["Second-interview rank", o.combined ?? "—"], ["Criteria met", o.criteria.join(" · ")]];
    return { name: `${slug(c.name)}-${slug(roleName(c.role))}-${date}`, title: c.name, subtitle: `${roleName(c.role)} · full profile, status and scores`,
      sections: [{ title: "Profile", head: ["Field", "Value"], rows: kv, kv: true }, { title: "Call history", head: ["When", "What changed"], rows: (c.history || []).slice().reverse().map(h => [fmtDate(h.ts), h.summary]) },
        { title: "Data issues", head: ["Issue", "Detail", "Action", "Resolved"], rows: Object.values(S.issues).filter(i => i.candidateId === c.id).map(i => [i.issue, i.detail, i.action, i.resolved ? "Yes" + (i.resolution ? ": " + i.resolution : "") : "No"]) }] };
  }
  return { name: `Future-Ready-Candidates-${date}`, title: "Everything", all: true };
}
function sectionsToXlsx(d) {
  if (d.all) return buildWorkbook(); const X = window.XLSX, wb = X.utils.book_new();
  for (const s of d.sections) { const ws = X.utils.aoa_to_sheet([[d.title + (s.title !== d.title ? " · " + s.title : "")], [d.subtitle], [], s.head, ...s.rows]); ws["!cols"] = s.head.map((h, i) => ({ wch: s.kv ? (i ? 60 : 26) : Math.min(40, Math.max(8, h.length + 4)) })); ws["!freeze"] = { ySplit: 4 }; X.utils.book_append_sheet(wb, ws, s.title.slice(0, 31).replace(/[\\/?*\[\]:]/g, " ")); }
  return X.write(wb, { type: "array", bookType: "xlsx" });
}
function sectionsToCsv(d) {
  if (d.all) return buildCSV(); const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`; const out = [];
  for (const s of d.sections) { if (d.sections.length > 1) out.push(q(s.title)); out.push(s.head.map(q).join(",")); for (const r of s.rows) out.push(r.map(q).join(",")); out.push(""); }
  return "﻿" + out.join("\r\n");
}
function sectionsToPdf(d) {
  if (d.all) return buildPDF(); const { jsPDF } = window.jspdf; const kvOnly = d.sections[0]?.kv; const doc = new jsPDF({ orientation: kvOnly ? "portrait" : "landscape", unit: "pt", format: "a4" });
  const stamp = new Date().toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
  doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(16, 24, 40); doc.text(d.title, 40, 46); doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(102, 112, 133); doc.text(`${d.subtitle} · Future Ready Nigeria Ltd · ${stamp}`, 40, 62);
  let y = 86;
  for (const s of d.sections) { if (!s.rows.length && !s.kv) continue; const cols = s.pdfCols || s.head.map((_, i) => i);
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(16, 24, 40); doc.text(s.title, 40, y);
    doc.autoTable({ startY: y + 8, head: [cols.map(i => s.head[i])], body: s.rows.length ? s.rows.map(r => cols.map(i => r[i])) : [["No entries", ...cols.slice(1).map(() => "")]], styles: { font: "helvetica", fontSize: s.kv ? 9 : 8, cellPadding: 4, textColor: [16, 24, 40], overflow: "linebreak" }, headStyles: { fillColor: [16, 24, 40], textColor: 255, fontStyle: "bold" }, alternateRowStyles: { fillColor: [247, 248, 250] }, columnStyles: s.kv ? { 0: { fontStyle: "bold", cellWidth: 160 } } : {}, margin: { left: 40, right: 40 } });
    y = doc.lastAutoTable.finalY + 28; }
  const pages = doc.getNumberOfPages(); for (let p = 1; p <= pages; p++) { doc.setPage(p); doc.setFontSize(8); doc.setTextColor(152, 162, 179); doc.text(`Future Ready Hiring Desk · generated ${stamp} · page ${p} of ${pages}`, 40, doc.internal.pageSize.getHeight() - 20); }
  return doc.output("arraybuffer");
}
let DL = null;
function openDownload(preset) {
  if (!DL) { toast("Downloads aren't available in this view"); return; } if (!S.loaded) { toast("Still loading"); return; }
  const f = S.filters, hasF = !!filterLabel(f), cur = S.role, ids = roleIds();
  const opts = [{ v: "all", b: "Everything", s: `All ${Object.keys(S.cands).length} candidates, every role, issues, call log, scoring rules` }];
  for (const r of allRoleIds()) opts.push({ v: "role:" + r, b: roleName(r) + (roleOf(r).status === "closed" ? " (ended)" : "") + " only", s: `${byRole(r).length} candidates with all their details and scores` });
  if (cur && hasF) opts.push({ v: "filtered", b: `${roleName(cur)}, as filtered now`, s: `${applyFilters(byRole(cur), compute(), f).length} candidates · ${filterLabel(f)}` });
  const elig = Object.values(compute()).filter(o => o.eligible).length; opts.push({ v: "interview", b: "Second-interview shortlist", s: `${elig} candidate${elig === 1 ? "" : "s"} who met the criteria` });
  if (preset?.kind === "candidate") opts.unshift({ v: "candidate:" + preset.id, b: `${S.cands[preset.id].name} only`, s: "Full profile, status, scores, call history and issues" });
  const sel = preset?.kind === "candidate" ? "candidate:" + preset.id : preset?.kind === "filtered" && hasF ? "filtered" : preset?.kind === "role" ? "role:" + preset.role : preset?.kind === "interview" ? "interview" : "all";
  const scopeOf = v => v === "all" ? { kind: "all" } : v === "filtered" ? { kind: "filtered", role: cur, filters: { ...f } } : v === "interview" ? { kind: "interview" } : v.startsWith("role:") ? { kind: "role", role: v.slice(5) } : { kind: "candidate", id: v.slice(10) };
  const m = $("#dl-modal");
  m.innerHTML = `<h2 id="dl-title">Download</h2>
    <div class="opts" id="dl-opts">${opts.map(o => `<label class="opt"><input type="radio" name="dl-scope" value="${esc(o.v)}" ${o.v === sel ? "checked" : ""}><div><b>${esc(o.b)}</b><span>${esc(o.s)}</span></div></label>`).join("")}</div>
    <div class="field"><label>Format</label><div class="fmts"><label><input type="radio" name="dl-fmt" value="xlsx" checked>Excel</label><label><input type="radio" name="dl-fmt" value="csv">CSV</label><label><input type="radio" name="dl-fmt" value="pdf">PDF</label></div></div>
    <div class="field"><label>File name</label><div class="fname"><input id="dl-name" autocomplete="off"><span id="dl-ext">.xlsx</span></div></div>
    <p class="muted" style="margin:0;font-size:12px">The folder is chosen by your browser. To be asked each time, turn on “Ask where to save each file before downloading” in your browser’s download settings.</p>
    <div class="toolbar"><button class="btn primary" id="dl-go">Download</button><button class="btn" id="dl-cancel">Cancel</button></div>`;
  const nameFor = () => exportData(scopeOf(m.querySelector("input[name=dl-scope]:checked").value)).name;
  $("#dl-name").value = nameFor(); let touched = false;
  $("#dl-name").addEventListener("input", () => { touched = true; });
  $("#dl-opts").addEventListener("change", () => { if (!touched) $("#dl-name").value = nameFor(); });
  for (const r of m.querySelectorAll("input[name=dl-fmt]")) r.addEventListener("change", e => { $("#dl-ext").textContent = "." + e.target.value; });
  $("#dl-scrim").hidden = false; setTimeout(() => $("#dl-name").focus(), 150);
  $("#dl-cancel").onclick = closeDownload; $("#dl-scrim").onclick = e => { if (e.target === $("#dl-scrim")) closeDownload(); };
  $("#dl-go").onclick = async () => {
    const fmt = m.querySelector("input[name=dl-fmt]:checked").value, scope = scopeOf(m.querySelector("input[name=dl-scope]:checked").value);
    const base = ($("#dl-name").value.trim().replace(/[\\/:*?"<>|]+/g, "-") || nameFor()).replace(/\.(xlsx|csv|pdf)$/i, "");
    $("#dl-go").disabled = true;
    try { const d = exportData(scope); const data = fmt === "xlsx" ? sectionsToXlsx(d) : fmt === "csv" ? sectionsToCsv(d) : sectionsToPdf(d);
      await DL.save({ filename: `${base}.${fmt}`, data }); toast(`${base}.${fmt} ready`, "ok"); closeDownload(); }
    catch (e) { if (e?.code === "declined") toast("Download cancelled", "warn"); else toast("Export failed: " + (e?.message || e?.code || "unknown"), "bad"); }
    finally { $("#dl-go").disabled = false; }
  };
}
function closeDownload() { $("#dl-scrim").hidden = true; }
async function setupExport() {
  const btn = $("#dl-btn"); if (btn.dataset.ready) return; btn.dataset.ready = "1";
  DL = { save: async ({ filename, data }) => { const blob = data instanceof Blob ? data : new Blob([data], { type: filename.endsWith(".csv") ? "text/csv;charset=utf-8" : filename.endsWith(".pdf") ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); return { status: "saved" }; } }; btn.hidden = false;
  btn.addEventListener("click", () => openDownload(S.view === "candidates" && S.role ? (filterLabel(S.filters) ? { kind: "filtered" } : { kind: "role", role: S.role }) : S.view === "interview" ? { kind: "interview" } : { kind: "all" }));
  document.body.classList.add("has-dl"); render();
}

/* ---------- import a role from a Jobberman export ---------- */
function renderImport() {
  const el = $("#v-import");
  if (ro() || S.canWrite === null && !S.me) { el.innerHTML = `<div class="empty"><h2>Editors only</h2><p>Importing a new role writes to the shared database. Ask the owner for Contributor or Editor access.</p></div>`; return; }
  if (!el.dataset.built) {
    el.dataset.built = "1";
    el.innerHTML = `<ol class="steps"><li><b>Export from Jobberman</b>Download the applicants for the new role as Excel or CSV.</li><li><b>Drop it here</b>One sheet per role. Columns are matched by their headers.</li><li><b>Check the preview</b>Name the role, confirm the column mapping and the counts.</li><li><b>Import</b>Candidates, scores, tiers and data issues appear everywhere at once.</li></ol>
    <label class="drop" id="drop"><input type="file" id="file" accept=".xlsx,.xls,.csv"><svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg><b>Drop the Jobberman export here, or tap to choose</b><span class="muted">.xlsx, .xls or .csv · headers like Full Name, Contact Number, Email, Address, Highest Qualification</span></label>
    <div id="preview"></div>`;
    const drop = $("#drop"), file = $("#file");
    drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); }); drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("over"); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
    file.addEventListener("change", () => { if (file.files[0]) readFile(file.files[0]); });
  }
  if (S.imp) renderPreview();
}
const HEAD_KEYS = { name: ["full name", "name", "applicant", "candidate"], phone: ["contact number", "phone", "mobile", "telephone", "contact"], email: ["email"], address: ["address", "location", "residence", "city"], qual: ["qualification", "education", "degree", "highest"] };
function guessCol(headers, key) { const hs = headers.map(h => String(h || "").toLowerCase()); for (const k of HEAD_KEYS[key]) { const i = hs.findIndex(h => h.includes(k)); if (i >= 0) return i; } return -1; }
function readFile(f) {
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const wb = XLSX.read(rd.result, { type: "array" });
      const sheets = wb.SheetNames.map(n => ({ name: n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: "" }).filter(r => r.some(x => String(x).trim() !== "")) })).filter(s => s.rows.length > 1);
      if (!sheets.length) { toast("No rows found in that file", "warn"); return; }
      S.imp = { file: f.name, sheets, idx: 0, map: {}, roleName: "", qualWeight: 1, target: null }; pickSheet(0); renderPreview();
    } catch (e) { toast("Could not read the file: " + (e.message || e), "bad"); }
  };
  rd.readAsArrayBuffer(f);
}
function pickSheet(i) {
  const s = S.imp.sheets[i]; S.imp.idx = i; const h = s.rows[0];
  S.imp.map = { name: guessCol(h, "name"), phone: guessCol(h, "phone"), email: guessCol(h, "email"), address: guessCol(h, "address"), qual: guessCol(h, "qual") };
  S.imp.roleName = s.name.replace(/^Sheet\d*$/i, "").trim() || S.imp.file.replace(/\.(xlsx|xls|csv)$/i, "");
  S.imp.qualWeight = /design|creative|graphic|media|video|photo/i.test(S.imp.roleName) ? 0.5 : 1;
}
function parseRows() {
  const s = S.imp.sheets[S.imp.idx], m = S.imp.map, h = s.rows[0]; const out = [];
  s.rows.slice(1).forEach((r, i) => {
    const name = String(m.name >= 0 ? r[m.name] : "").trim(); if (!name) return;
    const phoneRaw = m.phone >= 0 ? r[m.phone] : ""; let phone = String(phoneRaw ?? "").replace(/[^\d+]/g, ""); if (/^\d{10}$/.test(phone)) phone = "0" + phone; if (phone.startsWith("234")) phone = "0" + phone.slice(3); if (phone.startsWith("+234")) phone = "0" + phone.slice(4);
    const address = String(m.address >= 0 ? r[m.address] : "").trim(); const [location, state] = classify(address);
    out.push({ sn: i + 1, name, phone, email: String(m.email >= 0 ? r[m.email] : "").trim(), address, qualification: normQual(m.qual >= 0 ? r[m.qual] : ""), location, state });
  });
  return out;
}
function findIssues(rows, roleLabel) {
  const issues = [], phones = {};
  for (const c of rows) if (c.phone) (phones[c.phone] ||= []).push(c);
  for (const [p, cs] of Object.entries(phones)) if (cs.length > 1) for (const c of cs) issues.push({ sn: c.sn, name: c.name, issue: "Duplicate phone number", detail: `${p} is also listed for ${cs.filter(x => x !== c).map(x => x.name).join(", ")}`, action: "Call the number once; confirm whose it is, then correct or remove the other entry" });
  for (const c of rows) {
    if (!c.phone) issues.push({ sn: c.sn, name: c.name, issue: "No phone number", detail: "Register has email only", action: "Email the candidate and ask for a phone number" });
    if (!c.address) issues.push({ sn: c.sn, name: c.name, issue: "No address", detail: "Location pre-filled as Unknown", action: "Ask location on the call and set the Location dropdown" });
    if (c.qualification === "Unknown") issues.push({ sn: c.sn, name: c.name, issue: "No qualification", detail: "Qualification column empty or not recognised in the export", action: "Ask on the call and set the Qualification dropdown" });
    if (c.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email)) issues.push({ sn: c.sn, name: c.name, issue: "Email looks invalid", detail: c.email, action: "Confirm the email on the call" });
  }
  return issues.map(i => ({ ...i, role: roleLabel }));
}
function renderPreview() {
  const p = $("#preview"), imp = S.imp, s = imp.sheets[imp.idx], h = s.rows[0], rows = parseRows(), issues = findIssues(rows, imp.roleName);
  const opt = (sel) => `<option value="-1" ${sel < 0 ? "selected" : ""}>— not in file —</option>` + h.map((x, i) => `<option value="${i}" ${i === sel ? "selected" : ""}>${esc(x || "(blank header " + (i + 1) + ")")}</option>`).join("");
  const locCount = LOCS.map(l => [l, rows.filter(r => r.location === l).length]).filter(x => x[1]);
  const exists = roleIds().some(r => roleName(r).toLowerCase() === imp.roleName.trim().toLowerCase());
  p.innerHTML = `<div class="card" style="display:grid;gap:14px;animation:rise .25s ease-out">
    <h2>Preview <small>${esc(imp.file)} · ${rows.length} applicants read</small></h2>
    ${imp.sheets.length > 1 ? `<div class="field"><label>Sheet in the file</label><select id="imp-sheet">${imp.sheets.map((x, i) => `<option value="${i}" ${i === imp.idx ? "selected" : ""}>${esc(x.name)} (${x.rows.length - 1} rows)</option>`).join("")}</select></div>` : ""}
    <div class="fields"><div class="field"><label>Import into</label><select id="imp-target"><option value="">A new role</option>${roleIds().map(r => `<option value="${esc(r)}" ${imp.target === r ? "selected" : ""}>Existing: ${esc(roleName(r))} (${byRole(r).length} already)</option>`).join("")}</select></div>
      ${imp.target ? `<div class="field"><label>Duplicates</label><div class="muted" style="padding:8px 0">${rows.filter(r => r.phone && byRole(imp.target).some(c => c.phone === r.phone)).length} of these phone numbers are already in ${esc(roleName(imp.target))}; those rows will be skipped.</div></div>` :
      `<div class="field"><label>Role name (as it will appear everywhere)</label><input id="imp-role" value="${esc(imp.roleName)}" placeholder="e.g. Sales Executive"></div>
      <div class="field"><label>Qualification weight</label><select id="imp-weight"><option value="1" ${imp.qualWeight === 1 ? "selected" : ""}>1 · certificate matters (office roles)</option><option value="0.5" ${imp.qualWeight === 0.5 ? "selected" : ""}>0.5 · portfolio matters more (creative roles)</option></select></div>`}</div>
    ${exists && !imp.target ? `<div class="banner warn">A role with this name already exists. Choose it under "Import into" to add these applicants to it, or rename this one if it is a different posting.</div>` : ""}
    <h3>Column mapping</h3><div class="map">${[["name", "Full name"], ["phone", "Phone"], ["email", "Email"], ["address", "Address"], ["qual", "Qualification"]].map(([k, l]) => `<div class="field"><label>${l}${k === "name" ? " (required)" : ""}</label><select data-map="${k}">${opt(imp.map[k])}</select></div>`).join("")}</div>
    <div class="tiles"><div class="tile" style="cursor:default"><span class="label">Applicants</span><span class="value">${rows.length}</span><span class="sub">${rows.filter(r => r.phone).length} with phone · ${rows.filter(r => r.email).length} with email</span></div>
      <div class="tile" style="cursor:default"><span class="label">Location (pre-filled)</span><span class="value">${rows.filter(r => ["Close to office", "Within Enugu"].includes(r.location)).length}</span><span class="sub">in Enugu · ${locCount.map(x => x[1] + " " + x[0].toLowerCase()).join(" · ")}</span></div>
      <div class="tile" style="cursor:default"><span class="label">Data issues found</span><span class="value">${issues.length}</span><span class="sub">duplicates, missing phone/address/qualification</span></div></div>
    <div class="table-wrap"><table><thead><tr><th>#</th><th>Name</th><th>Phone</th><th>Email</th><th>Address</th><th>Qualification</th><th>Location</th></tr></thead><tbody>${rows.slice(0, 8).map(r => `<tr style="cursor:default"><td>${r.sn}</td><td>${esc(r.name)}</td><td class="num">${esc(r.phone)}</td><td>${esc(r.email)}</td><td>${esc(r.address)}</td><td>${esc(r.qualification)}</td><td>${pillLoc(r.location)}</td></tr>`).join("")}${rows.length > 8 ? `<tr style="cursor:default"><td colspan="7" class="muted">… and ${rows.length - 8} more</td></tr>` : ""}</tbody></table></div>
    <div id="imp-prog" hidden><div class="prog"><i style="width:0%"></i></div><p class="muted" id="imp-msg" style="margin:6px 0 0"></p></div>
    <div class="toolbar"><button class="btn primary" id="imp-go" ${imp.map.name < 0 || (!imp.target && !imp.roleName.trim()) ? "disabled" : ""}>${imp.target ? `Add ${rows.length} to "${esc(roleName(imp.target))}"` : `Import ${rows.length} candidates as "${esc(imp.roleName || "…")}"`}</button><button class="btn" id="imp-cancel">Cancel</button></div></div>`;
  $("#imp-sheet")?.addEventListener("change", e => { pickSheet(Number(e.target.value)); renderPreview(); });
  $("#imp-target").addEventListener("change", e => { imp.target = e.target.value || null; renderPreview(); });
  $("#imp-role")?.addEventListener("input", e => { imp.roleName = e.target.value; $("#imp-go").disabled = imp.map.name < 0 || !imp.roleName.trim(); $("#imp-go").textContent = `Import ${rows.length} candidates as "${imp.roleName || "…"}"`; });
  $("#imp-weight")?.addEventListener("change", e => { imp.qualWeight = Number(e.target.value); });
  for (const sel of p.querySelectorAll("select[data-map]")) sel.addEventListener("change", e => { imp.map[e.target.dataset.map] = Number(e.target.value); renderPreview(); });
  $("#imp-cancel").addEventListener("click", () => { S.imp = null; p.innerHTML = ""; $("#file").value = ""; });
  $("#imp-go").addEventListener("click", () => runImport(rows, issues));
}
async function runImport(rows, issues) {
  const imp = S.imp, existing = imp.target || null;
  const name = existing ? roleName(existing) : imp.roleName.trim();
  const rid = existing || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) + "-" + Date.now().toString(36).slice(-4);
  let start = existing ? nextSn(existing) : 1;
  if (existing) { const have = new Set(byRole(existing).map(c => c.phone).filter(Boolean)); rows = rows.filter(r => !(r.phone && have.has(r.phone))); const snMap = {}; rows.forEach((r, i) => { snMap[r.sn] = start + i; }); rows = rows.map((r, i) => ({ ...r, sn: start + i })); issues = issues.filter(i => snMap[i.sn] !== undefined).map(i => ({ ...i, sn: snMap[i.sn], role: name })); }
  if (!rows.length) { toast("Nothing new to add: every row is already in that role"); return; }
  const btn = $("#imp-go"); btn.disabled = true; $("#imp-cancel").disabled = true; $("#imp-prog").hidden = false;
  const total = rows.length + issues.length + 1; let done = 0; const tick = m => { done++; $("#imp-prog i").style.width = Math.round(done / total * 100) + "%"; $("#imp-msg").textContent = m; };
  const stamp = Date.now().toString(36).slice(-4);
  try {
    if (!existing) await S.db.doc("roles/" + rid).set({ name, companyId: S.company, qualWeight: imp.qualWeight, top: 10, second: Math.min(25, Math.max(10, Math.round(rows.length / 3))), order: roleIds().length + 1, source: imp.file, createdAt: new Date().toISOString(), createdBy: S.me?.id || null });
    tick(existing ? "Adding to " + name : "Role created");
    for (const r of rows) {
      await S.db.doc("candidates/" + candId(rid, r.sn)).set({ role: rid, ...r, status: "pending", attempts: 0, mode: "", availability: "", relocation: "", manual: "", adjust: 0, notes: "", portfolio: "", nextAction: "", lastContact: null, lastBy: null, importedFrom: imp.file, history: [] });
      tick(`Saved ${r.name}`);
    }
    for (const [i, is] of issues.entries()) {
      await S.db.doc(`issues/${rid}-${stamp}-${String(i + 1).padStart(3, "0")}`).set({ candidateId: candId(rid, is.sn), name: is.name, role: is.role, issue: is.issue, detail: is.detail, action: is.action, resolved: false, resolution: "", resolvedAt: null, resolvedBy: null });
      tick(`Logged issue for ${is.name}`);
    }
    toast(`${name}: ${rows.length} candidates ${existing ? "added" : "imported"}`, "ok"); S.imp = null; $("#file").value = "";
    setView("candidates", { role: rid, filters: {} });
  } catch (e) {
    toast("Import stopped", "bad"); $("#imp-msg").textContent = "Import stopped: " + (e?.message || e?.code || "unknown error") + ". Rows already saved are kept; fix the problem and import the rest, or ask Claude to clean up.";
    btn.disabled = false; $("#imp-cancel").disabled = false;
    if (e?.code === "invalid_argument" && S.canWrite !== true) { S.canWrite = false; paintRole(); }
  }
}

/* ---------- selection bar + outreach email ---------- */
function renderSelbar() {
  const bar = $("#selbar"); if (!bar) return; const n = S.sel.size; bar.hidden = !n; if (!n) return;
  const withEmail = [...S.sel].filter(id => S.cands[id]?.email).length;
  bar.innerHTML = `<div class="selbar"><b>${n} selected</b><span class="muted">${withEmail} with an email address</span><span style="margin-left:auto;display:inline-flex;gap:8px"><button class="btn small primary" id="sel-email" ${withEmail ? "" : "disabled"}>Email selected</button><button class="btn small" id="sel-clear">Clear</button></span></div>`;
}
const INTERVIEW_TPL = { subject: "Interview invitation: {role} at Future Ready Nigeria", sender: "",
  body: "Good day {first},\n\nThank you for completing the first stage of our application process for the {role} role at Future Ready Nigeria Ltd. We would like to invite you to an interview.\n\nDate: {date}\nTime: {time}\nVenue: Udeorji Street, Obiagu, Enugu\n\nPlease reply to this email to confirm that you will attend, or to propose another time if this one does not work for you. Kindly bring a copy of your CV{portfolio}.\n\nKind regards,\n{sender}" };
const DEFAULT_TPL = { subject: "Your Jobberman application: {role} at Future Ready Nigeria",
  body: "Good day {first},\n\nThank you for applying for the {role} position at Future Ready Nigeria Ltd through Jobberman. We are now moving to the next stage and would like to confirm a few details with you.\n\nPlease take two minutes to answer this short form:\n{form}\n\nIt asks how soon you could resume, where you currently live, and whether you can work from our office at Udeorji Street, Obiagu, Enugu.\n\nIf you would rather not use the form, you can simply reply to this email with those answers.\n\nKind regards,\n{sender}" };
let TPL = null, TPLS = {}, EM_KIND = "outreach";
const fill = (t, c) => t.replace(/\{first\}/g, (c.name || "").split(" ")[0]).replace(/\{name\}/g, c.name || "").replace(/\{role\}/g, roleName(c.role)).replace(/\{form\}/g, FORM_URL).replace(/\{sender\}/g, TPL.sender || "").replace(/\{date\}/g, TPL.date || "[date]").replace(/\{time\}/g, TPL.time || "[time]").replace(/\{portfolio\}/g, (roleOf(c.role).qualWeight ?? 1) < 1 ? " and your portfolio" : "");
function emailHtml(text) { const e = esc(text).replace(/\n/g, "<br>"); return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#101828;max-width:600px">${e.replace(esc(FORM_URL), `<a href="${FORM_URL}" style="display:inline-block;background:#2f5bff;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:bold">Answer the follow-up form</a><br><span style="font-size:12px;color:#667085">Or copy this link: ${FORM_URL}</span>`)}</div>`; }
const MCP_HELP = {
  not_configured: "Email is not set up yet: the RESEND_API_KEY secret is missing on the server function.",
  not_signed_in: "Your sign-in has expired. Reload the page and sign in again.",
  not_allowed: "Your level cannot send email. Ask an editor to make you a Contributor.",
  rate_limited: "Sending limit reached (120 an hour). Wait a while before the next batch.",
};
async function sendViaFunction(c, subject, text) {
  const { data: { session } } = await FR.SB.auth.getSession(); if (!session) throw { code: "not_signed_in" };
  let r;
  try { r = await fetch(`${CFG.supabaseUrl}/functions/v1/send-email`, { method: "POST", headers: { Authorization: "Bearer " + session.access_token, apikey: CFG.supabaseKey, "Content-Type": "application/json" }, body: JSON.stringify({ candidateId: c.id, kind: EM_KIND, subject, text, formUrl: FORM_URL }) }); }
  catch (e) { throw { code: "network", message: e.message }; }
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw { code: out.error || ("http_" + r.status), message: out.detail || out.error || ("HTTP " + r.status) };
  return out;
}
async function openEmail(ids, kind = "outreach") {
  if (ro()) return; EM_KIND = kind;
  if (!S.mcp) { toast("Sending is not available: not signed in.", "bad"); return; }
  const base = kind === "interview" ? INTERVIEW_TPL : DEFAULT_TPL, docId = kind === "interview" ? "settings/interviewEmail" : "settings/outreach";
  if (!TPLS[kind]) { try { const s = await S.db.doc(docId).get(); TPLS[kind] = s.exists ? { ...base, ...s.data() } : { ...base, sender: S.me?.name || "" }; } catch { TPLS[kind] = { ...base, sender: S.me?.name || "" }; } }
  TPL = TPLS[kind];
  const list = ids.map(id => S.cands[id]).filter(Boolean);
  const ok = list.filter(c => c.email), no = list.filter(c => !c.email), already = ok.filter(c => kind === "interview" ? c.interview?.invitedAt : c.lastEmailStatus === "sent");
  const m = $("#em-modal");
  m.innerHTML = `<h2 id="em-title">${kind === "interview" ? "Invite to interview" : "Email"}: ${ok.length} candidate${ok.length === 1 ? "" : "s"}</h2>
    <div class="hint">Sent one by one from the company sender address. Each result is recorded on the candidate.</div>
    <div class="rcpts" id="em-rcpts">${ok.map(c => `<div data-r="${c.id}"><span>${esc(c.name)} <span class="muted">· ${esc(c.email)}${c.lastEmailStatus === "sent" ? " · already emailed " + fmtDate(c.emailedAt) : ""}</span></span><span class="st muted">queued</span></div>`).join("")}${no.map(c => `<div><span class="muted">${esc(c.name)} · no email address</span><span class="st muted">skipped</span></div>`).join("")}</div>
    ${already.length ? `<label class="opt"><input type="checkbox" id="em-skip" checked><div><b>Skip the ${already.length} already emailed</b><span>Untick to send them a second message</span></div></label>` : ""}
    <div class="fields">
      <div class="field wide"><label>Subject</label><input id="em-subj" value="${esc(TPL.subject)}"></div>
      <div class="field"><label>Sign-off (replaces {sender})</label><input id="em-sender" value="${esc(TPL.sender || "")}" placeholder="Collins Odoh, General Supervisor"></div>
      ${kind === "interview" ? `<div class="field"><label>Interview date (replaces {date})</label><input id="em-date" value="${esc(TPL.date || "")}" placeholder="e.g. Thursday 30 October 2026"></div><div class="field"><label>Time (replaces {time})</label><input id="em-time" value="${esc(TPL.time || "")}" placeholder="e.g. 10:00 am"></div>` : ""}
      <div class="field"><label>&nbsp;</label><button class="btn small" id="em-save-tpl" ${S.me?.canEdit ? "" : "disabled"}>Save as default template</button></div>
      <div class="field wide tpl"><label>Message</label><textarea id="em-body">${esc(TPL.body)}</textarea><span class="hint">Placeholders: <code>{first}</code> <code>{name}</code> <code>{role}</code> <code>{sender}</code>${kind === "interview" ? ` <code>{date}</code> <code>{time}</code> <code>{portfolio}</code>` : ` <code>{form}</code>. The form link becomes a button automatically.`}</span></div>
    </div>
    <details><summary class="hint" style="cursor:pointer">Preview for ${esc(ok[0]?.name || "the first recipient")}</summary><div class="preview" id="em-prev"></div></details>
    <div id="em-prog" hidden><div class="prog"><i style="width:0%"></i></div><p class="hint" id="em-msg" style="margin:6px 0 0"></p></div>
    <div class="toolbar"><button class="btn primary" id="em-go" ${ok.length ? "" : "disabled"}>Send</button><button class="btn" id="em-cancel">Cancel</button></div>`;
  const prev = () => { TPL.sender = $("#em-sender").value; TPL.date = $("#em-date")?.value || TPL.date; TPL.time = $("#em-time")?.value || TPL.time; if (ok[0]) $("#em-prev").textContent = "Subject: " + fill($("#em-subj").value, ok[0]) + "\n\n" + fill($("#em-body").value, ok[0]); };
  prev(); for (const id of ["em-subj", "em-body", "em-sender", "em-date", "em-time"]) $("#" + id)?.addEventListener("input", prev);
  $("#em-scrim").hidden = false; $("#em-cancel").onclick = closeEmail;
  $("#em-save-tpl").onclick = async () => { const t = { subject: $("#em-subj").value, body: $("#em-body").value, sender: $("#em-sender").value, date: $("#em-date")?.value || "", time: $("#em-time")?.value || "" }; if (await write(S.db.doc(docId), t, "Template saved as default")) { TPL = { ...TPL, ...t }; TPLS[kind] = TPL; } };
  $("#em-go").onclick = () => sendBatch(ok.filter(c => !($("#em-skip")?.checked && (kind === "interview" ? c.interview?.invitedAt : c.lastEmailStatus === "sent"))), { subject: $("#em-subj").value, body: $("#em-body").value, sender: $("#em-sender").value, date: $("#em-date")?.value || "", time: $("#em-time")?.value || "" });
}
function closeEmail() { $("#em-scrim").hidden = true; }
async function sendBatch(list, t) {
  TPL = { ...TPL, ...t }; if (!list.length) { toast("Nobody to send to", "warn"); return; }
  const go = $("#em-go"), cancel = $("#em-cancel"); go.disabled = true; cancel.textContent = "Close"; $("#em-prog").hidden = false;
  let sent = 0, failed = 0, unknown = 0, stop = false;
  const setSt = (id, text, cls) => { const el = $(`#em-rcpts [data-r="${CSS.escape(id)}"] .st`); if (el) { el.textContent = text; el.className = "st " + cls; el.style.color = cls === "ok" ? "var(--ok)" : cls === "bad" ? "var(--bad)" : cls === "warn" ? "var(--warn)" : ""; } };
  const bar = $("#em-prog i"), msg = $("#em-msg");
  for (const [i, c] of list.entries()) {
    if (stop) { setSt(c.id, "not sent", "muted"); continue; }
    setSt(c.id, "sending…", ""); msg.textContent = `Sending ${i + 1} of ${list.length}: ${c.name}`;
    const subject = fill(t.subject, c), body = fill(t.body, c);
    let status, detail = "", messageId = null;
    try {
      const r = await sendViaFunction(c, subject, body);
      status = r.status; messageId = r.messageId || null; detail = r.error || "";
      if (status === "sent") { sent++; setSt(c.id, typeof r.remaining === "number" ? `sent ✓ (${r.remaining} left today)` : "sent ✓", "ok"); logAct("ok", `Email sent to ${c.name}`, `To: ${c.email}\nSubject: ${subject}\nMessage id: ${messageId || "not returned"}`); }
      else if (status === "unknown") { unknown++; setSt(c.id, "unknown: check the sender's log", "warn"); logAct("warn", `Email to ${c.name} unknown`, `To: ${c.email}\n${detail}`); }
      else { failed++; setSt(c.id, "failed", "bad"); logAct("bad", `Email to ${c.name} failed`, `To: ${c.email}\n${detail}`); }
    } catch (e) {
      const code = e?.code || "unknown"; status = "failed"; failed++; detail = MCP_HELP[code] || e?.message || code; setSt(c.id, "failed", "bad");
      if (MCP_HELP[code]) { stop = true; msg.textContent = MCP_HELP[code]; toast(MCP_HELP[code], "bad"); }
      logAct("bad", `Email to ${c.name} failed`, `To: ${c.email}\nSubject: ${subject}\nError: ${code}\n${detail}`);
    }
    // The server function records the result on the candidate; the page only refreshes its view.
    bar.style.width = Math.round((i + 1) / list.length * 100) + "%";
    if (!stop && i < list.length - 1) await new Promise(r => setTimeout(r, 1500 + Math.random() * 1500));
    continue;
  }
  const summary = `Emails: ${sent} sent${failed ? `, ${failed} failed` : ""}${unknown ? `, ${unknown} unknown` : ""}`;
  msg.textContent = summary + (unknown ? ". Check the sender's dashboard before resending the unknown ones." : "") + (stop ? "" : " You can close this window.");
  toast(summary, failed || unknown ? (sent ? "warn" : "bad") : "ok"); S.sel.clear(); render();
  if (!failed && !unknown && !stop) setTimeout(closeEmail, 2000);
}

/* ---------- role lifecycle: end, reopen, delete ---------- */
function roleStats(rid) { const comp = compute(), rs = byRole(rid); return { total: rs.length, contacted: rs.filter(c => c.status === "contacted").length, eligible: rs.filter(c => comp[c.id].eligible).length, invited: rs.filter(c => c.interview?.invitedAt).length, hired: rs.filter(c => c.interview?.outcome === "Hired").length, rejected: rs.filter(c => c.interview?.outcome === "Rejected").length, issues: Object.values(S.issues).filter(i => !i.resolved && rs.some(c => c.id === i.candidateId)).length }; }
function openRoleMenu(rid) {
  const r = roleOf(rid), st = roleStats(rid), closed = r.status === "closed", m = $("#dl-modal");
  m.innerHTML = `<h2 id="dl-title">${esc(r.name)}</h2>
    <div class="tiles"><div class="tile" style="cursor:default"><span class="label">Candidates</span><span class="value">${st.total}</span></div><div class="tile" style="cursor:default"><span class="label">Contacted</span><span class="value">${st.contacted}</span></div><div class="tile" style="cursor:default"><span class="label">Shortlisted</span><span class="value">${st.eligible}</span></div><div class="tile" style="cursor:default"><span class="label">Hired</span><span class="value">${st.hired}</span></div></div>
    <div class="hint">${closed ? `Recruitment ended ${esc(fmtDate(r.closedAt))}. The role sits on the History page; its candidates stay in the database and in every download.` : `Source: ${esc(r.source || "register")}${r.createdAt ? " · created " + esc(fmtDate(r.createdAt)) : ""}.`}</div>
    <div class="opts">
      ${closed ? `<button class="opt" id="rm-reopen" style="text-align:left"><div><b>Reopen recruitment</b><span>Brings the role back to Candidates, the dashboard and the interview list.</span></div></button>`
               : `<button class="opt" id="rm-close" style="text-align:left"><div><b>End recruitment</b><span>Keeps everything, records today's numbers, and moves the role to History. Nothing is deleted; you can reopen later.</span></div></button>`}
      <button class="opt" id="rm-delete" style="text-align:left"><div><b style="color:var(--bad)">Delete role</b><span>Hides the role, all ${st.total} candidates, their call history and ${st.issues} open issue${st.issues === 1 ? "" : "s"} from everyone. A Group Admin can restore them from Recently deleted.</span></div></button>
    </div>
    <div id="rm-confirm"></div>
    <div class="toolbar"><button class="btn" id="rm-dl">Download this role</button><button class="btn" id="rm-cancel" style="margin-left:auto">Close</button></div>`;
  $("#dl-scrim").hidden = false; $("#rm-cancel").onclick = closeDownload; $("#dl-scrim").onclick = e => { if (e.target === $("#dl-scrim")) closeDownload(); };
  $("#rm-dl").onclick = () => openDownload({ kind: "role", role: rid });
  $("#rm-close")?.addEventListener("click", async () => { const doc = { ...r, status: "closed", closedAt: new Date().toISOString(), closedBy: S.me?.id || null, finalStats: st }; delete doc.id; if (await write(S.db.doc("roles/" + rid), doc, `${r.name}: recruitment ended`)) { closeDownload(); S.role = null; setView("history"); } });
  $("#rm-reopen")?.addEventListener("click", async () => { const doc = { ...r, status: "open", reopenedAt: new Date().toISOString() }; delete doc.id; delete doc.closedAt; delete doc.closedBy; if (await write(S.db.doc("roles/" + rid), doc, `${r.name} reopened`)) { closeDownload(); setView("candidates", { role: rid, filters: {} }); } });
  $("#rm-delete").addEventListener("click", () => {
    $("#rm-confirm").innerHTML = `<div class="confirm"><b>Type the role name to confirm deletion</b><input id="rm-typed" placeholder="${esc(r.name)}" style="padding:8px 10px;border:1px solid var(--line-2);border-radius:8px"><div class="toolbar"><button class="btn small danger" id="rm-yes" disabled>Delete ${st.total} candidates and the role</button><button class="btn small" id="rm-no">Keep</button></div><div class="prog" id="rm-prog" hidden><i style="width:0%"></i></div></div>`;
    $("#rm-typed").addEventListener("input", e => { $("#rm-yes").disabled = e.target.value.trim().toLowerCase() !== r.name.trim().toLowerCase(); });
    $("#rm-no").onclick = () => { $("#rm-confirm").innerHTML = ""; };
    $("#rm-yes").onclick = () => deleteRole(rid);
  });
}
async function deleteRole(rid) {
  const r = roleOf(rid), cs = byRole(rid);
  $("#rm-prog").hidden = false; $("#rm-yes").disabled = true; $("#rm-no").disabled = true; $("#rm-prog i").style.width = "50%";
  const res = await FR.softDelete("roles", rid);   // the server takes the role's candidates and issues with it, in one step
  $("#rm-prog i").style.width = "100%";
  if (!res.ok) { toast("Not deleted: " + res.error, "bad"); $("#rm-yes").disabled = false; $("#rm-no").disabled = false; return; }
  const ch = res.deletion?.children || {};
  toast(`${r.name} deleted with ${ch.candidates || 0} candidates and ${ch.issues || 0} issues. A Group Admin can restore it.`, "warn");
  logAct("warn", `Role deleted: ${r.name}`, `${ch.candidates || cs.length} candidates, ${ch.issues || 0} issues · restorable from Recently deleted`);
  closeDownload(); S.role = null; setView("candidates");
}
function renderHistory(comp) {
  const el = $("#v-history"); const closed = allRoleIds().filter(r => roleOf(r).status === "closed");
  if (!closed.length) { el.innerHTML = `<div class="empty"><h2>No recruitment has ended yet</h2><p>When a role is filled or the exercise is over, open its menu on the Candidates page (⋯ next to the role chips) and choose "End recruitment". It moves here with its final numbers, and everything stays downloadable.</p></div>`; return; }
  el.innerHTML = closed.map(rid => { const r = roleOf(rid), st = r.finalStats || roleStats(rid), hiredList = byRole(rid).filter(c => c.interview?.outcome === "Hired");
    return `<div class="card"><h2>${esc(r.name)} <small>ended ${esc(fmtDate(r.closedAt))}${r.createdAt ? " · opened " + esc(fmtDate(r.createdAt)) : ""}</small></h2>
      <div class="tiles" style="margin-bottom:12px">${[["Candidates", st.total], ["Contacted", st.contacted], ["Shortlisted", st.eligible], ["Invited", st.invited || 0], ["Hired", st.hired || 0], ["Rejected", st.rejected || 0]].map(([l, v]) => `<div class="tile" style="cursor:default"><span class="label">${l}</span><span class="value">${v}</span></div>`).join("")}</div>
      ${hiredList.length ? `<div class="hint" style="margin-bottom:10px"><b>Hired:</b> ${hiredList.map(c => `<span class="pill ok flat" data-id="${c.id}" style="cursor:pointer">${esc(c.name)}</span>`).join(" ")}</div>` : ""}
      <div class="toolbar"><button class="btn small" data-hist-view="${esc(rid)}">View candidates</button><button class="btn small" data-hist-dl="${esc(rid)}" ${DL ? "" : "hidden"}>Download</button>${ro() ? "" : `<button class="btn small" data-hist-menu="${esc(rid)}">Reopen or delete</button>`}</div></div>`; }).join("");
  el.onclick = e => { const v = e.target.closest("[data-hist-view]"); if (v) { S.role = v.dataset.histView; setView("candidates", { role: v.dataset.histView, filters: {} }); return; } const d = e.target.closest("[data-hist-dl]"); if (d) { openDownload({ kind: "role", role: d.dataset.histDl }); return; } const m = e.target.closest("[data-hist-menu]"); if (m) { openRoleMenu(m.dataset.histMenu); return; } const c = e.target.closest("[data-id]"); if (c) openDrawer(c.dataset.id); };
}

/* ---------- add / remove a candidate ---------- */
const nextSn = rid => byRole(rid).reduce((m, c) => Math.max(m, Number(c.sn) || 0), 0) + 1;
const candId = (rid, sn) => `${rid}-${String(sn).padStart(3, "0")}`;
function showDrawer() { FR.drawer.show(); $("#close").onclick = closeDrawer; $("#scrim").onclick = closeDrawer; }
function openAddDrawer(rid) {
  if (!rid || ro()) return; S.open = "new";
  const sel = (idn, opts, val) => `<select id="${idn}">${opts.map(x => `<option ${x === val ? "selected" : ""}>${x}</option>`).join("")}</select>`;
  $("#drawer").innerHTML = `<header><div><h2>Add a candidate</h2><div class="muted" style="margin-top:4px">${esc(roleName(rid))} · will be #${nextSn(rid)} in the register</div></div><button class="x" id="close" aria-label="Close">×</button></header>
  <div class="body">
    <div class="banner info">For someone who applied outside Jobberman, or was missed in the export. Location is guessed from the address and should be confirmed on the call.</div>
    <div class="fields">
      <div class="field wide"><label>Full name (required)</label><input id="a-name" autocomplete="off"></div>
      <div class="field"><label>Phone</label><input id="a-phone" inputmode="tel" placeholder="080…"></div>
      <div class="field"><label>Email</label><input id="a-email" type="email"></div>
      <div class="field wide"><label>Address</label><input id="a-addr" placeholder="Street, area, city, state"></div>
      <div class="field"><label>Qualification</label>${sel("a-qual", QUALS, "Unknown")}</div>
      <div class="field"><label>Location</label>${sel("a-loc", LOCS, "Unknown")}</div>
      <div class="field"><label>State</label><select id="a-state"><option value="">—</option>${STATES.map(s => `<option>${s}</option>`).join("")}</select></div>
      <div class="field"><label>Role</label><select id="a-role">${roleIds().map(r => `<option value="${esc(r)}" ${r === rid ? "selected" : ""}>${esc(roleName(r))}</option>`).join("")}</select></div>
      <div class="field wide"><label>Notes</label><textarea id="a-notes" placeholder="Where they came from, anything said so far"></textarea></div>
    </div></div>
  <footer><button class="btn primary" id="a-save">Add candidate</button><button class="btn" id="a-cancel">Cancel</button></footer>`;
  showDrawer(); $("#a-cancel").onclick = closeDrawer; setTimeout(() => $("#a-name").focus(), 250);
  $("#a-addr").addEventListener("input", e => { const [l, s] = classify(e.target.value); $("#a-loc").value = l; if (s) $("#a-state").value = s; });
  $("#a-save").addEventListener("click", async () => {
    const v = id => $("#" + id).value.trim(); const name = v("a-name"); if (!name) { toast("A name is required"); $("#a-name").focus(); return; }
    const role = v("a-role"); let sn = nextSn(role);
    { const { data: top } = await FR.SB.from("candidates").select("sn").eq("role", role).order("sn", { ascending: false }).limit(1); if (top?.[0]) sn = Math.max(sn, Number(top[0].sn) + 1); }   // Group Admins also see deleted rows, so a deleted serial is never reused let phone = v("a-phone").replace(/[^\d+]/g, ""); if (/^\d{10}$/.test(phone)) phone = "0" + phone; if (phone.startsWith("+234")) phone = "0" + phone.slice(4); else if (phone.startsWith("234")) phone = "0" + phone.slice(3);
    const dup = Object.values(S.cands).find(c => phone && c.phone === phone); if (dup && !$("#a-save").dataset.ok) { toast(`That number already belongs to ${dup.name}. Press again to add anyway.`); $("#a-save").dataset.ok = "1"; return; }
    const body = { role, sn, name, phone, email: v("a-email"), address: v("a-addr"), qualification: v("a-qual"), location: v("a-loc"), state: v("a-state"), status: "pending", attempts: 0, mode: "", availability: "", relocation: "", manual: "", adjust: 0, notes: v("a-notes"), portfolio: "", nextAction: "", lastContact: new Date().toISOString(), lastBy: S.me?.id || null, addedBy: S.me?.id || null, addedManually: true, history: [{ ts: new Date().toISOString(), by: S.me?.id || null, summary: "Added manually" }] };
    if (await write(S.db.doc("candidates/" + candId(role, sn)), body, `${name} added to ${roleName(role)}`)) { closeDrawer(); if (S.view === "candidates") { S.role = role; } }
  });
}
async function removeCandidate(c) {
  const res = await FR.softDelete("candidates", c.id);   // linked issues go with the candidate
  if (!res.ok) { toast("Could not remove: " + res.error, "bad"); return; }
  toast(`${c.name} removed. A Group Admin can restore them.`, "warn"); closeDrawer();
}

/* ---------- drawer ---------- */
function openDrawer(id) {
  const c = S.cands[id]; if (!c) return;
  S.open = id;
  const o = compute()[id], locked = ro(), rl = roleOf(c.role);
  const sel = (idn, opts, val, blank = "—") => `<select id="${idn}" ${locked ? "disabled" : ""}>${blank !== null ? `<option value="">${blank}</option>` : ""}${opts.map(x => `<option ${x === val ? "selected" : ""}>${x}</option>`).join("")}</select>`;
  const hist = (c.history || []).slice().reverse(); const names = [...new Set(hist.map(h => h.by).filter(Boolean))];
  const first = c.name.split(" ")[0];
  const wa = waHref(c);
  $("#drawer").innerHTML = `<header><div><h2>${esc(c.name)}</h2><div class="muted" style="margin-top:4px">${esc(rl.name)} · #${c.sn} in register · ${pillTier(o.tier)} ${flagged(id) ? `<span class="pill bad flat">has open issue</span>` : ""}</div></div><button class="x" id="close" aria-label="Close">×</button></header>
  <div class="body">
    ${locked ? `<div class="banner warn">You have view-only access. Ask the owner for Contributor or Editor access to log calls.</div>` : ""}
    <div class="phone-row" title="Phone copies the number for your dialler; WhatsApp and Gmail open directly."><span class="num">${esc(c.phone || "No phone number")}</span>
      <button class="btn ibtn call" id="callbtn" title="Copy number for dialling" aria-label="Call" ${c.phone ? "" : "disabled"}><svg viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.9 2z"/></svg></button>
      <a class="btn ibtn wa" href="${wa}" target="_blank" rel="noopener" title="Open WhatsApp chat" aria-label="WhatsApp" ${c.phone ? "" : 'aria-disabled="true"'}><svg viewBox="0 0 24 24"><path d="M3 21l1.6-4.7A8.9 8.9 0 1 1 7.9 19.5L3 21z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1.2-1.2-1.7-1-1 .8c-1-.4-1.8-1.2-2.2-2.2l.8-1-1-1.7L9 9.5z"/></svg></a>
      <a class="btn ibtn mail" id="mailbtn" href="https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(c.email || "")}&su=${encodeURIComponent("Your Jobberman application: " + rl.name + " at Future Ready Nigeria")}&body=${encodeURIComponent(`Good day ${first},\n\nThank you for applying for the ${rl.name} role at Future Ready Nigeria Ltd through Jobberman. Could you confirm two things for us:\n1. How soon you could resume if selected.\n2. Where you currently live, and whether you can work from our office at Udeorji Street, Obiagu, Enugu.\n\nKind regards,\nFuture Ready Nigeria Ltd`)}" target="_blank" rel="noopener" title="Email ${esc(c.email)} (opens Gmail; address is also copied)" aria-label="Email" ${c.email ? "" : 'aria-disabled="true"'}><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg></a>
      <button class="btn ibtn" id="copy" title="Copy phone number" aria-label="Copy number" ${c.phone ? "" : "disabled"}><svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button></div>
    ${c.selfReported ? `<div class="banner info">Answered the follow-up form${c.formResponseAt ? " on " + fmtDate(c.formResponseAt) : ""}. Availability, location and relocation below came from the candidate; confirm them if anything looks off, then save.</div>` : ""}
    <dl class="kv"><dt>Email</dt><dd>${esc(c.email || "—")}</dd><dt>Address</dt><dd>${esc(c.address || "Not given in register")}</dd><dt>Score</dt><dd class="num">${o.pre} pre-call · ${o.final} final · rank ${o.rank} of ${byRole(c.role).length}${o.combined ? ` · #${o.combined} for second interview` : ""}</dd></dl>
    <div class="field"><label>Status</label><div class="seg" id="status">${[["pending", "Not contacted"], ["awaiting", "Awaiting reply"], ["attempted", "No answer"], ["contacted", "Contacted"]].map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${effStatus(c) === v}" ${locked ? "disabled" : ""}>${l}</button>`).join("")}</div></div>
    <div class="fields">
      <div class="field"><label>Mode</label>${sel("f-mode", ["Call", "WhatsApp", "Email", "Form"], c.mode)}</div>
      <div class="field"><label>Availability</label>${sel("f-avail", AVAIL, c.availability)}</div>
      <div class="field"><label>Location</label>${sel("f-loc", LOCS, c.location || "Unknown", null)}</div>
      <div class="field"><label>State</label>${sel("f-state", STATES, c.state)}</div>
      <div class="field"><label>Can relocate to Enugu?</label>${sel("f-relo", ["Yes", "No", "N/A"], c.relocation)}</div>
      <div class="field"><label>Qualification</label>${sel("f-qual", QUALS, c.qualification, null)}</div>
      <div class="field"><label>Shortlist override</label>${sel("f-manual", ["Yes", "No"], c.manual, "Automatic")}</div>
      <div class="field"><label>Adjust points</label><input type="number" id="f-adjust" value="${Number(c.adjust) || 0}" ${locked ? "disabled" : ""}></div>
      <div class="field wide"><label>Portfolio or CV link</label><input type="url" id="f-portfolio" value="${esc(c.portfolio || "")}" placeholder="https://" ${locked ? "disabled" : ""}></div>
      <div class="field"><label>Next action date</label><input type="date" id="f-next" value="${esc(c.nextAction || "")}" ${locked ? "disabled" : ""}></div>
      <div class="field wide"><label>Notes</label><textarea id="f-notes" ${locked ? "disabled" : ""}>${esc(c.notes || "")}</textarea></div>
    </div>
    ${o.eligible || c.interview ? `<div class="card" style="padding:14px;background:var(--accent-soft);border-color:var(--accent-line)"><h3 style="margin-bottom:8px">Interview${c.interview?.invitedAt ? ` <span class="pill accent flat">invited ${esc(fmtDate(c.interview.invitedAt))}</span>` : ""}</h3>
      <div class="fields">
        <div class="field"><label>Date</label><input type="date" id="i-date" value="${esc(c.interview?.date || "")}" ${locked ? "disabled" : ""}></div>
        <div class="field"><label>Time</label><input type="time" id="i-time" value="${esc(c.interview?.time || "")}" ${locked ? "disabled" : ""}></div>
        <div class="field"><label>Outcome</label>${sel("i-outcome", ["Pending", "Hired", "Rejected", "On hold"], c.interview?.outcome || "", "Not set")}</div>
        <div class="field"><label>Score (optional, 1–10)</label><input type="number" min="1" max="10" id="i-score" value="${esc(c.interview?.score ?? "")}" ${locked ? "disabled" : ""}></div>
        <div class="field wide"><label>Interview notes</label><textarea id="i-notes" ${locked ? "disabled" : ""}>${esc(c.interview?.notes || "")}</textarea></div>
      </div></div>` : ""}
    ${FR.modules.people && c.interview?.outcome === "Hired" ? `<div class="banner ok" style="justify-content:space-between;flex-wrap:wrap"><span>Hired. Create their staff record in People, prefilled from this application.</span><button class="btn small primary" id="to-staff">Add to staff</button></div>` : ""}
    <div><h3 style="margin-bottom:6px">History</h3><ul class="history" id="hist">${hist.map(h => `<li><time>${fmtDate(h.ts)}</time><span>${esc(h.summary)} <span class="muted" data-by="${esc(h.by || "")}"></span></span></li>`).join("") || `<li class="muted">No calls logged yet.</li>`}</ul></div>
    ${c.emailedAt || c.lastEmailStatus ? `<div class="banner ${c.lastEmailStatus === "sent" ? (c.status === "contacted" ? "ok" : "info") : c.lastEmailStatus === "unknown" ? "warn" : "bad"}" style="flex-wrap:wrap">${c.lastEmailStatus === "sent" ? (c.status === "contacted" ? "Outreach email sent " + fmtDate(c.emailedAt) + ". Reply recorded." : "Outreach email sent " + fmtDate(c.emailedAt) + ". Awaiting their reply; the record updates on its own when they answer the form.") : c.lastEmailStatus === "unknown" ? "Last email: outcome unknown. Check your Gmail Sent folder before resending." : "Last email failed: " + esc(c.lastEmailError || "")}${(c.outreach || []).length > 1 ? ` · ${(c.outreach || []).length} attempts` : ""}${c.lastEmailStatus === "sent" && c.status !== "contacted" && !locked ? `<button class="btn small" id="rec-reply" style="margin-left:auto">Record their reply manually</button>` : ""}</div>` : ""}
    <div class="toolbar">${locked ? "" : `<button class="btn small" id="em-one" ${c.email ? "" : "disabled"} title="${c.email ? "Send the outreach email to " + esc(c.email) : "No email address"}">Email outreach</button>`}${DL ? `<button class="btn small" id="dl-one">Download this profile</button>` : ""}${locked ? "" : `<span id="rm-box" style="margin-left:auto"><button class="btn small danger" id="rm">Remove from ${esc(rl.name)}</button></span>`}</div>
  </div>
  <footer>${locked ? `<span class="muted">Read only</span>` : `<button class="btn primary" id="save">Save</button><button class="btn" id="noanswer">Log no answer</button>`}<span class="muted" style="margin-left:auto;font-size:12px">${c.lastContact ? "Last update " + fmtDate(c.lastContact) : ""}</span></footer>`;
  showDrawer();
  $("#to-staff")?.addEventListener("click", () => { closeDrawer(); FR.modules.people.fromCandidate(c, rl.name); });
  $("#dl-one")?.addEventListener("click", () => openDownload({ kind: "candidate", id }));
  $("#em-one")?.addEventListener("click", () => openEmail([id]));
  $("#rec-reply")?.addEventListener("click", () => { for (const x of $("#status").children) x.setAttribute("aria-pressed", x.dataset.v === "contacted"); $("#f-mode").value = "Email"; $("#f-avail").focus(); toast("Set their availability and location, then Save", "warn"); });
  $("#rm")?.addEventListener("click", () => {
    const n = Object.values(S.issues).filter(i => i.candidateId === c.id).length;
    $("#rm-box").innerHTML = `<div class="confirm"><b>Remove ${esc(c.name)}?</b><span>This hides the record, its call history${n ? ` and ${n} linked data issue${n === 1 ? "" : "s"}` : ""} from everyone, and from the next hourly Google Sheet refresh. A Group Admin can restore it from Recently deleted.</span><div class="toolbar"><button class="btn small danger" id="rm-yes">Yes, remove</button><button class="btn small" id="rm-no">Keep</button></div></div>`;
    $("#rm-yes").onclick = () => removeCandidate(c); $("#rm-no").onclick = () => { $("#rm-box").innerHTML = `<button class="btn small danger" id="rm">Remove from ${esc(rl.name)}</button>`; $("#rm").onclick = () => openDrawer(id); };
  });
  const copyNum = async (msg) => { try { await navigator.clipboard.writeText(c.phone); toast(msg); } catch { const r = document.createRange(); r.selectNodeContents($(".phone-row .num")); getSelection().removeAllRanges(); getSelection().addRange(r); toast("Select and copy the number"); } };
  $("#copy")?.addEventListener("click", () => copyNum("Number copied"));
  $("#callbtn")?.addEventListener("click", () => copyNum(`${c.phone} copied. Paste it into your phone app to call. WhatsApp opens directly.`));
  $("#mailbtn")?.addEventListener("click", async () => { try { await navigator.clipboard.writeText(c.email); toast("Gmail opening in a new tab. Address copied in case you use another mail app."); } catch {} });
  $("#status").onclick = e => { const b = e.target.closest("button"); if (!b || locked) return; for (const x of $("#status").children) x.setAttribute("aria-pressed", x === b); };
  $("#save")?.addEventListener("click", () => saveDrawer(c));
  $("#noanswer")?.addEventListener("click", () => saveDrawer(c, true));
  resolveNames(names);
}
function closeDrawer() { S.open = null; FR.drawer.hide(); }
async function saveDrawer(c, noAnswer = false) {
  const v = id => $("#" + id)?.value ?? "";
  const status = noAnswer ? "attempted" : [...$("#status").children].find(b => b.getAttribute("aria-pressed") === "true")?.dataset.v || "pending";
  const now = new Date().toISOString();
  const body = { ...c, status, mode: v("f-mode"), availability: v("f-avail"), location: v("f-loc") || "Unknown", state: v("f-state"), relocation: v("f-relo"), qualification: v("f-qual"), manual: v("f-manual"), adjust: Number(v("f-adjust")) || 0, notes: v("f-notes").trim(), nextAction: v("f-next"), portfolio: v("f-portfolio").trim(), lastContact: now, lastBy: S.me?.id || null };
  delete body.id;
  if (noAnswer) body.attempts = (Number(c.attempts) || 0) + 1;
  const changes = [];
  if ($("#i-outcome")) { const iv = { ...(c.interview || {}), date: v("i-date"), time: v("i-time"), outcome: v("i-outcome"), score: v("i-score") === "" ? null : Number(v("i-score")), notes: v("i-notes").trim() };
    const old = c.interview || {}; for (const [k, l] of [["date", "Interview date"], ["time", "Interview time"], ["outcome", "Interview outcome"], ["notes", "Interview notes"]]) if ((iv[k] || "") !== (old[k] || "")) changes.push(`${l}: ${k === "notes" ? "updated" : iv[k] || "cleared"}`);
    if ((iv.score ?? "") !== (old.score ?? "")) changes.push(`Interview score: ${iv.score ?? "cleared"}`);
    body.interview = iv; }
  if (status !== effStatus(c)) changes.push(noAnswer ? `No answer (attempt ${body.attempts})` : status === "contacted" ? `Contacted by ${body.mode || "call"}` : status === "awaiting" ? "Status: awaiting reply" : "Status: not contacted"); else if (noAnswer) changes.push(`No answer (attempt ${body.attempts})`);
  for (const [k, l] of [["availability", "Availability"], ["location", "Location"], ["relocation", "Relocation"], ["manual", "Shortlist"], ["nextAction", "Next action"], ["portfolio", "Portfolio"], ["qualification", "Qualification"]]) if ((body[k] || "") !== (c[k] || "")) changes.push(`${l}: ${body[k] || "cleared"}`);
  if (body.notes !== (c.notes || "")) changes.push("Notes updated");
  if ((body.adjust || 0) !== (c.adjust || 0)) changes.push(`Adjust: ${body.adjust}`);
  if (!changes.length && !noAnswer) { toast("Nothing changed"); return; }
  body.history = [...(c.history || []), { ts: now, by: S.me?.id || null, summary: changes.join(" · ") }].slice(-50);
  if (await write(S.db.doc("candidates/" + c.id), body, "Saved")) closeDrawer();
}
/* ---------- module registration ---------- */
const VIEW_DEFS = [
  { id: "dashboard", title: "Dashboard", sub: "Live picture of the screening", icon: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>' },
  { id: "candidates", title: "Candidates", sub: "Pick a role, then tap a row to log a call", count: true, icon: '<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></svg>' , primary: { label: "Add candidate", run: () => openAddDrawer(S.role), can: () => !ro() && !!S.role && !!S.loaded }},
  { id: "interview", title: "Second Interview", nav: "Interview", sub: "Candidates who met the criteria, best first", count: true, icon: '<svg viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>' },
  { id: "issues", title: "Data issues", nav: "Issues", sub: "Register problems to resolve before trusting a record", count: true, icon: '<svg viewBox="0 0 24 24"><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>' },
  { id: "import", title: "Import a role", nav: "Import", sub: "Upload the Jobberman applicant export for a new role", icon: '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>' },
  { id: "history", title: "History", sub: "Roles whose recruitment has ended, with their final numbers", count: true, icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>' },
];
// Company-scoped views of the data the database let us read.
function scope() {
  const cid = S.company;
  S.roles = {}; for (const [id, r] of Object.entries(S.all.roles)) if ((r.companyId || "group") === cid) S.roles[id] = r;
  S.cands = {}; for (const [id, c] of Object.entries(S.all.cands)) if ((c.companyId || S.all.roles[c.role]?.companyId || "group") === cid) S.cands[id] = c;
  S.issues = {}; for (const [id, i] of Object.entries(S.all.issues)) if ((i.companyId || S.all.cands[i.candidateId]?.companyId || "group") === cid) S.issues[id] = i;
  if (S.role && !S.roles[S.role]) S.role = null;
}
let started = false;
FR.registerModule({
  id: "hiring", name: "Hiring", views: VIEW_DEFS, icon: '<svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>',
  start() {
    if (started) return; started = true;
    S.db.doc("settings/scoring").onSnapshot(s => { if (s.exists) { const d = s.data(); S.settings = { ...DEFAULT_SETTINGS, location: d.location || DEFAULT_SETTINGS.location, qualification: d.qualification || DEFAULT_SETTINGS.qualification, availability: d.availability || DEFAULT_SETTINGS.availability, relocation: d.relocation ?? 10 }; } render(); }, () => {});
    S.db.collection("roles").onSnapshot(s => { S.all.roles = {}; for (const d of s.docs) S.all.roles[d.id] = { id: d.id, ...d.data() }; scope(); render(); }, () => {});
    S.db.collection("candidates").onSnapshot(s => { S.all.cands = {}; for (const d of s.docs) S.all.cands[d.id] = { id: d.id, ...d.data() }; S.loaded = true; scope(); setSync(true, "live"); render(); FR.attentionChanged?.(); if (S.open && S.open !== "new" && !S.cands[S.open]) closeDrawer(); }, e => { setSync(false, "disconnected"); notice("bad", "Could not load candidates (" + (e.message || e.code) + "). Reload the page."); });
    S.db.collection("issues").onSnapshot(s => { S.all.issues = {}; for (const d of s.docs) S.all.issues[d.id] = { id: d.id, ...d.data() }; scope(); render(); }, () => {});
    setupExport();
  },
  onCompany() { S.role = null; S.sel.clear(); S.imp = null; if (S.open) closeDrawer(); scope(); render(); },
  render, headerDownload: true, closeDrawer, closeDownload,
  ready: () => !!S.loaded,
  // Home: the calls and fixes waiting, most urgent first
  attention() {
    if (!S.loaded) return [];
    const comp = compute(), all = Object.values(S.cands), today = new Date().toISOString().slice(0, 10);
    const open = c => () => { setView("candidates", { role: c.role, filters: {} }); openDrawer(c.id); };
    const due = all.filter(c => c.nextAction && c.nextAction <= today && c.status !== "contacted").sort((a, b) => a.nextAction.localeCompare(b.nextAction));
    const late = due.filter(c => c.nextAction < today);
    const pending = all.filter(c => effStatus(c) === "pending").sort((a, b) => comp[a.id].rank - comp[b.id].rank);
    const issues = Object.values(S.issues).filter(i => !i.resolved);
    const toBook = all.filter(c => comp[c.id].eligible && !(c.interview || {}).date && !(c.interview || {}).outcome);
    return [
      { id: "followups", level: late.length ? "bad" : "warn", label: "Call-backs due", count: due.length, hint: late.length ? `${late.length} overdue` : "due today", go: () => setView("candidates", { filters: {} }), items: due.slice(0, 5).map(c => ({ title: c.name, meta: `${roleName(c.role)} · call back ${c.nextAction}${c.phone ? " · " + c.phone : ""}`, go: open(c) })) },
      { id: "book", level: "warn", label: "Interviews to book", count: toBook.length, hint: "meet the criteria, no date yet", go: () => setView("interview"), items: toBook.slice(0, 3).map(c => ({ title: c.name, meta: `${roleName(c.role)} · ${c.availability || ""}`, go: () => setView("interview") })) },
      { id: "issues", level: "warn", label: "Data issues", count: issues.length, hint: "records to check", go: () => setView("issues"), items: [] },
      { id: "pending", level: "info", label: "Not yet contacted", count: pending.length, hint: "candidates waiting for a first call", go: () => setView("candidates", { filters: { status: "pending" } }), items: pending.slice(0, 3).map(c => ({ title: c.name, meta: `${roleName(c.role)} · rank ${comp[c.id].rank}`, go: open(c) })) },
    ];
  },
  search(q) {
    q = q.toLowerCase(); const digits = q.replace(/\D/g, "");
    return Object.values(S.cands).filter(c => (c.name || "").toLowerCase().includes(q) || (c.email || "").toLowerCase().includes(q) || (digits.length >= 4 && String(c.phone || "").replace(/\D/g, "").includes(digits)))
      .slice(0, 8).map(c => ({ title: c.name, meta: `Candidate · ${roleName(c.role)}${c.phone ? " · " + c.phone : ""}`, go: () => { setView("candidates", { role: c.role, filters: {} }); openDrawer(c.id); } }));
  },
  async markHired(candidateId, staffId) {
    const c = S.all.cands[candidateId]; if (!c) return;
    const body = { ...c, interview: { ...(c.interview || {}), outcome: "Hired", staffId: staffId || null }, history: [...(c.history || []), { ts: new Date().toISOString(), by: S.me?.id || null, summary: "Added to staff (People)" }].slice(-50) };
    delete body.id; try { await S.db.doc("candidates/" + candidateId).set(body); } catch (e) { logAct("warn", "Could not note the hire on the candidate", e.message || ""); }
  },
});
$("#em-scrim").addEventListener("click", e => { if (e.target === $("#em-scrim") && $("#em-go") && !$("#em-go").disabled) closeEmail(); });
})();
