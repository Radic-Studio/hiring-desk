/* Future Ready Group System — conflict review for Group Admins (Stage 7).
   A conflict is a save that arrived after someone else had changed the same field. The database kept the other
   person's value and filed the attempt here (other fields in that save were saved normally). For each one a Group
   Admin chooses:
     Keep current   the record stays as it is;
     Take incoming  the value the person tried to save is written;
     Edit and merge the admin types the value to keep.
   The choice is written through resolve_conflict → apply_op (permissions, version check, operation id, log). */
(() => {
const FR = window.FR, S = FR.S;
const { $, esc, toast, logAct } = FR;
const SB = () => FR.SB;
const ENTITY = { roles: "Hiring role", candidates: "Candidate", issues: "Data issue", staff: "Staff record", staff_documents: "Staff document", leave_requests: "Leave request",
  press_customers: "Press customer", press_rate_items: "Rate card item", press_jobs: "Press job", press_payments: "Payment", press_materials: "Material", press_files: "Job file", customer_requests: "Customer request" };
const C = FR.CONF = { open: [], resolved: [], rows: {}, showResolved: false, merging: null, busy: false };
const isGA = () => !!S.access?.group_admin;

/* ---------- data ---------- */
FR.loadConflicts = async function loadConflicts() {
  if (!isGA() || !SB()) return;
  const [{ data: open, error }, { data: done }] = await Promise.all([
    SB().from("conflicts").select("*").eq("status", "open").order("created_at", { ascending: false }).limit(200),
    SB().from("conflicts").select("*").neq("status", "open").order("resolved_at", { ascending: false }).limit(30),
  ]);
  if (error) { C.error = error.message; } else { C.error = ""; C.open = open || []; C.resolved = done || []; }
  // the records as they are now (one read per kind of record)
  const want = {}; for (const c of [...C.open, ...C.resolved]) (want[c.entity] = want[c.entity] || new Set()).add(c.record_id);
  await Promise.all(Object.entries(want).map(async ([t, ids]) => {
    const { data } = await SB().from(t).select("*").in("id", [...ids]);
    C.rows[t] = C.rows[t] || {}; for (const r of data || []) C.rows[t][String(r.id)] = r;
  }));
  FR.paintConflictBadge();
  if (S.view === "conflicts") FR.renderConflicts();
  if (!loadConflicts.sub) loadConflicts.sub = FR.subscribe("conflicts", loadConflicts);
};
FR.paintConflictBadge = () => { const c = $("#cnt-conflicts"); if (!c) return; c.textContent = C.open.length; c.hidden = !C.open.length; };

/* ---------- display helpers ---------- */
const rowOf = c => C.rows[c.entity]?.[String(c.record_id)];
const labelOf = c => { const r = rowOf(c); if (!r) return `${ENTITY[c.entity] || c.entity} (no longer available)`;
  return r.number ? `${r.number}${r.title ? " · " + r.title : r.customer_name ? " · " + r.customer_name : ""}` : r.full_name || [r.first_name, r.surname].filter(Boolean).join(" ") || r.name || r.title || r.ref || r.id; };
const fieldName = k => k.replace(/_/g, " ").replace(/^./, x => x.toUpperCase());
const who = e => { const m = e && S.members?.[String(e).toLowerCase()]; return m ? FR.memberName(m) : (e || "?"); };
const when = t => t ? new Date(t).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
const show = v => {
  if (v === null || v === undefined || v === "") return `<span class="muted">(empty)</span>`;
  if (v === "[hidden]") return `<span class="muted">private: not stored</span>`;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v) || typeof v === "object") return `<details><summary>${Array.isArray(v) ? `${v.length} item${v.length === 1 ? "" : "s"}` : "details"}</summary><pre class="cf-json">${esc(JSON.stringify(v, null, 2))}</pre></details>`;
  const s = String(v); return s.length > 240 ? `<details><summary>${esc(s.slice(0, 120))}…</summary>${esc(s)}</details>` : esc(s);
};
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const CHOICE = { kept_current: "Kept current", took_incoming: "Took incoming", merged: "Edited and merged" };

