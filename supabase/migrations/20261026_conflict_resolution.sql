-- Stage 7 (resilience): Group Admins resolve conflicts.
-- resolve_conflict(conflict, choice, values, seen_version, op_id):
--   keep_current  → the record is left as it is; the conflict is closed.
--   take_incoming → the values the other person tried to save are written.
--   merged        → the admin's own value for each field in conflict is written.
-- Writes go through apply_op (same permissions, operation id, version stamp, log). If the record changed after the admin
-- opened it (seen_version is not the current version), nothing is written and the latest values come back ("stale").
-- Private staff fields were never stored in conflicts ([hidden]); for those, Take incoming is refused: type the value
-- (Edit and merge) or Keep current. Every resolution is logged in ops_log as action "resolve" with the choice.
-- Sending the same op_id again returns "duplicate" (already resolved), never a second write.
-- Rollback: drop function public.resolve_conflict(uuid, text, jsonb, int, uuid); drop function fr_internal._conflict_close(uuid, text, jsonb, uuid);
--           restore the ops_log action check without 'resolve' (only after deleting any 'resolve' rows, which would be lost).

alter table public.ops_log drop constraint if exists ops_log_action_check;
alter table public.ops_log add constraint ops_log_action_check
  check (action in ('insert', 'update', 'soft_delete', 'restore', 'delete', 'conflict', 'refused', 'duplicate', 'resolve'));

