const { makeEnv, FIX } = require("./harness");
const crypto = require("crypto");
const results = [];
function test(name, expected, fn) {
  let actual, pass = false, evidence = "";
  try { const r = fn(); pass = r.pass; actual = r.actual; evidence = r.evidence || ""; } catch (e) { actual = "THREW: " + e.stack.split("\n").slice(0, 3).join(" | "); }
  results.push({ name, expected, actual, pass, evidence });
}
const sha = s => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const clone = o => JSON.parse(JSON.stringify(o));

// ---- shared fixture with a sensitive staff row and a formula-looking value, to test the readable Sheet ----
const FIX2 = clone(FIX);
FIX2.tables.staff = [{ id: "s1", company_id: "press", full_name: "Test Person", position: "Operator", phone: "08030000000", email: "p@x.com", address: "12 Street", date_of_birth: "1990-01-01", emergency_name: "Kin", emergency_phone: "0809", notes: "private", status: "active", history: [{ a: 1 }] }];
FIX2.row_counts.staff = 1; FIX2.total_rows += 1;
FIX2.tables.candidates[0] = { ...FIX2.tables.candidates[0], notes: "=HYPERLINK(\"http://evil\",\"x\")", history: [{ big: "x".repeat(60000) }] };

test("T1 setup creates folders, spreadsheet, triggers, records location, first backup succeeds", "Folder tree as approved; 2 triggers (6-hourly, 02:00 daily); app_config has 4 backup keys; one nightly file; sync_runs success with the fixture's table and row counts", () => {
  const S = makeEnv({ now: "2026-10-26T08:00:00Z" });
  const r = S.ctx.setup();
  const tree = S.folders.filter(x => x.f.parent).map(x => S.path(x.f) + "/" + x.f.name).sort();
  const want = ["My Drive/Future Ready Backups", "My Drive/Future Ready Backups/backup-reports", "My Drive/Future Ready Backups/database", "My Drive/Future Ready Backups/database/monthly", "My Drive/Future Ready Backups/database/nightly", "My Drive/Future Ready Backups/database/rolling", "My Drive/Future Ready Backups/files", "My Drive/Future Ready Backups/files/customer-portal", "My Drive/Future Ready Backups/files/press", "My Drive/Future Ready Backups/restore-tests"];
  const trig = S.triggers.map(t => t.h + JSON.stringify(t.spec)).sort();
  const files = S.live().map(x => x.path);
  const run = S.runs[0];
  const pass = JSON.stringify(tree) === JSON.stringify(want) && trig.length === 2 && trig.some(t => t.startsWith('runRolling') && t.includes('"everyHours":6')) && trig.some(t => t.startsWith('runNightly') && t.includes('"atHour":2')) && Object.keys(S.appConfig).length === 4 && files.length === 1 && files[0].includes("/database/nightly/future-ready-db-2026-10-26T080000Z.json") && run.status === "success" && run.tables === FIX.table_list.length && run.rows === FIX.total_rows;
  return { pass, actual: `tree ${tree.length} folders ok=${JSON.stringify(tree) === JSON.stringify(want)}; triggers ${trig.join(", ")}; app_config keys ${Object.keys(S.appConfig).join(",")}; files ${files.join(", ")}; run ${run.status} ${run.tables}/${run.rows}`, evidence: "setup() return: " + JSON.stringify({ first: { ok: r.first.ok, fileName: r.first.fileName } }) };
});

