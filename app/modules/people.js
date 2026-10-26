/* Future Ready Group System — People module: staff directory, documents, leave.
   Tables: staff, staff_documents, leave_requests (snake_case used directly). Scoped to the active company (S.company). */
(() => {
const FR = window.FR, S = FR.S;
const { $, esc, toast, logAct, notice, setCount, when, callFunction } = FR;
const SB = () => FR.SB;
const me = () => (S.me?.email || "").toLowerCase();
const canManage = () => ["admin", "manager"].includes(FR.roleIn(S.company));
const TYPE = { full_time: "Full-time", part_time: "Part-time", contract: "Contract", intern: "Intern", volunteer: "Volunteer" };
const KIND = { annual: "Annual leave", sick: "Sick leave", casual: "Casual leave", maternity: "Maternity", paternity: "Paternity", unpaid: "Unpaid leave", other: "Other" };
const DOC_KIND = { id: "ID document", contract: "Contract", certificate: "Certificate", offer: "Offer letter", other: "Other" };
const today = () => new Date().toISOString().slice(0, 10);
const P = { all: { staff: [], docs: [], leave: [] }, staff: [], docs: [], leave: [], open: null, tab: "details", q: "", status: "", started: false };

/* ---------- data ---------- */
function scope() {
  const cid = S.company;
  P.staff = P.all.staff.filter(s => s.company_id === cid || (s.companies || []).includes(cid));
  P.leave = P.all.leave.filter(l => l.company_id === cid);
  P.docs = P.all.docs.filter(d => d.company_id === cid);
  if (P.open && P.open !== "new" && !P.staff.find(s => s.id === P.open)) { P.open = null; closeDrawer(); }
}
async function load(what = ["staff", "docs", "leave"]) {
  const jobs = [];
  if (what.includes("staff")) jobs.push(SB().from("staff").select("*").is("deleted_at", null).order("full_name").then(({ data, error }) => { if (error) { notice("bad", "Could not load staff: " + error.message); return; } P.all.staff = data || []; }));
  if (what.includes("docs")) jobs.push(SB().from("staff_documents").select("*").is("deleted_at", null).order("uploaded_at", { ascending: false }).then(({ data }) => { P.all.docs = data || []; }));
  if (what.includes("staff")) jobs.push(SB().from("staff_private").select("*").then(({ data }) => { P.all.priv = {}; for (const r of data || []) P.all.priv[r.id] = r; }));   // only rows this person may see
  if (what.includes("leave")) {
    jobs.push(SB().from("leave_requests").select("*").is("deleted_at", null).order("start_date", { ascending: false }).then(({ data }) => { P.all.leave = data || []; }));   // managers: all; others: their own
    jobs.push(SB().rpc("leave_calendar", { p_company: S.company }).then(({ data }) => { P.cal = data || []; }));   // approved leave, names and dates only
  }
  await Promise.all(jobs); P.loaded = true; scope(); render(); FR.attentionChanged?.(); if (S.module === "people") FR.paintPrimary?.();
  if (P.open && P.open !== "new" && !$("#drawer").classList.contains("open")) P.open = null;
  else if (P.open) paintDrawer();
}
// approved leave: managers read it from leave_requests; everyone else from leave_calendar (no type or reason)
const approvedLeave = () => canManage() ? P.leave.filter(l => l.status === "approved") : (P.cal || []);
const onLeaveToday = s => approvedLeave().some(l => l.staff_id === s.id && l.start_date <= today() && l.end_date >= today());
const leaveUntil = s => (approvedLeave().filter(l => l.staff_id === s.id && l.start_date <= today() && l.end_date >= today())[0] || {}).end_date;
const statusPill = s => s.status === "left" ? `<span class="pill bad flat">Left${s.end_date ? " " + when(s.end_date) : ""}</span>` : onLeaveToday(s) ? `<span class="pill warn flat">On leave until ${when(leaveUntil(s))}</span>` : `<span class="pill ok flat">Active</span>`;
const myStaff = () => P.all.staff.find(s => (s.member_email || "").toLowerCase() === me());
const pendingToDecide = () => canManage() ? P.leave.filter(l => l.status === "pending") : [];

/* ---------- views ---------- */
function render() {
  if (!S.me) return;
  setCount("staff", P.staff.filter(s => s.status === "active").length);
  const pend = pendingToDecide().length || P.leave.filter(l => l.status === "pending" && l.staff_id === myStaff()?.id).length;
  const c = $("#cnt-leave"); if (c) { c.textContent = pend; c.hidden = !pend; }
  if (S.module !== "people") return;
  if (S.view === "staff") renderStaff();
  if (S.view === "leave") renderLeave();
}
function renderStaff() {
  const el = $("#v-staff"); const year = today().slice(0, 4);
  const active = P.staff.filter(s => s.status === "active"), away = active.filter(onLeaveToday), joined = P.staff.filter(s => (s.start_date || "").startsWith(year)), left = P.staff.filter(s => s.status === "left");
  const q = P.q.toLowerCase();
  let list = P.staff.filter(s => !P.status ? s.status === "active" : P.status === "away" ? onLeaveToday(s) : s.status === P.status);
  if (q) list = list.filter(s => [s.full_name, s.position, s.department, s.phone, s.email].join(" ").toLowerCase().includes(q));
  el.innerHTML = `
    <div class="stat-row" role="group" aria-label="Show">
      <button type="button" class="stat" data-f="" aria-pressed="${!P.status}"><span class="stat-label">Active staff</span><span class="stat-value">${active.length}</span><span class="stat-hint">in ${esc(FR.companyShort(S.company))}${joined.length ? ` · ${joined.length} joined ${year}` : ""}</span></button>
      <button type="button" class="stat ${away.length ? "info" : "clear"}" data-f="away" aria-pressed="${P.status === "away"}"><span class="stat-label">On leave today</span><span class="stat-value">${away.length}</span><span class="stat-hint">approved leave</span></button>
      <button type="button" class="stat clear" data-f="left" aria-pressed="${P.status === "left"}"><span class="stat-label">Left</span><span class="stat-value">${left.length}</span><span class="stat-hint">no longer with us</span></button>
    </div>
    <div class="toolbar">
      <input type="search" id="st-q" placeholder="Search name, position, phone…" aria-label="Search staff" value="${esc(P.q)}">
      <select id="st-status" aria-label="Status"><option value="">Active</option><option value="away" ${P.status === "away" ? "selected" : ""}>On leave today</option><option value="left" ${P.status === "left" ? "selected" : ""}>Left</option></select>
    </div>
    ${list.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Position</th><th>Phone</th><th>Email</th><th>Type</th><th>Started</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map(s => `<tr data-id="${s.id}" style="cursor:pointer"><td class="name"><div style="display:flex;align-items:center;gap:10px">${FR.avatarHtml({ name: s.full_name, photo_url: s.photo_url })}<div><button type="button" class="rowlink" data-open="${s.id}">${esc(s.full_name || "(no name)")}</button>${s.member_email ? `<span class="sub">signs in as ${esc(s.member_email)}</span>` : ""}</div></div></td>
        <td>${esc(s.position || "—")}${s.department ? `<span class="sub">${esc(s.department)}</span>` : ""}</td><td>${esc(s.phone || "—")}</td><td>${esc(s.email || "—")}</td><td>${TYPE[s.employment_type] || ""}</td><td>${when(s.start_date) || "—"}</td><td>${statusPill(s)}</td><td><button class="btn small" data-open="${s.id}" aria-label="${canManage() ? "Open" : "View"} ${esc(s.full_name || "")}">${canManage() ? "Open" : "View"}</button></td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty"><h2>${P.q || P.status ? "Nothing matches" : "No staff yet"}</h2><p>${canManage() ? "Add people with the button above, or open a hired candidate in Hiring and use “Add to staff”." : "Staff records appear here once an Admin or Manager adds them."}</p></div>`}`;
  $("#st-q").oninput = e => { P.q = e.target.value; renderStaff(); setTimeout(() => $("#st-q")?.focus(), 0); };
  $("#st-status").onchange = e => { P.status = e.target.value; renderStaff(); };
  $("#st-add")?.addEventListener("click", () => openDrawer("new"));
  el.querySelectorAll("[data-open]").forEach(b => b.onclick = e => { e.stopPropagation(); openDrawer(b.dataset.open); });
  el.querySelectorAll("tr[data-id]").forEach(r => r.onclick = () => openDrawer(r.dataset.id));
  el.querySelectorAll(".stat[data-f]").forEach(t => t.onclick = () => { P.status = t.dataset.f; renderStaff(); });
}
const staffName = id => (P.all.staff.find(s => s.id === id) || {}).full_name || "Unknown";
function leaveRow(l, actions) {
  return `<div class="member"><div class="avatar">${esc((staffName(l.staff_id)[0] || "?").toUpperCase())}</div><div style="min-width:0"><b>${esc(staffName(l.staff_id))} <span class="pill ${l.status === "approved" ? "ok" : l.status === "pending" ? "warn" : l.status === "declined" ? "bad" : ""} flat">${l.status}</span></b>
    <small>${l.kind ? (KIND[l.kind] || l.kind) + " · " : ""}${when(l.start_date)} to ${when(l.end_date)} · ${l.days} day${l.days === 1 ? "" : "s"}${l.reason ? " · " + esc(l.reason) : ""}</small>
    <small>${!l.requested_by && !l.decided_by ? "approved" : l.decided_by ? `${l.status} by ${esc(l.decided_by)} ${when(l.decided_at)}${l.decision_note ? " · " + esc(l.decision_note) : ""}` : `requested by ${esc(l.requested_by || "")} ${when(l.created_at)}`}</small></div>
    <div class="acts">${actions || ""}</div></div>`;
}
function renderLeave() {
  const el = $("#v-leave"); const mine = myStaff(); const t = today();
  const toDecide = pendingToDecide();
  const current = approvedLeave().filter(l => l.end_date >= t).sort((a, b) => a.start_date.localeCompare(b.start_date));
  const myLeave = mine ? P.all.leave.filter(l => l.staff_id === mine.id).slice(0, 20) : [];
  el.innerHTML = `
    ${canManage() ? `<div class="card"><h2>To decide <small>${toDecide.length ? toDecide.length + " waiting" : "nothing waiting"}</small></h2><div class="team-list">${toDecide.map(l => leaveRow(l, `<input type="text" id="ln-${l.id}" placeholder="Note (optional)" aria-label="Note to ${esc(staffName(l.staff_id))} (optional)" style="min-width:160px"><button class="btn small primary" data-decide="${l.id}" data-s="approved">Approve</button><button class="btn small danger" data-decide="${l.id}" data-s="declined">Decline</button>`)).join("") || `<p class="muted">Requests from staff in ${esc(FR.companyName(S.company))} appear here.</p>`}</div></div>` : ""}
    <div class="team-grid">
      <div class="card"><h2>Away now and upcoming <small>approved</small></h2><div class="team-list">${current.map(l => leaveRow(l)).join("") || `<p class="muted">Nobody is on approved leave.</p>`}</div></div>
      <div class="card"><h2>My leave <small>${mine ? esc(mine.full_name) : "no staff record linked to your login"}</small></h2>
        ${mine ? `<div class="fields"><div class="field"><label for="ml-kind">Type</label><select id="ml-kind">${Object.entries(KIND).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div><div class="field"><label>&nbsp;</label><span class="hint">Weekends count as days; say so in the reason if they should not.</span></div>
          <div class="field"><label for="ml-start">From</label><input type="date" id="ml-start" value="${t}"></div><div class="field"><label for="ml-end">To</label><input type="date" id="ml-end" value="${t}"></div>
          <div class="field wide"><label for="ml-reason">Reason <span class="muted">(optional)</span></label><input id="ml-reason" placeholder="e.g. family event"></div></div>
          <p class="hint" id="ml-err" style="color:var(--bad)"></p>
          <div class="toolbar" style="justify-content:flex-end;margin-top:8px"><button class="btn primary" id="ml-go">Send request</button></div>
          <div class="team-list" style="margin-top:12px">${myLeave.map(l => leaveRow(l, l.status === "pending" ? `<button class="btn small" data-cancel="${l.id}">Cancel</button>` : "")).join("")}</div>` : `<p class="muted">An Admin or Manager links your login to your staff record (Staff → open your record → “Signs in as”). After that you can request leave here.</p>`}
      </div>
    </div>`;
  el.querySelectorAll("[data-decide]").forEach(b => b.onclick = async () => {
    const id = b.dataset.decide, status = b.dataset.s, note = $("#ln-" + id)?.value || ""; b.disabled = true;
    const { error } = await SB().rpc("leave_decide", { p_id: id, p_status: status, p_note: note });
    if (error) { toast(error.message, "bad"); b.disabled = false; return; }
    toast(`Leave ${status}`, "ok"); logAct("ok", `Leave ${status} for ${staffName(P.leave.find(l => l.id === id)?.staff_id)}`); load(["leave"]);
  });
  $("#ml-go")?.addEventListener("click", async () => {
    const start = $("#ml-start").value, end = $("#ml-end").value, kind = $("#ml-kind").value, reason = $("#ml-reason").value.trim(); $("#ml-err").textContent = "";
    if (!start || !end || end < start) { $("#ml-err").textContent = "Choose a valid date range."; return; }
    $("#ml-go").disabled = true;
    const { error } = await FR.save("leave_requests", null, { staff_id: mine.id, company_id: mine.company_id, kind, start_date: start, end_date: end, reason, requested_by: me() });
    $("#ml-go").disabled = false;
    if (error) { $("#ml-err").textContent = error.message; return; }
    toast("Leave request sent", "ok"); load(["leave"]);
  });
  el.querySelectorAll("[data-cancel]").forEach(b => b.onclick = async () => {
    const { error } = await FR.save("leave_requests", b.dataset.cancel, { status: "cancelled" }, { obj: P.leave.find(l => l.id === b.dataset.cancel) });
    if (error) { toast(error.message, "bad"); return; } toast("Request cancelled"); load(["leave"]);
  });
}

/* ---------- staff record drawer ---------- */
function showDrawer() { FR.drawer.show(); $("#scrim").onclick = closeDrawer; }
function closeDrawer() { P.open = null; FR.drawer.hide(); }
function openDrawer(id, prefill) {
  P.open = id; P.tab = "details"; P.prefill = prefill || null; paintDrawer(); showDrawer();
}
function paintDrawer() {
  const isNew = P.open === "new";
  const row = isNew ? { company_id: S.company, companies: [], status: "active", employment_type: "full_time", start_date: today(), history: [], ...(P.prefill || {}) } : P.staff.find(x => x.id === P.open);
  if (!row) return;
  const s = isNew ? row : { ...row, ...privOf(row.id), id: row.id, version: row.version };   // private fields shown only if the database returned them
  const locked = !canManage();
  const tab = (id, label) => `<button aria-pressed="${P.tab === id}" data-tab="${id}">${label}</button>`;
  $("#drawer").innerHTML = `<header><div><h2>${isNew ? "New staff record" : esc(s.full_name || "(no name)")}</h2><div class="muted" style="margin-top:4px">${isNew ? esc(FR.companyName(S.company)) : `${esc(s.position || "No position")} · ${esc(FR.companyShort(s.company_id))} ${statusPill(s)}`}</div></div><button class="x" id="close" aria-label="Close">×</button></header>
    <div class="body">
      ${locked ? `<div class="banner warn">View only. Admins and Managers of ${esc(FR.companyShort(S.company))} can edit staff records.</div>` : ""}
      ${isNew ? "" : `<div class="seg" style="margin-bottom:14px">${tab("details", "Details")}${tab("docs", `Documents (${P.docs.filter(d => d.staff_id === s.id).length})`)}${tab("leave", `Leave (${P.all.leave.filter(l => l.staff_id === s.id).length})`)}${tab("history", "History")}</div>`}
      <div id="pd-body"></div>
    </div>
    <footer id="pd-foot"></footer>`;
  $("#close").onclick = closeDrawer;
  $("#drawer").querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { P.tab = b.dataset.tab; paintDrawer(); });
  if (P.tab === "details") paintDetails(s, isNew, locked);
  if (P.tab === "docs") paintDocs(s, locked);
  if (P.tab === "leave") paintLeave(s, locked);
  if (P.tab === "history") paintHistory(s);
}
const PRIVATE = ["address", "date_of_birth", "emergency_name", "emergency_phone", "notes"];
const privOf = id => { const p = (P.all.priv || {})[id]; return p ? Object.fromEntries(PRIVATE.map(k => [k, p[k]])) : {}; };
const isSelf = s => !!s.member_email && s.member_email.toLowerCase() === me();
function paintDetails(s, isNew, locked) {
  const d = locked ? "disabled" : "";
  const showPrivate = canManage() || isSelf(s);   // the database enforces the same rule; this only avoids empty boxes
  const others = S.companies.filter(c => c.active && c.id !== s.company_id);
  const members = (S.team || []).filter(m => m.status === "active");
  $("#pd-body").innerHTML = `
    <div class="pf-photo" style="margin-bottom:12px"><div class="avatar" id="pd-avatar">${s.photo_url ? `<img src="${esc(s.photo_url)}" alt="">` : esc(((s.first_name || "")[0] || "") + ((s.surname || "")[0] || "") || "?")}</div>
      ${locked ? "" : `<div><input type="file" id="pd-file" accept="image/png,image/jpeg,image/webp" hidden><button class="btn small" id="pd-upload" ${isNew ? "disabled title=\"Save the record first\"" : ""}>Upload a photo</button><p class="hint">JPG, PNG or WebP; resized to 256 px.</p></div>`}</div>
    <div class="fields">
      <div class="field"><label>Surname</label><input id="pd-surname" value="${esc(s.surname || "")}" ${d}></div>
      <div class="field"><label>First name</label><input id="pd-first" value="${esc(s.first_name || "")}" ${d}></div>
      <div class="field wide"><label>Other names</label><input id="pd-other" value="${esc(s.other_names || "")}" ${d}></div>
      <div class="field"><label>Phone</label><input id="pd-phone" value="${esc(s.phone || "")}" inputmode="tel" ${d}></div>
      <div class="field"><label>Email</label><input id="pd-email" type="email" value="${esc(s.email || "")}" ${d}></div>
      <div class="field"><label>Position</label><input id="pd-pos" value="${esc(s.position || "")}" placeholder="e.g. Printing Supervisor" ${d}></div>
      <div class="field"><label>Department</label><input id="pd-dept" value="${esc(s.department || "")}" placeholder="e.g. Production" ${d}></div>
      <div class="field"><label>Employment type</label><select id="pd-type" ${d}>${Object.entries(TYPE).map(([k, v]) => `<option value="${k}" ${s.employment_type === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
      <div class="field"><label>Status</label><select id="pd-status" ${d}><option value="active" ${s.status === "active" ? "selected" : ""}>Active</option><option value="left" ${s.status === "left" ? "selected" : ""}>Left</option></select></div>
      <div class="field"><label>Start date</label><input type="date" id="pd-start" value="${esc(s.start_date || "")}" ${d}></div>
      <div class="field"><label>End date <span class="muted">(if left)</span></label><input type="date" id="pd-end" value="${esc(s.end_date || "")}" ${d}></div>
      <div class="field wide"><label>Home company</label><select id="pd-company" ${d || (isNew ? "" : "disabled")}>${S.companies.filter(c => c.active).map(c => `<option value="${c.id}" ${s.company_id === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
      ${others.length ? `<div class="field wide"><label>Also works for</label><div class="chips">${others.map(c => `<label class="chip" style="gap:6px"><input type="checkbox" data-also="${c.id}" ${(s.companies || []).includes(c.id) ? "checked" : ""} ${d}> ${esc(c.short_name)}</label>`).join("")}</div></div>` : ""}
      <div class="field wide"><label>Signs in as <span class="muted">(links this record to their login, for leave requests)</span></label><input id="pd-member" list="pd-members" value="${esc(s.member_email || "")}" placeholder="their Google email" ${d}><datalist id="pd-members">${members.map(m => `<option value="${esc(m.email)}">${esc(FR.memberName(m))}</option>`).join("")}</datalist></div>
      ${showPrivate ? `<div class="field wide"><label>Home address</label><input id="pd-addr" value="${esc(s.address || "")}" ${d}></div>
      <div class="field"><label>Date of birth</label><input type="date" id="pd-dob" value="${esc(s.date_of_birth || "")}" ${d}></div>
      <div class="field"><label>&nbsp;</label><span class="hint">Private: only Admins and Managers of this company, Group Admins and the person see these details.</span></div>
      <div class="field"><label>Emergency contact</label><input id="pd-ename" value="${esc(s.emergency_name || "")}" placeholder="Name" ${d}></div>
      <div class="field"><label>Emergency phone</label><input id="pd-ephone" value="${esc(s.emergency_phone || "")}" inputmode="tel" ${d}></div>
      <div class="field wide"><label>Notes</label><textarea id="pd-notes" ${d}>${esc(s.notes || "")}</textarea></div>` : ""}
    </div>
    <p class="hint" id="pd-err" style="color:var(--bad)"></p>`;
  $("#pd-foot").innerHTML = locked ? `<button class="btn" id="pd-close2">Close</button>` : `${isNew ? "" : `<button class="btn danger" id="pd-del">Delete record</button>`}<span style="flex:1"></span><button class="btn" id="pd-cancel">Cancel</button><button class="btn primary" id="pd-save">${isNew ? "Create record" : "Save"}</button>`;
  $("#pd-close2")?.addEventListener("click", closeDrawer); $("#pd-cancel")?.addEventListener("click", closeDrawer);
  $("#pd-upload")?.addEventListener("click", () => $("#pd-file").click());
  $("#pd-file")?.addEventListener("change", async e => {
    const f = e.target.files[0]; if (!f) return; $("#pd-upload").disabled = true; $("#pd-upload").textContent = "Uploading…";
    try { const url = await uploadPhoto(s, f); const { error: pe } = await FR.save("staff", s.id, { photo_url: url }, { obj: s }); if (pe) throw pe; toast("Photo saved", "ok"); await load(["staff"]); }
    catch (err) { $("#pd-err").textContent = "Photo upload failed: " + (err.message || err); $("#pd-upload").disabled = false; $("#pd-upload").textContent = "Upload a photo"; }
  });
  $("#pd-del")?.addEventListener("click", async () => {
    if (!confirm(`Delete ${s.full_name}'s record, with their documents and leave history?\n\nA Group Admin can restore it from Recently deleted. If they left the company, set Status to "Left" instead.`)) return;
    const r = await FR.softDelete("staff", s.id);
    if (!r.ok) { toast(r.error, "bad"); return; } toast("Record deleted. A Group Admin can restore it.", "warn"); closeDrawer(); load();
  });
  $("#pd-save")?.addEventListener("click", async () => {
    const v = id => $("#" + id).value.trim();
    const body = { company_id: $("#pd-company").value, companies: [...document.querySelectorAll("[data-also]:checked")].map(x => x.dataset.also), surname: v("pd-surname"), first_name: v("pd-first"), other_names: v("pd-other"), phone: v("pd-phone"), email: v("pd-email").toLowerCase(), position: v("pd-pos"), department: v("pd-dept"), employment_type: $("#pd-type").value, status: $("#pd-status").value, start_date: v("pd-start") || null, end_date: v("pd-end") || null, member_email: v("pd-member").toLowerCase() || null };
    const priv = $("#pd-addr") ? { address: v("pd-addr"), date_of_birth: v("pd-dob") || null, emergency_name: v("pd-ename"), emergency_phone: v("pd-ephone"), notes: v("pd-notes") } : null;
    if (!body.surname || !body.first_name) { $("#pd-err").textContent = "Surname and first name are required."; return; }
    if (body.status === "left" && !body.end_date) body.end_date = today();
    const changedKeys = isNew ? [] : Object.keys(body).filter(k => JSON.stringify(body[k] ?? "") !== JSON.stringify(s[k] ?? (Array.isArray(body[k]) ? [] : "")));
    const privKeys = priv ? Object.keys(priv).filter(k => JSON.stringify(priv[k] ?? "") !== JSON.stringify(s[k] ?? "")) : [];
    const changes = isNew ? ["Record created" + (s.candidate_id ? " from hiring" : "")] : [...changedKeys, ...privKeys].map(k => k.replace(/_/g, " "));
    body.history = [...(s.history || []), { ts: new Date().toISOString(), by: me(), summary: changes.length ? changes.join(", ") : "Saved (no changes)" }].slice(-100);
    if (isNew && s.candidate_id) body.candidate_id = s.candidate_id;
    $("#pd-save").disabled = true;
    // existing record: send only the fields this person changed, with the version they were looking at
    const patch = isNew ? body : Object.fromEntries([...changedKeys, "history"].map(k => [k, body[k]]));
    const { data, error } = await FR.save("staff", isNew ? null : s.id, patch, isNew ? {} : { obj: P.staff.find(x => x.id === s.id) });
    if (error) { $("#pd-save").disabled = false; $("#pd-err").textContent = error.message; return; }
    // private details: their own record (same id), saved only by Admins and Managers, only when something changed
    const sid = data?.id || s.id, privRow = (P.all.priv || {})[sid];
    if (priv && canManage() && (isNew ? Object.values(priv).some(x => x) : privKeys.length)) {
      const pp = isNew || !privRow ? priv : Object.fromEntries(privKeys.map(k => [k, priv[k]]));
      const { error: pe } = await FR.save("staff_private", sid, pp, privRow ? { obj: privRow } : { action: "save" });
      if (pe) { $("#pd-save").disabled = false; $("#pd-err").textContent = "Saved, except the private details: " + pe.message; await load(["staff"]); return; }
    }
    $("#pd-save").disabled = false;
    toast(isNew ? `${body.first_name} ${body.surname} added to staff` : "Saved", "ok"); logAct("ok", `${isNew ? "Added" : "Updated"} staff record: ${body.first_name} ${body.surname}`);
    if (isNew && s.candidate_id && FR.modules.hiring?.markHired) FR.modules.hiring.markHired(s.candidate_id, data?.id);
    P.open = data?.id || P.open; P.prefill = null; await load(["staff"]); if (P.open) paintDrawer();
  });
}
async function uploadPhoto(s, file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Choose a JPG, PNG or WebP image");
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("That file is not a readable image")); i.src = URL.createObjectURL(file); });
  const size = 256, c = document.createElement("canvas"); c.width = size; c.height = size;
  const m = Math.min(img.width, img.height); c.getContext("2d").drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, size, size);
  const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.88));
  const path = `staff/${s.company_id}/${s.id}.jpg`;
  const { error } = await SB().storage.from("avatars").upload(path, blob, { upsert: true, contentType: "image/jpeg", cacheControl: "3600" });
  if (error) throw new Error(error.message);
  return SB().storage.from("avatars").getPublicUrl(path).data.publicUrl + "?v=" + Date.now();
}
function paintDocs(s, locked) {
  const docs = P.docs.filter(d => d.staff_id === s.id);
  $("#pd-body").innerHTML = `
    ${locked ? "" : `<div class="card" style="padding:12px;margin-bottom:12px"><div class="fields"><div class="field"><label>Type</label><select id="dc-kind">${Object.entries(DOC_KIND).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div><div class="field"><label>Title</label><input id="dc-title" placeholder="e.g. National ID, Employment contract"></div><div class="field wide"><label>File <span class="muted">(PDF, image or Word, up to 10 MB)</span></label><input type="file" id="dc-file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"></div></div><p class="hint" id="dc-err" style="color:var(--bad)"></p><div class="toolbar" style="justify-content:flex-end;margin-top:8px"><button class="btn primary small" id="dc-up">Upload</button></div></div>`}
    <div class="team-list">${docs.map(d => `<div class="member"><div class="avatar">${d.mime === "application/pdf" ? "PDF" : (d.mime || "").startsWith("image/") ? "IMG" : "DOC"}</div><div style="min-width:0"><b>${esc(d.title)}</b><small>${DOC_KIND[d.kind] || d.kind} · ${d.size_bytes ? Math.round(d.size_bytes / 1024) + " KB · " : ""}uploaded ${when(d.uploaded_at)} by ${esc(d.uploaded_by || "")}</small></div><div class="acts"><button class="btn small" data-dl="${d.id}">Open</button>${locked ? "" : `<button class="btn small danger" data-ddel="${d.id}">Delete</button>`}</div></div>`).join("") || `<p class="muted">No documents yet.</p>`}</div>`;
  $("#pd-foot").innerHTML = `<button class="btn" id="pd-close2">Close</button>`; $("#pd-close2").onclick = closeDrawer;
  $("#dc-up")?.addEventListener("click", async () => {
    const f = $("#dc-file").files[0], title = $("#dc-title").value.trim() || f?.name, kind = $("#dc-kind").value; $("#dc-err").textContent = "";
    if (!f) { $("#dc-err").textContent = "Choose a file."; return; }
    if (f.size > 10 * 1024 * 1024) { $("#dc-err").textContent = "The file is larger than 10 MB."; return; }
    $("#dc-up").disabled = true; $("#dc-up").textContent = "Uploading…";
    const safe = f.name.replace(/[^A-Za-z0-9._-]+/g, "-"); const path = `${s.company_id}/${s.id}/${Date.now().toString(36)}-${safe}`;
    const { error } = await SB().storage.from("staff-docs").upload(path, f, { contentType: f.type || "application/octet-stream" });
    if (error) { $("#dc-err").textContent = error.message; $("#dc-up").disabled = false; $("#dc-up").textContent = "Upload"; return; }
    const { error: e2 } = await FR.save("staff_documents", null, { staff_id: s.id, company_id: s.company_id, kind, title, file_path: path, size_bytes: f.size, mime: f.type, uploaded_by: me() });
    $("#dc-up").disabled = false; $("#dc-up").textContent = "Upload";
    if (e2) { $("#dc-err").textContent = e2.message; return; }
    toast("Document uploaded", "ok"); logAct("ok", `Uploaded ${title} for ${s.full_name}`); await load(["docs"]);
  });
  $("#pd-body").querySelectorAll("[data-dl]").forEach(b => b.onclick = async () => {
    const d = docs.find(x => x.id === b.dataset.dl); b.disabled = true;
    const { data, error } = await SB().storage.from("staff-docs").createSignedUrl(d.file_path, 120); b.disabled = false;
    if (error) { toast("Could not open: " + error.message, "bad"); return; } window.open(data.signedUrl, "_blank", "noopener");
  });
  $("#pd-body").querySelectorAll("[data-ddel]").forEach(b => b.onclick = async () => {
    const d = docs.find(x => x.id === b.dataset.ddel); if (!confirm(`Delete "${d.title}"? A Group Admin can restore it.`)) return;
    const r = await FR.softDelete("staff_documents", d.id);   // the file stays in storage so a restore brings it back
    if (!r.ok) { toast(r.error, "bad"); return; } toast("Document deleted", "warn"); load(["docs"]);
  });
}
function paintLeave(s, locked) {
  const list = P.all.leave.filter(l => l.staff_id === s.id);
  const t = today();
  $("#pd-body").innerHTML = `
    ${locked ? "" : `<div class="card" style="padding:12px;margin-bottom:12px"><h3 style="margin-bottom:8px">Record leave for ${esc(s.first_name || s.full_name)}</h3><div class="fields"><div class="field"><label>Type</label><select id="ll-kind">${Object.entries(KIND).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div><div class="field"><label>Approve now?</label><select id="ll-status"><option value="approved">Yes, approved</option><option value="pending">No, leave pending</option></select></div><div class="field"><label>From</label><input type="date" id="ll-start" value="${t}"></div><div class="field"><label>To</label><input type="date" id="ll-end" value="${t}"></div><div class="field wide"><label>Reason</label><input id="ll-reason"></div></div><p class="hint" id="ll-err" style="color:var(--bad)"></p><div class="toolbar" style="justify-content:flex-end;margin-top:8px"><button class="btn primary small" id="ll-go">Save</button></div></div>`}
    <div class="team-list">${list.map(l => leaveRow(l, !locked && l.status === "pending" ? `<button class="btn small primary" data-decide="${l.id}" data-s="approved">Approve</button><button class="btn small danger" data-decide="${l.id}" data-s="declined">Decline</button>` : "")).join("") || `<p class="muted">No leave recorded.</p>`}</div>`;
  $("#pd-foot").innerHTML = `<button class="btn" id="pd-close2">Close</button>`; $("#pd-close2").onclick = closeDrawer;
  $("#ll-go")?.addEventListener("click", async () => {
    const start = $("#ll-start").value, end = $("#ll-end").value; $("#ll-err").textContent = "";
    if (!start || !end || end < start) { $("#ll-err").textContent = "Choose a valid date range."; return; }
    const status = $("#ll-status").value;
    const row = { staff_id: s.id, company_id: s.company_id, kind: $("#ll-kind").value, start_date: start, end_date: end, reason: $("#ll-reason").value.trim(), requested_by: me(), status: "pending" };
    const { data, error } = await FR.save("leave_requests", null, row);
    if (error) { $("#ll-err").textContent = error.message; return; }
    if (status === "approved" && data?.id) { const { error: e2 } = await SB().rpc("leave_decide", { p_id: data.id, p_status: "approved", p_note: "Recorded by " + me() }); if (e2) toast("Saved as pending: " + e2.message, "warn"); }
    toast("Leave recorded", "ok"); await load(["leave"]);
  });
  $("#pd-body").querySelectorAll("[data-decide]").forEach(b => b.onclick = async () => {
    const { error } = await SB().rpc("leave_decide", { p_id: b.dataset.decide, p_status: b.dataset.s }); if (error) { toast(error.message, "bad"); return; }
    toast(`Leave ${b.dataset.s}`, "ok"); load(["leave"]);
  });
}
function paintHistory(s) {
  const h = (s.history || []).slice().reverse();
  $("#pd-body").innerHTML = `<ul class="history">${h.map(x => `<li><time>${FR.fmtDate(x.ts)}</time><span>${esc(x.summary)} <span class="muted" data-by="${esc(x.by || "")}"></span></span></li>`).join("") || `<li class="muted">Nothing yet.</li>`}</ul>`;
  $("#pd-foot").innerHTML = `<button class="btn" id="pd-close2">Close</button>`; $("#pd-close2").onclick = closeDrawer; FR.resolveNames();
}

/* ---------- from Hiring: a hired candidate becomes a staff record ---------- */
function fromCandidate(c, roleName) {
  const parts = String(c.name || "").trim().split(/\s+/);
  const pre = { surname: parts.length > 1 ? parts[parts.length - 1] : "", first_name: parts[0] || "", other_names: parts.length > 2 ? parts.slice(1, -1).join(" ") : "", phone: c.phone || "", email: (c.email || "").toLowerCase(), position: roleName || "", candidate_id: c.id, start_date: today() };
  const existing = P.all.staff.find(s => s.candidate_id === c.id);
  FR.setView("staff");
  if (existing) { openDrawer(existing.id); toast(`${existing.full_name} is already on staff`); return; }
  openDrawer("new", pre);
}

/* ---------- registration ---------- */
FR.registerModule({
  id: "people", name: "People", icon: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="11" r="2.5"/><path d="M5.5 17a3.5 3.5 0 0 1 7 0M15 9h3M15 13h3"/></svg>',
  views: [
    { id: "staff", title: "Staff", sub: "Everyone who works here: details, documents and leave", count: true, primary: { label: "Add staff", run: () => openDrawer("new"), can: canManage }, icon: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2.5"/><path d="M5 18a4 4 0 0 1 8 0M14 9h4M14 13h4"/></svg>' },
    { id: "leave", title: "Leave", sub: "Requests to decide, and who is away when", count: true, primary: { label: "Request leave", run: () => document.getElementById("ml-kind")?.focus(), can: () => !!myStaff() }, icon: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18M9 15l2 2 4-4"/></svg>' },
  ],
  start() {
    if (P.started) return; P.started = true;
    load();
    FR.subscribe("staff", () => load(["staff"])); FR.subscribe("staff_documents", () => load(["docs"])); FR.subscribe("leave_requests", () => load(["leave"]));
  },
  onCompany() { P.q = ""; P.status = ""; if (P.open) closeDrawer(); scope(); render(); },
  render, closeDrawer, fromCandidate,
  ready: () => !!P.loaded,
  attention() {
    if (!P.loaded) return [];
    const pend = pendingToDecide().sort((a, b) => (a.start_date || "").localeCompare(b.start_date || ""));
    const name = id => (P.all.staff.find(s => s.id === id) || {}).full_name || "Staff member";
    const away = P.staff.filter(s => s.status === "active" && onLeaveToday(s));
    return [
      { id: "leave", level: "warn", label: "Leave to decide", count: pend.length, hint: "requests waiting for a manager", go: () => FR.setView("leave"), items: pend.slice(0, 4).map(l => ({ title: name(l.staff_id), meta: `${KIND[l.kind] || "Leave"} · ${when(l.start_date)} to ${when(l.end_date)}`, go: () => FR.setView("leave") })) },
      { id: "away", level: "info", label: "On leave today", count: away.length, hint: "not in the office", go: () => { P.status = "away"; FR.setView("staff"); }, items: [] },
    ];
  },
  search(q) {
    q = q.toLowerCase();
    return P.staff.filter(s => [s.full_name, s.position, s.department, s.phone, s.email].join(" ").toLowerCase().includes(q)).slice(0, 6)
      .map(s => ({ title: s.full_name, meta: `Staff · ${s.position || ""}${s.status === "left" ? " · left" : ""}`, go: () => { FR.setView("staff"); openDrawer(s.id); } }));
  },
});
})();
