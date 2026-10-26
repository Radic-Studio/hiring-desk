/* Future Ready Group System — Press module (printing press).
   Redesign of 26 Oct 2026 (UI/UX spec §9): the screens follow the work, Enquiry/Quote → Approval → Job → Production →
   Ready/Delivery → Invoice/Payment, and every record stays connected to its customer, payments, files and stock.
   Tables: press_customers, press_rate_items, press_jobs, press_payments, press_materials, press_material_moves, press_files,
   customer_requests, company_settings(module='press'). Scoped to S.company. Data rules are unchanged (docs/UI_UX_DATA_CONTRACT.md):
   every change goes through FR.save (apply_op) or a named function; payments and stock moves never wait offline.
   There is no invoice table: a job's invoice is the job itself (number, total, payments, balance). */
(() => {
const FR = window.FR, S = FR.S;
const { $, esc, toast, logAct, notice, setCount, when, callFunction } = FR;
const SB = () => FR.SB;
const me = () => (S.me?.email || "").toLowerCase();
const myName = () => S.me?.name || "";
const role = () => FR.roleIn(S.company);
const canWrite = () => ["admin", "manager", "staff"].includes(role());
const canManage = () => ["admin", "manager"].includes(role());
const isAdmin = () => role() === "admin";
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const N = n => Number(n || 0);
const money = n => "₦" + N(n).toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const STAGES = ["quote", "accepted", "design", "proof", "print", "finishing", "ready", "delivered", "cancelled"];
const STAGE_LABEL = { quote: "Quote", accepted: "Job card", design: "Design", proof: "Proof", print: "Printing", finishing: "Finishing", ready: "Ready", delivered: "Delivered", cancelled: "Cancelled" };
const PROD = ["accepted", "design", "proof", "print", "finishing", "ready"];   // production board columns; "accepted" = job card, not started
const PROD_LABEL = { accepted: "To start", design: "Design", proof: "Proof", print: "Printing", finishing: "Finishing", ready: "Ready" };
const TRACK = ["quote", "accepted", "design", "proof", "print", "finishing", "ready", "delivered"];
const METHOD = { cash: "Cash", transfer: "Bank transfer", pos: "POS", other: "Other" };
const FILE_KIND = { artwork: "Artwork", proof: "Proof", reference: "Reference", other: "Other" };
const P = { all: { customers: [], rates: [], jobs: [], payments: [], materials: [], moves: [], files: [], requests: [], settings: {} },
  customers: [], rates: [], jobs: [], payments: [], materials: [], moves: [], files: [], requests: [], cfg: {}, loaded: false, started: false,
  f: {}, sort: {}, draft: null, draftFor: null, reqOpen: null, reqFilter: "open", quick: null, prodMode: "board", busy: false };
const fmtD = d => d ? new Date(d.length === 10 ? d + "T12:00:00" : d).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : "";
const fmtShort = d => d ? new Date(d.length === 10 ? d + "T12:00:00" : d).toLocaleDateString("en-NG", { day: "numeric", month: "short" }) : "";
const REQ_STATUS = { new: "New", quoted: "Quote sent", in_progress: "In progress", done: "Done", declined: "Declined" };
const DEFAULT_CFG = () => ({ business_name: FR.companyName(S.company), address: "Udeorji Street, Obiagu, Enugu", phone: "", email: "", prefix: (FR.companyShort(S.company) || "FR").replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "FRP", deposit_pct: 50, valid_days: 14, bank_name: "", account_name: "", account_number: "", terms: "Prices are valid for the period stated. Work starts when the deposit is received; the balance is due before delivery.", vat_pct: 0 });

/* ---------- data ---------- */
function scope() {
  const cid = S.company; const by = k => P.all[k].filter(x => x.company_id === cid);
  P.customers = by("customers"); P.requests = by("requests").sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")); P.rates = by("rates").sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)); P.jobs = by("jobs"); P.payments = by("payments"); P.materials = by("materials").sort((a, b) => a.name.localeCompare(b.name)); P.moves = by("moves"); P.files = by("files");
  P.cfg = { ...DEFAULT_CFG(), ...(P.all.settings[cid] || {}) };
  if (P.quick && !P.jobs.find(j => j.id === P.quick) && FR.drawer.isOpen()) closeDrawer();
}
async function load(what = ["customers", "rates", "jobs", "payments", "materials", "moves", "files", "requests", "settings"], live = false) {
  const T = { customers: "press_customers", rates: "press_rate_items", jobs: "press_jobs", payments: "press_payments", materials: "press_materials", moves: "press_material_moves", files: "press_files", requests: "customer_requests" };
  let failed = "";
  await Promise.all(what.map(async k => {
    if (k === "settings") { const { data } = await SB().from("company_settings").select("company_id,data").eq("module", "press"); P.all.settings = {}; for (const r of data || []) P.all.settings[r.company_id] = r.data || {}; return; }
    const { data, error } = await FR.live(SB().from(T[k]).select("*"), T[k]).limit(5000); if (error) { failed = `Could not load ${k}: ${error.message}`; return; } P.all[k] = data || [];
  }));
  P.loaded = true; P.loadError = failed; if (failed) notice("bad", failed);
  scope(); render(live); FR.attentionChanged?.();
  if (P.quick && FR.drawer.isOpen()) paintQuick();
  if (P.reqOpen && FR.drawer.isOpen()) openRequest(P.reqOpen, true);
}

/* ---------- derived facts (no new data: everything comes from the job, its payments and the date) ---------- */
const paidOf = j => P.payments.filter(p => p.job_id === j.id).reduce((s, p) => s + N(p.amount), 0);
const balanceOf = j => Math.max(0, N(j.total) - paidOf(j));
const depositOf = j => Math.round(N(j.total) * N(j.deposit_pct)) / 100;
const isOpenJob = j => !["quote", "delivered", "cancelled"].includes(j.stage);
const billable = j => !["quote", "cancelled"].includes(j.stage);
const custName = j => j.customer_name || (P.customers.find(c => c.id === j.customer_id) || {}).name || "—";
const custOf = j => P.customers.find(c => c.id === j.customer_id);
const owner = j => (j.assigned_to || "").trim();
const isMine = j => owner(j) && myName() && owner(j).toLowerCase() === myName().toLowerCase();
const overdue = j => isOpenJob(j) && j.due_date && j.due_date < today();
const dueToday = j => isOpenJob(j) && j.due_date === today();
function dueInfo(j) {
  if (!j.due_date) return { cls: "ok", text: isOpenJob(j) ? "No due date" : "—", days: null };
  if (!isOpenJob(j)) return { cls: "ok", text: fmtShort(j.due_date), days: null };
  const d = Math.round((Date.parse(j.due_date) - Date.parse(today())) / 864e5);
  if (d < 0) return { cls: "bad", text: `Overdue ${-d} day${d === -1 ? "" : "s"}`, days: d };
  if (d === 0) return { cls: "warn", text: "Due today", days: 0 };
  if (d === 1) return { cls: "warn", text: "Due tomorrow", days: 1 };
  return { cls: "ok", text: `Due ${fmtShort(j.due_date)}`, days: d };
}
/** Why a job cannot move, worked out from what is recorded. (A typed "blocker" field would need a database change.) */
function blockers(j) {
  const out = [];
  if (!isOpenJob(j)) return out;
  if (j.stage === "proof" && !j.proof_approved_at) out.push("Awaiting proof approval");
  if (["accepted", "design"].includes(j.stage) && N(j.deposit_pct) > 0 && paidOf(j) + 0.01 < depositOf(j)) out.push("Awaiting deposit");
  return out;
}
const quoteUntil = j => { const from = (j.quoted_at || j.created_at || "").slice(0, 10); return from ? addDays(from, N(j.valid_days) || 14) : ""; };
function quoteStatus(j) {
  const until = quoteUntil(j); const d = until ? Math.round((Date.parse(until) - Date.parse(today())) / 864e5) : 99;
  if (until && d < 0) return { key: "expired", label: "Expired", cls: "bad" };
  if (!j.sent_at) return { key: "draft", label: "Draft", cls: "" };
  if (d <= 3) return { key: "expiring", label: d === 0 ? "Expires today" : `Expires in ${d} day${d === 1 ? "" : "s"}`, cls: "warn" };
  return { key: "sent", label: "Sent", cls: "info" };
}
function payStatus(j) {
  if (j.stage === "cancelled") return { key: "cancelled", label: "Cancelled", cls: "" };
  const paid = paidOf(j), bal = balanceOf(j);
  if (N(j.total) > 0 && bal <= 0.005) return { key: "paid", label: "Paid", cls: "ok" };
  if (j.due_date && j.due_date < today() && bal > 0) return { key: "overdue", label: paid > 0 ? "Part-paid, overdue" : "Overdue", cls: "bad" };
  if (paid > 0) return { key: "part", label: "Part-paid", cls: "warn" };
  return { key: "unpaid", label: "Unpaid", cls: "" };
}
const ageBucket = j => { if (!j.due_date || balanceOf(j) <= 0 || j.stage === "cancelled") return null; const d = Math.round((Date.parse(today()) - Date.parse(j.due_date)) / 864e5); return d < 0 ? null : d === 0 ? "today" : d <= 7 ? "1-7" : d <= 30 ? "8-30" : "30+"; };
const isLow = m => N(m.quantity) <= N(m.reorder_level);
const qtyOf = j => (j.items || []).reduce((s, i) => s + N(i.qty), 0);
const summaryOf = j => j.title || (j.items || [])[0]?.description || "(untitled)";
async function nextNumber(kind) { const { data, error } = await SB().rpc("next_number", { p_company: S.company, p_kind: kind }); if (error) throw new Error(error.message); return `${P.cfg.prefix}-${kind}-${String(data).padStart(4, "0")}`; }
const calcTotals = (items, discount, vat) => { const subtotal = items.reduce((s, i) => s + N(i.total), 0); const afterDisc = Math.max(0, subtotal - N(discount)); const vatAmt = Math.round(afterDisc * N(vat) / 100 * 100) / 100; return { subtotal, vat: vatAmt, total: afterDisc + vatAmt }; };
const demoNote = list => { const d = (list || P.jobs).filter(j => FR.isDemo(j.number)); return d.length ? `<div class="banner info">Includes ${d.length} DEMO job${d.length > 1 ? "s" : ""} (numbers starting DEMO-). Their amounts are test figures, not real business.</div>` : ""; };
const roBanner = () => canWrite() ? "" : `<div class="banner warn">You have view-only access in ${esc(FR.companyShort(S.company))}. You can read and download; Staff, Managers and Admins can change records.</div>`;
const pill = (cls, text) => `<span class="pill ${cls} flat">${esc(text)}</span>`;
const stagePill = j => pill(j.stage === "delivered" ? "ok" : j.stage === "cancelled" ? "" : j.stage === "quote" ? "accent" : "info", STAGE_LABEL[j.stage]);
const jobLink = j => `<a class="rowlink mono" href="${FR.href(j.stage === "quote" ? "press-quote" : "press-job", j.id)}" data-job="${j.id}">${esc(j.number)}</a>`;
const csvCell = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
function downloadCsv(name, head, rows) {
  const txt = "﻿" + [head, ...rows].map(r => r.map(csvCell).join(",")).join("\r\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([txt], { type: "text/csv" })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  logAct("ok", `Downloaded ${name}`);
}
// state skeleton while the first load runs
const skeletonTable = (n = 6) => `<div class="table-wrap"><table><tbody>${Array.from({ length: n }, () => `<tr><td><span class="skeleton" style="width:70%"></span></td><td><span class="skeleton" style="width:50%"></span></td><td><span class="skeleton" style="width:40%"></span></td><td><span class="skeleton" style="width:30%"></span></td></tr>`).join("")}</tbody></table></div>`;

/* ---------- a table that becomes a card list on phones (spec §12.1) ----------
   cols: [{ key, label, cls, html(row), sort(row) (optional), card: "title"|"meta"|"hide" }] */
function dataTable(view, { cols, rows, empty, key = r => r.id, caption }) {
  const st = P.sort[view] || {};
  if (st.key) { const c = cols.find(x => x.key === st.key); if (c?.sort) rows = rows.slice().sort((a, b) => { const x = c.sort(a), y = c.sort(b); return (x > y ? 1 : x < y ? -1 : 0) * (st.dir === "desc" ? -1 : 1); }); }
  if (!rows.length) return empty;
  const th = c => `<th scope="col" class="${(c.cls || "").replace("mono", "")}" ${c.sort ? `aria-sort="${st.key === c.key ? (st.dir === "desc" ? "descending" : "ascending") : "none"}"` : ""}>${c.sort ? `<button type="button" data-sort="${c.key}">${esc(c.label)}</button>` : esc(c.label)}</th>`;
  return `<div class="table-wrap tall"><table>${caption ? `<caption class="sr-only">${esc(caption)}</caption>` : ""}<thead><tr>${cols.map(th).join("")}</tr></thead><tbody>${rows.map(r => `<tr data-row="${esc(key(r))}">${cols.map(c => `<td class="${c.cls || ""}">${c.html(r)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    <ul class="rcards">${rows.map(r => `<li class="rcard" data-row="${esc(key(r))}"><div class="rc-top">${cols.filter(c => c.card === "title").map(c => `<span>${c.html(r)}</span>`).join("")}</div>${cols.filter(c => c.card === "meta").map(c => `<div class="rc-line"><span class="rc-k">${esc(c.label)}</span><span>${c.html(r)}</span></div>`).join("")}</li>`).join("")}</ul>`;
}
function wireTable(el, view, rerender) {
  el.querySelectorAll("[data-sort]").forEach(b => b.onclick = () => { const st = P.sort[view] || {}; P.sort[view] = { key: b.dataset.sort, dir: st.key === b.dataset.sort && st.dir !== "desc" ? "desc" : "asc" }; rerender(); });
  el.querySelectorAll("a[data-job]").forEach(a => a.onclick = e => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); openJobQuick(a.dataset.job, a); });
}
const filterChips = (view, labels) => { const f = P.f[view] || {}; const on = Object.entries(labels).filter(([k]) => f[k]); return on.length ? `<div class="fchips" aria-label="Active filters">${on.map(([k, lab]) => `<span class="fchip">${esc(lab(f[k]))}<button type="button" data-clear="${k}" aria-label="Remove filter ${esc(lab(f[k]))}">×</button></span>`).join("")}<button type="button" class="btn small ghost" data-clear="*">Clear all</button></div>` : ""; };
function wireFilters(el, view, rerender) {
  el.querySelectorAll("[data-f]").forEach(i => { const ev = i.tagName === "INPUT" && i.type === "search" ? "input" : "change"; i.addEventListener(ev, () => { (P.f[view] = P.f[view] || {})[i.dataset.f] = i.value; rerender(i.type === "search" ? i.dataset.f : null); }); });
  el.querySelectorAll("[data-chip]").forEach(b => b.onclick = () => { const [k, v] = b.dataset.chip.split("="); const f = (P.f[view] = P.f[view] || {}); f[k] = f[k] === v ? "" : v; rerender(); });
  el.querySelectorAll("[data-clear]").forEach(b => b.onclick = () => { if (b.dataset.clear === "*") P.f[view] = {}; else (P.f[view] = P.f[view] || {})[b.dataset.clear] = ""; rerender(); });
}
// keep the caret in a search box after a re-render
const refocus = id => { if (!id) return; const i = document.querySelector(`[data-f="${id}"]`); if (i) { i.focus(); const v = i.value; i.setSelectionRange?.(v.length, v.length); } };

/* ---------- save results, worded per the data contract ---------- */
// returns "ok" | "queued" | false. Queued changes are never called "Saved".
function outcome(res, okMsg, errEl) {
  if (res?.error?.code === "queued") { toast(FR.QUEUED_MSG, "warn"); return "queued"; }
  if (res?.error) { const m = res.error.message || "Not saved"; if (errEl) errEl.textContent = m; else toast(m, "bad"); return false; }
  if (okMsg) toast(okMsg, "ok"); return "ok";
}
const hist = (j, summary) => [...(j.history || []), { ts: new Date().toISOString(), by: me(), summary }].slice(-100);
const goJob = j => FR.openRecord(j.stage === "quote" ? "press-quote" : "press-job", j.id);
const newQuote = (prefill) => { P.draft = prefill || null; P.draftFor = prefill ? "new" : null; FR.openRecord("press-quote", "new"); };

/* ---------- views ---------- */
const VIEW_FN = () => ({ "press-overview": renderOverview, "press-quotes": renderQuotes, "press-quote": renderQuoteEditor, "press-jobs": renderJobs, "press-job": renderJobPage, "press-production": renderProduction, "press-requests": renderRequests, "press-customers": renderCustomers, "press-customer": renderCustomerPage, "press-materials": renderMaterials, "press-money": renderMoney, "press-reports": renderReports, "press-rates": renderRates });
function counts() {
  const put = (v, n) => { const c = $("#cnt-" + v); if (c) { c.textContent = n; c.hidden = !n; } };
  put("press-quotes", P.jobs.filter(j => j.stage === "quote").length);
  put("press-jobs", P.jobs.filter(isOpenJob).length);
  put("press-production", P.jobs.filter(j => isOpenJob(j) && overdue(j)).length);
  put("press-requests", P.requests.filter(r => r.status === "new").length);
  put("press-materials", P.materials.filter(isLow).length);
  put("press-money", P.jobs.filter(j => billable(j) && payStatus(j).key === "overdue").length);
}
function render(live) {
  if (!S.me) return;
  counts();
  if (S.module !== "press") return;
  const fn = VIEW_FN()[S.view]; const el = $("#v-" + S.view); if (!fn || !el) return;
  // a change arriving from someone else must not wipe what this person is typing: repaint when they leave the field
  const a = document.activeElement;
  if (live === true && el.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== "search") { if (!P.pending) { P.pending = true; a.addEventListener("blur", () => setTimeout(() => { P.pending = false; if (!el.contains(document.activeElement) || !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) render(); }, 0), { once: true }); } return; }
  if (!P.loaded) { el.innerHTML = skeletonTable(); return; }
  if (P.loadError && !P.jobs.length) { el.innerHTML = `<div class="empty"><h2>Press records could not load</h2><p>${esc(P.loadError)}</p><button class="btn primary" id="p-retry">Try again</button></div>`; $("#p-retry").onclick = () => { P.loaded = false; render(); load(); }; return; }
  fn(el);
}

/* ---------- Overview (spec §9.1): what needs action today, then the work coming up ---------- */
function attentionGroups() {
  const open = P.jobs.filter(isOpenJob);
  const job = j => ({ title: `${j.number} · ${summaryOf(j)}`, meta: `${custName(j)} · ${dueInfo(j).text}${owner(j) ? " · " + owner(j) : ""}`, go: () => goJob(j) });
  const jobsView = v => () => { P.f["press-jobs"] = { view: v }; FR.setView("press-jobs"); };
  const overdueJ = open.filter(overdue).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const proofs = open.filter(j => j.stage === "proof" && !j.proof_approved_at);
  const todayJ = open.filter(dueToday);
  const deposit = open.filter(j => blockers(j).includes("Awaiting deposit"));
  const low = P.materials.filter(isLow);
  const unpaid = P.jobs.filter(j => ["ready", "delivered"].includes(j.stage) && balanceOf(j) > 0);
  const reqs = P.requests.filter(r => r.status === "new");
  const expiring = P.jobs.filter(j => j.stage === "quote" && ["expiring"].includes(quoteStatus(j).key));
  return [
    { id: "overdue", level: "bad", label: "Overdue jobs", count: overdueJ.length, hint: "past their due date", go: jobsView("overdue"), items: overdueJ.slice(0, 5).map(job) },
    { id: "proofs", level: "warn", label: "Proofs waiting", count: proofs.length, hint: "customer has not approved", go: jobsView("proof"), items: proofs.slice(0, 4).map(j => ({ ...job(j), meta: `${custName(j)} · proof not approved` })) },
    { id: "today", level: "warn", label: "Due today", count: todayJ.length, hint: "must be ready today", go: jobsView("today"), items: todayJ.slice(0, 4).map(job) },
    { id: "deposit", level: "warn", label: "Awaiting deposit", count: deposit.length, hint: "work should not start yet", go: jobsView("blocked"), items: deposit.slice(0, 4).map(j => ({ ...job(j), meta: `${custName(j)} · deposit ${money(depositOf(j))}, paid ${money(paidOf(j))}` })) },
    { id: "unpaid", level: "warn", label: "Money to collect", count: unpaid.length, hint: `${money(unpaid.reduce((s, j) => s + balanceOf(j), 0))} on ready or delivered jobs`, go: () => { P.f["press-money"] = { status: "open" }; FR.setView("press-money"); }, items: unpaid.slice(0, 4).map(j => ({ ...job(j), meta: `${custName(j)} · owes ${money(balanceOf(j))}` })) },
    { id: "low", level: "warn", label: "Low stock", count: low.length, hint: "at or below reorder level", go: () => { P.f["press-materials"] = { view: "low" }; FR.setView("press-materials"); }, items: low.slice(0, 3).map(m => ({ title: m.name, meta: `${N(m.quantity)} ${m.unit} left · reorder at ${N(m.reorder_level)}`, go: () => { P.f["press-materials"] = { view: "low" }; FR.setView("press-materials"); } })) },
    { id: "requests", level: "info", label: "New requests", count: reqs.length, hint: "from the customer link", go: () => { P.reqFilter = "new"; FR.setView("press-requests"); }, items: reqs.slice(0, 3).map(r => ({ title: `${r.ref} · ${r.title}`, meta: `${r.contact_name || r.contact_email} · ${when(r.created_at)}`, go: () => { FR.setView("press-requests"); openRequest(r.id); } })) },
    { id: "expiring", level: "info", label: "Quotes expiring", count: expiring.length, hint: "within 3 days", go: () => { P.f["press-quotes"] = { status: "expiring" }; FR.setView("press-quotes"); }, items: expiring.slice(0, 3).map(j => ({ title: `${j.number} · ${summaryOf(j)}`, meta: `${custName(j)} · ${quoteStatus(j).label}`, go: () => goJob(j) })) },
  ];
}
function renderOverview(el) {
  const groups = attentionGroups(); const LV = { bad: 0, warn: 1, info: 2 };
  const items = groups.filter(g => g.count).flatMap(g => g.items.map(it => ({ ...it, level: g.level, group: g.label }))).sort((a, b) => LV[a.level] - LV[b.level]);
  const open = P.jobs.filter(isOpenJob);
  const week = addDays(today(), 7);
  const upcoming = open.filter(j => j.due_date && j.due_date >= today() && j.due_date <= week).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const month = today().slice(0, 7);
  const owing = P.jobs.filter(j => billable(j) && balanceOf(j) > 0);
  el.innerHTML = `${roBanner()}${demoNote()}
    <div class="stat-row wide7">${groups.filter(g => g.id !== "expiring").map((g, i) => `<button type="button" class="stat ${g.count ? g.level : "clear"}" data-g="${g.id}"><span class="stat-label">${esc(g.label)}</span><span class="stat-value">${g.count}</span><span class="stat-hint">${esc(g.count ? g.hint : "all clear")}</span></button>`).join("")}</div>
    <div class="grid-2">
      <section class="panel" aria-labelledby="po-att"><div class="panel-head"><h2 id="po-att">Needs attention</h2><span class="muted">${items.length ? `${Math.min(items.length, 10)} of ${items.length}` : ""}</span></div>
        ${items.length ? `<ul class="att-list">${items.slice(0, 10).map((it, i) => `<li><span class="lv ${it.level}" aria-hidden="true"></span><button type="button" class="att-main" data-i="${i}"><b>${esc(it.title)}</b><span>${esc(it.meta)}</span></button><span class="att-tag">${esc(it.group)}</span></li>`).join("")}</ul>` : `<div class="empty-inline">Nothing is late or blocked. New work will show here.</div>`}
      </section>
      <section class="panel" aria-labelledby="po-prod"><div class="panel-head"><h2 id="po-prod">Production today</h2><a href="${FR.href("press-production")}" data-v="press-production">Open board</a></div>
        <ul class="stage-sum">${PROD.map(st => { const n = open.filter(j => j.stage === st).length; const late = open.filter(j => j.stage === st && overdue(j)).length; return `<li><a href="${FR.href("press-production")}" data-stage="${st}"><span>${PROD_LABEL[st]}</span><b class="num">${n}</b>${late ? `<span class="due bad">${late} overdue</span>` : ""}</a></li>`; }).join("")}</ul>
        ${canManage() ? `<div class="panel-head" style="margin:20px 0 8px"><h2>Money</h2><a href="${FR.href("press-money")}" data-v="press-money">Invoices &amp; payments</a></div>
        <dl class="kv big"><dt>Outstanding</dt><dd><span class="num">${money(owing.reduce((s, j) => s + balanceOf(j), 0))}</span> <span class="muted">on ${owing.length} job${owing.length === 1 ? "" : "s"}</span></dd>
          <dt>Overdue</dt><dd class="num">${money(owing.filter(j => payStatus(j).key === "overdue").reduce((s, j) => s + balanceOf(j), 0))}</dd>
          <dt>Received this month</dt><dd class="num">${money(P.payments.filter(p => (p.paid_at || "").startsWith(month)).reduce((s, p) => s + N(p.amount), 0))}</dd></dl>` : ""}
      </section>
    </div>
    <section class="panel" aria-labelledby="po-up"><div class="panel-head"><h2 id="po-up">Due in the next 7 days</h2><a href="${FR.href("press-jobs")}" data-v="press-jobs">All jobs</a></div>
      ${upcoming.length ? dataTable("po-up", { caption: "Jobs due in the next 7 days", rows: upcoming, empty: "", cols: [
        { key: "n", label: "Number", cls: "mono", html: jobLink, card: "title" }, { key: "t", label: "Job", html: j => esc(summaryOf(j)), card: "title" },
        { key: "c", label: "Customer", html: j => esc(custName(j)), card: "meta" }, { key: "s", label: "Stage", html: stagePill, card: "meta" },
        { key: "d", label: "Due", html: j => { const d = dueInfo(j); return `<span class="due ${d.cls}">${esc(d.text)}</span>`; }, card: "meta" },
        { key: "o", label: "Owner", html: j => esc(owner(j) || "—"), card: "meta" }, { key: "b", label: "Blocked by", html: j => blockers(j).map(b => `<span class="flag">${esc(b)}</span>`).join(" ") || "—", card: "meta" }] })
      : `<div class="empty-inline">Nothing due in the next 7 days.${canWrite() ? " New quotes start from the button above." : ""}</div>`}
    </section>`;
  el.querySelectorAll("[data-g]").forEach(b => b.onclick = () => groups.find(g => g.id === b.dataset.g).go());
  el.querySelectorAll(".att-main").forEach(b => b.onclick = () => items[+b.dataset.i].go());
  el.querySelectorAll("a[data-v]").forEach(a => a.onclick = e => { e.preventDefault(); FR.setView(a.dataset.v); });
  el.querySelectorAll("a[data-stage]").forEach(a => a.onclick = e => { e.preventDefault(); P.f["press-production"] = { stage: a.dataset.stage }; FR.setView("press-production"); });
  wireTable(el, "po-up", () => renderOverview(el));
}

/* ---------- Quotes (spec §9.2) ---------- */
const QSTAT = { draft: "Draft", sent: "Sent", expiring: "Expiring", expired: "Expired" };
function renderQuotes(el, focusId) {
  const f = P.f["press-quotes"] || {}; const q = (f.q || "").toLowerCase();
  const all = P.jobs.filter(j => j.stage === "quote");
  let list = all.filter(j => (!f.status || quoteStatus(j).key === f.status || (f.status === "sent" && quoteStatus(j).key === "sent")) && (!q || [j.number, j.title, custName(j), owner(j)].join(" ").toLowerCase().includes(q)));
  if (!(P.sort["press-quotes"] || {}).key) list = list.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
  const cnt = k => all.filter(j => quoteStatus(j).key === k).length;
  const cols = [
    { key: "num", label: "Quote", cls: "mono", html: jobLink, sort: j => j.number, card: "title" },
    { key: "cust", label: "Customer", html: j => esc(custName(j)), sort: j => custName(j).toLowerCase(), card: "title" },
    { key: "sum", label: "Job", html: j => esc(summaryOf(j)), card: "meta" },
    { key: "qty", label: "Quantity", cls: "r", html: j => qtyOf(j) ? qtyOf(j).toLocaleString("en-NG") : "—", sort: qtyOf },
    { key: "tot", label: "Total", cls: "money", html: j => money(j.total), sort: j => N(j.total), card: "meta" },
    { key: "st", label: "Status", html: j => { const s = quoteStatus(j); return pill(s.cls, s.label); }, sort: j => quoteStatus(j).key, card: "meta" },
    { key: "until", label: "Valid until", html: j => fmtShort(quoteUntil(j)) || "—", sort: quoteUntil },
    { key: "own", label: "Owner", html: j => esc(owner(j) || "—"), sort: owner },
    { key: "upd", label: "Updated", html: j => fmtShort((j.updated_at || "").slice(0, 10)) || "—", sort: j => j.updated_at || "" },
    { key: "act", label: "Actions", html: j => `<span class="row-acts"><a class="btn small" href="${FR.href("press-quote", j.id)}" data-open-q="${j.id}">Open</a>${canWrite() ? `<button class="btn small ghost" data-dup="${j.id}">Duplicate</button>` : ""}<button class="btn small ghost" data-pdf="${j.id}" aria-label="Download ${esc(j.number)} as PDF">PDF</button></span>`, card: "meta" },
  ];
  el.innerHTML = `${roBanner()}
    <div class="toolbar"><input type="search" data-f="q" placeholder="Search quote, customer, job…" aria-label="Search quotes" value="${esc(f.q || "")}">
      <div class="chips" role="group" aria-label="Quote status">${[["", "All open", all.length], ["draft", "Draft", cnt("draft")], ["sent", "Sent", cnt("sent")], ["expiring", "Expiring", cnt("expiring")], ["expired", "Expired", cnt("expired")]].map(([k, l, n]) => `<button type="button" class="chip" aria-pressed="${(f.status || "") === k}" data-chip="status=${k}">${l}<span class="cnt">${n}</span></button>`).join("")}</div>
      <span class="spacer"></span><button class="btn" id="pq-csv" ${list.length ? "" : "disabled"}>Export CSV</button></div>
    ${P.rates.length && P.rates.every(r => N(r.price) === 0) && canManage() ? `<div class="banner warn">The rate card has no prices yet. Add them in Settings so new quotes fill themselves in.</div>` : ""}
    ${dataTable("press-quotes", { caption: "Open quotes", rows: list, cols, empty: all.length
      ? `<div class="empty"><h2>No quotes match these filters</h2><p>Clear the filters to see all ${all.length} open quote${all.length === 1 ? "" : "s"}.</p><button class="btn" data-clear="*">Clear filters</button></div>`
      : `<div class="empty"><h2>No open quotes</h2><p>${canWrite() ? "Start one with New quote. Accepted quotes move to Jobs." : "Quotes appear here when staff create them."}</p></div>` })}`;
  wireFilters(el, "press-quotes", id => renderQuotes(el, id)); wireTable(el, "press-quotes", () => renderQuotes(el)); refocus(focusId);
  el.querySelectorAll("[data-open-q]").forEach(a => a.onclick = e => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); FR.openRecord("press-quote", a.dataset.openQ); });
  el.querySelectorAll("a[data-job]").forEach(a => a.onclick = e => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); FR.openRecord("press-quote", a.dataset.job); });
  el.querySelectorAll("[data-dup]").forEach(b => b.onclick = () => duplicateQuote(P.jobs.find(j => j.id === b.dataset.dup)));
  el.querySelectorAll("[data-pdf]").forEach(b => b.onclick = () => { const j = P.jobs.find(x => x.id === b.dataset.pdf); savePdf(quotePdf(j), `${j.number}.pdf`); });
  $("#pq-csv").onclick = () => downloadCsv(`quotes-${today()}.csv`, ["Quote", "Customer", "Job", "Quantity", "Total", "Status", "Valid until", "Owner", "Updated"], list.map(j => [j.number, custName(j), summaryOf(j), qtyOf(j), N(j.total), quoteStatus(j).label, quoteUntil(j), owner(j), (j.updated_at || "").slice(0, 10)]));
}
function duplicateQuote(j) {
  newQuote({ title: j.title, description: j.description, customer_id: j.customer_id, customer_name: custName(j), items: (j.items || []).map(x => ({ ...x })), discount: N(j.discount), deposit_pct: N(j.deposit_pct), valid_days: N(j.valid_days) || N(P.cfg.valid_days), due_date: "", specs: { ...(j.specs || {}) }, notes: "", assigned_to: owner(j) });
  toast(`Copy of ${j.number}. It gets its own number when you save it.`);
}

