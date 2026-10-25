// Future Ready Hiring Desk: send one outreach or interview email to a candidate.
// The page sends only the candidate id and the rendered subject/body; the address is looked up here,
// so a tampered page cannot email arbitrary recipients. Requires a signed-in member at contributor level or above.
// Deployed to the Supabase project as `send-email` (verify_jwt: true). Secrets: RESEND_API_KEY, MAIL_FROM (optional).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const auth = req.headers.get("Authorization") ?? "";
  const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const asUser = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: userData, error: userErr } = await asUser.auth.getUser();
  if (userErr || !userData?.user?.email) return json(401, { error: "not_signed_in" });
  const email = userData.user.email.toLowerCase();
  const admin = createClient(url, service);
  const { data: member } = await admin.from("members").select("level,name").ilike("email", email).maybeSingle();
  if (!member || !(["contributor", "editor"].includes(member.level))) return json(403, { error: "not_allowed", detail: "Your level cannot send email" });

  let body: { candidateId?: string; kind?: string; subject?: string; text?: string; formUrl?: string };
  try { body = await req.json(); } catch { return json(400, { error: "bad_json" }); }
  const { candidateId, kind = "outreach", subject = "", text = "", formUrl = "" } = body;
  if (!candidateId || !subject.trim() || !text.trim()) return json(400, { error: "missing_fields" });
  if (!["outreach", "interview"].includes(kind)) return json(400, { error: "bad_kind" });

  const { data: c } = await admin.from("candidates").select("*").eq("id", candidateId).maybeSingle();
  if (!c) return json(404, { error: "no_candidate" });
  if (!c.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email)) return json(422, { error: "no_email" });

  // simple per-user rate limit: 120 sends per rolling hour
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin.from("candidates").select("id", { count: "exact", head: true }).gte("last_email_at", since).eq("last_by", email);
  if ((count ?? 0) >= 120) return json(429, { error: "rate_limited", detail: "More than 120 emails in the last hour" });

  const from = Deno.env.get("MAIL_FROM") ?? "Future Ready Nigeria <onboarding@resend.dev>";
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return json(500, { error: "not_configured", detail: "RESEND_API_KEY is not set" });
  let html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#101828;max-width:600px">${esc(text).replace(/\n/g, "<br>")}</div>`;
  if (formUrl && text.includes(formUrl)) html = html.replace(esc(formUrl), `<a href="${esc(formUrl)}" style="display:inline-block;background:#2f5bff;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:bold">Answer the follow-up form</a><br><span style="font-size:12px;color:#667085">Or copy this link: ${esc(formUrl)}</span>`);

  const now = new Date().toISOString();
  let status: "sent" | "failed" | "unknown" = "unknown", messageId: string | null = null, errText = "";
  try {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [c.email], subject, text, html }) });
    const out = await r.json().catch(() => ({}));
    if (r.ok && out?.id) { status = "sent"; messageId = out.id; }
    else if (r.status >= 500 || r.status === 429) { status = "unknown"; errText = out?.message || `Resend ${r.status}`; }
    else { status = "failed"; errText = out?.message || `Resend ${r.status}`; }
  } catch (e) { status = "unknown"; errText = (e as Error).message; }

  const label = kind === "interview" ? "Interview invitation" : "Outreach email";
  const outreach = [...(c.outreach ?? []), { ts: now, channel: "email", kind, status, to: c.email, subject, messageId, by: email, error: status === "sent" ? "" : errText }].slice(-20);
  const history = [...(c.history ?? []), { ts: now, by: email, summary: status === "sent" ? `${label} sent` : status === "unknown" ? `${label}: outcome unknown (${errText})` : `${label} failed: ${errText}` }].slice(-50);
  const patch: Record<string, unknown> = { outreach, history, last_by: email, last_email_at: now };
  if (kind === "interview") {
    patch.interview = { ...(c.interview ?? {}), invitedAt: status === "sent" ? now : c.interview?.invitedAt ?? null, inviteStatus: status, outcome: c.interview?.outcome ?? "Pending" };
  } else {
    Object.assign(patch, { emailed_at: status === "sent" ? now : c.emailed_at, last_email_status: status, last_email_error: status === "sent" ? "" : errText });
    if (status === "sent" && c.status !== "contacted") { patch.status = "awaiting"; if (!c.mode) patch.mode = "Email"; }
  }
  await admin.from("candidates").update(patch).eq("id", candidateId);
  return json(200, { status, messageId, error: errText || undefined });
});
