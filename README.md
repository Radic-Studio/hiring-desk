# Future Ready Group System

One web system for Future Ready Nig. Ltd and its companies (Event Management, Press, …): one Google sign-in, a role per person per company, and a module per kind of work. The first module is **Hiring**: import a Jobberman export, rank applicants by distance from the Obiagu office and qualification, email them a reply form, record calls, shortlist, interview, close the role.

It runs on **Supabase** (database, Google sign-in, functions) and is hosted on **Netlify** as static files; no build step. Plan: *Future Ready Group System: Plan*; hiring rules: *Hiring Desk Rebuild Specification*.

## Layout

| File | Purpose |
| --- | --- |
| `index.html` | Shell markup only (sidebar, header, modals). |
| `app/core.js` | Shared state (`FR.S`), helpers, activity log, Supabase document-store shim, module registry. Loaded first. |
| `app/modules/hiring.js` | The Hiring module: scoring, views, import, downloads, email. Registers itself with `FR.registerModule`. Works on the active company's data. |
| `app/modules/press.js` | The Press module: customers, rate card and letterhead, jobs (quote → accepted → design → proof → print → finishing → ready → delivered), quote/invoice/receipt PDFs (jsPDF), payments with receipt numbers, materials stock with movements, job files. Email with PDF attached through `send-doc`. |
| `app/modules/people.js` | The People module: staff directory with details, documents (private `staff-docs` bucket, signed links) and leave (requests, approvals, who is away). A hired candidate becomes a staff record from the candidate drawer. |
| `app/shell.js` | Sign-in gate and sign-up, company switcher, navigation and routing (`#/<company>/<view>`), profile, Team page. Loaded last; calls `boot()`. |
| `app/styles.css` | All styles. Tokens at the top come from the Brand System v2 (`app/brand/design_tokens.json`). |
| `app/brand/` | Brand assets: master and sub-brand lockups/symbols/app icons (SVG masters, never redrawn), icon sprite, email banners, `logos.js` (rasterised lockups for PDF letterheads), `BRAND_GUIDELINES.pdf`. |
| `config.js` | Publishable settings: Supabase URL and publishable key, form link, sheet link. No secrets. |
| `netlify.toml` | Static publish config and security headers. |
| `supabase/migrations/*.sql` | Database schema, row-level security, defaults. Already applied to the project. |
| `supabase/functions/send-doc/index.ts` | Edge function: emails a company document (quote, invoice, receipt) with a PDF attachment through the Gmail relay; caller must have write access to the company. |
| `supabase/functions/invite-member/index.ts` | Edge function behind the Team page's Send invitation button: records the invitation (as the caller, so the database checks they are an Admin) and emails the personal link through the relay. Already deployed. |
| `supabase/functions/send-email/index.ts` | Edge function that checks the sender and candidate, then relays the email to the Apps Script, which sends it from Gmail. Already deployed. |
| `apps-script/Code.gs` | Google Apps Script in the sheet: hourly form-reply ingest and sheet mirror, plus the Gmail relay the desk sends email through. |

## One-time setup (owner)

1. **Google sign-in.** In Google Cloud Console create an OAuth 2.0 Client ID (Web application). Authorised redirect URI: `https://muagpehopedxycfiqupg.supabase.co/auth/v1/callback`. Authorised JavaScript origin: your Netlify site URL. In Supabase → Authentication → Providers → Google: paste the Client ID and Secret, enable. In Supabase → Authentication → URL Configuration: set Site URL to the Netlify URL and add it to Redirect URLs.
2. **Members.** Managed inside the app, on the **Team** page (Admins only): invite by email (an invitation email with a personal link goes out through the Gmail relay), approve or decline sign-up requests, change roles, disable or remove people. Roles: **Admin** (`editor`, full access) and **Employee** (`viewer`, read and download). Anyone who signs in (Google, or email + password after confirming the address) without an invitation becomes a *pending* request until an Admin approves it. The last active Admin can never be removed or demoted. Google's OAuth consent screen must be **published** (not in Testing) for people outside its test-user list to sign in.
3. **Email and hourly job (one script).** Open the Google Sheet → Extensions → Apps Script → paste `apps-script/Code.gs` → Save. Project Settings → Script properties: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (Supabase → Project Settings → API keys → secret key; never the publishable key). Deploy → New deployment → Web app, execute as Me, access Anyone → Deploy. Then run the `setup` function once and grant permissions. It registers the script's address and a random token in `app_config` (the `send-email` function relays through it), creates the hourly trigger and runs the first sync. Emails go out from the Google account that ran `setup`; consumer Gmail allows about 100 recipients per day, Google Workspace about 1,500.
4. **Email + password accounts.** Supabase → Authentication → Providers → Email: keep **Enable email provider** on and **Confirm email** on (a password account must prove it owns its address before it can claim an invitation or request access; `my_email()` returns nothing for unconfirmed accounts). Minimum password length 8. Then route the auth emails through the Gmail relay: Supabase → Authentication → Hooks → **Send Email** → HTTPS hook, URL `https://muagpehopedxycfiqupg.supabase.co/functions/v1/auth-email`, Generate secret, copy it; Edge Functions → Secrets → add `SEND_EMAIL_HOOK_SECRET` with that value; enable the hook. The `auth-email` function verifies the signature and sends branded confirm, reset, email-change and code emails through the relay. Until the hook is on, Supabase sends plain emails from its own sender, limited to a few per hour. Passwords: the sign-in card has Forgot password; signed-in people set or change a password from the profile dialog, which also gives Google-only accounts a password.
5. **Deploy.** Netlify → Add new site → Import from Git → this repository. No build command; publish directory `.`. Every push to `main` redeploys.

