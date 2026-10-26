/**
 * Future Ready Backups — standalone Google Apps Script, owned by the dedicated backup Google account.
 * NOT the Hiring Sheet script (Code.gs); that one keeps running unchanged.
 *
 * What it does
 *   every 6 hours  → database/rolling/future-ready-db-<UTC stamp>.json        kept 7 days
 *   every night    → database/nightly/future-ready-db-<UTC stamp>.json        kept 90 days
 *                    + refreshes the protected "Future Ready Backups" spreadsheet (latest readable snapshot)
 *   last day of a month (any successful run) → database/monthly/future-ready-db-monthly-YYYY-MM.json   kept 24 months
 *   every run      → a row in Supabase sync_runs, a row in the spreadsheet's "Backup log" tab
 *   on failure     → a report in backup-reports/, an email to ALERT_EMAILS, the failure queued for sync_runs
 *                    if Supabase itself could not be reached; old files are never pruned after a failed run
 *
 * Script properties (Project Settings → Script properties) — values never appear in code or logs:
 *   SUPABASE_URL          https://<project>.supabase.co
 *   SUPABASE_SERVICE_KEY  the Supabase secret (service role) key
 *   ALERT_EMAILS          comma-separated addresses that get failure / recovery emails
 * Set Project Settings → Time zone to (GMT+01:00) Lagos. Run setup() once; it creates the folders, the spreadsheet and the triggers.
 */

const BACKUP_FORMAT = "future-ready-backup/1";
const ROOT_NAME = "Future Ready Backups";
const RETAIN_DAYS = { rolling: 7, nightly: 90, monthly: 731 };
const STALE_HOURS = 8;   // a warning is emailed when the newest successful database backup is older than this

// Readable Sheet: whole tables left out, and columns left out of tables that are included.
// The restricted JSON in Drive keeps these (it is what a restore needs); the Sheet is for reading, so it does not.
const SHEET_SKIP_TABLES = ["app_config", "member_invites", "counters", "staff_private", "op_receipts"];   // secrets, numbering state, private staff details
const SHEET_SKIP_COLUMNS = {
  staff: ["phone", "email", "address", "date_of_birth", "emergency_name", "emergency_phone", "notes", "photo_url", "history"],
  members: ["phone", "photo_url", "user_id"],
  portal_profiles: ["phone", "user_id"],
  staff_documents: ["file_path", "note"],
  leave_requests: ["reason", "decision_note"],
  candidates: ["history"],
  press_jobs: ["history"],
  customer_requests: ["user_id"],
};
const CELL_MAX = 45000;   // Sheets refuses cells over 50,000 characters

/* ---------------- entry points (triggers call these) ---------------- */
function runRolling() { return runBackup_("rolling"); }
function runNightly() { return runBackup_("nightly"); }
/** Run by hand from the editor to take a backup now (kept with the rolling ones). */
function backupNow() { return runBackup_("manual"); }

