-- Stage 9 (backend completion): integrity and audit hardening, found in the backend review of 26 Oct 2026.
--   1. Same-company rule (MEDIUM): a record may only point at a parent in its own company (a payment at a job, a job at a
--      customer, a file or message at a request, a stock move at a material, a document or leave at a staff record).
--      Row-level security checked only the record's own company; the parent's was not checked. Data was already consistent.
--   2. Audit of group and permission tables (MEDIUM): changes to companies, members, company roles, company settings, hiring
--      settings, app_config and invitations are written to ops_log (who, when, what changed). Secrets are never logged:
--      app_config values, invitation tokens and member phone numbers are masked. Sign-in housekeeping (last_seen_at) is skipped.
--   3. TRUNCATE, TRIGGER and REFERENCES rights removed from the browser roles (LOW): the API never offers them, so nothing
--      in the app changes; it removes a way round row-level security if a browser role ever ran raw SQL.
-- Backup before change: pre-stage9c export (see change log). Rollback: drop the triggers and functions below, and
-- grant truncate, trigger, references on all tables in schema public to anon, authenticated.

-- 1. same company as the parent ---------------------------------------------------------------------------------------
create or replace function public.check_same_company() returns trigger
language plpgsql security definer set search_path = public as $$
declare parent text := tg_argv[0]; fk text := tg_argv[1]; pid text := to_jsonb(new) ->> fk; pc text; also text[];
begin
  if pid is null then return new; end if;
  if parent = 'staff' then
    select s.company_id, s.companies into pc, also from public.staff s where s.id::text = pid;
    if pc is null or new.company_id::text = pc or (tg_table_name = 'leave_requests' and new.company_id::text = any(also)) then return new; end if;
  else
    execute format('select company_id::text from public.%I where id::text = $1', parent) into pc using pid;
    if pc is null or pc = new.company_id::text then return new; end if;
  end if;
  raise exception 'This record must belong to the same company as the % it points to', replace(parent, '_', ' ');
end $$;
revoke all on function public.check_same_company() from public, anon, authenticated;

create trigger a_same_company_customer before insert or update of customer_id, company_id on public.press_jobs for each row execute function public.check_same_company('press_customers', 'customer_id');
create trigger a_same_company_job before insert or update of job_id, company_id on public.press_payments for each row execute function public.check_same_company('press_jobs', 'job_id');
create trigger a_same_company_job before insert or update of job_id, company_id on public.press_files for each row execute function public.check_same_company('press_jobs', 'job_id');
create trigger a_same_company_material before insert or update of material_id, company_id on public.press_material_moves for each row execute function public.check_same_company('press_materials', 'material_id');
create trigger a_same_company_job before insert or update of job_id, company_id on public.press_material_moves for each row execute function public.check_same_company('press_jobs', 'job_id');
create trigger a_same_company_staff before insert or update of staff_id, company_id on public.staff_documents for each row execute function public.check_same_company('staff', 'staff_id');
create trigger a_same_company_staff before insert or update of staff_id, company_id on public.leave_requests for each row execute function public.check_same_company('staff', 'staff_id');
create trigger a_same_company_job before insert or update of job_id, company_id on public.customer_requests for each row execute function public.check_same_company('press_jobs', 'job_id');
create trigger a_same_company_customer before insert or update of customer_id, company_id on public.customer_requests for each row execute function public.check_same_company('press_customers', 'customer_id');
create trigger a_same_company_request before insert or update of request_id, company_id on public.customer_request_messages for each row execute function public.check_same_company('customer_requests', 'request_id');
create trigger a_same_company_request before insert or update of request_id, company_id on public.customer_request_files for each row execute function public.check_same_company('customer_requests', 'request_id');

-- 2. audit of group and permission tables -----------------------------------------------------------------------------
create or replace function public.log_config() returns trigger
language plpgsql security definer set search_path = public as $$
declare me text := coalesce(nullif(public.my_email(), ''), ''); nv jsonb; ov jsonb; k text; ch jsonb := '{}'::jsonb; rid text; cid text;
  noise text[] := array['updated_at', 'last_seen_at'];
  masked text[] := case tg_table_name when 'app_config' then array['value'] when 'member_invites' then array['token'] when 'members' then array['phone'] else array[]::text[] end;
begin
  nv := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  ov := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  for k in select jsonb_object_keys(coalesce(nv, ov)) loop
    if k = any(noise) then continue; end if;
    if tg_op = 'UPDATE' and (nv -> k) is not distinct from (ov -> k) then continue; end if;
    if tg_op = 'DELETE' then continue; end if;
    ch := ch || jsonb_build_object(k, case when k = any(masked) then to_jsonb('[changed]'::text)
                                          when length((nv -> k)::text) > 2000 then to_jsonb('[large value]'::text) else nv -> k end);
  end loop;
  if tg_op = 'UPDATE' and ch = '{}'::jsonb then return null; end if;   -- only housekeeping changed
  rid := case tg_table_name
    when 'members' then coalesce(nv, ov) ->> 'email'
    when 'member_invites' then coalesce(nv, ov) ->> 'email'
    when 'company_members' then (coalesce(nv, ov) ->> 'email') || ' @ ' || (coalesce(nv, ov) ->> 'company_id')
    when 'company_settings' then (coalesce(nv, ov) ->> 'company_id') || ' / ' || (coalesce(nv, ov) ->> 'module')
    when 'app_config' then coalesce(nv, ov) ->> 'key'
    else coalesce(nv, ov) ->> 'id' end;
  cid := case tg_table_name when 'companies' then coalesce(nv, ov) ->> 'id' else coalesce(nv, ov) ->> 'company_id' end;
  insert into public.ops_log (op_id, entity, record_id, company_id, action, result, actor, actor_uid, source, changes)
  values (coalesce(nullif(current_setting('fr.op_id', true), '')::uuid, gen_random_uuid()), tg_table_name, rid, cid, lower(tg_op), 'applied',
          coalesce(nullif(me, ''), 'service'), auth.uid(),
          case when me = '' then 'service' when current_setting('request.path', true) like '/rpc/%' then 'rpc' else 'direct' end, ch);
  return null;
end $$;
revoke all on function public.log_config() from public, anon, authenticated;

create trigger zz_log_config after insert or update or delete on public.companies for each row execute function public.log_config();
create trigger zz_log_config after insert or update or delete on public.members for each row execute function public.log_config();
create trigger zz_log_config after insert or update or delete on public.company_members for each row execute function public.log_config();
create trigger zz_log_config after insert or update or delete on public.company_settings for each row execute function public.log_config();
create trigger zz_log_config after insert or update or delete on public.settings for each row execute function public.log_config();
create trigger zz_log_config after insert or update or delete on public.app_config for each row execute function public.log_config();
create trigger zz_log_config after insert or update or delete on public.member_invites for each row execute function public.log_config();

-- 3. rights the API never uses -----------------------------------------------------------------------------------------
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
alter default privileges for role postgres in schema public revoke truncate, trigger, references on tables from anon, authenticated;
