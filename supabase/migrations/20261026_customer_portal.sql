-- Customer portal: each company gets a public link (/press/, later /events/) where customers read about the company,
-- create an account, send a job request with files, and follow it. Staff see the requests in the app and turn them into quotes.
-- Customers are ordinary auth users with a portal_profiles row; they are not members and never see the staff app's data.

-- Public description of a company shown on its portal page; edited by the company's Admins in the app (company_settings, module 'portal').
create or replace function public.portal_public(p_company text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'short_name', c.short_name, 'kind', c.kind, 'active', c.active,
    'settings', coalesce((select s.data from public.company_settings s where s.company_id = c.id and s.module = 'portal'), '{}'::jsonb),
    'services', coalesce((select jsonb_agg(jsonb_build_object('name', r.name, 'category', r.category, 'unit', r.unit) order by r.category, r.name)
                          from public.press_rate_items r where r.company_id = c.id and r.active), '[]'::jsonb))
  from public.companies c where c.id = p_company and c.active;
$$;
grant execute on function public.portal_public(text) to anon, authenticated;

create table if not exists public.portal_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  phone text not null default '',
  business text not null default '',
  email text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.portal_profiles enable row level security;
create policy portal_profiles_own on public.portal_profiles for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create type public.request_status as enum ('new', 'quoted', 'in_progress', 'done', 'declined');

create table if not exists public.customer_requests (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references public.companies(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  ref text not null,                                        -- R-0001 per company
  service text not null default '',
  title text not null,
  details text not null default '',
  quantity text not null default '',
  needed_by date,
  contact_name text not null default '', contact_phone text not null default '', contact_email text not null default '',
  status public.request_status not null default 'new',
  staff_note text not null default '',
  job_id uuid references public.press_jobs(id) on delete set null,
  customer_id uuid references public.press_customers(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), updated_by text,
  unique (company_id, ref)
);
create index customer_requests_company_status on public.customer_requests(company_id, status);
create index customer_requests_user on public.customer_requests(user_id);

create table if not exists public.customer_request_files (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.customer_requests(id) on delete cascade,
  company_id text not null references public.companies(id),
  name text not null, file_path text not null, size_bytes int, mime text,
  uploaded_by uuid, created_at timestamptz not null default now()
);
create index customer_request_files_req on public.customer_request_files(request_id);

create table if not exists public.customer_request_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.customer_requests(id) on delete cascade,
  company_id text not null references public.companies(id),
  author text not null check (author in ('customer', 'staff')),
  author_name text not null default '',
  body text not null,
  created_at timestamptz not null default now()
);
create index customer_request_messages_req on public.customer_request_messages(request_id, created_at);

alter table public.customer_requests enable row level security;
alter table public.customer_request_files enable row level security;
alter table public.customer_request_messages enable row level security;

create policy portal_profiles_staff_read on public.portal_profiles for select to authenticated
  using (exists (select 1 from public.customer_requests r where r.user_id = portal_profiles.user_id and public.my_company_role(r.company_id) is not null));
-- customers: their own requests, files and messages
create policy cr_customer_read on public.customer_requests for select to authenticated using (user_id = auth.uid());
create policy crf_customer_read on public.customer_request_files for select to authenticated
  using (exists (select 1 from public.customer_requests r where r.id = request_id and r.user_id = auth.uid()));
create policy crf_customer_insert on public.customer_request_files for insert to authenticated
  with check (uploaded_by = auth.uid() and exists (select 1 from public.customer_requests r where r.id = request_id and r.user_id = auth.uid() and r.company_id = company_id));
create policy crm_customer_read on public.customer_request_messages for select to authenticated
  using (exists (select 1 from public.customer_requests r where r.id = request_id and r.user_id = auth.uid()));
create policy crm_customer_insert on public.customer_request_messages for insert to authenticated
  with check (author = 'customer' and exists (select 1 from public.customer_requests r where r.id = request_id and r.user_id = auth.uid() and r.company_id = company_id));
-- staff: everything for their company
create policy cr_staff_read on public.customer_requests for select to authenticated using (public.my_company_role(company_id) is not null);
create policy cr_staff_write on public.customer_requests for update to authenticated using (public.can_write_company(company_id)) with check (public.can_write_company(company_id));
create policy crf_staff_read on public.customer_request_files for select to authenticated using (public.my_company_role(company_id) is not null);
create policy crm_staff_read on public.customer_request_messages for select to authenticated using (public.my_company_role(company_id) is not null);
create policy crm_staff_insert on public.customer_request_messages for insert to authenticated
  with check (author = 'staff' and public.can_write_company(company_id));

-- A customer sends a request: profile is saved, the reference number is taken from the company counter (kind 'R').
create or replace function public.portal_submit_request(p_company text, p_service text, p_title text, p_details text, p_quantity text, p_needed_by date,
                                                         p_name text, p_phone text, p_business text) returns public.customer_requests
