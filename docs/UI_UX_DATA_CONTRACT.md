# UI/UX data contract

What each screen may read, what it may change, and which states it must show. The redesign may change layout, wording
style, navigation and components freely. It may not change how data is read or written. Anything the redesign needs
that is not listed here is a backend change and goes through change control first.

Machine-readable versions: `docs/contracts/enums.json` (every fixed list and result state), `permissions.json` (who
may do what), `rpc.json` (every callable function), `entities.schema.json` (every row shape).

Status: frozen 26 Oct 2026 (see `docs/BACKEND_FREEZE.md`).

## Rules for every screen

1. **One write path.** Records are saved only through `FR.save(table, id, fields, opts)` (which calls `apply_op`).
   Workflow and settings actions use the named functions in `rpc.json`. No screen writes a table directly.
2. **Show the result honestly.** Every save ends in one of the six states below. The wording rules are fixed.

   | Result | What the screen shows | Wording rule |
   |---|---|---|
   | APPLIED | the saved row | may say "Saved" |
   | DUPLICATE | the returned row | treat as saved; no error |
   | QUEUED | the change, marked as pending | exactly "Saved on this device. Waiting to synchronize." Never "Saved" |
   | CONFLICT | the latest row, plus a notice | say which field clashed and that a Group Admin will review it |
   | REFUSED | nothing changed | the server's message as written; no automatic retry |
   | FAILED | nothing changed | say nothing was saved and how to retry |

3. **Hide what the role cannot do, but never rely on hiding.** Use `permissions.json`. The database refuses anyway.
4. **Deleted records** are invisible except to Group Admins (in Recently deleted). Never show a delete as permanent;
   only *Delete permanently* in Recently deleted is.
5. **Offline.** Only the changes allowed by `enums.json → never_queued_offline` may be queued. The others must say
   nothing was saved. Never queue payments, stock movements, staff or leave records, cancellations or deletions.
6. **Session expired** (`code: session_expired`): show "Your sign-in has expired, so nothing was saved. Reload the
   page (sign in again if asked), then repeat the change."
7. **Times** are stored in UTC and shown in Lagos time (WAT).
8. **Money** is naira, two decimals, stored as numbers. Totals come from the saved job, not recalculated on screen.
9. **Private staff fields** (address, date of birth, emergency contact, notes, leave reason, documents) may appear only
   on screens the database lets the person read. If the read returns nothing, show nothing; no placeholders that hint
   at hidden values.

Every list screen needs these states: loading, empty (with the next action), error (with retry), and "data on screen
as of" when Degraded.

## Shell and status bar (all screens)

| | |
|---|---|
| Reads | `my_access()`, `companies`, `members` (Team only), `backup_last_success()` |
| Shows | company switcher; status pill **Live / Degraded / Offline** (definitions in `enums.json`); "Waiting to sync" count |
| Degraded/Offline panel | data-on-screen time, waiting count, last successful backup time, list of what is unavailable |
| Outbox panel | each kept change with status (`waiting`, `sending`, `conflict`, `refused`, `failed`), attempts, last error; *Try again* for failed, *Dismiss* for conflict/refused |
| Profile | `update_my_profile(p)`: surname, first name (required), other names, phone (required), position (required), photo (avatars bucket, own folder) |
| Sign-in / access | `request_access`, `accept_invite`, `public_companies` |

## Dashboard (Hiring)

| | |
|---|---|
| Who | Group Admins |
| Reads | `roles`, `candidates`, `issues` (live, not deleted) |
| Shows | per open role: total, contacted, awaiting, attempted, pending; location and availability mix; interview shortlist count; open issues |
| Writes | none |

## Hiring: Candidates

| | |
|---|---|
| Who | Group Admins (read and write) |
| Reads | `candidates` for the selected role; `settings.scoring` for the score |
| Writes | `FR.save("candidates", id, fields, {obj})` with `version` as base. Fields: status (`candidate_status`), mode, availability, location, state, relocation, qualification, manual, adjust, notes, next_action, last_contact, attempts, interview, history (append only; the server merges) |
| Actions | Delete → `soft_delete("candidates", id)` (also hides its issues). Email → `send-email` edge function (120/hour per sender) |
| Offline | allowed (queued) |
| States | conflict notice on clashing fields; refused if the candidate was deleted meanwhile |

## Hiring: Interview (second interview list)

| | |
|---|---|
| Reads | `candidates` that meet the role's criteria, ranked by score; `settings.interviewEmail` |
| Writes | candidate `interview` object {date, time, notes, score, outcome} via `FR.save("candidates")`; invitation email via `send-email` kind `interview` |
| Export | CSV of the ranked list (screen-side; no new data) |

## Hiring: Issues

| | |
|---|---|
| Reads | `issues` (open first) |
| Writes | `FR.save("issues", id, {resolved, resolution, resolved_at, resolved_by})` |
| Delete | `soft_delete("issues", id)` |

## Hiring: Import and History

| | |
|---|---|
| Import | creates a `roles` row and its `candidates`/`issues` through the save shim (`S.db.doc(...).set`, which calls `apply_op`); ids are built from the role and serial number, so re-importing the same file updates instead of duplicating |
| History | closed roles with `final_stats`; Reopen is `FR.save("roles", id, {status:"open", reopened_at})` |
| Settings (Hiring) | scoring weights, outreach and interview email text: `save_app_settings(id, data)`, Group Admins only |

## Press

