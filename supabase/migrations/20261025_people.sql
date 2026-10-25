-- Phase 1, People: staff directory, documents, leave. Everything belongs to a company; access follows company roles.

create or replace function public.can_manage_company(cid text) returns boolean
language sql stable set search_path = public as $$ select public.my_company_role(cid) in ('admin', 'manager') $$;

create type public.staff_status as enum ('active', 'left');
create type public.employment_type as enum ('full_time', 'part_time', 'contract', 'intern', 'volunteer');
create type public.leave_kind as enum ('annual', 'sick', 'casual', 'maternity', 'paternity', 'unpaid', 'other');
create type public.leave_status as enum ('pending', 'approved', 'declined', 'cancelled');

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references public.companies(id),
  companies text[] not null default '{}',                      -- other companies this person also works for
  member_email text,                                           -- links to members.email when they have a login
  surname text not null default '',
  first_name text not null default '',
  other_names text not null default '',
  full_name text not null default '',                          -- kept by touch_row()
  phone text not null default '',
  email text not null default '',
  position text not null default '',
  department text not null default '',
  employment_type public.employment_type not null default 'full_time',
  start_date date,
  end_date date,
  status public.staff_status not null default 'active',
  photo_url text not null default '',
  address text not null default '',
  date_of_birth date,
  emergency_name text not null default '',
  emergency_phone text not null default '',
  notes text not null default '',
  candidate_id text,                                           -- hiring record this person came from
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  created_by text,
  updated_at timestamptz not null default now(),
  updated_by text
);
create index staff_company on public.staff(company_id);
create index staff_member on public.staff(lower(member_email));

create table public.staff_documents (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  company_id text not null references public.companies(id),
  kind text not null default 'other',                          -- id, contract, certificate, offer, other
  title text not null,
  file_path text not null,                                     -- storage: staff-docs/<company_id>/<staff_id>/<file>
  size_bytes int,
  mime text,
  note text not null default '',
  uploaded_by text,
  uploaded_at timestamptz not null default now()
);
create index staff_documents_staff on public.staff_documents(staff_id);

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  company_id text not null references public.companies(id),
  kind public.leave_kind not null default 'annual',
  start_date date not null,
  end_date date not null,
  days int generated always as ((end_date - start_date) + 1) stored,
  reason text not null default '',
  status public.leave_status not null default 'pending',
  requested_by text,
  decided_by text,
  decided_at timestamptz,
  decision_note text not null default '',
  created_at timestamptz not null default now(),
  constraint leave_dates check (end_date >= start_date)
);
create index leave_requests_company on public.leave_requests(company_id, status);

-- stamp who/when on changes
create or replace function public.touch_row() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now(); new.updated_by := lower(coalesce(auth.jwt() ->> 'email', new.updated_by));
  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, lower(coalesce(auth.jwt() ->> 'email', ''))); end if;
  if tg_table_name = 'staff' then new.full_name := trim(concat_ws(' ', nullif(new.first_name, ''), nullif(new.other_names, ''), nullif(new.surname, ''))); end if;
  return new;
end $$;
create trigger staff_touch before insert or update on public.staff for each row execute function public.touch_row();

-- visibility: anyone with a role in the home company or any extra company; writes: admin/manager of the home company
alter table public.staff enable row level security;
create policy staff_read on public.staff for select to authenticated
  using (public.my_company_role(company_id) is not null or exists (select 1 from unnest(companies) c where public.my_company_role(c) is not null));
create policy staff_write on public.staff for all to authenticated
  using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

alter table public.staff_documents enable row level security;
create policy staff_documents_read on public.staff_documents for select to authenticated using (public.my_company_role(company_id) is not null);
create policy staff_documents_write on public.staff_documents for all to authenticated
  using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

alter table public.leave_requests enable row level security;
create policy leave_read on public.leave_requests for select to authenticated using (public.my_company_role(company_id) is not null);
-- a person may file a request for their own staff record; managers for anyone in the company
create policy leave_insert on public.leave_requests for insert to authenticated
  with check (public.can_manage_company(company_id) or exists (select 1 from public.staff s where s.id = staff_id and lower(s.member_email) = lower(coalesce(auth.jwt() ->> 'email', ''))));
-- decisions go through leave_decide(); the requester may only cancel their own pending request
create policy leave_cancel_own on public.leave_requests for update to authenticated
  using (status = 'pending' and lower(requested_by) = lower(coalesce(auth.jwt() ->> 'email', '')))
  with check (status = 'cancelled');

create or replace function public.leave_decide(p_id uuid, p_status public.leave_status, p_note text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.leave_requests%rowtype; me text := lower(coalesce(auth.jwt() ->> 'email', '')); own boolean;
begin
  select * into r from public.leave_requests where id = p_id;
  if not found then raise exception 'No such request'; end if;
  if p_status not in ('approved', 'declined') then raise exception 'Decision must be approved or declined'; end if;
  if not public.can_manage_company(r.company_id) then raise exception 'Only an Admin or Manager of this company can decide'; end if;
  select lower(s.member_email) = me into own from public.staff s where s.id = r.staff_id;
  if coalesce(own, false) and not public.is_admin() then raise exception 'You cannot decide your own leave request'; end if;
  update public.leave_requests set status = p_status, decided_by = me, decided_at = now(), decision_note = left(coalesce(p_note, ''), 500) where id = p_id;
  return jsonb_build_object('id', p_id, 'status', p_status);
end $$;
revoke all on function public.leave_decide(uuid, public.leave_status, text), public.can_manage_company(text) from public, anon;
grant execute on function public.leave_decide(uuid, public.leave_status, text), public.can_manage_company(text) to authenticated;

-- private documents bucket; path = <company_id>/<staff_id>/<filename>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('staff-docs', 'staff-docs', false, 10485760, array['application/pdf','image/jpeg','image/png','image/webp','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;
create policy "staff docs read by company" on storage.objects for select to authenticated
  using (bucket_id = 'staff-docs' and public.my_company_role((storage.foldername(name))[1]) is not null);
create policy "staff docs write by managers" on storage.objects for insert to authenticated
  with check (bucket_id = 'staff-docs' and public.can_manage_company((storage.foldername(name))[1]));
create policy "staff docs delete by managers" on storage.objects for delete to authenticated
  using (bucket_id = 'staff-docs' and public.can_manage_company((storage.foldername(name))[1]));

alter publication supabase_realtime add table public.staff, public.staff_documents, public.leave_requests;

update public.companies set modules = array['hiring', 'people'] where 'people' <> all(modules);

-- staff photos live in the public avatars bucket under staff/<company_id>/<staff_id>.jpg; managers of that company write them
create policy "staff photos by managers insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = 'staff' and public.can_manage_company((storage.foldername(name))[2]));
create policy "staff photos by managers update" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = 'staff' and public.can_manage_company((storage.foldername(name))[2]));
create policy "staff photos by managers delete" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = 'staff' and public.can_manage_company((storage.foldername(name))[2]));
