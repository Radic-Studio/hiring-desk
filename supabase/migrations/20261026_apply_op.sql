-- Stage 4 (resilience): one idempotent, version-checked write path.
-- The app sends every change to the business tables as apply_op(op_id, entity, id, action, patch, base_version).
--   * Same op_id twice → the second call returns "duplicate"; never a second record or a second change.
--   * Runs as the signed-in user (SECURITY INVOKER), so the existing row-level security decides who may write.
--   * If the row moved on since base_version and someone else changed one of the SAME fields to a different value,
--     nothing is overwritten: a conflicts row keeps both sides and the call returns "conflict". Edits to other fields merge.
--   * history arrays are merged (union), so a stale screen cannot drop history entries.
--   * Every outcome (applied, duplicate, conflict, refused) is written to ops_log.
-- Rollback: drop function public.apply_op(uuid, text, text, text, jsonb, int); drop schema fr_internal cascade; drop tables
--           public.op_receipts, public.conflicts.
--           The app falls back to direct writes only if its code is rolled back too (git revert of the Stage 4 commit).

-- Helpers live in fr_internal, which the REST API does not expose: nobody can call them directly to forge log or conflict rows.
-- The write helpers also refuse to run unless apply_op has set fr.op_id for the same operation in this transaction.
create schema if not exists fr_internal;
revoke all on schema fr_internal from public, anon;
grant usage on schema fr_internal to authenticated;

create table if not exists public.op_receipts (
  op_id uuid primary key,
  actor text not null,
  entity text not null,
  record_id text,
  action text,
  result text not null default 'pending',
  version int,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.op_receipts enable row level security;   -- no policies: only the security-definer helpers touch it

create table if not exists public.conflicts (
  id uuid primary key default gen_random_uuid(),
  op_id uuid not null,
  entity text not null, record_id text not null, company_id text,
  base_version int, current_version int,
  fields text[] not null,
  incoming jsonb not null,      -- what the person tried to save (sensitive staff fields masked)
  current_values jsonb not null,-- what the record held for those fields when it arrived (masked the same way)
  actor text, created_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'kept_current', 'took_incoming', 'merged')),
  resolved_by text, resolved_at timestamptz, resolution jsonb
);
create index if not exists conflicts_open on public.conflicts (created_at desc) where status = 'open';
alter table public.conflicts enable row level security;
drop policy if exists conflicts_read on public.conflicts;
create policy conflicts_read on public.conflicts for select to authenticated using (public.is_admin() or actor = public.my_email());
alter publication supabase_realtime add table public.conflicts;

-- fields whose values never leave the record (same list as ops_log)
create or replace function fr_internal._op_mask(p_entity text, p jsonb) returns jsonb language sql immutable set search_path = public as $$
  select coalesce(jsonb_object_agg(key, case when key = any(case p_entity
      when 'staff' then array['phone','email','address','date_of_birth','emergency_name','emergency_phone','notes','photo_url']
      when 'leave_requests' then array['reason','decision_note'] when 'staff_documents' then array['file_path','note'] else array[]::text[] end)
    then to_jsonb('[hidden]'::text) when key = 'history' then to_jsonb('[history]'::text) else value end), '{}'::jsonb)
  from jsonb_each(coalesce(p, '{}'::jsonb))
$$;

create or replace function fr_internal._op_receipt_begin(p_op uuid, p_entity text, p_id text, p_action text) returns public.op_receipts
language plpgsql security definer set search_path = public as $$
declare r public.op_receipts;
begin
  if current_setting('fr.op_id', true) is distinct from p_op::text then raise exception 'internal helper'; end if;
  select * into r from public.op_receipts where op_id = p_op;
  if r.op_id is not null then return r; end if;
  insert into public.op_receipts (op_id, actor, entity, record_id, action) values (p_op, public.my_email(), p_entity, p_id, p_action);
  return null;   -- a concurrent call with the same op_id waits here, then gets unique_violation
