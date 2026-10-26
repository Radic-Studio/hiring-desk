// Future Ready Group System: Supabase Auth "Send Email" hook.
// Supabase calls this instead of its own mailer for confirm-email, password-reset, email-change and similar messages.
// The message is built here in the Future Ready style and sent through the Gmail relay registered in public.app_config.
// Security: the request carries a Standard Webhooks signature made with the hook secret (SEND_EMAIL_HOOK_SECRET function secret);
// anything unsigned or badly signed is refused. Deployed as `auth-email` with verify_jwt: false (Supabase Auth has no user JWT).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Webhook } from "npm:standardwebhooks@1.0.0";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const esc = (s: string) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const brandHtml = (title: string, bodyHtml: string, sub: string) => `<!doctype html><html><body style="margin:0;background:#F6F8F7;font-family:Arial,sans-serif;color:#10211D"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px"><table role="presentation" width="600" style="max-width:600px;background:#fff;border:1px solid #DCE5E0;border-radius:12px;overflow:hidden"><tr><td style="background:#073F35;padding:24px 32px;color:#fff"><strong style="font-size:20px;letter-spacing:.02em">FUTURE READY</strong><div style="font-size:12px;color:#B9F2D8;margin-top:6px">${esc(sub)}</div></td></tr><tr><td style="padding:28px 32px;font-size:15px;line-height:1.55">${title ? `<h1 style="font-size:22px;margin:0 0 14px">${esc(title)}</h1>` : ""}${bodyHtml}</td></tr><tr><td style="padding:16px 32px;border-top:1px solid #DCE5E0;font-size:12px;color:#63736D">Future Ready Nig. Ltd. · Udeorji Street, Obiagu, Enugu, Nigeria</td></tr></table></td></tr></table></body></html>`;
const button = (href: string, label: string) => `<p style="margin:24px 0"><a href="${esc(href)}" style="display:inline-block;background:#0D7A62;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px">${esc(label)}</a></p><p style="font-size:13px;color:#63736D">If the button does not work, use this link:<br><a href="${esc(href)}" style="color:#0D7A62">${esc(href)}</a></p>`;

