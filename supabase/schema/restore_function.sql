-- fr_restore(backup, confirm): load a Future Ready database backup into an EMPTY project.
-- Install this ONLY in the project you are restoring INTO, after schema_snapshot.sql. Never install it on the live project.
--
-- Input: the backup file's JSON as text (a Drive file from the backup account, or the output of backup_export()). Both have
--        "tables" and "auth_users" at the top level. A large file can be loaded in pieces into fr_internal.restore_parts
--        first (see docs/RESTORE_RUNBOOK.md), then restored with fr_restore_parts().
-- Safety: refuses unless every business table is empty and confirm = 'RESTORE INTO EMPTY PROJECT'.
-- What it does:
--   1. recreates sign-in accounts (same id and email, confirmed state; NO passwords: people sign in with Google or use
--      "Forgot password"), because customer requests and portal profiles are linked to accounts;
--   2. loads every table in dependency order with the app's triggers paused, so versions, "updated by", deletion flags and
--      stock levels stay exactly as backed up (soft-deleted rows stay deleted; stock moves are not applied twice);
--   3. gives invitations new random tokens (tokens are never backed up), and leaves redacted settings as "[REDACTED]";
--   4. moves the operations-log counter past the restored rows;
--   5. compares every table's row count with the counts recorded in the backup and returns the comparison.
-- Everything runs in one transaction: if any table fails, nothing is kept.

create table if not exists fr_internal.restore_parts (part int primary key, body text not null);
revoke all on fr_internal.restore_parts from public, anon, authenticated;

create or replace function fr_internal.fr_restore(p_backup jsonb, p_confirm text)
returns jsonb language plpgsql set search_path = public, auth as $$
declare
  order_list text[] := array['companies','members','company_members','company_settings','app_config','settings','counters',
    'roles','candidates','issues','staff','staff_private','staff_documents','leave_requests',
    'press_customers','press_rate_items','press_materials','press_jobs','press_payments','press_files','press_material_moves',
    'customer_requests','customer_request_messages','customer_request_files','portal_profiles',
    'member_invites','deletions','conflicts','op_receipts','ops_log','sync_runs'];
  t text; cols text; n int; want int; report jsonb := '{}'::jsonb; mismatches int := 0; users int := 0; tabs jsonb; extra text[];
