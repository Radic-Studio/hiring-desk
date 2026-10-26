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

## Customer portal

Each company can have a public link where customers read about it, create an account, send a job request with files and follow it: `/press/` is live (`press/index.html`, shared code in `app/portal.js` and `app/portal.css`; `<body data-company>` picks the company, so `/events/` is the same files with another folder once the Events module exists). The page content comes from `portal_public(company)` (name, `company_settings` module `portal`: tagline, about, phone, whatsapp, email, address, hours, steps; services from the active rate-card items). Customers are ordinary auth users with a `portal_profiles` row; they are never members and the staff app never lets them in. Requests live in `customer_requests` (+ `customer_request_files` in the private `customer-files` bucket, `customer_request_messages` for the thread), numbered `R-0001` per company, status new → quoted → in_progress → done / declined. Staff see them under Press → **Requests**: open one, reply (the customer sees it on the portal), add an internal note, change the status, or **Create quote from this**, which matches or creates the `press_customers` row by email, creates a `press_jobs` quote with the request's details and links it (`request_to_quote`). Supabase → Authentication → URL Configuration → Redirect URLs must include `https://future-ready-hiring-desk.netlify.app/press/` (or `/**`) so confirmation and reset links bring customers back to the portal rather than the staff sign-in.

## Backups (pilot, Supabase Free)

**Status: pilot protection on free infrastructure.** This is a custom off-site backup, not a provider-managed backup or an SLA. The recommended production upgrade is Supabase Pro (daily managed backups, no pausing), deferred until management approves operational use.

Supabase stays the only live system of record. A standalone Google Apps Script (`apps-script/Backup.gs`), owned by a dedicated backup Google account, copies the database off-site:

| Copy | When | Where | Kept |
| --- | --- | --- | --- |
| Rolling JSON | every 6 hours | `Future Ready Backups/database/rolling/future-ready-db-<UTC>.json` | 7 days |
| Nightly JSON | 02:00 Lagos | `…/database/nightly/` | 90 days |
| Month-end JSON | last day of the month | `…/database/monthly/future-ready-db-monthly-YYYY-MM.json` | 24 months |
| Readable spreadsheet | nightly | `Future Ready Backups` spreadsheet in the same folder | latest only |

Each JSON has `backup_format`, `generated_at`, `project`, `schema_version`, `table_list`, `row_counts`, `total_rows`, `status` and `checksum_sha256` (SHA-256 of `JSON.stringify(tables)`), then the data. The export comes from `public.backup_export()` (service role only): every public table is included automatically; columns named like token/secret/password are dropped and secret `app_config` values redacted; sign-in accounts are listed without passwords or sessions. The JSON is for restore and may hold personal data: the Drive folder must be shared with Group Admins only. The spreadsheet leaves out `app_config`, `member_invites`, `counters`, staff contact/address/birth/emergency/notes columns, profile phone numbers, leave reasons and history columns; every tab is protected (owner-only edit). Staff document files and Press/portal files are **not** copied yet (pending approval).

Health: every run writes a row to `public.sync_runs` (kind, start, finish, tables, rows, file, checksum, status, error; Group Admins can read it) and a line to the spreadsheet's "Backup log". A failed run writes `backup-reports/backup-FAILED-…txt`, emails `ALERT_EMAILS`, never deletes old copies, and is queued for `sync_runs` if Supabase itself was unreachable. The first good run after failures sends a "recovered" email. Old copies are trashed only after a verified good run (Drive keeps trash 30 days).

**Setup (once, in the backup Google account):** script.google.com → New project, name it "Future Ready Backups" → paste `apps-script/Backup.gs` → Project Settings: time zone (GMT+01:00) Lagos; Script properties `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ALERT_EMAILS` → run `setup` and grant access. It creates the folders and spreadsheet, two triggers, records the folder and spreadsheet IDs in `app_config` (`backup_drive_folder_id`, `backup_sheet_id`, `backup_account`), and takes the first backup. `status` prints the state; `backupNow` takes an extra copy.

Recorded locations (fill in after setup; IDs are not secrets, keys are never written here):

| Item | Value |
| --- | --- |
| Backup account owner | radiantb3@gmail.com (script project "Future Ready Backups", set up 2026-10-26) |
| Recovery email / phone on that account | collinsonuora05@gmail.com (owner to confirm 2-Step Verification is on) |
| Drive folder ID | `1YeNyM7ZF-RHFmTgxB7zEv-YJlxk3vhPJ` (also in `app_config.backup_drive_folder_id`) |
| Spreadsheet ID | `1No3W-7ucMWB76HpWdbZhcwuGrDPplsfL5tk51q2tNrs` (also in `app_config.backup_sheet_id`) |