type Hook = { user: { email: string; user_metadata?: Record<string, unknown> }; email_data: { token: string; token_hash: string; redirect_to: string; email_action_type: string; site_url: string; token_new?: string; token_hash_new?: string } };

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const secret = Deno.env.get("SEND_EMAIL_HOOK_SECRET") || "";
  if (!secret) return json(500, { error: "SEND_EMAIL_HOOK_SECRET is not set" });
  const raw = await req.text();
  let hook: Hook;
  try {
    const wh = new Webhook(secret.replace(/^v1,whsec_/, ""));
    hook = wh.verify(raw, Object.fromEntries(req.headers)) as Hook;
  } catch (e) { return json(401, { error: "bad_signature", detail: (e as Error).message }); }

  const url = Deno.env.get("SUPABASE_URL")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, service);
  const { data: cfgRows } = await admin.from("app_config").select("key,value").in("key", ["mail_relay_url", "mail_relay_token", "site_url"]);
  const cfg: Record<string, string> = {}; for (const r of cfgRows ?? []) cfg[r.key] = r.value;
  if (!cfg.mail_relay_url || !cfg.mail_relay_token) return json(500, { error: "not_configured", detail: "Email is not set up: run setup() in the Google Sheet's Apps Script" });

  const d = hook.email_data, to = hook.user.email, site = (cfg.site_url || d.site_url || "").replace(/\/$/, "");
  const name = String(hook.user.user_metadata?.full_name || hook.user.user_metadata?.name || "").trim();
  const hi = `Good day${name ? " " + name : ""},`;
  const verify = (hash: string, type: string, redirect: string) => `${url}/auth/v1/verify?token=${encodeURIComponent(hash)}&type=${encodeURIComponent(type)}&redirect_to=${encodeURIComponent(redirect || site)}`;
  let subject = "", text = "", html = "";
  const t = d.email_action_type;
  if (t === "signup") {
    const link = verify(d.token_hash, "signup", d.redirect_to);
    subject = "Confirm your email for the Future Ready Group System";
    text = `${hi}\n\nConfirm this address to finish creating your account:\n${link}\n\nAfter confirming, sign in and choose the company and access you need; an Admin then approves it.\n\nIf you did not create this account, ignore this message.\n\nFuture Ready Nigeria Ltd`;
    html = brandHtml("Confirm your email", `<p>${esc(hi)}</p><p>Confirm this address to finish creating your account.</p>${button(link, "Confirm email")}<p>After confirming, sign in and choose the company and access you need; an Admin then approves it.</p><p style="color:#63736D">If you did not create this account, ignore this message.</p>`, "Account confirmation");
  } else if (t === "recovery") {
    const link = verify(d.token_hash, "recovery", d.redirect_to);
    subject = "Reset your Future Ready password";
    text = `${hi}\n\nUse this link to choose a new password:\n${link}\n\nThe link works once and expires in an hour. If you did not ask for this, ignore this message; your password stays as it is.\n\nFuture Ready Nigeria Ltd`;
    html = brandHtml("Reset your password", `<p>${esc(hi)}</p><p>Use the button to choose a new password. The link works once and expires in an hour.</p>${button(link, "Choose a new password")}<p style="color:#63736D">If you did not ask for this, ignore this message; your password stays as it is.</p>`, "Password reset");
  } else if (t === "magiclink") {
    const link = verify(d.token_hash, "magiclink", d.redirect_to);
    subject = "Your Future Ready sign-in link";
    text = `${hi}\n\nSign in with this link:\n${link}\n\nIt works once and expires in an hour.\n\nFuture Ready Nigeria Ltd`;
    html = brandHtml("Your sign-in link", `<p>${esc(hi)}</p>${button(link, "Sign in")}<p style="color:#63736D">It works once and expires in an hour.</p>`, "Sign-in link");
  } else if (t === "email_change" || t === "email_change_current") {
    const hash = t === "email_change" ? (d.token_hash_new || d.token_hash) : d.token_hash;
    const link = verify(hash, "email_change", d.redirect_to);
    subject = "Confirm your new email for the Future Ready Group System";
    text = `${hi}\n\nConfirm the change of email on your account:\n${link}\n\nIf you did not ask for this, sign in and change your password.\n\nFuture Ready Nigeria Ltd`;
    html = brandHtml("Confirm your new email", `<p>${esc(hi)}</p><p>Confirm the change of email on your account.</p>${button(link, "Confirm new email")}<p style="color:#63736D">If you did not ask for this, sign in and change your password.</p>`, "Email change");
  } else if (t === "reauthentication") {
    subject = "Your Future Ready verification code";
    text = `${hi}\n\nYour code is ${d.token}. It expires in a few minutes.\n\nFuture Ready Nigeria Ltd`;
    html = brandHtml("Your verification code", `<p>${esc(hi)}</p><p style="font-size:28px;font-weight:700;letter-spacing:.2em">${esc(d.token)}</p><p style="color:#63736D">It expires in a few minutes.</p>`, "Verification");
  } else if (t === "invite") {
    const link = verify(d.token_hash, "invite", d.redirect_to);
    subject = "You are invited to the Future Ready Group System";
    text = `${hi}\n\nAccept the invitation here:\n${link}\n\nFuture Ready Nigeria Ltd`;
    html = brandHtml("You are invited", `<p>${esc(hi)}</p>${button(link, "Accept invitation")}`, "Team invitation");
  } else return json(400, { error: "unknown_action", detail: t });

  const r = await fetch(cfg.mail_relay_url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, redirect: "follow",
    body: JSON.stringify({ token: cfg.mail_relay_token, to, name, subject, text, html, kind: "auth:" + t }) });
  const body = await r.text();
  let out: { ok?: boolean; error?: string } = {}; try { out = JSON.parse(body); } catch { out = { error: `Relay answered ${r.status}: ${body.slice(0, 120)}` }; }
  if (!r.ok || !out.ok) return json(500, { error: "relay_failed", detail: out.error || `Relay ${r.status}` });
  return json(200, {});
});
