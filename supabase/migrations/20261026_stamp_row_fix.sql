-- Stage 8 finding: the live stamp_row() was an earlier draft. The Stage 3 fix (a write by a background script or server
-- function that names nobody must be credited to 'service', not to whoever edited the record last) was in the repo
-- (20261026_versions_ops_log.sql) but had not reached the live database. Found by comparing the schema snapshot with the repo.
-- Tested on the restore-test copy before applying: script edit credited to 'service'; person edit credited to the person.
-- Rollback: the previous definition is in supabase/schema/schema_snapshot.sql as committed in 8a04262 (generated 09:58 UTC).
-- A write by a background script or server function that names nobody is credited to 'service'.
create or replace function public.stamp_row() returns trigger
language plpgsql set search_path = public as $$
declare me text := coalesce(nullif(public.my_email(), ''), ''); op text := nullif(current_setting('fr.op_id', true), '');
begin
  if tg_op = 'INSERT' then
    new.version := 1;
  else
    new.version := coalesce(old.version, 0) + 1;
  end if;
  new.op_id := coalesce(op::uuid, gen_random_uuid());
  new.updated_at := now();
  if me <> '' then new.updated_by := me;
  elsif tg_op = 'INSERT' then new.updated_by := coalesce(nullif(new.updated_by, ''), 'service');
  elsif new.updated_by is not distinct from old.updated_by then new.updated_by := 'service';
  end if;
  return new;
end $$;
