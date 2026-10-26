# Restore runbook: rebuilding the database from a backup

Use this when the live Supabase project is lost, damaged beyond repair, or you need a full copy for testing.
**It never touches the live project.** You restore into a new, empty project, check it, and only then point the app at it.

Tested end to end on 2026-10-26: a new project (`future-ready-restore-test`) was built from these files and loaded with
the 11:42 UTC backup. Result: 30 tables, 177 rows and 5 accounts restored. The structure matched live exactly (same
columns, functions, policies, triggers, constraints and indexes), the data matched the backup, and the access rules and
saving behaved as on live.

## What you need

- Owner access to the Supabase organisation "Radic Studio" (free plan: 2 active projects at most, so you may have to
  pause one first).
- The backup file: Google Drive of **radiantb3@gmail.com** → `Future Ready Backups/database/` → `rolling/` (newest,
  every 6 h), `nightly/` or `monthly/`. Pick the newest file whose name does not contain `FAILED`.
- This repository: `supabase/schema/schema_snapshot.sql` and `supabase/schema/restore_function.sql`.

Not in the backup and **cannot be restored from it**:
- **Passwords and sign-in sessions.** People sign in with Google, or use *Forgot password* on the sign-in page.
- **Files** (staff documents, job files, customer uploads, profile photos). The backup only lists them. If the old
  project still opens, download them from its Storage page and upload them to the same paths in the new one.
- **Secrets.** These are re-entered in step 5.

## Steps

1. **Create the project.** Supabase → New project in "Radic Studio", region *West EU (Ireland)* (`eu-west-1`), plan Free.
   Save the database password in your password manager. Wait until the project is ready.

2. **Build the structure.** In the new project, open SQL Editor → New query. Paste the whole of
   `supabase/schema/schema_snapshot.sql` and click Run. Expected result: "Success. No rows returned".
   Do **not** run the files in `supabase/migrations/`. They are the change history, and replaying them gives an older,
   weaker version of several security checks. The snapshot is the authoritative definition.

3. **Install the restore tool.** New query, paste the whole of `supabase/schema/restore_function.sql`, then Run.
   Install it only in the new project, never on live.

4. **Load the backup.** Open the backup file from Drive as text and copy all of it. New query:
   ```sql
   select fr_internal.fr_restore($fr$ PASTE THE WHOLE FILE HERE $fr$::jsonb, 'RESTORE INTO EMPTY PROJECT');
   ```
   - If the file is too large to paste in one go, load it in pieces. Then run
     `select fr_internal.fr_restore_parts('RESTORE INTO EMPTY PROJECT');`. Load each piece, in order, with:
     ```sql
     insert into fr_internal.restore_parts values (1, $fr$ FIRST PIECE $fr$);
     insert into fr_internal.restore_parts values (2, $fr$ SECOND PIECE $fr$);
     ```
     The test restore was done in pieces this way.
   - The result lists every table with the restored rows against the backup's count. On any difference it stops and
     keeps nothing.
   - It refuses to run if any table already has data, or if the confirmation text is not exact.
   - Afterwards, empty the pieces with `truncate fr_internal.restore_parts;`.

5. **Dashboard settings** in the new project. None of these are stored in the database.
   - Authentication → URL Configuration:
     - Site URL: `https://future-ready-hiring-desk.netlify.app`.
     - Redirect URLs: add that address and `https://future-ready-hiring-desk.netlify.app/press/`.
   - Authentication → Providers:
     - **Google**: enable it and paste the same Client ID and Secret as before.
     - In Google Cloud Console, add the new callback address `https://<new-ref>.supabase.co/auth/v1/callback` to the
       OAuth client.
     - **Email**: keep it on, keep *Confirm email* on, and set the minimum password length to 8.
   - Edge Functions: deploy `send-email`, `invite-member`, `send-doc` (JWT check on) and `auth-email` (JWT check
     **off**) from `supabase/functions/`.
   - Secrets: add `SEND_EMAIL_HOOK_SECRET`. The other values are provided by Supabase automatically.
   - Authentication → Hooks → **Send Email**: point it at `https://<new-ref>.supabase.co/functions/v1/auth-email`,
     generate a new secret and put the same value in `SEND_EMAIL_HOOK_SECRET`.