/* ---------- Jobs (spec §9.4): saved views, filters, quick view ---------- */
const JOB_VIEWS = [["active", "All active"], ["mine", "My work"], ["overdue", "Overdue"], ["today", "Due today"], ["blocked", "Blocked"], ["proof", "Proof waiting"], ["ready", "Ready"], ["delivered", "Delivered"], ["cancelled", "Cancelled"]];
const jobViewTest = v => ({ active: isOpenJob, mine: j => isOpenJob(j) && isMine(j), overdue, today: dueToday, blocked: j => blockers(j).length > 0, proof: j => isOpenJob(j) && j.stage === "proof" && !j.proof_approved_at, ready: j => j.stage === "ready", delivered: j => j.stage === "delivered", cancelled: j => j.stage === "cancelled" })[v] || isOpenJob;
function renderJobs(el, focusId) {
  const f = P.f["press-jobs"] || {}; const v = f.view || "active"; const q = (f.q || "").toLowerCase();
  const jobs = P.jobs.filter(j => j.stage !== "quote");
  const owners = [...new Set(jobs.map(owner).filter(Boolean))].sort();
  let list = jobs.filter(jobViewTest(v)).filter(j => (!f.stage || j.stage === f.stage) && (!f.owner || owner(j) === f.owner) && (!q || [j.number, j.title, custName(j), owner(j), j.description].join(" ").toLowerCase().includes(q)));
  if (!(P.sort["press-jobs"] || {}).key) list = list.sort((a, b) => (["delivered", "cancelled"].includes(v) ? (b.delivered_at || b.updated_at || "").localeCompare(a.delivered_at || a.updated_at || "") : (a.due_date || "9999").localeCompare(b.due_date || "9999")));
  const n = k => jobs.filter(jobViewTest(k)).length;
  const cols = [
    { key: "num", label: "Job", cls: "mono", html: jobLink, sort: j => j.number, card: "title" },
    { key: "sum", label: "Description", html: j => `${esc(summaryOf(j))}${qtyOf(j) ? `<span class="sub">${qtyOf(j).toLocaleString("en-NG")} pcs</span>` : ""}`, card: "title" },
    { key: "cust", label: "Customer", html: j => esc(custName(j)), sort: j => custName(j).toLowerCase(), card: "meta" },
    { key: "st", label: "Stage", html: stagePill, sort: j => STAGES.indexOf(j.stage), card: "meta" },
    { key: "due", label: "Due", html: j => { const d = dueInfo(j); return `<span class="due ${d.cls}">${esc(d.text)}</span>`; }, sort: j => j.due_date || "9999", card: "meta" },
    { key: "own", label: "Owner", html: j => esc(owner(j) || "—"), sort: owner, card: "meta" },
    { key: "bal", label: "Balance", cls: "money", html: j => balanceOf(j) > 0 ? money(balanceOf(j)) : `<span class="muted">Paid</span>`, sort: balanceOf, card: "meta" },
    { key: "blk", label: "Blocked by", html: j => blockers(j).map(b => `<span class="flag">${esc(b)}</span>`).join(" ") || "—", card: "meta" },
  ];
  el.innerHTML = `${roBanner()}
    <div class="chips" role="group" aria-label="Saved views">${JOB_VIEWS.map(([k, l]) => `<button type="button" class="chip" aria-pressed="${v === k}" data-chip="view=${k}">${l}<span class="cnt">${n(k)}</span></button>`).join("")}</div>
    <div class="toolbar"><input type="search" data-f="q" placeholder="Search job, customer, owner…" aria-label="Search jobs" value="${esc(f.q || "")}">
      <select data-f="stage" aria-label="Stage"><option value="">Any stage</option>${STAGES.filter(s => s !== "quote").map(s => `<option value="${s}" ${f.stage === s ? "selected" : ""}>${STAGE_LABEL[s]}</option>`).join("")}</select>
      <select data-f="owner" aria-label="Owner"><option value="">Any owner</option>${owners.map(o => `<option ${f.owner === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>
      <span class="spacer"></span><button class="btn" id="pj-csv" ${list.length ? "" : "disabled"}>Export CSV</button></div>
    ${filterChips("press-jobs", { stage: s => "Stage: " + STAGE_LABEL[s], owner: o => "Owner: " + o })}
    ${v === "mine" && !myName() ? `<div class="banner warn">Your profile has no name, so no jobs can be matched to you. Add your name in your profile.</div>` : ""}
    ${dataTable("press-jobs", { caption: "Jobs", rows: list, cols, empty: jobs.length
      ? `<div class="empty"><h2>No jobs in this view</h2><p>${v === "overdue" ? "Nothing is overdue." : v === "blocked" ? "Nothing is waiting on a proof or deposit." : "Try another view or clear the filters."}</p>${f.stage || f.owner || f.q ? `<button class="btn" data-clear="*">Clear filters</button>` : ""}</div>`
      : `<div class="empty"><h2>No jobs yet</h2><p>A job starts when a customer accepts a quote.</p>${canWrite() ? `<button class="btn primary" id="pj-new">New quote</button>` : ""}</div>` })}`;
  wireFilters(el, "press-jobs", id => renderJobs(el, id)); wireTable(el, "press-jobs", () => renderJobs(el)); refocus(focusId);
  $("#pj-new")?.addEventListener("click", () => newQuote());
  $("#pj-csv").onclick = () => downloadCsv(`jobs-${v}-${today()}.csv`, ["Job", "Description", "Customer", "Stage", "Due", "Owner", "Total", "Paid", "Balance", "Blocked by"], list.map(j => [j.number, summaryOf(j), custName(j), STAGE_LABEL[j.stage], j.due_date || "", owner(j), N(j.total), paidOf(j), balanceOf(j), blockers(j).join("; ")]));
}

/* ---------- Production (spec §9.5): board by stage; a menu moves a card, no drag needed ---------- */
function renderProduction(el, focusId) {
  const f = P.f["press-production"] || {}; const q = (f.q || "").toLowerCase(); const mode = P.prodMode;
  const owners = [...new Set(P.jobs.filter(isOpenJob).map(owner).filter(Boolean))].sort();
  const pass = j => (!q || [j.number, j.title, custName(j)].join(" ").toLowerCase().includes(q)) && (!f.owner || owner(j) === f.owner) && (!f.due || (f.due === "overdue" ? overdue(j) : f.due === "today" ? dueToday(j) : f.due === "week" ? (j.due_date && j.due_date <= addDays(today(), 7)) : true)) && (!f.stage || j.stage === f.stage);
  const open = P.jobs.filter(j => PROD.includes(j.stage)).filter(pass).sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999"));
  const delivered = P.jobs.filter(j => j.stage === "delivered" && (j.delivered_at || "") >= addDays(today(), -14)).filter(pass);
  const move = j => canWrite() ? `<label class="sr-only" for="mv-${j.id}">Move ${esc(j.number)} to</label><select class="stage-move" id="mv-${j.id}" data-move="${j.id}"><option value="">Move to…</option>${PROD.concat(["delivered"]).filter(s => s !== j.stage).map(s => `<option value="${s}">${s === "delivered" ? "Delivered" : PROD_LABEL[s]}</option>`).join("")}</select>` : "";
  const card = j => { const d = dueInfo(j); const bl = blockers(j); return `<li class="pcard ${d.cls === "bad" ? "late" : ""}"><div class="pc-top">${jobLink(j)}<span class="due ${d.cls}">${esc(d.text)}</span></div><div class="pc-name">${esc(summaryOf(j))}</div><div class="pc-meta">${esc(custName(j))}${qtyOf(j) ? ` · ${qtyOf(j).toLocaleString("en-NG")} pcs` : ""}${owner(j) ? ` · ${esc(owner(j))}` : ""}</div>${bl.map(b => `<span class="flag">${esc(b)}</span>`).join("")}${move(j)}</li>`; };
  el.innerHTML = `${roBanner()}
    <div class="toolbar"><div class="seg" role="group" aria-label="Layout"><button type="button" aria-pressed="${mode === "board"}" data-mode="board">Board</button><button type="button" aria-pressed="${mode === "list"}" data-mode="list">List</button></div>
      <input type="search" data-f="q" placeholder="Search job or customer…" aria-label="Search production" value="${esc(f.q || "")}">
      <select data-f="due" aria-label="Due"><option value="">Any due date</option>${[["overdue", "Overdue"], ["today", "Due today"], ["week", "Due within 7 days"]].map(([k, l]) => `<option value="${k}" ${f.due === k ? "selected" : ""}>${l}</option>`).join("")}</select>
      <select data-f="owner" aria-label="Owner"><option value="">Any owner</option>${owners.map(o => `<option ${f.owner === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></div>
    ${filterChips("press-production", { stage: s => "Stage: " + PROD_LABEL[s], due: d => ({ overdue: "Overdue", today: "Due today", week: "Due within 7 days" })[d], owner: o => "Owner: " + o })}
    ${mode === "board" ? `<div class="pboard">${PROD.filter(st => !f.stage || st === f.stage).map(st => { const col = open.filter(j => j.stage === st); return `<section class="pcol" aria-labelledby="pc-${st}"><h2 id="pc-${st}">${PROD_LABEL[st]} <span class="cnt">${col.length}</span></h2>${col.length ? `<ul>${col.map(card).join("")}</ul>` : `<p class="bempty">No jobs</p>`}</section>`; }).join("")}
        <details class="pcol done"><summary>Delivered, last 14 days <span class="cnt">${delivered.length}</span></summary>${delivered.length ? `<ul>${delivered.map(j => `<li class="pcard"><div class="pc-top">${jobLink(j)}<span class="due ok">${fmtShort((j.delivered_at || "").slice(0, 10))}</span></div><div class="pc-name">${esc(summaryOf(j))}</div><div class="pc-meta">${esc(custName(j))}</div></li>`).join("")}</ul>` : `<p class="bempty">None</p>`}</details></div>`
    : dataTable("press-production", { caption: "Jobs in production", rows: open, empty: `<div class="empty"><h2>Nothing in production</h2><p>Accepted quotes appear here as job cards.</p></div>`, cols: [
        { key: "num", label: "Job", cls: "mono", html: jobLink, sort: j => j.number, card: "title" }, { key: "sum", label: "Description", html: j => esc(summaryOf(j)), card: "title" },
        { key: "cust", label: "Customer", html: j => esc(custName(j)), sort: j => custName(j), card: "meta" }, { key: "st", label: "Stage", html: j => esc(PROD_LABEL[j.stage]), sort: j => PROD.indexOf(j.stage), card: "meta" },
        { key: "due", label: "Due", html: j => { const d = dueInfo(j); return `<span class="due ${d.cls}">${esc(d.text)}</span>`; }, sort: j => j.due_date || "9999", card: "meta" },
        { key: "own", label: "Owner", html: j => esc(owner(j) || "—"), sort: owner, card: "meta" },
        { key: "blk", label: "Blocked by", html: j => blockers(j).map(b => `<span class="flag">${esc(b)}</span>`).join(" ") || "—", card: "meta" },
        { key: "mv", label: "Move", html: move, card: "meta" }] })}`;
  wireFilters(el, "press-production", id => renderProduction(el, id)); wireTable(el, "press-production", () => renderProduction(el)); refocus(focusId);
  el.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => { P.prodMode = b.dataset.mode; renderProduction(el); });
  el.querySelectorAll("[data-move]").forEach(s => s.onchange = async () => { const j = P.jobs.find(x => x.id === s.dataset.move); if (!s.value) return; s.disabled = true; const ok = await setStage(j, s.value); if (!ok) { s.disabled = false; s.value = ""; } });
}

/* ---------- stage changes (one place, used by the board, the quick view and the job page) ---------- */
async function setStage(j, stage) {
  if (stage === "cancelled" && !confirm(`Cancel ${j.number}? Payments already recorded stay on file. A manager can reopen it later.`)) return false;
  if (stage === "delivered" && balanceOf(j) > 0 && !confirm(`${j.number} still owes ${money(balanceOf(j))}. Mark it delivered anyway?`)) return false;
  const now = new Date().toISOString(); const patch = { stage, history: hist(j, `Stage: ${STAGE_LABEL[stage]}`) };
  if (stage === "accepted" && !j.accepted_at) patch.accepted_at = now; if (stage === "delivered") patch.delivered_at = now;
  const res = await FR.save("press_jobs", j.id, patch, { obj: j });
  const o = outcome(res, `${j.number}: ${STAGE_LABEL[stage]}`); if (!o) return false;
  logAct("ok", `${j.number} moved to ${STAGE_LABEL[stage]}`); await load(["jobs"]); return true;
}
const nextStage = j => j.stage === "quote" ? "accepted" : j.stage === "ready" ? "delivered" : PROD[PROD.indexOf(j.stage) + 1];
const nextLabel = j => j.stage === "quote" ? "Customer accepted" : j.stage === "ready" ? "Mark delivered" : j.stage === "accepted" ? "Start design" : `Move to ${STAGE_LABEL[nextStage(j)]}`;
async function approveProof(j) { return outcome(await FR.save("press_jobs", j.id, { proof_approved_at: new Date().toISOString(), history: hist(j, "Proof approved by customer") }, { obj: j }), "Proof approved") && load(["jobs"]); }

/* ---------- quick view drawer (spec §9.4): the essentials and the next step, without leaving the list ---------- */
function showDrawer() { FR.drawer.show(); $("#scrim").onclick = closeDrawer; }
function closeDrawer() { P.quick = null; P.reqOpen = null; FR.drawer.hide(); }
function openJobQuick(id) { const j = P.jobs.find(x => x.id === id); if (!j) return; if (j.stage === "quote") { FR.openRecord("press-quote", id); return; } P.quick = id; P.reqOpen = null; paintQuick(); showDrawer(); }
function paintQuick() {
  const j = P.jobs.find(x => x.id === P.quick); if (!j) return closeDrawer();
  const d = dueInfo(j), bl = blockers(j), ps = payStatus(j), nx = nextStage(j);
  $("#drawer").innerHTML = `<header><div><div class="muted mono">${esc(j.number)}</div><h2 id="dr-h" tabindex="-1">${esc(summaryOf(j))}</h2><div class="title-line" style="margin-top:6px">${stagePill(j)}<span class="due ${d.cls}">${esc(d.text)}</span></div></div><button class="x" id="close" aria-label="Close">×</button></header>
    <div class="body">
      ${bl.map(b => `<p class="flag">${esc(b)}</p>`).join("")}
      <dl class="kv"><dt>Customer</dt><dd>${esc(custName(j))}${custOf(j)?.phone ? ` · ${esc(custOf(j).phone)}` : ""}</dd><dt>Owner</dt><dd>${esc(owner(j) || "Not assigned")}</dd>
        <dt>Quantity</dt><dd>${qtyOf(j) ? qtyOf(j).toLocaleString("en-NG") : "—"}</dd><dt>Total</dt><dd class="num">${money(j.total)}</dd><dt>Paid</dt><dd class="num">${money(paidOf(j))} ${pill(ps.cls, ps.label)}</dd>${balanceOf(j) > 0 ? `<dt>Balance</dt><dd class="num"><b>${money(balanceOf(j))}</b></dd>` : ""}</dl>
      ${(j.items || []).length ? `<h3 style="margin:16px 0 6px">Items</h3><ul class="plain">${j.items.map(i => `<li>${esc(i.description)} <span class="muted">× ${N(i.qty)} ${esc(i.unit || "")}</span></li>`).join("")}</ul>` : ""}
      ${(j.history || []).length ? `<h3 style="margin:16px 0 6px">Latest</h3><p class="muted" style="margin:0">${esc(j.history[j.history.length - 1].summary)} · ${when(j.history[j.history.length - 1].ts)}</p>` : ""}
    </div>
    <footer>${canWrite() && nx && isOpenJob(j) ? `<button class="btn primary" id="qv-next">${esc(nextLabel(j))}</button>` : ""}${canWrite() && j.stage === "proof" && !j.proof_approved_at ? `<button class="btn" id="qv-proof">Proof approved</button>` : ""}<span style="flex:1"></span><a class="btn" href="${FR.href("press-job", j.id)}" id="qv-open">Open full job</a></footer>`;
  $("#close").onclick = closeDrawer;
  $("#qv-open").onclick = e => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); closeDrawer(); FR.openRecord("press-job", j.id); };
  $("#qv-next")?.addEventListener("click", async e => { e.target.disabled = true; if (!await setStage(j, nx)) e.target.disabled = false; });
  $("#qv-proof")?.addEventListener("click", () => approveProof(j));
}

