-- Phase 2, Press: customers, rate card, jobs (quote → production → delivered), payments, materials, files.
-- A job starts life as a quote; its stage moves forward. Numbers are per company (e.g. FRP-Q-0001 for quotes/jobs, FRP-R-0001 for receipts).

-- per-company module settings (letterhead, bank details, terms…)
create table if not exists public.company_settings (
  company_id text not null references public.companies(id) on delete cascade,
  module text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (company_id, module)
);
alter table public.company_settings enable row level security;
create policy company_settings_read on public.company_settings for select to authenticated using (public.my_company_role(company_id) is not null);
create policy company_settings_write on public.company_settings for all to authenticated using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));

-- running numbers
create table if not exists public.counters (company_id text not null, kind text not null, value int not null default 0, primary key (company_id, kind));
alter table public.counters enable row level security;
create or replace function public.next_number(p_company text, p_kind text) returns int
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if not public.can_write_company(p_company) then raise exception 'No write access to this company'; end if;
  insert into public.counters (company_id, kind, value) values (p_company, p_kind, 1)
  on conflict (company_id, kind) do update set value = public.counters.value + 1 returning value into v;
  return v;
end $$;
revoke all on function public.next_number(text, text) from public, anon; grant execute on function public.next_number(text, text) to authenticated;

create type public.press_stage as enum ('quote', 'accepted', 'design', 'proof', 'print', 'finishing', 'ready', 'delivered', 'cancelled');
create type public.pay_method as enum ('cash', 'transfer', 'pos', 'other');

create table public.press_customers (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references public.companies(id),
  name text not null,
  phone text not null default '',
  email text not null default '',
  address text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text
);
create index press_customers_company on public.press_customers(company_id);

create table public.press_rate_items (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references public.companies(id),
  category text not null default 'General',
  name text not null,
  unit text not null default 'piece',
  price numeric(12,2) not null default 0,
  active boolean not null default true,
  "order" int not null default 100,
  notes text not null default '',
  updated_at timestamptz not null default now(), updated_by text
);
create index press_rate_items_company on public.press_rate_items(company_id);

create table public.press_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references public.companies(id),
  number text not null,                                   -- e.g. Q-0001; stays the same when the quote becomes a job
  customer_id uuid references public.press_customers(id) on delete set null,
  customer_name text not null default '',                 -- copied, so the document stays right if the customer is edited later
  title text not null default '',
  description text not null default '',
  items jsonb not null default '[]'::jsonb,               -- [{description, qty, unit, unit_price, total, rate_item_id?}]
  subtotal numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  deposit_pct int not null default 50,
  valid_days int not null default 14,
  stage public.press_stage not null default 'quote',
  quoted_at timestamptz,
  sent_at timestamptz,
  accepted_at timestamptz,
  due_date date,
  delivered_at timestamptz,
  assigned_to text not null default '',                   -- staff id or free text
  specs jsonb not null default '{}'::jsonb,               -- size, paper, colours, finishing, quantity…
  proof_approved_at timestamptz,
  notes text not null default '',
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text,
  unique (company_id, number)
);
create index press_jobs_company_stage on public.press_jobs(company_id, stage);

create table public.press_payments (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references public.companies(id),
  job_id uuid not null references public.press_jobs(id) on delete cascade,
  receipt_no text not null,
  amount numeric(12,2) not null check (amount > 0),
  method public.pay_method not null default 'cash',
  paid_at date not null default current_date,
  note text not null default '',
  received_by text,
  created_at timestamptz not null default now(),
  unique (company_id, receipt_no)
);
create index press_payments_job on public.press_payments(job_id);

create table public.press_materials (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references public.companies(id),
  name text not null,
  unit text not null default 'unit',
  quantity numeric(12,2) not null default 0,
  reorder_level numeric(12,2) not null default 0,
  unit_cost numeric(12,2) not null default 0,
  notes text not null default '',
  updated_at timestamptz not null default now(), updated_by text
);
create index press_materials_company on public.press_materials(company_id);

create table public.press_material_moves (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references public.companies(id),
  material_id uuid not null references public.press_materials(id) on delete cascade,
  job_id uuid references public.press_jobs(id) on delete set null,
  delta numeric(12,2) not null,                          -- + received, − used
  note text not null default '',
  moved_by text,
  moved_at timestamptz not null default now()
);
create or replace function public.press_apply_move() returns trigger
language plpgsql set search_path = public as $$
begin
  update public.press_materials set quantity = quantity + new.delta, updated_at = now(), updated_by = new.moved_by where id = new.material_id;
  return new;
end $$;
create trigger press_material_moves_apply after insert on public.press_material_moves for each row execute function public.press_apply_move();

