/**
 * Future Ready Hiring Desk: hourly job for the standalone (Supabase) build.
 *  A) pull new Google Form responses into the database
 *  B) mirror the database into this spreadsheet (one tab per role + Second Interview, Issues, Call Log, Sync Info)
 *
 * Install: open the "Future Ready Candidates" spreadsheet → Extensions → Apps Script → paste this file →
 * Project Settings → Script properties: SUPABASE_URL, SUPABASE_SERVICE_KEY (the service_role key, never the anon key) →
 * Triggers → add a time-driven trigger: runHourly, every hour. Run once by hand first and grant permissions.
 */
const PROPS = PropertiesService.getScriptProperties();
const URL_ = () => PROPS.getProperty("SUPABASE_URL");
const KEY_ = () => PROPS.getProperty("SUPABASE_SERVICE_KEY");
const SS = () => SpreadsheetApp.getActiveSpreadsheet();
const AVAIL = ["Immediately", "In one week", "Within a month", "Not available"];
const LOCS = ["Close to office", "Within Enugu", "Outside Enugu Town", "Other state", "Unknown"];

function runHourly() { const n = ingestFormResponses(); syncToSheet(n); }

/* ---------- Supabase REST helpers (service role; bypasses row-level security, so keep the key in script properties only) ---------- */
function sb(path, method, body, prefer) {
  const res = UrlFetchApp.fetch(URL_() + "/rest/v1/" + path, { method: method || "get", contentType: "application/json", muteHttpExceptions: true,
    headers: { apikey: KEY_(), Authorization: "Bearer " + KEY_(), Prefer: prefer || "return=representation" }, payload: body ? JSON.stringify(body) : undefined });
  if (res.getResponseCode() >= 300) throw new Error(path + " → " + res.getResponseCode() + " " + res.getContentText().slice(0, 300));
  const t = res.getContentText(); return t ? JSON.parse(t) : null;
}
const all = (table) => sb(table + "?select=*&limit=5000");

/* ---------- normalisation (same rules as the page) ---------- */
const STATE_MAP = [["jos","Plateau"],["plateau","Plateau"],["lagos","Lagos"],["ikeja","Lagos"],["surulere","Lagos"],["lekki","Lagos"],["ikorodu","Lagos"],["ekiti","Ekiti"],["ogun","Ogun"],["abeokuta","Ogun"],["edo","Edo"],["benin","Edo"],["port harcourt","Rivers"],["rivers","Rivers"],["warri","Delta"],["asaba","Delta"],["delta","Delta"],["abuja","FCT (Abuja)"],["fct","FCT (Abuja)"],["anambra","Anambra"],["awka","Anambra"],["onitsha","Anambra"],["nnewi","Anambra"],["ibadan","Oyo"],["oyo","Oyo"],["imo","Imo"],["owerri","Imo"],["akure","Ondo"],["ondo","Ondo"],["abia","Abia"],["aba","Abia"],["umuahia","Abia"],["ebonyi","Ebonyi"],["abakaliki","Ebonyi"],["kaduna","Kaduna"],["kano","Kano"],["uyo","Akwa Ibom"],["akwa ibom","Akwa Ibom"],["calabar","Cross River"],["cross river","Cross River"],["benue","Benue"],["makurdi","Benue"],["nsukka","Enugu"],["enugu","Enugu"]];
const CLOSE = ["ogui road","okpara avenue","obiagu","ogui","asata","uwani","new haven","coal camp","zik avenue"];
const IN_TOWN = ["achara layout","trans-ekulu","trans ekulu","independence layout","enugu south","enugu north","enugu east","abakpa","thinkers corner","gra","emene","nike lake","maryland","agbani road","ugwuaji","golf estate","new layout"];
function classify(addr) {
  if (!addr) return ["Unknown", ""]; const a = String(addr).toLowerCase(); let state = "";
  for (const [k, s] of STATE_MAP) if (a.indexOf(k) >= 0) { state = s; break; }
  if (state && state !== "Enugu") return ["Other state", state];
  if (CLOSE.some(k => a.indexOf(k) >= 0)) return ["Close to office", "Enugu"];
  if (IN_TOWN.some(k => a.indexOf(k) >= 0)) return ["Within Enugu", "Enugu"];
  if (/^enugu[\s,.]*(nigeria)?[\s.]*$/.test(a.trim())) return ["Within Enugu", "Enugu"];
  if (a.indexOf("enugu") >= 0) return ["Unknown", "Enugu"];
  return ["Unknown", state];
}
function normPhone(p) { let d = String(p || "").replace(/\D/g, ""); if (d.length === 13 && d.indexOf("234") === 0) d = "0" + d.slice(3); if (d.length === 10 && d[0] !== "0") d = "0" + d; return d; }
function fmt(ts) { try { return Utilities.formatDate(new Date(ts), "Africa/Lagos", "dd MMM yyyy HH:mm"); } catch (e) { return ts || ""; } }