/* ---------- quote editor, full page (spec §9.3) ----------
   No autosave: a saved quote takes a number that is never reused, so saving is a deliberate step. The draft stays in
   memory while you move around, a failed save keeps everything you typed, and the summary shows what will be saved. */
function draftFrom(j) {
  if (!j) return { title: "", description: "", customer_id: null, customer_name: "", items: [], discount: 0, deposit_pct: N(P.cfg.deposit_pct), valid_days: N(P.cfg.valid_days), due_date: "", specs: {}, notes: "", assigned_to: myName() };
  return { title: j.title || "", description: j.description || "", customer_id: j.customer_id, customer_name: custName(j), items: (j.items || []).map(x => ({ ...x })), discount: N(j.discount), deposit_pct: N(j.deposit_pct), valid_days: N(j.valid_days) || 14, due_date: j.due_date || "", specs: { ...(j.specs || {}) }, notes: j.notes || "", assigned_to: owner(j) };
}
function renderQuoteEditor(el) {
  const id = S.param || "new"; const isNew = id === "new"; const j = isNew ? null : P.jobs.find(x => x.id === id);
  if (!isNew && !j) { el.innerHTML = `<div class="empty"><h2>Quote not found</h2><p>It may have been deleted, or it belongs to another company.</p><a class="btn" href="${FR.href("press-quotes")}" data-v="press-quotes">Back to quotes</a></div>`; el.querySelector("[data-v]").onclick = e => { e.preventDefault(); FR.setView("press-quotes"); }; return; }
  if (isNew && !canWrite()) { el.innerHTML = `<div class="empty"><h2>You cannot create quotes</h2><p>Viewers in ${esc(FR.companyShort(S.company))} can read quotes but not create them. Ask a manager for Staff access.</p></div>`; return; }
  if (P.draftFor !== id || !P.draft) { P.draft = draftFrom(j); P.draftFor = id; P.dirty = false; }
  const d = P.draft; const ro = !canWrite() || (j && !["quote", "accepted"].includes(j.stage) && !canManage());
  const dis = ro ? "disabled" : ""; const t = calcTotals(d.items, d.discount, P.cfg.vat_pct); const cust = P.customers.find(c => c.name.toLowerCase() === (d.customer_name || "").toLowerCase());
  $("#page-title").textContent = isNew ? "New quote" : j.number; document.title = `${isNew ? "New quote" : j.number} · Future Ready`;
  $("#page-sub").textContent = isNew ? "Saved quotes get the next quote number" : j.stage === "quote" ? `${quoteStatus(j).label} · valid until ${fmtD(quoteUntil(j))}` : `Job at stage ${STAGE_LABEL[j.stage]}: changing the price here changes the invoice`;
  const sec = (hid, title, body) => `<section class="panel" aria-labelledby="${hid}"><div class="panel-head"><h2 id="${hid}">${title}</h2></div>${body}</section>`;
  el.innerHTML = `${ro && canWrite() ? `<div class="banner warn">This job is past the proof stage. Only a manager can change its items and price.</div>` : roBanner()}
  <div class="editor">
    <div class="ed-main">
      ${sec("qe-c", "Customer", `<div class="fields"><div class="field wide"><label for="q-cust">Customer name</label><input id="q-cust" list="q-custs" value="${esc(d.customer_name)}" autocomplete="off" ${dis} aria-describedby="q-cust-h"><datalist id="q-custs">${P.customers.map(c => `<option value="${esc(c.name)}">${esc(c.phone || "")}</option>`).join("")}</datalist><p class="hint" id="q-cust-h">${cust ? `Existing customer${cust.phone ? " · " + esc(cust.phone) : ""}${cust.email ? " · " + esc(cust.email) : ""}` : d.customer_name ? "New customer: saved when you save the quote" : "Pick an existing customer or type a new name"}</p></div></div>`)}
      ${sec("qe-s", "Job specification", `<div class="fields"><div class="field wide"><label for="q-title">Job title</label><input id="q-title" value="${esc(d.title)}" placeholder="e.g. 500 A5 flyers, church harvest" ${dis}></div>
        <div class="field"><label for="q-size">Size</label><input id="q-size" value="${esc(d.specs.size || "")}" placeholder="A5, 3×6 ft" ${dis}></div><div class="field"><label for="q-paper">Paper or material</label><input id="q-paper" value="${esc(d.specs.paper || "")}" placeholder="150gsm gloss, flex" ${dis}></div>
        <div class="field"><label for="q-colours">Colours</label><input id="q-colours" value="${esc(d.specs.colours || "")}" placeholder="full colour, one side" ${dis}></div><div class="field"><label for="q-finish">Finishing</label><input id="q-finish" value="${esc(d.specs.finishing || "")}" placeholder="lamination, folding" ${dis}></div>
        <div class="field wide"><label for="q-desc">Description for the customer</label><textarea id="q-desc" rows="3" ${dis}>${esc(d.description)}</textarea></div></div>`)}
      ${sec("qe-p", "Pricing", `${ro ? "" : `<div class="toolbar" style="margin-bottom:10px"><label class="sr-only" for="q-rate">Add from rate card</label><select id="q-rate"><option value="">Add from rate card…</option>${[...new Set(P.rates.filter(r => r.active).map(r => r.category))].map(cat => `<optgroup label="${esc(cat)}">${P.rates.filter(r => r.active && r.category === cat).map(r => `<option value="${r.id}">${esc(r.name)}: ${money(r.price)} per ${esc(r.unit)}</option>`).join("")}</optgroup>`).join("")}</select><button type="button" class="btn small" id="q-addline">Add blank line</button></div>`}
        <div class="table-wrap"><table class="items" style="min-width:560px"><caption class="sr-only">Quote items</caption><thead><tr><th scope="col">Description</th><th scope="col" style="width:84px">Qty</th><th scope="col" style="width:90px">Unit</th><th scope="col" style="width:120px">Unit price</th><th scope="col" class="money" style="width:120px">Line total</th>${ro ? "" : `<th scope="col" style="width:48px"><span class="sr-only">Remove</span></th>`}</tr></thead><tbody>
        ${d.items.map((it, i) => `<tr><td><input aria-label="Description, line ${i + 1}" data-li="description" data-i="${i}" value="${esc(it.description)}" ${dis}></td><td><input aria-label="Quantity, line ${i + 1}" type="number" data-li="qty" data-i="${i}" value="${N(it.qty)}" min="0" step="any" ${dis}></td><td><input aria-label="Unit, line ${i + 1}" data-li="unit" data-i="${i}" value="${esc(it.unit || "")}" ${dis}></td><td><input aria-label="Unit price, line ${i + 1}" type="number" data-li="unit_price" data-i="${i}" value="${N(it.unit_price)}" min="0" step="0.01" ${dis}></td><td class="money" data-lt="${i}">${money(it.total)}</td>${ro ? "" : `<td><button type="button" class="btn small ghost" data-rm="${i}" aria-label="Remove line ${i + 1}">×</button></td>`}</tr>`).join("") || `<tr><td colspan="6" class="muted">No items yet. Add from the rate card or add a blank line.</td></tr>`}
        </tbody></table></div>
        <div class="fields" style="margin-top:12px"><div class="field"><label for="q-disc">Discount (₦)</label><input type="number" id="q-disc" value="${N(d.discount)}" min="0" step="0.01" ${dis}></div><div class="field"><label for="q-dep">Deposit to start (%)</label><input type="number" id="q-dep" value="${N(d.deposit_pct)}" min="0" max="100" ${dis}></div></div>
        ${N(P.cfg.vat_pct) ? `<p class="hint">VAT of ${N(P.cfg.vat_pct)}% is added from Settings.</p>` : ""}`)}
      ${sec("qe-n", "Dates, owner and notes", `<div class="fields"><div class="field"><label for="q-valid">Valid for (days)</label><input type="number" id="q-valid" value="${N(d.valid_days)}" min="1" ${dis}></div><div class="field"><label for="q-due">Delivery date</label><input type="date" id="q-due" value="${esc(d.due_date)}" ${dis}></div>
        <div class="field"><label for="q-own">Owner</label><input id="q-own" value="${esc(d.assigned_to || "")}" list="q-staff" ${dis}><datalist id="q-staff">${(S.team || []).filter(m => m.status === "active").map(m => `<option value="${esc(FR.memberName(m))}">`).join("")}</datalist></div>
        <div class="field wide"><label for="q-notes">Internal notes <span class="muted">(not printed)</span></label><textarea id="q-notes" rows="2" ${dis}>${esc(d.notes)}</textarea></div></div>`)}
      ${j ? sec("qe-r", "Review and send", `<p class="muted" style="margin-top:0">${j.sent_at ? `Sent ${when(j.sent_at)}.` : "Not sent yet."} Save your changes before sending; the PDF uses the saved quote.</p>
        <div class="toolbar"><button type="button" class="btn" id="q-pdf">Download PDF</button>${canWrite() ? `<button type="button" class="btn" id="q-mail" ${custOf(j)?.email ? "" : `disabled title="Add the customer's email first"`}>Email to customer</button><button type="button" class="btn" id="q-wa">Send on WhatsApp</button>` : ""}</div>
        ${canWrite() && !custOf(j)?.email ? `<p class="hint">Email needs the customer's email address. Add it on the customer page.</p>` : ""}`) : ""}
    </div>
    <aside class="ed-side" aria-labelledby="qe-sum"><div class="panel sticky"><h2 id="qe-sum">Summary</h2>
      <dl class="kv" id="q-sum"></dl>
      <div class="ed-actions">${ro ? "" : `<button type="button" class="btn primary" id="q-save">${isNew ? "Save quote" : "Save changes"}</button>`}
        ${!ro && j && j.stage === "quote" ? `<button type="button" class="btn" id="q-accept">Customer accepted</button>` : ""}
        ${j && j.stage !== "quote" ? `<a class="btn" href="${FR.href("press-job", j.id)}" id="q-job">Open job</a>` : ""}
        <p class="savestate" id="q-state" role="status" aria-live="polite">${P.dirty ? "Unsaved changes" : ""}</p><p class="hint" id="q-err" role="alert" style="color:var(--bad)"></p></div></div></aside>
  </div>`;
  const paintSum = () => { const tt = calcTotals(d.items, d.discount, P.cfg.vat_pct); $("#q-sum").innerHTML = `<dt>Customer</dt><dd>${esc(d.customer_name || "—")}</dd><dt>Items</dt><dd>${d.items.length}</dd><dt>Subtotal</dt><dd class="num">${money(tt.subtotal)}</dd>${N(d.discount) ? `<dt>Discount</dt><dd class="num">− ${money(d.discount)}</dd>` : ""}${N(P.cfg.vat_pct) ? `<dt>VAT ${N(P.cfg.vat_pct)}%</dt><dd class="num">${money(tt.vat)}</dd>` : ""}<dt><b>Total</b></dt><dd class="num total">${money(tt.total)}</dd><dt>Deposit</dt><dd class="num">${money(Math.round(tt.total * N(d.deposit_pct)) / 100)} (${N(d.deposit_pct)}%)</dd><dt>Valid until</dt><dd>${fmtD(addDays((j?.quoted_at || new Date().toISOString()).slice(0, 10), N(d.valid_days) || 14))}</dd>`; };
  const read = () => {
    if (ro) return;
    d.customer_name = $("#q-cust").value.trim(); d.title = $("#q-title").value.trim(); d.description = $("#q-desc").value.trim();
    d.specs = { size: $("#q-size").value.trim(), paper: $("#q-paper").value.trim(), colours: $("#q-colours").value.trim(), finishing: $("#q-finish").value.trim() };
    d.discount = N($("#q-disc").value); d.deposit_pct = N($("#q-dep").value); d.valid_days = N($("#q-valid").value) || 14; d.due_date = $("#q-due").value; d.assigned_to = $("#q-own").value.trim(); d.notes = $("#q-notes").value.trim();
    el.querySelectorAll("[data-li]").forEach(inp => { const it = d.items[+inp.dataset.i]; if (it) it[inp.dataset.li] = inp.type === "number" ? N(inp.value) : inp.value; });
    d.items.forEach((it, i) => { it.total = Math.round(N(it.qty) * N(it.unit_price) * 100) / 100; const c = el.querySelector(`[data-lt="${i}"]`); if (c) c.textContent = money(it.total); });
  };
  const dirty = () => { read(); P.dirty = true; FR.saveState($("#q-state"), "", "Unsaved changes"); paintSum(); };
  paintSum();
  el.querySelectorAll(".ed-main input, .ed-main textarea").forEach(i => i.addEventListener("input", dirty));
  el.querySelectorAll(".ed-main select:not(#q-rate)").forEach(i => i.addEventListener("change", dirty));
  $("#q-rate")?.addEventListener("change", e => { const r = P.rates.find(x => x.id === e.target.value); if (!r) return; read(); d.items.push({ rate_item_id: r.id, description: r.name, qty: 1, unit: r.unit, unit_price: N(r.price), total: N(r.price) }); P.dirty = true; renderQuoteEditor(el); el.querySelector(`[data-li="qty"][data-i="${d.items.length - 1}"]`)?.focus(); });
  $("#q-addline")?.addEventListener("click", () => { read(); d.items.push({ description: "", qty: 1, unit: "piece", unit_price: 0, total: 0 }); P.dirty = true; renderQuoteEditor(el); el.querySelector(`[data-li="description"][data-i="${d.items.length - 1}"]`)?.focus(); });
  el.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { read(); d.items.splice(+b.dataset.rm, 1); P.dirty = true; renderQuoteEditor(el); ($("#q-addline") || $("#q-title")).focus(); });
  $("#q-job")?.addEventListener("click", e => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); FR.openRecord("press-job", j.id); });
  $("#q-save")?.addEventListener("click", () => saveQuote(el, j));
  $("#q-accept")?.addEventListener("click", async e => { if (P.dirty) { $("#q-err").textContent = "Save your changes first."; return; } e.target.disabled = true; if (await setStage(j, "accepted")) { P.draft = null; FR.openRecord("press-job", j.id); } else e.target.disabled = false; });
  $("#q-pdf")?.addEventListener("click", () => savePdf(quotePdf(j), `${j.number}.pdf`));
  $("#q-mail")?.addEventListener("click", () => emailDoc(j, "quote"));
  $("#q-wa")?.addEventListener("click", () => sendWhatsApp(j));
}
async function saveQuote(el, j) {
  const d = P.draft; const isNew = !j; const st = $("#q-state"), err = $("#q-err"); err.textContent = "";
  if (!d.customer_name) { err.textContent = "Enter the customer's name."; $("#q-cust").focus(); return; }
  if (!d.items.length) { err.textContent = "Add at least one item."; ($("#q-rate") || $("#q-addline")).focus(); return; }
  if (d.items.some(i => !String(i.description || "").trim())) { err.textContent = "Every line needs a description."; return; }
  const btn = $("#q-save"); btn.disabled = true; FR.saveState(st, "saving");
  try {
    let cust = P.customers.find(c => c.name.toLowerCase() === d.customer_name.toLowerCase());
    if (!cust) { const r = await FR.save("press_customers", null, { company_id: S.company, name: d.customer_name }); if (r.error) throw new Error(r.error.code === "queued" ? "No connection: the new customer could not be created, so the quote was not saved. Your input is still here." : r.error.message); cust = r.data; P.all.customers.push(cust); P.customers.push(cust); }
    const tt = calcTotals(d.items, d.discount, P.cfg.vat_pct);
    const body = { company_id: S.company, customer_id: cust.id, customer_name: cust.name, title: d.title, description: d.description, items: d.items, subtotal: tt.subtotal, discount: d.discount, total: tt.total, deposit_pct: d.deposit_pct, valid_days: d.valid_days, due_date: d.due_date || null, specs: d.specs, notes: d.notes, assigned_to: d.assigned_to };
    if (isNew) {
      body.number = await nextNumber("Q"); body.stage = "quote"; body.quoted_at = new Date().toISOString(); body.history = [{ ts: body.quoted_at, by: me(), summary: "Quote created" }];
      const r = await FR.save("press_jobs", null, body); if (r.error) throw new Error(r.error.message);
      logAct("ok", `Quote ${body.number} for ${cust.name}: ${money(tt.total)}`); P.dirty = false; P.draft = null; P.draftFor = null;
      await load(["jobs", "customers"]); if (r.data && !P.all.jobs.some(x => x.id === r.data.id)) { P.all.jobs.push(r.data); scope(); } toast(`${body.number} saved`, "ok"); FR.openRecord("press-quote", r.data.id); FR.saveState($("#q-state"), "saved", `Saved as ${body.number}`);
    } else {
      body.history = hist(j, `Quote edited · total ${money(tt.total)}`);
      const r = await FR.save("press_jobs", j.id, FR.diff(j, body), { obj: j });
      if (r.error?.code === "queued") { P.dirty = false; FR.saveState(st, "queued"); btn.disabled = false; return; }
      if (r.error) throw new Error(r.error.code === "conflict" ? `Someone else changed this quote at the same time (${r.error.message}). Your other changes were saved; a Group Admin will review the clash.` : r.error.message);
      P.dirty = false; P.draft = null; await load(["jobs", "customers"]); FR.saveState($("#q-state"), "saved"); toast("Quote saved", "ok");
    }
  } catch (e) { FR.saveState(st, "failed"); err.textContent = `${e.message || e} Nothing you typed was lost; try Save again.`; btn.disabled = false; }
}
const waNum = p => { const d = String(p || "").replace(/\D/g, ""); return d.startsWith("0") ? "234" + d.slice(1) : d; };
async function markSent(j) { if (j.sent_at) return; await FR.save("press_jobs", j.id, { sent_at: new Date().toISOString(), history: hist(j, "Quote sent to customer") }, { obj: j }); load(["jobs"]); }
function sendWhatsApp(j) {
  const c = custOf(j); const txt = `Good day ${c?.name || ""}, here is your quote ${j.number} from ${P.cfg.business_name}:\n${(j.items || []).map(i => `• ${i.description} × ${N(i.qty)} = ${money(i.total)}`).join("\n")}\nTotal: ${money(j.total)}${N(j.deposit_pct) ? ` (deposit ${N(j.deposit_pct)}% = ${money(depositOf(j))})` : ""}\nValid for ${N(j.valid_days)} days. Reply to confirm and we start.`;
  savePdf(quotePdf(j), `${j.number}.pdf`); window.open(`https://wa.me/${waNum(c?.phone)}?text=${encodeURIComponent(txt)}`, "_blank", "noopener");
  toast("Quote PDF downloaded. Attach it in WhatsApp if you like."); markSent(j);
}