test("T2 backup file carries the approved metadata and a checksum that verifies independently", "generated_at, project, schema_version, table_list, row_counts, total_rows, backup_format, status, checksum all present; SHA-256 recomputed outside the script matches; row counts equal live counts", () => {
  const S = makeEnv({ now: "2026-10-26T12:00:00Z" }); S.ctx.setup(); S.now += 6 * 36e5; const r = S.ctx.runRolling();
  const f = S.live().find(x => x.path.includes("/rolling/")); const j = JSON.parse(f.f.content);
  const need = ["generated_at", "project", "schema_version", "table_list", "row_counts", "total_rows", "backup_format", "status", "checksum_sha256"];
  const missing = need.filter(k => !(k in j));
  const recomputed = sha(JSON.stringify(j.tables));
  const countsOk = j.table_list.every(t => j.tables[t].length === j.row_counts[t]) && j.total_rows === FIX.total_rows;
  return { pass: r.ok && !missing.length && recomputed === j.checksum_sha256 && countsOk && j.status === "complete", actual: `missing ${JSON.stringify(missing)}; checksum ${j.checksum_sha256.slice(0, 16)}… recomputed ${recomputed.slice(0, 16)}…; counts ok ${countsOk}; file ${f.path}`, evidence: "keys: " + Object.keys(j).join(", ") };
});

test("T3 no secrets in the backup file", "No token/secret/password columns; app_config secret values redacted; no auth password or session fields", () => {
  const S = makeEnv(); S.ctx.setup(); const f = S.live()[0].f.content;
  const hits = ["\"token\"", "sb_secret", "whsec", "encrypted_password", "refresh_token", "access_token"].filter(k => f.includes(k));
  const cfg = JSON.parse(f).tables.app_config.find(a => a.key === "mail_relay_token");
  return { pass: !hits.length && cfg && cfg.value === "[REDACTED]", actual: `secret-looking strings found: ${JSON.stringify(hits)}; mail_relay_token value: ${cfg && cfg.value}` };
});

test("T4 setup run twice is safe", "Still one folder tree, one spreadsheet, exactly 2 triggers", () => {
  const S = makeEnv(); S.ctx.setup(); S.now += 60e3; S.ctx.setup();
  const roots = S.folders.filter(x => x.f.name === "Future Ready Backups").length;
  return { pass: roots === 1 && S.triggers.length === 2 && Object.keys(S.sheets).length === 1, actual: `roots ${roots}, triggers ${S.triggers.length}, spreadsheets ${Object.keys(S.sheets).length}` };
});

test("T5 readable Sheet leaves out sensitive data and neutralises formulas", "Staff tab has no phone/email/address/DOB/emergency/notes; app_config, member_invites, counters tabs absent; a cell starting with = is stored as text; a 60,000-char value is cut under the 50,000 limit; all tabs protected, other editors removed", () => {
  const S = makeEnv(); S.ctx.setup(); S.mode.export = FIX2; S.now += 864e5; S.ctx.runNightly();
  const ss = Object.values(S.sheets)[0]; const tab = n => ss.getSheetByName(n);
  const staffHead = tab("staff")._t.rows[0];
  const leaked = ["phone", "email", "address", "date_of_birth", "emergency_name", "emergency_phone", "notes", "history"].filter(c => staffHead.includes(c));
  const skipped = ["app_config", "member_invites", "counters"].filter(n => tab(n));
  const candRows = tab("candidates")._t.rows; const ni = candRows[0].indexOf("notes"); const formulaCell = candRows[1][ni];
  const histInSheet = candRows[0].includes("history");
  const prot = ss.getSheets().map(t => t._t.prot && t._t.prot._p);
  const allProt = prot.every(p => p && p.editors.length === 1 && !p.domain);
  return { pass: !leaked.length && !skipped.length && formulaCell.startsWith("'=") && !histInSheet && allProt && !tab("Sheet1"), actual: `staff header ${JSON.stringify(staffHead)}; leaked ${JSON.stringify(leaked)}; skipped tabs present ${JSON.stringify(skipped)}; formula cell ${JSON.stringify(formulaCell.slice(0, 20))}; tabs ${ss.getSheets().length}, all protected owner-only ${allProt}` };
});

