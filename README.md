# Future Ready Hiring Desk

Screening desk for Jobberman applicants at Future Ready Nigeria Ltd: import a role, rank applicants by distance from the Obiagu office and qualification, email them a reply form, record calls, shortlist, invite to interview, record outcomes, close the role.

This is the standalone build. It runs on **Supabase** (database, Google sign-in, email function) and is hosted on **Netlify** as static files. The full specification (data model, scoring rules, flows) lives in the companion document *Hiring Desk Rebuild Specification*.

## Layout

| File | Purpose |
| --- | --- |
| `index.html` | The whole app: UI, scoring, import, downloads. Talks to Supabase through a small shim at the bottom of the script. |
| `config.js` | Publishable settings: Supabase URL and publishable key, form link, sheet link. No secrets. |
| `netlify.toml` | Static publish config and security headers. |
| `supabase/migrations/*.sql` | Database schema, row-level security, defaults. Already applied to the project. |
| `supabase/functions/send-email/index.ts` | Edge function that sends outreach and interview emails through Resend. Already deployed. |
| `apps-script/Code.gs` | Hourly Google Apps Script: pulls form replies into the database and mirrors the database into the Google Sheet. |

## One-time setup (owner)

1. **Google sign-in.** In Google Cloud Console create an OAuth 2.0 Client ID (Web application). Authorised redirect URI: `https://muagpehopedxycfiqupg.supabase.co/auth/v1/callback`. Authorised JavaScript origin: your Netlify site URL. In Supabase → Authentication → Providers → Google: paste the Client ID and Secret, enable. In Supabase → Authentication → URL Configuration: set Site URL to the Netlify URL and add it to Redirect URLs.
2. **Email.** Sign up at resend.com, verify your domain, create an API key. In Supabase → Edge Functions → Secrets add `RESEND_API_KEY` and `MAIL_FROM` (e.g. `Future Ready Nigeria <hiring@yourdomain.com>`).
3. **Members.** In Supabase → Table Editor → `members`, add each person's Google email with a level: `viewer`, `contributor` or `editor`. Anyone not listed cannot load data.
4. **Hourly job.** Open the Google Sheet → Extensions → Apps Script → paste `apps-script/Code.gs`. Project Settings → Script properties: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (Supabase → Project Settings → API → service_role; keep it secret). Run `runHourly` once by hand to grant permissions, then Triggers → time-driven, every hour.
5. **Deploy.** Netlify → Add new site → Import from Git → this repository. No build command; publish directory `.`. Every push to `main` redeploys.

## Access levels

Viewer: read and download. Contributor: log calls, add/remove candidates, resolve issues, import roles, send emails, end/reopen/delete roles. Editor: everything plus scoring rules, templates and members. Enforced by row-level security in the database, not only by the page.

## Updating

Edit `index.html`, commit, push. Netlify deploys in under a minute. Database changes go in a new file under `supabase/migrations/` and are applied with the Supabase CLI or dashboard.