/* ---------- full job page (spec §9.4): summary, stage tracker, then everything about the job ---------- */
function renderJobPage(el) {
  const j = P.jobs.find(x => x.id === S.param);
  if (!j) { el.innerHTML = `<div class="empty"><h2>Job not found</h2><p>It may have been deleted, or it belongs to another company.</p><a class="btn" href="${FR.href("press-jobs")}" data-v="press-jobs">Back to jobs</a></div>`; el.querySelector("[data-v]").onclick = e => { e.preventDefault(); FR.setView("press-jobs"); }; return; }
  if (j.stage === "quote") { FR.openRecord("press-quote", j.id); return; }
  const ro = !canWrite(); const d = dueInfo(j), bl = blockers(j), ps = payStatus(j), nx = nextStage(j); const idx = TRACK.indexOf(j.stage);
  const pays = P.payments.filter(p => p.job_id === j.id).sort((a, b) => (b.paid_at || "").localeCompare(a.paid_at || ""));
  const files = P.files.filter(f => f.job_id === j.id); const moves = P.moves.filter(m => m.job_id === j.id).sort((a, b) => (b.moved_at || "").localeCompare(a.moved_at || ""));
  const c = custOf(j);
  $("#page-title").textContent = j.number; document.title = `${j.number} · Future Ready`; $("#page-sub").textContent = summaryOf(j);
  el.innerHTML = `${roBanner()}
  <div class="jsum panel">
    <div class="jsum-main"><div class="title-line">${stagePill(j)}<span class="due ${d.cls}">${esc(d.text)}</span>${pill(ps.cls, ps.label)}${bl.map(b => `<span class="flag">${esc(b)}</span>`).join("")}</div>
      <dl class="kv inline"><dt>Customer</dt><dd><a href="${c ? FR.href("press-customer", c.id) : "#"}" data-cust="${c?.id || ""}">${esc(custName(j))}</a></dd><dt>Owner</dt><dd>${esc(owner(j) || "Not assigned")}</dd><dt>Total</dt><dd class="num">${money(j.total)}</dd><dt>Balance</dt><dd class="num">${balanceOf(j) > 0 ? `<b>${money(balanceOf(j))}</b>` : "Paid"}</dd></dl></div>
    <div class="jsum-acts">${!ro && nx && isOpenJob(j) ? `<button class="btn primary" id="jp-next">${esc(nextLabel(j))}</button>` : ""}${!ro && j.stage === "proof" && !j.proof_approved_at ? `<button class="btn" id="jp-proof">Proof approved</button>` : ""}${!ro && balanceOf(j) > 0 && j.stage !== "cancelled" ? `<button class="btn" id="jp-pay">Record payment</button>` : ""}</div>
  </div>
  <ol class="tracker" aria-label="Stages">${TRACK.map((st, i) => `<li class="${j.stage === "cancelled" ? "" : i < idx ? "done" : i === idx ? "now" : ""}" ${i === idx ? 'aria-current="step"' : ""}><i aria-hidden="true"></i><span>${STAGE_LABEL[st]}</span>${i < idx ? '<span class="sr-only"> (done)</span>' : ""}</li>`).join("")}</ol>
  ${j.stage === "cancelled" ? `<div class="banner bad">This job was cancelled.${canManage() ? " A manager can reopen it below." : ""}</div>` : ""}
  <div class="grid-2">
    <div class="stack">
      <section class="panel" aria-labelledby="jp-spec"><div class="panel-head"><h2 id="jp-spec">Specification and items</h2>${canWrite() && (["accepted"].includes(j.stage) || canManage()) ? `<a href="${FR.href("press-quote", j.id)}" id="jp-edit">Edit items and price</a>` : ""}</div>
        ${Object.values(j.specs || {}).some(Boolean) ? `<dl class="kv">${[["size", "Size"], ["paper", "Paper"], ["colours", "Colours"], ["finishing", "Finishing"]].filter(([k]) => (j.specs || {})[k]).map(([k, l]) => `<dt>${l}</dt><dd>${esc(j.specs[k])}</dd>`).join("")}</dl>` : ""}
        ${j.description ? `<p style="white-space:pre-wrap">${esc(j.description)}</p>` : ""}
        <div class="table-wrap"><table style="min-width:0"><caption class="sr-only">Items</caption><thead><tr><th scope="col">Description</th><th scope="col" class="r">Qty</th><th scope="col">Unit</th><th scope="col" class="money">Unit price</th><th scope="col" class="money">Total</th></tr></thead><tbody>${(j.items || []).map(i => `<tr><td>${esc(i.description)}</td><td class="r num">${N(i.qty).toLocaleString("en-NG")}</td><td>${esc(i.unit || "")}</td><td class="money">${money(i.unit_price)}</td><td class="money">${money(i.total)}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">No items.</td></tr>`}</tbody></table></div></section>
      <section class="panel" aria-labelledby="jp-files"><div class="panel-head"><h2 id="jp-files">Files and proof</h2><span class="muted">${j.proof_approved_at ? `Proof approved ${when(j.proof_approved_at)}` : "Proof not approved yet"}</span></div>
        ${files.length ? `<ul class="rows">${files.map(f => `<li><span><b>${esc(f.title)}</b><span class="sub">${FILE_KIND[f.kind] || esc(f.kind)} · ${f.size_bytes ? Math.round(f.size_bytes / 1024) + " KB · " : ""}${when(f.uploaded_at)}</span></span><span class="row-acts"><button class="btn small" data-fopen="${f.id}">Open</button>${ro ? "" : `<button class="btn small ghost danger" data-fdel="${f.id}">Delete</button>`}</span></li>`).join("")}</ul>` : `<p class="empty-inline">No files yet. Artwork, proofs and references go here.</p>`}
        ${ro ? "" : `<div class="fields upl"><div class="field"><label for="pf-kind">Type</label><select id="pf-kind">${Object.entries(FILE_KIND).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div><div class="field"><label for="pf-title">Title</label><input id="pf-title" placeholder="e.g. Final artwork v2"></div><div class="field wide"><label for="pf-file">File <span class="muted">(up to 25 MB)</span></label><input type="file" id="pf-file"></div></div><div class="toolbar"><button class="btn small" id="pf-up">Upload file</button><span class="hint" id="pf-err" role="alert" style="color:var(--bad)"></span></div>`}</section>
      <section class="panel" aria-labelledby="jp-mat"><div class="panel-head"><h2 id="jp-mat">Materials used</h2></div>
        ${moves.length ? `<ul class="rows">${moves.map(mv => { const m = P.materials.find(x => x.id === mv.material_id) || {}; return `<li><span><b>${-N(mv.delta)} ${esc(m.unit || "")} ${esc(m.name || "")}</b><span class="sub">${when(mv.moved_at)}${mv.note ? " · " + esc(mv.note) : ""}</span></span></li>`; }).join("")}</ul>` : `<p class="empty-inline">No materials recorded against this job.</p>`}
        ${canWrite() && j.stage !== "cancelled" ? `<div class="toolbar"><label class="sr-only" for="jb-mat">Material</label><select id="jb-mat"><option value="">Choose a material…</option>${P.materials.map(m => `<option value="${m.id}">${esc(m.name)} (${N(m.quantity)} ${esc(m.unit)} in stock)</option>`).join("")}</select><label class="sr-only" for="jb-qty">Quantity used</label><input type="number" id="jb-qty" placeholder="Qty" min="0" step="any" style="width:100px;height:36px"><button class="btn small" id="jb-use">Record use</button></div><p class="hint">Stock changes need a connection; they are never kept for later.</p>` : ""}</section>
    </div>
    <div class="stack">
      <section class="panel" aria-labelledby="jp-money"><div class="panel-head"><h2 id="jp-money">Money</h2><span class="row-acts"><button class="btn small" id="jp-inv">Invoice PDF</button>${canWrite() && c?.email ? `<button class="btn small ghost" id="jp-invmail">Email invoice</button>` : ""}</span></div>
        <dl class="kv"><dt>Total</dt><dd class="num">${money(j.total)}</dd><dt>Deposit</dt><dd class="num">${money(depositOf(j))} (${N(j.deposit_pct)}%)</dd><dt>Paid</dt><dd class="num">${money(paidOf(j))}</dd><dt><b>Balance</b></dt><dd class="num"><b>${money(balanceOf(j))}</b></dd></dl>
        <h3 style="margin:16px 0 6px">Payments</h3>
        ${pays.length ? `<ul class="rows">${pays.map(p => `<li><span><b class="num">${money(p.amount)}</b> <span class="mono muted">${esc(p.receipt_no)}</span><span class="sub">${METHOD[p.method] || esc(p.method)} · ${when(p.paid_at)}${p.note ? " · " + esc(p.note) : ""}</span></span><span class="row-acts"><button class="btn small" data-rpdf="${p.id}">Receipt</button>${canWrite() && c?.email ? `<button class="btn small ghost" data-rmail="${p.id}">Email</button>` : ""}${canManage() ? `<button class="btn small ghost danger" data-rdel="${p.id}" aria-label="Delete receipt ${esc(p.receipt_no)}">Delete</button>` : ""}</span></li>`).join("")}</ul>` : `<p class="empty-inline">No payments yet.</p>`}
      </section>
      <section class="panel" aria-labelledby="jp-det"><div class="panel-head"><h2 id="jp-det">Details</h2></div>
        <div class="fields"><div class="field"><label for="jb-due">Due date</label><input type="date" id="jb-due" value="${esc(j.due_date || "")}" ${ro ? "disabled" : ""}></div><div class="field"><label for="jb-assign">Owner</label><input id="jb-assign" value="${esc(j.assigned_to || "")}" list="jb-staff" ${ro ? "disabled" : ""}><datalist id="jb-staff">${(S.team || []).filter(m => m.status === "active").map(m => `<option value="${esc(FR.memberName(m))}">`).join("")}</datalist></div>
          <div class="field wide"><label for="jb-notes">Internal notes <span class="muted">(not printed)</span></label><textarea id="jb-notes" rows="3" ${ro ? "disabled" : ""}>${esc(j.notes || "")}</textarea></div></div>
        ${ro ? "" : `<div class="toolbar"><button class="btn" id="jb-save">Save details</button><span class="savestate" id="jb-state" role="status" aria-live="polite"></span></div>`}
        ${!ro ? `<div class="toolbar danger-zone">${isOpenJob(j) && canManage() ? `<button class="btn small danger" id="jp-cancel">Cancel job</button>` : ""}${["delivered", "cancelled"].includes(j.stage) && canManage() ? `<button class="btn small" id="jp-reopen">Reopen job</button>` : ""}</div>` : ""}</section>
      <section class="panel" aria-labelledby="jp-act"><div class="panel-head"><h2 id="jp-act">Activity</h2></div>
        <ul class="history">${(j.history || []).slice().reverse().slice(0, 40).map(h => `<li><time>${FR.fmtDate(h.ts)}</time><span>${esc(h.summary)} <span class="muted" data-by="${esc(h.by || "")}"></span></span></li>`).join("") || `<li class="muted">Nothing yet.</li>`}</ul></section>
    </div>
  </div>`;
  FR.resolveNames();
  el.querySelector("[data-cust]")?.addEventListener("click", e => { e.preventDefault(); if (c) FR.openRecord("press-customer", c.id); });
  $("#jp-edit")?.addEventListener("click", e => { e.preventDefault(); FR.openRecord("press-quote", j.id); });
  $("#jp-next")?.addEventListener("click", async e => { e.target.disabled = true; if (!await setStage(j, nx)) e.target.disabled = false; });
  $("#jp-proof")?.addEventListener("click", () => approveProof(j));
  $("#jp-pay")?.addEventListener("click", () => openPayment(j));
  $("#jp-cancel")?.addEventListener("click", () => setStage(j, "cancelled"));
  $("#jp-reopen")?.addEventListener("click", () => setStage(j, j.stage === "cancelled" ? "accepted" : "ready"));
  $("#jp-inv").onclick = () => savePdf(invoicePdf(j), `${j.number}-invoice.pdf`);
  $("#jp-invmail")?.addEventListener("click", () => emailDoc(j, "invoice"));
  el.querySelectorAll("[data-rpdf]").forEach(b => b.onclick = () => { const p = pays.find(x => x.id === b.dataset.rpdf); savePdf(receiptPdf(j, p), `${p.receipt_no}.pdf`); });
  el.querySelectorAll("[data-rmail]").forEach(b => b.onclick = () => emailDoc(j, "receipt", pays.find(x => x.id === b.dataset.rmail)));
  el.querySelectorAll("[data-rdel]").forEach(b => b.onclick = async () => { const p = pays.find(x => x.id === b.dataset.rdel); if (!confirm(`Delete receipt ${p.receipt_no} (${money(p.amount)})? Only do this for a mistaken entry. A Group Admin can restore it from Recently deleted.`)) return; const r = await FR.softDelete("press_payments", p.id); if (!r.ok) toast(r.error, "bad"); else { toast("Payment moved to Recently deleted", "warn"); load(["payments"]); } });
  $("#jb-save")?.addEventListener("click", async () => { const st = $("#jb-state"); FR.saveState(st, "saving"); const r = await FR.save("press_jobs", j.id, FR.diff(j, { due_date: $("#jb-due").value || null, assigned_to: $("#jb-assign").value.trim(), notes: $("#jb-notes").value.trim() }), { obj: j }); if (r.error?.code === "queued") return FR.saveState(st, "queued"); if (r.error) return FR.saveState(st, "failed", "Could not save: " + r.error.message); FR.saveState(st, "saved"); load(["jobs"]); });
  $("#jb-use")?.addEventListener("click", async () => {
    const mid = $("#jb-mat").value, qty = N($("#jb-qty").value); if (!mid || qty <= 0) { toast("Choose a material and a quantity", "warn"); return; }
    const r = await FR.save("press_material_moves", null, { company_id: S.company, material_id: mid, job_id: j.id, delta: -qty, note: "Used on " + j.number, moved_by: me() });
    if (outcome(r, "Stock updated")) load(["materials", "moves"]);
  });
  $("#pf-up")?.addEventListener("click", async () => {
    const f = $("#pf-file").files[0], title = $("#pf-title").value.trim() || f?.name; $("#pf-err").textContent = ""; if (!f) { $("#pf-err").textContent = "Choose a file."; return; }
    if (f.size > 25 * 1024 * 1024) { $("#pf-err").textContent = "That file is larger than 25 MB."; return; }
    $("#pf-up").disabled = true; $("#pf-up").textContent = "Uploading…"; const path = `${S.company}/${j.id}/${Date.now().toString(36)}-${f.name.replace(/[^A-Za-z0-9._-]+/g, "-")}`;
    const { error } = await SB().storage.from("press-files").upload(path, f, { contentType: f.type || "application/octet-stream" });
    if (error) { $("#pf-err").textContent = "Upload failed: " + error.message; $("#pf-up").disabled = false; $("#pf-up").textContent = "Upload file"; return; }
    const r = await FR.save("press_files", null, { company_id: S.company, job_id: j.id, kind: $("#pf-kind").value, title, file_path: path, size_bytes: f.size, mime: f.type, uploaded_by: me() });
    if (!outcome(r, "File uploaded", $("#pf-err"))) { $("#pf-up").disabled = false; $("#pf-up").textContent = "Upload file"; return; } load(["files"]);
  });
  el.querySelectorAll("[data-fopen]").forEach(b => b.onclick = async () => { const f = files.find(x => x.id === b.dataset.fopen); const { data, error } = await SB().storage.from("press-files").createSignedUrl(f.file_path, 300); if (error) toast(error.message, "bad"); else window.open(data.signedUrl, "_blank", "noopener"); });
  el.querySelectorAll("[data-fdel]").forEach(b => b.onclick = async () => { const f = files.find(x => x.id === b.dataset.fdel); if (!confirm(`Delete "${f.title}"? A Group Admin can restore it.`)) return; const r = await FR.softDelete("press_files", f.id); if (!r.ok) toast(r.error, "bad"); load(["files"]); });
}

/* ---------- record a payment (spec §9.7): shows the balance that will remain; online only ---------- */
function openPayment(j) {
  P.quick = null; const bal = balanceOf(j);
  $("#drawer").innerHTML = `<header><div><div class="muted mono">${esc(j.number)}</div><h2 id="dr-h" tabindex="-1">Record payment</h2><div class="muted" style="margin-top:4px">${esc(custName(j))} · ${esc(summaryOf(j))}</div></div><button class="x" id="close" aria-label="Close">×</button></header>
    <div class="body"><dl class="kv"><dt>Total</dt><dd class="num">${money(j.total)}</dd><dt>Paid so far</dt><dd class="num">${money(paidOf(j))}</dd><dt>Balance now</dt><dd class="num">${money(bal)}</dd></dl>
      <div class="fields" style="margin-top:14px"><div class="field"><label for="py-amt">Amount (₦)</label><input type="number" id="py-amt" min="0.01" step="0.01" value="${bal}" inputmode="decimal"></div><div class="field"><label for="py-method">Method</label><select id="py-method">${Object.entries(METHOD).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
        <div class="field"><label for="py-date">Date received</label><input type="date" id="py-date" value="${today()}" max="${today()}"></div><div class="field"><label for="py-note">Reference or note</label><input id="py-note" placeholder="deposit, transfer reference"></div></div>
      <p class="result-line" id="py-after" aria-live="polite"></p><p class="hint">Payments are saved only with a connection, never kept on the device for later. A receipt number is issued when you save.</p><p class="hint" id="py-err" role="alert" style="color:var(--bad)"></p></div>
    <footer><span style="flex:1"></span><button class="btn" id="py-cancel">Cancel</button><button class="btn primary" id="py-go">Save and download receipt</button></footer>`;
  showDrawer(); $("#close").onclick = closeDrawer; $("#py-cancel").onclick = closeDrawer;
  const after = () => { const a = N($("#py-amt").value); const left = bal - a; $("#py-after").innerHTML = a <= 0 ? "Enter the amount received." : left > 0.005 ? `Balance after this payment: <b class="num">${money(left)}</b>` : left < -0.005 ? `<span class="flag">This is ${money(-left)} more than the balance.</span>` : `This payment <b>clears the balance</b>.`; };
  $("#py-amt").oninput = after; after();
  $("#py-go").onclick = async () => {
    const amount = N($("#py-amt").value); const err = $("#py-err"); err.textContent = ""; if (amount <= 0) { err.textContent = "Enter an amount greater than zero."; return; }
    if (amount > bal + 0.005 && !confirm(`${money(amount)} is more than the balance of ${money(bal)}. Record it anyway?`)) return;
    const b = $("#py-go"); b.disabled = true; b.textContent = "Saving…";
    try {
      const receipt_no = await nextNumber("R");
      const r = await FR.save("press_payments", null, { company_id: S.company, job_id: j.id, receipt_no, amount, method: $("#py-method").value, paid_at: $("#py-date").value || today(), note: $("#py-note").value.trim(), received_by: me() });
      if (r.error) throw new Error(r.error.code === "queued" ? "No connection. The payment was not saved; try again when online." : r.error.message);
      await FR.save("press_jobs", j.id, { history: hist(j, `Payment ${money(amount)} (${METHOD[r.data.method]}) · receipt ${receipt_no}`) }, { obj: j });
      toast(`Receipt ${receipt_no} saved`, "ok"); logAct("ok", `${j.number}: ${money(amount)} received, receipt ${receipt_no}`);
      closeDrawer(); await load(["payments", "jobs"]); savePdf(receiptPdf(P.jobs.find(x => x.id === j.id) || j, r.data), `${receipt_no}.pdf`);
    } catch (e) { err.textContent = (e.message || String(e)) + " Nothing was recorded."; b.disabled = false; b.textContent = "Save and download receipt"; }
  };
  setTimeout(() => $("#py-amt")?.select(), 60);
}

/* ---------- customer requests (from the public portal) ---------- */
function renderRequests(el) {
  const f = P.reqFilter;
  const list = P.requests.filter(r => f === "all" ? true : f === "open" ? ["new", "quoted", "in_progress"].includes(r.status) : r.status === f);
  const link = `${location.origin}${location.pathname.replace(/[^/]*$/, "")}${S.company}/`;
  const tone = s => s === "new" ? "info" : s === "quoted" ? "warn" : s === "done" ? "ok" : s === "declined" ? "bad" : "";
  el.innerHTML = `<div class="banner info"><div><b>Customer link:</b> <a href="${esc(link)}" target="_blank" rel="noopener">${esc(link)}</a></div><button class="btn small" id="rq-copy" style="margin-left:auto">Copy link</button></div>
    <div class="chips" role="group" aria-label="Request status">${[["open", "Open"], ["new", "New"], ["quoted", "Quote sent"], ["in_progress", "In progress"], ["done", "Done"], ["declined", "Declined"], ["all", "All"]].map(([k, l]) => `<button type="button" class="chip" aria-pressed="${f === k}" data-rf="${k}">${l}<span class="cnt">${k === "all" ? P.requests.length : k === "open" ? P.requests.filter(r => ["new", "quoted", "in_progress"].includes(r.status)).length : P.requests.filter(r => r.status === k).length}</span></button>`).join("")}</div>
    ${dataTable("press-requests", { caption: "Customer requests", rows: list, key: r => r.id, empty: P.requests.length ? `<div class="empty"><h2>No requests in this view</h2><p>Choose another status above.</p></div>` : `<div class="empty"><h2>No requests yet</h2><p>Customers send requests from the link above. Share it on WhatsApp or print it on flyers.</p></div>`, cols: [
      { key: "ref", label: "Ref", cls: "mono", html: r => `<button type="button" class="rowlink mono" data-req="${r.id}">${esc(r.ref)}</button>`, sort: r => r.ref, card: "title" },
      { key: "t", label: "Request", html: r => `${esc(r.title)}${r.service ? `<span class="sub">${esc(r.service)}${r.quantity ? " · " + esc(r.quantity) : ""}</span>` : ""}`, card: "title" },
      { key: "c", label: "Customer", html: r => `${esc(r.contact_name || r.contact_email)}<span class="sub">${esc(r.contact_phone || r.contact_email || "")}</span>`, sort: r => (r.contact_name || "").toLowerCase(), card: "meta" },
      { key: "need", label: "Needed by", html: r => r.needed_by ? fmtShort(r.needed_by) : "—", sort: r => r.needed_by || "9999", card: "meta" },
      { key: "rec", label: "Received", html: r => when(r.created_at), sort: r => r.created_at, card: "meta" },
      { key: "st", label: "Status", html: r => pill(tone(r.status), REQ_STATUS[r.status]), sort: r => r.status, card: "meta" }] })}`;
  $("#rq-copy").onclick = () => { navigator.clipboard?.writeText(link).then(() => toast("Link copied", "ok"), () => toast(link)); };
  el.querySelectorAll("[data-rf]").forEach(b => b.onclick = () => { P.reqFilter = b.dataset.rf; renderRequests(el); });
  el.querySelectorAll("[data-req]").forEach(b => b.onclick = () => openRequest(b.dataset.req));
  wireTable(el, "press-requests", () => renderRequests(el));
}
async function openRequest(id, repaint) {
  const r = P.requests.find(x => x.id === id); if (!r) return;
  P.reqOpen = id; P.quick = null; const ro = !canWrite(); const job = r.job_id ? P.jobs.find(j => j.id === r.job_id) : null;
  $("#drawer").innerHTML = `<header><div><div class="muted mono">${esc(r.ref)} · ${when(r.created_at)}</div><h2 id="dr-h" tabindex="-1">${esc(r.title)}</h2><div style="margin-top:6px">${pill("", REQ_STATUS[r.status])}</div></div><button class="x" id="close" aria-label="Close">×</button></header>
    <div class="body">
      <dl class="kv"><dt>Customer</dt><dd><b>${esc(r.contact_name || "—")}</b><br>${esc(r.contact_phone || "")}${r.contact_phone ? ` · <a href="https://wa.me/${waNum(r.contact_phone)}" target="_blank" rel="noopener">WhatsApp</a>` : ""}<br><a href="mailto:${esc(r.contact_email)}">${esc(r.contact_email)}</a></dd>
        ${r.service ? `<dt>Service</dt><dd>${esc(r.service)}</dd>` : ""}${r.quantity ? `<dt>Quantity</dt><dd>${esc(r.quantity)}</dd>` : ""}${r.needed_by ? `<dt>Needed by</dt><dd>${fmtD(r.needed_by)}</dd>` : ""}
        ${r.details ? `<dt>Details</dt><dd style="white-space:pre-wrap">${esc(r.details)}</dd>` : ""}
        <dt>Quote or job</dt><dd>${job ? `<a href="${FR.href(job.stage === "quote" ? "press-quote" : "press-job", job.id)}" id="rq-job">${esc(job.number)} · ${STAGE_LABEL[job.stage]}</a>` : "Not yet"}</dd></dl>
      <h3 style="margin:16px 0 6px">Files</h3><ul class="files" id="rq-files"><li class="muted">Loading…</li></ul>
      <h3 style="margin:16px 0 6px">Messages with the customer</h3><div class="msgs" id="rq-msgs"><p class="muted">Loading…</p></div>
      ${ro ? "" : `<div class="field" style="margin-top:12px"><label for="rq-text">Reply <span class="muted">(the customer sees this on the portal)</span></label><textarea id="rq-text" rows="3"></textarea></div><div class="toolbar" style="justify-content:flex-end"><button class="btn small" id="rq-send">Send reply</button></div>
      <div class="fields" style="margin-top:12px"><div class="field"><label for="rq-status">Status</label><select id="rq-status">${Object.entries(REQ_STATUS).map(([k, l]) => `<option value="${k}" ${k === r.status ? "selected" : ""}>${l}</option>`).join("")}</select></div><div class="field wide"><label for="rq-note">Internal note <span class="muted">(staff only)</span></label><textarea id="rq-note" rows="2">${esc(r.staff_note || "")}</textarea></div></div>`}
      <p class="hint" id="rq-err" role="alert" style="color:var(--bad)"></p>
    </div>
    <footer>${!ro && !job ? `<button class="btn primary" id="rq-quote">Create quote from this</button>` : ""}<span style="flex:1"></span><button class="btn" id="rq-close">Close</button>${ro ? "" : `<button class="btn" id="rq-save">Save status and note</button>`}</footer>`;
  if (!repaint) showDrawer();
  $("#close").onclick = closeDrawer; $("#rq-close").onclick = closeDrawer;
  $("#rq-job")?.addEventListener("click", e => { e.preventDefault(); closeDrawer(); goJob(job); });
  $("#rq-quote")?.addEventListener("click", async () => {
    const b = $("#rq-quote"); b.disabled = true; b.textContent = "Creating…";
    const { data, error } = await SB().rpc("request_to_quote", { p_request: id });
    if (error) { b.disabled = false; b.textContent = "Create quote from this"; $("#rq-err").textContent = error.message; return; }
    logAct("ok", `Quote ${data?.number || ""} created from request ${r.ref}`);
    await FR.save("customer_request_messages", null, { request_id: id, company_id: S.company, author: "staff", author_name: S.me?.name || "", body: `We have received your request and are preparing your quote (${data?.number || ""}). We will send it shortly.` });
    toast(`Quote ${data?.number || ""} created. Add the prices, then save.`, "ok"); await load(["requests", "jobs", "customers"]); closeDrawer(); P.draft = null; FR.openRecord("press-quote", data.id);
  });
  $("#rq-send")?.addEventListener("click", async () => {
    const t = $("#rq-text").value.trim(); if (!t) return; const b = $("#rq-send"); b.disabled = true;
    const res = await FR.save("customer_request_messages", null, { request_id: id, company_id: S.company, author: "staff", author_name: S.me?.name || "", body: t });
    b.disabled = false; const o = outcome(res, "Reply sent", $("#rq-err")); if (!o) return;
    $("#rq-text").value = ""; if (o === "ok") loadRequestThread(id);
  });
  $("#rq-save")?.addEventListener("click", async () => {
    const body = { status: $("#rq-status").value, staff_note: $("#rq-note").value.trim() };
    if (outcome(await FR.save("customer_requests", id, FR.diff(r, body), { obj: r }), "Request saved", $("#rq-err"))) { closeDrawer(); load(["requests"]); }
  });
  loadRequestThread(id);
}
async function loadRequestThread(id) {
  const [{ data: files }, { data: msgs }] = await Promise.all([
    SB().from("customer_request_files").select("*").eq("request_id", id).order("created_at"),
    SB().from("customer_request_messages").select("*").eq("request_id", id).order("created_at"),
  ]);
  const fl = $("#rq-files"); if (fl) {
    if (!files?.length) fl.innerHTML = `<li class="muted">No files attached.</li>`;
    else { const rows = await Promise.all(files.map(async f => { const { data } = await SB().storage.from("customer-files").createSignedUrl(f.file_path, 3600); return `<li><a href="${esc(data?.signedUrl || "#")}" target="_blank" rel="noopener">${esc(f.name)}</a> <span class="muted">${f.size_bytes ? Math.round(f.size_bytes / 1024) + " KB" : ""}</span></li>`; })); fl.innerHTML = rows.join(""); }
  }
  const ml = $("#rq-msgs"); if (ml) ml.innerHTML = msgs?.length ? msgs.map(m => `<div class="msg ${m.author}">${esc(m.body)}<small>${esc(m.author === "staff" ? (m.author_name || "Staff") : (m.author_name || "Customer"))} · ${when(m.created_at)}</small></div>`).join("") : `<p class="muted">No messages yet.</p>`;
}