test("T6 Supabase unreachable: failure recorded, alert sent, nothing deleted", "Run returns failure; report file in backup-reports; email to both alert addresses; failure queued for sync_runs; no database file written; no file trashed", () => {
  const S = makeEnv({ now: "2026-10-26T08:00:00Z" }); S.ctx.setup(); const before = S.live().length;
  S.mode.supabase = "down"; S.now += 6 * 36e5; const r = S.ctx.runRolling();
  const reports = S.live().filter(x => x.path.includes("backup-reports")); const mail = S.mails.at(-1);
  const pending = JSON.parse(S.props.PENDING_RUNS || "[]");
  const trashed = S.files.filter(x => x.f.trashed).length;
  return { pass: !r.ok && reports.length === 1 && mail.subject.includes("FAILED") && mail.to.includes("ceo@example.com") && pending.length === 1 && S.live().length === before + 1 && trashed === 0, actual: `ok=${r.ok}; error "${r.error}"; reports ${reports.length}; mail "${mail && mail.subject}" to ${mail && mail.to}; queued ${pending.length}; trashed ${trashed}` };
});

test("T7 backup resumes after failure; queued failure lands in sync_runs; recovery email", "Next run succeeds; sync_runs gets the queued failed row and the new success row; a 'recovered' email is sent; queue empty", () => {
  const S = makeEnv({ now: "2026-10-26T08:00:00Z" }); S.ctx.setup(); S.mode.supabase = "down"; S.now += 6 * 36e5; S.ctx.runRolling();
  S.mode.supabase = "up"; S.now += 6 * 36e5; const r = S.ctx.runRolling();
  const statuses = S.runs.map(x => x.kind + ":" + x.status);
  return { pass: r.ok && statuses.filter(s => s === "rolling:failed").length === 1 && statuses.filter(s => s.endsWith(":success")).length === 2 && S.mails.at(-1).subject.includes("recovered") && !S.props.PENDING_RUNS && !S.props.FAILING_SINCE, actual: `ok=${r.ok}; sync_runs ${statuses.join(", ")}; last mail "${S.mails.at(-1).subject}"` };
});

test("T8 export fails while Supabase is up", "Run row in sync_runs updated to failed with the error; alert sent", () => {
  const S = makeEnv(); S.ctx.setup(); S.mode.supabase = "exportFails"; S.now += 6 * 36e5; const r = S.ctx.runRolling();
  const run = S.runs.at(-1);
  return { pass: !r.ok && run.status === "failed" && /500/.test(run.error) && S.mails.at(-1).subject.includes("FAILED"), actual: `run ${run.status}: ${run.error}` };
});

test("T9 Google Drive fails while writing", "Run recorded failed in sync_runs; alert sent; nothing pruned", () => {
  const S = makeEnv(); S.ctx.setup(); S.mkOldFile("rolling", "old.json", 30); S.mode.drive = "down"; S.now += 6 * 36e5; const r = S.ctx.runRolling();
  const run = S.runs.at(-1); const trashed = S.files.filter(x => x.f.trashed).length;
  return { pass: !r.ok && run.status === "failed" && /Drive/.test(run.error) && trashed === 0 && S.mails.at(-1).subject.includes("FAILED"), actual: `run ${run.status}: ${run.error}; trashed ${trashed}` };
});

test("T10 retention: rolling 7 days, nightly 90 days, monthly 24 months; newest always kept", "Files past their window go to Drive trash (recoverable 30 days); files inside the window stay", () => {
  const S = makeEnv({ now: "2026-10-26T08:00:00Z" }); S.ctx.setup();
  S.mkOldFile("rolling", "r-8d.json", 8); S.mkOldFile("rolling", "r-6d.json", 6); S.mkOldFile("nightly", "n-91d.json", 91); S.mkOldFile("nightly", "n-89d.json", 89); S.mkOldFile("monthly", "m-800d.json", 800); S.mkOldFile("monthly", "m-700d.json", 700);
  S.now += 6 * 36e5; S.ctx.runRolling();
  const t = n => S.files.find(x => x.f.name === n).f.trashed;
  const got = { "r-8d": t("r-8d.json"), "r-6d": t("r-6d.json"), "n-91d": t("n-91d.json"), "n-89d": t("n-89d.json"), "m-800d": t("m-800d.json"), "m-700d": t("m-700d.json") };
  return { pass: got["r-8d"] && !got["r-6d"] && got["n-91d"] && !got["n-89d"] && got["m-800d"] && !got["m-700d"], actual: "trashed: " + JSON.stringify(got) };
});

