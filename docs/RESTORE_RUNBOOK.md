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
