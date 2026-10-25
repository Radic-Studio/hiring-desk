/* Future Ready Group System — Press module (printing press).
   A job starts as a quote and moves through production to delivery. Tables: press_customers, press_rate_items, press_jobs,
   press_payments, press_materials, press_material_moves, press_files, company_settings(module='press'). Scoped to S.company. */
(() => {
const FR = window.FR, S = FR.S;
const { $, esc, toast, logAct, notice, setCount, when, callFunction } = FR;
const SB = () => FR.SB;
const me = () => (S.me?.email || "").toLowerCase();
const role = () => FR.roleIn(S.company);
const canWrite = () => ["admin", "manager", "staff"].includes(role());
const canManage = () => ["admin", "manager"].includes(role());
const isAdmin = () => role() === "admin";
const today = () => new Date().toISOString().slice(0, 10);
const N = n => Number(n || 0);
const money = n => "₦" + N(n).toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const STAGES = ["quote", "accepted", "design", "proof", "print", "finishing", "ready", "delivered", "cancelled"];
const STAGE_LABEL = { quote: "Quote", accepted: "Accepted", design: "Design", proof: "Proof", print: "Printing", finishing: "Finishing", ready: "Ready for pickup", delivered: "Delivered", cancelled: "Cancelled" };
const BOARD = ["quote", "accepted", "design", "proof", "print", "finishing", "ready"];
const METHOD = { cash: "Cash", transfer: "Bank transfer", pos: "POS", other: "Other" };
const FILE_KIND = { artwork: "Artwork", proof: "Proof", reference: "Reference", other: "Other" };
const P = { all: { customers: [], rates: [], jobs: [], payments: [], materials: [], moves: [], files: [], settings: {} }, customers: [], rates: [], jobs: [], payments: [], materials: [], moves: [], files: [], cfg: {}, open: null, tab: "quote", q: "", stage: "", started: false, draft: null };
const DEFAULT_CFG = () => ({ business_name: FR.companyName(S.company), address: "Udeorji Street, Obiagu, Enugu", phone: "", email: "", prefix: (FR.companyShort(S.company) || "FR").replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "FRP", deposit_pct: 50, valid_days: 14, bank_name: "", account_name: "", account_number: "", terms: "Prices are valid for the period stated. Work starts when the deposit is received; the balance is due before delivery.", vat_pct: 0 });

/* ---------- data ---------- */
function scope() {
  const cid = S.company; const by = k => P.all[k].filter(x => x.company_id === cid);
  P.customers = by("customers"); P.rates = by("rates").sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)); P.jobs = by("jobs"); P.payments = by("payments"); P.materials = by("materials").sort((a, b) => a.name.localeCompare(b.name)); P.moves = by("moves"); P.files = by("files");
  P.cfg = { ...DEFAULT_CFG(), ...(P.all.settings[cid] || {}) };
  if (P.open && P.open !== "new" && !P.jobs.find(j => j.id === P.open)) { P.open = null; closeDrawer(); }
}
async function load(what = ["customers", "rates", "jobs", "payments", "materials", "moves", "files", "settings"]) {
  const T = { customers: "press_customers", rates: "press_rate_items", jobs: "press_jobs", payments: "press_payments", materials: "press_materials", moves: "press_material_moves", files: "press_files" };
  await Promise.all(what.map(async k => {
    if (k === "settings") { const { data } = await SB().from("company_settings").select("company_id,data").eq("module", "press"); P.all.settings = {}; for (const r of data || []) P.all.settings[r.company_id] = r.data || {}; return; }
    const { data, error } = await SB().from(T[k]).select("*").limit(5000); if (error) { notice("bad", `Could not load ${k}: ${error.message}`); return; } P.all[k] = data || [];
  }));
  scope(); render(); if (P.open && $("#drawer").classList.contains("open")) paintDrawer();
}
const paidOf = j => P.payments.filter(p => p.job_id === j.id).reduce((s, p) => s + N(p.amount), 0);
const balanceOf = j => Math.max(0, N(j.total) - paidOf(j));
const overdue = j => j.due_date && j.due_date < today() && !["delivered", "cancelled", "quote"].includes(j.stage);
const custName = j => j.customer_name || (P.customers.find(c => c.id === j.customer_id) || {}).name || "—";
const custOf = j => P.customers.find(c => c.id === j.customer_id);
async function nextNumber(kind) { const { data, error } = await SB().rpc("next_number", { p_company: S.company, p_kind: kind }); if (error) throw new Error(error.message); return `${P.cfg.prefix}-${kind}-${String(data).padStart(4, "0")}`; }
const calcTotals = (items, discount, vat) => { const subtotal = items.reduce((s, i) => s + N(i.total), 0); const afterDisc = Math.max(0, subtotal - N(discount)); const vatAmt = Math.round(afterDisc * N(vat) / 100 * 100) / 100; return { subtotal, vat: vatAmt, total: afterDisc + vatAmt }; };