/* ---------------- setup ---------------- */
function setup() {
  const p = props_();
  ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "ALERT_EMAILS"].forEach(k => { if (!p.getProperty(k)) throw new Error("Script property " + k + " is missing. Add it under Project Settings → Script properties."); });
  const tz = Session.getScriptTimeZone();
  if (tz !== "Africa/Lagos") Logger.log("Warning: script time zone is " + tz + ". Set it to Lagos in Project Settings so the nightly run happens at 02:00 Lagos time.");
  const root = folder_(null, ROOT_NAME);
  const db = folder_(root, "database");
  ["rolling", "nightly", "monthly"].forEach(n => folder_(db, n));
  const files = folder_(root, "files"); folder_(files, "press"); folder_(files, "customer-portal");
  folder_(root, "restore-tests"); folder_(root, "backup-reports");
  let ssId = p.getProperty("BACKUP_SHEET_ID"), ss = null;
  if (ssId) { try { ss = SpreadsheetApp.openById(ssId); } catch (e) { ss = null; } }
  if (!ss) { ss = SpreadsheetApp.create(ROOT_NAME); DriveApp.getFileById(ss.getId()).moveTo(root); }
  const blank = ss.getSheetByName("Sheet1"); if (blank && ss.getSheets().length > 1) ss.deleteSheet(blank);
  p.setProperty("BACKUP_ROOT_ID", root.getId()); p.setProperty("BACKUP_SHEET_ID", ss.getId());
  // triggers: replace ours, leave anything else alone
  ScriptApp.getProjectTriggers().filter(t => ["runRolling", "runNightly"].indexOf(t.getHandlerFunction()) >= 0).forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("runRolling").timeBased().everyHours(6).create();
  ScriptApp.newTrigger("runNightly").timeBased().atHour(2).nearMinute(0).everyDays(1).create();
  // record where the backups live (non-secret) so the app and the runbook can point to them
  const owner = Session.getEffectiveUser().getEmail();
  try {
    sb_("app_config?on_conflict=key", "post", [
      { key: "backup_drive_folder_id", value: root.getId() },
      { key: "backup_sheet_id", value: ss.getId() },
      { key: "backup_account", value: owner },
      { key: "backup_registered_at", value: new Date().toISOString() },
    ], "resolution=merge-duplicates,return=minimal");
  } catch (e) { Logger.log("Could not record the backup location in Supabase yet: " + e.message); }
  const first = runBackup_("nightly");
  Logger.log("Setup complete. Owner: " + owner + ". Folder: " + root.getUrl() + " Spreadsheet: " + ss.getUrl() + ". First backup: " + (first.ok ? "OK, " + first.fileName : "FAILED, " + first.error));
  return { root: root.getId(), sheet: ss.getId(), owner: owner, first: first };
}

/** Shows the state of things in the log; changes nothing. */
function status() {
  const p = props_();
  Logger.log("Owner: " + Session.getEffectiveUser().getEmail() + " · time zone " + Session.getScriptTimeZone());
  Logger.log("Triggers: " + ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction()).join(", "));
  Logger.log("Last success: " + (p.getProperty("LAST_SUCCESS_AT") || "never") + " · queued failures: " + JSON.parse(p.getProperty("PENDING_RUNS") || "[]").length);
  Logger.log("Emails left today: " + MailApp.getRemainingDailyQuota());
}