/* ---------- A: form responses → candidates ---------- */
function ingestFormResponses() {
  const sheet = SS().getSheetByName("Form Responses 1"); if (!sheet) return 0;
  const rows = sheet.getDataRange().getValues(); if (rows.length < 2) return 0;
  const st = (sb("settings?id=eq.formIngest")[0] || { data: {} }).data || {}; const start = Number(st.lastRow || 0);
  const body = rows.slice(1); if (body.length <= start) return 0;
  const cands = all("candidates"), roles = all("roles");
  const byPhone = {}, byEmail = {}; cands.forEach(c => { const p = normPhone(c.phone), e = (c.email || "").toLowerCase(); if (p) (byPhone[p] = byPhone[p] || []).push(c); if (e) (byEmail[e] = byEmail[e] || []).push(c); });
  const roleByName = {}; roles.forEach(r => roleByName[r.name.toLowerCase()] = r.id);
  let processed = 0; const unmatched = (st.unmatched || []); const now = new Date().toISOString();
  body.slice(start).forEach(r => {
    const [ts, name, phone, email, roleAns, avail, addr, work, portfolio, more] = r;
    if (!ts) return;
    let ids = byPhone[normPhone(phone)] || byEmail[String(email || "").toLowerCase()] || [];
    const want = roleByName[String(roleAns || "").trim().toLowerCase()];
    if (ids.length > 1 && want) ids = ids.filter(c => c.role === want).length ? ids.filter(c => c.role === want) : ids;
    if (!ids.length) { unmatched.push({ timestamp: String(ts), name, phone: String(phone), email, role: roleAns, reason: "no candidate with this phone or email" }); return; }
    const c = ids[0];
    let av = AVAIL.find(a => a.toLowerCase() === String(avail || "").trim().toLowerCase()) || "";
    if (!av) { const s = String(avail || "").toLowerCase(); av = s.indexOf("immediate") >= 0 ? "Immediately" : s.indexOf("week") >= 0 ? "In one week" : s.indexOf("month") >= 0 ? "Within a month" : s.indexOf("not") >= 0 ? "Not available" : ""; }
    let [loc, state] = classify(addr); const w = String(work || "").toLowerCase(); let relocation = c.relocation || "";
    if (w.indexOf("yes, i live") === 0 || w.indexOf("live in enugu") >= 0) { relocation = "N/A"; state = state || "Enugu"; if (loc === "Unknown" || loc === "Other state") loc = "Within Enugu"; }
    else if (w.indexOf("relocate") >= 0) relocation = "Yes"; else if (w.indexOf("no") === 0) relocation = "No";
    const changes = []; if (av && av !== c.availability) changes.push("Availability: " + av); if (loc !== c.location) changes.push("Location: " + loc); if (relocation !== c.relocation) changes.push("Relocation: " + relocation); if (portfolio && portfolio !== c.portfolio) changes.push("Portfolio added");
    const note = "[Form " + String(ts) + "] lives at: " + addr + (more ? " | note: " + more : "");
    const patch = { status: "contacted", mode: "Form", availability: av || c.availability, location: loc, state: state || c.state, relocation, portfolio: portfolio || c.portfolio,
      notes: ((c.notes || "") + (c.notes ? "\n" : "") + note).slice(0, 2000), self_reported: true, form_response_at: now, form_role: roleAns, last_contact: now, last_by: "form",
      history: (c.history || []).concat([{ ts: now, by: "form", summary: "Candidate answered the form" + (changes.length ? ": " + changes.join(" · ") : "") }]).slice(-50) };
    if (want && want !== c.role) patch.notes += "\n[Form] said they applied for " + roleAns + ", but is listed under " + (roles.find(x => x.id === c.role) || {}).name;
    sb("candidates?id=eq." + encodeURIComponent(c.id), "patch", patch, "return=minimal"); processed++;
  });
  sb("settings?id=eq.formIngest", "patch", { data: { lastRow: body.length, lastRun: now, processed: Number(st.processed || 0) + processed, unmatched: unmatched.slice(-50) } }, "return=minimal");
  return processed;
}

