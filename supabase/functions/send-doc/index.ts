// Future Ready Group System: send a business document (quote, invoice, receipt, or any company email) with an optional PDF attachment.
// Caller must have write access to the company (admin/manager/staff). Relays through the Gmail relay registered by the Apps Script.
// Every attempt is written to ops_log (entity "email": who, to whom, subject, outcome; never the body or attachment), and a
// sender is limited to 60 emails per rolling hour so a mistake or misuse cannot exhaust the Gmail quota.
// Body: { company, to, subject, text, html?, replyTo?, attachment?: { name, mime, base64 }, kind?, ref? }
// Deployed as `send-doc` (verify_jwt: true).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const brandHtml = (title: string, bodyHtml: string, sub = "Operational communication") => `<!doctype html><html><body style="margin:0;background:#F6F8F7;font-family:Arial,sans-serif;color:#10211D"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px"><table role="presentation" width="600" style="max-width:600px;background:#fff;border:1px solid #DCE5E0;border-radius:12px;overflow:hidden"><tr><td style="background:#073F35;padding:24px 32px;color:#fff"><strong style="font-size:20px;letter-spacing:.02em">FUTURE READY</strong><div style="font-size:12px;color:#B9F2D8;margin-top:6px">${sub}</div></td></tr><tr><td style="padding:28px 32px;font-size:15px;line-height:1.55">${title ? `<h1 style="font-size:22px;margin:0 0 14px">${title}</h1>` : ""}${bodyHtml}</td></tr><tr><td style="padding:16px 32px;border-top:1px solid #DCE5E0;font-size:12px;color:#63736D">Future Ready Nig. Ltd. · Udeorji Street, Obiagu, Enugu, Nigeria</td></tr></table></td></tr></table></body></html>`;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const auth = req.headers.get("Authorization") ?? "";
  const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const asUser = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: userData, error: userErr } = await asUser.auth.getUser();
  if (userErr || !userData?.user?.email) return json(401, { error: "not_signed_in" });
  const sender = userData.user.email.toLowerCase();

  let b: { company?: string; to?: string; subject?: string; text?: string; html?: string; replyTo?: string; attachment?: { name?: string; mime?: string; base64?: string }; kind?: string; ref?: string };
  try { b = await req.json(); } catch { return json(400, { error: "bad_json" }); }
  const company = String(b.company || "").trim().toLowerCase(), to = String(b.to || "").trim(), subject = String(b.subject || "").trim().slice(0, 300), text = String(b.text || "").slice(0, 20000), html = String(b.html || "").slice(0, 60000);
  if (!company || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to) || !subject || !text) return json(400, { error: "missing_fields", detail: "Company, a valid address, subject and text are required" });
  const { data: canWrite, error: permErr } = await asUser.rpc("can_write_company", { cid: company });
  if (permErr || !canWrite) return json(403, { error: "not_allowed", detail: "You cannot send email for this company" });

  const admin = createClient(url, service);
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count: sentLastHour } = await admin.from("ops_log").select("id", { count: "exact", head: true }).eq("entity", "email").eq("actor", sender).gte("created_at", since);
  if ((sentLastHour ?? 0) >= 60) return json(429, { error: "rate_limited", detail: "More than 60 emails in the last hour. Try again later." });
  const [{ data: cfgRows }, { data: co }] = await Promise.all([
    admin.from("app_config").select("key,value").in("key", ["mail_relay_url", "mail_relay_token"]),
    admin.from("companies").select("name").eq("id", company).maybeSingle(),
  ]);
  const cfg: Record<string, string> = {}; for (const r of cfgRows ?? []) cfg[r.key] = r.value;
  if (!cfg.mail_relay_url || !cfg.mail_relay_token) return json(500, { error: "not_configured", detail: "Email is not set up: run setup() in the Google Sheet's Apps Script" });

  const attachments = [];
  if (b.attachment?.base64) {
    if (b.attachment.base64.length > 9_000_000) return json(413, { error: "too_big", detail: "Attachment over 6 MB" });
    attachments.push({ name: String(b.attachment.name || "document.pdf").slice(0, 120), mime: String(b.attachment.mime || "application/pdf"), base64: b.attachment.base64 });
  }
  let status: "sent" | "failed" = "failed", errText = "";
  try {
    const r = await fetch(cfg.mail_relay_url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, redirect: "follow",
      body: JSON.stringify({ token: cfg.mail_relay_token, to, subject, text, html: /<html/i.test(html) ? html : brandHtml("", html || text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>"), co?.name || "Future Ready Nigeria"), attachments, senderName: co?.name || "Future Ready Nigeria", replyTo: b.replyTo || sender, kind: b.kind || "doc", ref: b.ref || "" }) });
    const raw = await r.text();
    let out: { ok?: boolean; error?: string } = {};
    try { out = JSON.parse(raw); } catch { out = { error: `Relay answered ${r.status}: ${raw.slice(0, 120)}` }; }
    if (r.ok && out.ok) status = "sent"; else errText = out.error || `Relay ${r.status}`;
  } catch (e) { errText = (e as Error).message; }
  await admin.from("ops_log").insert({ op_id: crypto.randomUUID(), entity: "email", record_id: String(b.ref || to).slice(0, 120), company_id: company, action: "insert",
    result: status === "sent" ? "applied" : "failed", actor: sender, actor_uid: userData.user.id, source: "function",
    changes: { to, subject, kind: b.kind || "doc", attachment: attachments[0]?.name || null }, error: errText || null })
    .then(({ error }) => { if (error) console.error("ops_log insert failed", error.message); });
  return json(200, { status, to, error: errText || undefined });
});