/* ---------- views ---------- */
function render() {
  if (!S.me) return;
  setCount("press-jobs", P.jobs.filter(j => !["delivered", "cancelled"].includes(j.stage)).length);
  const low = P.materials.filter(m => N(m.quantity) <= N(m.reorder_level)).length; const c = $("#cnt-press-materials"); if (c) { c.textContent = low; c.hidden = !low; }
  const owed = P.jobs.filter(j => j.stage !== "quote" && j.stage !== "cancelled" && balanceOf(j) > 0).length; const m = $("#cnt-press-money"); if (m) { m.textContent = owed; m.hidden = !owed; }
  if (S.module !== "press") return;
  ({ "press-jobs": renderJobs, "press-customers": renderCustomers, "press-materials": renderMaterials, "press-money": renderMoney, "press-rates": renderRates })[S.view]?.();
}
function jobCard(j) {
  const bal = balanceOf(j);
  return `<div class="jcard ${overdue(j) ? "late" : ""}" data-open="${j.id}"><div class="jtop"><b>${esc(j.number)}</b>${j.due_date ? `<span class="hint" style="margin:0">${overdue(j) ? "overdue " : "due "}${when(j.due_date)}</span>` : ""}</div>
    <div class="jname">${esc(j.title || "(untitled)")}</div><div class="hint" style="margin:0">${esc(custName(j))}</div>
    <div class="jmoney"><span>${money(j.total)}</span>${j.stage !== "quote" ? `<span class="pill ${bal > 0 ? "warn" : "ok"} flat">${bal > 0 ? "owes " + money(bal) : "paid"}</span>` : `<span class="pill accent flat">${j.sent_at ? "sent" : "draft"}</span>`}</div></div>`;
}
function renderJobs() {
  const el = $("#v-press-jobs"); const q = P.q.toLowerCase();
  let list = P.jobs.filter(j => !q || [j.number, j.title, custName(j), j.description].join(" ").toLowerCase().includes(q));
  const closed = list.filter(j => ["delivered", "cancelled"].includes(j.stage)).sort((a, b) => (b.delivered_at || b.updated_at || "").localeCompare(a.delivered_at || a.updated_at || ""));
  const open = list.filter(j => BOARD.includes(j.stage));
  const active = P.jobs.filter(j => !["quote", "delivered", "cancelled"].includes(j.stage));
  el.innerHTML = `
    <div class="tiles">
      <div class="tile" data-stage="quote"><span class="label">Open quotes</span><span class="value">${P.jobs.filter(j => j.stage === "quote").length}</span><span class="sub">${money(P.jobs.filter(j => j.stage === "quote").reduce((s, j) => s + N(j.total), 0))} quoted</span></div>
      <div class="tile" data-stage="active"><span class="label">In production</span><span class="value">${active.length}</span><span class="sub">${active.filter(overdue).length} overdue</span></div>
      <div class="tile" data-stage="ready"><span class="label">Ready for pickup</span><span class="value">${P.jobs.filter(j => j.stage === "ready").length}</span><span class="sub">waiting for the customer</span></div>
      <div class="tile" data-stage="owing"><span class="label">Balance owed</span><span class="value" style="font-size:22px">${money(P.jobs.filter(j => j.stage !== "quote" && j.stage !== "cancelled").reduce((s, j) => s + balanceOf(j), 0))}</span><span class="sub">across ${P.jobs.filter(j => j.stage !== "quote" && j.stage !== "cancelled" && balanceOf(j) > 0).length} jobs</span></div>
    </div>
    <div class="toolbar"><input type="search" id="pj-q" placeholder="Search number, title, customer…" value="${esc(P.q)}">${canWrite() ? `<button class="btn primary" id="pj-new" style="margin-left:auto">+ New quote</button>` : ""}</div>
    ${P.rates.every(r => N(r.price) === 0) && canManage() ? `<div class="banner warn">The rate card has no prices yet. Set them on the Rate card page so quotes fill themselves in.</div>` : ""}
    <div class="board">${BOARD.map(st => { const col = open.filter(j => j.stage === st); return `<div class="bcol"><div class="bhead"><span>${STAGE_LABEL[st]}</span><span class="cnt">${col.length}</span></div>${col.sort((a, b) => (a.due_date || "9").localeCompare(b.due_date || "9")).map(jobCard).join("") || `<div class="bempty">—</div>`}</div>`; }).join("")}</div>
    ${closed.length ? `<div class="card"><h2>Delivered and cancelled <small>${closed.length}</small></h2><div class="table-wrap"><table><thead><tr><th>Number</th><th>Customer</th><th>Job</th><th>Stage</th><th>Total</th><th>Paid</th><th>When</th><th></th></tr></thead><tbody>${closed.slice(0, 100).map(j => `<tr data-open="${j.id}" style="cursor:pointer"><td>${esc(j.number)}</td><td>${esc(custName(j))}</td><td>${esc(j.title)}</td><td>${STAGE_LABEL[j.stage]}</td><td>${money(j.total)}</td><td>${money(paidOf(j))}</td><td>${when(j.delivered_at || j.updated_at)}</td><td><button class="btn small">Open</button></td></tr>`).join("")}</tbody></table></div></div>` : ""}`;
  $("#pj-q").oninput = e => { P.q = e.target.value; renderJobs(); setTimeout(() => $("#pj-q")?.focus(), 0); };
  $("#pj-new")?.addEventListener("click", () => openDrawer("new"));
  el.querySelectorAll("[data-open]").forEach(c => c.onclick = () => openDrawer(c.dataset.open));
  el.querySelectorAll(".tile[data-stage]").forEach(t => t.onclick = () => { P.q = ""; renderJobs(); });
}
function renderCustomers() {
  const el = $("#v-press-customers"); const q = P.q.toLowerCase();
  const list = P.customers.filter(c => !q || [c.name, c.phone, c.email].join(" ").toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  el.innerHTML = `<div class="toolbar"><input type="search" id="pc-q" placeholder="Search customers…" value="${esc(P.q)}">${canWrite() ? `<button class="btn primary" id="pc-new" style="margin-left:auto">+ Add customer</button>` : ""}</div>
    ${list.length ? `<div class="table-wrap"><table><thead><tr><th>Customer</th><th>Phone</th><th>Email</th><th>Jobs</th><th>Owes</th><th></th></tr></thead><tbody>${list.map(c => { const js = P.jobs.filter(j => j.customer_id === c.id); const owed = js.filter(j => j.stage !== "quote" && j.stage !== "cancelled").reduce((s, j) => s + balanceOf(j), 0); return `<tr><td class="name">${esc(c.name)}${c.address ? `<span class="sub">${esc(c.address)}</span>` : ""}</td><td>${esc(c.phone || "—")}</td><td>${esc(c.email || "—")}</td><td>${js.length}</td><td>${owed > 0 ? `<span class="pill warn flat">${money(owed)}</span>` : "—"}</td><td><button class="btn small" data-cust="${c.id}">Open</button></td></tr>`; }).join("")}</tbody></table></div>` : `<div class="empty"><h2>No customers yet</h2><p>Customers are created from a quote, or with the button above.</p></div>`}`;
  $("#pc-q").oninput = e => { P.q = e.target.value; renderCustomers(); setTimeout(() => $("#pc-q")?.focus(), 0); };
  $("#pc-new")?.addEventListener("click", () => openCustomer("new"));
  el.querySelectorAll("[data-cust]").forEach(b => b.onclick = () => openCustomer(b.dataset.cust));
}
function renderMaterials() {
  const el = $("#v-press-materials"); const low = P.materials.filter(m => N(m.quantity) <= N(m.reorder_level));
  el.innerHTML = `<div class="tiles"><div class="tile" style="cursor:default"><span class="label">Materials tracked</span><span class="value">${P.materials.length}</span></div><div class="tile ${low.length ? "accent" : ""}" style="cursor:default"><span class="label">Low stock</span><span class="value">${low.length}</span><span class="sub">at or below reorder level</span></div><div class="tile" style="cursor:default"><span class="label">Stock value</span><span class="value" style="font-size:22px">${money(P.materials.reduce((s, m) => s + N(m.quantity) * N(m.unit_cost), 0))}</span><span class="sub">quantity × unit cost</span></div></div>
    <div class="toolbar">${canManage() ? `<button class="btn primary" id="pm-new">+ Add material</button>` : ""}<span class="hint">Record what comes in and what each job uses; the quantity updates itself.</span></div>
    ${P.materials.length ? `<div class="table-wrap"><table><thead><tr><th>Material</th><th>In stock</th><th>Reorder at</th><th>Unit cost</th><th>Last change</th><th></th></tr></thead><tbody>${P.materials.map(m => `<tr class="${N(m.quantity) <= N(m.reorder_level) ? "low" : ""}"><td class="name">${esc(m.name)}${m.notes ? `<span class="sub">${esc(m.notes)}</span>` : ""}</td><td>${N(m.quantity)} ${esc(m.unit)} ${N(m.quantity) <= N(m.reorder_level) ? '<span class="pill bad flat">low</span>' : ""}</td><td>${N(m.reorder_level)} ${esc(m.unit)}</td><td>${money(m.unit_cost)}</td><td>${when(m.updated_at)}</td><td>${canWrite() ? `<button class="btn small" data-move="${m.id}">Stock in / out</button>` : ""} ${canManage() ? `<button class="btn small" data-edit="${m.id}">Edit</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty"><h2>No materials yet</h2><p>Add paper, ink and consumables with their reorder level.</p></div>`}
    ${P.moves.length ? `<div class="card"><h2>Recent stock movements</h2><ul class="history">${P.moves.slice().sort((a, b) => b.moved_at.localeCompare(a.moved_at)).slice(0, 30).map(mv => { const m = P.materials.find(x => x.id === mv.material_id) || {}; const j = P.jobs.find(x => x.id === mv.job_id); return `<li><time>${FR.fmtDate(mv.moved_at)}</time><span>${N(mv.delta) > 0 ? "+" : ""}${N(mv.delta)} ${esc(m.unit || "")} ${esc(m.name || "")}${j ? " for " + esc(j.number) : ""}${mv.note ? " · " + esc(mv.note) : ""} <span class="muted" data-by="${esc(mv.moved_by || "")}"></span></span></li>`; }).join("")}</ul></div>` : ""}`;
  $("#pm-new")?.addEventListener("click", () => editMaterial(null));
  el.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => editMaterial(P.materials.find(m => m.id === b.dataset.edit)));
  el.querySelectorAll("[data-move]").forEach(b => b.onclick = () => moveStock(P.materials.find(m => m.id === b.dataset.move)));
  FR.resolveNames();
}
function renderMoney() {
  const el = $("#v-press-money"); const month = today().slice(0, 7);
  const billable = P.jobs.filter(j => j.stage !== "quote" && j.stage !== "cancelled");
  const owing = billable.filter(j => balanceOf(j) > 0).sort((a, b) => balanceOf(b) - balanceOf(a));
  const recvMonth = P.payments.filter(p => (p.paid_at || "").startsWith(month)).reduce((s, p) => s + N(p.amount), 0);
  const deliveredMonth = P.jobs.filter(j => j.stage === "delivered" && (j.delivered_at || "").startsWith(month));
  const recent = P.payments.slice().sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")).slice(0, 25);
  el.innerHTML = `<div class="tiles">
      <div class="tile" style="cursor:default"><span class="label">Outstanding</span><span class="value" style="font-size:22px">${money(owing.reduce((s, j) => s + balanceOf(j), 0))}</span><span class="sub">${owing.length} job${owing.length === 1 ? "" : "s"} with a balance</span></div>
      <div class="tile" style="cursor:default"><span class="label">Received this month</span><span class="value" style="font-size:22px">${money(recvMonth)}</span><span class="sub">${P.payments.filter(p => (p.paid_at || "").startsWith(month)).length} receipts</span></div>
      <div class="tile" style="cursor:default"><span class="label">Delivered this month</span><span class="value">${deliveredMonth.length}</span><span class="sub">${money(deliveredMonth.reduce((s, j) => s + N(j.total), 0))} billed</span></div>
      <div class="tile" style="cursor:default"><span class="label">Quotes this month</span><span class="value">${P.jobs.filter(j => (j.created_at || "").startsWith(month)).length}</span><span class="sub">${P.jobs.filter(j => (j.accepted_at || "").startsWith(month)).length} accepted</span></div>
    </div>
    <div class="team-grid">
      <div class="card"><h2>Who owes what</h2>${owing.length ? `<div class="table-wrap"><table style="min-width:0"><thead><tr><th>Job</th><th>Customer</th><th>Total</th><th>Paid</th><th>Balance</th><th></th></tr></thead><tbody>${owing.map(j => `<tr><td>${esc(j.number)}<span class="sub">${esc(j.title)}</span></td><td>${esc(custName(j))}</td><td>${money(j.total)}</td><td>${money(paidOf(j))}</td><td><b>${money(balanceOf(j))}</b></td><td><button class="btn small" data-open="${j.id}">Open</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">Nothing outstanding.</p>`}</div>
      <div class="card"><h2>Recent receipts</h2>${recent.length ? `<ul class="history">${recent.map(p => { const j = P.jobs.find(x => x.id === p.job_id) || {}; return `<li><time>${when(p.paid_at)}</time><span><b>${money(p.amount)}</b> ${METHOD[p.method] || p.method} · ${esc(p.receipt_no)} · ${esc(j.number || "")} ${esc(custName(j))} <button class="btn small" data-receipt="${p.id}">PDF</button></span></li>`; }).join("")}</ul>` : `<p class="muted">No payments recorded yet.</p>`}</div>
    </div>`;
  el.querySelectorAll("[data-open]").forEach(b => b.onclick = () => openDrawer(b.dataset.open));
  el.querySelectorAll("[data-receipt]").forEach(b => b.onclick = () => { const p = P.payments.find(x => x.id === b.dataset.receipt); const j = P.jobs.find(x => x.id === p.job_id); if (j) savePdf(receiptPdf(j, p), `${p.receipt_no}.pdf`); });
}
function renderRates() {
  const el = $("#v-press-rates"); const cfg = P.cfg; const ro = !canManage();
  const cats = [...new Set(P.rates.map(r => r.category))];
  el.innerHTML = `<div class="team-grid">
    <div class="card"><h2>Rate card <small>what a quote line costs</small></h2>
      ${ro ? "" : `<div class="fields" style="margin-bottom:10px"><div class="field"><label>Category</label><input id="rc-cat" list="rc-cats" placeholder="e.g. Banners"><datalist id="rc-cats">${cats.map(c => `<option value="${esc(c)}">`).join("")}</datalist></div><div class="field"><label>Item</label><input id="rc-name" placeholder="e.g. Flex banner"></div><div class="field"><label>Unit</label><input id="rc-unit" placeholder="piece, sq ft, pack…" value="piece"></div><div class="field"><label>Price (₦)</label><input id="rc-price" type="number" min="0" step="0.01"></div></div><div class="toolbar" style="justify-content:flex-end;margin-bottom:12px"><button class="btn primary small" id="rc-add">Add item</button></div>`}
      <div class="table-wrap"><table style="min-width:0"><thead><tr><th>Category</th><th>Item</th><th>Unit</th><th>Price</th><th></th></tr></thead><tbody>${P.rates.map(r => `<tr class="${r.active ? "" : "off"}"><td>${esc(r.category)}</td><td>${esc(r.name)}${r.notes ? `<span class="sub">${esc(r.notes)}</span>` : ""}</td><td>${esc(r.unit)}</td><td>${ro ? money(r.price) : `<input type="number" data-price="${r.id}" value="${N(r.price)}" min="0" step="0.01" style="width:110px">`}</td><td>${ro ? (r.active ? "" : "off") : `<button class="btn small" data-toggle="${r.id}">${r.active ? "Hide" : "Show"}</button> <button class="btn small danger" data-del="${r.id}">Delete</button>`}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">No items yet.</td></tr>`}</tbody></table></div></div>
    <div class="card"><h2>Letterhead and terms <small>printed on quotes, invoices and receipts</small></h2>
      <div class="fields">
        <div class="field wide"><label>Business name</label><input id="cf-name" value="${esc(cfg.business_name)}" ${isAdmin() ? "" : "disabled"}></div>
        <div class="field wide"><label>Address</label><input id="cf-addr" value="${esc(cfg.address)}" ${isAdmin() ? "" : "disabled"}></div>
        <div class="field"><label>Phone</label><input id="cf-phone" value="${esc(cfg.phone)}" ${isAdmin() ? "" : "disabled"}></div>
        <div class="field"><label>Email</label><input id="cf-email" value="${esc(cfg.email)}" ${isAdmin() ? "" : "disabled"}></div>
        <div class="field"><label>Number prefix</label><input id="cf-prefix" value="${esc(cfg.prefix)}" maxlength="6" ${isAdmin() ? "" : "disabled"}></div>
        <div class="field"><label>Default deposit %</label><input id="cf-dep" type="number" min="0" max="100" value="${N(cfg.deposit_pct)}" ${isAdmin() ? "" : "disabled"}></div>
        <div class="field"><label>Quote valid (days)</label><input id="cf-valid" type="number" min="1" value="${N(cfg.valid_days)}" ${isAdmin() ? "" : "disabled"}></div>
        <div class="field"><label>VAT %</label><input id="cf-vat" type="number" min="0" max="100" step="0.5" value="${N(cfg.vat_pct)}" ${isAdmin() ? "" : "disabled"}></div>
        <div class="field"><label>Bank</label><input id="cf-bank" value="${esc(cfg.bank_name)}" ${isAdmin() ? "" : "disabled"}></div>
        <div class="field"><label>Account name</label><input id="cf-acct" value="${esc(cfg.account_name)}" ${isAdmin() ? "" : "disabled"}></div>
        <div class="field wide"><label>Account number</label><input id="cf-acno" value="${esc(cfg.account_number)}" ${isAdmin() ? "" : "disabled"}></div>
        <div class="field wide"><label>Terms</label><textarea id="cf-terms" ${isAdmin() ? "" : "disabled"}>${esc(cfg.terms)}</textarea></div>
      </div>
      ${isAdmin() ? `<div class="toolbar" style="justify-content:flex-end;margin-top:10px"><button class="btn primary" id="cf-save">Save</button></div>` : `<p class="hint">Only a company Admin can change these.</p>`}</div></div>`;
  $("#rc-add")?.addEventListener("click", async () => {
    const name = $("#rc-name").value.trim(); if (!name) { toast("Enter the item name", "warn"); return; }
    const { error } = await SB().from("press_rate_items").insert({ company_id: S.company, category: $("#rc-cat").value.trim() || "General", name, unit: $("#rc-unit").value.trim() || "piece", price: N($("#rc-price").value), order: 100 + P.rates.length, updated_by: me() });
    if (error) { toast(error.message, "bad"); return; } toast("Item added", "ok"); load(["rates"]);
  });
  el.querySelectorAll("[data-price]").forEach(i => i.onchange = async () => { const { error } = await SB().from("press_rate_items").update({ price: N(i.value), updated_at: new Date().toISOString(), updated_by: me() }).eq("id", i.dataset.price); if (error) toast(error.message, "bad"); else toast("Price saved", "ok"); });
  el.querySelectorAll("[data-toggle]").forEach(b => b.onclick = async () => { const r = P.rates.find(x => x.id === b.dataset.toggle); await SB().from("press_rate_items").update({ active: !r.active }).eq("id", r.id); load(["rates"]); });
  el.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => { if (!confirm("Delete this rate card item?")) return; const { error } = await SB().from("press_rate_items").delete().eq("id", b.dataset.del); if (error) toast(error.message, "bad"); else load(["rates"]); });
  $("#cf-save")?.addEventListener("click", async () => {
    const data = { business_name: $("#cf-name").value.trim(), address: $("#cf-addr").value.trim(), phone: $("#cf-phone").value.trim(), email: $("#cf-email").value.trim(), prefix: ($("#cf-prefix").value.trim().toUpperCase() || "FRP").replace(/[^A-Z0-9]/g, ""), deposit_pct: N($("#cf-dep").value), valid_days: N($("#cf-valid").value) || 14, vat_pct: N($("#cf-vat").value), bank_name: $("#cf-bank").value.trim(), account_name: $("#cf-acct").value.trim(), account_number: $("#cf-acno").value.trim(), terms: $("#cf-terms").value.trim() };
    const { error } = await SB().from("company_settings").upsert({ company_id: S.company, module: "press", data, updated_by: me(), updated_at: new Date().toISOString() }, { onConflict: "company_id,module" });
    if (error) { toast(error.message, "bad"); return; } toast("Letterhead saved", "ok"); load(["settings"]);
  });
}

/* ---------- job drawer ---------- */
function showDrawer() { $("#drawer").classList.add("open"); $("#drawer").setAttribute("aria-hidden", "false"); $("#scrim").hidden = false; requestAnimationFrame(() => $("#scrim").classList.add("open")); $("#scrim").onclick = closeDrawer; }
function closeDrawer() { P.open = null; P.draft = null; $("#drawer").classList.remove("open"); $("#drawer").setAttribute("aria-hidden", "true"); $("#scrim").classList.remove("open"); setTimeout(() => { $("#scrim").hidden = true; }, 200); }
function openDrawer(id) { P.open = id; P.tab = "quote"; P.draft = null; paintDrawer(); showDrawer(); }
function jobOf() { return P.open === "new" ? null : P.jobs.find(j => j.id === P.open); }
function paintDrawer() {
  const isNew = P.open === "new"; const j = isNew ? null : jobOf(); if (!isNew && !j) return;
  const ro = !canWrite();
  if (!P.draft) P.draft = isNew ? { title: "", description: "", customer_id: null, customer_name: "", items: [], discount: 0, deposit_pct: N(P.cfg.deposit_pct), valid_days: N(P.cfg.valid_days), due_date: "", specs: {}, notes: "" } : { title: j.title, description: j.description, customer_id: j.customer_id, customer_name: custName(j), items: (j.items || []).map(x => ({ ...x })), discount: N(j.discount), deposit_pct: N(j.deposit_pct), valid_days: N(j.valid_days), due_date: j.due_date || "", specs: { ...(j.specs || {}) }, notes: j.notes || "" };
  const tab = (id, label) => `<button aria-pressed="${P.tab === id}" data-tab="${id}">${label}</button>`;
  const stagePill = j ? `<span class="pill ${j.stage === "delivered" ? "ok" : j.stage === "cancelled" ? "bad" : j.stage === "quote" ? "accent" : "info"} flat">${STAGE_LABEL[j.stage]}</span>` : "";
  $("#drawer").innerHTML = `<header><div><h2>${isNew ? "New quote" : esc(j.number)}${j && overdue(j) ? ' <span class="pill bad flat">overdue</span>' : ""}</h2><div class="muted" style="margin-top:4px">${isNew ? esc(FR.companyName(S.company)) : `${esc(j.title || "(untitled)")} · ${esc(custName(j))} ${stagePill}`}</div></div><button class="x" id="close" aria-label="Close">×</button></header>
    <div class="body">${ro ? `<div class="banner warn">View only. Staff, Managers and Admins of ${esc(FR.companyShort(S.company))} can edit jobs.</div>` : ""}
      ${isNew ? "" : `<div class="seg" style="margin-bottom:14px">${tab("quote", "Quote")}${tab("job", "Job")}${tab("pay", `Payments (${P.payments.filter(p => p.job_id === j.id).length})`)}${tab("files", `Files (${P.files.filter(f => f.job_id === j.id).length})`)}${tab("history", "History")}</div>`}
      <div id="pj-body"></div></div><footer id="pj-foot"></footer>`;
  $("#close").onclick = closeDrawer;
  $("#drawer").querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { P.tab = b.dataset.tab; paintDrawer(); });
  ({ quote: paintQuote, job: paintJob, pay: paintPay, files: paintFiles, history: paintHistory })[P.tab](j, isNew, ro);
}
function paintQuote(j, isNew, ro) {
  const d = P.draft; const t = calcTotals(d.items, d.discount, P.cfg.vat_pct); const dis = ro ? "disabled" : "";
  const locked = ro || (j && !["quote", "accepted"].includes(j.stage) && !canManage());
  $("#pj-body").innerHTML = `
    <div class="fields">
      <div class="field wide"><label>Customer</label><input id="q-cust" list="q-custs" value="${esc(d.customer_name)}" placeholder="Type a name; new names are saved as new customers" ${dis}><datalist id="q-custs">${P.customers.map(c => `<option value="${esc(c.name)}">${esc(c.phone)}</option>`).join("")}</datalist></div>
      <div class="field wide"><label>Job title</label><input id="q-title" value="${esc(d.title)}" placeholder="e.g. 500 A5 flyers for church harvest" ${dis}></div>
      <div class="field"><label>Size</label><input id="q-size" value="${esc(d.specs.size || "")}" placeholder="A5, 3×6 ft…" ${dis}></div>
      <div class="field"><label>Paper / material</label><input id="q-paper" value="${esc(d.specs.paper || "")}" placeholder="150gsm gloss, flex…" ${dis}></div>
      <div class="field"><label>Colours</label><input id="q-colours" value="${esc(d.specs.colours || "")}" placeholder="full colour, 1 side" ${dis}></div>
      <div class="field"><label>Finishing</label><input id="q-finish" value="${esc(d.specs.finishing || "")}" placeholder="lamination, folding…" ${dis}></div>
      <div class="field wide"><label>Description / notes for the customer</label><textarea id="q-desc" ${dis}>${esc(d.description)}</textarea></div>
    </div>
    <h3 style="margin:14px 0 6px">Items</h3>
    ${ro ? "" : `<div class="toolbar" style="margin-bottom:8px"><select id="q-rate"><option value="">Add from rate card…</option>${[...new Set(P.rates.filter(r => r.active).map(r => r.category))].map(cat => `<optgroup label="${esc(cat)}">${P.rates.filter(r => r.active && r.category === cat).map(r => `<option value="${r.id}">${esc(r.name)} — ${money(r.price)}/${esc(r.unit)}</option>`).join("")}</optgroup>`).join("")}</select><button class="btn small" id="q-addline">+ Blank line</button></div>`}
    <div class="table-wrap"><table class="items" style="min-width:0"><thead><tr><th>Description</th><th style="width:70px">Qty</th><th style="width:70px">Unit</th><th style="width:110px">Unit price</th><th style="width:110px">Total</th>${ro ? "" : "<th></th>"}</tr></thead><tbody>
      ${d.items.map((it, i) => `<tr><td><input data-f="description" data-i="${i}" value="${esc(it.description)}" ${dis}></td><td><input type="number" data-f="qty" data-i="${i}" value="${N(it.qty)}" min="0" step="any" ${dis}></td><td><input data-f="unit" data-i="${i}" value="${esc(it.unit || "")}" ${dis}></td><td><input type="number" data-f="unit_price" data-i="${i}" value="${N(it.unit_price)}" min="0" step="0.01" ${dis}></td><td class="num">${money(it.total)}</td>${ro ? "" : `<td><button class="btn small danger" data-rm="${i}">×</button></td>`}</tr>`).join("") || `<tr><td colspan="6" class="muted">No items yet.</td></tr>`}
    </tbody></table></div>
    <div class="fields" style="margin-top:12px">
      <div class="field"><label>Discount (₦)</label><input type="number" id="q-disc" value="${N(d.discount)}" min="0" step="0.01" ${dis}></div>
      <div class="field"><label>Deposit required %</label><input type="number" id="q-dep" value="${N(d.deposit_pct)}" min="0" max="100" ${dis}></div>
      <div class="field"><label>Valid for (days)</label><input type="number" id="q-valid" value="${N(d.valid_days)}" min="1" ${dis}></div>
      <div class="field"><label>Delivery / due date</label><input type="date" id="q-due" value="${esc(d.due_date)}" ${dis}></div>
    </div>
    <dl class="kv" style="margin-top:12px"><dt>Subtotal</dt><dd>${money(t.subtotal)}</dd><dt>Discount</dt><dd>− ${money(d.discount)}</dd>${N(P.cfg.vat_pct) ? `<dt>VAT ${N(P.cfg.vat_pct)}%</dt><dd>${money(t.vat)}</dd>` : ""}<dt><b>Total</b></dt><dd><b>${money(t.total)}</b></dd><dt>Deposit</dt><dd>${money(t.total * N(d.deposit_pct) / 100)} (${N(d.deposit_pct)}%)</dd></dl>
    <p class="hint" id="q-err" style="color:var(--bad)"></p>`;
  $("#pj-foot").innerHTML = ro ? `<button class="btn" id="q-close">Close</button>` : `${isNew ? "" : `<button class="btn" id="q-pdf" title="Download the quote as PDF">Quote PDF</button><button class="btn" id="q-mail" title="Email the quote with the PDF attached">Email</button><button class="btn" id="q-wa" title="Open WhatsApp with the quote summary">WhatsApp</button>`}<span style="flex:1"></span><button class="btn" id="q-close">Close</button><button class="btn primary" id="q-save">${isNew ? "Create quote" : "Save"}</button>`;
  const read = () => {
    d.customer_name = $("#q-cust").value.trim(); d.title = $("#q-title").value.trim(); d.description = $("#q-desc").value.trim();
    d.specs = { size: $("#q-size").value.trim(), paper: $("#q-paper").value.trim(), colours: $("#q-colours").value.trim(), finishing: $("#q-finish").value.trim() };
    d.discount = N($("#q-disc").value); d.deposit_pct = N($("#q-dep").value); d.valid_days = N($("#q-valid").value) || 14; d.due_date = $("#q-due").value;
    $("#pj-body").querySelectorAll("[data-f]").forEach(inp => { const it = d.items[+inp.dataset.i]; if (!it) return; it[inp.dataset.f] = inp.type === "number" ? N(inp.value) : inp.value; });
    d.items.forEach(it => { it.total = Math.round(N(it.qty) * N(it.unit_price) * 100) / 100; });
  };
  const repaint = () => { read(); paintQuote(j, isNew, ro); };
  $("#q-close").onclick = closeDrawer;
  $("#q-rate")?.addEventListener("change", e => { const r = P.rates.find(x => x.id === e.target.value); if (!r) return; read(); d.items.push({ rate_item_id: r.id, description: r.name, qty: 1, unit: r.unit, unit_price: N(r.price), total: N(r.price) }); paintQuote(j, isNew, ro); });
  $("#q-addline")?.addEventListener("click", () => { read(); d.items.push({ description: "", qty: 1, unit: "piece", unit_price: 0, total: 0 }); paintQuote(j, isNew, ro); });
  $("#pj-body").querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { read(); d.items.splice(+b.dataset.rm, 1); paintQuote(j, isNew, ro); });
  $("#pj-body").querySelectorAll('[data-f="qty"],[data-f="unit_price"],#q-disc,#q-dep').forEach(i => i.onchange = repaint);
  $("#q-save")?.addEventListener("click", async () => {
    read(); $("#q-err").textContent = "";
    if (!d.customer_name) { $("#q-err").textContent = "Enter the customer's name."; return; }
    if (!d.items.length) { $("#q-err").textContent = "Add at least one item."; return; }
    $("#q-save").disabled = true;
    try {
      let cust = P.customers.find(c => c.name.toLowerCase() === d.customer_name.toLowerCase());
      if (!cust) { const { data, error } = await SB().from("press_customers").insert({ company_id: S.company, name: d.customer_name }).select("*").maybeSingle(); if (error) throw error; cust = data; P.all.customers.push(cust); P.customers.push(cust); toast(`New customer: ${cust.name}`); }
      const tt = calcTotals(d.items, d.discount, P.cfg.vat_pct);
      const body = { company_id: S.company, customer_id: cust.id, customer_name: cust.name, title: d.title, description: d.description, items: d.items, subtotal: tt.subtotal, discount: d.discount, total: tt.total, deposit_pct: d.deposit_pct, valid_days: d.valid_days, due_date: d.due_date || null, specs: d.specs, notes: d.notes };
      if (isNew) {
        body.number = await nextNumber("Q"); body.stage = "quote"; body.quoted_at = new Date().toISOString(); body.history = [{ ts: body.quoted_at, by: me(), summary: "Quote created" }];
        const { data, error } = await SB().from("press_jobs").insert(body).select("id").maybeSingle(); if (error) throw error;
        toast(`${body.number} created`, "ok"); logAct("ok", `Quote ${body.number} for ${cust.name}: ${money(tt.total)}`); P.open = data.id;
      } else {
        body.history = [...(j.history || []), { ts: new Date().toISOString(), by: me(), summary: `Quote edited · total ${money(tt.total)}` }].slice(-100);
        const { error } = await SB().from("press_jobs").update(body).eq("id", j.id); if (error) throw error; toast("Saved", "ok");
      }
      P.draft = null; await load(["jobs", "customers"]); paintDrawer();
    } catch (e) { $("#q-err").textContent = e.message || String(e); $("#q-save").disabled = false; }
  });
  $("#q-pdf")?.addEventListener("click", () => savePdf(quotePdf(j), `${j.number}.pdf`));
  $("#q-mail")?.addEventListener("click", () => emailDoc(j, "quote"));
  $("#q-wa")?.addEventListener("click", () => { const c = custOf(j); const txt = `Good day ${c?.name || ""}, here is your quote ${j.number} from ${P.cfg.business_name}:\n${(j.items || []).map(i => `• ${i.description} × ${N(i.qty)} = ${money(i.total)}`).join("\n")}\nTotal: ${money(j.total)}${N(j.deposit_pct) ? ` (deposit ${N(j.deposit_pct)}% = ${money(N(j.total) * N(j.deposit_pct) / 100)})` : ""}\nValid for ${N(j.valid_days)} days. Reply to confirm and we start.`; savePdf(quotePdf(j), `${j.number}.pdf`); window.open(`https://wa.me/${waNum(c?.phone)}?text=${encodeURIComponent(txt)}`, "_blank", "noopener"); toast("Quote PDF downloaded: attach it in WhatsApp if you like"); markSent(j); });
}
const waNum = p => { const d = String(p || "").replace(/\D/g, ""); return d.startsWith("0") ? "234" + d.slice(1) : d; };
async function markSent(j) { if (j.sent_at) return; await SB().from("press_jobs").update({ sent_at: new Date().toISOString(), history: [...(j.history || []), { ts: new Date().toISOString(), by: me(), summary: "Quote sent to customer" }] }).eq("id", j.id); load(["jobs"]); }
function paintJob(j, isNew, ro) {
  const idx = STAGES.indexOf(j.stage); const next = BOARD[BOARD.indexOf(j.stage) + 1];
  const staff = (FR.modules.people ? [] : []);
  $("#pj-body").innerHTML = `
    <div class="stages">${BOARD.concat(["delivered"]).map((st, i) => `<div class="st ${STAGES.indexOf(st) < idx ? "done" : st === j.stage ? "now" : ""}"><i></i><span>${STAGE_LABEL[st]}</span></div>`).join("")}</div>
    ${j.stage === "cancelled" ? `<div class="banner bad">This job was cancelled.</div>` : ""}
    <div class="fields" style="margin-top:14px">
      <div class="field"><label>Due date</label><input type="date" id="jb-due" value="${esc(j.due_date || "")}" ${ro ? "disabled" : ""}></div>
      <div class="field"><label>Assigned to</label><input id="jb-assign" value="${esc(j.assigned_to || "")}" placeholder="name" list="jb-staff" ${ro ? "disabled" : ""}><datalist id="jb-staff">${(S.team || []).filter(m => m.status === "active").map(m => `<option value="${esc(FR.memberName(m))}">`).join("")}</datalist></div>
      <div class="field wide"><label>Internal notes <span class="muted">(not printed)</span></label><textarea id="jb-notes" ${ro ? "disabled" : ""}>${esc(j.notes || "")}</textarea></div>
    </div>
    <dl class="kv" style="margin-top:12px"><dt>Quoted</dt><dd>${when(j.quoted_at) || "—"}${j.sent_at ? " · sent " + when(j.sent_at) : ""}</dd><dt>Accepted</dt><dd>${when(j.accepted_at) || "—"}</dd><dt>Proof approved</dt><dd>${when(j.proof_approved_at) || "—"}</dd><dt>Delivered</dt><dd>${when(j.delivered_at) || "—"}</dd><dt>Paid</dt><dd>${money(paidOf(j))} of ${money(j.total)}${balanceOf(j) > 0 ? ` · <b>${money(balanceOf(j))} outstanding</b>` : " · settled"}</dd></dl>
    ${canWrite() && j.stage !== "cancelled" ? `<h3 style="margin:14px 0 6px">Materials used</h3><div class="toolbar"><select id="jb-mat"><option value="">Choose a material…</option>${P.materials.map(m => `<option value="${m.id}">${esc(m.name)} (${N(m.quantity)} ${esc(m.unit)} in stock)</option>`).join("")}</select><input type="number" id="jb-qty" placeholder="Qty" min="0" step="any" style="width:90px"><button class="btn small" id="jb-use">Record use</button></div>` : ""}
    <ul class="history" style="margin-top:8px">${P.moves.filter(m => m.job_id === j.id).map(mv => { const m = P.materials.find(x => x.id === mv.material_id) || {}; return `<li><time>${when(mv.moved_at)}</time><span>${-N(mv.delta)} ${esc(m.unit || "")} ${esc(m.name || "")}</span></li>`; }).join("")}</ul>`;
  const btns = [];
  if (!ro && j.stage !== "cancelled" && j.stage !== "delivered") {
    if (j.stage === "quote") btns.push(`<button class="btn primary" data-stage="accepted">Customer accepted</button>`);
    else if (next) btns.push(`<button class="btn primary" data-stage="${next}">Move to ${STAGE_LABEL[next]}</button>`);
    if (j.stage === "proof" && !j.proof_approved_at) btns.push(`<button class="btn" id="jb-proof">Proof approved</button>`);
    if (j.stage === "ready") btns.push(`<button class="btn primary" data-stage="delivered">Delivered</button>`);
    if (canManage()) btns.push(`<button class="btn danger" data-stage="cancelled">Cancel job</button>`);
  }
  if (!ro && j.stage === "delivered" && canManage()) btns.push(`<button class="btn" data-stage="ready">Reopen</button>`);
  $("#pj-foot").innerHTML = `${btns.join("")}<span style="flex:1"></span><button class="btn" id="jb-close">Close</button>${ro ? "" : `<button class="btn" id="jb-save">Save</button>`}`;
  $("#jb-close").onclick = closeDrawer;
  $("#jb-save")?.addEventListener("click", async () => { const { error } = await SB().from("press_jobs").update({ due_date: $("#jb-due").value || null, assigned_to: $("#jb-assign").value.trim(), notes: $("#jb-notes").value.trim() }).eq("id", j.id); if (error) toast(error.message, "bad"); else { toast("Saved", "ok"); load(["jobs"]); } });
  $("#pj-foot").querySelectorAll("[data-stage]").forEach(b => b.onclick = () => setStage(j, b.dataset.stage));
  $("#jb-proof")?.addEventListener("click", async () => { await SB().from("press_jobs").update({ proof_approved_at: new Date().toISOString(), history: [...(j.history || []), { ts: new Date().toISOString(), by: me(), summary: "Proof approved by customer" }] }).eq("id", j.id); toast("Proof approved", "ok"); load(["jobs"]); });
  $("#jb-use")?.addEventListener("click", async () => {
    const mid = $("#jb-mat").value, qty = N($("#jb-qty").value); if (!mid || qty <= 0) { toast("Choose a material and quantity", "warn"); return; }
    const { error } = await SB().from("press_material_moves").insert({ company_id: S.company, material_id: mid, job_id: j.id, delta: -qty, note: "Used on " + j.number, moved_by: me() });
    if (error) { toast(error.message, "bad"); return; } toast("Stock updated", "ok"); load(["materials", "moves"]);
  });
}
async function setStage(j, stage) {
  if (stage === "cancelled" && !confirm(`Cancel ${j.number}? Payments already recorded stay on file.`)) return;
  const now = new Date().toISOString(); const patch = { stage, history: [...(j.history || []), { ts: now, by: me(), summary: `Stage: ${STAGE_LABEL[stage]}` }].slice(-100) };
  if (stage === "accepted") patch.accepted_at = now; if (stage === "delivered") patch.delivered_at = now;
  const { error } = await SB().from("press_jobs").update(patch).eq("id", j.id);
  if (error) { toast(error.message, "bad"); return; }
  toast(`${j.number}: ${STAGE_LABEL[stage]}`, "ok"); logAct("ok", `${j.number} moved to ${STAGE_LABEL[stage]}`); await load(["jobs"]);
  if (stage === "accepted" && balanceOf(j) > 0) { P.tab = "pay"; paintDrawer(); }
}
function paintPay(j, isNew, ro) {
  const pays = P.payments.filter(p => p.job_id === j.id).sort((a, b) => (b.paid_at || "").localeCompare(a.paid_at || ""));
  const bal = balanceOf(j);
  $("#pj-body").innerHTML = `
    <dl class="kv"><dt>Total</dt><dd>${money(j.total)}</dd><dt>Paid</dt><dd>${money(paidOf(j))}</dd><dt><b>Balance</b></dt><dd><b>${money(bal)}</b></dd><dt>Deposit due</dt><dd>${money(N(j.total) * N(j.deposit_pct) / 100)} (${N(j.deposit_pct)}%)</dd></dl>
    ${!ro && bal > 0 && j.stage !== "cancelled" ? `<div class="card" style="padding:12px;margin:12px 0"><h3 style="margin-bottom:8px">Record a payment</h3><div class="fields"><div class="field"><label>Amount (₦)</label><input type="number" id="py-amt" min="0.01" step="0.01" value="${bal}"></div><div class="field"><label>Method</label><select id="py-method">${Object.entries(METHOD).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div><div class="field"><label>Date</label><input type="date" id="py-date" value="${today()}"></div><div class="field"><label>Note</label><input id="py-note" placeholder="e.g. deposit, transfer ref"></div></div><p class="hint" id="py-err" style="color:var(--bad)"></p><div class="toolbar" style="justify-content:flex-end;margin-top:8px"><button class="btn primary small" id="py-go">Save and make receipt</button></div></div>` : ""}
    <div class="team-list">${pays.map(p => `<div class="member"><div class="avatar">₦</div><div style="min-width:0"><b>${money(p.amount)} <span class="pill ok flat">${esc(p.receipt_no)}</span></b><small>${METHOD[p.method] || p.method} · ${when(p.paid_at)}${p.note ? " · " + esc(p.note) : ""} · by ${esc(p.received_by || "")}</small></div><div class="acts"><button class="btn small" data-rpdf="${p.id}">Receipt PDF</button>${canWrite() && custOf(j)?.email ? `<button class="btn small" data-rmail="${p.id}">Email</button>` : ""}${canManage() ? `<button class="btn small danger" data-rdel="${p.id}">Delete</button>` : ""}</div></div>`).join("") || `<p class="muted">No payments yet.</p>`}</div>`;
  $("#pj-foot").innerHTML = `<button class="btn" id="py-inv">Invoice PDF</button>${canWrite() && custOf(j)?.email ? `<button class="btn" id="py-invmail">Email invoice</button>` : ""}<span style="flex:1"></span><button class="btn" id="py-close">Close</button>`;
  $("#py-close").onclick = closeDrawer;
  $("#py-inv").onclick = () => savePdf(invoicePdf(j), `${j.number}-invoice.pdf`);
  $("#py-invmail")?.addEventListener("click", () => emailDoc(j, "invoice"));
  $("#py-go")?.addEventListener("click", async () => {
    const amount = N($("#py-amt").value); $("#py-err").textContent = ""; if (amount <= 0) { $("#py-err").textContent = "Enter the amount."; return; }
    if (amount > bal + 0.001 && !confirm(`${money(amount)} is more than the balance of ${money(bal)}. Record it anyway?`)) return;
    $("#py-go").disabled = true;
    try {
      const receipt_no = await nextNumber("R");
      const { data, error } = await SB().from("press_payments").insert({ company_id: S.company, job_id: j.id, receipt_no, amount, method: $("#py-method").value, paid_at: $("#py-date").value || today(), note: $("#py-note").value.trim(), received_by: me() }).select("*").maybeSingle(); if (error) throw error;
      await SB().from("press_jobs").update({ history: [...(j.history || []), { ts: new Date().toISOString(), by: me(), summary: `Payment ${money(amount)} (${METHOD[data.method]}) · receipt ${receipt_no}` }].slice(-100) }).eq("id", j.id);
      toast(`Receipt ${receipt_no} saved`, "ok"); logAct("ok", `${j.number}: ${money(amount)} received, receipt ${receipt_no}`);
      await load(["payments", "jobs"]); savePdf(receiptPdf(jobOf() || j, data), `${receipt_no}.pdf`);
    } catch (e) { $("#py-err").textContent = e.message || String(e); $("#py-go").disabled = false; }
  });
  $("#pj-body").querySelectorAll("[data-rpdf]").forEach(b => b.onclick = () => { const p = pays.find(x => x.id === b.dataset.rpdf); savePdf(receiptPdf(j, p), `${p.receipt_no}.pdf`); });
  $("#pj-body").querySelectorAll("[data-rmail]").forEach(b => b.onclick = () => emailDoc(j, "receipt", pays.find(x => x.id === b.dataset.rmail)));
  $("#pj-body").querySelectorAll("[data-rdel]").forEach(b => b.onclick = async () => { const p = pays.find(x => x.id === b.dataset.rdel); if (!confirm(`Delete receipt ${p.receipt_no} (${money(p.amount)})? Only do this for a mistaken entry.`)) return; const { error } = await SB().from("press_payments").delete().eq("id", p.id); if (error) toast(error.message, "bad"); else { toast("Payment deleted", "warn"); load(["payments"]); } });
}
function paintFiles(j, isNew, ro) {
  const files = P.files.filter(f => f.job_id === j.id);
  $("#pj-body").innerHTML = `${ro ? "" : `<div class="card" style="padding:12px;margin-bottom:12px"><div class="fields"><div class="field"><label>Type</label><select id="pf-kind">${Object.entries(FILE_KIND).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div><div class="field"><label>Title</label><input id="pf-title" placeholder="e.g. Final artwork v2"></div><div class="field wide"><label>File <span class="muted">(up to 25 MB)</span></label><input type="file" id="pf-file"></div></div><p class="hint" id="pf-err" style="color:var(--bad)"></p><div class="toolbar" style="justify-content:flex-end;margin-top:8px"><button class="btn primary small" id="pf-up">Upload</button></div></div>`}
    <div class="team-list">${files.map(f => `<div class="member"><div class="avatar">${(f.mime || "").startsWith("image/") ? "IMG" : f.mime === "application/pdf" ? "PDF" : "FILE"}</div><div style="min-width:0"><b>${esc(f.title)}</b><small>${FILE_KIND[f.kind] || f.kind} · ${f.size_bytes ? Math.round(f.size_bytes / 1024) + " KB · " : ""}${when(f.uploaded_at)} by ${esc(f.uploaded_by || "")}</small></div><div class="acts"><button class="btn small" data-fopen="${f.id}">Open</button>${ro ? "" : `<button class="btn small danger" data-fdel="${f.id}">Delete</button>`}</div></div>`).join("") || `<p class="muted">No files yet. Artwork, proofs and references go here.</p>`}</div>`;
  $("#pj-foot").innerHTML = `<button class="btn" id="pf-close">Close</button>`; $("#pf-close").onclick = closeDrawer;
  $("#pf-up")?.addEventListener("click", async () => {
    const f = $("#pf-file").files[0], title = $("#pf-title").value.trim() || f?.name; $("#pf-err").textContent = ""; if (!f) { $("#pf-err").textContent = "Choose a file."; return; }
    $("#pf-up").disabled = true; const path = `${S.company}/${j.id}/${Date.now().toString(36)}-${f.name.replace(/[^A-Za-z0-9._-]+/g, "-")}`;
    const { error } = await SB().storage.from("press-files").upload(path, f, { contentType: f.type || "application/octet-stream" });
    if (error) { $("#pf-err").textContent = error.message; $("#pf-up").disabled = false; return; }
    const { error: e2 } = await SB().from("press_files").insert({ company_id: S.company, job_id: j.id, kind: $("#pf-kind").value, title, file_path: path, size_bytes: f.size, mime: f.type, uploaded_by: me() });
    if (e2) { $("#pf-err").textContent = e2.message; $("#pf-up").disabled = false; return; } toast("File uploaded", "ok"); load(["files"]);
  });
  $("#pj-body").querySelectorAll("[data-fopen]").forEach(b => b.onclick = async () => { const f = files.find(x => x.id === b.dataset.fopen); const { data, error } = await SB().storage.from("press-files").createSignedUrl(f.file_path, 300); if (error) toast(error.message, "bad"); else window.open(data.signedUrl, "_blank", "noopener"); });
  $("#pj-body").querySelectorAll("[data-fdel]").forEach(b => b.onclick = async () => { const f = files.find(x => x.id === b.dataset.fdel); if (!confirm(`Delete "${f.title}"?`)) return; await SB().storage.from("press-files").remove([f.file_path]); await SB().from("press_files").delete().eq("id", f.id); load(["files"]); });
}
function paintHistory(j) {
  $("#pj-body").innerHTML = `<ul class="history">${(j.history || []).slice().reverse().map(h => `<li><time>${FR.fmtDate(h.ts)}</time><span>${esc(h.summary)} <span class="muted" data-by="${esc(h.by || "")}"></span></span></li>`).join("") || `<li class="muted">Nothing yet.</li>`}</ul>`;
  $("#pj-foot").innerHTML = `<button class="btn" id="ph-close">Close</button>`; $("#ph-close").onclick = closeDrawer; FR.resolveNames();
}

/* ---------- customers & materials (small drawers) ---------- */
function openCustomer(id) {
  const c = id === "new" ? { name: "", phone: "", email: "", address: "", notes: "" } : P.customers.find(x => x.id === id); if (!c) return;
  const ro = !canWrite(); const jobs = id === "new" ? [] : P.jobs.filter(j => j.customer_id === id).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  $("#drawer").innerHTML = `<header><div><h2>${id === "new" ? "New customer" : esc(c.name)}</h2><div class="muted" style="margin-top:4px">${jobs.length} job${jobs.length === 1 ? "" : "s"}${jobs.length ? " · owes " + money(jobs.filter(j => j.stage !== "quote" && j.stage !== "cancelled").reduce((s, j) => s + balanceOf(j), 0)) : ""}</div></div><button class="x" id="close" aria-label="Close">×</button></header>
    <div class="body"><div class="fields"><div class="field wide"><label>Name</label><input id="c-name" value="${esc(c.name)}" ${ro ? "disabled" : ""}></div><div class="field"><label>Phone</label><input id="c-phone" value="${esc(c.phone)}" ${ro ? "disabled" : ""}></div><div class="field"><label>Email</label><input id="c-email" type="email" value="${esc(c.email)}" ${ro ? "disabled" : ""}></div><div class="field wide"><label>Address</label><input id="c-addr" value="${esc(c.address)}" ${ro ? "disabled" : ""}></div><div class="field wide"><label>Notes</label><textarea id="c-notes" ${ro ? "disabled" : ""}>${esc(c.notes)}</textarea></div></div>
      ${jobs.length ? `<h3 style="margin:14px 0 6px">Jobs</h3><div class="team-list">${jobs.map(j => `<div class="member" data-open="${j.id}" style="cursor:pointer"><div class="avatar">${esc(j.number.slice(-2))}</div><div style="min-width:0"><b>${esc(j.number)} · ${esc(j.title || "")}</b><small>${STAGE_LABEL[j.stage]} · ${money(j.total)}${balanceOf(j) > 0 && j.stage !== "quote" ? " · owes " + money(balanceOf(j)) : ""}</small></div></div>`).join("")}</div>` : ""}
      <p class="hint" id="c-err" style="color:var(--bad)"></p></div>
    <footer>${!ro && id !== "new" ? `<button class="btn primary small" id="c-quote">New quote for this customer</button>` : ""}<span style="flex:1"></span><button class="btn" id="c-close">Close</button>${ro ? "" : `<button class="btn primary" id="c-save">Save</button>`}</footer>`;
  showDrawer(); $("#close").onclick = closeDrawer; $("#c-close").onclick = closeDrawer;
  $("#drawer").querySelectorAll("[data-open]").forEach(el => el.onclick = () => { FR.setView("press-jobs"); openDrawer(el.dataset.open); });
  $("#c-quote")?.addEventListener("click", () => { FR.setView("press-jobs"); openDrawer("new"); P.draft = null; paintDrawer(); $("#q-cust").value = c.name; });
  $("#c-save")?.addEventListener("click", async () => {
    const body = { company_id: S.company, name: $("#c-name").value.trim(), phone: $("#c-phone").value.trim(), email: $("#c-email").value.trim().toLowerCase(), address: $("#c-addr").value.trim(), notes: $("#c-notes").value.trim() };
    if (!body.name) { $("#c-err").textContent = "Name is required."; return; }
    const q = id === "new" ? SB().from("press_customers").insert(body) : SB().from("press_customers").update(body).eq("id", id);
    const { error } = await q; if (error) { $("#c-err").textContent = error.message; return; }
    if (id !== "new") await SB().from("press_jobs").update({ customer_name: body.name }).eq("customer_id", id);
    toast("Customer saved", "ok"); closeDrawer(); load(["customers", "jobs"]);
  });
}
function editMaterial(m) {
  const isNew = !m; m = m || { name: "", unit: "unit", quantity: 0, reorder_level: 0, unit_cost: 0, notes: "" };
  $("#drawer").innerHTML = `<header><div><h2>${isNew ? "New material" : esc(m.name)}</h2></div><button class="x" id="close" aria-label="Close">×</button></header>
    <div class="body"><div class="fields"><div class="field wide"><label>Name</label><input id="m-name" value="${esc(m.name)}" placeholder="e.g. A4 150gsm gloss paper"></div><div class="field"><label>Unit</label><input id="m-unit" value="${esc(m.unit)}" placeholder="sheet, ream, litre, roll"></div><div class="field"><label>Reorder when below</label><input type="number" id="m-re" value="${N(m.reorder_level)}" min="0" step="any"></div>${isNew ? `<div class="field"><label>Opening stock</label><input type="number" id="m-qty" value="0" min="0" step="any"></div>` : ""}<div class="field"><label>Unit cost (₦)</label><input type="number" id="m-cost" value="${N(m.unit_cost)}" min="0" step="0.01"></div><div class="field wide"><label>Notes</label><input id="m-notes" value="${esc(m.notes)}"></div></div><p class="hint" id="m-err" style="color:var(--bad)"></p></div>
    <footer>${isNew ? "" : `<button class="btn danger" id="m-del">Delete</button>`}<span style="flex:1"></span><button class="btn" id="m-close">Close</button><button class="btn primary" id="m-save">Save</button></footer>`;
  showDrawer(); $("#close").onclick = closeDrawer; $("#m-close").onclick = closeDrawer;
  $("#m-del")?.addEventListener("click", async () => { if (!confirm(`Delete ${m.name} and its stock history?`)) return; const { error } = await SB().from("press_materials").delete().eq("id", m.id); if (error) toast(error.message, "bad"); else { closeDrawer(); load(["materials", "moves"]); } });
  $("#m-save").onclick = async () => {
    const body = { company_id: S.company, name: $("#m-name").value.trim(), unit: $("#m-unit").value.trim() || "unit", reorder_level: N($("#m-re").value), unit_cost: N($("#m-cost").value), notes: $("#m-notes").value.trim(), updated_by: me(), updated_at: new Date().toISOString() };
    if (!body.name) { $("#m-err").textContent = "Name is required."; return; }
    if (isNew) { body.quantity = N($("#m-qty").value); const { error } = await SB().from("press_materials").insert(body); if (error) { $("#m-err").textContent = error.message; return; } }
    else { const { error } = await SB().from("press_materials").update(body).eq("id", m.id); if (error) { $("#m-err").textContent = error.message; return; } }
    toast("Material saved", "ok"); closeDrawer(); load(["materials"]);
  };
}
function moveStock(m) {
  $("#drawer").innerHTML = `<header><div><h2>${esc(m.name)}</h2><div class="muted" style="margin-top:4px">${N(m.quantity)} ${esc(m.unit)} in stock</div></div><button class="x" id="close" aria-label="Close">×</button></header>
    <div class="body"><div class="fields"><div class="field"><label>Direction</label><select id="mv-dir"><option value="in">Stock in (received)</option><option value="out">Stock out (used / wasted)</option></select></div><div class="field"><label>Quantity (${esc(m.unit)})</label><input type="number" id="mv-qty" min="0" step="any"></div><div class="field wide"><label>For job <span class="muted">(optional)</span></label><select id="mv-job"><option value="">—</option>${P.jobs.filter(j => !["quote", "delivered", "cancelled"].includes(j.stage)).map(j => `<option value="${j.id}">${esc(j.number)} · ${esc(j.title)}</option>`).join("")}</select></div><div class="field wide"><label>Note</label><input id="mv-note" placeholder="supplier, reason…"></div></div><p class="hint" id="mv-err" style="color:var(--bad)"></p></div>
    <footer><span style="flex:1"></span><button class="btn" id="mv-close">Close</button><button class="btn primary" id="mv-save">Record</button></footer>`;
  showDrawer(); $("#close").onclick = closeDrawer; $("#mv-close").onclick = closeDrawer;
  $("#mv-save").onclick = async () => {
    const qty = N($("#mv-qty").value); if (qty <= 0) { $("#mv-err").textContent = "Enter a quantity."; return; }
    const delta = $("#mv-dir").value === "in" ? qty : -qty;
    const { error } = await SB().from("press_material_moves").insert({ company_id: S.company, material_id: m.id, job_id: $("#mv-job").value || null, delta, note: $("#mv-note").value.trim(), moved_by: me() });
    if (error) { $("#mv-err").textContent = error.message; return; } toast("Stock updated", "ok"); closeDrawer(); load(["materials", "moves"]);
  };
}

/* ---------- PDFs (jsPDF + autotable) ---------- */
function docBase(title, number, dateStr) {
  const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: "mm", format: "a4" }); const cfg = P.cfg;
  doc.setFillColor(47, 91, 255); doc.rect(0, 0, 210, 6, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(16, 24, 40); doc.text(cfg.business_name || "", 14, 20);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(102, 112, 133);
  const lines = [cfg.address, [cfg.phone, cfg.email].filter(Boolean).join(" · ")].filter(Boolean); lines.forEach((l, i) => doc.text(l, 14, 26 + i * 4.5));
  doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.setTextColor(47, 91, 255); doc.text(title, 196, 20, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(16, 24, 40); doc.text(number, 196, 27, { align: "right" }); doc.text(dateStr, 196, 32, { align: "right" });
  doc.setDrawColor(228, 231, 236); doc.line(14, 38, 196, 38);
  return doc;
}
function customerBlock(doc, j, y) {
  const c = custOf(j) || { name: custName(j) };
  doc.setFontSize(9); doc.setTextColor(102, 112, 133); doc.text("TO", 14, y);
  doc.setFontSize(11); doc.setTextColor(16, 24, 40); doc.setFont("helvetica", "bold"); doc.text(c.name || "", 14, y + 5.5); doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
  [c.phone, c.email, c.address].filter(Boolean).forEach((l, i) => doc.text(String(l), 14, y + 10.5 + i * 4.5));
  if (j.title) { doc.setFontSize(9); doc.setTextColor(102, 112, 133); doc.text("JOB", 110, y); doc.setFontSize(10.5); doc.setTextColor(16, 24, 40); doc.text(doc.splitTextToSize(j.title, 86), 110, y + 5.5); }
  return y + 26;
}
function itemsTable(doc, j, y) {
  const specs = Object.entries(j.specs || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(" · ");
  doc.autoTable({ startY: y, head: [["Description", "Qty", "Unit", "Unit price", "Total"]], body: (j.items || []).map(i => [i.description, String(N(i.qty)), i.unit || "", money(i.unit_price).replace("₦", "N"), money(i.total).replace("₦", "N")]),
    styles: { fontSize: 9.5, cellPadding: 2.5, textColor: [16, 24, 40] }, headStyles: { fillColor: [16, 24, 40], textColor: 255 }, columnStyles: { 1: { halign: "right", cellWidth: 18 }, 2: { cellWidth: 20 }, 3: { halign: "right", cellWidth: 30 }, 4: { halign: "right", cellWidth: 32 } }, margin: { left: 14, right: 14 } });
  let yy = doc.lastAutoTable.finalY + 6;
  const t = calcTotals(j.items || [], j.discount, P.cfg.vat_pct);
  const rows = [["Subtotal", money(t.subtotal)], ...(N(j.discount) ? [["Discount", "- " + money(j.discount)]] : []), ...(N(P.cfg.vat_pct) ? [[`VAT ${N(P.cfg.vat_pct)}%`, money(t.vat)]] : []), ["Total", money(j.total)]];
  doc.setFontSize(10);
  rows.forEach(([k, v], i) => { const bold = k === "Total"; doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setTextColor(bold ? 47 : 102, bold ? 91 : 112, bold ? 255 : 133); doc.text(k, 150, yy + i * 6, { align: "right" }); doc.setTextColor(16, 24, 40); doc.text(v.replace("₦", "N"), 196, yy + i * 6, { align: "right" }); });
  yy += rows.length * 6 + 4;
  if (specs) { doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(102, 112, 133); doc.text(doc.splitTextToSize("Specification: " + specs, 180), 14, yy); yy += 6 + Math.ceil(specs.length / 110) * 4; }
  if (j.description) { doc.setFontSize(9.5); doc.setTextColor(16, 24, 40); const ls = doc.splitTextToSize(j.description, 180); doc.text(ls, 14, yy); yy += ls.length * 4.5 + 2; }
  return yy;
}
function footerBlock(doc, lines, y) {
  doc.setFontSize(8.5); doc.setTextColor(102, 112, 133);
  lines.filter(Boolean).forEach(l => { const ls = doc.splitTextToSize(l, 182); doc.text(ls, 14, y); y += ls.length * 4 + 1.5; });
  doc.setFontSize(8); doc.text(`Prepared by ${S.me?.name || ""} · ${new Date().toLocaleString("en-NG")}`, 14, 290);
}
function quotePdf(j) {
  const doc = docBase("QUOTATION", j.number, "Date: " + when(j.quoted_at || j.created_at)); let y = customerBlock(doc, j, 46); y = itemsTable(doc, j, y + 2);
  const dep = N(j.total) * N(j.deposit_pct) / 100; const until = new Date(Date.parse(j.quoted_at || j.created_at || Date.now()) + N(j.valid_days) * 864e5);
  footerBlock(doc, [`Deposit to start: ${money(dep).replace("₦", "N")} (${N(j.deposit_pct)}%). Balance: ${money(N(j.total) - dep).replace("₦", "N")} before delivery.`, `This quotation is valid until ${when(until.toISOString())} (${N(j.valid_days)} days).`, P.cfg.bank_name ? `Bank: ${P.cfg.bank_name} · ${P.cfg.account_name} · ${P.cfg.account_number}` : "", P.cfg.terms], y + 4);
  return doc;
}
function invoicePdf(j) {
  const doc = docBase("INVOICE", j.number, "Date: " + when(j.accepted_at || j.quoted_at || j.created_at)); let y = customerBlock(doc, j, 46); y = itemsTable(doc, j, y + 2);
  const paid = paidOf(j), bal = balanceOf(j);
  doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.setTextColor(102, 112, 133); doc.text("Paid to date", 150, y + 2, { align: "right" }); doc.setTextColor(16, 24, 40); doc.text(money(paid).replace("₦", "N"), 196, y + 2, { align: "right" });
  doc.setFont("helvetica", "bold"); doc.setTextColor(bal > 0 ? 217 : 16, bal > 0 ? 45 : 24, bal > 0 ? 32 : 40); doc.text("Balance due", 150, y + 8, { align: "right" }); doc.text(money(bal).replace("₦", "N"), 196, y + 8, { align: "right" });
  footerBlock(doc, [j.due_date ? `Delivery: ${when(j.due_date)}.` : "", P.cfg.bank_name ? `Pay to: ${P.cfg.bank_name} · ${P.cfg.account_name} · ${P.cfg.account_number}. Use ${j.number} as reference.` : "", P.cfg.terms], y + 16);
  return doc;
}
function receiptPdf(j, p) {
  const doc = docBase("RECEIPT", p.receipt_no, "Date: " + when(p.paid_at)); let y = customerBlock(doc, j, 46);
  doc.setFontSize(11); doc.setTextColor(16, 24, 40); doc.text(`Received with thanks the sum of`, 14, y + 2);
  doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.setTextColor(47, 91, 255); doc.text(money(p.amount).replace("₦", "N"), 14, y + 13);
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
  if (out.status === "sent") { toast(`${kind[0].toUpperCase() + kind.slice(1)} emailed to ${c.email}`, "ok"); logAct("ok", `${name} emailed to ${c.email}`); if (kind === "quote") markSent(j); await SB().from("press_jobs").update({ history: [...(j.history || []), { ts: new Date().toISOString(), by: me(), summary: `${name} emailed to ${c.email}` }].slice(-100) }).eq("id", j.id); load(["jobs"]); }
  else { toast("Email failed: " + (out.detail || out.error || "unknown"), "bad"); logAct("bad", `Email of ${name} failed`, out.detail || out.error || ""); }
}

/* ---------- registration ---------- */
FR.registerModule({
  id: "press", name: "Press",
  views: [
    { id: "press-jobs", title: "Jobs", sub: "Quotes, production board and deliveries", count: true, icon: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M7 20h10M12 16v4M7 8h10M7 12h6"/></svg>' },
    { id: "press-customers", title: "Customers", sub: "Who you print for, and what they owe", icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>' },
    { id: "press-materials", title: "Materials", sub: "Paper, ink and consumables in stock", count: true, icon: '<svg viewBox="0 0 24 24"><path d="M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8"/></svg>' },
    { id: "press-money", title: "Money", sub: "Outstanding balances, receipts and invoices", count: true, icon: '<svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/></svg>' },
    { id: "press-rates", title: "Rate card", sub: "Prices, letterhead and terms", icon: '<svg viewBox="0 0 24 24"><path d="M20 7l-8-4-8 4v10l8 4 8-4z"/><path d="M12 11v10M4 7l8 4 8-4"/></svg>' },
  ],
  start() {
    if (P.started) return; P.started = true; load();
    [["press_customers", "customers"], ["press_rate_items", "rates"], ["press_jobs", "jobs"], ["press_payments", "payments"], ["press_materials", "materials"], ["press_material_moves", "moves"], ["press_files", "files"], ["company_settings", "settings"]].forEach(([t, k]) => FR.subscribe(t, () => load([k])));
  },
  onCompany() { P.q = ""; if (P.open) closeDrawer(); scope(); render(); },
  render, closeDrawer,
});
})();
