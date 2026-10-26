-- Stage 9 (backend completion): the status panel shows everyone signed in (not customers) when the last good backup finished.
-- Only the time is returned; file names, sizes and errors stay with Group Admins (sync_runs is Group Admin only).
create or replace function public.backup_last_success() returns timestamptz
language sql stable security definer set search_path = public as $$
  select max(finished_at) from public.sync_runs
   where status = 'success' and kind in ('rolling', 'nightly', 'monthly', 'manual') and public.my_level() is not null;
$$;
revoke all on function public.backup_last_success() from public, anon;
grant execute on function public.backup_last_success() to authenticated;
