# Future Ready Group System

One web system for Future Ready Nig. Ltd and its companies (Event Management, Press, …): one Google sign-in, a role per person per company, and a module per kind of work. The first module is **Hiring**: import a Jobberman export, rank applicants by distance from the Obiagu office and qualification, email them a reply form, record calls, shortlist, interview, close the role.

It runs on **Supabase** (database, Google sign-in, functions) and is hosted on **Netlify** as static files; no build step. Plan: *Future Ready Group System: Plan*; hiring rules: *Hiring Desk Rebuild Specification*.

## Layout

| File | Purpose |
| --- | --- |
| `index.html` | Shell markup only (sidebar, header, modals). |
| `app/core.js` | Shared state (`FR.S`), helpers, activity log, Supabase document-store shim, module registry. Loaded first. |
| `app/modules/hiring.js` | The Hiring module: scoring, views, import, downloads, email. Registers itself with `FR.registerModule`. Works on the active company's data. |
| `app/shell.js` | Sign-in gate and sign-up, company switcher, navigation and routing (`#/<company>/<view>`), profile, Team page. Loaded last; calls `boot()`. |
| `app/styles.css` | All styles. |
| `config.js` | Publishable settings: Supabase URL and publishable key, form link, sheet link. No secrets. |
| `netlify.toml` | Static publish config and security headers. |
| `supabase/migrations/*.sql` | Database schema, row-level security, defaults. Already applied to the project. |
| `supabase/functions/invite-member/index.ts` | Edge function behind the Team page's Send invitation button: records the invitation (as the caller, so the database checks they are an Admin) and emails the personal link through the relay. Already deployed. |
| `supabase/functions/send-email/index.ts` | Edge function that checks the sender and candidate, then relays the email to the Apps Script, which sends it from Gmail. Already deployed. |
| `apps-script/Code.gs` | Google Apps Script in the sheet: hourly form-reply ingest and sheet mirror, plus the Gmail relay the desk sends email through. |

## One-time setup (owner)

1. **Google sign-in.** In Google Cloud Console create an OAuth 2.0 Client ID (Web application). Authorised redirect URI: `https://muagpehopedxycfiqupg.supabase.co/auth/v1/callback`. Authorised JavaScript origin: your Netlify site URL. In Supabase → Authentication → Providers → Google: paste the Client ID and Secret, enable. In Supabase → Authentication → URL Configuration: set Site URL to the Netlify URL and add it to Redirect URLs.
2. **Members.** Managed inside the app, on the **Team** page (Admins only): invite by email (an invitation email with a personal link goes out through the Gmail relay), approve or decline sign-up requests, change roles, disable or remove people. Roles: **Admin** (`editor`, full access) and **Employee** (`viewer`, read and download). Anyone who signs in with Google without an invitation becomes a *pending* request until an Admin approves it. The last active Admin can never be removed or demoted. Google's OAuth consent screen must be **published** (not in Testing) for people outside its test-user list to sign in.
3. **Email and hourly job (one script).** Open the Google Sheet → Extensions → Apps Script → paste `apps-script/Code.gs` → Save. Project Settings → Script properties: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (Supabase → Project Settings → API keys → secret key; never the publishable key). Deploy → New deployment → Web app, execute as Me, access Anyone → Deploy. Then run the `setup` function once and grant permissions. It registers the script's address and a random token in `app_config` (the `send-email` function relays through it), creates the hourly trigger and runs the first sync. Emails go out from the Google account that ran `setup`; consumer Gmail allows about 100 recipients per day, Google Workspace about 1,500.
4. **Deploy.** Netlify → Add new site → Import from Git → this repository. No build command; publish directory `.`. Every push to `main` redeploys.

## Companies and roles

`companies` holds the group and each business. A person is a **Group Admin** (`members.level = 'editor'`: everything everywhere, can make other Group Admins) or has a role per company in `company_members`: **Admin** (everything in that company, including its team), **Manager** (create and edit records), **Staff** (work on records), **Viewer** (read and download). Hiring data (`roles`, `candidates`, `issues`) carries `company_id`; row-level security uses `my_company_role(company_id)`. The last active Group Admin can never be removed or demoted.

## Adding a module

Create `app/modules/<id>.js`, call `FR.registerModule({ id, name, views: [{ id, title, sub, icon, count? }], start(), onCompany(), render() })`, add the script tag to `index.html` before `app/shell.js`, and list the module id in `companies.modules` for the companies that use it.

## Access levels (hiring module)

Employee (`viewer`): read and download. Admin (`editor`): everything, including scoring rules, templates and the Team page. (`contributor` still exists in the database enum but is not offered in the app.) Enforced by row-level security and security-definer functions in the database, not only by the page. Profiles (surname, first name, other names, phone, position, photo) are completed on first sign-in and editable from the account menu; photos live in the public `avatars` storage bucket, each user writing only to their own folder.

## Updating

Edit `index.html`, commit, push. Netlify deploys in under a minute. Database changes go in a new file under `supabase/migrations/` and are applied with the Supabase CLI or dashboard.
