-- Phase 0, group shell: companies under Future Ready Nig. Ltd, a role per person per company, hiring data scoped to a company.
-- Group Admin = members.level 'editor' (unchanged). Company roles live in company_members.

create table if not exists public.companies (
  id text primary key,                       -- slug: group, events, press
  name text not null,
  short_name text not null,
  kind text not null default 'company',      -- 'group' for the parent, 'company' otherwise
  "order" int not null default 10,
  active boolean not null default true,
  modules text[] not null default array['hiring'],
  created_at timestamptz not null default now()
);
insert into public.companies (id, name, short_name, kind, "order", modules) values
  ('group',  'Future Ready Nig. Ltd',          'Group',  'group',   0, array['hiring']),
  ('events', 'Future Ready Event Management',  'Events', 'company', 1, array['hiring']),
  ('press',  'Future Ready Press',             'Press',  'company', 2, array['hiring'])
on conflict (id) do nothing;

create type public.company_role as enum ('admin', 'manager', 'staff', 'viewer');

create table if not exists public.company_members (
  email text not null,
  company_id text not null references public.companies(id) on delete cascade,
  role public.company_role not null default 'viewer',
  added_at timestamptz not null default now(),
  added_by text,
  primary key (email, company_id)
);

alter table public.members
  add column if not exists requested_company text,
  add column if not exists requested_role public.company_role;

-- Hiring data belongs to a company. Existing roles go to the group.
alter table public.roles add column if not exists company_id text references public.companies(id);
update public.roles set company_id = 'group' where company_id is null;
alter table public.roles alter column company_id set not null, alter column company_id set default 'group';
alter table public.candidates add column if not exists company_id text;
update public.candidates c set company_id = r.company_id from public.roles r where r.id = c.role and c.company_id is null;
alter table public.issues add column if not exists company_id text;
update public.issues i set company_id = c.company_id from public.candidates c where c.id = i.candidate_id and i.company_id is null;

create or replace function public.candidate_company() returns trigger
language plpgsql set search_path = public as $$
begin
  select company_id into new.company_id from public.roles where id = new.role;
  if new.company_id is null then new.company_id := 'group'; end if;
  return new;
end $$;
drop trigger if exists candidates_company on public.candidates;
create trigger candidates_company before insert or update of role on public.candidates for each row execute function public.candidate_company();

create or replace function public.issue_company() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.candidate_id is not null then select company_id into new.company_id from public.candidates where id = new.candidate_id; end if;
  if new.company_id is null then new.company_id := 'group'; end if;
  return new;
end $$;
drop trigger if exists issues_company on public.issues;
create trigger issues_company before insert or update of candidate_id on public.issues for each row execute function public.issue_company();

-- ---------- permissions ----------
create or replace function public.my_company_role(cid text) returns public.company_role
language plpgsql stable security definer set search_path = public as $$
declare e text := lower(coalesce(auth.jwt() ->> 'email', '')); r public.company_role;
begin
  if e = '' then return null; end if;
  if exists (select 1 from public.members where lower(email) = e and status = 'active' and level = 'editor') then return 'admin'; end if;
  select cm.role into r from public.company_members cm join public.members m on lower(m.email) = lower(cm.email)
   where lower(cm.email) = e and cm.company_id = cid and m.status = 'active';
  return r;
end $$;

create or replace function public.can_write_company(cid text) returns boolean
language sql stable set search_path = public as $$ select public.my_company_role(cid) in ('admin', 'manager', 'staff') $$;

create or replace function public.is_company_admin(cid text) returns boolean
language sql stable set search_path = public as $$ select public.my_company_role(cid) = 'admin' $$;

-- Everything the page needs about the signed-in person, in one call.
create or replace function public.my_access() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e text := lower(coalesce(auth.jwt() ->> 'email', '')); m public.members%rowtype; comps jsonb;
begin
  if e = '' then return null; end if;
  select * into m from public.members where lower(email) = e;
  if not found then return null; end if;
  if m.level = 'editor' and m.status = 'active' then
    select coalesce(jsonb_object_agg(id, 'admin'), '{}'::jsonb) into comps from public.companies where active;
  else
    select coalesce(jsonb_object_agg(cm.company_id, cm.role), '{}'::jsonb) into comps
      from public.company_members cm join public.companies c on c.id = cm.company_id where lower(cm.email) = e and c.active;
  end if;
  return public.my_member() || jsonb_build_object('group_admin', m.level = 'editor' and m.status = 'active', 'companies', comps);
end $$;