begin
  if p_confirm is distinct from 'RESTORE INTO EMPTY PROJECT' then raise exception 'Type the confirmation exactly: RESTORE INTO EMPTY PROJECT'; end if;
  tabs := p_backup -> 'tables';
  if tabs is null or jsonb_typeof(tabs) <> 'object' then raise exception 'This is not a Future Ready backup (no "tables")'; end if;
  foreach t in array order_list loop
    execute format('select count(*) from public.%I', t) into n;
    if n > 0 then raise exception 'Refusing to restore: table % already has % rows. Restore only into an empty project.', t, n; end if;
  end loop;
  select array_agg(k) into extra from jsonb_object_keys(tabs) k where not (k = any(order_list));
  if extra is not null then raise exception 'The backup has tables this restore does not know: %. Update the schema and this function first.', extra; end if;
  -- Backups taken before 26 Oct 2026 keep address, date of birth, emergency contact and notes on staff. Those now live in
  -- staff_private (managers and the person only), so build its rows from the old staff rows.
  if not (tabs ? 'staff_private') and tabs ? 'staff' then
    tabs := tabs || jsonb_build_object('staff_private', coalesce((
      select jsonb_agg(jsonb_build_object('id', r -> 'id', 'company_id', r -> 'company_id', 'address', r -> 'address',
               'date_of_birth', r -> 'date_of_birth', 'emergency_name', r -> 'emergency_name', 'emergency_phone', r -> 'emergency_phone',
               'notes', r -> 'notes', 'created_at', r -> 'created_at', 'updated_at', r -> 'updated_at', 'updated_by', r -> 'updated_by',
               'deleted_at', r -> 'deleted_at', 'deleted_by', r -> 'deleted_by', 'delete_batch', r -> 'delete_batch'))
      from jsonb_array_elements(tabs -> 'staff') r
      where coalesce(nullif(r ->> 'address', ''), nullif(r ->> 'date_of_birth', ''), nullif(r ->> 'emergency_name', ''),
                     nullif(r ->> 'emergency_phone', ''), nullif(r ->> 'notes', '')) is not null), '[]'::jsonb));
  end if;

  -- 1. sign-in accounts (no passwords)
  insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous)
  select '00000000-0000-0000-0000-000000000000', (u ->> 'id')::uuid, 'authenticated', 'authenticated', lower(u ->> 'email'),
         (u ->> 'email_confirmed_at')::timestamptz, coalesce((u ->> 'created_at')::timestamptz, now()), now(),
         jsonb_build_object('provider', coalesce(u -> 'providers' ->> 0, 'email'), 'providers', coalesce(u -> 'providers', '["email"]'::jsonb), 'restored', true),
         jsonb_build_object('full_name', coalesce(u ->> 'full_name', '')), false, false
  from jsonb_array_elements(coalesce(p_backup -> 'auth_users', '[]'::jsonb)) u
  on conflict (id) do nothing;
  get diagnostics users = row_count;

  -- 2. tables, triggers paused
  foreach t in array order_list loop execute format('alter table public.%I disable trigger user', t); end loop;
  foreach t in array order_list loop
    if not (tabs ? t) then report := report || jsonb_build_object(t, jsonb_build_object('restored', 0, 'note', 'not in backup')); continue; end if;
    select string_agg(format('%I', c.column_name), ', ' order by c.ordinal_position) into cols
    from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = t and c.is_generated = 'NEVER'
      and (exists (select 1 from jsonb_array_elements(tabs -> t) r where r ? c.column_name)
           or (t = 'member_invites' and c.column_name = 'token'));
    if cols is null then report := report || jsonb_build_object(t, jsonb_build_object('restored', 0, 'expected', jsonb_array_length(tabs -> t))); continue; end if;
    if t = 'member_invites' then
      execute format('insert into public.member_invites (%s) select %s from jsonb_populate_recordset(null::public.member_invites, $1) x',
        cols, regexp_replace(cols, '\mtoken\M', 'md5(random()::text || clock_timestamp()::text) || md5(random()::text)')) using
        (select coalesce(jsonb_agg(r - 'token'), '[]'::jsonb) from jsonb_array_elements(tabs -> t) r);
    else
      execute format('insert into public.%I (%s) overriding system value select %s from jsonb_populate_recordset(null::public.%I, $1)', t, cols, cols, t) using tabs -> t;
    end if;
    get diagnostics n = row_count;
    want := coalesce((p_backup -> 'row_counts' ->> t)::int, jsonb_array_length(tabs -> t));
    if n <> want then mismatches := mismatches + 1; end if;
    report := report || jsonb_build_object(t, jsonb_build_object('restored', n, 'expected', want));
  end loop;
  foreach t in array order_list loop execute format('alter table public.%I enable trigger user', t); end loop;

  -- 3. counters that follow restored rows
  perform setval(pg_get_serial_sequence('public.ops_log', 'id'), greatest((select coalesce(max(id), 0) from public.ops_log), 1));

  if mismatches > 0 then raise exception 'Row counts differ from the backup for % table(s): %', mismatches, report; end if;
  return jsonb_build_object('result', 'restored', 'accounts', users, 'tables', report,
    'total_rows', (select sum((v ->> 'restored')::int) from jsonb_each(report) e(k, v)),
    'backup_generated_at', p_backup ->> 'generated_at', 'backup_project', p_backup ->> 'project',
    'next_steps', jsonb_build_array('Re-enter redacted settings (app_config values shown as [REDACTED])',
      'Set Auth URL configuration, Google provider and the Send Email hook in the dashboard',
      'Deploy edge functions and their secrets', 'Point config.js at the new project and redeploy the site',
      'Tell staff to sign in with Google or use Forgot password (passwords are not in backups)',
      'Files (photos, documents, artwork) are not in database backups'));
end $$;
revoke all on function fr_internal.fr_restore(jsonb, text) from public, anon, authenticated;

-- Restore from pieces loaded into fr_internal.restore_parts (for files too large to paste in one go).
create or replace function fr_internal.fr_restore_parts(p_confirm text)
returns jsonb language plpgsql set search_path = public as $$
declare body text;
begin
  select string_agg(p.body, '' order by p.part) into body from fr_internal.restore_parts p;
  if body is null then raise exception 'No pieces loaded'; end if;
  return fr_internal.fr_restore(body::jsonb, p_confirm);
end $$;
revoke all on function fr_internal.fr_restore_parts(text) from public, anon, authenticated;