/* ---------- Customers (spec §9.6) ---------- */
const owedBy = c => P.jobs.filter(j => j.customer_id === c.id && billable(j)).reduce((s, j) => s + balanceOf(j), 0);
function renderCustomers(el, focusId) {
  const f = P.f["press-customers"] || {}; const q = (f.q || "").toLowerCase();
  const list = P.customers.filter(c => (!q || [c.name, c.phone, c.email].join(" ").toLowerCase().includes(q)) && (!f.owing || owedBy(c) > 0)).sort((a, b) => a.name.localeCompare(b.name));
  const jobsOf = c => P.jobs.filter(j => j.customer_id === c.id);
  const lastJob = c => jobsOf(c).map(j => j.created_at || "").sort().pop() || "";
  el.innerHTML = `${roBanner()}<div class="toolbar"><input type="search" data-f="q" placeholder="Search name, phone, email…" aria-label="Search customers" value="${esc(f.q || "")}">
      <div class="chips" role="group" aria-label="Filter"><button type="button" class="chip" aria-pressed="${!!f.owing}" data-chip="owing=1">Owes money<span class="cnt">${P.customers.filter(c => owedBy(c) > 0).length}</span></button></div>
      <span class="spacer"></span><button class="btn" id="pc-csv" ${list.length ? "" : "disabled"}>Export CSV</button></div>
    ${dataTable("press-customers", { caption: "Customers", rows: list, empty: P.customers.length ? `<div class="empty"><h2>No customers match</h2><button class="btn" data-clear="*">Clear filters</button></div>` : `<div class="empty"><h2>No customers yet</h2><p>Customers are added when you save a quote, or with Add customer.</p></div>`, cols: [
      { key: "n", label: "Customer", html: c => `<a class="rowlink" href="${FR.href("press-customer", c.id)}" data-c="${c.id}">${esc(c.name)}</a>${c.address ? `<span class="sub">${esc(c.address)}</span>` : ""}`, sort: c => c.name.toLowerCase(), card: "title" },
      { key: "p", label: "Phone", html: c => esc(c.phone || "—"), card: "meta" }, { key: "e", label: "Email", html: c => esc(c.email || "—"), card: "meta" },
      { key: "o", label: "Open jobs", cls: "r", html: c => jobsOf(c).filter(j => isOpenJob(j) || j.stage === "quote").length, sort: c => jobsOf(c).filter(isOpenJob).length, card: "meta" },
      { key: "l", label: "Last job", html: c => lastJob(c) ? when(lastJob(c)) : "—", sort: lastJob },
      { key: "b", label: "Owes", cls: "money", html: c => owedBy(c) > 0 ? `<b>${money(owedBy(c))}</b>` : "—", sort: owedBy, card: "meta" }] })}`;
  wireFilters(el, "press-customers", id => renderCustomers(el, id)); wireTable(el, "press-customers", () => renderCustomers(el)); refocus(focusId);
  el.querySelectorAll("a[data-c]").forEach(a => a.onclick = e => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); FR.openRecord("press-customer", a.dataset.c); });
  $("#pc-csv").onclick = () => downloadCsv(`customers-${today()}.csv`, ["Customer", "Phone", "Email", "Address", "Jobs", "Owes"], list.map(c => [c.name, c.phone, c.email, c.address, jobsOf(c).length, owedBy(c)]));
}
function newCustomer() {
  $("#drawer").innerHTML = `<header><div><h2 id="dr-h" tabindex="-1">Add customer</h2></div><button class="x" id="close" aria-label="Close">×</button></header>
    <div class="body"><div class="fields"><div class="field wide"><label for="c-name">Name</label><input id="c-name" autocomplete="off"></div><div class="field"><label for="c-phone">Phone</label><input id="c-phone" type="tel"></div><div class="field"><label for="c-email">Email</label><input id="c-email" type="email"></div><div class="field wide"><label for="c-addr">Address</label><input id="c-addr"></div></div><p class="hint" id="c-err" role="alert" style="color:var(--bad)"></p></div>
    <footer><span style="flex:1"></span><button class="btn" id="c-close">Cancel</button><button class="btn primary" id="c-save">Save customer</button></footer>`;
  showDrawer(); $("#close").onclick = closeDrawer; $("#c-close").onclick = closeDrawer;
  $("#c-save").onclick = async () => {
    const body = { company_id: S.company, name: $("#c-name").value.trim(), phone: $("#c-phone").value.trim(), email: $("#c-email").value.trim().toLowerCase(), address: $("#c-addr").value.trim() };
    if (!body.name) { $("#c-err").textContent = "Name is required."; return; }
    if (P.customers.some(c => c.name.toLowerCase() === body.name.toLowerCase())) { $("#c-err").textContent = "A customer with this name already exists."; return; }
    const r = await FR.save("press_customers", null, body); const o = outcome(r, "Customer saved", $("#c-err")); if (!o) return;
    closeDrawer(); await load(["customers"]); if (o === "ok" && r.data) FR.openRecord("press-customer", r.data.id);
  };
}
function renderCustomerPage(el) {
  const c = P.customers.find(x => x.id === S.param);
  if (!c) { el.innerHTML = `<div class="empty"><h2>Customer not found</h2><p>It may have been deleted.</p><a class="btn" href="${FR.href("press-customers")}" data-v="press-customers">Back to customers</a></div>`; el.querySelector("[data-v]").onclick = e => { e.preventDefault(); FR.setView("press-customers"); }; return; }
  const ro = !canWrite(); const jobs = P.jobs.filter(j => j.customer_id === c.id).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  const pays = P.payments.filter(p => jobs.some(j => j.id === p.job_id)).sort((a, b) => (b.paid_at || "").localeCompare(a.paid_at || ""));
  const billed = jobs.filter(billable).reduce((s, j) => s + N(j.total), 0);
  $("#page-title").textContent = c.name; document.title = `${c.name} · Future Ready`; $("#page-sub").textContent = [c.phone, c.email].filter(Boolean).join(" · ") || "Customer";
  el.innerHTML = `${roBanner()}
    <div class="stat-row"><div class="stat static"><span class="stat-label">Jobs</span><span class="stat-value">${jobs.filter(j => j.stage !== "quote").length}</span><span class="stat-hint">${jobs.filter(j => j.stage === "quote").length} open quote${jobs.filter(j => j.stage === "quote").length === 1 ? "" : "s"}</span></div>
      <div class="stat static"><span class="stat-label">Billed</span><span class="stat-value num">${money(billed)}</span><span class="stat-hint">all time</span></div>
      <div class="stat static ${owedBy(c) > 0 ? "warn" : ""}"><span class="stat-label">Owes</span><span class="stat-value num">${money(owedBy(c))}</span><span class="stat-hint">${owedBy(c) > 0 ? "across open invoices" : "nothing outstanding"}</span></div></div>
    <div class="grid-2">
      <section class="panel" aria-labelledby="cp-jobs"><div class="panel-head"><h2 id="cp-jobs">Quotes and jobs</h2></div>
        ${dataTable("cp-jobs", { caption: "Jobs for this customer", rows: jobs, empty: `<p class="empty-inline">No quotes or jobs yet.</p>`, cols: [
          { key: "n", label: "Number", cls: "mono", html: jobLink, sort: j => j.number, card: "title" }, { key: "t", label: "Job", html: j => esc(summaryOf(j)), card: "title" },
          { key: "s", label: "Stage", html: stagePill, card: "meta" }, { key: "tot", label: "Total", cls: "money", html: j => money(j.total), sort: j => N(j.total), card: "meta" },
          { key: "b", label: "Balance", cls: "money", html: j => billable(j) && balanceOf(j) > 0 ? money(balanceOf(j)) : "—", sort: balanceOf, card: "meta" }, { key: "d", label: "Created", html: j => when(j.created_at), sort: j => j.created_at }] })}
        <h3 style="margin:18px 0 6px">Payments</h3>${pays.length ? `<ul class="rows">${pays.slice(0, 20).map(p => { const j = P.jobs.find(x => x.id === p.job_id) || {}; return `<li><span><b class="num">${money(p.amount)}</b> <span class="mono muted">${esc(p.receipt_no)}</span><span class="sub">${when(p.paid_at)} · ${METHOD[p.method] || esc(p.method)} · ${esc(j.number || "")}</span></span></li>`; }).join("")}</ul>` : `<p class="empty-inline">No payments yet.</p>`}
      </section>
      <section class="panel" aria-labelledby="cp-det"><div class="panel-head"><h2 id="cp-det">Contact details</h2></div>
        <div class="fields"><div class="field wide"><label for="c-name">Name</label><input id="c-name" value="${esc(c.name)}" ${ro ? "disabled" : ""}></div><div class="field"><label for="c-phone">Phone</label><input id="c-phone" type="tel" value="${esc(c.phone || "")}" ${ro ? "disabled" : ""}></div><div class="field"><label for="c-email">Email</label><input id="c-email" type="email" value="${esc(c.email || "")}" ${ro ? "disabled" : ""}></div><div class="field wide"><label for="c-addr">Address</label><input id="c-addr" value="${esc(c.address || "")}" ${ro ? "disabled" : ""}></div><div class="field wide"><label for="c-notes">Notes</label><textarea id="c-notes" rows="3" ${ro ? "disabled" : ""}>${esc(c.notes || "")}</textarea></div></div>
        ${ro ? "" : `<div class="toolbar"><button class="btn" id="c-save">Save details</button><span class="savestate" id="c-state" role="status" aria-live="polite"></span></div><p class="hint">Renaming a customer also updates the name on their jobs.</p>`}
        ${c.phone ? `<p><a href="https://wa.me/${waNum(c.phone)}" target="_blank" rel="noopener">Message on WhatsApp</a></p>` : ""}
      </section>
    </div>`;
  wireTable(el, "cp-jobs", () => renderCustomerPage(el));
  el.querySelectorAll("a[data-job]").forEach(a => a.onclick = e => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); goJob(P.jobs.find(j => j.id === a.dataset.job)); });
  $("#c-save")?.addEventListener("click", async () => {
    const st = $("#c-state"); const body = { name: $("#c-name").value.trim(), phone: $("#c-phone").value.trim(), email: $("#c-email").value.trim().toLowerCase(), address: $("#c-addr").value.trim(), notes: $("#c-notes").value.trim() };
    if (!body.name) return FR.saveState(st, "failed", "Name is required.");
    FR.saveState(st, "saving"); const r = await FR.save("press_customers", c.id, FR.diff(c, body), { obj: c });
    if (r.error?.code === "queued") return FR.saveState(st, "queued"); if (r.error) return FR.saveState(st, "failed", "Could not save: " + r.error.message);
    FR.saveState(st, "saved"); load(["customers", "jobs"]);
  });
}

