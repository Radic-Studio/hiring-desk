-- Rollback for Stage 2: restores the 13 tables' row-level security policies exactly as they were before Stage 2 (2026-10-26).
-- Run after dropping the Stage 2 restrictive policies (see 20261026_soft_deletes.sql header).
drop policy if exists candidates_read on public.candidates;
create policy candidates_read on public.candidates as permissive for select to authenticated using (is_admin());
drop policy if exists candidates_write on public.candidates;
create policy candidates_write on public.candidates as permissive for all to authenticated using (is_admin()) with check (is_admin());
drop policy if exists cr_customer_read on public.customer_requests;
create policy cr_customer_read on public.customer_requests as permissive for select to authenticated using ((user_id = auth.uid()));
drop policy if exists cr_staff_read on public.customer_requests;
create policy cr_staff_read on public.customer_requests as permissive for select to authenticated using ((my_company_role(company_id) IS NOT NULL));
drop policy if exists cr_staff_write on public.customer_requests;
create policy cr_staff_write on public.customer_requests as permissive for update to authenticated using (can_write_company(company_id)) with check (can_write_company(company_id));
drop policy if exists issues_read on public.issues;
create policy issues_read on public.issues as permissive for select to authenticated using (is_admin());
drop policy if exists issues_write on public.issues;
create policy issues_write on public.issues as permissive for all to authenticated using (is_admin()) with check (is_admin());
drop policy if exists leave_cancel_own on public.leave_requests;
create policy leave_cancel_own on public.leave_requests as permissive for update to authenticated using (((status = 'pending'::leave_status) AND (lower(requested_by) = my_email()))) with check ((status = 'cancelled'::leave_status));
drop policy if exists leave_insert on public.leave_requests;
create policy leave_insert on public.leave_requests as permissive for insert to authenticated with check ((can_manage_company(company_id) OR (EXISTS ( SELECT 1
   FROM staff s
  WHERE ((s.id = leave_requests.staff_id) AND (lower(s.member_email) = my_email()))))));
drop policy if exists leave_read on public.leave_requests;
create policy leave_read on public.leave_requests as permissive for select to authenticated using ((my_company_role(company_id) IS NOT NULL));
drop policy if exists press_customers_read on public.press_customers;
create policy press_customers_read on public.press_customers as permissive for select to authenticated using ((my_company_role(company_id) IS NOT NULL));
drop policy if exists press_customers_write on public.press_customers;
create policy press_customers_write on public.press_customers as permissive for all to authenticated using (can_write_company(company_id)) with check (can_write_company(company_id));
drop policy if exists press_files_read on public.press_files;
create policy press_files_read on public.press_files as permissive for select to authenticated using ((my_company_role(company_id) IS NOT NULL));
drop policy if exists press_files_write on public.press_files;
create policy press_files_write on public.press_files as permissive for all to authenticated using (can_write_company(company_id)) with check (can_write_company(company_id));
drop policy if exists press_jobs_read on public.press_jobs;
create policy press_jobs_read on public.press_jobs as permissive for select to authenticated using ((my_company_role(company_id) IS NOT NULL));
drop policy if exists press_jobs_write on public.press_jobs;
create policy press_jobs_write on public.press_jobs as permissive for all to authenticated using (can_write_company(company_id)) with check (can_write_company(company_id));
drop policy if exists press_materials_read on public.press_materials;
create policy press_materials_read on public.press_materials as permissive for select to authenticated using ((my_company_role(company_id) IS NOT NULL));
drop policy if exists press_materials_write on public.press_materials;
create policy press_materials_write on public.press_materials as permissive for all to authenticated using (can_manage_company(company_id)) with check (can_manage_company(company_id));
drop policy if exists press_payments_delete on public.press_payments;
create policy press_payments_delete on public.press_payments as permissive for delete to authenticated using (can_manage_company(company_id));
drop policy if exists press_payments_insert on public.press_payments;
create policy press_payments_insert on public.press_payments as permissive for insert to authenticated with check (can_write_company(company_id));
drop policy if exists press_payments_read on public.press_payments;
create policy press_payments_read on public.press_payments as permissive for select to authenticated using ((my_company_role(company_id) IS NOT NULL));
drop policy if exists press_rate_read on public.press_rate_items;
create policy press_rate_read on public.press_rate_items as permissive for select to authenticated using ((my_company_role(company_id) IS NOT NULL));
drop policy if exists press_rate_write on public.press_rate_items;
create policy press_rate_write on public.press_rate_items as permissive for all to authenticated using (can_manage_company(company_id)) with check (can_manage_company(company_id));
drop policy if exists roles_read on public.roles;
create policy roles_read on public.roles as permissive for select to authenticated using (is_admin());
drop policy if exists roles_write on public.roles;
create policy roles_write on public.roles as permissive for all to authenticated using (is_admin()) with check (is_admin());
drop policy if exists staff_read on public.staff;
create policy staff_read on public.staff as permissive for select to authenticated using (((my_company_role(company_id) IS NOT NULL) OR (EXISTS ( SELECT 1
   FROM unnest(staff.companies) c(c)
  WHERE (my_company_role(c.c) IS NOT NULL)))));
drop policy if exists staff_write on public.staff;
create policy staff_write on public.staff as permissive for all to authenticated using (can_manage_company(company_id)) with check (can_manage_company(company_id));
drop policy if exists staff_documents_read on public.staff_documents;
create policy staff_documents_read on public.staff_documents as permissive for select to authenticated using ((my_company_role(company_id) IS NOT NULL));
drop policy if exists staff_documents_write on public.staff_documents;
create policy staff_documents_write on public.staff_documents as permissive for all to authenticated using (can_manage_company(company_id)) with check (can_manage_company(company_id));