Tests: `apps-script/tests/` runs `Backup.gs` unchanged against simulated Drive, Sheets, Mail, triggers and Supabase (`node apps-script/tests/backup.test.js`, needs a `fixture_export.json` produced by `select public.backup_export()`, which is not committed because it holds personal data).

**Free-plan pausing.** Supabase pauses a Free project after 7 days without activity. While paused the app and portal cannot load data; data is kept. To restore: Supabase dashboard → the project → **Restore project** (takes a few minutes), then reload the app. No artificial traffic is generated to avoid pausing; the backup job reads the database every 6 hours as part of its real work.

## Deleting and restoring (soft deletes)

Nothing in the business tables is removed by an ordinary delete. Deleting a hiring role, candidate, staff record, staff document, rate-card item, payment, job file or material (and, by staff action, jobs, customers and customer requests) calls `soft_delete(entity, id)`: the row gets `deleted_at`, `deleted_by` and a `delete_batch`, and the rows that belong to it go with it in the same batch (role → its candidates and their issues; candidate → issues; staff → documents and leave; job → payments and files). One row in `deletions` records the action. A restrictive policy hides deleted rows from everyone except Group Admins; another lets only Group Admins hard-delete. The app always lists live rows only.

Group Admins see **Group → Recently deleted**: what was deleted, by whom, when and with what. **Restore** (`restore_deleted`) brings the whole batch back; a child whose parent is still deleted must wait for the parent. **Delete permanently** (`purge_deleted`) needs the record's name typed exactly; nothing is ever purged automatically. Stored files are kept on soft delete (so a restore brings them back) and are not removed by a purge; remove them in Supabase Storage by hand if needed. Who may delete is unchanged: Hiring = Group Admins; jobs, customers, job files, customer requests = Staff and above in that company; staff records, documents, leave, rate card, materials, payments = Managers and Admins.

The Hiring Sheet script (`apps-script/Code.gs`) leaves deleted roles, candidates and issues out of the Sheet and out of form matching; re-paste it into the Hiring Sheet's Apps Script to pick this up. Backups include deleted rows with their `deleted_at`, so a restore from backup keeps them deleted. Rollback notes are at the top of `supabase/migrations/20261026_soft_deletes.sql`; `supabase/rollback/stage2_policies_before.sql` holds the earlier policies.

## Versions and the operations log

Every write to the 13 business tables is stamped by the database (`stamp_row` trigger): `version` is 1 on insert and goes up by one on every update, whatever the client sends; each write gets a fresh `op_id` (or the one a server function sets in `fr.op_id`, used from Stage 4); `updated_at` / `updated_by` are set (the signed-in person's confirmed email, or `service` for scripts and server functions). A second trigger (`log_op`) writes one row per write to `public.ops_log`: op_id, entity, record, company, action (insert, update, soft_delete, restore, delete), result, base and resulting version, actor, source, the changed fields and the time. Staff phone, email, address, birth date, emergency contacts, notes and photo, leave reasons and document paths are logged as `[set]` / `[changed]`, never their values; `history` columns and values over 2,000 characters are left out. Only Group Admins can read the log; nobody can edit or delete it through the API. The log is included in the backups.

## Saving: one safe write path

Every change to a business record goes through one database function, `apply_op(op_id, entity, id, action, fields, base_version)` (migration `20261026_apply_op.sql`). In the app it is `FR.save(table, id, fields, { obj })`; the Hiring screens reach it through `FR.dbShim`, which sends only the fields that changed.

- **No double saves.** The app makes an operation id for each save and resends the same id if the connection drops (up to two retries). The database remembers every id in `op_receipts`; a repeat returns `duplicate` and changes nothing. A resent payment or message is never recorded twice.
- **No silent overwrites.** The app sends the version it was showing. If someone else has since changed the same field to a different value, their value stays, the attempt is kept in `public.conflicts` (with both values; staff personal fields masked) and the person sees "Someone else changed … meanwhile". Changes to different fields merge. A person's own earlier saves never count as a conflict. `history` lists are merged, never shortened.
- **Same rules as before.** `apply_op` runs as the signed-in person, so row-level security decides who may write; refusals come back as plain messages and are logged. Deleted records cannot be edited until restored.
- **Logged.** Applied, duplicate, conflict and refused attempts all appear in `ops_log` with the operation id.
- Helper functions live in the `fr_internal` schema, which the API does not expose, so nobody can call them to forge log or conflict rows.
- Still written directly (by design): app settings, Press company settings, the customer name copied onto many jobs when a customer is renamed, files attached by customers in the portal, and the server functions (numbering, request to quote, portal request form). Customer messages in the portal use `apply_op`.
- Resolving conflicts (Keep current / Take incoming / Edit and merge) is Stage 7; until then Group Admins can read open conflicts in the `conflicts` table.

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
