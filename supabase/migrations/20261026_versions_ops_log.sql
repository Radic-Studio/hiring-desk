-- Stage 3 (resilience): record versions, operation IDs and a persistent operations log.
-- Every write to the 13 business tables now:
--   * gets version = 1 on insert, version + 1 on every update (set by the database, whatever the client sends);
--   * gets a fresh op_id (uuid) per write; Stage 4's apply_op will pass its own via the session setting fr.op_id;
--   * stamps updated_at / updated_by;
--   * leaves one row in ops_log: who, entity, record, op_id, action, base version, resulting version, result, changes.
-- Sensitive staff fields are logged as "[changed]", never their values. ops_log is readable by Group Admins only and
-- written only by the trigger (security definer). No app change is needed for this stage.
--
-- Rollback: drop trigger zz_stamp_row and zz_log_op on the 13 tables; drop function public.stamp_row(), public.log_op();
--           drop table public.ops_log; the new columns (version, op_id, updated_at, updated_by) are harmless if left.

-- 1. columns
do $$
declare t text;
begin
  foreach t in array array['roles','candidates','issues','staff','staff_documents','leave_requests','press_customers','press_rate_items','press_jobs','press_payments','press_materials','press_files','customer_requests'] loop
    execute format('alter table public.%I add column if not exists version int not null default 1, add column if not exists op_id uuid default gen_random_uuid(), add column if not exists updated_at timestamptz, add column if not exists updated_by text', t);
  end loop;
end $$;

-- 2. the log
create table if not exists public.ops_log (
  id bigint generated always as identity primary key,
  op_id uuid not null,
  entity text not null,
  record_id text not null,
  company_id text,
  action text not null check (action in ('insert', 'update', 'soft_delete', 'restore', 'delete', 'conflict', 'refused', 'duplicate')),
  result text not null default 'applied' check (result in ('applied', 'conflict', 'refused', 'duplicate', 'failed')),
  base_version int,
  result_version int,
  actor text,                -- confirmed email of the signed-in person; 'service' for the backup/sheet scripts and server functions
  actor_uid uuid,
  source text not null default 'app',
  changes jsonb not null default '{}'::jsonb,   -- changed fields (insert: the new row), large/sensitive values masked
  error text,
  conflict jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ops_log_record on public.ops_log (entity, record_id, created_at desc);
create index if not exists ops_log_created on public.ops_log (created_at desc);
create index if not exists ops_log_op on public.ops_log (op_id);
alter table public.ops_log enable row level security;
drop policy if exists ops_log_admin_read on public.ops_log;
create policy ops_log_admin_read on public.ops_log for select to authenticated using (public.is_admin());
-- no insert/update/delete policies: only the trigger (security definer) writes, and nothing rewrites the log

-- 3. BEFORE trigger: version, op_id, updated_at/by
create or replace function public.stamp_row() returns trigger
language plpgsql set search_path = public as $$
declare me text := coalesce(nullif(public.my_email(), ''), ''); op text := nullif(current_setting('fr.op_id', true), '');
begin
  if tg_op = 'INSERT' then
    new.version := 1;
  else
    new.version := coalesce(old.version, 0) + 1;
  end if;
  new.op_id := coalesce(op::uuid, gen_random_uuid());
  new.updated_at := now();
  if me <> '' then new.updated_by := me;
  elsif tg_op = 'INSERT' then new.updated_by := coalesce(nullif(new.updated_by, ''), 'service');
  elsif new.updated_by is not distinct from old.updated_by then new.updated_by := 'service';   -- a server/script write that did not name anyone
  end if;
  return new;
end $$;

-- 4. AFTER trigger: the log row
create or replace function public.log_op() returns trigger
language plpgsql security definer set search_path = public as $$
declare me text := coalesce(nullif(public.my_email(), ''), ''); act text; ch jsonb := '{}'::jsonb; k text; nv jsonb; ov jsonb; rid text; cid text;
  skip text[] := array['history', 'version', 'op_id', 'updated_at', 'updated_by', 'delete_batch'];
  secret text[] := case tg_table_name
    when 'staff' then array['phone', 'email', 'address', 'date_of_birth', 'emergency_name', 'emergency_phone', 'notes', 'photo_url']
    when 'leave_requests' then array['reason', 'decision_note']
    when 'staff_documents' then array['file_path', 'note']
    else array[]::text[] end;
begin
  if tg_op = 'DELETE' then
    rid := old.id::text; cid := old.company_id::text; act := 'delete';
  else
    rid := new.id::text; cid := new.company_id::text;
    nv := to_jsonb(new);
    if tg_op = 'INSERT' then
      act := 'insert';
      for k in select jsonb_object_keys(nv) loop
        if k = any(skip) or nv -> k = 'null'::jsonb then continue; end if;
        ch := ch || jsonb_build_object(k, case when k = any(secret) then to_jsonb('[set]'::text) when length((nv -> k)::text) > 2000 then to_jsonb('[large value]'::text) else nv -> k end);
      end loop;
    else
      ov := to_jsonb(old);
      act := case when old.deleted_at is null and new.deleted_at is not null then 'soft_delete'
                  when old.deleted_at is not null and new.deleted_at is null then 'restore' else 'update' end;
      for k in select jsonb_object_keys(nv) loop
        if k = any(skip) or (nv -> k) is not distinct from (ov -> k) then continue; end if;
        ch := ch || jsonb_build_object(k, case when k = any(secret) then to_jsonb('[changed]'::text) when length((nv -> k)::text) > 2000 then to_jsonb('[large value]'::text) else nv -> k end);
      end loop;
    end if;
  end if;
  insert into public.ops_log (op_id, entity, record_id, company_id, action, result, base_version, result_version, actor, actor_uid, source, changes)
  values (case when tg_op = 'DELETE' then gen_random_uuid() else new.op_id end, tg_table_name, rid, cid, act, 'applied',
          case when tg_op = 'INSERT' then null else old.version end, case when tg_op = 'DELETE' then null else new.version end,
          coalesce(nullif(me, ''), 'service'), auth.uid(), case when me = '' then 'service' else 'app' end, ch);
  return null;
end $$;
revoke all on function public.log_op() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['roles','candidates','issues','staff','staff_documents','leave_requests','press_customers','press_rate_items','press_jobs','press_payments','press_materials','press_files','customer_requests'] loop
    -- "zz_" so these run after the existing BEFORE triggers (touch_row, company stamping), which fire in name order
    execute format('drop trigger if exists zz_stamp_row on public.%I', t);
    execute format('create trigger zz_stamp_row before insert or update on public.%I for each row execute function public.stamp_row()', t);
    execute format('drop trigger if exists zz_log_op on public.%I', t);
    execute format('create trigger zz_log_op after insert or update or delete on public.%I for each row execute function public.log_op()', t);
  end loop;
end $$;

-- Advisor tidy-ups (2026-10-26): fixed search_path on soft_entity_ok; internal helpers not callable directly.
alter function public.soft_entity_ok(text) set search_path = public;
revoke all on function public.soft_can_delete(text, text) from public, anon, authenticated;
revoke all on function public.soft_entity_ok(text) from public, anon, authenticated;
