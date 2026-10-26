/* Future Ready customer portal: public company page, customer accounts, job requests and follow-up.
   One copy serves every company; the page's <body data-company> says which. Talks to Supabase directly (RLS keeps customers to their own rows). */
(() => {
const CFG = window.HIRING_DESK_CONFIG || {};
const CO = document.body.dataset.company || "press";
const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const STATUS = { new: "Received", quoted: "Quote sent", in_progress: "In progress", done: "Done", declined: "Declined" };
const GOOGLE_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4z"/><path opacity=".8" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"/><path opacity=".6" d="M6.4 13.9a6 6 0 0 1 0-3.8V7.5H3.1a10 10 0 0 0 0 9z"/><path opacity=".9" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.5l3.3 2.6C7.2 7.7 9.4 5.9 12 5.9z"/></svg>`;
let sb, me = null, pub = null, reqs = [], recovering = false, lastTouch = 0;
const redirectTo = () => location.origin + location.pathname;
const fmtDate = d => d ? new Date(d).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : "";
const when = d => d ? new Date(d).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2600); }
function authErr(e) {
  const m = String(e?.message || e || "");
  if (/invalid login credentials/i.test(m)) return "Wrong email or password.";
  if (/email not confirmed/i.test(m)) return "Confirm your email first: open the message we sent you, then sign in.";
  if (/already registered|already been registered/i.test(m)) return "That email already has an account. Sign in, or use Forgot password.";
  if (/rate limit|too many/i.test(m)) return "Too many attempts. Wait a few minutes and try again.";
  if (/password should be|weak|at least/i.test(m)) return "Use a longer password: at least 8 characters.";
  return m || "Something went wrong. Try again.";
}
const pwField = (id, label, auto, extra = "") => `<div class="field"><label for="${id}">${label}</label><div class="pw"><input id="${id}" type="password" autocomplete="${auto}" minlength="8" required ${extra}><button type="button" class="eye" data-for="${id}">Show</button></div></div>`;
function wireEyes(root) { $$(".eye", root).forEach(b => b.onclick = () => { const i = $("#" + b.dataset.for); const show = i.type === "password"; i.type = show ? "text" : "password"; b.textContent = show ? "Hide" : "Show"; }); }
function busy(btn, on, label) { btn.disabled = on; btn.textContent = on ? "Please wait…" : label; }

/* ---------- public page ---------- */
async function loadPublic() {
  const { data, error } = await sb.rpc("portal_public", { p_company: CO });
  if (error || !data) { $("#hero-title").textContent = "This page is not available right now."; return; }
  pub = data; const s = data.settings || {};
  document.title = `${data.name} · ${s.tagline || "Request a quote"}`;
  $("#hero-eyebrow").textContent = `${data.name} · Enugu`;
  if (s.tagline) $("#hero-title").textContent = s.tagline;
  if (s.about) $("#hero-about").textContent = s.about;
  const wa = (s.whatsapp || "").replace(/\D/g, "");
  if (wa) { const a = $("#hero-wa"); a.hidden = false; a.href = `https://wa.me/${wa.replace(/^0/, "234")}`; a.target = "_blank"; a.rel = "noopener"; }
  const groups = {}; for (const sv of data.services || []) (groups[sv.category || "Services"] ||= []).push(sv);
  $("#services-list").innerHTML = Object.entries(groups).map(([cat, list]) => `<div class="svc"><h3>${esc(cat)}</h3><ul>${list.map(x => `<li>${esc(x.name)} <small>per ${esc(x.unit || "piece")}</small></li>`).join("")}</ul></div>`).join("") || `<p class="muted">Ask us about anything printed.</p>`;
  $("#steps").innerHTML = (s.steps || []).map(t => `<li>${esc(t)}</li>`).join("");
  const cells = [];
  if (s.phone) cells.push(`<div class="card"><small>Phone</small><a href="tel:${esc(s.phone.replace(/\s/g, ""))}">${esc(s.phone)}</a></div>`);
  if (wa) cells.push(`<div class="card"><small>WhatsApp</small><a href="https://wa.me/${wa.replace(/^0/, "234")}" target="_blank" rel="noopener">${esc(s.whatsapp)}</a></div>`);
  if (s.email) cells.push(`<div class="card"><small>Email</small><a href="mailto:${esc(s.email)}">${esc(s.email)}</a></div>`);
  if (s.address) { cells.push(`<div class="card"><small>Address</small>${esc(s.address)}</div>`); $("#foot-addr").textContent = s.address; }
  if (s.hours) cells.push(`<div class="card"><small>Hours</small>${esc(s.hours)}</div>`);
  $("#contact-grid").innerHTML = cells.join("") || `<p class="muted">Send a request below and we will get back to you.</p>`;
}