/* ---------- Materials (spec §9.8): stock changes only through movements ---------- */
function renderMaterials(el, focusId) {
  const f = P.f["press-materials"] || {}; const v = f.view || "all"; const q = (f.q || "").toLowerCase(); const since = addDays(today(), -14);
  const lastMove = m => P.moves.filter(x => x.material_id === m.id).map(x => x.moved_at || "").sort().pop() || "";
  const list = P.materials.filter(m => (v === "low" ? isLow(m) : v === "recent" ? lastMove(m) >= since : true) && (!q || [m.name, m.notes].join(" ").toLowerCase().includes(q)));
  const btn = (m, k, l) => `<button type="button" class="btn small ${k === "in" ? "" : "ghost"}" data-mv="${m.id}" data-k="${k}">${l}</button>`;
  el.innerHTML = `${roBanner()}
    <div class="chips" role="group" aria-label="Materials view">${[["all", "All", P.materials.length], ["low", "Low stock", P.materials.filter(isLow).length], ["recent", "Recently adjusted", P.materials.filter(m => lastMove(m) >= since).length]].map(([k, l, n]) => `<button type="button" class="chip" aria-pressed="${v === k}" data-chip="view=${k}">${l}<span class="cnt">${n}</span></button>`).join("")}</div>
    <div class="toolbar"><input type="search" data-f="q" placeholder="Search materials…" aria-label="Search materials" value="${esc(f.q || "")}"><span class="spacer"></span><span class="hint">Stock value ${money(P.materials.reduce((s, m) => s + N(m.quantity) * N(m.unit_cost), 0))}</span></div>
    ${dataTable("press-materials", { caption: "Materials", rows: list, empty: P.materials.length ? `<div class="empty"><h2>${v === "low" ? "Nothing is low" : "No materials match"}</h2><p>${v === "low" ? "Every material is above its reorder level." : "Try another view."}</p></div>` : `<div class="empty"><h2>No materials yet</h2><p>${canManage() ? "Add paper, ink and consumables with their reorder level." : "A manager adds materials; you can then record stock in and out."}</p></div>`, cols: [
      { key: "n", label: "Material", html: m => `<button type="button" class="rowlink" data-hist="${m.id}">${esc(m.name)}</button>${m.notes ? `<span class="sub">${esc(m.notes)}</span>` : ""}`, sort: m => m.name.toLowerCase(), card: "title" },
      { key: "q", label: "In stock", cls: "r", html: m => `<span class="num">${N(m.quantity).toLocaleString("en-NG")}</span> ${esc(m.unit)} ${isLow(m) ? pill("bad", "Low") : ""}`, sort: m => N(m.quantity), card: "meta" },
      { key: "r", label: "Reorder at", cls: "r", html: m => `${N(m.reorder_level)} ${esc(m.unit)}`, sort: m => N(m.reorder_level), card: "meta" },
      { key: "c", label: "Unit cost", cls: "money", html: m => money(m.unit_cost), sort: m => N(m.unit_cost) },
      { key: "l", label: "Last movement", html: m => lastMove(m) ? when(lastMove(m)) : "—", sort: lastMove, card: "meta" },
      { key: "a", label: "Record", html: m => canWrite() ? `<span class="row-acts">${btn(m, "in", "Receive")}${btn(m, "out", "Use")}${btn(m, "count", "Adjust")}</span>` : "", card: "meta" }] })}`;
  wireFilters(el, "press-materials", id => renderMaterials(el, id)); wireTable(el, "press-materials", () => renderMaterials(el)); refocus(focusId);
  el.querySelectorAll("[data-mv]").forEach(b => b.onclick = () => moveStock(P.materials.find(m => m.id === b.dataset.mv), b.dataset.k));
  el.querySelectorAll("[data-hist]").forEach(b => b.onclick = () => materialHistory(P.materials.find(m => m.id === b.dataset.hist)));
}
function moveStock(m, kind) {
  const T = { in: ["Receive stock", "Quantity received"], out: ["Use stock", "Quantity used or wasted"], count: ["Adjust after a count", "Quantity counted on the shelf"] }[kind];
  $("#drawer").innerHTML = `<header><div><div class="muted">${esc(m.name)}</div><h2 id="dr-h" tabindex="-1">${T[0]}</h2><div class="muted" style="margin-top:4px">${N(m.quantity)} ${esc(m.unit)} in stock now</div></div><button class="x" id="close" aria-label="Close">×</button></header>
    <div class="body"><div class="fields"><div class="field"><label for="mv-qty">${T[1]} (${esc(m.unit)})</label><input type="number" id="mv-qty" min="0" step="any" inputmode="decimal"></div>
      ${kind === "out" ? `<div class="field wide"><label for="mv-job">For job <span class="muted">(optional)</span></label><select id="mv-job"><option value="">None</option>${P.jobs.filter(isOpenJob).map(j => `<option value="${j.id}">${esc(j.number)} · ${esc(summaryOf(j))}</option>`).join("")}</select></div>` : ""}
      <div class="field wide"><label for="mv-note">${kind === "in" ? "Supplier or reference" : kind === "count" ? "Reason (required)" : "Note"}</label><input id="mv-note"></div></div>
      <p class="result-line" id="mv-after" aria-live="polite"></p><p class="hint">Stock changes need a connection; they are never kept for later.</p><p class="hint" id="mv-err" role="alert" style="color:var(--bad)"></p></div>
    <footer><span style="flex:1"></span><button class="btn" id="mv-close">Cancel</button><button class="btn primary" id="mv-save">Record</button></footer>`;
  showDrawer(); $("#close").onclick = closeDrawer; $("#mv-close").onclick = closeDrawer;
  const delta = () => { const v = N($("#mv-qty").value); return kind === "in" ? v : kind === "out" ? -v : Math.round((v - N(m.quantity)) * 1000) / 1000; };
  $("#mv-qty").oninput = () => { const v = $("#mv-qty").value; $("#mv-after").innerHTML = v === "" ? "" : `Stock after: <b class="num">${(N(m.quantity) + delta()).toLocaleString("en-NG")} ${esc(m.unit)}</b>${kind === "count" ? ` (change ${delta() > 0 ? "+" : ""}${delta()})` : ""}`; };
  $("#mv-save").onclick = async () => {
    const err = $("#mv-err"); err.textContent = ""; const v = $("#mv-qty").value; const dl = delta(); const note = $("#mv-note").value.trim();
    if (v === "" || (kind !== "count" && N(v) <= 0)) { err.textContent = "Enter a quantity."; return; }
    if (kind === "count" && dl === 0) { err.textContent = "The count matches the stock on record; nothing to change."; return; }
    if (kind === "count" && !note) { err.textContent = "Say why the stock is being adjusted."; return; }
    const r = await FR.save("press_material_moves", null, { company_id: S.company, material_id: m.id, job_id: $("#mv-job")?.value || null, delta: dl, note: kind === "count" ? `Count adjustment: ${note}` : note, moved_by: me() });
    if (outcome(r, "Stock updated", err)) { closeDrawer(); load(["materials", "moves"]); }
  };
  setTimeout(() => $("#mv-qty")?.focus(), 60);
}
function materialHistory(m) {
  const mv = P.moves.filter(x => x.material_id === m.id).sort((a, b) => (b.moved_at || "").localeCompare(a.moved_at || ""));
  $("#drawer").innerHTML = `<header><div><h2 id="dr-h" tabindex="-1">${esc(m.name)}</h2><div class="muted" style="margin-top:4px">${N(m.quantity)} ${esc(m.unit)} in stock · reorder at ${N(m.reorder_level)}</div></div><button class="x" id="close" aria-label="Close">×</button></header>
    <div class="body">${canManage() ? `<div class="fields"><div class="field wide"><label for="m-name">Name</label><input id="m-name" value="${esc(m.name)}"></div><div class="field"><label for="m-unit">Unit</label><input id="m-unit" value="${esc(m.unit)}"></div><div class="field"><label for="m-re">Reorder at</label><input type="number" id="m-re" value="${N(m.reorder_level)}" min="0" step="any"></div><div class="field"><label for="m-cost">Unit cost (₦)</label><input type="number" id="m-cost" value="${N(m.unit_cost)}" min="0" step="0.01"></div><div class="field wide"><label for="m-notes">Notes</label><input id="m-notes" value="${esc(m.notes || "")}"></div></div><div class="toolbar"><button class="btn small" id="m-save">Save details</button><span class="savestate" id="m-state" role="status" aria-live="polite"></span></div>` : ""}
      <h3 style="margin:16px 0 6px">Movements</h3>${mv.length ? `<ul class="history">${mv.slice(0, 60).map(x => { const j = P.jobs.find(y => y.id === x.job_id); return `<li><time>${FR.fmtDate(x.moved_at)}</time><span><b class="num">${N(x.delta) > 0 ? "+" : ""}${N(x.delta)}</b> ${esc(m.unit)}${j ? " for " + esc(j.number) : ""}${x.note ? " · " + esc(x.note) : ""} <span class="muted" data-by="${esc(x.moved_by || "")}"></span></span></li>`; }).join("")}</ul>` : `<p class="muted">No movements yet.</p>`}</div>
    <footer>${canManage() ? `<button class="btn small danger" id="m-del">Delete material</button>` : ""}<span style="flex:1"></span><button class="btn" id="m-close">Close</button></footer>`;
  showDrawer(); FR.resolveNames(); $("#close").onclick = closeDrawer; $("#m-close").onclick = closeDrawer;
  $("#m-save")?.addEventListener("click", async () => { const st = $("#m-state"); const body = { name: $("#m-name").value.trim(), unit: $("#m-unit").value.trim() || "unit", reorder_level: N($("#m-re").value), unit_cost: N($("#m-cost").value), notes: $("#m-notes").value.trim() }; if (!body.name) return FR.saveState(st, "failed", "Name is required."); FR.saveState(st, "saving"); const r = await FR.save("press_materials", m.id, FR.diff(m, body), { obj: m }); if (r.error?.code === "queued") return FR.saveState(st, "queued"); if (r.error) return FR.saveState(st, "failed", "Could not save: " + r.error.message); FR.saveState(st, "saved"); load(["materials"]); });
  $("#m-del")?.addEventListener("click", async () => { if (!confirm(`Delete ${m.name}? Its stock history is kept, and a Group Admin can restore it.`)) return; const r = await FR.softDelete("press_materials", m.id); if (!r.ok) toast(r.error, "bad"); else { closeDrawer(); load(["materials", "moves"]); } });
}
function newMaterial() {
  $("#drawer").innerHTML = `<header><div><h2 id="dr-h" tabindex="-1">Add material</h2></div><button class="x" id="close" aria-label="Close">×</button></header>
    <div class="body"><div class="fields"><div class="field wide"><label for="m-name">Name</label><input id="m-name" placeholder="e.g. A4 150gsm gloss paper"></div><div class="field"><label for="m-unit">Unit</label><input id="m-unit" placeholder="sheet, ream, litre, roll"></div><div class="field"><label for="m-qty">Opening stock</label><input type="number" id="m-qty" value="0" min="0" step="any"></div><div class="field"><label for="m-re">Reorder at</label><input type="number" id="m-re" value="0" min="0" step="any"></div><div class="field"><label for="m-cost">Unit cost (₦)</label><input type="number" id="m-cost" value="0" min="0" step="0.01"></div><div class="field wide"><label for="m-notes">Notes</label><input id="m-notes"></div></div><p class="hint" id="m-err" role="alert" style="color:var(--bad)"></p></div>
    <footer><span style="flex:1"></span><button class="btn" id="m-close">Cancel</button><button class="btn primary" id="m-save">Save material</button></footer>`;
  showDrawer(); $("#close").onclick = closeDrawer; $("#m-close").onclick = closeDrawer;
  $("#m-save").onclick = async () => {
    const body = { company_id: S.company, name: $("#m-name").value.trim(), unit: $("#m-unit").value.trim() || "unit", quantity: N($("#m-qty").value), reorder_level: N($("#m-re").value), unit_cost: N($("#m-cost").value), notes: $("#m-notes").value.trim() };
    if (!body.name) { $("#m-err").textContent = "Name is required."; return; }
    if (outcome(await FR.save("press_materials", null, body), "Material saved", $("#m-err"))) { closeDrawer(); load(["materials"]); }
  };
}