6. **Reconnect the Google scripts.** Change the script properties `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` (from the
   new project's API keys page) in both scripts:
   - the Hiring Sheet's script (`apps-script/Code.gs`): then run `setup` once. This writes a new email relay token,
     which replaces the `[REDACTED]` value restored in `app_config`;
   - the backup script "Future Ready Backups" (`apps-script/Backup.gs`): then run `backupNow` and check that it succeeds.

7. **Point the app at the new project.** In `config.js`, change `supabaseUrl` and `supabaseKey` (the new
   *publishable* key; never the secret key) and deploy.

8. **Check before telling people.**
   - Sign in with Google as a Group Admin. Check that the companies, candidates, jobs and Team page show the expected
     numbers.
   - Save one harmless change and confirm it appears in the operations log.
   - Open `/press/` and check that the portal loads.
   - The status button should show **Live**. After the first backup, the backup line should show a fresh time.

   - Relationships: run the check below in the new project. Every line must show 0 problems (live on 26 Oct 2026: all 0).
   - Deletions: `select entity, label, deleted_at from deletions where restored_at is null and purged_at is null;` must match
     Recently deleted at the time of the backup. Soft-deleted rows keep their `deleted_at`, and stock is not re-applied.
   ```sql
   select 'candidates with a missing role' as check_name, count(*) as problems from candidates c where not exists (select 1 from roles r where r.id = c.role)
   union all select 'issues with a missing candidate', count(*) from issues i where i.candidate_id is not null and not exists (select 1 from candidates c where c.id = i.candidate_id)
   union all select 'jobs with a missing customer', count(*) from press_jobs j where j.customer_id is not null and not exists (select 1 from press_customers c where c.id = j.customer_id)
   union all select 'payments with a missing job', count(*) from press_payments p where not exists (select 1 from press_jobs j where j.id = p.job_id)
   union all select 'leave with a missing staff record', count(*) from leave_requests l where not exists (select 1 from staff s where s.id = l.staff_id)
   union all select 'request messages with a missing request', count(*) from customer_request_messages m where not exists (select 1 from customer_requests r where r.id = m.request_id)
   union all select 'requests with a missing customer account', count(*) from customer_requests r where not exists (select 1 from auth.users u where u.id = r.user_id)
   union all select 'company roles for a missing company', count(*) from company_members m where not exists (select 1 from companies c where c.id = m.company_id);
   ```

   **Production:** steps 6 and 7 switch the live system. Do them only with written management approval naming the backup
   file and its time, after the steps before them and these checks have passed in the new project. Tell staff to stop entering data first.

9. **Tell staff:** sign in with Google, or use *Forgot password* if you used an email and password. Any change a
   device was still holding offline is sent automatically once that person signs in again.

## Rollback

The live project is never written to. If anything looks wrong, put the old values back in `config.js` (and in the two
script properties, if you changed them) and redeploy. Delete or pause the new project when you are done.

## Keeping this runbook working

After every database change, regenerate the snapshot:
1. Run `supabase/schema/generate_snapshot.sql` in the live project's SQL Editor.
2. Save the single text result as `supabase/schema/schema_snapshot.sql` and commit it.

If a new table is added, add it to the table list in `restore_function.sql` in the right order (after the tables it
refers to). Until you do, the restore stops and names the unknown table.

Drift check. Run this in both projects; the six values must match:
```sql
select
  md5(string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,''), ',' order by table_name, column_name)) as columns
from information_schema.columns where table_schema = 'public'
union all select md5(string_agg(p.proname||'('||pg_get_function_identity_arguments(p.oid)||')'||md5(p.prosrc), ',' order by p.proname, pg_get_function_identity_arguments(p.oid)))
from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'fr_internal') and p.proname not like 'fr\_restore%'
union all select md5(string_agg(tablename||'.'||policyname||':'||cmd||':'||coalesce(qual,'')||':'||coalesce(with_check,''), ',' order by tablename, policyname))
from pg_policies where schemaname in ('public', 'storage')
union all select md5(string_agg(c.relname||'.'||t.tgname||':'||pg_get_triggerdef(t.oid), ',' order by c.relname, t.tgname))
from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal
union all select md5(string_agg(conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid), ',' order by conrelid::regclass::text, conname))
from pg_constraint where connamespace = 'public'::regnamespace
union all select md5(string_agg(indexdef, ',' order by indexname))
from pg_indexes where schemaname = 'public';
```

Rights check. Also run this in both projects; the two values must match (who may read, write or call what):
```sql
select md5(string_agg(c.relname||':'||r||':'||p, ',' order by c.relname, r, p))
from pg_class c join pg_namespace n on n.oid=c.relnamespace, unnest(array['anon','authenticated','service_role']) r, unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
where n.nspname='public' and c.relkind='r' and has_table_privilege(r, c.oid, p)
union all
select md5(string_agg(f.oid::regprocedure::text||':'||r, ',' order by f.oid::regprocedure::text, r))
from pg_proc f join pg_namespace n on n.oid=f.pronamespace, unnest(array['anon','authenticated','service_role']) r
where n.nspname='public' and has_function_privilege(r, f.oid, 'execute');
```

## Last full restore test: 26 Oct 2026 (passed)

| Check | Result |
|---|---|
| Source | `backup_export()` of live at 14:21 UTC: 31 tables, 290 rows, 5 sign-in accounts, md5 `e37a7fed…` |
| Schema | `schema_snapshot.sql` at commit 65128ef, run into an emptied test project |
| Load | all 31 tables restored; row counts equal the backup's own counts |
| Content | every one of the 290 rows identical field by field to the backup |
| Relationships | 0 orphans: candidates→roles, issues→candidates, every company_id→companies, jobs/requests in the same company as their customer, requests→accounts, staff_private and leave→staff, members→accounts |
| Soft deletes | the 2 deleted candidates are still deleted and still listed in Recently deleted |
| Stock | quantities as backed up (movements not applied twice) |
| Versions, log | versions kept (e.g. gd-48 = 3); operations-log counter moved past the restored rows |
| Secrets | relay token stays `[REDACTED]`; invitation tokens regenerated; no passwords restored |
| Access (RLS) | Group Admin sees all incl. deleted and can save; Press Staff sees jobs and directory but not candidates, private staff details, leave or the log, cannot edit materials, and a stock movement updates quantity (40 → 37); Customer sees only own request and messages and cannot add a customer; anonymous sees nothing except the public portal page |
| Structure | the six drift fingerprints and both rights fingerprints match live |
| Older backups | a pre-26-Oct backup with address/date of birth/emergency contact/notes on `staff` restores them into `staff_private` |
| After the test | test data and accounts deleted from the test project; project paused. Recorded in `sync_runs` (kind `restore_test`). |