create or replace function fr_internal._conflict_close(p_id uuid, p_status text, p_resolution jsonb, p_op uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if current_setting('fr.op_id', true) is distinct from p_op::text then raise exception 'internal helper'; end if;
  if not coalesce(public.is_admin(), false) then raise exception 'Only Group Admins can resolve conflicts'; end if;
  update public.conflicts set status = p_status, resolved_by = public.my_email(), resolved_at = now(), resolution = p_resolution || jsonb_build_object('op_id', p_op)
  where id = p_id and status = 'open';
  get diagnostics n = row_count; return n;
end $$;
revoke all on function fr_internal._conflict_close(uuid, text, jsonb, uuid) from public, anon;
grant execute on function fr_internal._conflict_close(uuid, text, jsonb, uuid) to authenticated;

create or replace function public.resolve_conflict(p_conflict uuid, p_choice text, p_values jsonb default null, p_seen_version int default null, p_op_id uuid default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  c public.conflicts; cur jsonb; vals jsonb; r jsonb; cver int; op uuid := coalesce(p_op_id, gen_random_uuid());
  st text := case p_choice when 'keep_current' then 'kept_current' when 'take_incoming' then 'took_incoming' when 'merged' then 'merged' end;
begin
  if not coalesce(public.is_admin(), false) then return jsonb_build_object('result', 'refused', 'message', 'Only Group Admins can resolve conflicts'); end if;
  if st is null then return jsonb_build_object('result', 'refused', 'message', 'Choose Keep current, Take incoming or Edit and merge'); end if;
  select * into c from public.conflicts where id = p_conflict;
  if c.id is null then return jsonb_build_object('result', 'refused', 'message', 'Conflict not found'); end if;
  if c.status <> 'open' then
    return jsonb_build_object('result', 'duplicate', 'status', c.status, 'message', 'Already resolved by ' || coalesce(c.resolved_by, '?'));
  end if;
  execute format('select to_jsonb(t) from public.%I t where id::text = $1', c.entity) into cur using c.record_id;
  cver := (cur ->> 'version')::int;
  perform set_config('fr.op_id', op::text, true);

  if p_choice = 'keep_current' then
    perform fr_internal._conflict_close(c.id, st, jsonb_build_object('choice', p_choice, 'version', cver), op);
    perform fr_internal._op_log(op, c.entity, c.record_id, c.company_id, 'resolve', 'applied', c.current_version, cver, null,
      jsonb_build_object('conflict_id', c.id, 'choice', p_choice, 'fields', c.fields), '{}'::jsonb);
    return jsonb_build_object('result', 'applied', 'choice', p_choice, 'op_id', op, 'version', cver);
  end if;

  if cur is null then return jsonb_build_object('result', 'refused', 'message', 'This record no longer exists. Choose Keep current to close the conflict.'); end if;
  if cur ->> 'deleted_at' is not null then return jsonb_build_object('result', 'refused', 'message', 'This record was deleted. Restore it from Recently deleted first, or choose Keep current.'); end if;
  if p_seen_version is null or p_seen_version <> cver then
    return jsonb_build_object('result', 'stale', 'version', cver, 'row', cur, 'message', 'This record changed while you were looking at it. The latest values are now shown; choose again.');
  end if;

  if p_choice = 'take_incoming' then vals := c.incoming;
  else
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into vals from jsonb_each(coalesce(p_values, '{}'::jsonb)) where key = any(c.fields);
    if (select count(*) from jsonb_object_keys(vals)) <> coalesce(array_length(c.fields, 1), 0) then
      return jsonb_build_object('result', 'refused', 'message', 'Give a value for every field in conflict');
    end if;
  end if;
  if exists (select 1 from jsonb_each(vals) where value in ('"[hidden]"'::jsonb, '"[history]"'::jsonb)) then
    return jsonb_build_object('result', 'refused', 'message', 'This involves private staff details that are not stored with conflicts. Use Edit and merge and type the value, or Keep current.');
  end if;

  r := public.apply_op(op, c.entity, c.record_id, 'update', vals, cver);
  if r ->> 'result' not in ('applied', 'duplicate') then
    return jsonb_build_object('result', coalesce(r ->> 'result', 'refused'), 'message', coalesce(r ->> 'message', 'Not saved'));
  end if;
  perform set_config('fr.op_id', op::text, true);
  perform fr_internal._conflict_close(c.id, st, jsonb_build_object('choice', p_choice, 'version', (r ->> 'version')::int, 'values', fr_internal._op_mask(c.entity, vals)), op);
  perform fr_internal._op_log(op, c.entity, c.record_id, c.company_id, 'resolve', 'applied', cver, (r ->> 'version')::int, null,
    jsonb_build_object('conflict_id', c.id, 'choice', p_choice, 'fields', c.fields), vals);
  return jsonb_build_object('result', 'applied', 'choice', p_choice, 'op_id', op, 'version', (r ->> 'version')::int, 'row', r -> 'row');
end $$;
revoke all on function public.resolve_conflict(uuid, text, jsonb, int, uuid) from public, anon;
grant execute on function public.resolve_conflict(uuid, text, jsonb, int, uuid) to authenticated;


-- Stage 7 fix to apply_op: when a save clashes on some fields, the fields that do NOT clash are still saved;
-- only the clashing fields wait in conflicts for a Group Admin. (Stage 4 held back the whole save, which dropped
-- the non-clashing fields because conflicts only stores the clashing ones.)
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
        -- the clashing fields wait for review; the rest of this save still goes through (Stage 7 fix: nothing is dropped)
        select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into patch from jsonb_each(patch) where not (key = any(clash));
      end if;
    end if;
    -- 4. history: union, never shorter
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
  if conf is not null then
    perform fr_internal._op_receipt_end(p_op_id, 'conflict', rid, (newrow ->> 'version')::int);
    return jsonb_build_object('result', 'conflict', 'op_id', p_op_id, 'conflict_id', conf, 'fields', clash, 'id', rid, 'version', (newrow ->> 'version')::int, 'row', newrow,
      'message', 'Someone else changed ' || array_to_string(clash, ', ') || ' on this record meanwhile. Your other changes were saved; your ' || array_to_string(clash, ', ') || ' was kept for a Group Admin to review.');
  end if;
  perform fr_internal._op_receipt_end(p_op_id, 'applied', newrow ->> 'id', (newrow ->> 'version')::int);
  return jsonb_build_object('result', 'applied', 'op_id', p_op_id, 'action', act, 'id', newrow ->> 'id', 'version', (newrow ->> 'version')::int, 'row', newrow);
end $$;
revoke all on function public.apply_op(uuid, text, text, text, jsonb, int) from public, anon;
grant execute on function public.apply_op(uuid, text, text, text, jsonb, int) to authenticated;