/* ---------- account ---------- */
function paintAcct() {
  const a = $("#acct");
  if (!me) { a.innerHTML = `<a class="btn" href="#request" id="top-in">Sign in</a><a class="btn primary" href="#request">Request a quote</a>`; return; }
  a.innerHTML = `<span class="who"><b>${esc(me.user_metadata?.full_name || me.email)}</b></span><button class="btn small" id="top-out">Sign out</button>`;
  $("#top-out").onclick = async () => { await sb.auth.signOut(); location.reload(); };
}
async function googleSignIn() { const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirectTo() } }); if (error) toast(authErr(error)); }

function renderAuth(mode = "in") {
  const body = $("#req-body");
  const google = `<div class="or"><span>or</span></div><button type="button" class="btn gbtn" id="g-btn">${GOOGLE_SVG}Continue with Google</button>`;
  const seg = `<div class="seg"><button type="button" class="${mode === "in" ? "on" : ""}" data-m="in">Sign in</button><button type="button" class="${mode === "up" ? "on" : ""}" data-m="up">Create account</button></div>`;
  if (mode === "forgot") {
    body.innerHTML = `<div class="card auth"><h3>Reset your password</h3><p class="muted">We will email you a link to choose a new one.</p><form id="f" novalidate style="margin-top:12px">
      <div class="field"><label>Email</label><input id="a-email" type="email" required autocomplete="email"></div><p class="note" id="note"></p>
      <button class="btn primary" id="go">Send reset link</button><button class="btn link" type="button" id="back">Back to sign in</button></form></div>`;
    $("#back").onclick = () => renderAuth("in");
    $("#f").onsubmit = async e => { e.preventDefault(); const email = $("#a-email").value.trim().toLowerCase(); busy($("#go"), true); const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirectTo() }); busy($("#go"), false, "Send reset link"); const n = $("#note"); if (error) { n.textContent = authErr(error); return; } n.className = "note ok"; n.textContent = "If that address has an account, the link is on its way."; };
    return;
  }
  if (mode === "up") {
    body.innerHTML = `<div class="card auth"><h3>Create your account</h3><p class="muted">Free. You can attach files, get your quote and follow the job here.</p>${seg}<form id="f" novalidate>
      <div class="field"><label>Your name</label><input id="a-name" required autocomplete="name"></div>
      <div class="field"><label>Email</label><input id="a-email" type="email" required autocomplete="email"></div>
      ${pwField("a-pass", "Password", "new-password", 'placeholder="At least 8 characters"')}${pwField("a-pass2", "Confirm password", "new-password")}
      <p class="note" id="note"></p><button class="btn primary" id="go">Create account</button></form>${google}</div>`;
  } else {
    body.innerHTML = `<div class="card auth"><h3>Sign in</h3><p class="muted">To send a request or check on one.</p>${seg}<form id="f" novalidate>
      <div class="field"><label>Email</label><input id="a-email" type="email" required autocomplete="username"></div>
      ${pwField("a-pass", "Password", "current-password")}
      <div class="row"><span></span><button class="btn link" type="button" id="forgot">Forgot password?</button></div>
      <p class="note" id="note"></p><button class="btn primary" id="go">Sign in</button></form>${google}</div>`;
    $("#forgot").onclick = () => renderAuth("forgot");
  }
  wireEyes(body); $$(".seg button", body).forEach(b => b.onclick = () => renderAuth(b.dataset.m)); $("#g-btn").onclick = googleSignIn;
  $("#f").onsubmit = async e => {
    e.preventDefault(); const n = $("#note"); n.className = "note"; n.textContent = "";
    const email = $("#a-email").value.trim().toLowerCase(), p1 = $("#a-pass").value;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return n.textContent = "That is not a valid email address.";
    if (mode === "up") {
      const name = $("#a-name").value.trim(), p2 = $("#a-pass2").value;
      if (!name) return n.textContent = "Your name is required.";
      if (p1.length < 8) return n.textContent = "Use at least 8 characters for the password.";
      if (p1 !== p2) return n.textContent = "The two passwords do not match.";
      busy($("#go"), true);
      const { data, error } = await sb.auth.signUp({ email, password: p1, options: { data: { full_name: name, portal: CO }, emailRedirectTo: redirectTo() } });
      busy($("#go"), false, "Create account");
      if (error) return n.textContent = authErr(error);
      if (data?.user && Array.isArray(data.user.identities) && !data.user.identities.length) return n.textContent = authErr({ message: "already registered" });
      if (data?.session) return;
      body.innerHTML = `<div class="card auth"><h3>Check your inbox</h3><p class="muted">We sent a confirmation link to <b>${esc(email)}</b>. Open it, then come back here and sign in. Look in Spam if it has not arrived in two minutes.</p>
        <div class="row" style="margin-top:14px"><button class="btn" id="resend">Send it again</button><button class="btn link" id="back">Back to sign in</button></div><p class="note" id="note"></p></div>`;
      $("#back").onclick = () => renderAuth("in");
      $("#resend").onclick = async () => { busy($("#resend"), true); const { error } = await sb.auth.resend({ type: "signup", email, options: { emailRedirectTo: redirectTo() } }); busy($("#resend"), false, "Send it again"); $("#note").textContent = error ? authErr(error) : "Sent again."; };
      return;
    }
    if (!p1) return n.textContent = "Enter your password.";
    busy($("#go"), true);
    const { error } = await sb.auth.signInWithPassword({ email, password: p1 });
    if (error) { busy($("#go"), false, "Sign in"); n.textContent = authErr(error); }
  };
}
function renderRecover() {
  $("#req-body").innerHTML = `<div class="card auth"><h3>Choose a new password</h3><form id="f" novalidate style="margin-top:12px">${pwField("a-pass", "New password", "new-password")}${pwField("a-pass2", "Confirm new password", "new-password")}<p class="note" id="note"></p><button class="btn primary" id="go">Save password</button></form></div>`;
  wireEyes($("#req-body"));
  $("#f").onsubmit = async e => { e.preventDefault(); const p1 = $("#a-pass").value, p2 = $("#a-pass2").value, n = $("#note"); if (p1.length < 8) return n.textContent = "Use at least 8 characters."; if (p1 !== p2) return n.textContent = "The two passwords do not match."; busy($("#go"), true); const { error } = await sb.auth.updateUser({ password: p1 }); busy($("#go"), false, "Save password"); if (error) return n.textContent = authErr(error); recovering = false; toast("Password saved"); renderSigned(); };
}