end $$;

create or replace function fr_internal._op_receipt_end(p_op uuid, p_result text, p_id text, p_version int) returns void
language sql security definer set search_path = public as $$
  update public.op_receipts set result = p_result, record_id = coalesce(p_id, record_id), version = p_version, finished_at = now()
  where op_id = p_op and current_setting('fr.op_id', true) = p_op::text
$$;

create or replace function fr_internal._op_log(p_op uuid, p_entity text, p_id text, p_company text, p_action text, p_result text, p_base int, p_version int, p_error text, p_conflict jsonb, p_changes jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.ops_log (op_id, entity, record_id, company_id, action, result, base_version, result_version, actor, actor_uid, source, changes, error, conflict)
  select p_op, p_entity, coalesce(p_id, ''), p_company, p_action, p_result, p_base, p_version, coalesce(nullif(public.my_email(), ''), 'service'), auth.uid(), 'app',
          fr_internal._op_mask(p_entity, p_changes), left(p_error, 1000), p_conflict
  where current_setting('fr.op_id', true) = p_op::text
$$;

-- fields changed by OTHER people between two versions (your own earlier saves never conflict with your next one)
create or replace function fr_internal._op_changed_fields(p_entity text, p_id text, p_base int, p_current int) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct k), '{}') from public.ops_log l, jsonb_object_keys(l.changes) k
  where l.entity = p_entity and l.record_id = p_id and l.result = 'applied' and l.result_version > p_base and l.result_version <= p_current
    and l.actor is distinct from public.my_email()
$$;

create or replace function fr_internal._op_record_conflict(p_op uuid, p_entity text, p_id text, p_company text, p_base int, p_current int, p_fields text[], p_incoming jsonb, p_current_values jsonb)
returns uuid language sql security definer set search_path = public as $$
  insert into public.conflicts (op_id, entity, record_id, company_id, base_version, current_version, fields, incoming, current_values, actor)
  select p_op, p_entity, p_id, p_company, p_base, p_current, p_fields, fr_internal._op_mask(p_entity, p_incoming), fr_internal._op_mask(p_entity, p_current_values), public.my_email()
  where current_setting('fr.op_id', true) = p_op::text
  returning id
$$;