/* ---------- B: database → sheet ---------- */
function compute(cands, roles, scoring) {
  const rmap = {}; roles.forEach(r => rmap[r.id] = r); const out = {};
  cands.forEach(c => { const r = rmap[c.role] || { qual_weight: 1, top: 10, second: 20 };
    const loc = scoring.location[c.location || "Unknown"] || 0, qual = (scoring.qualification[c.qualification || "Unknown"] || 0) * Number(r.qual_weight || 1);
    const pre = loc + qual + Number(c.adjust || 0), contacted = c.status === "contacted";
    const av = contacted ? (scoring.availability[c.availability] || 0) : 0, rp = c.relocation === "Yes" ? scoring.relocation : 0;
    const elig = c.manual === "Yes" ? true : c.manual === "No" ? false : contacted && AVAIL.slice(0, 3).indexOf(c.availability) >= 0 && (["Close to office", "Within Enugu"].indexOf(c.location) >= 0 || c.relocation === "Yes");
    out[c.id] = { loc, qual, pre, av, rp, elig, final: pre + av + rp }; });
  const order = roles.slice().sort((a, b) => (a.order || 99) - (b.order || 99)).map(r => r.id);
  order.forEach(rid => { const r = rmap[rid]; cands.filter(c => c.role === rid).sort((a, b) => out[b.id].pre - out[a.id].pre || a.sn - b.sn).forEach((c, i) => { out[c.id].rank = i + 1; out[c.id].tier = i + 1 <= r.top ? "Top 10" : i + 1 <= r.second ? "Second Tier" : "Others"; }); });
  cands.filter(c => out[c.id].elig).sort((a, b) => out[b.id].final - out[a.id].final || order.indexOf(a.role) - order.indexOf(b.role) || a.sn - b.sn).forEach((c, i) => out[c.id].combined = i + 1);
  return { out, order, rmap };
}
const STATUS = c => c.status === "contacted" ? "Contacted" : c.status === "attempted" ? "No answer" : (c.status === "awaiting" || c.last_email_status === "sent") ? "Awaiting reply" : "Not contacted";
function syncToSheet(processedThisRun) {
  const cands = all("candidates"), roles = all("roles"), issues = all("issues"), scoring = (sb("settings?id=eq.scoring")[0] || {}).data;
  const { out, order, rmap } = compute(cands, roles, scoring); const ss = SS();
  const HEAD = ["S/N","Full Name","Phone","Email","Address (register)","Qualification","Location","State","Status","Attempts","Mode","Availability","Can relocate","Shortlist override","Adjust","Portfolio","Next action","Notes","Last update","Location pts","Qualification pts","Pre-call score","Pre-call rank","Tier","Availability pts","Relocation pts","Final score","Eligible","Combined rank"];
  const row = c => { const o = out[c.id]; return [c.sn, c.name, "'" + c.phone, c.email, c.address, c.qualification, c.location, c.state, STATUS(c), c.attempts || 0, c.mode, c.availability, c.relocation, c.manual, Number(c.adjust || 0), c.portfolio || "", c.next_action, c.notes, fmt(c.last_contact), o.loc, o.qual, o.pre, o.rank, o.tier, o.av, o.rp, o.final, o.elig ? "Yes" : "No", o.combined || ""]; };
  const writeTab = (name, head, rows, after) => { let sh = ss.getSheetByName(name); if (!sh) { sh = ss.insertSheet(name, after); sh.setFrozenRows(1); sh.getRange(1, 1, 1, head.length).setValues([head]).setBackground("#101828").setFontColor("#ffffff").setFontWeight("bold"); }
    const last = sh.getLastRow(); if (last > 1) sh.getRange(2, 1, last - 1, Math.max(head.length, sh.getLastColumn())).clearContent(); if (rows.length) sh.getRange(2, 1, rows.length, head.length).setValues(rows); };
  let idx = Math.max(1, (ss.getSheetByName("How this works") || { getIndex: () => 1 }).getIndex());
  order.forEach(rid => { const name = rmap[rid].name.replace(/[\[\]:*?\/\\]/g, " ").slice(0, 31); writeTab(name, HEAD, cands.filter(c => c.role === rid).sort((a, b) => out[a.id].rank - out[b.id].rank).map(row), idx++); });
  const si = cands.filter(c => out[c.id].elig).sort((a, b) => out[a.id].combined - out[b.id].combined);
  const crit = c => { const o = out[c.id], k = []; if (["Close to office", "Within Enugu"].indexOf(c.location) >= 0) k.push(c.location); else if (c.relocation === "Yes") k.push("Will relocate from " + (c.state || "another state")); if (c.availability) k.push(c.availability); if (c.qualification && c.qualification !== "Unknown") k.push(c.qualification); if (c.manual === "Yes") k.push("Manually shortlisted"); return k.join(" | "); };
  writeTab("Second Interview", ["Rank","Full Name","Role","Phone","Email","Location","State","Qualification","Availability","Can relocate","Final score","Criteria met","Notes"], si.map(c => [out[c.id].combined, c.name, rmap[c.role].name, "'" + c.phone, c.email, c.location, c.state, c.qualification, c.availability, c.relocation, out[c.id].final, crit(c), c.notes]));
  writeTab("Issues", ["Full Name","Role","Issue","Detail","Action required","Resolved","Resolution","Resolved at"], issues.sort((a, b) => (a.resolved - b.resolved) || a.name.localeCompare(b.name)).map(i => [i.name, i.role, i.issue, i.detail, i.action, i.resolved ? "Yes" : "No", i.resolution || "", fmt(i.resolved_at)]));
  const log = []; cands.forEach(c => (c.history || []).forEach(h => log.push([h.ts, c.name, rmap[c.role].name, h.summary]))); log.sort((a, b) => b[0] < a[0] ? -1 : 1);
  writeTab("Call Log", ["When","Candidate","Role","What changed"], log.map(l => [fmt(l[0]), l[1], l[2], l[3]]));
  writeTab("Sync Info", ["Item","Value"], [["Last synced (Lagos time)", fmt(new Date())], ["Source", "Future Ready Hiring Desk (Supabase)"], ["Candidates", cands.length], ["Roles", order.map(r => rmap[r].name).join(", ")], ["Contacted", cands.filter(c => c.status === "contacted").length], ["Eligible for second interview", si.length], ["Open issues", issues.filter(i => !i.resolved).length], ["Form responses processed this run", processedThisRun || 0], ["Note", "One-way hourly copy. Edits here are overwritten. Log calls on the Hiring Desk."]]);
}
