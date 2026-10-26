# Backend freeze

Frozen: 26 Oct 2026. Live database `muagpehopedxycfiqupg` (Supabase Free, eu-west-1). Schema snapshot:
`supabase/schema/schema_snapshot.sql` (generated 26 Oct from live; matches live on all structure and rights checks).

From now on the UI/UX redesign builds on this backend as it is. Any change below this line (tables, columns, policies,
functions, triggers, edge functions, backup format) needs change control: back up, state the change, keep a rollback,
regenerate the snapshot, rerun the tests, update the contracts.

## 1. Architecture

| Part | What it is |
|---|---|
| Browser app | static site (Netlify), plain JavaScript modules: shell, hiring, people, press, portal, outbox, status, conflicts |
| Database | Supabase Postgres, the single live system of record. Row-level security on every table |
| Server code | database functions (`apply_op` and named functions) and four edge functions: `send-email`, `send-doc`, `invite-member`, `auth-email` |
| Files | Supabase Storage buckets: `avatars`, `staff-docs`, `press-files`, `customer-files` |
| Email | Gmail relay (Apps Script web app in collinsonuora05) called only by edge functions |
| Backups | Apps Script in radiantb3: JSON to Google Drive every 6 h, nightly, month-end, plus a readable spreadsheet. Google Sheets is a copy, never a source |
| Device storage | IndexedDB outbox (`fr-outbox`) for changes waiting to synchronize; nothing else is kept on the device |

## 2. Data model (31 tables)

| Area | Tables |
|---|---|
| Group and access | `companies`, `members`, `company_members`, `member_invites`, `settings`, `company_settings`, `app_config`, `counters` |
| Hiring | `roles`, `candidates`, `issues` |
| People | `staff` (directory), `staff_private` (address, date of birth, emergency contact, notes), `staff_documents`, `leave_requests` |
| Press | `press_customers`, `press_rate_items`, `press_jobs`, `press_payments`, `press_files`, `press_materials`, `press_material_moves` |
| Portal | `customer_requests`, `customer_request_messages`, `customer_request_files`, `portal_profiles` |
| Safety | `ops_log`, `op_receipts`, `conflicts`, `deletions`, `sync_runs` |

Every business record carries `version`, `op_id`, `updated_at`, `updated_by`, `deleted_at`, `deleted_by`,
`delete_batch`. Exact columns: `docs/contracts/entities.schema.json`.

Integrity enforced in the database: foreign keys; same-company triggers (a job's customer, a payment's job, a stock
move's material, a document's or leave request's staff member, a request's job and customer all belong to the same
company); payment amount > 0; leave end ≥ start; unique job, receipt and request numbers per company; stock quantity
changes only through stock movements.

## 3. Roles

Group Admin (`members.level = editor`) acts as Admin in every company. Company roles: Admin, Manager, Staff, Viewer.
Customers are portal accounts without a member row. Full matrix: `docs/contracts/permissions.json`.

Staff privacy (decided 26 Oct): the directory is visible to every company role; private details, leave reasons and
documents only to company Admins/Managers, Group Admins and the person.

## 4. Mutation contract

- **Records:** `apply_op(op_id, entity, id, action, patch, base_version)`. Idempotent per `op_id` (op_receipts);
  version-checked; field-level conflict detection (only fields someone else changed since `base_version` clash;
  the rest are saved); history arrays are merged, never overwritten; protected fields are ignored.
- **Workflow and settings:** named functions (`rpc.json`).
- **Files:** Storage upload, then the record.
- **Deletes:** `soft_delete` only (children go with the parent in one batch); `restore_deleted`; `purge_deleted`
  (Group Admin, typed confirmation) is the only hard delete.
- No direct table writes from the browser (the four that existed were replaced on 26 Oct).

Result states: APPLIED, DUPLICATE, CONFLICT, REFUSED, FAILED, plus QUEUED on the device. Meanings and wording:
`docs/contracts/enums.json`.