create or replace function public.apply_op(p_op_id uuid, p_entity text, p_id text, p_action text, p_patch jsonb, p_base_version int default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  me text := coalesce(public.my_email(), '');
  act text := lower(coalesce(p_action, ''));
  allowed text[] := array['roles','candidates','issues','staff','staff_documents','leave_requests','press_customers','press_rate_items','press_jobs','press_payments','press_materials','press_files','customer_requests','press_material_moves','customer_request_messages'];
  insert_only text[] := array['press_material_moves','customer_request_messages'];
  protected text[] := array['id','version','op_id','deleted_at','deleted_by','delete_batch','created_at','created_by','updated_at','updated_by'];
  cols text[]; has_version boolean; patch jsonb; cur jsonb; newrow jsonb; rec public.op_receipts; sets text; collist text;
  changed text[]; clash text[]; conf uuid; n int; norm jsonb; cver int; rid text := p_id;
begin
  if me = '' then return jsonb_build_object('result', 'refused', 'message', 'Sign in first'); end if;
  if p_op_id is null then return jsonb_build_object('result', 'refused', 'message', 'Missing operation id'); end if;
  if not (p_entity = any(allowed)) then return jsonb_build_object('result', 'refused', 'message', 'This kind of record cannot be saved here'); end if;
  if act not in ('insert', 'update', 'save') or (p_entity = any(insert_only) and act <> 'insert') then
    return jsonb_build_object('result', 'refused', 'message', 'Unsupported action');
  end if;

  -- 1. idempotency
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

  -- 2. shape the patch: real, writable columns only
  select array_agg(column_name::text) into cols from information_schema.columns where table_schema = 'public' and table_name = p_entity;
  has_version := 'version' = any(cols);
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into patch from jsonb_each(coalesce(p_patch, '{}'::jsonb)) where key = any(cols) and not (key = any(protected));
  -- normalise every value to the column's own type/format, so "the same value written differently" is not a change
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
    -- 3. conflict check: same field changed by someone else since the version this screen had
    if has_version and p_base_version is not null and cver <> p_base_version then
      changed := fr_internal._op_changed_fields(p_entity, rid, p_base_version, cver);
      select coalesce(array_agg(key), '{}') into clash from jsonb_each(patch)
        where key <> 'history' and key = any(changed) and (cur -> key) is distinct from value;
      if coalesce(array_length(clash, 1), 0) > 0 then
        conf := fr_internal._op_record_conflict(p_op_id, p_entity, rid, cur ->> 'company_id', p_base_version, cver, clash,
                  (select jsonb_object_agg(k, patch -> k) from unnest(clash) k), (select jsonb_object_agg(k, cur -> k) from unnest(clash) k));
        perform fr_internal._op_log(p_op_id, p_entity, rid, cur ->> 'company_id', 'conflict', 'conflict', p_base_version, cver, null, jsonb_build_object('conflict_id', conf, 'fields', clash), patch);
        perform fr_internal._op_receipt_end(p_op_id, 'conflict', rid, cver);
        return jsonb_build_object('result', 'conflict', 'op_id', p_op_id, 'conflict_id', conf, 'fields', clash, 'id', rid, 'version', cver, 'row', cur,
          'message', 'Someone else changed ' || array_to_string(clash, ', ') || ' on this record meanwhile. Your version was kept for a Group Admin to review; the latest is now shown.');
      end if;
    end if;
    -- 4. history: union, never shorter
    if patch ? 'history' and jsonb_typeof(patch -> 'history') = 'array' and jsonb_typeof(cur -> 'history') = 'array' then
      patch := patch || jsonb_build_object('history', (cur -> 'history') || coalesce((select jsonb_agg(e) from jsonb_array_elements(patch -> 'history') e where not exists (select 1 from jsonb_array_elements(cur -> 'history') c where c = e)), '[]'::jsonb));
    end if;
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into patch from jsonb_each(patch) where (cur -> key) is distinct from value;
    if patch = '{}'::jsonb then
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
    -- insert
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
  perform fr_internal._op_receipt_end(p_op_id, 'applied', newrow ->> 'id', (newrow ->> 'version')::int);
  return jsonb_build_object('result', 'applied', 'op_id', p_op_id, 'action', act, 'id', newrow ->> 'id', 'version', (newrow ->> 'version')::int, 'row', newrow);
end $$;

revoke all on function public.apply_op(uuid, text, text, text, jsonb, int) from public, anon;
grant execute on function public.apply_op(uuid, text, text, text, jsonb, int) to authenticated;
revoke all on function fr_internal._op_mask(text, jsonb), fr_internal._op_receipt_begin(uuid, text, text, text), fr_internal._op_receipt_end(uuid, text, text, int),
  fr_internal._op_log(uuid, text, text, text, text, text, int, int, text, jsonb, jsonb), fr_internal._op_changed_fields(text, text, int, int),
  fr_internal._op_record_conflict(uuid, text, text, text, int, int, text[], jsonb, jsonb) from public, anon;
-- apply_op runs as the caller, so the caller needs EXECUTE on the helpers; they only do what apply_op asks of them
grant execute on function fr_internal._op_mask(text, jsonb), fr_internal._op_receipt_begin(uuid, text, text, text), fr_internal._op_receipt_end(uuid, text, text, int),
  fr_internal._op_log(uuid, text, text, text, text, text, int, int, text, jsonb, jsonb), fr_internal._op_changed_fields(text, text, int, int),
  fr_internal._op_record_conflict(uuid, text, text, text, int, int, text[], jsonb, jsonb) to authenticated;
