-- Stage 5 (resilience): a customer's request form can be resent safely.
-- The portal sends a reference it makes once per form (p_client_ref). If the same customer sends the same reference again
-- (a retry after a dropped connection, a double tap), the first request comes back; no second request and no second R-number.
-- Rollback: drop function public.portal_submit_request(text, text, text, text, text, date, text, text, text, uuid);
--           re-run the 9-argument version from 20261026_customer_portal.sql; alter table public.customer_requests drop column client_ref.

alter table public.customer_requests add column if not exists client_ref uuid;
create unique index if not exists customer_requests_client_ref on public.customer_requests (user_id, client_ref) where client_ref is not null;

drop function if exists public.portal_submit_request(text, text, text, text, text, date, text, text, text);
create or replace function public.portal_submit_request(p_company text, p_service text, p_title text, p_details text, p_quantity text, p_needed_by date,
                                                         p_name text, p_phone text, p_business text, p_client_ref uuid default null) returns public.customer_requests
language plpgsql security definer set search_path = public as $$
declare v int; r public.customer_requests; e text := lower(coalesce((select email from auth.users where id = auth.uid()), ''));
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if e = '' or not exists (select 1 from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null) then raise exception 'Confirm your email first'; end if;
  if p_client_ref is not null then
    select * into r from public.customer_requests where user_id = auth.uid() and client_ref = p_client_ref;
    if r.id is not null then return r; end if;   -- already received: same request back, nothing new created
  end if;
  if not exists (select 1 from public.companies c where c.id = p_company and c.active) then raise exception 'Unknown company'; end if;
  if length(trim(coalesce(p_title, ''))) < 3 then raise exception 'Say what you need in the title'; end if;
  if (select count(*) from public.customer_requests where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 10 then raise exception 'Too many requests in one hour; try again later'; end if;
  insert into public.portal_profiles (user_id, name, phone, business, email) values (auth.uid(), trim(coalesce(p_name, '')), trim(coalesce(p_phone, '')), trim(coalesce(p_business, '')), e)
  on conflict (user_id) do update set name = excluded.name, phone = excluded.phone, business = excluded.business, email = excluded.email, updated_at = now();
  insert into public.counters (company_id, kind, value) values (p_company, 'R', 1)
  on conflict (company_id, kind) do update set value = public.counters.value + 1 returning value into v;
  insert into public.customer_requests (company_id, user_id, ref, service, title, details, quantity, needed_by, contact_name, contact_phone, contact_email, client_ref)
  values (p_company, auth.uid(), 'R-' || lpad(v::text, 4, '0'), left(coalesce(p_service, ''), 120), left(trim(p_title), 200), left(coalesce(p_details, ''), 5000), left(coalesce(p_quantity, ''), 120), p_needed_by,
          left(trim(coalesce(p_name, '')), 120), left(trim(coalesce(p_phone, '')), 40), e, p_client_ref)
  returning * into r;
  return r;
end $$;
revoke all on function public.portal_submit_request(text, text, text, text, text, date, text, text, text, uuid) from public, anon;
grant execute on function public.portal_submit_request(text, text, text, text, text, date, text, text, text, uuid) to authenticated;