## Companies and roles

`companies` holds the group and each business. A person is a **Group Admin** (`members.level = 'editor'`: everything everywhere, can make other Group Admins) or has a role per company in `company_members`: **Admin** (everything in that company, including its team), **Manager** (create and edit records), **Staff** (work on records), **Viewer** (read and download). Hiring data (`roles`, `candidates`, `issues`) carries `company_id`; row-level security uses `my_company_role(company_id)`. The last active Group Admin can never be removed or demoted.

## People

`staff` (home company plus `companies[]` for people who also work elsewhere; `member_email` links a record to a login), `staff_documents` (metadata; files in the private `staff-docs` bucket under `<company>/<staff>/`), `leave_requests` (status pending → approved/declined through `leave_decide()`, which refuses deciding your own request). Admins and Managers of the home company edit; everyone with a role in the company reads; a linked member requests leave for themself.

## Press

`press_customers`, `press_rate_items`, `press_jobs` (one record from quote to delivery; `number` like `FRP-Q-0001` from `next_number()`), `press_payments` (receipt numbers `FRP-R-0001`), `press_materials` + `press_material_moves` (a trigger keeps the quantity), `press_files` (private `press-files` bucket), `company_settings` (module `press`: letterhead, bank, terms, prefix, deposit %, VAT %). Staff and up write; Managers and Admins manage the rate card and materials; Admins edit the letterhead.

## Adding a module

Create `app/modules/<id>.js`, call `FR.registerModule({ id, name, views: [{ id, title, sub, icon, count? }], start(), onCompany(), render() })`, add the script tag to `index.html` before `app/shell.js`, and list the module id in `companies.modules` for the companies that use it.

## Access levels (hiring module)

Employee (`viewer`): read and download. Admin (`editor`): everything, including scoring rules, templates and the Team page. (`contributor` still exists in the database enum but is not offered in the app.) Enforced by row-level security and security-definer functions in the database, not only by the page. Profiles (surname, first name, other names, phone, position, photo) are completed on first sign-in and editable from the account menu; photos live in the public `avatars` storage bucket, each user writing only to their own folder.

## Updating

Edit `index.html`, commit, push. Netlify deploys in under a minute. Database changes go in a new file under `supabase/migrations/` and are applied with the Supabase CLI or dashboard.

## Brand

Visual rules come from the Future Ready Brand System v2 (`app/brand/BRAND_GUIDELINES.pdf`, tokens in `app/brand/design_tokens.json`). Future Green is the only action colour; Press Blue and Events Coral mark company context (switcher, header badge, PDF lockup) and never success or error. Logos are the supplied SVG masters; the wordmark is outlined artwork and is not typeset. Fonts: Sora (display), IBM Plex Sans (body), IBM Plex Mono (numbers).

### Sign-in page

Split card on a deep-green canvas: form on the left (lockup, Sign in / Request access toggle, one Google button), a company showcase on the right that cross-fades through twelve photos with a floating promo card and caption (`GATE_SLIDES` in `app/shell.js`). On phones the showcase sits above the form. The photos are Unsplash photographs under the Unsplash Licence (free for commercial use, no attribution required; the photographer is still named in the caption) and are served from Unsplash's CDN at 800/1400 px. To replace them with Future Ready's own photography, put JPEGs in `app/brand/photos/` and change the `img()` helper in `gateShow` to point at them. If every image fails to load, the panel falls back to the brand gradient and the controls hide.

Not yet implemented from the behaviour spec (`06_UI_UX/UI_UX_BEHAVIOR_SPEC.md` in the kit): collapsible 80 px sidebar at 900–1119 px, dirty-form guard on company switch and drawer close, typed-name confirmation for permanent role deletion, drag-and-drop on the Press board, "Closed" stage after Delivered, table-to-card conversion for People and Press tables under 720 px, skeleton loading states.