| Screen | Reads | Writes |
|---|---|---|
| Jobs | `press_jobs`, `press_customers`, `press_payments`, `press_files` | new quote: `next_number(company,'Q')` then `FR.save("press_jobs", …, {action:"insert"})`; edits and stage changes: `FR.save("press_jobs")` with base version; files: upload to `press-files/<company>/…` then `FR.save("press_files")`; PDF email: `send-doc` (60/hour) |
| Requests | `customer_requests`, `customer_request_messages`, `customer_request_files` (thread loads on open) | status/note: `FR.save("customer_requests")`; reply: `FR.save("customer_request_messages", {author:"staff"})`; make a quote: `request_to_quote(id)` |
| Customers | `press_customers` with balances computed from jobs and payments | `FR.save("press_customers")`; renaming updates job copies automatically |
| Materials | `press_materials`, `press_material_moves` | material details: Managers, `FR.save("press_materials")`; stock in/out: Staff and above, `FR.save("press_material_moves", {action:"insert", delta})`; quantity follows automatically; never edit quantity on screen |
| Money | jobs, payments | payment: `next_number(company,'R')` then `FR.save("press_payments", {action:"insert"})`, online only; receipt/invoice PDF via `send-doc` |
| Rate card | `press_rate_items`, `company_settings(press)` | rate items: Managers, `FR.save("press_rate_items")`; letterhead, bank, prefixes: Company Admins, `save_company_settings(company,'press',data)` |

Press rules: payments, stock moves and cancellations are never queued. Payment amount must be greater than zero.
A job's customer must belong to the same company (the database refuses otherwise).

## People: Staff

| | |
|---|---|
| Who | directory: every company role; private section: Managers and the person themselves |
| Reads | `staff` (directory), `staff_private` (returns only rows the person may see), `staff_documents` (managers and self), photos from `avatars` |
| Writes | Managers: `FR.save("staff", id, directoryFields, {obj})` and, separately, `FR.save("staff_private", id, privateFields, {obj} or {action:"save"})`. Never send private fields in a `staff` save: the server refuses it |
| Documents | upload to `staff-docs/<company>/<staff>/…` then `FR.save("staff_documents")`; managers only |
| Delete | Managers: `soft_delete("staff", id)` also hides private details, documents and leave |
| Offline | not allowed for any staff record |

## People: Leave

| | |
|---|---|
| Reads | managers: all `leave_requests`; others: their own; everyone with a company role: `leave_calendar(company)` (approved leave: name and dates only) |
| Writes | request: `FR.save("leave_requests", {action:"insert"})` for own staff record (or any, for managers); cancel while pending: `FR.save("leave_requests", id, {status:"cancelled"})`; decide: `leave_decide(id, 'approved'|'declined', note)`; nobody decides their own request except a Group Admin |
| Offline | not allowed |

## Team (Group and company admins)

| | |
|---|---|
| Reads | `members`, `company_members`, `member_invites` count via functions |
| Writes | `admin_invite`, `admin_approve`, `admin_set_member`, `admin_set_company_role`, `admin_remove_member`, `admin_save_company`; invitation email via `invite-member` |
| Guards | the last Group Admin cannot be removed or demoted |

## Customer portal (public page)

| | |
|---|---|
| Who | anyone (page text); signed-in customers (requests) |
| Reads | `portal_public(company)` without sign-in; own `customer_requests`, messages, files, `portal_profiles` |
| Writes | new request: `portal_submit_request(…, p_client_ref)` (retry-safe); message: `apply_op` insert on `customer_request_messages` with author `customer`; file: upload to `customer-files/<company>/<uid>/<request>/…` then `portal_attach_file(...)`; profile: own `portal_profiles` row |
| Never shows | prices from the rate card, staff names beyond message authors, other customers |

## Backups (Group Admins; status panel)

| | |
|---|---|
| Reads | `sync_runs` (latest per kind), `backup_last_success()` for everyone else |
| Shows | last rolling, nightly and monthly run with time, rows, file name; next rolling due; overdue warning after 8 h (rolling) or 26 h (nightly). Restore tests are recorded in `sync_runs` (`kind = restore_test`) but NOT shown yet; the redesign may add a "last restore test" line |
| Writes | none from the app. Backups run in Apps Script in the backup Google account |

## Recently deleted (Group Admins)

| | |
|---|---|
| Reads | `deletions` (open: not restored or purged; recent history: last 50) |
| Writes | `restore_deleted(batch)`; `purge_deleted(batch, label)` after typing the label exactly; purge is the only irreversible action in the app and must say so |

## Conflicts (Group Admins)

| | |
|---|---|
| Reads | `conflicts` (open first), current record |
| Writes | `resolve_conflict(id, choice, values, seen_version, op_id)` with choice `keep_current`, `take_incoming` or `merged`; every resolution is logged |
| Shows | field, current value, incoming value, who and when; refuses if the record changed again since the screen loaded (reload and decide again) |

## Settings

| Setting | Where | Who | Function |
|---|---|---|---|
| Hiring scoring, outreach email, interview email | Hiring | Group Admin | `save_app_settings` |
| Press letterhead, bank details, number prefixes | Press → Rate card | Company Admin | `save_company_settings(company,'press',data)` |
| Portal text (about, steps, hours, contacts) | NOT IMPLEMENTED in the app (set once by SQL). The function exists: `save_company_settings(company,'portal',data)`, Company Admin | Company Admin | `save_company_settings` |
| Companies and modules | Team | Group Admin | `admin_save_company` |
