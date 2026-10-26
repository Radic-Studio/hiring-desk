/* Future Ready Group System — core: shared state, helpers, database shim, module registry.
   Loaded first. Everything shared lives on window.FR; modules and the shell read it from there. */
(() => {
const FR = window.FR = window.FR || {};
const CFG = FR.CFG = window.HIRING_DESK_CONFIG || {};

// Shared state. Shell-owned: me, access, company, companies, members, team, module, view. Hiring-owned: the rest (kept flat for now).
const S = FR.S = {
  db: null, me: null, access: null, company: null, companies: [], members: {}, team: [], companyMembers: [],
  canWrite: null, module: null, view: "dashboard",
  all: { cands: {}, roles: {}, issues: {} }, cands: {}, issues: {}, roles: {}, settings: null, loaded: false,
  role: null, filters: { q: "", status: "", loc: "", tier: "", avail: "" }, open: null, imp: null, sel: new Set(), mcp: true,
};

const $ = FR.$ = (s, el = document) => el.querySelector(s);
const $$ = FR.$$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = FR.esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
FR.safeGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
FR.safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

/* ---------- activity log + toasts ---------- */
const ACT = FR.ACT = []; let ACT_UNREAD = 0;
function paintActBadge() { const b = $("#act-cnt"); if (!b) return; b.textContent = ACT_UNREAD; b.hidden = ACT_UNREAD === 0; }
const logAct = FR.logAct = (kind, text, detail) => { ACT.unshift({ ts: new Date(), kind, text, detail: detail || "" }); if (ACT.length > 200) ACT.length = 200; ACT_UNREAD++; paintActBadge(); };
const toast = FR.toast = (m, kind = "") => { if (m === FR.QUEUED_MSG) kind = "warn"; const t = $("#toast"); t.textContent = m; t.className = "toast show " + kind; clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("show"), kind === "bad" ? 4500 : 2600); if (kind) logAct(kind, m); };
FR.openActivity = () => {
  const m = $("#act-modal");
  m.innerHTML = `<h2 id="act-title">Activity <small class="muted" style="font-family:var(--body);font-weight:400;font-size:12px">this session, newest first</small></h2>
    <div class="act">${ACT.map(a => `<div class="${a.kind}"><time>${a.ts.toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time><i></i>${a.detail ? `<details><summary style="cursor:pointer">${esc(a.text)}</summary><pre style="white-space:pre-wrap;font-family:var(--mono);font-size:11px;color:var(--muted);margin:6px 0 0">${esc(a.detail)}</pre></details>` : `<span>${esc(a.text)}</span>`}</div>`).join("") || `<div><time>—</time><i></i><span class="muted">Nothing yet. Saves, sends, imports and downloads will appear here with their outcome.</span></div>`}</div>
    <div class="toolbar"><button class="btn" id="act-clear">Clear log</button><button class="btn" id="act-close">Close</button></div>`;
  ACT_UNREAD = 0; paintActBadge();
  $("#act-scrim").hidden = false; $("#act-clear").onclick = () => { ACT.length = 0; ACT_UNREAD = 0; paintActBadge(); $("#act-scrim").hidden = true; }; $("#act-close").onclick = () => { $("#act-scrim").hidden = true; }; $("#act-scrim").onclick = e => { if (e.target === $("#act-scrim")) $("#act-scrim").hidden = true; };
};

/* ---------- small formatters ---------- */
FR.fmtDate = ts => { try { return new Date(ts).toLocaleString("en-NG", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
FR.when = ts => { if (!ts) return ""; try { return new Date(ts).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }); } catch { return ""; } };
FR.notice = (kind, msg) => { const n = $("#notice"); n.hidden = !msg; n.className = "banner " + kind; n.textContent = msg; };
FR.setSync = (ok, text) => { if (FR.statusActive) return;   /* after sign-in the status module (status.js) owns this indicator */ const s = $("#sync"); s.classList.toggle("off", !ok); s.querySelector("span").textContent = text; };
FR.setCount = (view, n) => { const el = $("#cnt-" + view); if (!el) return; el.textContent = n; el.hidden = false; };

/* ---------- people helpers ---------- */
FR.LEVEL_LABEL = { editor: "Group Admin", viewer: "Member", contributor: "Member" };
FR.ROLE_LABEL = { admin: "Admin", manager: "Manager", staff: "Staff", viewer: "Viewer" };
FR.ROLE_HELP = { admin: "Everything in this company, including its team", manager: "Create and edit records; cannot change the team or settings", staff: "Work on records; log calls and update stages", viewer: "Read and download only" };
FR.memberName = m => m.name || [m.first_name, m.other_names, m.surname].filter(Boolean).join(" ") || m.email;
FR.avatarHtml = (m, cls = "avatar") => { const n = FR.memberName(m); const ini = n.split(/\s+/).map(x => x[0]).slice(0, 2).join("").toUpperCase() || "?"; return `<div class="${cls}">${m.photo_url ? `<img src="${esc(m.photo_url)}" alt="">` : esc(ini)}</div>`; };
FR.resolveNames = async () => { for (const el of document.querySelectorAll("[data-by]")) { const id = el.dataset.by; if (!id) continue; const m = S.members[id.toLowerCase()]; el.textContent = "· " + (m ? FR.memberName(m) : id); } };
FR.companyName = id => (S.companies.find(c => c.id === id) || {}).name || id;
FR.companyShort = id => (S.companies.find(c => c.id === id) || {}).short_name || id;

/* ---------- Supabase: document-store shim over tables ---------- */
FR.SB = null;
const CAND_COLS = { nextAction: "next_action", lastContact: "last_contact", lastBy: "last_by", selfReported: "self_reported", formResponseAt: "form_response_at", formRole: "form_role", emailedAt: "emailed_at", lastEmailStatus: "last_email_status", lastEmailAt: "last_email_at", lastEmailError: "last_email_error", addedManually: "added_manually", addedBy: "added_by", importedFrom: "imported_from", companyId: "company_id" };
const ROLE_COLS = { qualWeight: "qual_weight", createdAt: "created_at", createdBy: "created_by", closedAt: "closed_at", closedBy: "closed_by", reopenedAt: "reopened_at", finalStats: "final_stats", companyId: "company_id" };
const ISSUE_COLS = { candidateId: "candidate_id", resolvedAt: "resolved_at", resolvedBy: "resolved_by", companyId: "company_id" };
const COLS = { candidates: CAND_COLS, roles: ROLE_COLS, issues: ISSUE_COLS };
const toRow = (table, obj) => { const m = COLS[table] || {}; const out = {}; for (const [k, v] of Object.entries(obj)) { if (k === "updated_at" || k === "updatedAt") continue; out[m[k] || k] = v === undefined ? null : v; } return out; };
const fromRow = (table, row) => { const m = COLS[table] || {}; const inv = Object.fromEntries(Object.entries(m).map(([a, b]) => [b, a])); const out = {}; for (const [k, v] of Object.entries(row)) { if (k === "updated_at") continue; out[inv[k] || k] = v === null ? (k === "interview" || k === "final_stats" || k.endsWith("_at") || k === "last_contact" ? null : "") : v; } return out; };
const subs = {};
const subscribe = FR.subscribe = (table, run, id) => {
  const key = table + (id ? "/" + id : ""); if (subs[key]) subs[key].unsubscribe();
  let t = null; const debounced = () => { clearTimeout(t); t = setTimeout(run, 150); };
  subs[key] = FR.SB.channel("ch-" + key.replace(/[^a-z0-9]/gi, "-")).on("postgres_changes", { event: "*", schema: "public", table, ...(id ? { filter: "id=eq." + id } : {}) }, debounced).subscribe();
  return () => subs[key]?.unsubscribe();
};
// Tables with soft deletes: normal lists never show deleted rows (Group Admins see them under Recently deleted).
const SOFT = FR.SOFT = new Set(["roles", "candidates", "issues", "staff", "staff_documents", "leave_requests", "press_customers", "press_rate_items", "press_jobs", "press_payments", "press_materials", "press_files", "customer_requests"]);
const live = (q, table) => SOFT.has(table) ? q.is("deleted_at", null) : q;
FR.live = live;
/** Soft-delete one record (and what belongs to it). Returns { ok, error, deletion }. */
FR.softDelete = async (table, id) => { const { data, error } = await FR.SB.rpc("soft_delete", { p_entity: table, p_id: String(id) }); return error ? { ok: false, error: error.message } : { ok: true, deletion: data }; };
/* ---------- the single write path (Stage 4) ----------
 * Every change goes through the database function apply_op with an operation id made here.
 * Sending the same id again (a retry after a dropped connection) can never apply the change twice.
 * `base` is the record version this screen was showing; if someone else changed the same field since,
 * the database keeps their value, files ours as a conflict for a Group Admin, and says so. */
const uuid = () => crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
const isNetErr = e => !e?.code && /fetch|network|load failed|timeout|aborted/i.test(e?.message || "");
/**
 * Save one record. FR.save(table, id or null, fields, { base, action, obj }) → { data: row, error, result }.
 * id null = new record. obj = the local row object; its version is moved on after a successful save.
 */
FR.save = async (table, id, fields, opt = {}) => {
  const op = opt.opId || uuid();
  const action = opt.action || (id == null ? "insert" : "update");
  const base = opt.base ?? opt.obj?.version ?? null;
  const args = { p_op_id: op, p_entity: table, p_id: id == null ? null : String(id), p_action: action, p_patch: fields, p_base_version: base };
  let data, error;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (navigator.onLine === false) { error = { message: "network: offline" }; break; }   // the browser knows it is offline: no point waiting
    ({ data, error } = await FR.SB.rpc("apply_op", args));
    if (!error || !isNetErr(error)) break;
    await new Promise(r => setTimeout(r, 500 * (attempt + 1) + Math.random() * 300));   // same op id: safe to resend
  }
  if (error && isNetErr(error)) {
    // Stage 5: keep it on this device for later, if this kind of change may wait. Never reported as "Saved".
    const why = FR.outbox ? FR.outbox.refuse(table, action, fields) : "No connection to the database. Nothing was saved.";
    if (!why && !opt.noQueue && await FR.outbox.queue({ op_id: op, table, id, action, fields, base, label: opt.label }))
      return { data: null, result: "queued", queued: true, error: { code: "queued", message: FR.outbox.MSG } };
    return { data: null, result: "failed", error: { code: "unavailable", message: why || "No connection to the database. Nothing was saved." } };
  }
  if (error) return { data: null, result: "failed", error: { code: error.code, message: error.message } };
  const result = data?.result;
  if (result === "applied" || result === "duplicate") {
    if (opt.obj && data.version != null) opt.obj.version = data.version;
    if (data.row && FR._rows[table]) FR._rows[table][String(data.row.id)] = data.row;
    return { data: data.row, result, error: null };
  }
  if (result === "conflict") { if (data.row && FR._rows[table]) FR._rows[table][String(id)] = data.row; return { data: data.row, result, conflict: data, error: { code: "conflict", message: data.message } }; }
  return { data: null, result: result || "refused", error: { code: /permission/i.test(data?.message || "") ? "42501" : "refused", message: data?.message || "Not saved" } };
};
FR._rows = {};   // last rows read per table, so the Hiring screens can send only what changed and the version they saw
const cacheRows = (table, rows) => { const m = FR._rows[table] = FR._rows[table] || {}; rows.forEach(r => { m[String(r.id)] = r; }); };
const same = (a, b) => {
  if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) return true;
  if (typeof a === "string" && typeof b === "string" && /^\d{4}-\d\d-\d\d[T ]\d/.test(a) && /^\d{4}-\d\d-\d\d[T ]\d/.test(b)) return Date.parse(a) === Date.parse(b.replace(" ", "T"));
  return false;
};
/** Only the fields of `body` that differ from the row on screen (history always travels: the database merges it). */
FR.diff = (obj, body) => Object.fromEntries(Object.entries(body).filter(([k, v]) => k === "history" || !same(v, obj?.[k])));
const SYSTEM_COLS = new Set(["id", "version", "op_id", "updated_at", "updated_by", "deleted_at", "deleted_by", "delete_batch"]);
FR.dbShim = {
  doc(path) {
    const [table, id] = path.split("/");
    return {
      async set(body) {
        if (table === "settings") {   // app-wide settings blob: not a business record
          const { error } = await FR.SB.from(table).upsert({ id, data: body }, { onConflict: "id" });
          if (error) throw { code: error.code === "42501" ? "invalid_argument" : error.code, message: error.message };
          return;
        }
        const row = toRow(table, body), cached = FR._rows[table]?.[String(id)];
        let patch = row, opt = { action: "save" };
        if (cached) {
          patch = {}; Object.keys(row).forEach(k => { if (!SYSTEM_COLS.has(k) && !same(row[k], cached[k])) patch[k] = row[k]; });
          if (!Object.keys(patch).length) return;
          opt = { action: "update", base: cached.version };
        }
        const r = await FR.save(table, id, patch, opt);
        if (r.error) throw { code: r.error.code === "42501" ? "invalid_argument" : r.error.code, message: r.error.message };
      },
      async delete() { const r = await FR.softDelete(table, id); if (!r.ok) throw { code: "refused", message: r.error }; },
      async get() { const { data, error } = await live(FR.SB.from(table).select("*").eq("id", id), table).maybeSingle(); if (error) throw { code: error.code, message: error.message }; if (data) cacheRows(table, [data]); return { exists: !!data, data: () => data ? (table === "settings" ? data.data : fromRow(table, data)) : undefined }; },
      onSnapshot(next, err) { const run = async () => { try { next(await this.get()); } catch (e) { err?.(e); } }; run(); return subscribe(table, run, id); },
    };
  },
  collection(table) {
    return { onSnapshot(next, err) { const run = async () => { const { data, error } = await live(FR.SB.from(table).select("*"), table).limit(5000); if (error) { err?.({ code: error.code, message: error.message }); return; } cacheRows(table, data); next({ docs: data.map(r => ({ id: r.id, data: () => table === "settings" ? r.data : fromRow(table, r) })), metadata: { fromCache: false } }); }; run(); return subscribe(table, run); } };
  },
};
let writing = false;
FR.write = async (ref, body, okMsg) => {
  if (!S.db) { toast("Not connected to the database"); return false; }
  if (writing) { toast("Still saving the last change"); return false; }
  writing = true;
  try { await ref.set(body); toast(okMsg, "ok"); return true; }
  catch (e) {
    if (e?.code === "invalid_argument" && S.canWrite !== true) { S.canWrite = false; FR.paintRole(); FR.render(); toast("You have view-only access", "warn"); }
    else if (e?.code === "conflict") toast(e.message, "warn");
    else if (e?.code === "queued") { toast(e.message, "warn"); return true; }   // kept on this device; deliberately not "Saved"
    else if (e?.code === "unavailable") toast("No connection to the database. Nothing was saved; try again.", "bad");   // FR.save already retried with the same operation id
    else toast("Could not save: " + (e?.message || e?.code || "unknown error"), "bad");
    return false;
  } finally { writing = false; }
};
FR.callFunction = async (name, body) => {
  const { data: { session } } = await FR.SB.auth.getSession();
  if (!session) return { error: "not_signed_in", detail: "Sign in again" };
  try {
    const r = await fetch(`${CFG.supabaseUrl}/functions/v1/${name}`, { method: "POST", headers: { Authorization: "Bearer " + session.access_token, apikey: CFG.supabaseKey, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const out = await r.json().catch(() => ({ error: `HTTP ${r.status}` })); if (!r.ok && !out.error) out.error = `HTTP ${r.status}`; return out;
  } catch (e) { return { error: "network", detail: e.message }; }
};

/* ---------- module registry ---------- */
FR.modules = {};
FR.registerModule = m => { FR.modules[m.id] = m; };
FR.render = () => { const m = FR.modules[S.module]; if (S.view === "team") FR.renderTeam?.(); else if (S.view === "deleted") FR.renderDeleted?.(); else m?.render?.(); };
})();
