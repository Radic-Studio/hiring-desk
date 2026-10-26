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
const toast = FR.toast = (m, kind = "") => { const t = $("#toast"); t.textContent = m; t.className = "toast show " + kind; clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("show"), kind === "bad" ? 4500 : 2600); if (kind) logAct(kind, m); };
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
FR.setSync = (ok, text) => { const s = $("#sync"); s.classList.toggle("off", !ok); s.querySelector("span").textContent = text; };
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
FR.dbShim = {
  doc(path) {
    const [table, id] = path.split("/");
    return {
      async set(body) {
        const row = table === "settings" ? { id, data: body } : { id, ...toRow(table, body) };
        const { error } = await FR.SB.from(table).upsert(row, { onConflict: "id" }); if (error) throw { code: error.code === "42501" ? "invalid_argument" : error.code, message: error.message };
      },
      async delete() { const { error } = await FR.SB.from(table).delete().eq("id", id); if (error) throw { code: error.code, message: error.message }; },
      async get() { const { data, error } = await FR.SB.from(table).select("*").eq("id", id).maybeSingle(); if (error) throw { code: error.code, message: error.message }; return { exists: !!data, data: () => data ? (table === "settings" ? data.data : fromRow(table, data)) : undefined }; },
      onSnapshot(next, err) { const run = async () => { try { next(await this.get()); } catch (e) { err?.(e); } }; run(); return subscribe(table, run, id); },
    };
  },
  collection(table) {
    return { onSnapshot(next, err) { const run = async () => { const { data, error } = await FR.SB.from(table).select("*").limit(5000); if (error) { err?.({ code: error.code, message: error.message }); return; } next({ docs: data.map(r => ({ id: r.id, data: () => table === "settings" ? r.data : fromRow(table, r) })), metadata: { fromCache: false } }); }; run(); return subscribe(table, run); } };
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
    else if (e?.code === "unavailable") { await new Promise(r => setTimeout(r, 400 + Math.random() * 400)); try { await ref.set(body); toast(okMsg, "ok"); return true; } catch { toast("Could not save, try again", "bad"); } }
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
FR.render = () => { const m = FR.modules[S.module]; if (S.view === "team") FR.renderTeam?.(); else m?.render?.(); };
})();