language plpgsql security definer set search_path = public as $$
declare v int; r public.customer_requests; e text := lower(coalesce((select email from auth.users where id = auth.uid()), ''));
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if e = '' or not exists (select 1 from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null) then raise exception 'Confirm your email first'; end if;
  if not exists (select 1 from public.companies c where c.id = p_company and c.active) then raise exception 'Unknown company'; end if;
  if length(trim(coalesce(p_title, ''))) < 3 then raise exception 'Say what you need in the title'; end if;
  if (select count(*) from public.customer_requests where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 10 then raise exception 'Too many requests in one hour; try again later'; end if;
  insert into public.portal_profiles (user_id, name, phone, business, email) values (auth.uid(), trim(coalesce(p_name, '')), trim(coalesce(p_phone, '')), trim(coalesce(p_business, '')), e)
  on conflict (user_id) do update set name = excluded.name, phone = excluded.phone, business = excluded.business, email = excluded.email, updated_at = now();
  insert into public.counters (company_id, kind, value) values (p_company, 'R', 1)
  on conflict (company_id, kind) do update set value = public.counters.value + 1 returning value into v;
  insert into public.customer_requests (company_id, user_id, ref, service, title, details, quantity, needed_by, contact_name, contact_phone, contact_email)
  values (p_company, auth.uid(), 'R-' || lpad(v::text, 4, '0'), left(coalesce(p_service, ''), 120), left(trim(p_title), 200), left(coalesce(p_details, ''), 5000), left(coalesce(p_quantity, ''), 120), p_needed_by,
          left(trim(coalesce(p_name, '')), 120), left(trim(coalesce(p_phone, '')), 40), e)
  returning * into r;
  return r;
end $$;
revoke all on function public.portal_submit_request(text, text, text, text, text, date, text, text, text) from public, anon;
grant execute on function public.portal_submit_request(text, text, text, text, text, date, text, text, text) to authenticated;

-- Staff turn a request into a quote: customer record matched by email or created, job created at the quote stage, request linked.
create or replace function public.request_to_quote(p_request uuid) returns public.press_jobs
language plpgsql security definer set search_path = public as $$
declare r public.customer_requests; c public.press_customers; j public.press_jobs; n int; cfg jsonb; prefix text; me text := public.my_email();
begin
  select * into r from public.customer_requests where id = p_request;
  if r.id is null then raise exception 'Request not found'; end if;
  if not public.can_write_company(r.company_id) then raise exception 'No write access to this company'; end if;
  if r.job_id is not null then select * into j from public.press_jobs where id = r.job_id; return j; end if;
  select * into c from public.press_customers where company_id = r.company_id and r.contact_email <> '' and lower(email) = r.contact_email limit 1;
  if c.id is null then
    insert into public.press_customers (company_id, name, phone, email, notes, created_by, updated_by)
    values (r.company_id, coalesce(nullif(r.contact_name, ''), r.contact_email), r.contact_phone, r.contact_email, 'From the customer portal', me, me) returning * into c;
  end if;
  select data into cfg from public.company_settings where company_id = r.company_id and module = 'press';
  prefix := coalesce(cfg ->> 'prefix', 'FRP');
  insert into public.counters (company_id, kind, value) values (r.company_id, 'Q', 1)
  on conflict (company_id, kind) do update set value = public.counters.value + 1 returning value into n;
  insert into public.press_jobs (company_id, number, customer_id, customer_name, title, description, stage, notes, specs, history, created_by, updated_by)
  values (r.company_id, prefix || '-Q-' || lpad(n::text, 4, '0'), c.id, c.name, r.title,
          r.details || case when r.quantity <> '' then E'\nQuantity: ' || r.quantity else '' end || case when r.needed_by is not null then E'\nNeeded by: ' || r.needed_by::text else '' end,
          'quote', 'Customer request ' || r.ref || case when r.service <> '' then ' · ' || r.service else '' end,
          jsonb_build_object('service', r.service, 'quantity', r.quantity, 'needed_by', r.needed_by, 'request_ref', r.ref),
          jsonb_build_array(jsonb_build_object('at', now(), 'by', me, 'what', 'Created from customer request ' || r.ref)), me, me)
  returning * into j;
  update public.customer_requests set job_id = j.id, customer_id = c.id, status = 'quoted', updated_at = now(), updated_by = me where id = r.id;
  return j;
end $$;
revoke all on function public.request_to_quote(uuid) from public, anon;
grant execute on function public.request_to_quote(uuid) to authenticated;

-- customer uploads live in their own bucket; staff of the company can read them
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('customer-files', 'customer-files', false, 26214400, array['image/png','image/jpeg','image/webp','image/svg+xml','application/pdf','application/postscript','application/zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel','text/plain'])
on conflict (id) do nothing;
-- path: <company>/<user id>/<request id>/<file>
create policy "customer files own read" on storage.objects for select to authenticated using (bucket_id = 'customer-files' and (storage.foldername(name))[2] = auth.uid()::text);
create policy "customer files own write" on storage.objects for insert to authenticated with check (bucket_id = 'customer-files' and (storage.foldername(name))[2] = auth.uid()::text);
create policy "customer files staff read" on storage.objects for select to authenticated using (bucket_id = 'customer-files' and public.my_company_role((storage.foldername(name))[1]) is not null);

alter publication supabase_realtime add table public.customer_requests, public.customer_request_messages;

-- Portal page defaults for Press (Admins edit these in the app)
insert into public.company_settings (company_id, module, data) values ('press', 'portal', jsonb_build_object(
  'tagline', 'Printing that makes your business look serious.',
  'about', 'Future Ready Press is the printing arm of Future Ready Nig. Ltd in Enugu. We print business cards, flyers, banners, programmes, invitations, souvenirs and packaging, with design help when you need it and fast turnaround on urgent jobs.',
  'phone', '', 'whatsapp', '', 'email', '', 'address', 'Udeorji Street, Obiagu, Enugu',
  'hours', 'Monday to Saturday, 8am to 6pm',
  'steps', jsonb_build_array('Tell us what you need and attach your artwork or reference.', 'We send a quote, usually the same day.', 'Approve the quote and pay the deposit.', 'We print, finish and tell you when it is ready.')
)) on conflict (company_id, module) do nothing;