/* ---------- signed in: request form + my requests ---------- */
async function renderSigned() {
  const body = $("#req-body");
  $("#req-title").textContent = "Request a quote"; $("#req-sub").textContent = `Signed in as ${me.email}. Tell us what you need; we reply here and by email.`;
  const { data: prof } = await sb.from("portal_profiles").select("*").eq("user_id", me.id).maybeSingle();
  const services = (pub?.services || []).map(s => s.name);
  body.innerHTML = `<div class="card"><h3>New request</h3><form id="rf" novalidate>
      <div class="fields">
        <div class="field"><label>Your name</label><input id="r-name" value="${esc(prof?.name || me.user_metadata?.full_name || "")}" required autocomplete="name"></div>
        <div class="field"><label>Phone / WhatsApp</label><input id="r-phone" value="${esc(prof?.phone || "")}" inputmode="tel" required placeholder="0803 000 0000"></div>
        <div class="field wide"><label>Business or organisation <small>(optional)</small></label><input id="r-biz" value="${esc(prof?.business || "")}"></div>
        <div class="field"><label>What do you need?</label><select id="r-service"><option value="">Choose…</option>${services.map(s => `<option>${esc(s)}</option>`).join("")}<option value="Something else">Something else</option></select></div>
        <div class="field"><label>Quantity <small>(optional)</small></label><input id="r-qty" placeholder="e.g. 500 pieces"></div>
        <div class="field wide"><label>Title</label><input id="r-title" required placeholder="e.g. Wedding programme, 200 copies, A5"></div>
        <div class="field wide"><label>Details</label><textarea id="r-details" placeholder="Size, paper, colours, finishing, where it will be used, anything else we should know."></textarea></div>
        <div class="field"><label>Needed by <small>(optional)</small></label><input id="r-date" type="date"></div>
        <div class="field"><label>Artwork or reference files <small>(optional, up to 25 MB each)</small></label><input id="r-files" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.svg,.ai,.eps,.zip,.docx,.xlsx,.txt"></div>
      </div>
      <p class="note" id="r-note"></p>
      <div class="row"><span class="hint">We reply with a quote, usually the same day.</span><button class="btn primary" id="r-go">Send request</button></div></form></div>
    <div class="card"><div class="row"><h3>My requests</h3><button class="btn small" id="r-refresh">Refresh</button></div><div class="reqs" id="reqs"><p class="muted">Loading…</p></div></div>`;
  $("#r-refresh").onclick = loadReqs;
  $("#rf").onsubmit = submitRequest;
  await loadReqs();
}
async function submitRequest(e) {
  e.preventDefault(); const n = $("#r-note"); n.className = "note"; n.textContent = "";
  const v = id => $("#" + id).value.trim();
  if (!v("r-name")) return n.textContent = "Your name is required.";
  if (!v("r-phone")) return n.textContent = "A phone number is required so we can reach you.";
  if (v("r-title").length < 3) return n.textContent = "Give the request a short title.";
  const files = [...$("#r-files").files]; const big = files.find(f => f.size > 25 * 1024 * 1024); if (big) return n.textContent = `${big.name} is over 25 MB.`;
  const b = $("#r-go"); busy(b, true);
  const { data: r, error } = await sb.rpc("portal_submit_request", { p_company: CO, p_service: v("r-service"), p_title: v("r-title"), p_details: v("r-details"), p_quantity: v("r-qty"), p_needed_by: v("r-date") || null, p_name: v("r-name"), p_phone: v("r-phone"), p_business: v("r-biz") });
  if (error) { busy(b, false, "Send request"); n.textContent = authErr(error); return; }
  let failed = 0;
  for (const f of files) {
    const path = `${CO}/${me.id}/${r.id}/${Date.now()}-${f.name.replace(/[^\w.\-]+/g, "_")}`;
    const { error: upErr } = await sb.storage.from("customer-files").upload(path, f, { contentType: f.type || "application/octet-stream" });
    if (upErr) { failed++; continue; }
    await sb.from("customer_request_files").insert({ request_id: r.id, company_id: CO, name: f.name, file_path: path, size_bytes: f.size, mime: f.type, uploaded_by: me.id });
  }
  busy(b, false, "Send request"); $("#rf").reset();
  toast(`Request ${r.ref} sent${failed ? ` (${failed} file${failed > 1 ? "s" : ""} failed to upload)` : ""}`);
  await loadReqs(); openReq(r.id);
}
async function loadReqs() {
  const { data, error } = await sb.from("customer_requests").select("*").eq("company_id", CO).order("created_at", { ascending: false });
  reqs = data || []; const el = $("#reqs"); if (!el) return;
  if (error) { el.innerHTML = `<p class="note">${esc(error.message)}</p>`; return; }
  el.innerHTML = reqs.length ? reqs.map(r => `<button class="req" data-id="${r.id}"><span class="ref">${esc(r.ref)}</span><span><b>${esc(r.title)}</b><small>${esc(r.service || "")}${r.service ? " · " : ""}sent ${fmtDate(r.created_at)}</small></span><span class="pill ${r.status}">${STATUS[r.status] || r.status}</span></button>`).join("") : `<p class="muted">Nothing yet. Your first request will appear here.</p>`;
  $$(".req", el).forEach(x => x.onclick = () => openReq(x.dataset.id));
}
async function openReq(id) {
  const r = reqs.find(x => x.id === id); if (!r) return;
  const panel = $("#panel"), scrim = $("#scrim"); panel.hidden = scrim.hidden = false; panel.dataset.id = id;
  panel.innerHTML = `<div class="ph"><div><span class="pill ${r.status}">${STATUS[r.status] || r.status}</span><h3 style="margin-top:6px">${esc(r.title)}</h3><small class="muted">${esc(r.ref)} · sent ${fmtDate(r.created_at)}</small></div><button class="x" aria-label="Close">&times;</button></div>
    <div class="pb"><div class="kv">${r.service ? `<span>Service</span><span>${esc(r.service)}</span>` : ""}${r.quantity ? `<span>Quantity</span><span>${esc(r.quantity)}</span>` : ""}${r.needed_by ? `<span>Needed by</span><span>${fmtDate(r.needed_by)}</span>` : ""}${r.details ? `<span>Details</span><span style="white-space:pre-wrap">${esc(r.details)}</span>` : ""}</div>
    <div><b style="font-size:13px">Files</b><ul class="files" id="p-files"><li class="muted">Loading…</li></ul></div>
    <div><b style="font-size:13px">Messages</b><div class="msgs" id="p-msgs"><p class="muted">Loading…</p></div></div></div>
    <form class="pf" id="p-form"><div class="field"><textarea id="p-text" placeholder="Write to us about this request…"></textarea></div><div class="row"><span class="hint">We answer here and by email.</span><button class="btn primary small" id="p-send">Send</button></div></form>`;
  const close = () => { panel.hidden = scrim.hidden = true; panel.dataset.id = ""; };
  $(".x", panel).onclick = close; scrim.onclick = close;
  $("#p-form").onsubmit = async e => { e.preventDefault(); const t = $("#p-text").value.trim(); if (!t) return; busy($("#p-send"), true); const args = { p_op_id: crypto.randomUUID(), p_entity: "customer_request_messages", p_id: null, p_action: "insert", p_patch: { request_id: id, company_id: CO, author: "customer", author_name: me.user_metadata?.full_name || me.email, body: t } };
    let { data, error } = await sb.rpc("apply_op", args); if (error && !error.code) ({ data, error } = await sb.rpc("apply_op", args));   // one resend, same operation id: never a double message
    if (!error && data && !["applied", "duplicate"].includes(data.result)) error = { message: data.message || "Not sent" }; busy($("#p-send"), false, "Send"); if (error) return toast(authErr(error)); $("#p-text").value = ""; loadThread(id); };
  loadThread(id);
}
async function loadThread(id) {
  const [{ data: files }, { data: msgs }] = await Promise.all([
    sb.from("customer_request_files").select("*").eq("request_id", id).order("created_at"),
    sb.from("customer_request_messages").select("*").eq("request_id", id).order("created_at"),
  ]);
  const fl = $("#p-files"); if (fl) {
    if (!files?.length) fl.innerHTML = `<li class="muted">No files attached.</li>`;
    else { const rows = await Promise.all(files.map(async f => { const { data } = await sb.storage.from("customer-files").createSignedUrl(f.file_path, 3600); return `<li><a href="${esc(data?.signedUrl || "#")}" target="_blank" rel="noopener">${esc(f.name)}</a><span class="muted">${f.size_bytes ? Math.round(f.size_bytes / 1024) + " KB" : ""}</span></li>`; })); fl.innerHTML = rows.join(""); }
  }
  const ml = $("#p-msgs"); if (ml) ml.innerHTML = msgs?.length ? msgs.map(m => `<div class="msg ${m.author}">${esc(m.body)}<small>${esc(m.author === "staff" ? (m.author_name || pub?.name || "Staff") : "You")} · ${when(m.created_at)}</small></div>`).join("") : `<p class="muted">No messages yet. We will write here when your quote is ready.</p>`;
}

