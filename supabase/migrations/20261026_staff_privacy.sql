-- Stage 9 (backend completion): staff privacy. Management decision 26 Oct 2026: private staff details are visible only to the
-- company's Admins and Managers, Group Admins, and the person themselves. The staff directory (name, position, department, work
-- phone and email, photo, status) stays visible to everyone with a role in the company.
--   1. staff_private holds address, date of birth, emergency contact and notes (one row per staff record, same id).
--   2. Leave requests (type, reason, decision note): managers and the person only; everyone else gets leave_calendar(), which
--      lists approved leave by name and dates without type or reason.
--   3. Staff documents (list and files): managers and the person only.
--   4. apply_op accepts staff_private and refuses private fields sent to staff (an older screen), instead of dropping them.
--   5. Deleting, restoring and purging a staff record carries staff_private with it; the log and conflicts mask its values.
--   6. ops_log.source now says how a change arrived: app (checked save path), rpc (named server function), direct (raw table
--      write) or service (background script). Before, every signed-in change was labelled app.
-- Data: staff had 2 rows (both DEMO); their private values are copied before the columns are dropped.
-- Backup before change: pre-stage9b export (see change log). Rollback: re-add the five columns to staff, copy back from
-- staff_private, restore the previous functions and policies from supabase/schema/schema_snapshot.sql at commit 9c51435.

create table public.staff_private (
  id uuid primary key references public.staff(id) on delete cascade,
  company_id text not null references public.companies(id),
  address text not null default '',
  date_of_birth date,
  emergency_name text not null default '',
  emergency_phone text not null default '',
  notes text not null default '',
  version integer not null default 1,
  op_id uuid default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  deleted_at timestamptz,
  deleted_by text,
  delete_batch uuid
);
alter table public.staff_private enable row level security;

-- the private row always belongs to the staff record's own company (callers cannot choose it)
create or replace function public.staff_private_company() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select s.company_id into new.company_id from public.staff s where s.id = new.id;
  if new.company_id is null then raise exception 'No staff record for these private details'; end if;
  return new;
end $$;
revoke all on function public.staff_private_company() from public, anon, authenticated;
create trigger staff_private_company before insert or update on public.staff_private for each row execute function public.staff_private_company();
create trigger zz_stamp_row before insert or update on public.staff_private for each row execute function public.stamp_row();
create trigger zz_log_op after insert or update or delete on public.staff_private for each row execute function public.log_op();

create policy staff_private_read on public.staff_private for select
  using (public.can_manage_company(company_id) or exists (select 1 from public.staff s where s.id = staff_private.id and lower(s.member_email) = public.my_email()));
create policy staff_private_write on public.staff_private for all
  using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));
create policy staff_private_hide_deleted on public.staff_private as restrictive for select using (deleted_at is null or public.is_admin());
create policy staff_private_no_hard_delete on public.staff_private as restrictive for delete using (public.is_admin());

insert into public.staff_private (id, company_id, address, date_of_birth, emergency_name, emergency_phone, notes)
select id, company_id, address, date_of_birth, emergency_name, emergency_phone, notes from public.staff
 where address <> '' or date_of_birth is not null or emergency_name <> '' or emergency_phone <> '' or notes <> '';
alter table public.staff drop column address, drop column date_of_birth, drop column emergency_name, drop column emergency_phone, drop column notes;

-- leave: details for managers and the person; a names-and-dates calendar for everyone in the company
drop policy leave_read on public.leave_requests;
create policy leave_read on public.leave_requests for select
  using (public.can_manage_company(company_id) or lower(requested_by) = public.my_email()
         or exists (select 1 from public.staff s where s.id = leave_requests.staff_id and lower(s.member_email) = public.my_email()));
create or replace function public.leave_calendar(p_company text)
returns table (id uuid, staff_id uuid, staff_name text, start_date date, end_date date, days integer, status public.leave_status)
language sql stable security definer set search_path = public as $$
  select l.id, l.staff_id, s.full_name, l.start_date, l.end_date, l.days, l.status
    from public.leave_requests l join public.staff s on s.id = l.staff_id and s.deleted_at is null
   where l.company_id = p_company and l.deleted_at is null and l.status = 'approved' and l.end_date >= current_date
     and public.my_company_role(p_company) is not null
   order by l.start_date;