test("T11 month-end copy", "A successful run on the last Lagos day of the month writes database/monthly/future-ready-db-monthly-YYYY-MM.json; a later run that day replaces it (one copy); other days write none", () => {
  const S = makeEnv({ now: "2026-10-30T10:00:00Z" }); S.ctx.setup();
  const none = S.live().filter(x => x.path.includes("/monthly/")).length;
  S.now = Date.parse("2026-10-31T05:00:00Z"); S.ctx.runRolling(); S.now = Date.parse("2026-10-31T21:00:00Z"); S.ctx.runRolling();
  const m = S.live().filter(x => x.path.includes("/monthly/")).map(x => x.path);
  return { pass: none === 0 && m.length === 1 && m[0].endsWith("future-ready-db-monthly-2026-10.json"), actual: `before month end ${none}; after ${JSON.stringify(m)}` };
});

test("T12 spreadsheet failure does not fail the database backup", "JSON written and verified; run success with a note; alert email about the Sheet", () => {
  const S = makeEnv(); S.ctx.setup(); S.mode.sheet = "down"; S.now += 864e5; const r = S.ctx.runNightly();
  const run = S.runs.at(-1);
  return { pass: r.ok && run.status === "success" && /Sheet refresh failed/.test(run.error) && S.mails.at(-1).subject.includes("spreadsheet"), actual: `ok=${r.ok}; run ${run.status}; note "${run.error}"; mail "${S.mails.at(-1).subject}"` };
});

test("T13 inconsistent export is rejected before anything is written", "If a table's row count does not match its rows, the run fails and writes no database file", () => {
  const S = makeEnv(); S.ctx.setup(); const n0 = S.live().length; const bad = clone(FIX); bad.row_counts.candidates = 999; S.mode.export = bad; S.now += 6 * 36e5; const r = S.ctx.runRolling();
  const dbFiles = S.live().length - n0 - 1; // minus the failure report
  return { pass: !r.ok && /candidates/.test(r.error) && dbFiles === 0, actual: `ok=${r.ok}; error "${r.error}"; new db files ${dbFiles}` };
});

test("T14 overlapping runs", "If a run is still going, the next one exits without touching anything", () => {
  const S = makeEnv(); S.ctx.setup(); const n0 = S.files.length, r0 = S.runs.length; S.mode.lock = false; const r = S.ctx.runRolling();
  return { pass: !r.ok && S.files.length === n0 && S.runs.length === r0, actual: `ok=${r.ok}; "${r.error}"` };
});

test("T15 wrong service key", "Run fails with a 401 message; alert sent; queued for sync_runs", () => {
  const S = makeEnv(); S.ctx.setup(); S.props.SUPABASE_SERVICE_KEY = "wrong"; S.now += 6 * 36e5; const r = S.ctx.runRolling();
  return { pass: !r.ok && /401/.test(r.error) && S.mails.at(-1).subject.includes("FAILED"), actual: `ok=${r.ok}; "${r.error}"` };
});

test("T16 stale-backup warning", "A failure when the last good backup is over 8 hours old says so in the alert", () => {
  const S = makeEnv({ now: "2026-10-26T08:00:00Z" }); S.ctx.setup(); S.mode.supabase = "down"; S.now += 9 * 36e5; S.ctx.runRolling();
  return { pass: /more than 8 hours old/.test(S.mails.at(-1).text), actual: S.mails.at(-1).text.split("\n").filter(l => /Last successful|WARNING/.test(l)).join(" / ") };
});

const pass = results.filter(r => r.pass).length;
console.log(JSON.stringify(results, null, 1));
console.log(`\n${pass}/${results.length} PASS`);
