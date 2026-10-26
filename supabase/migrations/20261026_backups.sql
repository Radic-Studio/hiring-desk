-- Stage 1 (resilience): scheduled off-site backups and backup-health records.
-- The backup job is a standalone Google Apps Script (apps-script/Backup.gs) owned by the dedicated backup Google account.
-- It calls backup_export() with the service role, writes JSON to that account's Drive, refreshes the Backups spreadsheet,
-- and records every run here. Rollback: drop function public.backup_export(); drop table public.sync_runs;

create table if not exists public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('rolling', 'nightly', 'monthly', 'sheet', 'restore_test', 'manual')),
  scheduled_for timestamptz,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'success', 'failed')),
  tables int, rows int, files int, bytes bigint,
  file_name text, drive_file_id text, checksum text, schema_version text, format text,
  error text,
  source text not null default 'apps-script',
  details jsonb not null default '{}'::jsonb
);
create index if not exists sync_runs_started on public.sync_runs (started_at desc);
create index if not exists sync_runs_kind_status on public.sync_runs (kind, status, started_at desc);
alter table public.sync_runs enable row level security;
drop policy if exists sync_runs_admin_read on public.sync_runs;
create policy sync_runs_admin_read on public.sync_runs for select to authenticated using (public.is_admin());
-- no insert/update policy: only the service role (the backup job) writes

-- Full export of the public schema for off-site backup. Service role only.
-- Every public base table is included automatically (new tables are picked up without editing this function).
-- Columns whose names look like secrets are dropped; app_config values for secret-looking keys are redacted.
create or replace function public.backup_export() returns jsonb
language plpgsql security definer set search_path = public, auth, storage as $$
declare r record; cols text; rws jsonb; tbls jsonb := '{}'::jsonb; counts jsonb := '{}'::jsonb; n int; total int := 0; sv text;
begin
  for r in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public' and c.relkind = 'r' order by c.relname loop
    if r.relname = 'app_config' then
      select coalesce(jsonb_agg(jsonb_build_object('key', a.key, 'value', case when a.key ~* '(token|secret|key|pass)' then '[REDACTED]' else a.value end, 'updated_at', a.updated_at) order by a.key), '[]'::jsonb)
        into rws from public.app_config a;
    else
      select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
        from information_schema.columns where table_schema = 'public' and table_name = r.relname
         and column_name !~* '(token|secret|password|api_key|service_key)';
      execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from (select %s from public.%I) x', cols, r.relname) into rws;
    end if;
    n := jsonb_array_length(rws); total := total + n;
    tbls := tbls || jsonb_build_object(r.relname, rws);
    counts := counts || jsonb_build_object(r.relname, n);
  end loop;
  select md5(
    coalesce((select string_agg(table_name || '.' || column_name || ':' || udt_name, ',' order by table_name, column_name) from information_schema.columns where table_schema = 'public'), '') ||
    coalesce((select string_agg(md5(pg_get_functiondef(p.oid)), ',' order by p.proname, p.oid) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '')
  ) into sv;
  return jsonb_build_object(
    'format', 'future-ready-db/1',
    'project', 'muagpehopedxycfiqupg',
    'generated_at', now(),
    'schema_version', sv,
    'table_list', (select jsonb_agg(k order by k) from jsonb_object_keys(tbls) k),
    'row_counts', counts,
    'total_rows', total,
    'tables', tbls,
    'auth_users', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'email', u.email, 'email_confirmed_at', u.email_confirmed_at,
                    'created_at', u.created_at, 'providers', u.raw_app_meta_data -> 'providers', 'full_name', u.raw_user_meta_data ->> 'full_name') order by u.created_at), '[]'::jsonb) from auth.users u),
    'storage_objects', (select coalesce(jsonb_agg(jsonb_build_object('bucket', o.bucket_id, 'name', o.name, 'size', o.metadata ->> 'size',
                    'mimetype', o.metadata ->> 'mimetype', 'created_at', o.created_at) order by o.bucket_id, o.name), '[]'::jsonb) from storage.objects o)
  );
end $$;
revoke all on function public.backup_export() from public, anon, authenticated;
grant execute on function public.backup_export() to service_role;

alter publication supabase_realtime add table public.sync_runs;