$$;
revoke all on function public.leave_calendar(text) from public, anon;
grant execute on function public.leave_calendar(text) to authenticated;

-- staff documents: managers and the person only (list and files)
drop policy staff_documents_read on public.staff_documents;
create policy staff_documents_read on public.staff_documents for select
  using (public.can_manage_company(company_id) or exists (select 1 from public.staff s where s.id = staff_documents.staff_id and lower(s.member_email) = public.my_email()));
drop policy "staff docs read by company" on storage.objects;
create policy "staff docs read by managers or owner" on storage.objects for select
  using (bucket_id = 'staff-docs' and (public.can_manage_company((storage.foldername(name))[1])
         or exists (select 1 from public.staff s where s.id::text = (storage.foldername(name))[2] and lower(s.member_email) = public.my_email())));

CREATE OR REPLACE FUNCTION public.apply_op(p_op_id uuid, p_entity text, p_id text, p_action text, p_patch jsonb, p_base_version integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  me text := coalesce(public.my_email(), '');
  act text := lower(coalesce(p_action, ''));
  allowed text[] := array['roles','candidates','issues','staff','staff_private','staff_documents','leave_requests','press_customers','press_rate_items','press_jobs','press_payments','press_materials','press_files','customer_requests','press_material_moves','customer_request_messages'];
  insert_only text[] := array['press_material_moves','customer_request_messages'];
  protected text[] := array['id','version','op_id','deleted_at','deleted_by','delete_batch','created_at','created_by','updated_at','updated_by'];
  cols text[]; has_version boolean; patch jsonb; cur jsonb; newrow jsonb; rec public.op_receipts; sets text; collist text;
  changed text[]; clash text[]; conf uuid; n int; norm jsonb; cver int; rid text := p_id;
begin
  if me = '' then return jsonb_build_object('result', 'refused', 'message', 'Sign in first'); end if;
  if p_op_id is null then return jsonb_build_object('result', 'refused', 'message', 'Missing operation id'); end if;
  if not (p_entity = any(allowed)) then return jsonb_build_object('result', 'refused', 'message', 'This kind of record cannot be saved here'); end if;
  -- private staff details live in staff_private since 26 Oct 2026; an older screen that still sends them is refused, never silently dropped
  if p_entity = 'staff' and exists (select 1 from jsonb_each(coalesce(p_patch, '{}'::jsonb)) where key = any(array['address','date_of_birth','emergency_name','emergency_phone','notes']) and value not in ('null'::jsonb, '""'::jsonb)) then
    return jsonb_build_object('result', 'refused', 'message', 'Private staff details are now saved separately. Reload the app and try again.');
  end if;
  if act not in ('insert', 'update', 'save') or (p_entity = any(insert_only) and act <> 'insert') then
    return jsonb_build_object('result', 'refused', 'message', 'Unsupported action');
  end if;

  perform set_config('fr.op_id', p_op_id::text, true);
  begin
    rec := fr_internal._op_receipt_begin(p_op_id, p_entity, p_id, act);
  exception when unique_violation then
    return jsonb_build_object('result', 'duplicate', 'op_id', p_op_id, 'message', 'This change was already received');
  end;
  if rec.op_id is not null then
    if rec.actor <> me then return jsonb_build_object('result', 'refused', 'message', 'Operation id already used'); end if;
    perform fr_internal._op_log(p_op_id, p_entity, rec.record_id, null, 'duplicate', 'duplicate', null, rec.version, null, null, '{}'::jsonb);
    if rec.record_id is not null then execute format('select to_jsonb(t) from public.%I t where id::text = $1', p_entity) into cur using rec.record_id; end if;
    return jsonb_build_object('result', 'duplicate', 'first_result', rec.result, 'op_id', p_op_id, 'id', rec.record_id, 'version', rec.version, 'row', cur, 'message', 'This change was already received');
  end if;

  select array_agg(column_name::text) into cols from information_schema.columns where table_schema = 'public' and table_name = p_entity and is_generated = 'NEVER';
  has_version := 'version' = any(cols);
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into patch from jsonb_each(coalesce(p_patch, '{}'::jsonb)) where key = any(cols) and not (key = any(protected));
  begin
    execute format('select to_jsonb(jsonb_populate_record(null::public.%I, $1))', p_entity) into norm using patch;
  exception when others then
    perform fr_internal._op_log(p_op_id, p_entity, rid, null, 'refused', 'refused', p_base_version, null, sqlerrm, null, '{}'::jsonb);
    perform fr_internal._op_receipt_end(p_op_id, 'refused', rid, null);
    return jsonb_build_object('result', 'refused', 'op_id', p_op_id, 'message', 'A value is not valid: ' || sqlerrm);
  end;
  select coalesce(jsonb_object_agg(key, norm -> key), '{}'::jsonb) into patch from jsonb_object_keys(patch) key;
  if rid is not null then execute format('select to_jsonb(t) from public.%I t where id::text = $1', p_entity) into cur using rid; end if;
  if act = 'save' then act := case when cur is null then 'insert' else 'update' end; end if;

  if act = 'update' then
    if cur is null then
      perform fr_internal._op_log(p_op_id, p_entity, rid, null, 'refused', 'refused', p_base_version, null, 'not found or no access', null, patch);
      perform fr_internal._op_receipt_end(p_op_id, 'refused', rid, null);
      return jsonb_build_object('result', 'refused', 'op_id', p_op_id, 'message', 'This record no longer exists, or you cannot change it');
    end if;
    if cur ->> 'deleted_at' is not null then
      perform fr_internal._op_log(p_op_id, p_entity, rid, cur ->> 'company_id', 'refused', 'refused', p_base_version, (cur ->> 'version')::int, 'record is deleted', null, patch);
      perform fr_internal._op_receipt_end(p_op_id, 'refused', rid, (cur ->> 'version')::int);
      return jsonb_build_object('result', 'refused', 'op_id', p_op_id, 'message', 'This record was deleted. A Group Admin can restore it from Recently deleted.');
    end if;
    cver := (cur ->> 'version')::int;
    if has_version and p_base_version is not null and cver <> p_base_version then
      changed := fr_internal._op_changed_fields(p_entity, rid, p_base_version, cver);
      select coalesce(array_agg(key), '{}') into clash from jsonb_each(patch)
        where key <> 'history' and key = any(changed) and (cur -> key) is distinct from value;
      if coalesce(array_length(clash, 1), 0) > 0 then
        conf := fr_internal._op_record_conflict(p_op_id, p_entity, rid, cur ->> 'company_id', p_base_version, cver, clash,
                  (select jsonb_object_agg(k, patch -> k) from unnest(clash) k), (select jsonb_object_agg(k, cur -> k) from unnest(clash) k));
        perform fr_internal._op_log(p_op_id, p_entity, rid, cur ->> 'company_id', 'conflict', 'conflict', p_base_version, cver, null, jsonb_build_object('conflict_id', conf, 'fields', clash), patch);
        select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into patch from jsonb_each(patch) where not (key = any(clash));
      end if;
    end if;
    if patch ? 'history' and jsonb_typeof(patch -> 'history') = 'array' and jsonb_typeof(cur -> 'history') = 'array' then
      patch := patch || jsonb_build_object('history', (cur -> 'history') || coalesce((select jsonb_agg(e) from jsonb_array_elements(patch -> 'history') e where not exists (select 1 from jsonb_array_elements(cur -> 'history') c where c = e)), '[]'::jsonb));
    end if;
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into patch from jsonb_each(patch) where (cur -> key) is distinct from value;
    if patch = '{}'::jsonb then
      if conf is not null then
        perform fr_internal._op_receipt_end(p_op_id, 'conflict', rid, cver);
        return jsonb_build_object('result', 'conflict', 'op_id', p_op_id, 'conflict_id', conf, 'fields', clash, 'id', rid, 'version', cver, 'row', cur,
          'message', 'Someone else changed ' || array_to_string(clash, ', ') || ' on this record meanwhile. Your version was kept for a Group Admin to review; the latest is now shown.');
      end if;
      perform fr_internal._op_receipt_end(p_op_id, 'applied', rid, cver);
      return jsonb_build_object('result', 'applied', 'op_id', p_op_id, 'id', rid, 'version', cver, 'row', cur, 'message', 'No changes');
    end if;
    select string_agg(format('%I = r.%I', key, key), ', ') into sets from jsonb_object_keys(patch) key;
    begin
      execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) r where t.id::text = $2 returning to_jsonb(t)', p_entity, sets, p_entity) into newrow using patch, rid;
      get diagnostics n = row_count;
    exception when insufficient_privilege or check_violation or not_null_violation or foreign_key_violation or unique_violation or invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range or raise_exception then
      perform fr_internal._op_log(p_op_id, p_entity, rid, cur ->> 'company_id', 'refused', 'refused', p_base_version, cver, sqlerrm, null, patch);
      perform fr_internal._op_receipt_end(p_op_id, 'refused', rid, cver);
      return jsonb_build_object('result', 'refused', 'op_id', p_op_id, 'message', case when sqlstate = '42501' then 'You do not have permission to change this record' else sqlerrm end);
    end;
    if n = 0 then
      perform fr_internal._op_log(p_op_id, p_entity, rid, cur ->> 'company_id', 'refused', 'refused', p_base_version, cver, 'update blocked by access rules', null, patch);
      perform fr_internal._op_receipt_end(p_op_id, 'refused', rid, cver);
      return jsonb_build_object('result', 'refused', 'op_id', p_op_id, 'message', 'You do not have permission to change this record');
    end if;
  else
    if cur is not null then
      perform fr_internal._op_receipt_end(p_op_id, 'refused', rid, (cur ->> 'version')::int);
      return jsonb_build_object('result', 'refused', 'op_id', p_op_id, 'message', 'A record with this id already exists');
    end if;
    if rid is not null then patch := patch || jsonb_build_object('id', rid); end if;
    if patch = '{}'::jsonb then return jsonb_build_object('result', 'refused', 'message', 'Nothing to save'); end if;
    select string_agg(format('%I', key), ', ') into collist from jsonb_object_keys(patch) key;
    begin
      execute format('insert into public.%I as t (%s) select %s from jsonb_populate_record(null::public.%I, $1) returning to_jsonb(t)', p_entity, collist, collist, p_entity) into newrow using patch;
    exception when insufficient_privilege or check_violation or not_null_violation or foreign_key_violation or unique_violation or invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range or raise_exception then
      perform fr_internal._op_log(p_op_id, p_entity, rid, patch ->> 'company_id', 'refused', 'refused', null, null, sqlerrm, null, patch);
      perform fr_internal._op_receipt_end(p_op_id, 'refused', rid, null);
      return jsonb_build_object('result', 'refused', 'op_id', p_op_id, 'message', case when sqlstate = '42501' then 'You do not have permission to add this record' else sqlerrm end);
    end;
  end if;
  if conf is not null then
    perform fr_internal._op_receipt_end(p_op_id, 'conflict', rid, (newrow ->> 'version')::int);
    return jsonb_build_object('result', 'conflict', 'op_id', p_op_id, 'conflict_id', conf, 'fields', clash, 'id', rid, 'version', (newrow ->> 'version')::int, 'row', newrow,
      'message', 'Someone else changed ' || array_to_string(clash, ', ') || ' on this record meanwhile. Your other changes were saved; your ' || array_to_string(clash, ', ') || ' was kept for a Group Admin to review.');
  end if;
  perform fr_internal._op_receipt_end(p_op_id, 'applied', newrow ->> 'id', (newrow ->> 'version')::int);
  return jsonb_build_object('result', 'applied', 'op_id', p_op_id, 'action', act, 'id', newrow ->> 'id', 'version', (newrow ->> 'version')::int, 'row', newrow);