-- Sign-up asks for a company and a role; an Admin approves.
create or replace function public.request_access(p_requested public.member_level default 'viewer', p_name text default '', p_company text default null, p_role public.company_role default 'viewer')
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if e = '' then raise exception 'not signed in'; end if;
  if p_requested not in ('viewer', 'editor') then p_requested := 'viewer'; end if;
  if p_company is not null and not exists (select 1 from public.companies where id = p_company and active) then raise exception 'Unknown company'; end if;
  insert into public.members (email, name, level, status, requested_level, requested_company, requested_role, user_id)
  values (e, nullif(p_name, ''), 'viewer', 'pending', p_requested, p_company, p_role, auth.uid())
  on conflict (email) do nothing;
  return public.my_member();
end $$;

create or replace function public.my_member() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.members%rowtype; e text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if e = '' then return null; end if;
  select * into r from public.members where lower(email) = e;
  if not found then return null; end if;
  return jsonb_build_object('email', r.email, 'name', r.name, 'level', r.level, 'status', r.status, 'surname', r.surname,
    'first_name', r.first_name, 'other_names', r.other_names, 'phone', r.phone, 'position', r.position, 'photo_url', r.photo_url,
    'profile_done', r.profile_done, 'requested_level', r.requested_level, 'requested_company', r.requested_company, 'requested_role', r.requested_role,
    'joined_at', r.joined_at, 'added_at', r.added_at);
end $$;

-- Group Admins manage everyone; a company Admin manages people inside their company.
create or replace function public.admin_set_company_role(p_email text, p_company text, p_role public.company_role default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(p_email)); me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if not (public.is_admin() or public.is_company_admin(p_company)) then raise exception 'Only an Admin of this company can do this'; end if;
  if not exists (select 1 from public.companies where id = p_company) then raise exception 'Unknown company'; end if;
  if not exists (select 1 from public.members where lower(email) = e) then raise exception 'No such member'; end if;
  if p_role is null then
    delete from public.company_members where lower(email) = e and company_id = p_company;
  else
    insert into public.company_members (email, company_id, role, added_by) values (e, p_company, p_role, me)
    on conflict (email, company_id) do update set role = excluded.role;
  end if;
  return jsonb_build_object('email', e, 'company', p_company, 'role', p_role);
end $$;

-- Approve a pending request (group Admin anywhere; company Admin for their own company).
create or replace function public.admin_approve(p_email text, p_company text default null, p_role public.company_role default 'viewer', p_group_admin boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(p_email)); r public.members%rowtype;
begin
  select * into r from public.members where lower(email) = e;
  if not found then raise exception 'No such member'; end if;
  if p_group_admin then
    if not public.is_admin() then raise exception 'Only a Group Admin can make a Group Admin'; end if;
  elsif p_company is null then
    raise exception 'Choose a company';
  elsif not (public.is_admin() or public.is_company_admin(p_company)) then
    raise exception 'Only an Admin of this company can approve';
  end if;
  update public.members set status = 'active', level = case when p_group_admin then 'editor'::public.member_level else 'viewer'::public.member_level end,
    joined_at = coalesce(joined_at, now()), requested_level = null, requested_company = null, requested_role = null, updated_at = now()
  where lower(email) = e;
  if not p_group_admin then
    insert into public.company_members (email, company_id, role, added_by) values (e, p_company, coalesce(p_role, 'viewer'), lower(coalesce(auth.jwt() ->> 'email', '')))
    on conflict (email, company_id) do update set role = excluded.role;
  end if;
  return jsonb_build_object('email', e, 'status', 'active');
end $$;

-- Invite: group Admin → anyone, optionally as Group Admin; company Admin → into their company only.
create or replace function public.admin_invite(p_email text, p_level public.member_level default 'viewer', p_name text default '', p_company text default null, p_role public.company_role default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(p_email)); me text := lower(coalesce(auth.jwt() ->> 'email', '')); r public.members%rowtype;
begin
  if p_level = 'editor' or p_company is null then
    if not public.is_admin() then raise exception 'Only a Group Admin can do this'; end if;
  elsif not (public.is_admin() or public.is_company_admin(p_company)) then
    raise exception 'Only an Admin of this company can invite into it';
  end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That is not a valid email address'; end if;
  if p_level not in ('viewer', 'editor') then raise exception 'Role must be Group Admin or a company role'; end if;
  if p_company is not null and not exists (select 1 from public.companies where id = p_company and active) then raise exception 'Unknown company'; end if;
  select * into r from public.members where lower(email) = e;
  if found and r.status = 'active' then
    -- already a member: just add the company role (no new invitation)
    if p_company is not null then
      insert into public.company_members (email, company_id, role, added_by) values (e, p_company, coalesce(p_role, 'viewer'), me)
      on conflict (email, company_id) do update set role = excluded.role;
      return jsonb_build_object('email', e, 'status', 'active', 'added_to', p_company);
    end if;
    raise exception '% is already a member', e;
  end if;
  insert into public.members (email, name, level, status, invited_by, invited_at)
  values (e, nullif(trim(p_name), ''), p_level, 'invited', me, now())
  on conflict (email) do update set level = excluded.level, status = 'invited', invited_by = excluded.invited_by, invited_at = now(),
    requested_level = null, requested_company = null, requested_role = null, name = coalesce(excluded.name, public.members.name), updated_at = now();
  if p_company is not null then
    insert into public.company_members (email, company_id, role, added_by) values (e, p_company, coalesce(p_role, 'viewer'), me)
    on conflict (email, company_id) do update set role = excluded.role;
  end if;
  insert into public.member_invites (email, token) values (e, md5(random()::text || clock_timestamp()::text) || md5(e || random()::text))
  on conflict (email) do update set token = excluded.token, created_at = now();
  return jsonb_build_object('email', e, 'level', p_level, 'status', 'invited', 'company', p_company, 'role', p_role);