/* ---------------- the run ---------------- */
function runBackup_(kind) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, error: "another backup is still running" };
  const p = props_(), started = new Date(), stamp = utcStamp_(started);
  const run = { kind: kind, scheduled_for: started.toISOString(), started_at: started.toISOString(), status: "running", source: "apps-script" };
  let runId = null, supabaseUp = true, result;
  try {
    try { runId = insertRun_(run); } catch (e) { supabaseUp = false; throw new Error("Supabase unreachable: " + e.message); }
    try { flushPending_(); } catch (e) { /* stays queued; retried next run */ }
    // 1. export
    let exp;
    try { exp = sb_("rpc/backup_export", "post", {}); } catch (e) { supabaseUp = false; throw new Error("Export failed: " + e.message); }
    if (!exp || exp.format !== "future-ready-db/1" || !exp.tables) throw new Error("Export returned an unexpected shape");
    // 2. verify counts before writing anything
    const tables = Object.keys(exp.tables).sort();
    const bad = tables.filter(t => (exp.tables[t] || []).length !== exp.row_counts[t]);
    if (bad.length) throw new Error("Row counts do not match for: " + bad.join(", "));
    // 3. envelope with metadata + checksum of the data part
    const dataJson = JSON.stringify(exp.tables);
    const checksum = sha256_(dataJson);
    const fileName = "future-ready-db-" + stamp + ".json";
    const envelope = {
      backup_format: BACKUP_FORMAT, kind: kind, status: "complete",
      generated_at: exp.generated_at, written_at: new Date().toISOString(), project: exp.project,
      schema_version: exp.schema_version, export_format: exp.format,
      table_list: tables, row_counts: exp.row_counts, total_rows: exp.total_rows,
      checksum_sha256: checksum, checksum_of: "JSON.stringify(tables)",
      tables: exp.tables, auth_users: exp.auth_users, storage_objects: exp.storage_objects,
    };
    const body = JSON.stringify(envelope);
    // 4. write to Drive, then read back and check
    const folderName = kind === "nightly" ? "nightly" : "rolling";
    const target = dbFolder_(folderName);
    const file = target.createFile(fileName, body, "application/json");
    const back = JSON.parse(file.getBlob().getDataAsString());
    if (sha256_(JSON.stringify(back.tables)) !== checksum) throw new Error("Read-back checksum mismatch for " + fileName);
    // 5. month-end copy (any successful run on the last day of the month; the latest one that day wins)
    let monthly = null;
    if (isLastDayOfMonth_(started)) monthly = writeMonthly_(started, body);
    // 6. readable Sheet (nightly only; a Sheet problem does not fail the database backup)
    let sheetError = null;
    if (kind === "nightly") { try { refreshSheet_(envelope, fileName); } catch (e) { sheetError = e.message; } }
    // 7. retention, only after a verified success
    const pruned = prune_();
    result = { ok: true, fileName: fileName, fileId: file.getId(), checksum: checksum, rows: exp.total_rows, tables: tables.length, bytes: body.length, monthly: monthly, pruned: pruned, sheetError: sheetError };
    updateRun_(runId, { status: "success", finished_at: new Date().toISOString(), tables: tables.length, rows: exp.total_rows, bytes: body.length, file_name: fileName, drive_file_id: file.getId(), checksum: checksum, schema_version: exp.schema_version, format: BACKUP_FORMAT, error: sheetError ? "Sheet refresh failed: " + sheetError : null, details: { monthly: monthly, pruned: pruned, row_counts: exp.row_counts,
      destination: { drive_path: "Future Ready Backups/database/" + folderName, file_name: fileName, file_id: file.getId(), spreadsheet_refreshed: kind === "nightly" && !sheetError } } });
    try { logSheet_([new Date(), kind, "success", fileName, tables.length, exp.total_rows, sheetError || ""]); } catch (e) { /* the log tab is a convenience; sync_runs is the record */ }
    const wasFailing = p.getProperty("FAILING_SINCE");
    p.setProperty("LAST_SUCCESS_AT", new Date().toISOString()); p.deleteProperty("FAILING_SINCE");
    if (wasFailing) alert_("Future Ready backups recovered", "Backups are working again.\n\nFailing since: " + wasFailing + "\nRecovered with: " + fileName + " (" + exp.total_rows + " rows in " + tables.length + " tables).");
    if (sheetError) alert_("Future Ready backup: spreadsheet refresh failed", "The database backup " + fileName + " was written and verified, but the readable spreadsheet could not be refreshed.\n\nError: " + sheetError);
  } catch (e) {
    const msg = String(e && e.message || e);
    result = { ok: false, error: msg };
    const failure = { kind: kind, scheduled_for: run.scheduled_for, started_at: run.started_at, finished_at: new Date().toISOString(), status: "failed", error: msg.slice(0, 2000), source: "apps-script" };
    let recorded = false;
    if (runId) { try { updateRun_(runId, failure); recorded = true; } catch (e2) { /* fall through to the queue */ } }
    if (!recorded) queuePending_(failure);
    try { report_(stamp, kind, msg); } catch (e3) { /* Drive itself may be the problem */ }
    try { logSheet_([new Date(), kind, "FAILED", "", "", "", msg]); } catch (e4) { }
    if (!p.getProperty("FAILING_SINCE")) p.setProperty("FAILING_SINCE", new Date().toISOString());
    const last = p.getProperty("LAST_SUCCESS_AT");
    alert_("Future Ready backup FAILED (" + kind + ")", "The " + kind + " backup did not complete. Nothing old was deleted.\n\nError: " + msg + "\n\nLast successful backup: " + (last || "never") +
      (last && (Date.now() - Date.parse(last)) / 36e5 > STALE_HOURS ? "\nWARNING: the newest good backup is more than " + STALE_HOURS + " hours old." : "") +
      "\n\n" + (recorded ? "The failure is recorded in the system." : "Supabase could not be reached; the failure will be recorded there when it is back.") + "\nRunbook: README → Backups.");
  } finally { lock.releaseLock(); }
  return result;
}

