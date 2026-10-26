-- Stage 9 (backend completion) bug fix, HIGH (data integrity), found by the workflow tests of 26 Oct 2026:
-- press_apply_move() ran with the caller's rights. Staff may record stock movements (policy press_moves_insert:
-- can_write_company) but may not change materials (press_materials write: can_manage_company), so for a Staff member the
-- movement was saved while the material quantity silently stayed the same. Managers were not affected.
-- Fix: the trigger runs as the table owner, so the quantity always follows the movement; who may record a movement is still
-- decided by the insert policy, and the same-company trigger guarantees the material belongs to the movement's company.
-- If the material row is missing the movement is refused instead of saved alone.
-- Live had no stock movements when this was found, so no stored quantity was wrong.
-- Rollback: recreate the function without "security definer" and without the row check (snapshot at commit 8a530e6).
create or replace function public.press_apply_move() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.press_materials set quantity = quantity + new.delta, updated_at = now(), updated_by = coalesce(new.moved_by, public.my_email())
   where id = new.material_id and company_id = new.company_id and deleted_at is null;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'This material is not available in this company'; end if;
  return new;
end $$;
revoke all on function public.press_apply_move() from public, anon, authenticated;