/* ---------- screen ---------- */
FR.renderConflicts = function renderConflicts() {
  const el = $("#v-conflicts"); if (!el) return;
  if (!isGA()) { el.innerHTML = `<p class="muted">Only Group Admins can review conflicts.</p>`; return; }
  const card = c => {
    const r = rowOf(c), private_ = Object.values(c.incoming || {}).includes("[hidden]");
    const movedOn = r && c.fields.some(f => !same(r[f], c.current_values?.[f]) && c.current_values?.[f] !== "[hidden]");
    const merging = C.merging === c.id;
    return `<div class="card cf-card" data-cf="${c.id}">
      <div class="cf-head"><div><b>${esc(labelOf(c))}</b><small>${esc(ENTITY[c.entity] || c.entity)}${c.company_id ? " · " + esc(FR.companyShort?.(c.company_id) || c.company_id) : ""} · ${esc(who(c.actor))} tried to save this ${when(c.created_at)}</small></div>
        ${r ? "" : `<span class="pill bad">record not available</span>`}</div>
      ${movedOn ? `<p class="st-note">This record has changed again since the clash. "Current" below shows it as it is now.</p>` : ""}
      <table class="cf-table"><thead><tr><th>Field</th><th>Current (kept)</th><th>Incoming (${esc(who(c.actor))})</th>${merging ? "<th>Keep this value</th>" : ""}</tr></thead><tbody>
        ${c.fields.map(f => { const cur = r ? r[f] : c.current_values?.[f], inc = c.incoming?.[f];
          return `<tr><td>${esc(fieldName(f))}</td><td>${show(cur)}</td><td>${show(inc)}</td>${merging ? `<td>${editor(c, f, cur, inc)}</td>` : ""}</tr>`; }).join("")}
      </tbody></table>
      <p class="hint cf-err" id="cfe-${c.id}"></p>
      <div class="toolbar">${merging
        ? `<button class="btn primary" data-cf-save="${c.id}">Save merged values</button><button class="btn" data-cf-cancel="${c.id}">Cancel</button>`
        : `<button class="btn" data-cf-keep="${c.id}">Keep current</button>
           <button class="btn" data-cf-take="${c.id}" ${!r || private_ ? `disabled title="${private_ ? "Private staff details are not stored with conflicts: use Edit and merge" : "The record is not available"}"` : ""}>Take incoming</button>
           <button class="btn primary" data-cf-merge="${c.id}" ${r ? "" : "disabled"}>Edit and merge</button>`}</div></div>`;
  };
  const done = c => `<div class="member"><div class="avatar">${esc((ENTITY[c.entity] || "?")[0])}</div><div style="min-width:0"><b>${esc(labelOf(c))}</b>
      <small>${esc(c.fields.map(fieldName).join(", "))} · ${esc(CHOICE[c.status] || c.status)} by ${esc(who(c.resolved_by))} ${when(c.resolved_at)}</small></div></div>`;
  el.innerHTML = `${C.error ? `<p class="notice bad">Could not load conflicts: ${esc(C.error)}</p>` : ""}
    <div class="card"><h2>Waiting for review <small>${C.open.length} · nothing was overwritten; the other person's value is in place until you decide</small></h2>
      ${C.open.length ? "" : `<p class="muted">No conflicts. When two people change the same field of the same record at the same time, the second save waits here instead of overwriting the first.</p>`}</div>
    ${C.open.map(card).join("")}
    <div class="card"><h2>Resolved <button class="btn small" id="cf-hist">${C.showResolved ? "Hide" : "Show"} the last ${C.resolved.length}</button></h2>
      ${C.showResolved ? (C.resolved.length ? `<div class="team-list">${C.resolved.map(done).join("")}</div>` : `<p class="muted">None yet.</p>`) : ""}</div>`;
  $("#cf-hist").onclick = () => { C.showResolved = !C.showResolved; FR.renderConflicts(); };
  el.querySelectorAll("[data-cf-keep]").forEach(b => b.onclick = () => resolve(b.dataset.cfKeep, "keep_current"));
  el.querySelectorAll("[data-cf-take]").forEach(b => b.onclick = () => resolve(b.dataset.cfTake, "take_incoming"));
  el.querySelectorAll("[data-cf-merge]").forEach(b => b.onclick = () => { C.merging = b.dataset.cfMerge; FR.renderConflicts(); });
  el.querySelectorAll("[data-cf-cancel]").forEach(b => b.onclick = () => { C.merging = null; FR.renderConflicts(); });
  el.querySelectorAll("[data-cf-save]").forEach(b => b.onclick = () => saveMerge(b.dataset.cfSave));
  el.querySelectorAll("[data-cf-use]").forEach(b => b.onclick = () => { const i = $(`#${b.dataset.cfUse}`); i.value = b.dataset.val; });
};
/* one input per field, shaped by the current value's type, prefilled with the current value */
function editor(c, f, cur, inc) {
  const id = `cfv-${c.id}-${f}`, sample = cur ?? (inc === "[hidden]" ? "" : inc);
  const asText = v => v === null || v === undefined || v === "[hidden]" ? "" : typeof v === "object" ? JSON.stringify(v, null, 2) : String(v);
  const use = (label, v) => v === "[hidden]" ? "" : `<button type="button" class="btn small" data-cf-use="${id}" data-val="${esc(asText(v))}">${label}</button>`;
  let input;
  if (typeof sample === "boolean") input = `<select id="${id}" data-kind="bool"><option value="true" ${cur ? "selected" : ""}>Yes</option><option value="false" ${cur ? "" : "selected"}>No</option></select>`;
  else if (typeof sample === "number") input = `<input id="${id}" data-kind="num" type="number" step="any" value="${esc(asText(cur))}">`;
  else if (sample && typeof sample === "object") input = `<textarea id="${id}" data-kind="json" rows="6" class="cf-json">${esc(asText(cur))}</textarea>`;
  else input = asText(cur).length > 60 ? `<textarea id="${id}" data-kind="text" rows="3">${esc(asText(cur))}</textarea>` : `<input id="${id}" data-kind="text" value="${esc(asText(cur))}">`;
  return `<div class="cf-edit">${input}<div class="cf-use">${use("Use current", cur)}${use("Use incoming", inc)}</div></div>`;
}
function readMerge(c) {
  const out = {};
  for (const f of c.fields) {
    const i = $(`#cfv-${c.id}-${f}`); const k = i.dataset.kind, v = i.value;
    if (k === "bool") out[f] = v === "true";
    else if (k === "num") { if (v.trim() === "") out[f] = null; else if (isNaN(Number(v))) throw new Error(`${fieldName(f)} must be a number`); else out[f] = Number(v); }
    else if (k === "json") { try { out[f] = v.trim() ? JSON.parse(v) : null; } catch { throw new Error(`${fieldName(f)} is not valid (check brackets and quotes)`); } }
    else out[f] = v.trim() === "" ? (rowOf(c)?.[f] === null ? null : "") : v;
  }
  return out;
}
async function saveMerge(id) {
  const c = C.open.find(x => x.id === id); let vals;
  try { vals = readMerge(c); } catch (e) { $(`#cfe-${id}`).textContent = e.message; return; }
  await resolve(id, "merged", vals);
}
async function resolve(id, choice, values) {
  if (C.busy) return; const c = C.open.find(x => x.id === id); if (!c) return;
  const r = rowOf(c);
  if (choice === "take_incoming" && !confirm(`Replace ${c.fields.map(fieldName).join(", ")} on "${labelOf(c)}" with ${who(c.actor)}'s value?`)) return;
  C.busy = true; document.querySelectorAll(`[data-cf="${id}"] button`).forEach(b => b.disabled = true);
  const opId = c._op || (c._op = FR.uuid());   // the same id if this exact request is retried
  const { data, error } = await SB().rpc("resolve_conflict", { p_conflict: id, p_choice: choice, p_values: values || null, p_seen_version: r?.version ?? null, p_op_id: opId });
  C.busy = false;
  const err = $(`#cfe-${id}`);
  if (error) { if (err) err.textContent = /fetch|network/i.test(error.message) ? "No connection. Nothing was changed; try again." : error.message; FR.renderConflicts(); return; }
  if (data.result === "applied" || data.result === "duplicate") {
    C.merging = null; toast(`${labelOf(c)}: ${CHOICE[{ keep_current: "kept_current", take_incoming: "took_incoming", merged: "merged" }[choice]].toLowerCase()}`, "ok");
    logAct("ok", `Conflict resolved (${choice.replace("_", " ")}): ${labelOf(c)}`, c.fields.join(", "));
  } else if (data.result === "stale") { c._op = null; toast(data.message, "warn"); }
  else { c._op = null; toast(data.message || "Not resolved", "bad"); }
  await FR.loadConflicts(); if (data.result !== "applied" && data.result !== "duplicate") { const e = $(`#cfe-${id}`); if (e) e.textContent = data.message || ""; }
}
})();
