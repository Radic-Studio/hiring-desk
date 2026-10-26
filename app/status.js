/* Future Ready Group System — connection status and backup health (Stage 6).
   Live:     the database answers normally and live updates are connected.
   Degraded: the database answers, but something is not right: server errors, very slow answers, live updates
             disconnected, or changes on this device still waiting to synchronize / refused.
             Since Stage 9 this includes "the database cannot be reached" while the device itself is online.
   Offline:  the device reports no connection (navigator.onLine is false). Saves that may wait are kept on
             this device (Stage 5); everything else says nothing was saved.
   How it knows: it watches the app's own requests to the database. It only checks on its own (one small read)
   when the app has been quiet for 2 minutes or looks offline, and only while someone is signed in with the
   page open, so it adds no background traffic. Backup health (Group Admins) is read from sync_runs. */
(() => {
const FR = window.FR;
const { $, esc, logAct, toast } = FR;
const BASE = (FR.CFG.supabaseUrl || "").replace(/\/$/, "");
const SLOW_MS = 4000, ERR_WINDOW = 120000, IDLE_PROBE = 120000, RT_GRACE = 20000;
const BACKUP_WARN_H = 8, NIGHTLY_WARN_H = 26, ROLLING_EVERY_H = 6, NIGHTLY_HOUR = 2;   // matches apps-script/Backup.gs

const st = FR.ST = { lastOk: 0, lastNetFail: 0, netFails: 0, serverErrs: [], authErrs: [], lat: [], rtDownSince: 0, state: "connecting", reasons: [], started: false, probing: false, backup: null, backupErr: "" };

/* ---------- watch the app's own database traffic ---------- */
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url || "";
  if (!BASE || !url.startsWith(BASE) || url.includes("/realtime/")) return realFetch(input, init);
  const t0 = performance.now();
  if (url.includes("/auth/v1/")) {   // sign-in service: tracked on its own, so a sign-in outage is not reported as the database being down
    try {
      const res = await realFetch(input, init);
      if (res.status >= 500) st.authErrs.push(Date.now()); else st.authErrs = [];
      schedule(); return res;
    } catch (e) { if (e?.name !== "AbortError") { st.authErrs.push(Date.now()); schedule(); } throw e; }
  }
  try {
    const res = await realFetch(input, init);
    const ms = performance.now() - t0;
    if (res.status >= 500 || res.status === 0) st.serverErrs.push(Date.now());
    else { st.lastOk = Date.now(); st.netFails = 0; st.lat.push(ms); if (st.lat.length > 8) st.lat.shift(); }
    schedule(); return res;
  } catch (e) {
    if (e?.name !== "AbortError") { st.lastNetFail = Date.now(); st.netFails++; schedule(); }
    throw e;
  }
};

/* ---------- decide the state ---------- */
const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
async function compute() {
  const now = Date.now(), r = [];
  st.serverErrs = st.serverErrs.filter(t => now - t < ERR_WINDOW);
  st.authErrs = st.authErrs.filter(t => now - t < ERR_WINDOW);
  const rt = FR.SB?.realtime, channels = (rt?.channels || rt?.getChannels?.() || []).length;
  const rtUp = !channels || (rt?.isConnected ? rt.isConnected() : true);
  if (rtUp) st.rtDownSince = 0; else if (!st.rtDownSince) st.rtDownSince = now;
  let state = "live";
  const dbDown = navigator.onLine !== false && (st.netFails >= 2 || (st.lastNetFail > st.lastOk && st.netFails >= 1));
  if (navigator.onLine === false) { state = "offline"; r.push("This device has no internet connection."); }
  else if (dbDown) { state = "degraded"; r.push("The database cannot be reached. If other websites also fail, this device has lost its internet connection."); }
  else {
    if (st.serverErrs.length) r.push(`The database returned ${st.serverErrs.length} error${st.serverErrs.length > 1 ? "s" : ""} in the last 2 minutes.`);
    if (st.lat.length >= 3 && median(st.lat) > SLOW_MS) r.push(`The database is answering slowly (about ${Math.round(median(st.lat) / 1000)} s).`);
    if (st.authErrs.length) r.push("The sign-in service is having problems. If you are signed in you can keep working; signing in, or staying signed in after about an hour, may fail until it recovers.");
    if (st.rtDownSince && now - st.rtDownSince > RT_GRACE) r.push("Live updates are disconnected: other people's changes appear after a refresh.");
    if (r.length) state = "degraded";
  }
  const ob = FR.outbox ? await FR.outbox.list() : [];
  const waiting = ob.filter(e => e.status === "waiting" || e.status === "sending").length, attention = ob.length - waiting;
  st.waiting = waiting;
  if (state !== "offline" && waiting) { state = "degraded"; r.push(`${waiting} change${waiting > 1 ? "s" : ""} on this device still waiting to synchronize.`); }
  if (attention) { if (state === "live") state = "degraded"; r.push(`${attention} change${attention > 1 ? "s" : ""} on this device need attention. Open "Waiting to sync".`); }
  const prev = st.state, wasDown = st.dbDown || prev === "offline"; st.state = state; st.reasons = r; st.dbDown = dbDown || state === "offline"; paint();
  if (st.started) {
    if (!wasDown && st.dbDown) logAct("bad", "Connection to the database lost. Changes that can wait are kept on this device.");
    else if (wasDown && !st.dbDown) { logAct("ok", "Connection restored"); FR.outbox?.flush(); loadBackupStamp(); }
  }
}
let timer = null;
const schedule = () => { clearTimeout(timer); timer = setTimeout(compute, 250); };

/* ---------- a small check, only when needed ---------- */
async function probe() {
  if (st.probing || !st.started || document.hidden || !FR.SB || navigator.onLine === false) return;
  const quiet = Date.now() - Math.max(st.lastOk, st.lastNetFail);
  if (!st.dbDown && quiet < IDLE_PROBE) return;   // while the database is unreachable: a small check every 15 s
  st.probing = true;
  try { await FR.SB.from("companies").select("id").limit(1); } catch { /* recorded by the fetch watcher */ } finally { st.probing = false; schedule(); }
}

/* ---------- backup health (Group Admins) ---------- */
const DB_KINDS = ["rolling", "nightly", "monthly", "manual"];
const hours = t => (Date.now() - Date.parse(t)) / 36e5;
const age = t => { if (!t) return "never"; const h = hours(t); return h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`; };
const when = t => t ? new Date(t).toLocaleString("en-NG", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
function nextNightly() {   // 02:00–03:00 Lagos time (UTC+1), Google runs it somewhere in that hour
  const d = new Date(); const lagos = new Date(d.getTime() + 3600e3);
  let n = Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate(), NIGHTLY_HOUR) - 3600e3;
  if (n <= d.getTime()) n += 864e5; return new Date(n);
}
/** Overall verdict: ok / warn / bad, with the reasons in plain words. */
function judge(runs) {
  const ok = runs.filter(x => x.status === "success" && DB_KINDS.includes(x.kind));
  const last = ok[0], lastNightly = ok.find(x => x.kind === "nightly"), lastRolling = ok.find(x => x.kind === "rolling"), lastMonthly = ok.find(x => x.kind === "monthly" || x.details?.monthly);
  const lastFail = runs.find(x => x.status === "failed" && x.kind !== "manual");
  const stuck = runs.find(x => x.status === "running" && hours(x.started_at) > 0.5);
  const notes = []; let level = "ok";
  const raise = (l, m) => { notes.push({ l, m }); if (l === "bad" || (l === "warn" && level === "ok")) level = l; };
  if (!last) raise("bad", "No successful database backup has been recorded.");
  else if (hours(last.finished_at || last.started_at) > NIGHTLY_WARN_H) raise("bad", `The newest backup is ${age(last.finished_at || last.started_at)}.`);
  else if (hours(last.finished_at || last.started_at) > BACKUP_WARN_H) raise("warn", `The newest backup is ${age(last.finished_at || last.started_at)} (expected every ${ROLLING_EVERY_H} h).`);
  if (last && !lastRolling && hours(last.finished_at) > ROLLING_EVERY_H + 1) raise("warn", "No 6-hourly backup has run yet. Check the runRolling trigger in the backup account's Apps Script.");
  if (last && !lastNightly) raise("warn", "No nightly backup has run yet.");
  else if (lastNightly && hours(lastNightly.finished_at) > NIGHTLY_WARN_H) raise("warn", `The last nightly backup was ${age(lastNightly.finished_at)}.`);
  if (lastFail && (!last || Date.parse(lastFail.started_at) > Date.parse(last.started_at))) raise("bad", `The latest backup attempt failed (${when(lastFail.started_at)}): ${lastFail.error || "no reason recorded"}`);
  if (stuck) raise("warn", `A ${stuck.kind} backup started ${age(stuck.started_at)} and has not finished.`);
  const base = lastRolling || last;
  return { level, notes, last, lastNightly, lastRolling, lastMonthly, lastFail,
    nextRolling: base ? new Date(Date.parse(base.started_at) + ROLLING_EVERY_H * 36e5) : null, nextNightly: nextNightly() };
}
/** Last successful backup time, for everyone signed in (only the time: details stay with Group Admins). */
async function loadBackupStamp() {
  if (!FR.SB || !st.started) return;
  const { data, error } = await FR.SB.rpc("backup_last_success");
  if (!error) { st.lastBackup = data || null; paint(); }
}
async function loadBackup() {
  loadBackupStamp();
  if (!FR.S.access?.group_admin || !FR.SB) { st.backup = null; paint(); return; }
  const { data, error } = await FR.SB.from("sync_runs").select("kind,status,started_at,finished_at,tables,rows,file_name,error,details").order("started_at", { ascending: false }).limit(60);
  if (error) { st.backupErr = error.message; return; }
  st.backupErr = ""; st.backup = judge(data || []); paint();
}

/* ---------- top bar ---------- */
const LABEL = { live: "Live", degraded: "Degraded", offline: "Offline", connecting: "Connecting" };
function paint() {
  const s = $("#sync"); if (!s || !st.started) return;
  s.className = "sync st-" + st.state; s.querySelector("span").textContent = LABEL[st.state];
  s.title = st.reasons.join(" ") || "Connected to the database";
  const b = $("#bk-chip"), h = st.backup;
  if (b) { const show = !!h && h.level !== "ok"; b.hidden = !show; if (show) { b.className = "bk-chip " + h.level; b.textContent = h.level === "bad" ? "Backup problem" : "Backup late"; b.title = h.notes.map(n => n.m).join(" "); } }
  if (!$("#st-scrim").hidden) renderPanel();
}
function renderPanel() {
  const h = st.backup, m = $("#st-modal");
  const row = (k, v) => `<div class="st-row"><span>${k}</span><b>${v}</b></div>`;
  m.innerHTML = `<h2 id="st-title">System status</h2>
    <div class="st-head st-${st.state}"><i></i><div><b>${LABEL[st.state]}</b><small>${esc(st.reasons.join(" ") || "The database is answering normally and live updates are connected.")}</small></div></div>
    ${row("Last contact with the database", st.lastOk ? age(new Date(st.lastOk).toISOString()) : "not yet")}
    ${st.state !== "live" ? `${row("Data on screen as of", st.lastOk ? when(new Date(st.lastOk).toISOString()) : "not loaded yet")}
      ${row("Changes waiting on this device", String(st.waiting || 0))}
      ${row("Last successful backup", st.lastBackup ? `${when(st.lastBackup)} · ${age(st.lastBackup)}` : "unknown")}` : ""}
    ${st.dbDown ? `<p class="hint">You can keep working. Changes that can wait are kept on this device and sent once when the connection is back.
      <b>Unavailable until then:</b> payments, stock movements, staff records and private details, leave, deleting and restoring, cancelling, team and permission changes, invitations, settings, emails and file uploads.</p>` : ""}
    ${FR.S.access?.group_admin ? `<h3 class="st-sub">Backups <span class="bk-dot ${h?.level || ""}">${h ? { ok: "Healthy", warn: "Needs a look", bad: "Problem" }[h.level] : st.backupErr ? "Unavailable" : "Loading…"}</span></h3>
      ${st.backupErr ? `<p class="hint">Could not read backup history: ${esc(st.backupErr)}</p>` : h ? `
      ${h.notes.map(n => `<p class="st-note ${n.l}">${esc(n.m)}</p>`).join("")}
      ${row("Newest backup", h.last ? `${when(h.last.finished_at)} · ${age(h.last.finished_at)}` : "none")}
      ${h.last ? row("Contents", `${h.last.tables ?? "?"} tables · ${h.last.rows ?? "?"} rows`) : ""}
      ${row("Last 6-hourly", h.lastRolling ? age(h.lastRolling.finished_at) : "not yet")}
      ${row("Last nightly", h.lastNightly ? age(h.lastNightly.finished_at) : "not yet")}
      ${row("Last month-end copy", h.lastMonthly ? when(h.lastMonthly.finished_at) : "not yet (made on the last day of the month)")}
      ${row("Next 6-hourly due", !h.nextRolling ? "—" : h.nextRolling.getTime() < Date.now() - 15 * 60000 ? `<span style="color:var(--bad)">overdue (was due about ${when(h.nextRolling)})</span>` : `about ${when(h.nextRolling)}`)}
      ${row("Next nightly due", `${when(h.nextNightly)} (within the hour)`)}
      <p class="hint">Backups run from the backup Google account to its Drive and the protected "Future Ready Backups" spreadsheet. A failed run also emails the alert addresses.</p>` : ""}` : ""}
    <div class="toolbar"><button class="btn" id="st-refresh">Check now</button><button class="btn" id="st-close">Close</button></div>`;
  $("#st-close").onclick = () => { $("#st-scrim").hidden = true; };
  $("#st-refresh").onclick = async () => { $("#st-refresh").disabled = true; st.lastOk = 0; st.probing = false; await FR.SB?.from("companies").select("id").limit(1).then(() => {}, () => {}); await loadBackup(); await compute(); };
}

FR.statusStart = () => {
  st.started = true; FR.statusActive = true; compute(); loadBackup();
  setInterval(compute, 5000);
  setInterval(probe, 15000);
  setInterval(loadBackup, 10 * 60000);
};
document.addEventListener("DOMContentLoaded", () => {
  $("#sync")?.addEventListener("click", () => { if (!st.started) return; $("#st-scrim").hidden = false; renderPanel(); loadBackup(); });
  $("#bk-chip")?.addEventListener("click", () => $("#sync").click());
  $("#st-scrim")?.addEventListener("click", e => { if (e.target.id === "st-scrim") $("#st-scrim").hidden = true; });
});
window.addEventListener("online", () => { st.netFails = 0; schedule(); setTimeout(probe, 1000); });
window.addEventListener("offline", schedule);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { schedule(); probe(); } });
FR._statusJudge = judge;   // for tests
})();