/* ---------- Invoices & payments (spec §9.7). The invoice is the job: same number, total, payments, balance ---------- */
const PAY_LABEL = { open: "Open balance", overdue: "Overdue", part: "Part-paid", unpaid: "Unpaid", paid: "Paid", cancelled: "Cancelled", all: "All" };
const AGE_LABEL = { today: "Due today", "1-7": "1–7 days late", "8-30": "8–30 days late", "30+": "Over 30 days late" };
function renderMoney(el, focusId) {
  const f = P.f["press-money"] || {}; const tab = f.tab || "invoices"; const q = (f.q || "").toLowerCase(); const status = f.status || "open";
  const inv = P.jobs.filter(j => j.stage !== "quote");
  const sTest = j => { const k = payStatus(j).key; return status === "all" ? true : status === "open" ? !["paid", "cancelled"].includes(k) && balanceOf(j) > 0 : status === "overdue" ? k === "overdue" : k === status; };
  const invList = inv.filter(sTest).filter(j => (!f.age || ageBucket(j) === f.age) && (!q || [j.number, custName(j), summaryOf(j)].join(" ").toLowerCase().includes(q)));
  const pays = P.payments.slice().sort((a, b) => (b.paid_at || "").localeCompare(a.paid_at || "")).filter(p => { const j = P.jobs.find(x => x.id === p.job_id) || {}; return !q || [p.receipt_no, j.number, custName(j)].join(" ").toLowerCase().includes(q); });
  const sc = k => inv.filter(j => { const kk = payStatus(j).key; return k === "all" ? true : k === "open" ? !["paid", "cancelled"].includes(kk) && balanceOf(j) > 0 : k === "overdue" ? kk === "overdue" : kk === k; }).length;
  const totalBal = invList.reduce((s, j) => s + (j.stage === "cancelled" ? 0 : balanceOf(j)), 0);
  el.innerHTML = `${roBanner()}${demoNote()}
    <div class="seg" role="group" aria-label="Show" style="width:max-content"><button type="button" aria-pressed="${tab === "invoices"}" data-tab="invoices">Invoices</button><button type="button" aria-pressed="${tab === "receipts"}" data-tab="receipts">Receipts</button></div>
    ${tab === "invoices" ? `<div class="chips" role="group" aria-label="Invoice status">${["open", "overdue", "part", "unpaid", "paid", "cancelled", "all"].map(k => `<button type="button" class="chip" aria-pressed="${status === k}" data-chip="status=${k}">${PAY_LABEL[k]}<span class="cnt">${sc(k)}</span></button>`).join("")}</div>` : ""}
    <div class="toolbar"><input type="search" data-f="q" placeholder="${tab === "invoices" ? "Search invoice, customer, job…" : "Search receipt, job, customer…"}" aria-label="Search" value="${esc(f.q || "")}">
      ${tab === "invoices" ? `<select data-f="age" aria-label="How late"><option value="">Any age</option>${Object.entries(AGE_LABEL).map(([k, l]) => `<option value="${k}" ${f.age === k ? "selected" : ""}>${l}</option>`).join("")}</select>` : ""}
      <span class="spacer"></span>${tab === "invoices" ? `<span class="hint">Balance in view <b class="num">${money(totalBal)}</b></span>` : ""}<button class="btn" id="pm-csv">Export CSV</button></div>
    ${filterChips("press-money", { age: a => AGE_LABEL[a] })}
    ${tab === "invoices" ? dataTable("press-money", { caption: "Invoices", rows: invList, empty: inv.length ? `<div class="empty"><h2>No invoices in this view</h2><p>${status === "overdue" ? "Nothing is overdue." : "Try another status."}</p></div>` : `<div class="empty"><h2>No invoices yet</h2><p>An invoice exists once a customer accepts a quote.</p></div>`, cols: [
        { key: "n", label: "Invoice", cls: "mono", html: jobLink, sort: j => j.number, card: "title" }, { key: "c", label: "Customer", html: j => esc(custName(j)), sort: j => custName(j).toLowerCase(), card: "title" },
        { key: "j", label: "Job", html: j => esc(summaryOf(j)) },
        { key: "t", label: "Total", cls: "money", html: j => money(j.total), sort: j => N(j.total), card: "meta" }, { key: "p", label: "Paid", cls: "money", html: j => money(paidOf(j)), sort: paidOf },
        { key: "b", label: "Balance", cls: "money", html: j => j.stage === "cancelled" ? "—" : `<b>${money(balanceOf(j))}</b>`, sort: balanceOf, card: "meta" },
        { key: "d", label: "Due", html: j => j.due_date ? fmtShort(j.due_date) : "—", sort: j => j.due_date || "9999", card: "meta" },
        { key: "s", label: "Status", html: j => { const s = payStatus(j); return pill(s.cls, s.label); }, sort: j => payStatus(j).key, card: "meta" },
        { key: "a", label: "Actions", html: j => `<span class="row-acts">${canWrite() && balanceOf(j) > 0 && j.stage !== "cancelled" ? `<button type="button" class="btn small" data-pay="${j.id}">Record payment</button>` : ""}<button type="button" class="btn small ghost" data-inv="${j.id}" aria-label="Invoice ${esc(j.number)} as PDF">PDF</button></span>`, card: "meta" }] })
    : dataTable("press-receipts", { caption: "Receipts", rows: pays, empty: `<div class="empty"><h2>No payments recorded yet</h2><p>Record a payment from an invoice.</p></div>`, cols: [
        { key: "r", label: "Receipt", cls: "mono", html: p => esc(p.receipt_no), sort: p => p.receipt_no, card: "title" }, { key: "d", label: "Date", html: p => fmtShort(p.paid_at), sort: p => p.paid_at, card: "title" },
        { key: "c", label: "Customer", html: p => esc(custName(P.jobs.find(x => x.id === p.job_id) || {})), card: "meta" },
        { key: "j", label: "Invoice", cls: "mono", html: p => { const j = P.jobs.find(x => x.id === p.job_id); return j ? jobLink(j) : "—"; }, card: "meta" },
        { key: "a", label: "Amount", cls: "money", html: p => money(p.amount), sort: p => N(p.amount), card: "meta" }, { key: "m", label: "Method", html: p => METHOD[p.method] || esc(p.method), sort: p => p.method },
        { key: "by", label: "Received by", html: p => `<span data-by="${esc(p.received_by || "")}"></span>` },
        { key: "x", label: "Receipt PDF", html: p => `<button type="button" class="btn small ghost" data-rcpt="${p.id}" aria-label="Receipt ${esc(p.receipt_no)} as PDF">PDF</button>`, card: "meta" }] })}`;
  wireFilters(el, "press-money", id => renderMoney(el, id)); wireTable(el, tab === "invoices" ? "press-money" : "press-receipts", () => renderMoney(el)); refocus(focusId);
  el.querySelectorAll("[data-by]").forEach(s => { const m = S.members[(s.dataset.by || "").toLowerCase()]; s.textContent = m ? FR.memberName(m) : s.dataset.by; });
  el.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { (P.f["press-money"] = P.f["press-money"] || {}).tab = b.dataset.tab; renderMoney(el); });
  el.querySelectorAll("[data-pay]").forEach(b => b.onclick = () => openPayment(P.jobs.find(j => j.id === b.dataset.pay)));
  el.querySelectorAll("[data-inv]").forEach(b => b.onclick = () => { const j = P.jobs.find(x => x.id === b.dataset.inv); savePdf(invoicePdf(j), `${j.number}-invoice.pdf`); });
  el.querySelectorAll("[data-rcpt]").forEach(b => b.onclick = () => { const p = P.payments.find(x => x.id === b.dataset.rcpt); const j = P.jobs.find(x => x.id === p.job_id); if (j) savePdf(receiptPdf(j, p), `${p.receipt_no}.pdf`); });
  $("#pm-csv").onclick = () => tab === "invoices"
    ? downloadCsv(`invoices-${status}-${today()}.csv`, ["Invoice", "Customer", "Job", "Total", "Paid", "Balance", "Due", "Status"], invList.map(j => [j.number, custName(j), summaryOf(j), N(j.total), paidOf(j), balanceOf(j), j.due_date || "", payStatus(j).label]))
    : downloadCsv(`receipts-${today()}.csv`, ["Receipt", "Date", "Customer", "Invoice", "Amount", "Method", "Received by", "Note"], pays.map(p => { const j = P.jobs.find(x => x.id === p.job_id) || {}; return [p.receipt_no, p.paid_at, custName(j), j.number, N(p.amount), METHOD[p.method] || p.method, p.received_by, p.note]; }));
}

