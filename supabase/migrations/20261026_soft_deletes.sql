-- Stage 2 (resilience): soft deletes and restore.
-- Ordinary deletes become reversible: the row is marked deleted_at/deleted_by/delete_batch and hidden from everyone
-- except Group Admins, who see it in "Recently deleted" and can restore it or purge it. Nothing is purged automatically.
-- Existing policies are not changed; two RESTRICTIVE policies per table are added on top of them.
--
-- Rollback (all additive):
--   drop the policies named *_hide_deleted and *_no_hard_delete on the 13 tables;
--   drop function public.soft_delete(text, text), public.restore_deleted(uuid), public.purge_deleted(uuid, text),
--        public.soft_entity_ok(text), public.soft_can_delete(text, text);
--   drop table public.deletions;  (columns deleted_at/deleted_by/delete_batch may stay; they are harmless)
--   supabase/rollback/stage2_policies_before.sql recreates the earlier policies exactly, if ever needed.

-- 1. columns
do $$
declare t text;
begin
  foreach t in array array['roles','candidates','issues','staff','staff_documents','leave_requests','press_customers','press_rate_items','press_jobs','press_payments','press_materials','press_files','customer_requests'] loop
    execute format('alter table public.%I add column if not exists deleted_at timestamptz, add column if not exists deleted_by text, add column if not exists delete_batch uuid', t);
    execute format('create index if not exists %I on public.%I (delete_batch) where delete_batch is not null', t || '_delete_batch', t);
    -- hidden from everyone except Group Admins once deleted
    execute format('drop policy if exists %I on public.%I', t || '_hide_deleted', t);
    execute format('create policy %I on public.%I as restrictive for select to authenticated using (deleted_at is null or public.is_admin())', t || '_hide_deleted', t);
    -- direct hard deletes only by Group Admins (the app itself purges through purge_deleted)
    execute format('drop policy if exists %I on public.%I', t || '_no_hard_delete', t);
    execute format('create policy %I on public.%I as restrictive for delete to authenticated using (public.is_admin())', t || '_no_hard_delete', t);
  end loop;
end $$;

-- 2. one row per delete action (what a Group Admin sees in "Recently deleted")
create table if not exists public.deletions (
  id uuid primary key default gen_random_uuid(),          -- = delete_batch on every affected row
  entity text not null, record_id text not null, label text not null default '', company_id text,
  children jsonb not null default '{}'::jsonb,            -- {"candidates": 12, "issues": 3}
  deleted_by text, deleted_at timestamptz not null default now(),
  restored_by text, restored_at timestamptz,
  purged_by text, purged_at timestamptz
);
create index if not exists deletions_open on public.deletions (deleted_at desc) where restored_at is null and purged_at is null;
alter table public.deletions enable row level security;
drop policy if exists deletions_admin_read on public.deletions;
create policy deletions_admin_read on public.deletions for select to authenticated using (public.is_admin());
alter publication supabase_realtime add table public.deletions;

create or replace function public.soft_entity_ok(p_entity text) returns boolean language sql immutable as $$
  select p_entity = any (array['roles','candidates','issues','staff','staff_documents','leave_requests','press_customers','press_rate_items','press_jobs','press_payments','press_materials','press_files','customer_requests'])
$$;