end $function$
;

CREATE OR REPLACE FUNCTION public.log_op()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me text := coalesce(nullif(public.my_email(), ''), ''); act text; ch jsonb := '{}'::jsonb; k text; nv jsonb; ov jsonb; rid text; cid text;
  skip text[] := array['history', 'version', 'op_id', 'updated_at', 'updated_by', 'delete_batch'];
  secret text[] := case tg_table_name
    when 'staff' then array['phone', 'email', 'address', 'date_of_birth', 'emergency_name', 'emergency_phone', 'notes', 'photo_url']
    when 'staff_private' then array['address', 'date_of_birth', 'emergency_name', 'emergency_phone', 'notes']
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
          coalesce(nullif(me, ''), 'service'), auth.uid(),
          case when me = '' then 'service'                                                   -- background script / server key
               when nullif(current_setting('fr.op_id', true), '') is not null then 'app'      -- the checked save path (apply_op, resolve_conflict)
               when current_setting('request.path', true) like '/rpc/%' then 'rpc'           -- a named server function (delete, restore, leave decision, ...)
               else 'direct' end, ch);                                                       -- a raw table write that skipped the checked path
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION fr_internal._op_mask(p_entity text, p jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_object_agg(key, case when key = any(case p_entity
      when 'staff' then array['phone','email','address','date_of_birth','emergency_name','emergency_phone','notes','photo_url']
      when 'staff_private' then array['address','date_of_birth','emergency_name','emergency_phone','notes']
      when 'leave_requests' then array['reason','decision_note'] when 'staff_documents' then array['file_path','note'] else array[]::text[] end)
    then to_jsonb('[hidden]'::text) when key = 'history' then to_jsonb('[history]'::text) else value end), '{}'::jsonb)
  from jsonb_each(coalesce(p, '{}'::jsonb))