/* ---------- Reports (spec §9.9): plain tables that answer the questions managers ask ---------- */
function renderReports(el) {
  const ym = d => (d || "").slice(0, 7); const now = today().slice(0, 7); const prevD = new Date(); prevD.setDate(1); prevD.setMonth(prevD.getMonth() - 1); const prev = prevD.toISOString().slice(0, 7);
  const monthRow = m => { const quotes = P.jobs.filter(j => ym(j.quoted_at || j.created_at) === m); const acc = P.jobs.filter(j => ym(j.accepted_at) === m); const del = P.jobs.filter(j => j.stage === "delivered" && ym(j.delivered_at) === m); return { quotes: quotes.length, quoted: quotes.reduce((s, j) => s + N(j.total), 0), accepted: acc.length, billed: acc.reduce((s, j) => s + N(j.total), 0), delivered: del.length, received: P.payments.filter(p => ym(p.paid_at) === m).reduce((s, p) => s + N(p.amount), 0) }; };
  const a = monthRow(now), b = monthRow(prev); const mname = m => new Date(m + "-15").toLocaleDateString("en-NG", { month: "long", year: "numeric" });
  const since = addDays(today(), -90); const top = P.customers.map(c => ({ c, billed: P.jobs.filter(j => j.customer_id === c.id && billable(j) && (j.accepted_at || "").slice(0, 10) >= since).reduce((s, j) => s + N(j.total), 0) })).filter(x => x.billed > 0).sort((x, y) => y.billed - x.billed).slice(0, 10);
  const aged = ["today", "1-7", "8-30", "30+"].map(k => { const js = P.jobs.filter(j => billable(j) && ageBucket(j) === k); return [AGE_LABEL[k], js.length, js.reduce((s, j) => s + balanceOf(j), 0)]; });
  const notDue = P.jobs.filter(j => billable(j) && balanceOf(j) > 0 && !ageBucket(j));
  const rows = [["Quotes created", a.quotes, b.quotes], ["Value quoted", money(a.quoted), money(b.quoted)], ["Quotes accepted", a.accepted, b.accepted], ["Value accepted", money(a.billed), money(b.billed)], ["Jobs delivered", a.delivered, b.delivered], ["Money received", money(a.received), money(b.received)]];
  el.innerHTML = `${demoNote()}
    <section class="panel" aria-labelledby="rp-m"><div class="panel-head"><h2 id="rp-m">This month and last month</h2><button class="btn small" id="rp-csv">Export CSV</button></div>
      <div class="table-wrap"><table style="min-width:0"><thead><tr><th scope="col">Measure</th><th scope="col" class="r">${mname(now)}</th><th scope="col" class="r">${mname(prev)}</th></tr></thead><tbody>${rows.map(r => `<tr><th scope="row" style="position:static;background:none;font-weight:500;color:var(--fg)">${r[0]}</th><td class="r num">${r[1]}</td><td class="r num">${r[2]}</td></tr>`).join("")}</tbody></table></div>
      <p class="hint">Months follow the date each step happened: quoted, accepted, delivered, paid.</p></section>
    <div class="grid-2">
      <section class="panel" aria-labelledby="rp-age"><div class="panel-head"><h2 id="rp-age">Money owed by age</h2></div>
        <div class="table-wrap"><table style="min-width:0"><thead><tr><th scope="col">Age</th><th scope="col" class="r">Invoices</th><th scope="col" class="money">Balance</th></tr></thead><tbody><tr><td>Not yet due or no due date</td><td class="r num">${notDue.length}</td><td class="money">${money(notDue.reduce((s, j) => s + balanceOf(j), 0))}</td></tr>${aged.map(r => `<tr><td>${r[0]}</td><td class="r num">${r[1]}</td><td class="money">${money(r[2])}</td></tr>`).join("")}</tbody></table></div></section>
      <section class="panel" aria-labelledby="rp-top"><div class="panel-head"><h2 id="rp-top">Top customers, last 90 days</h2></div>
        ${top.length ? `<div class="table-wrap"><table style="min-width:0"><thead><tr><th scope="col">Customer</th><th scope="col" class="money">Accepted work</th></tr></thead><tbody>${top.map(x => `<tr><td><a class="rowlink" href="${FR.href("press-customer", x.c.id)}" data-c="${x.c.id}">${esc(x.c.name)}</a></td><td class="money">${money(x.billed)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="empty-inline">No accepted work in the last 90 days.</p>`}</section>
    </div>
    <section class="panel" aria-labelledby="rp-st"><div class="panel-head"><h2 id="rp-st">Jobs by stage now</h2></div>
      <ul class="stage-sum">${STAGES.filter(s => s !== "delivered" && s !== "cancelled").map(s => `<li><span>${STAGE_LABEL[s]}</span><b class="num">${P.jobs.filter(j => j.stage === s).length}</b></li>`).join("")}</ul></section>`;
  el.querySelectorAll("a[data-c]").forEach(x => x.onclick = e => { e.preventDefault(); FR.openRecord("press-customer", x.dataset.c); });
  $("#rp-csv").onclick = () => downloadCsv(`press-monthly-${now}.csv`, ["Measure", mname(now), mname(prev)], [["Quotes created", a.quotes, b.quotes], ["Value quoted", a.quoted, b.quoted], ["Quotes accepted", a.accepted, b.accepted], ["Value accepted", a.billed, b.billed], ["Jobs delivered", a.delivered, b.delivered], ["Money received", a.received, b.received]]);
}

/* ---------- Settings: rate card (Managers) and letterhead (Company Admins) ---------- */
function renderRates(el) {
  const cfg = P.cfg; const ro = !canManage(); const dis = isAdmin() ? "" : "disabled";
  if (ro) { el.innerHTML = `<div class="empty"><h2>Managers only</h2><p>Settings are for Managers and Admins of ${esc(FR.companyShort(S.company))}.</p></div>`; return; }
  const cats = [...new Set(P.rates.map(r => r.category))];
  el.innerHTML = `<div class="grid-2">
    <section class="panel" aria-labelledby="rc-h"><div class="panel-head"><h2 id="rc-h">Rate card</h2><span class="muted">What each quote line costs</span></div>
      <div class="fields"><div class="field"><label for="rc-cat">Category</label><input id="rc-cat" list="rc-cats" placeholder="e.g. Banners"><datalist id="rc-cats">${cats.map(c => `<option value="${esc(c)}">`).join("")}</datalist></div><div class="field"><label for="rc-name">Item</label><input id="rc-name" placeholder="e.g. Flex banner"></div><div class="field"><label for="rc-unit">Unit</label><input id="rc-unit" value="piece"></div><div class="field"><label for="rc-price">Price (₦)</label><input id="rc-price" type="number" min="0" step="0.01"></div></div>
      <div class="toolbar" style="margin:10px 0 14px"><button class="btn small" id="rc-add">Add item</button></div>
      <div class="table-wrap"><table style="min-width:0"><caption class="sr-only">Rate card</caption><thead><tr><th scope="col">Category</th><th scope="col">Item</th><th scope="col">Unit</th><th scope="col">Price</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${P.rates.map(r => `<tr class="${r.active ? "" : "off"}"><td>${esc(r.category)}</td><td>${esc(r.name)}${r.active ? "" : ` <span class="pill flat">Hidden</span>`}</td><td>${esc(r.unit)}</td><td><input type="number" aria-label="Price of ${esc(r.name)}" data-price="${r.id}" value="${N(r.price)}" min="0" step="0.01" style="width:110px"></td><td><span class="row-acts"><button class="btn small ghost" data-toggle="${r.id}">${r.active ? "Hide" : "Show"}</button><button class="btn small ghost danger" data-del="${r.id}">Delete</button></span></td></tr>`).join("") || `<tr><td colspan="5" class="muted">No items yet.</td></tr>`}</tbody></table></div></section>
    <section class="panel" aria-labelledby="lh-h"><div class="panel-head"><h2 id="lh-h">Letterhead and terms</h2><span class="muted">Printed on quotes, invoices and receipts</span></div>
      ${isAdmin() ? "" : `<p class="hint">Only a company Admin can change these.</p>`}
      <div class="fields">
        <div class="field wide"><label for="cf-name">Business name</label><input id="cf-name" value="${esc(cfg.business_name)}" ${dis}></div>
        <div class="field wide"><label for="cf-addr">Address</label><input id="cf-addr" value="${esc(cfg.address)}" ${dis}></div>
        <div class="field"><label for="cf-phone">Phone</label><input id="cf-phone" value="${esc(cfg.phone)}" ${dis}></div><div class="field"><label for="cf-email">Email</label><input id="cf-email" value="${esc(cfg.email)}" ${dis}></div>
        <div class="field"><label for="cf-prefix">Number prefix</label><input id="cf-prefix" value="${esc(cfg.prefix)}" maxlength="6" ${dis}></div><div class="field"><label for="cf-dep">Default deposit %</label><input id="cf-dep" type="number" min="0" max="100" value="${N(cfg.deposit_pct)}" ${dis}></div>
        <div class="field"><label for="cf-valid">Quote valid (days)</label><input id="cf-valid" type="number" min="1" value="${N(cfg.valid_days)}" ${dis}></div><div class="field"><label for="cf-vat">VAT %</label><input id="cf-vat" type="number" min="0" max="100" step="0.5" value="${N(cfg.vat_pct)}" ${dis}></div>
        <div class="field"><label for="cf-bank">Bank</label><input id="cf-bank" value="${esc(cfg.bank_name)}" ${dis}></div><div class="field"><label for="cf-acct">Account name</label><input id="cf-acct" value="${esc(cfg.account_name)}" ${dis}></div>
        <div class="field wide"><label for="cf-acno">Account number</label><input id="cf-acno" value="${esc(cfg.account_number)}" ${dis}></div>
        <div class="field wide"><label for="cf-terms">Terms</label><textarea id="cf-terms" rows="3" ${dis}>${esc(cfg.terms)}</textarea></div>
      </div>
      ${isAdmin() ? `<div class="toolbar" style="margin-top:12px"><button class="btn primary" id="cf-save">Save letterhead</button><span class="savestate" id="cf-state" role="status" aria-live="polite"></span></div>` : ""}</section></div>`;
  $("#rc-add").onclick = async () => {
    const name = $("#rc-name").value.trim(); if (!name) { toast("Enter the item name", "warn"); $("#rc-name").focus(); return; }
    if (outcome(await FR.save("press_rate_items", null, { company_id: S.company, category: $("#rc-cat").value.trim() || "General", name, unit: $("#rc-unit").value.trim() || "piece", price: N($("#rc-price").value), order: 100 + P.rates.length }), "Item added")) load(["rates"]);
  };
  el.querySelectorAll("[data-price]").forEach(i => i.onchange = async () => outcome(await FR.save("press_rate_items", i.dataset.price, { price: N(i.value) }, { obj: P.rates.find(x => x.id === i.dataset.price) }), "Price saved"));
  el.querySelectorAll("[data-toggle]").forEach(b => b.onclick = async () => { const r = P.rates.find(x => x.id === b.dataset.toggle); if (outcome(await FR.save("press_rate_items", r.id, { active: !r.active }, { obj: r }))) load(["rates"]); });
  el.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => { if (!confirm("Delete this rate card item? A Group Admin can restore it.")) return; const r = await FR.softDelete("press_rate_items", b.dataset.del); if (!r.ok) toast(r.error, "bad"); else load(["rates"]); });
  $("#cf-save")?.addEventListener("click", async () => {
    const st = $("#cf-state"); FR.saveState(st, "saving");
    const data = { business_name: $("#cf-name").value.trim(), address: $("#cf-addr").value.trim(), phone: $("#cf-phone").value.trim(), email: $("#cf-email").value.trim(), prefix: ($("#cf-prefix").value.trim().toUpperCase() || "FRP").replace(/[^A-Z0-9]/g, ""), deposit_pct: N($("#cf-dep").value), valid_days: N($("#cf-valid").value) || 14, vat_pct: N($("#cf-vat").value), bank_name: $("#cf-bank").value.trim(), account_name: $("#cf-acct").value.trim(), account_number: $("#cf-acno").value.trim(), terms: $("#cf-terms").value.trim() };
    const { error } = await SB().rpc("save_company_settings", { p_company: S.company, p_module: "press", p_data: data });
    if (error) return FR.saveState(st, "failed", "Could not save: " + error.message); FR.saveState(st, "saved"); load(["settings"]);
  });
}
/* ---------- PDFs (jsPDF + autotable) ---------- */
function docBase(title, number, dateStr) {
  // Letterhead per the Brand System v2 document templates (07_Email_Documents): green top bar, company lockup, ink title, muted meta.
  const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: "mm", format: "a4" }); const cfg = P.cfg;
  doc.setFillColor(13, 122, 98); doc.rect(0, 0, 210, 3, "F");
  const logo = (window.FR_LOGOS || {})[S.company] || (window.FR_LOGOS || {}).group;
  let y = 14;
  if (logo) { const w = 66, h = w * logo.h / logo.w; try { doc.addImage(logo.data, "PNG", 12, 9, w, h); } catch {} y = 9 + h + 4; }
  else { doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(16, 33, 29); doc.text(cfg.business_name || "", 14, 20); y = 26; }
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(99, 115, 109);
  const lines = [cfg.business_name !== FR.companyName(S.company) ? cfg.business_name : "", cfg.address, [cfg.phone, cfg.email].filter(Boolean).join(" · ")].filter(Boolean); lines.forEach((l, i) => doc.text(l, 14, y + i * 4.2));
  doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.setTextColor(16, 33, 29); doc.text(title, 196, 22, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(99, 115, 109); doc.text("# " + number, 196, 29, { align: "right" }); doc.text(dateStr, 196, 34, { align: "right" });
  doc.setDrawColor(220, 229, 224); doc.line(14, 40, 196, 40);
  return doc;
}
function customerBlock(doc, j, y) {
  const c = custOf(j) || { name: custName(j) };
  doc.setFontSize(9); doc.setTextColor(99, 115, 109); doc.text("CLIENT", 14, y);
  doc.setFontSize(11); doc.setTextColor(16, 33, 29); doc.setFont("helvetica", "bold"); doc.text(c.name || "", 14, y + 5.5); doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
  [c.phone, c.email, c.address].filter(Boolean).forEach((l, i) => doc.text(String(l), 14, y + 10.5 + i * 4.5));
  if (j.title) { doc.setFontSize(9); doc.setTextColor(99, 115, 109); doc.text("JOB", 110, y); doc.setFontSize(10.5); doc.setTextColor(16, 33, 29); doc.text(doc.splitTextToSize(j.title, 86), 110, y + 5.5); }
  return y + 26;
}
function itemsTable(doc, j, y) {
  const specs = Object.entries(j.specs || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(" · ");
  doc.autoTable({ startY: y, head: [["Description", "Qty", "Unit", "Unit price", "Total"]], body: (j.items || []).map(i => [i.description, String(N(i.qty)), i.unit || "", money(i.unit_price).replace("₦", "N"), money(i.total).replace("₦", "N")]),
    styles: { fontSize: 9.5, cellPadding: 2.8, textColor: [16, 33, 29], lineColor: [220, 229, 224], lineWidth: 0.2 }, headStyles: { fillColor: [246, 248, 247], textColor: [99, 115, 109], fontStyle: "bold" }, alternateRowStyles: { fillColor: [255, 255, 255] }, columnStyles: { 1: { halign: "right", cellWidth: 18 }, 2: { cellWidth: 20 }, 3: { halign: "right", cellWidth: 30 }, 4: { halign: "right", cellWidth: 32 } }, margin: { left: 14, right: 14 } });
  let yy = doc.lastAutoTable.finalY + 6;
  const t = calcTotals(j.items || [], j.discount, P.cfg.vat_pct);
  const rows = [["Subtotal", money(t.subtotal)], ...(N(j.discount) ? [["Discount", "- " + money(j.discount)]] : []), ...(N(P.cfg.vat_pct) ? [[`VAT ${N(P.cfg.vat_pct)}%`, money(t.vat)]] : []), ["Total", money(j.total)]];
  doc.setFontSize(10);
  rows.forEach(([k, v], i) => { const bold = k === "Total"; doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(bold ? 13 : 10); doc.setTextColor(99, 115, 109); doc.text(k.toUpperCase(), 150, yy + i * 6.5, { align: "right" }); doc.setTextColor(16, 33, 29); doc.text(v.replace("₦", "N"), 196, yy + i * 6.5, { align: "right" }); doc.setFontSize(10); });
  yy += rows.length * 6.5 + 4;
  if (specs) { doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(102, 112, 133); doc.text(doc.splitTextToSize("Specification: " + specs, 180), 14, yy); yy += 6 + Math.ceil(specs.length / 110) * 4; }
  if (j.description) { doc.setFontSize(9.5); doc.setTextColor(16, 24, 40); const ls = doc.splitTextToSize(j.description, 180); doc.text(ls, 14, yy); yy += ls.length * 4.5 + 2; }
  return yy;
}
function footerBlock(doc, lines, y) {
  doc.setFontSize(8.5); doc.setTextColor(99, 115, 109);
  lines.filter(Boolean).forEach(l => { const ls = doc.splitTextToSize(l, 182); doc.text(ls, 14, y); y += ls.length * 4 + 1.5; });
  doc.setDrawColor(220, 229, 224); doc.line(14, 282, 196, 282);
  doc.setFontSize(8); doc.text(`${P.cfg.business_name} · ${P.cfg.address}${P.cfg.phone ? " · " + P.cfg.phone : ""}`, 14, 287); doc.text(`Prepared by ${S.me?.name || ""} · ${new Date().toLocaleString("en-NG")}`, 14, 291);
}
function quotePdf(j) {
  const doc = docBase("QUOTE", j.number, "Date: " + when(j.quoted_at || j.created_at)); let y = customerBlock(doc, j, 46); y = itemsTable(doc, j, y + 2);
  const dep = N(j.total) * N(j.deposit_pct) / 100; const until = new Date(Date.parse(j.quoted_at || j.created_at || Date.now()) + N(j.valid_days) * 864e5);
  footerBlock(doc, [`Deposit to start: ${money(dep).replace("₦", "N")} (${N(j.deposit_pct)}%). Balance: ${money(N(j.total) - dep).replace("₦", "N")} before delivery.`, `This quotation is valid until ${when(until.toISOString())} (${N(j.valid_days)} days).`, P.cfg.bank_name ? `Bank: ${P.cfg.bank_name} · ${P.cfg.account_name} · ${P.cfg.account_number}` : "", P.cfg.terms], y + 4);
  return doc;
}
function invoicePdf(j) {
  const doc = docBase("INVOICE", j.number, "Date: " + when(j.accepted_at || j.quoted_at || j.created_at)); let y = customerBlock(doc, j, 46); y = itemsTable(doc, j, y + 2);
  const paid = paidOf(j), bal = balanceOf(j);
  doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.setTextColor(102, 112, 133); doc.text("Paid to date", 150, y + 2, { align: "right" }); doc.setTextColor(16, 24, 40); doc.text(money(paid).replace("₦", "N"), 196, y + 2, { align: "right" });
  doc.setFont("helvetica", "bold"); doc.setTextColor(bal > 0 ? 192 : 16, bal > 0 ? 57 : 33, bal > 0 ? 43 : 29); doc.text("Balance due", 150, y + 8, { align: "right" }); doc.text(money(bal).replace("₦", "N"), 196, y + 8, { align: "right" });
  footerBlock(doc, [j.due_date ? `Delivery: ${when(j.due_date)}.` : "", P.cfg.bank_name ? `Pay to: ${P.cfg.bank_name} · ${P.cfg.account_name} · ${P.cfg.account_number}. Use ${j.number} as reference.` : "", P.cfg.terms], y + 16);
  return doc;
}
function receiptPdf(j, p) {
  const doc = docBase("RECEIPT", p.receipt_no, "Date: " + when(p.paid_at)); let y = customerBlock(doc, j, 46);
  doc.setFontSize(11); doc.setTextColor(16, 24, 40); doc.text(`Received with thanks the sum of`, 14, y + 2);
  doc.setFont("helvetica", "bold"); doc.setFontSize(24); doc.setTextColor(13, 122, 98); doc.text(money(p.amount).replace("₦", "N"), 14, y + 13);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(16, 24, 40);
  [`By ${METHOD[p.method] || p.method}${p.note ? " · " + p.note : ""}`, `For job ${j.number}${j.title ? ": " + j.title : ""}`, `Job total ${money(j.total).replace("₦", "N")} · paid to date ${money(paidOf(j)).replace("₦", "N")} · balance ${money(balanceOf(j)).replace("₦", "N")}`].forEach((l, i) => doc.text(l, 14, y + 22 + i * 6));
  doc.setDrawColor(228, 231, 236); doc.line(130, y + 52, 196, y + 52); doc.setFontSize(9); doc.setTextColor(102, 112, 133); doc.text(`Received by ${S.me?.name || p.received_by || ""}`, 130, y + 57);
  footerBlock(doc, [P.cfg.terms], y + 70);
  return doc;
}
function savePdf(doc, name) { const blob = doc.output("blob"); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); logAct("ok", `Downloaded ${name}`); }
async function emailDoc(j, kind, p) {
  const c = custOf(j); if (!c?.email) { toast("This customer has no email address. Add it on the Customers page.", "warn"); return; }
  const doc = kind === "quote" ? quotePdf(j) : kind === "invoice" ? invoicePdf(j) : receiptPdf(j, p);
  const base64 = doc.output("datauristring").split(",")[1]; const name = kind === "receipt" ? `${p.receipt_no}.pdf` : `${j.number}${kind === "invoice" ? "-invoice" : ""}.pdf`;
  const first = (c.name || "").split(" ")[0]; const biz = P.cfg.business_name;
  const subject = kind === "quote" ? `Quotation ${j.number} from ${biz}` : kind === "invoice" ? `Invoice ${j.number} from ${biz}` : `Receipt ${p.receipt_no} from ${biz}`;
  const text = kind === "quote" ? `Good day ${first},\n\nThank you for your enquiry. Please find attached our quotation ${j.number}${j.title ? " for " + j.title : ""}, total ${money(j.total)}. It is valid for ${N(j.valid_days)} days.\n\nReply to this email or call ${P.cfg.phone || "us"} to confirm, and we will start as soon as the deposit is received.\n\nKind regards,\n${S.me?.name || ""}\n${biz}`
    : kind === "invoice" ? `Good day ${first},\n\nPlease find attached invoice ${j.number}${j.title ? " for " + j.title : ""}. Total ${money(j.total)}, paid ${money(paidOf(j))}, balance ${money(balanceOf(j))}.${P.cfg.bank_name ? `\n\nPayment: ${P.cfg.bank_name}, ${P.cfg.account_name}, ${P.cfg.account_number}. Reference ${j.number}.` : ""}\n\nKind regards,\n${S.me?.name || ""}\n${biz}`
    : `Good day ${first},\n\nThank you for your payment of ${money(p.amount)} on job ${j.number}. Your receipt ${p.receipt_no} is attached.${balanceOf(j) > 0 ? ` The remaining balance is ${money(balanceOf(j))}.` : " This job is fully paid."}\n\nKind regards,\n${S.me?.name || ""}\n${biz}`;
  toast("Sending…");
  const out = await callFunction("send-doc", { company: S.company, to: c.email, subject, text, html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#101828;max-width:600px">${esc(text).replace(/\n/g, "<br>")}</div>`, attachment: { name, mime: "application/pdf", base64 }, kind, ref: j.number });
  if (out.status === "sent") { toast(`${kind[0].toUpperCase() + kind.slice(1)} emailed to ${c.email}`, "ok"); logAct("ok", `${name} emailed to ${c.email}`); if (kind === "quote") markSent(j); await FR.save("press_jobs", j.id, { history: hist(j, `${name} emailed to ${c.email}`) }, { obj: j }); load(["jobs"]); }
  else { toast("Email failed: " + (out.detail || out.error || "unknown"), "bad"); logAct("bad", `Email of ${name} failed`, out.detail || out.error || ""); }
}


/* ---------- registration ---------- */
const NEW_QUOTE = { label: "New quote", run: () => newQuote(), can: canWrite };
function search(q) {
  q = q.toLowerCase(); const out = [];
  for (const j of P.jobs) if ([j.number, j.title, custName(j)].join(" ").toLowerCase().includes(q)) out.push({ title: `${j.number} · ${summaryOf(j)}`, meta: `${j.stage === "quote" ? "Quote" : "Job"} · ${custName(j)} · ${STAGE_LABEL[j.stage]}`, go: () => goJob(j) });
  for (const c of P.customers) if ([c.name, c.phone, c.email].join(" ").toLowerCase().includes(q)) out.push({ title: c.name, meta: `Customer${c.phone ? " · " + c.phone : ""}`, go: () => FR.openRecord("press-customer", c.id) });
  for (const r of P.requests) if ([r.ref, r.title, r.contact_name].join(" ").toLowerCase().includes(q)) out.push({ title: `${r.ref} · ${r.title}`, meta: `Request · ${r.contact_name || r.contact_email} · ${REQ_STATUS[r.status]}`, go: () => { FR.setView("press-requests"); openRequest(r.id); } });
  for (const m of P.materials) if (m.name.toLowerCase().includes(q)) out.push({ title: m.name, meta: `Material · ${N(m.quantity)} ${m.unit} in stock`, go: () => { FR.setView("press-materials"); materialHistory(m); } });
  for (const p of P.payments) if ((p.receipt_no || "").toLowerCase().includes(q)) { const j = P.jobs.find(x => x.id === p.job_id); if (j) out.push({ title: p.receipt_no, meta: `Receipt · ${money(p.amount)} · ${j.number}`, go: () => FR.openRecord("press-job", j.id) }); }
  return out.slice(0, 8);
}
FR.registerModule({
  id: "press", name: "Press", icon: '<svg viewBox="0 0 24 24"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/></svg>',
  views: [
    { id: "press-overview", title: "Overview", sub: "What needs action today, and the work coming up", primary: NEW_QUOTE },
    { id: "press-quotes", title: "Quotes", sub: "Prices sent to customers, waiting for a yes", count: true, primary: NEW_QUOTE },
    { id: "press-jobs", title: "Jobs", sub: "Accepted work from job card to delivery", count: true, primary: NEW_QUOTE },
    { id: "press-production", title: "Production", sub: "Every job in progress, by stage", count: true },
    { id: "press-requests", title: "Requests", sub: "What customers sent from the public link", count: true },
    { id: "press-customers", title: "Customers", sub: "Who you print for, and what they owe", primary: { label: "Add customer", run: () => newCustomer(), can: canWrite } },
    { id: "press-materials", title: "Materials", sub: "Paper, ink and consumables in stock", count: true, primary: { label: "Add material", run: () => newMaterial(), can: canManage } },
    { id: "press-money", title: "Invoices & payments", nav: "Invoices & payments", sub: "Balances owed, payments received, receipts", count: true },
    { id: "press-reports", title: "Reports", sub: "Monthly figures, money owed by age, top customers", can: canManage },
    { id: "press-rates", title: "Settings", sub: "Rate card, letterhead and terms", can: canManage },
    { id: "press-quote", title: "Quote", hidden: true, parent: "press-quotes" },
    { id: "press-job", title: "Job", hidden: true, parent: "press-jobs" },
    { id: "press-customer", title: "Customer", hidden: true, parent: "press-customers", primary: { label: "New quote for this customer", run: () => { const c = P.customers.find(x => x.id === S.param); newQuote({ ...draftFrom(null), customer_id: c?.id || null, customer_name: c?.name || "" }); }, can: canWrite } },
  ],
  start() {
    if (P.started) return; P.started = true; load();
    [["press_customers", "customers"], ["press_rate_items", "rates"], ["press_jobs", "jobs"], ["press_payments", "payments"], ["press_materials", "materials"], ["press_material_moves", "moves"], ["press_files", "files"], ["customer_requests", "requests"], ["company_settings", "settings"]].forEach(([t, k]) => FR.subscribe(t, () => load([k], true)));
  },
  onCompany() { P.f = {}; P.sort = {}; P.draft = null; P.draftFor = null; P.dirty = false; if (FR.drawer.isOpen()) closeDrawer(); scope(); render(); FR.attentionChanged?.(); },
  attention: () => P.loaded ? attentionGroups() : [],
  ready: () => P.loaded,
  search, render, closeDrawer,
});
})();