## 5. Audit log

`ops_log` records every insert, update, soft delete, restore and purge on every business table, from any path
(source `app`, `rpc`, `direct`, `service`, `function`), with who, when, record, versions, and the changed fields.
Private values (staff contact and private fields, leave reasons, document paths, tokens, relay values) are masked.
Group and settings tables are logged by `log_config`. Only Group Admins can read the log. No secret is ever logged.

## 6. Offline and connectivity

- **LIVE / DEGRADED / OFFLINE** as defined in `enums.json`. Degraded shows the data-on-screen time, waiting count,
  last successful backup and what is unavailable.
- **Outbox:** queue-safe changes wait on the device with their operation id and are sent on reconnect, on start and
  every 30 s; two tabs never send the same change; statuses waiting → sending → applied | conflict | refused | failed.
- **Never queued:** payments, stock movements, staff, private staff details, staff documents, leave, cancellations,
  deletions, administration, settings, emails, numbered documents.

## 7. Backup contract

| Item | Value |
|---|---|
| Schedule | rolling every 6 h; nightly 02:00 Lagos; month-end copy; on-demand manual |
| Content | `backup_export()`: every public table, all columns except secrets/tokens, row counts, sign-in accounts (no passwords), storage file list |
| Destination | Drive folder of radiantb3 (`future-ready-db-<UTC time>.json`) and a readable spreadsheet (private tables skipped) |
| Record | each run in `sync_runs` with kind, status, row counts, tables, bytes, checksum, file name and Drive file id |
| Retention | pruning recorded in `details.pruned` |
| Restore | `docs/RESTORE_RUNBOOK.md`; full test passed 26 Oct (290/290 rows identical, all roles checked) |
| Files | Storage files are NOT in database backups. Staff-document copy to Drive is pending management approval |

## 8. File storage

| Bucket | Path | Read | Write |
|---|---|---|---|
| avatars | `<uid>/avatar.jpg`, `staff/<company>/…` | public by URL | owner; managers for staff photos |
| staff-docs | `<company>/<staff>/…` | managers, the staff member | managers |
| press-files | `<company>/…` | company role | staff and above |
| customer-files | `<company>/<uid>/<request>/…` | the customer, company role | the customer |

## 9. Authentication

Supabase Auth: Google sign-in and email/password (confirmed email required). Branded emails via the `auth-email`
hook. A signed-in account gets data only if it is an active member with a role, or a customer for portal tables.
Expired sessions are reported and nothing is saved.

## 10. Not implemented (by decision or pending)

- Staff-document copy to Google Drive: pending privacy approval.
- Portal text editing screen (function exists; text set by SQL).
- "Last restore test" line in the backup panel (recorded in `sync_runs`, not displayed).
- Automatic offline payments or numbered documents: excluded by design.

## 11. Known low-severity items (accepted)

| Item | Severity | Note |
|---|---|---|
| Staff photos readable by anyone with the URL | LOW | random paths; photos only |
| 65 older rows with empty `updated_by` | LOW | created before Stage 4 stamping |
| `can_write()` and `is_editor()` callable without sign-in | LOW | return false for anonymous callers |
| Leftover edge functions `fetch-probe` and `app` | LOW | require sign-in; delete in the dashboard |
| Leaked-password protection off | LOW | Supabase Auth setting; most staff use Google |
| Advisor "security definer callable" warnings | INFO | intended: each function checks permissions itself and was tested per role |

No BLOCKER or HIGH data-loss or security issue is open.

## 12. Owner actions outstanding

1. Re-paste `apps-script/Backup.gs` (adds row counts and destination to each backup record) and `Code.gs`.
2. Delete edge functions `fetch-probe` and `app` in the Supabase dashboard.
3. Confirm 2-Step Verification on radiantb3; share the backup folder (view) with collinsonuora05.
4. 1 Nov: Netlify deploy of the accumulated frontend changes (credits reset).