/* ---------------- Supabase ---------------- */
function props_() { return PropertiesService.getScriptProperties(); }
function sb_(path, method, body, prefer) {
  const p = props_(), url = String(p.getProperty("SUPABASE_URL") || "").replace(/\/$/, ""), key = p.getProperty("SUPABASE_SERVICE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL or SUPABASE_SERVICE_KEY script property is missing");
  const res = UrlFetchApp.fetch(url + "/rest/v1/" + path, { method: method || "get", contentType: "application/json", muteHttpExceptions: true,
    headers: { apikey: key, Authorization: "Bearer " + key, Prefer: prefer || "return=representation" }, payload: body !== undefined ? JSON.stringify(body) : undefined });
  const code = res.getResponseCode(), text = res.getContentText();
  if (code >= 300) throw new Error(path.split("?")[0] + " answered " + code + ": " + text.slice(0, 300));
  return text ? JSON.parse(text) : null;
}
function insertRun_(run) { const r = sb_("sync_runs", "post", run); return r && r[0] && r[0].id; }
function updateRun_(id, patch) { if (!id) return; sb_("sync_runs?id=eq." + encodeURIComponent(id), "patch", patch, "return=minimal"); }
function queuePending_(failure) { const p = props_(), q = JSON.parse(p.getProperty("PENDING_RUNS") || "[]"); q.push(failure); p.setProperty("PENDING_RUNS", JSON.stringify(q.slice(-50))); }
function flushPending_() {
  const p = props_(), q = JSON.parse(p.getProperty("PENDING_RUNS") || "[]"); if (!q.length) return 0;
  sb_("sync_runs", "post", q, "return=minimal"); p.deleteProperty("PENDING_RUNS"); return q.length;
}

/* ---------------- Drive ---------------- */
function root_() { const id = props_().getProperty("BACKUP_ROOT_ID"); if (!id) throw new Error("Run setup() first"); return DriveApp.getFolderById(id); }
function folder_(parent, name) {
  const it = parent ? parent.getFoldersByName(name) : DriveApp.getRootFolder().getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent ? parent.createFolder(name) : DriveApp.createFolder(name);
}
function dbFolder_(name) { return folder_(folder_(root_(), "database"), name); }
function writeMonthly_(d, body) {
  const name = "future-ready-db-monthly-" + Utilities.formatDate(d, "Africa/Lagos", "yyyy-MM") + ".json";
  const f = dbFolder_("monthly"), old = f.getFilesByName(name);
  while (old.hasNext()) old.next().setTrashed(true);
  f.createFile(name, body, "application/json");
  return name;
}
function prune_() {
  const out = {}, now = Date.now();
  Object.keys(RETAIN_DAYS).forEach(k => {
    const f = dbFolder_(k), it = f.getFiles(), files = [];
    while (it.hasNext()) files.push(it.next());
    files.sort((a, b) => b.getDateCreated() - a.getDateCreated());
    let n = 0;
    files.forEach((file, i) => { if (i > 0 && (now - file.getDateCreated().getTime()) / 864e5 > RETAIN_DAYS[k]) { file.setTrashed(true); n++; } });   // never trash the newest
    out[k] = n;
  });
  return out;
}
function report_(stamp, kind, msg) {
  folder_(root_(), "backup-reports").createFile("backup-FAILED-" + kind + "-" + stamp + ".txt",
    "Future Ready backup failure\nKind: " + kind + "\nAt (UTC): " + stamp + "\nError: " + msg + "\nLast success: " + (props_().getProperty("LAST_SUCCESS_AT") || "never") + "\n", "text/plain");
}

