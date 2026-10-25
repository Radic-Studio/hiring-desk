-- Team accounts: self-service sign-up (pending until approved), invitations, profiles, Admin/Employee roles.
-- Role mapping in the app: Admin = member_level 'editor', Employee = member_level 'viewer'. 'contributor' stays in the enum but is not offered.

create type public.member_status as enum ('invited', 'pending', 'active', 'disabled');

alter table public.members
  add column if not exists status public.member_status not null default 'active',
  add column if not exists surname text not null default '',
  add column if not exists first_name text not null default '',
  add column if not exists other_names text not null default '',
  add column if not exists phone text not null default '',
  add column if not exists position text not null default '',
  add column if not exists photo_url text not null default '',
  add column if not exists profile_done boolean not null default false,
  add column if not exists requested_level public.member_level,
  add column if not exists invited_by text,
  add column if not exists invited_at timestamptz,
  add column if not exists invite_sent_at timestamptz,
  add column if not exists joined_at timestamptz,
  add column if not exists last_seen_at timestamptz,
  add column if not exists user_id uuid,
  add column if not exists updated_at timestamptz not null default now();

update public.members set joined_at = coalesce(joined_at, added_at) where status = 'active';

-- Invitation links live in their own table that only the service role can read (never exposed through the API or realtime).
create table if not exists public.member_invites (email text primary key, token text not null, created_at timestamptz not null default now());
alter table public.member_invites enable row level security;
revoke all on public.member_invites from anon, authenticated;

-- Only active members have a level; invited, pending and disabled accounts see nothing.
create or replace function public.my_level() returns public.member_level
language sql stable security definer set search_path = public as $$
  select level from public.members
  where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) and status = 'active'
$$;

create or replace function public.is_admin() returns boolean
language sql stable set search_path = public as $$ select public.my_level() = 'editor' $$;

-- Own row, whatever its status (used by the page right after sign-in).
create or replace function public.my_member() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.members%rowtype; e text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if e = '' then return null; end if;
  select * into r from public.members where lower(email) = e;
  if not found then return null; end if;
  return jsonb_build_object('email', r.email, 'name', r.name, 'level', r.level, 'status', r.status, 'surname', r.surname,
    'first_name', r.first_name, 'other_names', r.other_names, 'phone', r.phone, 'position', r.position, 'photo_url', r.photo_url,
    'profile_done', r.profile_done, 'requested_level', r.requested_level, 'joined_at', r.joined_at, 'added_at', r.added_at);
end $$;