create table public.press_files (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references public.companies(id),
  job_id uuid not null references public.press_jobs(id) on delete cascade,
  kind text not null default 'other',                     -- artwork, proof, reference, other
  title text not null,
  file_path text not null,
  size_bytes int, mime text,
  uploaded_by text, uploaded_at timestamptz not null default now()
);
create index press_files_job on public.press_files(job_id);

-- who/when stamps
create trigger press_customers_touch before insert or update on public.press_customers for each row execute function public.touch_row();
create trigger press_jobs_touch before insert or update on public.press_jobs for each row execute function public.touch_row();

-- access: read with any role in the company; write with admin/manager/staff; rate card and materials settings by admin/manager
alter table public.press_customers enable row level security;
alter table public.press_rate_items enable row level security;
alter table public.press_jobs enable row level security;
alter table public.press_payments enable row level security;
alter table public.press_materials enable row level security;
alter table public.press_material_moves enable row level security;
alter table public.press_files enable row level security;
create policy press_customers_read on public.press_customers for select to authenticated using (public.my_company_role(company_id) is not null);
create policy press_customers_write on public.press_customers for all to authenticated using (public.can_write_company(company_id)) with check (public.can_write_company(company_id));
create policy press_rate_read on public.press_rate_items for select to authenticated using (public.my_company_role(company_id) is not null);
create policy press_rate_write on public.press_rate_items for all to authenticated using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));
create policy press_jobs_read on public.press_jobs for select to authenticated using (public.my_company_role(company_id) is not null);
create policy press_jobs_write on public.press_jobs for all to authenticated using (public.can_write_company(company_id)) with check (public.can_write_company(company_id));
create policy press_payments_read on public.press_payments for select to authenticated using (public.my_company_role(company_id) is not null);
create policy press_payments_insert on public.press_payments for insert to authenticated with check (public.can_write_company(company_id));
create policy press_payments_delete on public.press_payments for delete to authenticated using (public.can_manage_company(company_id));
create policy press_materials_read on public.press_materials for select to authenticated using (public.my_company_role(company_id) is not null);
create policy press_materials_write on public.press_materials for all to authenticated using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));
create policy press_moves_read on public.press_material_moves for select to authenticated using (public.my_company_role(company_id) is not null);
create policy press_moves_insert on public.press_material_moves for insert to authenticated with check (public.can_write_company(company_id));
create policy press_files_read on public.press_files for select to authenticated using (public.my_company_role(company_id) is not null);
create policy press_files_write on public.press_files for all to authenticated using (public.can_write_company(company_id)) with check (public.can_write_company(company_id));

-- private job files; path = <company_id>/<job_id>/<file>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('press-files', 'press-files', false, 26214400, null) on conflict (id) do nothing;
create policy "press files read by company" on storage.objects for select to authenticated using (bucket_id = 'press-files' and public.my_company_role((storage.foldername(name))[1]) is not null);
create policy "press files write by staff" on storage.objects for insert to authenticated with check (bucket_id = 'press-files' and public.can_write_company((storage.foldername(name))[1]));
create policy "press files delete by staff" on storage.objects for delete to authenticated using (bucket_id = 'press-files' and public.can_write_company((storage.foldername(name))[1]));

alter publication supabase_realtime add table public.press_customers, public.press_rate_items, public.press_jobs, public.press_payments, public.press_materials, public.press_material_moves, public.press_files, public.company_settings;

-- Press module on for Future Ready Press; starter rate card (prices are placeholders to be set by the Press Admin)
update public.companies set modules = array_append(modules, 'press') where id = 'press' and not ('press' = any(modules));
insert into public.press_rate_items (company_id, category, name, unit, price, "order", notes) values
  ('press', 'Flyers & handbills', 'A5 flyer, full colour, one side', 'piece', 0, 10, 'set your price'),
  ('press', 'Flyers & handbills', 'A5 flyer, full colour, two sides', 'piece', 0, 11, 'set your price'),
  ('press', 'Flyers & handbills', 'A4 flyer, full colour', 'piece', 0, 12, 'set your price'),
  ('press', 'Banners', 'Flex banner', 'sq ft', 0, 20, 'set your price'),
  ('press', 'Banners', 'Roll-up banner, with stand', 'piece', 0, 21, 'set your price'),
  ('press', 'Cards', 'Business cards, 100', 'pack', 0, 30, 'set your price'),
  ('press', 'Cards', 'Invitation card', 'piece', 0, 31, 'set your price'),
  ('press', 'Books & documents', 'Booklet, A5, saddle-stitched', 'piece', 0, 40, 'set your price'),
  ('press', 'Books & documents', 'Photocopy / print, A4 black', 'page', 0, 41, 'set your price'),
  ('press', 'Books & documents', 'Lamination, A4', 'piece', 0, 42, 'set your price'),
  ('press', 'Services', 'Design work', 'hour', 0, 90, 'set your price'),
  ('press', 'Services', 'Delivery within Enugu', 'trip', 0, 91, 'set your price');
