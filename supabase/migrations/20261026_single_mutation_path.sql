-- Stage 9 (backend completion): one documented mutation strategy. The browser no longer writes tables directly.
--   Records (rows with an id, version and op_id)  -> apply_op (checked save path: idempotent, versioned, conflict-aware)
--   Workflow and settings actions                  -> named functions (this file adds the last four)
--   Files                                          -> Storage upload, then the record through apply_op or a named function
-- Before this, four places wrote tables directly: Press letterhead settings, app-wide Hiring settings, portal file records and
-- the customer-name copy on jobs. Each now has a single server-side path. All run as the caller, so row-level security still
-- decides who may do it; group/settings changes are logged by log_config, records by log_op.
-- Rollback: drop the four functions and the trigger; the previous browser code still works against the tables (the policies
-- are unchanged).

-- 1. Company settings (letterhead, bank, prefixes, portal text). Company Admins only (policy company_settings_write).
create or replace function public.save_company_settings(p_company text, p_module text, p_data jsonb)
returns public.company_settings language plpgsql security invoker set search_path = public as $$
declare r public.company_settings;
begin
  if coalesce(public.my_email(), '') = '' then raise exception 'Sign in first'; end if;
  if p_module not in ('press', 'portal') then raise exception 'Unknown settings area'; end if;
  if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Settings must be an object'; end if;
  insert into public.company_settings as s (company_id, module, data, updated_by, updated_at)
  values (p_company, p_module, p_data, public.my_email(), now())
  on conflict (company_id, module) do update set data = excluded.data, updated_by = excluded.updated_by, updated_at = excluded.updated_at
  returning * into r;
  return r;
exception when insufficient_privilege then raise exception 'You do not have permission to change these settings' using errcode = '42501';
end $$;
revoke all on function public.save_company_settings(text, text, jsonb) from public, anon;
grant execute on function public.save_company_settings(text, text, jsonb) to authenticated;

-- 2. App-wide Hiring settings (scoring weights, outreach and interview email text). Group Admins only (policy settings_write).
create or replace function public.save_app_settings(p_id text, p_data jsonb)
returns public.settings language plpgsql security invoker set search_path = public as $$
declare r public.settings;
begin
  if coalesce(public.my_email(), '') = '' then raise exception 'Sign in first'; end if;
  if p_id not in ('scoring', 'outreach', 'interviewEmail') then raise exception 'Unknown setting'; end if;
  if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Settings must be an object'; end if;
  insert into public.settings as s (id, data) values (p_id, p_data)
  on conflict (id) do update set data = excluded.data
  returning * into r;
  return r;
exception when insufficient_privilege then raise exception 'Only a Group Admin can change hiring settings' using errcode = '42501';
end $$;
revoke all on function public.save_app_settings(text, jsonb) from public, anon;
grant execute on function public.save_app_settings(text, jsonb) to authenticated;

-- 3. Portal file record after the customer uploaded the file. Idempotent: the same path twice is one record.
create unique index if not exists customer_request_files_path_key on public.customer_request_files (file_path);
create or replace function public.portal_attach_file(p_request uuid, p_name text, p_path text, p_size bigint, p_mime text)
returns public.customer_request_files language plpgsql security invoker set search_path = public as $$
declare r public.customer_request_files; co text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select company_id into co from public.customer_requests where id = p_request and user_id = auth.uid();
  if co is null then raise exception 'Request not found'; end if;
  if split_part(p_path, '/', 2) <> auth.uid()::text or split_part(p_path, '/', 3) <> p_request::text then raise exception 'File path does not belong to this request'; end if;
  insert into public.customer_request_files (request_id, company_id, name, file_path, size_bytes, mime, uploaded_by)
  values (p_request, co, left(coalesce(p_name, 'file'), 200), p_path, p_size, left(coalesce(p_mime, ''), 120), auth.uid())
  on conflict (file_path) do nothing returning * into r;
  if r.id is null then select * into r from public.customer_request_files where file_path = p_path; end if;
  return r;
end $$;
revoke all on function public.portal_attach_file(uuid, text, text, bigint, text) from public, anon;
grant execute on function public.portal_attach_file(uuid, text, text, bigint, text) to authenticated;

-- 4. Jobs keep a copy of the customer's name for display and PDFs; the database now keeps it in step when a customer is renamed.
create or replace function public.sync_job_customer_name() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.name is distinct from old.name then
    update public.press_jobs set customer_name = new.name where customer_id = new.id and customer_name is distinct from new.name;
  end if;
  return null;
end $$;
revoke all on function public.sync_job_customer_name() from public, anon, authenticated;
create trigger sync_job_customer_name after update of name on public.press_customers for each row execute function public.sync_job_customer_name();