-- Sign-up: an uninvited Google account asks for access. Creates a pending row (or returns the existing one).
create or replace function public.request_access(p_requested public.member_level default 'viewer', p_name text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if e = '' then raise exception 'not signed in'; end if;
  if p_requested not in ('viewer', 'editor') then p_requested := 'viewer'; end if;
  insert into public.members (email, name, level, status, requested_level, user_id)
  values (e, nullif(p_name, ''), 'viewer', 'pending', p_requested, auth.uid())
  on conflict (email) do nothing;
  return public.my_member();
end $$;

-- Invitation: an invited email signs in with Google; the row becomes active. Also stamps user_id and last_seen_at for active members.
create or replace function public.accept_invite() returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if e = '' then raise exception 'not signed in'; end if;
  update public.members set status = 'active', joined_at = coalesce(joined_at, now()), user_id = auth.uid(), updated_at = now()
  where lower(email) = e and status = 'invited';
  delete from public.member_invites where lower(email) = e;
  update public.members set last_seen_at = now(), user_id = coalesce(user_id, auth.uid()) where lower(email) = e and status = 'active';
  return public.my_member();
end $$;

-- Own profile (any status except disabled).
create or replace function public.update_my_profile(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := lower(coalesce(auth.jwt() ->> 'email', '')); fullname text;
begin
  if e = '' then raise exception 'not signed in'; end if;
  fullname := trim(concat_ws(' ', nullif(trim(p->>'first_name'), ''), nullif(trim(p->>'other_names'), ''), nullif(trim(p->>'surname'), '')));
  update public.members set
    surname = left(coalesce(p->>'surname', surname), 80), first_name = left(coalesce(p->>'first_name', first_name), 80),
    other_names = left(coalesce(p->>'other_names', other_names), 120), phone = left(coalesce(p->>'phone', phone), 40),
    position = left(coalesce(p->>'position', position), 80), photo_url = left(coalesce(p->>'photo_url', photo_url), 500),
    name = coalesce(nullif(fullname, ''), name), profile_done = true, updated_at = now()
  where lower(email) = e and status <> 'disabled';
  return public.my_member();
end $$;

-- Admin actions. Guards: never leave the desk without an active Admin; an Admin cannot remove or demote themself if they are the last one.
create or replace function public.admin_count() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.members where level = 'editor' and status = 'active'
$$;

create or replace function public.admin_set_member(p_email text, p_level public.member_level default null, p_status public.member_status default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.members%rowtype; e text := lower(trim(p_email));
begin
  if not public.is_admin() then raise exception 'Only an Admin can do this'; end if;
  select * into r from public.members where lower(email) = e;
  if not found then raise exception 'No such member'; end if;
  if p_level is not null and p_level not in ('viewer', 'editor') then raise exception 'Role must be Admin or Employee'; end if;
  if r.level = 'editor' and r.status = 'active' and public.admin_count() <= 1
     and ((p_level is not null and p_level <> 'editor') or (p_status is not null and p_status <> 'active')) then
    raise exception 'This is the last Admin. Make someone else an Admin first.';
  end if;
  update public.members set
    level = coalesce(p_level, level),
    status = coalesce(p_status, status),
    joined_at = case when coalesce(p_status, status) = 'active' then coalesce(joined_at, now()) else joined_at end,
    requested_level = case when coalesce(p_status, status) = 'active' then null else requested_level end,
    updated_at = now()
  where lower(email) = e;
  select * into r from public.members where lower(email) = e;
  return jsonb_build_object('email', r.email, 'level', r.level, 'status', r.status);
end $$;

create or replace function public.admin_remove_member(p_email text) returns boolean
language plpgsql security definer set search_path = public as $$
declare r public.members%rowtype; e text := lower(trim(p_email));
begin
  if not public.is_admin() then raise exception 'Only an Admin can do this'; end if;
  select * into r from public.members where lower(email) = e;
  if not found then return false; end if;
  if r.level = 'editor' and r.status = 'active' and public.admin_count() <= 1 then
    raise exception 'This is the last Admin. Make someone else an Admin first.';
  end if;
  delete from public.members where lower(email) = e;
  return true;
end $$;

-- Invitations are created by the invite-member edge function (service role). Admins can also pre-register directly:
create or replace function public.admin_invite(p_email text, p_level public.member_level default 'viewer', p_name text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(p_email)); me text := lower(coalesce(auth.jwt() ->> 'email', '')); r public.members%rowtype;
begin
  if not public.is_admin() then raise exception 'Only an Admin can do this'; end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That is not a valid email address'; end if;
  if p_level not in ('viewer', 'editor') then raise exception 'Role must be Admin or Employee'; end if;
  select * into r from public.members where lower(email) = e;
  if found and r.status = 'active' then raise exception '% is already a member', e; end if;
  insert into public.members (email, name, level, status, invited_by, invited_at)
  values (e, nullif(trim(p_name), ''), p_level, 'invited', me, now())
  on conflict (email) do update set level = excluded.level, status = 'invited', invited_by = excluded.invited_by, invited_at = now(),
    requested_level = null, name = coalesce(excluded.name, public.members.name), updated_at = now();
  insert into public.member_invites (email, token) values (e, md5(random()::text || clock_timestamp()::text) || md5(e || random()::text))
  on conflict (email) do update set token = excluded.token, created_at = now();
  return jsonb_build_object('email', e, 'level', p_level, 'status', 'invited');
end $$;

revoke all on function public.my_member(), public.request_access(public.member_level, text), public.accept_invite(), public.update_my_profile(jsonb),
  public.admin_count(), public.admin_set_member(text, public.member_level, public.member_status), public.admin_remove_member(text),
  public.admin_invite(text, public.member_level, text), public.is_admin() from public, anon;
grant execute on function public.my_member(), public.request_access(public.member_level, text), public.accept_invite(), public.update_my_profile(jsonb),
  public.admin_count(), public.admin_set_member(text, public.member_level, public.member_status), public.admin_remove_member(text),
  public.admin_invite(text, public.member_level, text), public.is_admin() to authenticated;

-- Direct table writes go away; every change goes through the functions above (which enforce the last-Admin guard).
drop policy if exists members_write on public.members;
drop policy if exists members_read on public.members;
create policy members_read on public.members for select to authenticated using (public.my_level() is not null);

-- Realtime for the Team page.
alter publication supabase_realtime add table public.members;

-- Profile photos: public bucket, each user writes only inside their own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
create policy "avatars are public" on storage.objects for select using (bucket_id = 'avatars');
create policy "own avatar insert" on storage.objects for insert to authenticated with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own avatar update" on storage.objects for update to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own avatar delete" on storage.objects for delete to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- The site address, used by the invitation email.
insert into public.app_config (key, value) values ('site_url', 'https://future-ready-hiring-desk.netlify.app') on conflict (key) do update set value = excluded.value;
