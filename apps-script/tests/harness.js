// Runs apps-script/Backup.gs unchanged inside simulated Google Apps Script services.
const fs = require("fs"), vm = require("vm"), crypto = require("crypto");
const SRC = fs.readFileSync(__dirname + "/../Backup.gs", "utf8");
const FIX = JSON.parse(fs.readFileSync(process.env.BACKUP_FIXTURE || __dirname + "/fixture_export.json", "utf8"));

function makeEnv(opts = {}) {
  const S = { props: {}, folders: [], files: [], sheets: {}, mails: [], triggers: [], logs: [], runs: [], appConfig: {}, http: [], now: opts.now ? new Date(opts.now).getTime() : Date.now(), mode: { supabase: "up", drive: "up", sheet: "up", lock: true, export: null } };
  let idc = 0; const nid = p => p + (++idc);
  // ---------- Date with a controllable clock ----------
  const RealDate = Date;
  class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(S.now); } static now() { return S.now; } }
  // ---------- Drive ----------
  const iter = arr => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
  function mkFolder(name, parent) {
    const f = { id: nid("fold"), name, parent, trashed: false };
    const api = {
      getId: () => f.id, getName: () => f.name, getUrl: () => "https://drive/" + f.id,
      getFoldersByName: n => iter(S.folders.filter(x => x.f.parent === f.id && x.f.name === n && !x.f.trashed).map(x => x.api)),
      createFolder: n => mkFolder(n, f.id),
      createFile: (n, content, mime) => { if (S.mode.drive === "down") throw new Error("Drive: Service unavailable"); return mkFile(n, content, mime, f.id); },
      getFiles: () => iter(S.files.filter(x => x.f.parent === f.id && !x.f.trashed).map(x => x.api)),
      getFilesByName: n => iter(S.files.filter(x => x.f.parent === f.id && x.f.name === n && !x.f.trashed).map(x => x.api)),
    };
    S.folders.push({ f, api }); return api;
  }
  function mkFile(name, content, mime, parent, created) {
    const f = { id: nid("file"), name, content, mime, parent, trashed: false, created: new RealDate(created || S.now) };
    const api = { getId: () => f.id, getName: () => f.name, getDateCreated: () => new RealDate(f.created), setTrashed: v => { f.trashed = v; },
      getBlob: () => ({ getDataAsString: () => f.content }), moveTo: folder => { f.parent = folder.getId(); }, _f: f };
    S.files.push({ f, api }); return api;
  }
  const ROOTF = mkFolder("My Drive", null);
  const DriveApp = { getRootFolder: () => ROOTF, createFolder: n => ROOTF.createFolder(n),
    getFolderById: id => { const x = S.folders.find(x => x.f.id === id); if (!x) throw new Error("no folder " + id); return x.api; },
    getFileById: id => { const x = S.files.find(x => x.f.id === id); if (!x) throw new Error("no file " + id); return x.api; } };
  // ---------- Sheets ----------
  function mkSpreadsheet(name) {
    const ss = { id: nid("ss"), name, tabs: [] };
    const mkTab = n => { const t = { name: n, cells: {}, frozen: 0, prot: null, rows: [] };
      const api = {
        getName: () => t.name, clear: () => { t.rows = []; },
        getRange: (r, c, nr = 1, nc = 1) => ({
          setValues: v => { if (v.length !== nr || v.some(row => row.length !== nc)) throw new Error("setValues: dimensions " + v.length + "x" + (v[0] || []).length + " do not match range " + nr + "x" + nc);
            v.forEach((row, i) => { row.forEach(x => { if (typeof x === "string" && x.length > 50000) throw new Error("cell over 50000 chars"); }); t.rows[r - 1 + i] = row.slice(); }); },
          setValue: x => { t.rows[r - 1] = [x]; } }),
        setFrozenRows: n => { t.frozen = n; }, getLastRow: () => t.rows.length, appendRow: row => { t.rows.push(row); },
        getProtections: () => t.prot ? [t.prot] : [],
        protect: () => { const p = { desc: "", editors: ["someone@else.com", "futureready.backups@gmail.com"], domain: true };
          t.prot = { setDescription: d => { p.desc = d; return t.prot; }, getEditors: () => p.editors.map(e => ({ getEmail: () => e })), removeEditors: es => { const rm = es.map(e => e.getEmail()); p.editors = p.editors.filter(e => rm.indexOf(e) < 0); }, canDomainEdit: () => p.domain, setDomainEdit: v => { p.domain = v; }, _p: p }; return t.prot; },
        _t: t };
      return api; };
    const api = { getId: () => ss.id, getUrl: () => "https://sheets/" + ss.id,
      getSheetByName: n => ss.tabs.find(t => t.getName() === n) || null,
      insertSheet: (n, idx) => { const t = mkTab(n); if (idx === 0) ss.tabs.unshift(t); else ss.tabs.push(t); return t; },
      getSheets: () => ss.tabs.slice(), deleteSheet: t => { ss.tabs = ss.tabs.filter(x => x !== t); }, _ss: ss };
    api.insertSheet("Sheet1");
    S.sheets[ss.id] = api; mkFile(name, "<spreadsheet>", "sheet", ROOTF.getId()).getId = () => ss.id;
    // make DriveApp.getFileById(ss id) work
    const fileRec = S.files[S.files.length - 1]; fileRec.f.id = ss.id;
    return api;
  }
  const SpreadsheetApp = { create: n => mkSpreadsheet(n), openById: id => { if (S.mode.sheet === "down") throw new Error("Sheets: Service unavailable"); const s = S.sheets[id]; if (!s) throw new Error("no spreadsheet " + id); return s; }, ProtectionType: { SHEET: "SHEET" } };
  // ---------- Supabase over UrlFetchApp ----------
  const UrlFetchApp = { fetch: (url, o) => {
    S.http.push([o.method, url.replace(/^.*\/rest\/v1\//, "")]);
    if (S.mode.supabase === "down") throw new Error("Address unavailable: " + url.split("/")[2]);
    if (o.headers.Authorization !== "Bearer test-service-key") return resp(401, '{"message":"Invalid API key"}');
    const path = url.replace(/^.*\/rest\/v1\//, ""), body = o.payload ? JSON.parse(o.payload) : null;
    if (path === "rpc/backup_export") { if (S.mode.supabase === "exportFails") return resp(500, '{"message":"statement timeout"}'); return resp(200, JSON.stringify(S.mode.export || FIX)); }
    if (path.startsWith("sync_runs?id=eq.")) { const id = decodeURIComponent(path.split("eq.")[1]); const r = S.runs.find(x => x.id === id); Object.assign(r, body); return resp(204, ""); }
    if (path === "sync_runs") { const arr = Array.isArray(body) ? body : [body]; const made = arr.map(b => ({ id: nid("run"), ...b })); S.runs.push(...made); return resp(201, o.headers.Prefer.includes("minimal") ? "" : JSON.stringify(made)); }
    if (path.startsWith("app_config")) { body.forEach(r => S.appConfig[r.key] = r.value); return resp(201, ""); }
    return resp(404, "{}");
  } };
  const resp = (code, text) => ({ getResponseCode: () => code, getContentText: () => text });
  // ---------- the rest ----------
  const props = { getProperty: k => (k in S.props ? S.props[k] : null), setProperty: (k, v) => { S.props[k] = String(v); }, deleteProperty: k => { delete S.props[k]; } };
  const trig = h => ({ getHandlerFunction: () => h });
  const builder = h => { const t = { h, spec: {} }; const b = { timeBased: () => b, everyHours: n => { t.spec.everyHours = n; return b; }, atHour: n => { t.spec.atHour = n; return b; }, nearMinute: n => { t.spec.nearMinute = n; return b; }, everyDays: n => { t.spec.everyDays = n; return b; }, create: () => { S.triggers.push(t); return trig(h); } }; return b; };
  const fmt = (d, tz, f) => { const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(d).map(p => [p.type, p.value]));
    if (f === "yyyy-MM-dd'T'HHmmss'Z'") return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}${parts.minute}${parts.second}Z`;
    if (f === "yyyy-MM") return `${parts.year}-${parts.month}`; if (f === "d") return String(Number(parts.day)); throw new Error("fmt " + f); };
  const ctx = {
    Date: FakeDate, JSON, Math, Object, Array, String, Number, Error, RegExp, encodeURIComponent, decodeURIComponent,
    PropertiesService: { getScriptProperties: () => props },
    Session: { getScriptTimeZone: () => "Africa/Lagos", getEffectiveUser: () => ({ getEmail: () => "futureready.backups@gmail.com" }) },
    LockService: { getScriptLock: () => ({ tryLock: () => S.mode.lock, releaseLock: () => {} }) },
    UrlFetchApp, DriveApp, SpreadsheetApp,
    MailApp: { sendEmail: (to, subject, text) => S.mails.push({ to, subject, text }), getRemainingDailyQuota: () => 100 },
    Utilities: { computeDigest: (alg, s) => [...crypto.createHash("sha256").update(s, "utf8").digest()].map(b => b > 127 ? b - 256 : b), DigestAlgorithm: { SHA_256: "SHA_256" }, Charset: { UTF_8: "UTF_8" }, formatDate: fmt },
    ScriptApp: { getProjectTriggers: () => S.triggers.map(t => ({ getHandlerFunction: () => t.h, _t: t })), deleteTrigger: x => { S.triggers = S.triggers.filter(t => t !== x._t); }, newTrigger: h => builder(h) },
    Logger: { log: m => S.logs.push(String(m)) },
  };
  vm.createContext(ctx); vm.runInContext(SRC, ctx);
  S.props = { SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_KEY: "test-service-key", ALERT_EMAILS: "collinsonuora05@gmail.com, ceo@example.com" };
  // helpers for tests
  S.ctx = ctx;
  S.path = f => { const names = []; let p = f.parent; while (p) { const x = S.folders.find(y => y.f.id === p); names.unshift(x.f.name); p = x.f.parent; } return names.join("/"); };
  S.live = () => S.files.filter(x => !x.f.trashed && x.f.mime !== "sheet").map(x => ({ path: S.path(x.f) + "/" + x.f.name, f: x.f }));
  S.dbFolder = n => S.folders.find(x => x.f.name === n && S.folders.find(y => y.f.id === x.f.parent)?.f.name === "database").api;
  S.mkOldFile = (folderName, name, daysOld) => mkFile(name, "{}", "application/json", S.dbFolder(folderName).getId(), S.now - daysOld * 864e5);
  return S;
}
module.exports = { makeEnv, FIX };