/* ---------------- readable spreadsheet ---------------- */
function refreshSheet_(env, fileName) {
  const ss = SpreadsheetApp.openById(props_().getProperty("BACKUP_SHEET_ID"));
  const about = tab_(ss, "About", 0);
  about.clear();
  const aboutRows = [["Future Ready Backups: latest readable snapshot", ""], ["This is a copy. The live system of record is Supabase. Do not edit; changes here are overwritten and never reach the system.", ""],
    ["Snapshot taken (UTC)", env.generated_at], ["Source file in Drive", fileName], ["Checksum (SHA-256)", env.checksum_sha256], ["Schema version", env.schema_version], ["Total rows", env.total_rows], ["", ""], ["Table", "Rows"]]
    .concat(env.table_list.map(t => [t, env.row_counts[t]]));
  about.getRange(1, 1, aboutRows.length, 2).setValues(aboutRows);
  env.table_list.filter(t => SHEET_SKIP_TABLES.indexOf(t) < 0).forEach(t => {
    const rows = env.tables[t] || [], skip = SHEET_SKIP_COLUMNS[t] || [];
    const cols = []; rows.forEach(r => Object.keys(r).forEach(k => { if (skip.indexOf(k) < 0 && cols.indexOf(k) < 0) cols.push(k); }));
    const sh = tab_(ss, t);
    sh.clear();
    if (!rows.length) { sh.getRange(1, 1).setValue("No rows in this table at " + env.generated_at); return; }
    const values = [cols].concat(rows.map(r => cols.map(c => cell_(r[c]))));
    sh.getRange(1, 1, values.length, cols.length).setValues(values);
    sh.setFrozenRows(1);
  });
  const blank = ss.getSheetByName("Sheet1"); if (blank && ss.getSheets().length > 1) ss.deleteSheet(blank);
  // read-only for everyone but the owner of the backup account
  ss.getSheets().forEach(sh => {
    const existing = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    const pr = existing.length ? existing[0] : sh.protect();
    pr.setDescription("Backup copy: read only");
    const editors = pr.getEditors().filter(u => u.getEmail() !== Session.getEffectiveUser().getEmail());
    if (editors.length) pr.removeEditors(editors);
    if (pr.canDomainEdit()) pr.setDomainEdit(false);
  });
}
function tab_(ss, name, index) { let sh = ss.getSheetByName(name); if (!sh) sh = index === 0 ? ss.insertSheet(name, 0) : ss.insertSheet(name); return sh; }
function cell_(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") v = JSON.stringify(v);
  if (typeof v === "string") { if (/^[=+\-@]/.test(v)) v = "'" + v; if (v.length > CELL_MAX) v = v.slice(0, CELL_MAX) + "…[cut: see the JSON backup]"; }
  return v;
}
function logSheet_(row) {
  const id = props_().getProperty("BACKUP_SHEET_ID"); if (!id) return;
  const sh = tab_(SpreadsheetApp.openById(id), "Backup log");
  if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, 7).setValues([["When", "Kind", "Result", "File", "Tables", "Rows", "Error"]]);
  sh.appendRow(row);
}

/* ---------------- helpers ---------------- */
function alert_(subject, text) {
  const to = String(props_().getProperty("ALERT_EMAILS") || "").split(",").map(s => s.trim()).filter(Boolean);
  if (!to.length || MailApp.getRemainingDailyQuota() < to.length) return false;
  MailApp.sendEmail(to.join(","), subject, text + "\n\n— Future Ready backup job (" + Session.getEffectiveUser().getEmail() + ")");
  return true;
}
function sha256_(s) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8).map(b => ((b + 256) % 256).toString(16).padStart(2, "0")).join(""); }
function utcStamp_(d) { return Utilities.formatDate(d, "UTC", "yyyy-MM-dd'T'HHmmss'Z'"); }
function isLastDayOfMonth_(d) {
  const today = Number(Utilities.formatDate(d, "Africa/Lagos", "d"));
  const tomorrow = Number(Utilities.formatDate(new Date(d.getTime() + 864e5), "Africa/Lagos", "d"));
  return tomorrow < today;
}
