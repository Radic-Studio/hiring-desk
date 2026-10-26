-- Stage 9 finding: apply_op passed generated columns (leave_requests.days) into the insert/update, so a client that sent one
-- got an unhandled database error instead of a clean result. Generated columns are now ignored like the other protected
-- fields (id, version, ...), because the database computes them. Found while creating the DEMO leave request.
-- The app itself never sends them; this only hardens the write path (and queued replays) against a stray field.
-- Change: one line, the column list now excludes generated columns. Nothing else differs from the live definition.
-- Backup before change: pre-stage9-export (2026-10-26 12:58 UTC, 30 tables, 273 rows, counts verified).
-- Rollback: re-run apply_op from supabase/schema/schema_snapshot.sql as committed in f68c05c.
CREATE OR REPLACE FUNCTION public.apply_op(p_op_id uuid, p_entity text, p_id text, p_action text, p_patch jsonb, p_base_version integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