end $$;

-- Companies are managed by Group Admins.
create or replace function public.admin_save_company(p_id text, p_name text, p_short text, p_active boolean default true, p_modules text[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare id text := lower(regexp_replace(trim(p_id), '[^a-z0-9]+', '-', 'g'));
begin
  if not public.is_admin() then raise exception 'Only a Group Admin can do this'; end if;
  if id = '' or id = 'group' and p_active = false then raise exception 'Invalid company'; end if;
  insert into public.companies (id, name, short_name, "order", active, modules)
  values (id, trim(p_name), coalesce(nullif(trim(p_short), ''), trim(p_name)), (select coalesce(max("order"), 0) + 1 from public.companies), p_active, coalesce(p_modules, array['hiring']))
  on conflict (id) do update set name = excluded.name, short_name = excluded.short_name, active = excluded.active, modules = coalesce(p_modules, public.companies.modules);
  return jsonb_build_object('id', id, 'name', trim(p_name));
end $$;

revoke all on function public.my_company_role(text), public.can_write_company(text), public.is_company_admin(text), public.my_access(),
  public.request_access(public.member_level, text, text, public.company_role), public.admin_set_company_role(text, text, public.company_role),
  public.admin_approve(text, text, public.company_role, boolean), public.admin_invite(text, public.member_level, text, text, public.company_role),
  public.admin_save_company(text, text, text, boolean, text[]) from public, anon;
grant execute on function public.my_company_role(text), public.can_write_company(text), public.is_company_admin(text), public.my_access(),
  public.request_access(public.member_level, text, text, public.company_role), public.admin_set_company_role(text, text, public.company_role),
  public.admin_approve(text, text, public.company_role, boolean), public.admin_invite(text, public.member_level, text, text, public.company_role),
  public.admin_save_company(text, text, text, boolean, text[]) to authenticated;
drop function if exists public.request_access(public.member_level, text);
drop function if exists public.admin_invite(text, public.member_level, text);

-- ---------- row-level security, now per company ----------
alter table public.companies enable row level security;
alter table public.company_members enable row level security;
create policy companies_read on public.companies for select to authenticated using (public.my_level() is not null);
create policy company_members_read on public.company_members for select to authenticated using (public.my_level() is not null);

drop policy if exists roles_read on public.roles;  drop policy if exists roles_write on public.roles;
create policy roles_read on public.roles for select to authenticated using (public.my_company_role(company_id) is not null);
create policy roles_write on public.roles for all to authenticated using (public.can_write_company(company_id)) with check (public.can_write_company(company_id));

drop policy if exists candidates_read on public.candidates;  drop policy if exists candidates_write on public.candidates;
create policy candidates_read on public.candidates for select to authenticated using (public.my_company_role(company_id) is not null);
create policy candidates_write on public.candidates for all to authenticated using (public.can_write_company(company_id)) with check (public.can_write_company(coalesce(company_id, (select company_id from public.roles where id = role))));

drop policy if exists issues_read on public.issues;  drop policy if exists issues_write on public.issues;
create policy issues_read on public.issues for select to authenticated using (public.my_company_role(company_id) is not null);
create policy issues_write on public.issues for all to authenticated using (public.can_write_company(company_id)) with check (public.can_write_company(coalesce(company_id, (select company_id from public.candidates where id = candidate_id))));

alter publication supabase_realtime add table public.companies, public.company_members;

-- Companies list for people who are not members yet (the sign-up form).
create or replace function public.public_companies() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'short_name', short_name, 'active', active) order by "order"), '[]'::jsonb)
  from public.companies where active
$$;
revoke all on function public.public_companies() from public, anon;
grant execute on function public.public_companies() to authenticated;
