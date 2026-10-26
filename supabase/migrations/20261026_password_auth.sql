-- Email + password sign-in alongside Google.
-- A password account exists before its address is confirmed, so every function that identifies the caller by email now
-- goes through my_email(), which returns '' until auth.users.email_confirmed_at is set (Google sign-ins are confirmed at once).
-- Applied on 2026-10-26 with a DO block that rewrote every public function containing auth.jwt() ->> 'email' (see README);
-- this file records the helper and the two policies that were rewritten by hand.
create or replace function public.my_email() returns text
language sql stable security definer set search_path = public, auth as $f$
  select coalesce((select lower(u.email) from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null), '')
$f$;
revoke all on function public.my_email() from public, anon;
grant execute on function public.my_email() to authenticated;

-- In every function below, lower(coalesce(auth.jwt() ->> 'email', '')) became public.my_email():
-- accept_invite, admin_approve, admin_invite, admin_set_company_role, leave_decide, my_access, my_company_role, my_level,
-- my_member, request_access, touch_row, update_my_profile.

drop policy if exists leave_insert on public.leave_requests;
create policy leave_insert on public.leave_requests for insert to authenticated
  with check (public.can_manage_company(company_id) or exists (select 1 from public.staff s where s.id = staff_id and lower(s.member_email) = public.my_email()));
drop policy if exists leave_cancel_own on public.leave_requests;
create policy leave_cancel_own on public.leave_requests for update to authenticated
  using (status = 'pending' and lower(requested_by) = public.my_email()) with check (status = 'cancelled');

-- Hiring is a group-level function (CEO, Directors, General Supervisor = Group Admins). Only they can read or change hiring data,
-- whichever company a role belongs to. The shell hides the Hiring module from everyone else.
drop policy if exists roles_read on public.roles; drop policy if exists roles_write on public.roles;
create policy roles_read on public.roles for select to authenticated using (public.is_admin());
create policy roles_write on public.roles for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists candidates_read on public.candidates; drop policy if exists candidates_write on public.candidates;
create policy candidates_read on public.candidates for select to authenticated using (public.is_admin());
create policy candidates_write on public.candidates for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists issues_read on public.issues; drop policy if exists issues_write on public.issues;
create policy issues_read on public.issues for select to authenticated using (public.is_admin());
create policy issues_write on public.issues for all to authenticated using (public.is_admin()) with check (public.is_admin());