/* ---------- boot ---------- */
async function boot() {
  if (!CFG.supabaseUrl || !CFG.supabaseKey || !window.supabase) { $("#req-body").innerHTML = `<p class="note">This page is not configured.</p>`; return; }
  sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
  loadPublic();
  recovering = /type=recovery/.test(location.hash);
  sb.auth.onAuthStateChange((ev, sess) => {
    if (ev === "SIGNED_OUT") { me = null; paintAcct(); renderAuth("in"); }
    else if (ev === "PASSWORD_RECOVERY" && sess) { recovering = true; me = sess.user; paintAcct(); renderRecover(); }
    else if (ev === "SIGNED_IN" && sess && !recovering) { if (me?.id === sess.user.id) return; me = sess.user; if (/access_token|refresh_token|error=/.test(location.hash)) { try { history.replaceState(null, "", location.pathname + "#request"); } catch {} } paintAcct(); renderSigned(); subscribe(); }
  });
  const { data: { session } } = await sb.auth.getSession();
  me = session?.user || null; paintAcct();
  if (recovering && me) renderRecover(); else if (me) { renderSigned(); subscribe(); } else renderAuth("in");
}
function subscribe() {
  if (subscribe.done) return; subscribe.done = true;
  sb.channel("portal").on("postgres_changes", { event: "*", schema: "public", table: "customer_requests" }, () => { loadReqs(); })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "customer_request_messages" }, p => { const id = $("#panel").dataset.id; if (id && p.new?.request_id === id) loadThread(id); }).subscribe();
}
boot();
})();