$function$
;

CREATE OR REPLACE FUNCTION public.soft_delete(p_entity text, p_id text)
 RETURNS public.deletions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    update public.staff_private set deleted_at = now(), deleted_by = me, delete_batch = b where id::text = p_id and deleted_at is null;
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
end $function$
;

CREATE OR REPLACE FUNCTION public.restore_deleted(p_batch uuid)
 RETURNS public.deletions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d public.deletions; t text; parent_gone boolean := false; me text := public.my_email();
begin
  if public.is_admin() is not true then raise exception 'Only a Group Admin can restore'; end if;
  select * into d from public.deletions where id = p_batch;
  if d.id is null then raise exception 'Nothing to restore'; end if;
  if d.restored_at is not null then raise exception 'Already restored'; end if;
  if d.purged_at is not null then raise exception 'This was deleted permanently and cannot be restored'; end if;
  if d.entity = 'candidates' then select exists (select 1 from public.candidates c join public.roles r on r.id = c.role where c.id = d.record_id and r.deleted_at is not null) into parent_gone;
  elsif d.entity = 'issues' then select exists (select 1 from public.issues i join public.candidates c on c.id = i.candidate_id where i.id = d.record_id and c.deleted_at is not null) into parent_gone;
  elsif d.entity in ('staff_documents', 'leave_requests') then execute format('select exists (select 1 from public.%I x join public.staff s on s.id = x.staff_id where x.id::text = $1 and s.deleted_at is not null)', d.entity) into parent_gone using d.record_id;
  elsif d.entity in ('press_payments', 'press_files') then execute format('select exists (select 1 from public.%I x join public.press_jobs j on j.id = x.job_id where x.id::text = $1 and j.deleted_at is not null)', d.entity) into parent_gone using d.record_id;
  end if;
  if parent_gone then raise exception 'Restore the record this belongs to first'; end if;
  foreach t in array array['roles','candidates','issues','staff','staff_private','staff_documents','leave_requests','press_customers','press_rate_items','press_jobs','press_payments','press_materials','press_files','customer_requests'] loop
    execute format('update public.%I set deleted_at = null, deleted_by = null, delete_batch = null where delete_batch = $1', t) using p_batch;
  end loop;
  update public.deletions set restored_at = now(), restored_by = me where id = p_batch returning * into d;
  return d;
end $function$
;

CREATE OR REPLACE FUNCTION public.purge_deleted(p_batch uuid, p_confirm text)
 RETURNS public.deletions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d public.deletions; t text; me text := public.my_email();
begin
  if public.is_admin() is not true then raise exception 'Only a Group Admin can delete permanently'; end if;
  select * into d from public.deletions where id = p_batch;
  if d.id is null or d.restored_at is not null or d.purged_at is not null then raise exception 'Nothing to delete permanently'; end if;
  if trim(lower(coalesce(p_confirm, ''))) <> trim(lower(d.label)) then raise exception 'Type the name exactly to confirm'; end if;
  foreach t in array array['issues','candidates','staff_private','staff_documents','leave_requests','press_payments','press_files','roles','staff','press_jobs','press_customers','press_rate_items','press_materials','customer_requests'] loop
    execute format('delete from public.%I where delete_batch = $1', t) using p_batch;
  end loop;
  update public.deletions set purged_at = now(), purged_by = me where id = p_batch returning * into d;
  return d;
end $function$
;
