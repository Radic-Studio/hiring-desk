// Future Ready Group System: invite a person as Group Admin or into one company with a role.
// Caller must be a signed-in, active Group Admin, or an Admin of the company being invited into. Creates or refreshes the
// invitation through public.admin_invite() (runs as the caller, so the database enforces the checks), then emails a personal
// link through the Gmail relay registered in public.app_config by the Google Apps Script.
// Body: { email, name?, level: "editor" (Group Admin) | "viewer", company?: company id, role?: admin|manager|staff|viewer }
// Deployed as `invite-member` (verify_jwt: true).
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
  const callerEmail = userData.user.email.toLowerCase();

  let body: { email?: string; level?: string; name?: string; company?: string; role?: string };
  try { body = await req.json(); } catch { return json(400, { error: "bad_json" }); }
  const email = String(body.email || "").trim().toLowerCase();
  const level = body.level === "editor" ? "editor" : "viewer";
  const name = String(body.name || "").trim().slice(0, 120);
  const company = level === "editor" ? null : (String(body.company || "").trim().toLowerCase() || null);
  const role = ["admin", "manager", "staff", "viewer"].includes(String(body.role)) ? String(body.role) : "viewer";
  if (level !== "editor" && !company) return json(400, { error: "no_company", detail: "Choose a company" });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: "bad_email", detail: "That is not a valid email address" });

  // 1. Create/refresh the invitation as the caller (database checks the caller is an Admin and applies the guards).
  const { data: inv0, error: invErr } = await asUser.rpc("admin_invite", { p_email: email, p_level: level, p_name: name, p_company: company, p_role: role });
  if (invErr) return json(403, { error: "refused", detail: invErr.message });
  if (inv0?.status === "active") return json(200, { status: "active", email, added_to: inv0.added_to });

  // 2. Read what the email needs (service role: token table and relay settings are not exposed to users).
  const admin = createClient(url, service);
  const [{ data: inv }, { data: cfgRows }, { data: caller }, { data: co }] = await Promise.all([
    admin.from("member_invites").select("token").eq("email", email).maybeSingle(),
    admin.from("app_config").select("key,value").in("key", ["mail_relay_url", "mail_relay_token", "site_url"]),
    admin.from("members").select("name,position").ilike("email", callerEmail).maybeSingle(),
    company ? admin.from("companies").select("name").eq("id", company).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const cfg: Record<string, string> = {}; for (const r of cfgRows ?? []) cfg[r.key] = r.value;
  const site = (cfg.site_url || req.headers.get("origin") || "").replace(/\/$/, "");
  if (!cfg.mail_relay_url || !cfg.mail_relay_token) return json(500, { error: "not_configured", detail: "Email is not set up: run setup() in the Google Sheet's Apps Script" });
  if (!inv?.token) return json(500, { error: "no_token", detail: "Invitation record missing" });

  const link = `${site}/?invite=${inv.token}`;
  const ROLE_TEXT: Record<string, string> = { admin: "Admin (everything in the company)", manager: "Manager (create and edit records)", staff: "Staff (work on records)", viewer: "Viewer (read and download)" };
  const roleName = level === "editor" ? "Group Admin (full access to every company)" : `${ROLE_TEXT[role]} at ${co?.name || company}`;
  const inviter = (caller?.name || callerEmail) + (caller?.position ? `, ${caller.position}` : "");
  const subject = "You are invited to the Future Ready Group System";
  const text = `Good day${name ? " " + name : ""},

${inviter} has invited you to the Future Ready Group System, the tool Future Ready Nig. Ltd and its companies use to run their work.

Your access: ${roleName}.

Accept the invitation here:
${link}

Sign in with the Google account that received this email (${email}); other accounts will not be recognised. You will be asked for your name, phone number, position and a photo the first time.

If you were not expecting this, ignore this message and nothing will happen.

Future Ready Nigeria Ltd`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#101828;max-width:600px">
<p>Good day${name ? " " + esc(name) : ""},</p>
<p><strong>${esc(inviter)}</strong> has invited you to the <strong>Future Ready Group System</strong>, the tool Future Ready Nig. Ltd and its companies use to run their work.</p>
<p>Your access: <strong>${esc(roleName)}</strong>.</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#2f5bff;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:bold">Accept invitation</a></p>
<p style="font-size:12px;color:#667085">Or copy this link: ${esc(link)}</p>
<p>Sign in with the Google account that received this email (<strong>${esc(email)}</strong>); other accounts will not be recognised. You will be asked for your name, phone number, position and a photo the first time.</p>
<p style="color:#667085">If you were not expecting this, ignore this message and nothing will happen.</p>
<p>Future Ready Nigeria Ltd</p></div>`;

  let status: "sent" | "failed" = "failed", errText = "";
  try {
    const r = await fetch(cfg.mail_relay_url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, redirect: "follow",
      body: JSON.stringify({ token: cfg.mail_relay_token, to: email, name, subject, text, html, kind: "invite" }) });
    const raw = await r.text();
    let out: { ok?: boolean; error?: string } = {};
    try { out = JSON.parse(raw); } catch { out = { error: `Relay answered ${r.status}: ${raw.slice(0, 120)}` }; }
    if (r.ok && out.ok) status = "sent"; else errText = out.error || `Relay ${r.status}`;
  } catch (e) { errText = (e as Error).message; }

  if (status === "sent") await admin.from("members").update({ invite_sent_at: new Date().toISOString() }).ilike("email", email);
  return json(200, { status, email, level, company, role, error: errText || undefined });
});