-- Who may delete: the same people who could delete before Stage 2.
create or replace function public.soft_can_delete(p_entity text, p_company text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(case
    when p_entity in ('roles', 'candidates', 'issues') then public.is_admin()
    when p_entity in ('press_customers', 'press_jobs', 'press_files', 'customer_requests') then public.can_write_company(p_company)
    else public.can_manage_company(p_company)
  end, false)
$$;

create or replace function public.soft_delete(p_entity text, p_id text) returns public.deletions
language plpgsql security definer set search_path = public as $$
declare cid text; already timestamptz; lbl text; n int; b uuid := gen_random_uuid(); me text := public.my_email(); ch jsonb := '{}'::jsonb; d public.deletions;
  lbl_expr text := case p_entity
    when 'roles' then 'name' when 'candidates' then 'name' when 'issues' then 'name || '': '' || issue'
    when 'staff' then 'full_name' when 'staff_documents' then 'title' when 'leave_requests' then 'kind::text || '' leave, '' || start_date || '' to '' || end_date'
    when 'press_customers' then 'name' when 'press_rate_items' then 'name' when 'press_jobs' then 'number || '' '' || title'
    when 'press_payments' then 'coalesce(receipt_no, ''payment'') || '' · '' || amount' when 'press_materials' then 'name' when 'press_files' then 'title'
    when 'customer_requests' then 'ref || '' '' || title' end;
begin
  if coalesce(me, '') = '' then raise exception 'Sign in first'; end if;
  if not coalesce(public.soft_entity_ok(p_entity), false) then raise exception 'This kind of record cannot be deleted here'; end if;
  execute format('select company_id::text, deleted_at, coalesce((%s)::text, '''') from public.%I where id::text = $1', lbl_expr, p_entity) into cid, already, lbl using p_id;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Record not found'; end if;
  if already is not null then raise exception 'Already deleted'; end if;
  if public.soft_can_delete(p_entity, cid) is not true then raise exception 'You do not have permission to delete this'; end if;

  execute format('update public.%I set deleted_at = now(), deleted_by = $1, delete_batch = $2 where id::text = $3', p_entity) using me, b, p_id;
  -- related records go with their parent and come back with it
  if p_entity = 'roles' then
    update public.issues set deleted_at = now(), deleted_by = me, delete_batch = b where deleted_at is null and candidate_id in (select id from public.candidates where role = p_id and deleted_at is null);
    get diagnostics n = row_count; if n > 0 then ch := ch || jsonb_build_object('issues', n); end if;
    update public.candidates set deleted_at = now(), deleted_by = me, delete_batch = b where role = p_id and deleted_at is null;
    get diagnostics n = row_count; if n > 0 then ch := ch || jsonb_build_object('candidates', n); end if;
  elsif p_entity = 'candidates' then
    update public.issues set deleted_at = now(), deleted_by = me, delete_batch = b where candidate_id = p_id and deleted_at is null;
    get diagnostics n = row_count; if n > 0 then ch := ch || jsonb_build_object('issues', n); end if;
  elsif p_entity = 'staff' then
    update public.staff_documents set deleted_at = now(), deleted_by = me, delete_batch = b where staff_id::text = p_id and deleted_at is null;
    get diagnostics n = row_count; if n > 0 then ch := ch || jsonb_build_object('staff_documents', n); end if;
    update public.leave_requests set deleted_at = now(), deleted_by = me, delete_batch = b where staff_id::text = p_id and deleted_at is null;
    get diagnostics n = row_count; if n > 0 then ch := ch || jsonb_build_object('leave_requests', n); end if;
  elsif p_entity = 'press_jobs' then
    update public.press_payments set deleted_at = now(), deleted_by = me, delete_batch = b where job_id::text = p_id and deleted_at is null;
    get diagnostics n = row_count; if n > 0 then ch := ch || jsonb_build_object('press_payments', n); end if;
    update public.press_files set deleted_at = now(), deleted_by = me, delete_batch = b where job_id::text = p_id and deleted_at is null;
    get diagnostics n = row_count; if n > 0 then ch := ch || jsonb_build_object('press_files', n); end if;
  end if;
  insert into public.deletions (id, entity, record_id, label, company_id, children, deleted_by)
  values (b, p_entity, p_id, left(lbl, 200), cid, ch, me) returning * into d;
  return d;
end $$;

-- Group Admins bring back a whole delete action (the record and everything deleted with it).
create or replace function public.restore_deleted(p_batch uuid) returns public.deletions
language plpgsql security definer set search_path = public as $$
declare d public.deletions; t text; parent_gone boolean := false; me text := public.my_email();
begin
  if public.is_admin() is not true then raise exception 'Only a Group Admin can restore'; end if;
  select * into d from public.deletions where id = p_batch;
  if d.id is null then raise exception 'Nothing to restore'; end if;
  if d.restored_at is not null then raise exception 'Already restored'; end if;
  if d.purged_at is not null then raise exception 'This was deleted permanently and cannot be restored'; end if;
  -- refuse to bring back a child whose parent is still deleted (restore the parent first)
  if d.entity = 'candidates' then select exists (select 1 from public.candidates c join public.roles r on r.id = c.role where c.id = d.record_id and r.deleted_at is not null) into parent_gone;
  elsif d.entity = 'issues' then select exists (select 1 from public.issues i join public.candidates c on c.id = i.candidate_id where i.id = d.record_id and c.deleted_at is not null) into parent_gone;
  elsif d.entity in ('staff_documents', 'leave_requests') then execute format('select exists (select 1 from public.%I x join public.staff s on s.id = x.staff_id where x.id::text = $1 and s.deleted_at is not null)', d.entity) into parent_gone using d.record_id;
  elsif d.entity in ('press_payments', 'press_files') then execute format('select exists (select 1 from public.%I x join public.press_jobs j on j.id = x.job_id where x.id::text = $1 and j.deleted_at is not null)', d.entity) into parent_gone using d.record_id;
  end if;
  if parent_gone then raise exception 'Restore the record this belongs to first'; end if;
  foreach t in array array['roles','candidates','issues','staff','staff_documents','leave_requests','press_customers','press_rate_items','press_jobs','press_payments','press_materials','press_files','customer_requests'] loop
    execute format('update public.%I set deleted_at = null, deleted_by = null, delete_batch = null where delete_batch = $1', t) using p_batch;
  end loop;
  update public.deletions set restored_at = now(), restored_by = me where id = p_batch returning * into d;
  return d;
end $$;

-- Group Admins remove a deleted record for good. The caller must repeat the record's label exactly.
-- Stored files (Storage) are not removed by this; the runbook covers that.
create or replace function public.purge_deleted(p_batch uuid, p_confirm text) returns public.deletions
language plpgsql security definer set search_path = public as $$
declare d public.deletions; t text; me text := public.my_email();
begin
  if public.is_admin() is not true then raise exception 'Only a Group Admin can delete permanently'; end if;
  select * into d from public.deletions where id = p_batch;
  if d.id is null or d.restored_at is not null or d.purged_at is not null then raise exception 'Nothing to delete permanently'; end if;
  if trim(lower(coalesce(p_confirm, ''))) <> trim(lower(d.label)) then raise exception 'Type the name exactly to confirm'; end if;
  -- children first, then the record itself (FKs would cascade anyway; explicit is clearer)
  foreach t in array array['issues','candidates','staff_documents','leave_requests','press_payments','press_files','roles','staff','press_jobs','press_customers','press_rate_items','press_materials','customer_requests'] loop
    execute format('delete from public.%I where delete_batch = $1', t) using p_batch;
  end loop;
  update public.deletions set purged_at = now(), purged_by = me where id = p_batch returning * into d;
  return d;
end $$;

revoke all on function public.soft_delete(text, text), public.restore_deleted(uuid), public.purge_deleted(uuid, text), public.soft_can_delete(text, text) from public, anon;
grant execute on function public.soft_delete(text, text), public.restore_deleted(uuid), public.purge_deleted(uuid, text) to authenticated;

-- 3. Security fix found by the Stage 2 tests (applied 2026-10-26).
-- The permission helpers returned NULL (not false) for a signed-in person with no membership. RLS treats NULL as deny,
-- but functions written "if not <helper> then raise" let NULL through: admin_approve, admin_invite, admin_remove_member,
-- admin_save_company, admin_set_member, leave_decide, next_number, request_to_quote. Checked: no misuse in the data.
create or replace function public.can_manage_company(cid text) returns boolean language sql stable set search_path to 'public' as $function$ select coalesce(public.my_company_role(cid) in ('admin', 'manager'), false) $function$;
create or replace function public.can_write_company(cid text) returns boolean language sql stable set search_path to 'public' as $function$ select coalesce(public.my_company_role(cid) in ('admin', 'manager', 'staff'), false) $function$;
create or replace function public.is_company_admin(cid text) returns boolean language sql stable set search_path to 'public' as $function$ select coalesce(public.my_company_role(cid) = 'admin', false) $function$;
create or replace function public.is_admin() returns boolean language sql stable set search_path to 'public' as $function$ select coalesce(public.my_level() = 'editor', false) $function$;
create or replace function public.is_editor() returns boolean language sql stable set search_path to 'public' as $function$ select coalesce(public.my_level() = 'editor', false) $function$;
create or replace function public.can_write() returns boolean language sql stable set search_path to 'public' as $function$ select coalesce(public.my_level() in ('contributor','editor'), false) $function$;
