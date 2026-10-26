/* Future Ready Group System — device outbox (Stage 5).
   When the database cannot be reached, a save that is safe to send later is kept in this browser (IndexedDB) with its
   operation id, and sent again once the connection is back. The database applies each operation id at most once, so a
   change that is resent, or sent from two tabs, is never applied twice.

   What is NEVER kept for later (the person is told nothing was saved and must try again online):
     - payments and stock movements (money and numbered/stock records must not run later in a changed situation);
     - staff records, private staff details, staff documents and leave (personal data stays off shared devices);
     - deletions, and cancelling a job or leave request (destructive actions are never replayed automatically);
     - permission changes, invitations, settings and sign-in actions (they are named server functions, not records).
   Statuses of a kept change: waiting → sending → applied (then removed, with a toast) | conflict (kept until dismissed;
   the clashing value waits in Conflicts) | refused (the database said no; kept until discarded) | failed (5 errors that
   were not a lost connection, e.g. an expired session; "Try again" puts it back to waiting). Lost-connection retries
   continue on reconnect, on start and every 30 s, with the attempt count and last error shown in the panel.
   Wording rule: a kept change is described as "Saved on this device. Waiting to synchronize." and never as "Saved". */
(() => {
const FR = window.FR;
const { $, esc, toast, logAct } = FR;
const MSG = FR.QUEUED_MSG = "Saved on this device. Waiting to synchronize.";
const DB_NAME = "fr-outbox", STORE = "ops";
const NEVER_OFFLINE = {
  press_payments: "Payments are only recorded while connected, so nothing was saved. Record it again when you are back online.",
  staff: "Staff records are not kept on this device while offline, so nothing was saved. Try again when you are back online.",
  staff_documents: "Staff documents are not kept on this device while offline, so nothing was saved. Try again when you are back online.",
  leave_requests: "Leave is not kept on this device while offline, so nothing was saved. Try again when you are back online.",
  staff_private: "Private staff details are not kept on this device while offline, so nothing was saved. Try again when you are back online.",
  press_material_moves: "Stock movements are only recorded while connected, so nothing was saved. Record it again when you are back online.",
};
const STATUSES = FR.OUTBOX_STATUSES = ["waiting", "sending", "applied", "conflict", "refused", "failed"];
const LABEL = { roles: "Role", candidates: "Candidate", issues: "Issue", press_customers: "Customer", press_rate_items: "Rate card item", press_jobs: "Job", press_materials: "Material", press_material_moves: "Stock movement", press_files: "Job file", customer_requests: "Customer request", customer_request_messages: "Message to customer" };

/* ---------- storage ---------- */
let dbp = null;
const openDb = () => dbp || (dbp = new Promise((res, rej) => {
  try {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => { const s = r.result.createObjectStore(STORE, { keyPath: "op_id" }); s.createIndex("created", "created_at"); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error("outbox blocked"));
  } catch (e) { rej(e); }
}).catch(e => { dbp = null; throw e; }));
const run = async (mode, fn) => { const db = await openDb(); return new Promise((res, rej) => { const t = db.transaction(STORE, mode); const req = fn(t.objectStore(STORE)); t.oncomplete = () => res(req?.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error("aborted")); }); };
const all = async () => { try { return ((await run("readonly", s => s.getAll())) || []).sort((a, b) => a.created_at.localeCompare(b.created_at)); } catch { return []; } };
const put = e => run("readwrite", s => s.put(e));
const del = id => run("readwrite", s => s.delete(id));
const TAB = Math.random().toString(36).slice(2);
/** Claim one change for this tab before sending it (atomic: IndexedDB runs read-write transactions on a store one at a time).
 *  Another tab's claim younger than 30 seconds is respected, so two tabs never send the same change at the same time. */
const claim = async op_id => { const db = await openDb(); return new Promise(res => {
  const t = db.transaction(STORE, "readwrite"), st = t.objectStore(STORE); let won = false;
  const g = st.get(op_id); g.onsuccess = () => { const e = g.result;
    const free = !(e?.claimed_by && e.claimed_by !== TAB && Date.now() - e.claimed_at < 30000);   // a "sending" claim older than 30 s was interrupted
    if (e && (e.status === "waiting" || e.status === "sending") && free) { e.claimed_by = TAB; e.claimed_at = Date.now(); e.status = "sending"; st.put(e); won = e; } };
  t.oncomplete = () => res(won); t.onerror = t.onabort = () => res(false); }); };
const me = () => (FR.S.me?.email || "").toLowerCase();
const mine = async () => (await all()).filter(e => e.actor === me());

/* ---------- rules ---------- */
/** Why this change cannot wait on the device, or "" if it can. */
const refuse = (table, action, fields = {}) => {
  if (NEVER_OFFLINE[table]) return NEVER_OFFLINE[table];
  if (fields.stage === "cancelled" || fields.status === "cancelled") return "Cancelling is only done while connected, so nothing was saved. Try again when you are back online.";
  if (!["insert", "update", "save"].includes(action)) return "This change needs a connection. Nothing was saved.";
  return "";
};
/** Keep one operation for later. Returns true only if it is safely stored on the device. */
const queue = async ({ op_id, table, id, action, fields, base, label }) => {
  if (!me()) return false;
  try {
    await put({ op_id, table, id: id == null ? null : String(id), action, fields, base: base ?? null, actor: me(), company: FR.S.company || null,
      label: label || `${LABEL[table] || table} ${action === "insert" ? "added" : "changed"}`, created_at: new Date().toISOString(), attempts: 0, status: "waiting", last_error: "" });
    logAct("warn", `${label || LABEL[table] || table}: ${MSG}`); await paint(); return true;
  } catch { return false; }   // private window or storage blocked: the caller says nothing was saved
};

/* ---------- synchronizing ---------- */
let flushing = false;
const isNet = e => !e?.code && /fetch|network|load failed|timeout|aborted/i.test(e?.message || "");
async function flushNow() {
  if (flushing || !me() || !FR.SB || navigator.onLine === false) return;
  flushing = true;
  const tally = { synced: 0, conflicts: 0, refused: 0 };
  try {
    for (const listed of await mine()) {
      if (listed.status !== "waiting" && listed.status !== "sending") continue;
      const e = await claim(listed.op_id).catch(() => false); if (!e) continue;   // gone, or another tab is sending it
      const { data, error } = await FR.SB.rpc("apply_op", { p_op_id: e.op_id, p_entity: e.table, p_id: e.id, p_action: e.action, p_patch: e.fields, p_base_version: e.base });
      if (error) {   // still offline, or the session needs renewing: keep it, try later; give up visibly after 5 non-network errors
        e.attempts++; e.last_error = isNet(error) ? "No connection yet" : error.message; e.claimed_by = null;
        e.errors = isNet(error) ? (e.errors || 0) : (e.errors || 0) + 1;
        e.status = e.errors >= 5 ? "failed" : "waiting"; await put(e).catch(() => {});
        if (e.status === "failed") logAct("bad", `${e.label}: not synchronized after ${e.errors} errors. ${e.last_error}`);
        break;
      }
      if (data?.result === "applied" || data?.result === "duplicate") { await del(e.op_id); tally.synced++; logAct("ok", `${e.label}: synchronized`); }
      else if (data?.result === "conflict") { e.status = "conflict"; e.last_error = data.message || "Clashed with another change"; e.claimed_by = null; await put(e).catch(() => {}); tally.conflicts++; logAct("warn", `${e.label}: ${data.message}`); }
      else { e.status = "refused"; e.last_error = data?.message || "Not accepted"; e.attempts++; e.claimed_by = null; await put(e).catch(() => {}); tally.refused++; logAct("bad", `${e.label}: not synchronized. ${e.last_error}`); }
    }
  } finally { flushing = false; }
  if (tally.synced) toast(`${tally.synced} change${tally.synced > 1 ? "s" : ""} from this device synchronized`, "ok");
  if (tally.conflicts) toast(`${tally.conflicts} change${tally.conflicts > 1 ? "s" : ""} clashed with someone else's edit and were kept for a Group Admin to review`, "warn");
  if (tally.refused) toast(`${tally.refused} change${tally.refused > 1 ? "s" : ""} could not be synchronized. Open "Waiting to sync" to see why.`, "bad");
  await paint();
  if (tally.synced || tally.conflicts) FR.afterSync?.();
}
/** Run one synchronization at a time across all open tabs of this site. */
const flush = () => navigator.locks?.request ? navigator.locks.request("fr-outbox", { ifAvailable: true }, lock => lock ? flushNow() : null) : flushNow();

/* ---------- the "Waiting to sync" button and panel ---------- */
async function paint() {
  const b = $("#ob-btn"); if (!b) return;
  const list = await mine(); const waiting = list.filter(e => e.status === "waiting" || e.status === "sending").length, stuck = list.length - waiting;
  b.hidden = !list.length;
  b.classList.toggle("stuck", stuck > 0);
  $("#ob-cnt").textContent = list.length;
  b.title = `${waiting} waiting to synchronize${stuck ? `, ${stuck} need attention` : ""}`;
  if (!$("#ob-scrim").hidden) renderPanel(list);
}
const STATE_TXT = { waiting: "waiting", sending: "sending now", conflict: "clashed with another change", refused: "not accepted", failed: "stopped retrying" };
const ago = iso => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
function renderPanel(list) {
  const m = $("#ob-modal");
  m.innerHTML = `<h2 id="ob-title">Waiting to sync</h2>
    <p class="hint">These changes are saved on this device only. They are sent to the database automatically when the connection is back. Nobody else can see them until then.</p>
    <div class="ob-list">${list.map(e => `<div class="ob-row ${e.status}"><div><b>${esc(e.label)}</b><small>${ago(e.created_at)} · ${STATE_TXT[e.status] || e.status}${e.attempts ? ` · ${e.attempts} attempt${e.attempts > 1 ? "s" : ""}` : ""}${e.status === "refused" ? ` · <span class="bad">Not accepted: ${esc(e.last_error)}</span>` : e.status === "conflict" ? ` · ${esc(e.last_error)} A Group Admin decides it in Conflicts.` : e.last_error ? ` · ${esc(e.last_error)}` : ""}</small></div>
      ${e.status === "failed" ? `<button class="btn small" data-ob-retry="${e.op_id}">Try again</button>` : ""}${e.status === "conflict" ? `<button class="btn small" data-ob-del="${e.op_id}" data-quiet="1">Dismiss</button>` : `<button class="btn small danger" data-ob-del="${e.op_id}">Discard</button>`}</div>`).join("") || `<p class="muted">Nothing waiting.</p>`}</div>
    <div class="toolbar"><button class="btn primary" id="ob-sync"${navigator.onLine === false ? " disabled" : ""}>Sync now</button><button class="btn" id="ob-close">Close</button></div>`;
  $("#ob-close").onclick = () => { $("#ob-scrim").hidden = true; };
  $("#ob-sync").onclick = async () => { $("#ob-sync").disabled = true; $("#ob-sync").textContent = "Synchronizing…"; await flush(); await paint(); };
  m.querySelectorAll("[data-ob-retry]").forEach(x => x.onclick = async () => {
    const e = list.find(i => i.op_id === x.dataset.obRetry); e.status = "waiting"; e.errors = 0; await put(e).catch(() => {}); await flush(); await paint();
  });
  m.querySelectorAll("[data-ob-del]").forEach(x => x.onclick = async () => {
    const e = list.find(i => i.op_id === x.dataset.obDel);
    if (!x.dataset.quiet && !confirm(`Discard "${e.label}"? This change was never saved to the database and will be lost.`)) return;
    await del(e.op_id).catch(() => {}); logAct("warn", `${e.label}: discarded from this device`); await paint();
  });
}
async function openPanel() { $("#ob-scrim").hidden = false; renderPanel(await mine()); }

/** Before signing out: unsynchronized changes are removed from the device (they may hold personal data) after a clear warning. */
FR.outboxBeforeSignOut = async () => {
  const list = await mine(); if (!list.length) return true;
  if (navigator.onLine !== false) { await flush(); }
  const left = await mine(); if (!left.length) return true;
  if (!confirm(`${left.length} change${left.length > 1 ? "s have" : " has"} not reached the database yet.\n\nSigning out removes ${left.length > 1 ? "them" : "it"} from this device and ${left.length > 1 ? "they" : "it"} will be lost. Sign out anyway?`)) return false;
  for (const e of left) await del(e.op_id).catch(() => {});
  return true;
};

FR.outbox = { MSG, refuse, queue, flush, list: mine, paint, open: openPanel, _all: all, _del: del };
document.addEventListener("DOMContentLoaded", () => {
  $("#ob-btn")?.addEventListener("click", openPanel);
  $("#ob-scrim")?.addEventListener("click", e => { if (e.target.id === "ob-scrim") $("#ob-scrim").hidden = true; });
});
window.addEventListener("online", () => setTimeout(flush, 800));
document.addEventListener("visibilitychange", () => { if (!document.hidden) flush(); });
setInterval(async () => { if (me() && (await mine()).some(e => e.status === "waiting" || e.status === "sending")) flush(); }, 30000);
FR.outboxStart = async () => { await paint(); flush(); };   // called by the shell once the person is signed in
})();
