-- Future Ready Group System: complete database schema snapshot (structure only: no data, no secrets).

-- Generated 2026-10-26 14:18 UTC from the live project by supabase/schema/generate_snapshot.sql.

-- Restore: run this whole file in the SQL editor of an EMPTY Supabase project, then load data with fr_restore() (see docs/RESTORE_RUNBOOK.md).

set check_function_bodies = off;

create schema if not exists fr_internal;
grant usage on schema fr_internal to authenticated;

-- extensions

-- types

do $e$ begin create type public.company_role as enum ('admin', 'manager', 'staff', 'viewer'); exception when duplicate_object then null; end $e$;
do $e$ begin create type public.employment_type as enum ('full_time', 'part_time', 'contract', 'intern', 'volunteer'); exception when duplicate_object then null; end $e$;
do $e$ begin create type public.leave_kind as enum ('annual', 'sick', 'casual', 'maternity', 'paternity', 'unpaid', 'other'); exception when duplicate_object then null; end $e$;
do $e$ begin create type public.leave_status as enum ('pending', 'approved', 'declined', 'cancelled'); exception when duplicate_object then null; end $e$;
do $e$ begin create type public.member_level as enum ('viewer', 'contributor', 'editor'); exception when duplicate_object then null; end $e$;
do $e$ begin create type public.member_status as enum ('invited', 'pending', 'active', 'disabled'); exception when duplicate_object then null; end $e$;
do $e$ begin create type public.pay_method as enum ('cash', 'transfer', 'pos', 'other'); exception when duplicate_object then null; end $e$;
do $e$ begin create type public.press_stage as enum ('quote', 'accepted', 'design', 'proof', 'print', 'finishing', 'ready', 'delivered', 'cancelled'); exception when duplicate_object then null; end $e$;
do $e$ begin create type public.request_status as enum ('new', 'quoted', 'in_progress', 'done', 'declined'); exception when duplicate_object then null; end $e$;
do $e$ begin create type public.staff_status as enum ('active', 'left'); exception when duplicate_object then null; end $e$;

-- tables

create table if not exists public.app_config (
  key text not null,
  value text not null,
  updated_at timestamp with time zone default now() not null
);
create table if not exists public.candidates (
  id text not null,
  role text not null,
  sn integer not null,
  name text not null,
  phone text default ''::text not null,
  email text default ''::text not null,
  address text default ''::text not null,
  qualification text default 'Unknown'::text not null,
  location text default 'Unknown'::text not null,
  state text default ''::text not null,
  status text default 'pending'::text not null,
  attempts integer default 0 not null,
  mode text default ''::text not null,
  availability text default ''::text not null,
  relocation text default ''::text not null,
  manual text default ''::text not null,
  adjust numeric default 0 not null,
  notes text default ''::text not null,
  portfolio text default ''::text not null,
  next_action text default ''::text not null,
  last_contact timestamp with time zone,
  last_by text,
  history jsonb default '[]'::jsonb not null,
  self_reported boolean default false not null,
  form_response_at timestamp with time zone,
  form_role text,
  emailed_at timestamp with time zone,
  last_email_status text,
  last_email_at timestamp with time zone,
  last_email_error text default ''::text not null,
  outreach jsonb default '[]'::jsonb not null,
  interview jsonb,
  added_manually boolean default false not null,
  added_by text,
  imported_from text,
  updated_at timestamp with time zone default now() not null,
  company_id text,
  deleted_at timestamp with time zone,
  deleted_by text,
  delete_batch uuid,
  version integer default 1 not null,
  op_id uuid default gen_random_uuid(),
  updated_by text
);
create table if not exists public.companies (
  id text not null,
  name text not null,
  short_name text not null,
  kind text default 'company'::text not null,
  "order" integer default 10 not null,
  active boolean default true not null,
  modules text[] default ARRAY['hiring'::text] not null,
  created_at timestamp with time zone default now() not null
);
create table if not exists public.company_members (
  email text not null,
  company_id text not null,
  role public.company_role not null,
  added_at timestamp with time zone default now() not null,
  added_by text
);
create table if not exists public.company_settings (
  company_id text not null,
  module text not null,
  data jsonb default '{}'::jsonb not null,
  updated_at timestamp with time zone default now() not null,
  updated_by text
);
create table if not exists public.conflicts (
  id uuid default gen_random_uuid() not null,
  op_id uuid not null,
  entity text not null,
  record_id text not null,
  company_id text,
  base_version integer,
  current_version integer,
  fields text[] not null,
  incoming jsonb not null,
  current_values jsonb not null,
  actor text,
  created_at timestamp with time zone default now() not null,
  status text default 'open'::text not null,
  resolved_by text,
  resolved_at timestamp with time zone,
  resolution jsonb
);
create table if not exists public.counters (
  company_id text not null,
  kind text not null,
  value integer default 0 not null
);
create table if not exists public.customer_request_files (
  id uuid default gen_random_uuid() not null,
  request_id uuid not null,
  company_id text not null,
  name text not null,
  file_path text not null,
  size_bytes integer,
  mime text,
  uploaded_by uuid,
  created_at timestamp with time zone default now() not null
);
create table if not exists public.customer_request_messages (
  id uuid default gen_random_uuid() not null,
  request_id uuid not null,
  company_id text not null,
  author text not null,
  author_name text default ''::text not null,
  body text not null,
  created_at timestamp with time zone default now() not null
);
create table if not exists public.customer_requests (
  id uuid default gen_random_uuid() not null,
  company_id text not null,
  user_id uuid not null,
  ref text not null,
  service text default ''::text not null,
  title text not null,
  details text default ''::text not null,
  quantity text default ''::text not null,
  needed_by date,
  contact_name text default ''::text not null,
  contact_phone text default ''::text not null,
  contact_email text default ''::text not null,
  status public.request_status not null,
  staff_note text default ''::text not null,
  job_id uuid,
  customer_id uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  updated_by text,
  deleted_at timestamp with time zone,
  deleted_by text,
  delete_batch uuid,
  version integer default 1 not null,
  op_id uuid default gen_random_uuid(),
  client_ref uuid
);
create table if not exists public.deletions (
  id uuid default gen_random_uuid() not null,
  entity text not null,
  record_id text not null,
  label text default ''::text not null,
  company_id text,
  children jsonb default '{}'::jsonb not null,
  deleted_by text,
  deleted_at timestamp with time zone default now() not null,
  restored_by text,
  restored_at timestamp with time zone,
  purged_by text,
  purged_at timestamp with time zone
);
create table if not exists public.issues (
  id text not null,
  candidate_id text,
  name text not null,
  role text not null,
  issue text not null,
  detail text default ''::text not null,
  action text default ''::text not null,
  resolved boolean default false not null,
  resolution text default ''::text not null,
  resolved_at timestamp with time zone,
  resolved_by text,
  company_id text,
  deleted_at timestamp with time zone,
  deleted_by text,
  delete_batch uuid,
  version integer default 1 not null,
  op_id uuid default gen_random_uuid(),
  updated_at timestamp with time zone,
  updated_by text
);
create table if not exists public.leave_requests (
  id uuid default gen_random_uuid() not null,
  staff_id uuid not null,
  company_id text not null,
  kind public.leave_kind not null,
  start_date date not null,
  end_date date not null,
  days integer generated always as (((end_date - start_date) + 1)) stored,
  reason text default ''::text not null,
  status public.leave_status not null,
  requested_by text,
  decided_by text,
  decided_at timestamp with time zone,
  decision_note text default ''::text not null,
  created_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone,
  deleted_by text,
  delete_batch uuid,
  version integer default 1 not null,
  op_id uuid default gen_random_uuid(),
  updated_at timestamp with time zone,
  updated_by text
);
create table if not exists public.member_invites (
  email text not null,
  token text not null,
  created_at timestamp with time zone default now() not null
);
create table if not exists public.members (
  email text not null,
  level public.member_level not null,
  name text,
  added_at timestamp with time zone default now() not null,
  status public.member_status not null,
  surname text default ''::text not null,
  first_name text default ''::text not null,
  other_names text default ''::text not null,
  phone text default ''::text not null,
  "position" text default ''::text not null,
  photo_url text default ''::text not null,
  profile_done boolean default false not null,
  requested_level public.member_level,
  invited_by text,
  invited_at timestamp with time zone,
  invite_sent_at timestamp with time zone,
  joined_at timestamp with time zone,
  last_seen_at timestamp with time zone,
  user_id uuid,
  updated_at timestamp with time zone default now() not null,
  requested_company text,
  requested_role public.company_role
);
create table if not exists public.op_receipts (
  op_id uuid not null,
  actor text not null,
  entity text not null,
  record_id text,
  action text,
  result text default 'pending'::text not null,
  version integer,
  created_at timestamp with time zone default now() not null,
  finished_at timestamp with time zone
);
create table if not exists public.ops_log (
  id bigint generated always as identity not null,
  op_id uuid not null,
  entity text not null,
  record_id text not null,
  company_id text,
  action text not null,
  result text default 'applied'::text not null,
  base_version integer,
  result_version integer,
  actor text,
  actor_uid uuid,
  source text default 'app'::text not null,
  changes jsonb default '{}'::jsonb not null,
  error text,
  conflict jsonb,
  created_at timestamp with time zone default now() not null
);
create table if not exists public.portal_profiles (
  user_id uuid not null,
  name text default ''::text not null,
  phone text default ''::text not null,
  business text default ''::text not null,
  email text default ''::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table if not exists public.press_customers (
  id uuid default gen_random_uuid() not null,
  company_id text not null,
  name text not null,
  phone text default ''::text not null,
  email text default ''::text not null,
  address text default ''::text not null,
  notes text default ''::text not null,
  created_at timestamp with time zone default now() not null,
  created_by text,
  updated_at timestamp with time zone default now() not null,
  updated_by text,
  deleted_at timestamp with time zone,
  deleted_by text,
  delete_batch uuid,
  version integer default 1 not null,
  op_id uuid default gen_random_uuid()
);
create table if not exists public.press_files (
  id uuid default gen_random_uuid() not null,
  company_id text not null,
  job_id uuid not null,
  kind text default 'other'::text not null,
  title text not null,
  file_path text not null,
  size_bytes integer,
  mime text,
  uploaded_by text,
  uploaded_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone,
  deleted_by text,
  delete_batch uuid,
  version integer default 1 not null,
  op_id uuid default gen_random_uuid(),
  updated_at timestamp with time zone,
  updated_by text
);
create table if not exists public.press_jobs (
  id uuid default gen_random_uuid() not null,
  company_id text not null,
  number text not null,
  customer_id uuid,
  customer_name text default ''::text not null,
  title text default ''::text not null,
  description text default ''::text not null,
  items jsonb default '[]'::jsonb not null,
  subtotal numeric(12,2) default 0 not null,
  discount numeric(12,2) default 0 not null,
  total numeric(12,2) default 0 not null,
  deposit_pct integer default 50 not null,
  valid_days integer default 14 not null,
  stage public.press_stage not null,
  quoted_at timestamp with time zone,
  sent_at timestamp with time zone,
  accepted_at timestamp with time zone,
  due_date date,
  delivered_at timestamp with time zone,
  assigned_to text default ''::text not null,
  specs jsonb default '{}'::jsonb not null,
  proof_approved_at timestamp with time zone,
  notes text default ''::text not null,
  history jsonb default '[]'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  created_by text,
  updated_at timestamp with time zone default now() not null,
  updated_by text,
  deleted_at timestamp with time zone,
  deleted_by text,
  delete_batch uuid,
  version integer default 1 not null,
  op_id uuid default gen_random_uuid()
);
create table if not exists public.press_material_moves (
  id uuid default gen_random_uuid() not null,
  company_id text not null,
  material_id uuid not null,
  job_id uuid,
  delta numeric(12,2) not null,
  note text default ''::text not null,
  moved_by text,
  moved_at timestamp with time zone default now() not null
);
create table if not exists public.press_materials (
  id uuid default gen_random_uuid() not null,
  company_id text not null,
  name text not null,
  unit text default 'unit'::text not null,
  quantity numeric(12,2) default 0 not null,
  reorder_level numeric(12,2) default 0 not null,
  unit_cost numeric(12,2) default 0 not null,
  notes text default ''::text not null,
  updated_at timestamp with time zone default now() not null,
  updated_by text,
  deleted_at timestamp with time zone,
  deleted_by text,
  delete_batch uuid,
  version integer default 1 not null,
  op_id uuid default gen_random_uuid()
);
create table if not exists public.press_payments (
  id uuid default gen_random_uuid() not null,
  company_id text not null,
  job_id uuid not null,
  receipt_no text not null,
  amount numeric(12,2) not null,
  method public.pay_method not null,
  paid_at date default CURRENT_DATE not null,
  note text default ''::text not null,
  received_by text,
  created_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone,
  deleted_by text,
  delete_batch uuid,
  version integer default 1 not null,
  op_id uuid default gen_random_uuid(),
  updated_at timestamp with time zone,
  updated_by text
);
create table if not exists public.press_rate_items (
  id uuid default gen_random_uuid() not null,
  company_id text not null,
  category text default 'General'::text not null,
  name text not null,
  unit text default 'piece'::text not null,
  price numeric(12,2) default 0 not null,
  active boolean default true not null,
  "order" integer default 100 not null,
  notes text default ''::text not null,
  updated_at timestamp with time zone default now() not null,
  updated_by text,
  deleted_at timestamp with time zone,
  deleted_by text,
  delete_batch uuid,
  version integer default 1 not null,
  op_id uuid default gen_random_uuid()
);
create table if not exists public.roles (
  id text not null,
  name text not null,
  qual_weight numeric default 1 not null,
  top integer default 10 not null,
  second integer default 20 not null,
  "order" integer default 99 not null,
  status text default 'open'::text not null,
  source text,
  created_at timestamp with time zone default now(),
  created_by text,
  closed_at timestamp with time zone,
  closed_by text,
  reopened_at timestamp with time zone,
  final_stats jsonb,
  company_id text default 'group'::text not null,
  deleted_at timestamp with time zone,
  deleted_by text,
  delete_batch uuid,
  version integer default 1 not null,
  op_id uuid default gen_random_uuid(),
  updated_at timestamp with time zone,
  updated_by text
);
create table if not exists public.settings (
  id text not null,
  data jsonb default '{}'::jsonb not null,
  updated_at timestamp with time zone default now() not null
);
create table if not exists public.staff (
  id uuid default gen_random_uuid() not null,
  company_id text not null,
  companies text[] default '{}'::text[] not null,
  member_email text,
  surname text default ''::text not null,
  first_name text default ''::text not null,
  other_names text default ''::text not null,
  full_name text default ''::text not null,
  phone text default ''::text not null,
  email text default ''::text not null,
  "position" text default ''::text not null,
  department text default ''::text not null,
  employment_type public.employment_type not null,
  start_date date,
  end_date date,
  status public.staff_status not null,
  photo_url text default ''::text not null,
  candidate_id text,
  history jsonb default '[]'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  created_by text,
  updated_at timestamp with time zone default now() not null,
  updated_by text,
  deleted_at timestamp with time zone,
  deleted_by text,
  delete_batch uuid,
  version integer default 1 not null,
  op_id uuid default gen_random_uuid()
);
create table if not exists public.staff_documents (
  id uuid default gen_random_uuid() not null,
  staff_id uuid not null,
  company_id text not null,
  kind text default 'other'::text not null,
  title text not null,
  file_path text not null,
  size_bytes integer,
  mime text,
  note text default ''::text not null,
  uploaded_by text,
  uploaded_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone,
  deleted_by text,
  delete_batch uuid,
  version integer default 1 not null,
  op_id uuid default gen_random_uuid(),
  updated_at timestamp with time zone,
  updated_by text
);
create table if not exists public.staff_private (
  id uuid not null,
  company_id text not null,
  address text default ''::text not null,
  date_of_birth date,
  emergency_name text default ''::text not null,
  emergency_phone text default ''::text not null,
  notes text default ''::text not null,
  version integer default 1 not null,
  op_id uuid default gen_random_uuid(),
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  updated_by text,
  deleted_at timestamp with time zone,
  deleted_by text,
  delete_batch uuid
);
create table if not exists public.sync_runs (
  id uuid default gen_random_uuid() not null,
  kind text not null,
  scheduled_for timestamp with time zone,
  started_at timestamp with time zone default now() not null,
  finished_at timestamp with time zone,
  status text default 'running'::text not null,
  tables integer,
  rows integer,
  files integer,
  bytes bigint,
  file_name text,
  drive_file_id text,
  checksum text,
  schema_version text,
  format text,
  error text,
  source text default 'apps-script'::text not null,
  details jsonb default '{}'::jsonb not null
);

-- constraints

alter table public.app_config add constraint app_config_pkey PRIMARY KEY (key);
alter table public.candidates add constraint candidates_pkey PRIMARY KEY (id);
alter table public.companies add constraint companies_pkey PRIMARY KEY (id);
alter table public.company_members add constraint company_members_pkey PRIMARY KEY (email, company_id);
alter table public.company_settings add constraint company_settings_pkey PRIMARY KEY (company_id, module);
alter table public.conflicts add constraint conflicts_pkey PRIMARY KEY (id);
alter table public.counters add constraint counters_pkey PRIMARY KEY (company_id, kind);
alter table public.customer_request_files add constraint customer_request_files_pkey PRIMARY KEY (id);
alter table public.customer_request_messages add constraint customer_request_messages_pkey PRIMARY KEY (id);
alter table public.customer_requests add constraint customer_requests_pkey PRIMARY KEY (id);
alter table public.deletions add constraint deletions_pkey PRIMARY KEY (id);
alter table public.issues add constraint issues_pkey PRIMARY KEY (id);
alter table public.leave_requests add constraint leave_requests_pkey PRIMARY KEY (id);
alter table public.member_invites add constraint member_invites_pkey PRIMARY KEY (email);
alter table public.members add constraint members_pkey PRIMARY KEY (email);
alter table public.op_receipts add constraint op_receipts_pkey PRIMARY KEY (op_id);
alter table public.ops_log add constraint ops_log_pkey PRIMARY KEY (id);
alter table public.portal_profiles add constraint portal_profiles_pkey PRIMARY KEY (user_id);
alter table public.press_customers add constraint press_customers_pkey PRIMARY KEY (id);
alter table public.press_files add constraint press_files_pkey PRIMARY KEY (id);
alter table public.press_jobs add constraint press_jobs_pkey PRIMARY KEY (id);
alter table public.press_material_moves add constraint press_material_moves_pkey PRIMARY KEY (id);
alter table public.press_materials add constraint press_materials_pkey PRIMARY KEY (id);
alter table public.press_payments add constraint press_payments_pkey PRIMARY KEY (id);
alter table public.press_rate_items add constraint press_rate_items_pkey PRIMARY KEY (id);
alter table public.roles add constraint roles_pkey PRIMARY KEY (id);
alter table public.settings add constraint settings_pkey PRIMARY KEY (id);
alter table public.staff add constraint staff_pkey PRIMARY KEY (id);
alter table public.staff_documents add constraint staff_documents_pkey PRIMARY KEY (id);
alter table public.staff_private add constraint staff_private_pkey PRIMARY KEY (id);
alter table public.sync_runs add constraint sync_runs_pkey PRIMARY KEY (id);
alter table public.customer_requests add constraint customer_requests_company_id_ref_key UNIQUE (company_id, ref);
alter table public.press_jobs add constraint press_jobs_company_id_number_key UNIQUE (company_id, number);
alter table public.press_payments add constraint press_payments_company_id_receipt_no_key UNIQUE (company_id, receipt_no);
alter table public.candidates add constraint candidates_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'awaiting'::text, 'attempted'::text, 'contacted'::text])));
alter table public.conflicts add constraint conflicts_status_check CHECK ((status = ANY (ARRAY['open'::text, 'kept_current'::text, 'took_incoming'::text, 'merged'::text])));
alter table public.customer_request_messages add constraint customer_request_messages_author_check CHECK ((author = ANY (ARRAY['customer'::text, 'staff'::text])));
alter table public.leave_requests add constraint leave_dates CHECK ((end_date >= start_date));
alter table public.ops_log add constraint ops_log_action_check CHECK ((action = ANY (ARRAY['insert'::text, 'update'::text, 'soft_delete'::text, 'restore'::text, 'delete'::text, 'conflict'::text, 'refused'::text, 'duplicate'::text, 'resolve'::text])));
alter table public.ops_log add constraint ops_log_result_check CHECK ((result = ANY (ARRAY['applied'::text, 'conflict'::text, 'refused'::text, 'duplicate'::text, 'failed'::text])));
alter table public.press_payments add constraint press_payments_amount_check CHECK ((amount > (0)::numeric));
alter table public.roles add constraint roles_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text])));
alter table public.sync_runs add constraint sync_runs_kind_check CHECK ((kind = ANY (ARRAY['rolling'::text, 'nightly'::text, 'monthly'::text, 'sheet'::text, 'restore_test'::text, 'manual'::text])));
alter table public.sync_runs add constraint sync_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'success'::text, 'failed'::text])));
alter table public.candidates add constraint candidates_role_fkey FOREIGN KEY (role) REFERENCES public.roles(id) ON DELETE CASCADE;
alter table public.company_members add constraint company_members_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;
alter table public.company_settings add constraint company_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;
alter table public.customer_request_files add constraint customer_request_files_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);
alter table public.customer_request_files add constraint customer_request_files_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.customer_requests(id) ON DELETE CASCADE;
alter table public.customer_request_messages add constraint customer_request_messages_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);
alter table public.customer_request_messages add constraint customer_request_messages_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.customer_requests(id) ON DELETE CASCADE;
alter table public.customer_requests add constraint customer_requests_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);
alter table public.customer_requests add constraint customer_requests_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.press_customers(id) ON DELETE SET NULL;
alter table public.customer_requests add constraint customer_requests_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.press_jobs(id) ON DELETE SET NULL;
alter table public.customer_requests add constraint customer_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.issues add constraint issues_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES public.candidates(id) ON DELETE CASCADE;
alter table public.leave_requests add constraint leave_requests_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);
alter table public.leave_requests add constraint leave_requests_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE CASCADE;
alter table public.portal_profiles add constraint portal_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.press_customers add constraint press_customers_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);
alter table public.press_files add constraint press_files_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);
alter table public.press_files add constraint press_files_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.press_jobs(id) ON DELETE CASCADE;
alter table public.press_jobs add constraint press_jobs_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);
alter table public.press_jobs add constraint press_jobs_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.press_customers(id) ON DELETE SET NULL;
alter table public.press_material_moves add constraint press_material_moves_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);
alter table public.press_material_moves add constraint press_material_moves_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.press_jobs(id) ON DELETE SET NULL;
alter table public.press_material_moves add constraint press_material_moves_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.press_materials(id) ON DELETE CASCADE;
alter table public.press_materials add constraint press_materials_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);
alter table public.press_payments add constraint press_payments_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);
alter table public.press_payments add constraint press_payments_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.press_jobs(id) ON DELETE CASCADE;
alter table public.press_rate_items add constraint press_rate_items_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);
alter table public.roles add constraint roles_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);
alter table public.staff add constraint staff_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);
alter table public.staff_documents add constraint staff_documents_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);
alter table public.staff_documents add constraint staff_documents_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE CASCADE;
alter table public.staff_private add constraint staff_private_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);
alter table public.staff_private add constraint staff_private_id_fkey FOREIGN KEY (id) REFERENCES public.staff(id) ON DELETE CASCADE;

-- indexes

CREATE INDEX candidates_delete_batch ON public.candidates USING btree (delete_batch) WHERE (delete_batch IS NOT NULL);
CREATE INDEX candidates_phone_idx ON public.candidates USING btree (phone);
CREATE INDEX candidates_role_idx ON public.candidates USING btree (role);
CREATE INDEX conflicts_open ON public.conflicts USING btree (created_at DESC) WHERE (status = 'open'::text);
CREATE UNIQUE INDEX customer_request_files_path_key ON public.customer_request_files USING btree (file_path);
CREATE INDEX customer_request_files_req ON public.customer_request_files USING btree (request_id);
CREATE INDEX customer_request_messages_req ON public.customer_request_messages USING btree (request_id, created_at);
CREATE UNIQUE INDEX customer_requests_client_ref ON public.customer_requests USING btree (user_id, client_ref) WHERE (client_ref IS NOT NULL);
CREATE INDEX customer_requests_company_status ON public.customer_requests USING btree (company_id, status);
CREATE INDEX customer_requests_delete_batch ON public.customer_requests USING btree (delete_batch) WHERE (delete_batch IS NOT NULL);
CREATE INDEX customer_requests_user ON public.customer_requests USING btree (user_id);
CREATE INDEX deletions_open ON public.deletions USING btree (deleted_at DESC) WHERE ((restored_at IS NULL) AND (purged_at IS NULL));
CREATE INDEX issues_candidate_idx ON public.issues USING btree (candidate_id);
CREATE INDEX issues_delete_batch ON public.issues USING btree (delete_batch) WHERE (delete_batch IS NOT NULL);
CREATE INDEX leave_requests_company ON public.leave_requests USING btree (company_id, status);
CREATE INDEX leave_requests_delete_batch ON public.leave_requests USING btree (delete_batch) WHERE (delete_batch IS NOT NULL);
CREATE INDEX ops_log_created ON public.ops_log USING btree (created_at DESC);
CREATE INDEX ops_log_op ON public.ops_log USING btree (op_id);
CREATE INDEX ops_log_record ON public.ops_log USING btree (entity, record_id, created_at DESC);
CREATE INDEX press_customers_company ON public.press_customers USING btree (company_id);
CREATE INDEX press_customers_delete_batch ON public.press_customers USING btree (delete_batch) WHERE (delete_batch IS NOT NULL);
CREATE INDEX press_files_delete_batch ON public.press_files USING btree (delete_batch) WHERE (delete_batch IS NOT NULL);
CREATE INDEX press_files_job ON public.press_files USING btree (job_id);
CREATE INDEX press_jobs_company_stage ON public.press_jobs USING btree (company_id, stage);
CREATE INDEX press_jobs_delete_batch ON public.press_jobs USING btree (delete_batch) WHERE (delete_batch IS NOT NULL);
CREATE INDEX press_materials_company ON public.press_materials USING btree (company_id);
CREATE INDEX press_materials_delete_batch ON public.press_materials USING btree (delete_batch) WHERE (delete_batch IS NOT NULL);
CREATE INDEX press_payments_delete_batch ON public.press_payments USING btree (delete_batch) WHERE (delete_batch IS NOT NULL);
CREATE INDEX press_payments_job ON public.press_payments USING btree (job_id);
CREATE INDEX press_rate_items_company ON public.press_rate_items USING btree (company_id);
CREATE INDEX press_rate_items_delete_batch ON public.press_rate_items USING btree (delete_batch) WHERE (delete_batch IS NOT NULL);
CREATE INDEX roles_delete_batch ON public.roles USING btree (delete_batch) WHERE (delete_batch IS NOT NULL);
CREATE INDEX staff_company ON public.staff USING btree (company_id);
CREATE INDEX staff_delete_batch ON public.staff USING btree (delete_batch) WHERE (delete_batch IS NOT NULL);
CREATE INDEX staff_documents_delete_batch ON public.staff_documents USING btree (delete_batch) WHERE (delete_batch IS NOT NULL);
CREATE INDEX staff_documents_staff ON public.staff_documents USING btree (staff_id);
CREATE INDEX staff_member ON public.staff USING btree (lower(member_email));
CREATE INDEX sync_runs_kind_status ON public.sync_runs USING btree (kind, status, started_at DESC);
CREATE INDEX sync_runs_started ON public.sync_runs USING btree (started_at DESC);

-- functions

CREATE OR REPLACE FUNCTION fr_internal._conflict_close(p_id uuid, p_status text, p_resolution jsonb, p_op uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n int;
begin
  if current_setting('fr.op_id', true) is distinct from p_op::text then raise exception 'internal helper'; end if;
  if not coalesce(public.is_admin(), false) then raise exception 'Only Group Admins can resolve conflicts'; end if;
  update public.conflicts set status = p_status, resolved_by = public.my_email(), resolved_at = now(), resolution = p_resolution || jsonb_build_object('op_id', p_op)
  where id = p_id and status = 'open';
  get diagnostics n = row_count; return n;
end $function$
;

CREATE OR REPLACE FUNCTION fr_internal._op_changed_fields(p_entity text, p_id text, p_base integer, p_current integer)
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(array_agg(distinct k), '{}') from public.ops_log l, jsonb_object_keys(l.changes) k
  where l.entity = p_entity and l.record_id = p_id and l.result = 'applied' and l.result_version > p_base and l.result_version <= p_current
    and l.actor is distinct from public.my_email()
$function$
;

CREATE OR REPLACE FUNCTION fr_internal._op_log(p_op uuid, p_entity text, p_id text, p_company text, p_action text, p_result text, p_base integer, p_version integer, p_error text, p_conflict jsonb, p_changes jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into public.ops_log (op_id, entity, record_id, company_id, action, result, base_version, result_version, actor, actor_uid, source, changes, error, conflict)
  select p_op, p_entity, coalesce(p_id, ''), p_company, p_action, p_result, p_base, p_version, coalesce(nullif(public.my_email(), ''), 'service'), auth.uid(), 'app',
          fr_internal._op_mask(p_entity, p_changes), left(p_error, 1000), p_conflict
  where current_setting('fr.op_id', true) = p_op::text
$function$
;

CREATE OR REPLACE FUNCTION fr_internal._op_mask(p_entity text, p jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_object_agg(key, case when key = any(case p_entity
      when 'staff' then array['phone','email','address','date_of_birth','emergency_name','emergency_phone','notes','photo_url']
      when 'staff_private' then array['address','date_of_birth','emergency_name','emergency_phone','notes']
      when 'leave_requests' then array['reason','decision_note'] when 'staff_documents' then array['file_path','note'] else array[]::text[] end)
    then to_jsonb('[hidden]'::text) when key = 'history' then to_jsonb('[history]'::text) else value end), '{}'::jsonb)
  from jsonb_each(coalesce(p, '{}'::jsonb))
$function$
;

CREATE OR REPLACE FUNCTION fr_internal._op_receipt_begin(p_op uuid, p_entity text, p_id text, p_action text)
 RETURNS public.op_receipts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.op_receipts;
begin
  if current_setting('fr.op_id', true) is distinct from p_op::text then raise exception 'internal helper'; end if;
  select * into r from public.op_receipts where op_id = p_op;
  if r.op_id is not null then return r; end if;
  insert into public.op_receipts (op_id, actor, entity, record_id, action) values (p_op, public.my_email(), p_entity, p_id, p_action);
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION fr_internal._op_receipt_end(p_op uuid, p_result text, p_id text, p_version integer)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.op_receipts set result = p_result, record_id = coalesce(p_id, record_id), version = p_version, finished_at = now()
  where op_id = p_op and current_setting('fr.op_id', true) = p_op::text
$function$
;

CREATE OR REPLACE FUNCTION fr_internal._op_record_conflict(p_op uuid, p_entity text, p_id text, p_company text, p_base integer, p_current integer, p_fields text[], p_incoming jsonb, p_current_values jsonb)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into public.conflicts (op_id, entity, record_id, company_id, base_version, current_version, fields, incoming, current_values, actor)
  select p_op, p_entity, p_id, p_company, p_base, p_current, p_fields, fr_internal._op_mask(p_entity, p_incoming), fr_internal._op_mask(p_entity, p_current_values), public.my_email()
  where current_setting('fr.op_id', true) = p_op::text
  returning id
$function$
;

CREATE OR REPLACE FUNCTION public.accept_invite()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare e text := public.my_email();
begin
  if e = '' then raise exception 'not signed in'; end if;
  update public.members set status = 'active', joined_at = coalesce(joined_at, now()), user_id = auth.uid(), updated_at = now()
  where lower(email) = e and status = 'invited';
  delete from public.member_invites where lower(email) = e;
  update public.members set last_seen_at = now(), user_id = coalesce(user_id, auth.uid()) where lower(email) = e and status = 'active';
  return public.my_member();
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_approve(p_email text, p_company text DEFAULT NULL::text, p_role public.company_role DEFAULT 'viewer'::public.company_role, p_group_admin boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    insert into public.company_members (email, company_id, role, added_by) values (e, p_company, coalesce(p_role, 'viewer'), public.my_email())
    on conflict (email, company_id) do update set role = excluded.role;
  end if;
  return jsonb_build_object('email', e, 'status', 'active');
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_count()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(*)::int from public.members where level = 'editor' and status = 'active'
$function$
;

CREATE OR REPLACE FUNCTION public.admin_invite(p_email text, p_level public.member_level DEFAULT 'viewer'::public.member_level, p_name text DEFAULT ''::text, p_company text DEFAULT NULL::text, p_role public.company_role DEFAULT NULL::public.company_role)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare e text := lower(trim(p_email)); me text := public.my_email(); r public.members%rowtype;
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
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_remove_member(p_email text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_save_company(p_id text, p_name text, p_short text, p_active boolean DEFAULT true, p_modules text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare id text := lower(regexp_replace(trim(p_id), '[^a-z0-9]+', '-', 'g'));
begin
  if not public.is_admin() then raise exception 'Only a Group Admin can do this'; end if;
  if id = '' or (id = 'group' and p_active = false) then raise exception 'Invalid company'; end if;
  insert into public.companies (id, name, short_name, "order", active, modules)
  values (id, trim(p_name), coalesce(nullif(trim(p_short), ''), trim(p_name)), (select coalesce(max("order"), 0) + 1 from public.companies), p_active, coalesce(p_modules, array['hiring']))
  on conflict (id) do update set name = excluded.name, short_name = excluded.short_name, active = excluded.active, modules = coalesce(p_modules, public.companies.modules);
  return jsonb_build_object('id', id, 'name', trim(p_name));
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_set_company_role(p_email text, p_company text, p_role public.company_role DEFAULT NULL::public.company_role)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare e text := lower(trim(p_email)); me text := public.my_email();
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
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_set_member(p_email text, p_level public.member_level DEFAULT NULL::public.member_level, p_status public.member_status DEFAULT NULL::public.member_status)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.apply_op(p_op_id uuid, p_entity text, p_id text, p_action text, p_patch jsonb, p_base_version integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  me text := coalesce(public.my_email(), '');
  act text := lower(coalesce(p_action, ''));
  allowed text[] := array['roles','candidates','issues','staff','staff_private','staff_documents','leave_requests','press_customers','press_rate_items','press_jobs','press_payments','press_materials','press_files','customer_requests','press_material_moves','customer_request_messages'];
  insert_only text[] := array['press_material_moves','customer_request_messages'];
  protected text[] := array['id','version','op_id','deleted_at','deleted_by','delete_batch','created_at','created_by','updated_at','updated_by'];
  cols text[]; has_version boolean; patch jsonb; cur jsonb; newrow jsonb; rec public.op_receipts; sets text; collist text;
  changed text[]; clash text[]; conf uuid; n int; norm jsonb; cver int; rid text := p_id;
begin
  if me = '' then return jsonb_build_object('result', 'refused', 'message', 'Sign in first'); end if;
  if p_op_id is null then return jsonb_build_object('result', 'refused', 'message', 'Missing operation id'); end if;
  if not (p_entity = any(allowed)) then return jsonb_build_object('result', 'refused', 'message', 'This kind of record cannot be saved here'); end if;
  -- private staff details live in staff_private since 26 Oct 2026; an older screen that still sends them is refused, never silently dropped
  if p_entity = 'staff' and exists (select 1 from jsonb_each(coalesce(p_patch, '{}'::jsonb)) where key = any(array['address','date_of_birth','emergency_name','emergency_phone','notes']) and value not in ('null'::jsonb, '""'::jsonb)) then
    return jsonb_build_object('result', 'refused', 'message', 'Private staff details are now saved separately. Reload the app and try again.');
  end if;
  if act not in ('insert', 'update', 'save') or (p_entity = any(insert_only) and act <> 'insert') then
    return jsonb_build_object('result', 'refused', 'message', 'Unsupported action');
  end if;

  perform set_config('fr.op_id', p_op_id::text, true);
  begin
    rec := fr_internal._op_receipt_begin(p_op_id, p_entity, p_id, act);
  exception when unique_violation then
    return jsonb_build_object('result', 'duplicate', 'op_id', p_op_id, 'message', 'This change was already received');
  end;
  if rec.op_id is not null then
    if rec.actor <> me then return jsonb_build_object('result', 'refused', 'message', 'Operation id already used'); end if;
    perform fr_internal._op_log(p_op_id, p_entity, rec.record_id, null, 'duplicate', 'duplicate', null, rec.version, null, null, '{}'::jsonb);
    if rec.record_id is not null then execute format('select to_jsonb(t) from public.%I t where id::text = $1', p_entity) into cur using rec.record_id; end if;
    return jsonb_build_object('result', 'duplicate', 'first_result', rec.result, 'op_id', p_op_id, 'id', rec.record_id, 'version', rec.version, 'row', cur, 'message', 'This change was already received');
  end if;

  select array_agg(column_name::text) into cols from information_schema.columns where table_schema = 'public' and table_name = p_entity and is_generated = 'NEVER';
  has_version := 'version' = any(cols);
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into patch from jsonb_each(coalesce(p_patch, '{}'::jsonb)) where key = any(cols) and not (key = any(protected));
  begin
    execute format('select to_jsonb(jsonb_populate_record(null::public.%I, $1))', p_entity) into norm using patch;
  exception when others then
    perform fr_internal._op_log(p_op_id, p_entity, rid, null, 'refused', 'refused', p_base_version, null, sqlerrm, null, '{}'::jsonb);
    perform fr_internal._op_receipt_end(p_op_id, 'refused', rid, null);
    return jsonb_build_object('result', 'refused', 'op_id', p_op_id, 'message', 'A value is not valid: ' || sqlerrm);
  end;
  select coalesce(jsonb_object_agg(key, norm -> key), '{}'::jsonb) into patch from jsonb_object_keys(patch) key;
  if rid is not null then execute format('select to_jsonb(t) from public.%I t where id::text = $1', p_entity) into cur using rid; end if;
  if act = 'save' then act := case when cur is null then 'insert' else 'update' end; end if;

  if act = 'update' then
    if cur is null then
      perform fr_internal._op_log(p_op_id, p_entity, rid, null, 'refused', 'refused', p_base_version, null, 'not found or no access', null, patch);
      perform fr_internal._op_receipt_end(p_op_id, 'refused', rid, null);
      return jsonb_build_object('result', 'refused', 'op_id', p_op_id, 'message', 'This record no longer exists, or you cannot change it');
    end if;
    if cur ->> 'deleted_at' is not null then
      perform fr_internal._op_log(p_op_id, p_entity, rid, cur ->> 'company_id', 'refused', 'refused', p_base_version, (cur ->> 'version')::int, 'record is deleted', null, patch);
      perform fr_internal._op_receipt_end(p_op_id, 'refused', rid, (cur ->> 'version')::int);
      return jsonb_build_object('result', 'refused', 'op_id', p_op_id, 'message', 'This record was deleted. A Group Admin can restore it from Recently deleted.');
    end if;
    cver := (cur ->> 'version')::int;
    if has_version and p_base_version is not null and cver <> p_base_version then
      changed := fr_internal._op_changed_fields(p_entity, rid, p_base_version, cver);
      select coalesce(array_agg(key), '{}') into clash from jsonb_each(patch)
        where key <> 'history' and key = any(changed) and (cur -> key) is distinct from value;
      if coalesce(array_length(clash, 1), 0) > 0 then
        conf := fr_internal._op_record_conflict(p_op_id, p_entity, rid, cur ->> 'company_id', p_base_version, cver, clash,
                  (select jsonb_object_agg(k, patch -> k) from unnest(clash) k), (select jsonb_object_agg(k, cur -> k) from unnest(clash) k));
        perform fr_internal._op_log(p_op_id, p_entity, rid, cur ->> 'company_id', 'conflict', 'conflict', p_base_version, cver, null, jsonb_build_object('conflict_id', conf, 'fields', clash), patch);
        select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into patch from jsonb_each(patch) where not (key = any(clash));
      end if;
    end if;
    if patch ? 'history' and jsonb_typeof(patch -> 'history') = 'array' and jsonb_typeof(cur -> 'history') = 'array' then
      patch := patch || jsonb_build_object('history', (cur -> 'history') || coalesce((select jsonb_agg(e) from jsonb_array_elements(patch -> 'history') e where not exists (select 1 from jsonb_array_elements(cur -> 'history') c where c = e)), '[]'::jsonb));
    end if;
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into patch from jsonb_each(patch) where (cur -> key) is distinct from value;
    if patch = '{}'::jsonb then
      if conf is not null then
        perform fr_internal._op_receipt_end(p_op_id, 'conflict', rid, cver);
        return jsonb_build_object('result', 'conflict', 'op_id', p_op_id, 'conflict_id', conf, 'fields', clash, 'id', rid, 'version', cver, 'row', cur,
          'message', 'Someone else changed ' || array_to_string(clash, ', ') || ' on this record meanwhile. Your version was kept for a Group Admin to review; the latest is now shown.');
      end if;
      perform fr_internal._op_receipt_end(p_op_id, 'applied', rid, cver);
      return jsonb_build_object('result', 'applied', 'op_id', p_op_id, 'id', rid, 'version', cver, 'row', cur, 'message', 'No changes');
    end if;
    select string_agg(format('%I = r.%I', key, key), ', ') into sets from jsonb_object_keys(patch) key;
    begin
      execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) r where t.id::text = $2 returning to_jsonb(t)', p_entity, sets, p_entity) into newrow using patch, rid;
      get diagnostics n = row_count;
    exception when insufficient_privilege or check_violation or not_null_violation or foreign_key_violation or unique_violation or invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range or raise_exception then
      perform fr_internal._op_log(p_op_id, p_entity, rid, cur ->> 'company_id', 'refused', 'refused', p_base_version, cver, sqlerrm, null, patch);
      perform fr_internal._op_receipt_end(p_op_id, 'refused', rid, cver);
      return jsonb_build_object('result', 'refused', 'op_id', p_op_id, 'message', case when sqlstate = '42501' then 'You do not have permission to change this record' else sqlerrm end);
    end;
    if n = 0 then
      perform fr_internal._op_log(p_op_id, p_entity, rid, cur ->> 'company_id', 'refused', 'refused', p_base_version, cver, 'update blocked by access rules', null, patch);
      perform fr_internal._op_receipt_end(p_op_id, 'refused', rid, cver);
      return jsonb_build_object('result', 'refused', 'op_id', p_op_id, 'message', 'You do not have permission to change this record');
    end if;
  else
    if cur is not null then
      perform fr_internal._op_receipt_end(p_op_id, 'refused', rid, (cur ->> 'version')::int);
      return jsonb_build_object('result', 'refused', 'op_id', p_op_id, 'message', 'A record with this id already exists');
    end if;
    if rid is not null then patch := patch || jsonb_build_object('id', rid); end if;
    if patch = '{}'::jsonb then return jsonb_build_object('result', 'refused', 'message', 'Nothing to save'); end if;
    select string_agg(format('%I', key), ', ') into collist from jsonb_object_keys(patch) key;
    begin
      execute format('insert into public.%I as t (%s) select %s from jsonb_populate_record(null::public.%I, $1) returning to_jsonb(t)', p_entity, collist, collist, p_entity) into newrow using patch;
    exception when insufficient_privilege or check_violation or not_null_violation or foreign_key_violation or unique_violation or invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range or raise_exception then
      perform fr_internal._op_log(p_op_id, p_entity, rid, patch ->> 'company_id', 'refused', 'refused', null, null, sqlerrm, null, patch);
      perform fr_internal._op_receipt_end(p_op_id, 'refused', rid, null);
      return jsonb_build_object('result', 'refused', 'op_id', p_op_id, 'message', case when sqlstate = '42501' then 'You do not have permission to add this record' else sqlerrm end);
    end;
  end if;
  if conf is not null then
    perform fr_internal._op_receipt_end(p_op_id, 'conflict', rid, (newrow ->> 'version')::int);
    return jsonb_build_object('result', 'conflict', 'op_id', p_op_id, 'conflict_id', conf, 'fields', clash, 'id', rid, 'version', (newrow ->> 'version')::int, 'row', newrow,
      'message', 'Someone else changed ' || array_to_string(clash, ', ') || ' on this record meanwhile. Your other changes were saved; your ' || array_to_string(clash, ', ') || ' was kept for a Group Admin to review.');
  end if;
  perform fr_internal._op_receipt_end(p_op_id, 'applied', newrow ->> 'id', (newrow ->> 'version')::int);
  return jsonb_build_object('result', 'applied', 'op_id', p_op_id, 'action', act, 'id', newrow ->> 'id', 'version', (newrow ->> 'version')::int, 'row', newrow);
end $function$
;

CREATE OR REPLACE FUNCTION public.backup_export()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'storage'
AS $function$
declare r record; cols text; rws jsonb; tbls jsonb := '{}'::jsonb; counts jsonb := '{}'::jsonb; n int; total int := 0; sv text;
begin
  for r in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public' and c.relkind = 'r' order by c.relname loop
    if r.relname = 'app_config' then
      select coalesce(jsonb_agg(jsonb_build_object('key', a.key, 'value', case when a.key ~* '(token|secret|key|pass)' then '[REDACTED]' else a.value end, 'updated_at', a.updated_at) order by a.key), '[]'::jsonb)
        into rws from public.app_config a;
    else
      select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
        from information_schema.columns where table_schema = 'public' and table_name = r.relname
         and column_name !~* '(token|secret|password|api_key|service_key)';
      execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from (select %s from public.%I) x', cols, r.relname) into rws;
    end if;
    n := jsonb_array_length(rws); total := total + n;
    tbls := tbls || jsonb_build_object(r.relname, rws);
    counts := counts || jsonb_build_object(r.relname, n);
  end loop;
  select md5(
    coalesce((select string_agg(table_name || '.' || column_name || ':' || udt_name, ',' order by table_name, column_name) from information_schema.columns where table_schema = 'public'), '') ||
    coalesce((select string_agg(md5(pg_get_functiondef(p.oid)), ',' order by p.proname, p.oid) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '')
  ) into sv;
  return jsonb_build_object(
    'format', 'future-ready-db/1',
    'project', 'muagpehopedxycfiqupg',
    'generated_at', now(),
    'schema_version', sv,
    'table_list', (select jsonb_agg(k order by k) from jsonb_object_keys(tbls) k),
    'row_counts', counts,
    'total_rows', total,
    'tables', tbls,
    'auth_users', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'email', u.email, 'email_confirmed_at', u.email_confirmed_at,
                    'created_at', u.created_at, 'providers', u.raw_app_meta_data -> 'providers', 'full_name', u.raw_user_meta_data ->> 'full_name') order by u.created_at), '[]'::jsonb) from auth.users u),
    'storage_objects', (select coalesce(jsonb_agg(jsonb_build_object('bucket', o.bucket_id, 'name', o.name, 'size', o.metadata ->> 'size',
                    'mimetype', o.metadata ->> 'mimetype', 'created_at', o.created_at) order by o.bucket_id, o.name), '[]'::jsonb) from storage.objects o)
  );
end $function$
;

CREATE OR REPLACE FUNCTION public.backup_last_success()
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select max(finished_at) from public.sync_runs
   where status = 'success' and kind in ('rolling', 'nightly', 'monthly', 'manual') and public.my_level() is not null;
$function$
;

CREATE OR REPLACE FUNCTION public.can_manage_company(cid text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$ select coalesce(public.my_company_role(cid) in ('admin', 'manager'), false) $function$
;

CREATE OR REPLACE FUNCTION public.can_write()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$ select coalesce(public.my_level() in ('contributor','editor'), false) $function$
;

CREATE OR REPLACE FUNCTION public.can_write_company(cid text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$ select coalesce(public.my_company_role(cid) in ('admin', 'manager', 'staff'), false) $function$
;

CREATE OR REPLACE FUNCTION public.candidate_company()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  select company_id into new.company_id from public.roles where id = new.role;
  if new.company_id is null then new.company_id := 'group'; end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.check_same_company()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare parent text := tg_argv[0]; fk text := tg_argv[1]; pid text := to_jsonb(new) ->> fk; pc text; also text[];
begin
  if pid is null then return new; end if;
  if parent = 'staff' then
    select s.company_id, s.companies into pc, also from public.staff s where s.id::text = pid;
    if pc is null or new.company_id::text = pc or (tg_table_name = 'leave_requests' and new.company_id::text = any(also)) then return new; end if;
  else
    execute format('select company_id::text from public.%I where id::text = $1', parent) into pc using pid;
    if pc is null or pc = new.company_id::text then return new; end if;
  end if;
  raise exception 'This record must belong to the same company as the % it points to', replace(parent, '_', ' ');
end $function$
;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$ select coalesce(public.my_level() = 'editor', false) $function$
;

CREATE OR REPLACE FUNCTION public.is_company_admin(cid text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$ select coalesce(public.my_company_role(cid) = 'admin', false) $function$
;

CREATE OR REPLACE FUNCTION public.is_editor()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$ select coalesce(public.my_level() = 'editor', false) $function$
;

CREATE OR REPLACE FUNCTION public.issue_company()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.candidate_id is not null then select company_id into new.company_id from public.candidates where id = new.candidate_id; end if;
  if new.company_id is null then new.company_id := 'group'; end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.leave_calendar(p_company text)
 RETURNS TABLE(id uuid, staff_id uuid, staff_name text, start_date date, end_date date, days integer, status public.leave_status)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select l.id, l.staff_id, s.full_name, l.start_date, l.end_date, l.days, l.status
    from public.leave_requests l join public.staff s on s.id = l.staff_id and s.deleted_at is null
   where l.company_id = p_company and l.deleted_at is null and l.status = 'approved' and l.end_date >= current_date
     and public.my_company_role(p_company) is not null
   order by l.start_date;
$function$
;

CREATE OR REPLACE FUNCTION public.leave_decide(p_id uuid, p_status public.leave_status, p_note text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.leave_requests%rowtype; me text := public.my_email(); own boolean;
begin
  select * into r from public.leave_requests where id = p_id;
  if not found then raise exception 'No such request'; end if;
  if p_status not in ('approved', 'declined') then raise exception 'Decision must be approved or declined'; end if;
  if not public.can_manage_company(r.company_id) then raise exception 'Only an Admin or Manager of this company can decide'; end if;
  select lower(s.member_email) = me into own from public.staff s where s.id = r.staff_id;
  if coalesce(own, false) and not public.is_admin() then raise exception 'You cannot decide your own leave request'; end if;
  update public.leave_requests set status = p_status, decided_by = me, decided_at = now(), decision_note = left(coalesce(p_note, ''), 500) where id = p_id;
  return jsonb_build_object('id', p_id, 'status', p_status);
end $function$
;

CREATE OR REPLACE FUNCTION public.log_config()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me text := coalesce(nullif(public.my_email(), ''), ''); nv jsonb; ov jsonb; k text; ch jsonb := '{}'::jsonb; rid text; cid text;
  noise text[] := array['updated_at', 'last_seen_at'];
  masked text[] := case tg_table_name when 'app_config' then array['value'] when 'member_invites' then array['token'] when 'members' then array['phone'] else array[]::text[] end;
begin
  nv := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  ov := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  for k in select jsonb_object_keys(coalesce(nv, ov)) loop
    if k = any(noise) then continue; end if;
    if tg_op = 'UPDATE' and (nv -> k) is not distinct from (ov -> k) then continue; end if;
    if tg_op = 'DELETE' then continue; end if;
    ch := ch || jsonb_build_object(k, case when k = any(masked) then to_jsonb('[changed]'::text)
                                          when length((nv -> k)::text) > 2000 then to_jsonb('[large value]'::text) else nv -> k end);
  end loop;
  if tg_op = 'UPDATE' and ch = '{}'::jsonb then return null; end if;
  rid := case tg_table_name
    when 'members' then coalesce(nv, ov) ->> 'email'
    when 'member_invites' then coalesce(nv, ov) ->> 'email'
    when 'company_members' then (coalesce(nv, ov) ->> 'email') || ' @ ' || (coalesce(nv, ov) ->> 'company_id')
    when 'company_settings' then (coalesce(nv, ov) ->> 'company_id') || ' / ' || (coalesce(nv, ov) ->> 'module')
    when 'app_config' then coalesce(nv, ov) ->> 'key'
    else coalesce(nv, ov) ->> 'id' end;
  cid := case tg_table_name when 'companies' then coalesce(nv, ov) ->> 'id' else coalesce(nv, ov) ->> 'company_id' end;
  insert into public.ops_log (op_id, entity, record_id, company_id, action, result, actor, actor_uid, source, changes)
  values (coalesce(nullif(current_setting('fr.op_id', true), '')::uuid, gen_random_uuid()), tg_table_name, rid, cid, lower(tg_op), 'applied',
          coalesce(nullif(me, ''), 'service'), auth.uid(),
          case when me = '' then 'service' when current_setting('request.path', true) like '/rpc/%' then 'rpc' else 'direct' end, ch);
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public.log_op()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me text := coalesce(nullif(public.my_email(), ''), ''); act text; ch jsonb := '{}'::jsonb; k text; nv jsonb; ov jsonb; rid text; cid text;
  skip text[] := array['history', 'version', 'op_id', 'updated_at', 'updated_by', 'delete_batch'];
  secret text[] := case tg_table_name
    when 'staff' then array['phone', 'email', 'address', 'date_of_birth', 'emergency_name', 'emergency_phone', 'notes', 'photo_url']
    when 'staff_private' then array['address', 'date_of_birth', 'emergency_name', 'emergency_phone', 'notes']
    when 'leave_requests' then array['reason', 'decision_note']
    when 'staff_documents' then array['file_path', 'note']
    else array[]::text[] end;
begin
  if tg_op = 'DELETE' then
    rid := old.id::text; cid := old.company_id::text; act := 'delete';
  else
    rid := new.id::text; cid := new.company_id::text;
    nv := to_jsonb(new);
    if tg_op = 'INSERT' then
      act := 'insert';
      for k in select jsonb_object_keys(nv) loop
        if k = any(skip) or nv -> k = 'null'::jsonb then continue; end if;
        ch := ch || jsonb_build_object(k, case when k = any(secret) then to_jsonb('[set]'::text) when length((nv -> k)::text) > 2000 then to_jsonb('[large value]'::text) else nv -> k end);
      end loop;
    else
      ov := to_jsonb(old);
      act := case when old.deleted_at is null and new.deleted_at is not null then 'soft_delete'
                  when old.deleted_at is not null and new.deleted_at is null then 'restore' else 'update' end;
      for k in select jsonb_object_keys(nv) loop
        if k = any(skip) or (nv -> k) is not distinct from (ov -> k) then continue; end if;
        ch := ch || jsonb_build_object(k, case when k = any(secret) then to_jsonb('[changed]'::text) when length((nv -> k)::text) > 2000 then to_jsonb('[large value]'::text) else nv -> k end);
      end loop;
    end if;
  end if;
  insert into public.ops_log (op_id, entity, record_id, company_id, action, result, base_version, result_version, actor, actor_uid, source, changes)
  values (case when tg_op = 'DELETE' then gen_random_uuid() else new.op_id end, tg_table_name, rid, cid, act, 'applied',
          case when tg_op = 'INSERT' then null else old.version end, case when tg_op = 'DELETE' then null else new.version end,
          coalesce(nullif(me, ''), 'service'), auth.uid(),
          case when me = '' then 'service'
               when nullif(current_setting('fr.op_id', true), '') is not null then 'app'
               when current_setting('request.path', true) like '/rpc/%' then 'rpc'
               else 'direct' end, ch);
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public.my_access()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare e text := public.my_email(); m public.members%rowtype; comps jsonb;
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
end $function$
;

CREATE OR REPLACE FUNCTION public.my_company_role(cid text)
 RETURNS public.company_role
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare e text := public.my_email(); r public.company_role;
begin
  if e = '' then return null; end if;
  if exists (select 1 from public.members where lower(email) = e and status = 'active' and level = 'editor') then return 'admin'; end if;
  select cm.role into r from public.company_members cm join public.members m on lower(m.email) = lower(cm.email)
   where lower(cm.email) = e and cm.company_id = cid and m.status = 'active';
  return r;
end $function$
;

CREATE OR REPLACE FUNCTION public.my_email()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  select coalesce((select lower(u.email) from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null), $e$$e$)
$function$
;

CREATE OR REPLACE FUNCTION public.my_level()
 RETURNS public.member_level
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select level from public.members
  where lower(email) = public.my_email() and status = 'active'
$function$
;

CREATE OR REPLACE FUNCTION public.my_member()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.members%rowtype; e text := public.my_email();
begin
  if e = '' then return null; end if;
  select * into r from public.members where lower(email) = e;
  if not found then return null; end if;
  return jsonb_build_object('email', r.email, 'name', r.name, 'level', r.level, 'status', r.status, 'surname', r.surname,
    'first_name', r.first_name, 'other_names', r.other_names, 'phone', r.phone, 'position', r.position, 'photo_url', r.photo_url,
    'profile_done', r.profile_done, 'requested_level', r.requested_level, 'requested_company', r.requested_company, 'requested_role', r.requested_role,
    'joined_at', r.joined_at, 'added_at', r.added_at);
end $function$
;

CREATE OR REPLACE FUNCTION public.next_number(p_company text, p_kind text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v int;
begin
  if not public.can_write_company(p_company) then raise exception 'No write access to this company'; end if;
  insert into public.counters (company_id, kind, value) values (p_company, p_kind, 1)
  on conflict (company_id, kind) do update set value = public.counters.value + 1 returning value into v;
  return v;
end $function$
;

CREATE OR REPLACE FUNCTION public.portal_attach_file(p_request uuid, p_name text, p_path text, p_size bigint, p_mime text)
 RETURNS public.customer_request_files
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare r public.customer_request_files; co text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select company_id into co from public.customer_requests where id = p_request and user_id = auth.uid();
  if co is null then raise exception 'Request not found'; end if;
  if split_part(p_path, '/', 2) <> auth.uid()::text or split_part(p_path, '/', 3) <> p_request::text then raise exception 'File path does not belong to this request'; end if;
  insert into public.customer_request_files (request_id, company_id, name, file_path, size_bytes, mime, uploaded_by)
  values (p_request, co, left(coalesce(p_name, 'file'), 200), p_path, p_size, left(coalesce(p_mime, ''), 120), auth.uid())
  on conflict (file_path) do nothing returning * into r;
  if r.id is null then select * into r from public.customer_request_files where file_path = p_path; end if;
  return r;
end $function$
;

CREATE OR REPLACE FUNCTION public.portal_public(p_company text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'short_name', c.short_name, 'kind', c.kind, 'active', c.active,
    'settings', coalesce((select s.data from public.company_settings s where s.company_id = c.id and s.module = 'portal'), '{}'::jsonb),
    'services', coalesce((select jsonb_agg(jsonb_build_object('name', r.name, 'category', r.category, 'unit', r.unit) order by r.category, r.name)
                          from public.press_rate_items r where r.company_id = c.id and r.active), '[]'::jsonb))
  from public.companies c where c.id = p_company and c.active;
$function$
;

CREATE OR REPLACE FUNCTION public.portal_submit_request(p_company text, p_service text, p_title text, p_details text, p_quantity text, p_needed_by date, p_name text, p_phone text, p_business text, p_client_ref uuid DEFAULT NULL::uuid)
 RETURNS public.customer_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v int; r public.customer_requests; e text := lower(coalesce((select email from auth.users where id = auth.uid()), ''));
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if e = '' or not exists (select 1 from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null) then raise exception 'Confirm your email first'; end if;
  if p_client_ref is not null then
    select * into r from public.customer_requests where user_id = auth.uid() and client_ref = p_client_ref;
    if r.id is not null then return r; end if;
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
end $function$
;

CREATE OR REPLACE FUNCTION public.press_apply_move()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n int;
begin
  update public.press_materials set quantity = quantity + new.delta, updated_at = now(), updated_by = coalesce(new.moved_by, public.my_email())
   where id = new.material_id and company_id = new.company_id and deleted_at is null;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'This material is not available in this company'; end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.public_companies()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'short_name', short_name, 'active', active) order by "order"), '[]'::jsonb)
  from public.companies where active
$function$
;

CREATE OR REPLACE FUNCTION public.purge_deleted(p_batch uuid, p_confirm text)
 RETURNS public.deletions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d public.deletions; t text; me text := public.my_email();
begin
  if public.is_admin() is not true then raise exception 'Only a Group Admin can delete permanently'; end if;
  select * into d from public.deletions where id = p_batch;
  if d.id is null or d.restored_at is not null or d.purged_at is not null then raise exception 'Nothing to delete permanently'; end if;
  if trim(lower(coalesce(p_confirm, ''))) <> trim(lower(d.label)) then raise exception 'Type the name exactly to confirm'; end if;
  foreach t in array array['issues','candidates','staff_private','staff_documents','leave_requests','press_payments','press_files','roles','staff','press_jobs','press_customers','press_rate_items','press_materials','customer_requests'] loop
    execute format('delete from public.%I where delete_batch = $1', t) using p_batch;
  end loop;
  update public.deletions set purged_at = now(), purged_by = me where id = p_batch returning * into d;
  return d;
end $function$
;

CREATE OR REPLACE FUNCTION public.request_access(p_requested public.member_level DEFAULT 'viewer'::public.member_level, p_name text DEFAULT ''::text, p_company text DEFAULT NULL::text, p_role public.company_role DEFAULT 'viewer'::public.company_role)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare e text := public.my_email();
begin
  if e = '' then raise exception 'not signed in'; end if;
  if p_requested not in ('viewer', 'editor') then p_requested := 'viewer'; end if;
  if p_company is not null and not exists (select 1 from public.companies where id = p_company and active) then raise exception 'Unknown company'; end if;
  insert into public.members (email, name, level, status, requested_level, requested_company, requested_role, user_id)
  values (e, nullif(p_name, ''), 'viewer', 'pending', p_requested, p_company, p_role, auth.uid())
  on conflict (email) do nothing;
  return public.my_member();
end $function$
;

CREATE OR REPLACE FUNCTION public.request_to_quote(p_request uuid)
 RETURNS public.press_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.customer_requests; c public.press_customers; j public.press_jobs; n int; cfg jsonb; prefix text; me text := public.my_email(); sn text;
begin
  select * into r from public.customer_requests where id = p_request;
  if r.id is null then raise exception 'Request not found'; end if;
  if not public.can_write_company(r.company_id) then raise exception 'No write access to this company'; end if;
  if r.job_id is not null then select * into j from public.press_jobs where id = r.job_id; return j; end if;
  select * into c from public.press_customers where company_id = r.company_id and r.contact_email <> '' and lower(email) = r.contact_email limit 1;
  if c.id is null then
    insert into public.press_customers (company_id, name, phone, email, notes, created_by, updated_by)
    values (r.company_id, coalesce(nullif(r.contact_name, ''), r.contact_email), r.contact_phone, r.contact_email, 'From the customer portal', me, me) returning * into c;
  end if;
  select data into cfg from public.company_settings where company_id = r.company_id and module = 'press';
  select short_name into sn from public.companies where id = r.company_id;
  prefix := coalesce(nullif(cfg ->> 'prefix', ''), nullif(upper(left(regexp_replace(coalesce(sn, ''), '[^A-Za-z]', '', 'g'), 3)), ''), 'FRP');
  insert into public.counters (company_id, kind, value) values (r.company_id, 'Q', 1)
  on conflict (company_id, kind) do update set value = public.counters.value + 1 returning value into n;
  insert into public.press_jobs (company_id, number, customer_id, customer_name, title, description, stage, notes, specs, history, created_by, updated_by)
  values (r.company_id, prefix || '-Q-' || lpad(n::text, 4, '0'), c.id, c.name, r.title,
          r.details || case when r.quantity <> '' then E'\nQuantity: ' || r.quantity else '' end || case when r.needed_by is not null then E'\nNeeded by: ' || r.needed_by::text else '' end,
          'quote', 'Customer request ' || r.ref || case when r.service <> '' then ' · ' || r.service else '' end,
          jsonb_build_object('service', r.service, 'quantity', r.quantity, 'needed_by', r.needed_by, 'request_ref', r.ref),
          jsonb_build_array(jsonb_build_object('at', now(), 'by', me, 'what', 'Created from customer request ' || r.ref)), me, me)
  returning * into j;
  update public.customer_requests set job_id = j.id, customer_id = c.id, status = 'quoted', updated_at = now(), updated_by = me where id = r.id;
  return j;
end $function$
;

CREATE OR REPLACE FUNCTION public.resolve_conflict(p_conflict uuid, p_choice text, p_values jsonb DEFAULT NULL::jsonb, p_seen_version integer DEFAULT NULL::integer, p_op_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  c public.conflicts; cur jsonb; vals jsonb; r jsonb; cver int; op uuid := coalesce(p_op_id, gen_random_uuid());
  st text := case p_choice when 'keep_current' then 'kept_current' when 'take_incoming' then 'took_incoming' when 'merged' then 'merged' end;
begin
  if not coalesce(public.is_admin(), false) then return jsonb_build_object('result', 'refused', 'message', 'Only Group Admins can resolve conflicts'); end if;
  if st is null then return jsonb_build_object('result', 'refused', 'message', 'Choose Keep current, Take incoming or Edit and merge'); end if;
  select * into c from public.conflicts where id = p_conflict;
  if c.id is null then return jsonb_build_object('result', 'refused', 'message', 'Conflict not found'); end if;
  if c.status <> 'open' then
    return jsonb_build_object('result', 'duplicate', 'status', c.status, 'message', 'Already resolved by ' || coalesce(c.resolved_by, '?'));
  end if;
  execute format('select to_jsonb(t) from public.%I t where id::text = $1', c.entity) into cur using c.record_id;
  cver := (cur ->> 'version')::int;
  perform set_config('fr.op_id', op::text, true);

  if p_choice = 'keep_current' then
    perform fr_internal._conflict_close(c.id, st, jsonb_build_object('choice', p_choice, 'version', cver), op);
    perform fr_internal._op_log(op, c.entity, c.record_id, c.company_id, 'resolve', 'applied', c.current_version, cver, null,
      jsonb_build_object('conflict_id', c.id, 'choice', p_choice, 'fields', c.fields), '{}'::jsonb);
    return jsonb_build_object('result', 'applied', 'choice', p_choice, 'op_id', op, 'version', cver);
  end if;

  if cur is null then return jsonb_build_object('result', 'refused', 'message', 'This record no longer exists. Choose Keep current to close the conflict.'); end if;
  if cur ->> 'deleted_at' is not null then return jsonb_build_object('result', 'refused', 'message', 'This record was deleted. Restore it from Recently deleted first, or choose Keep current.'); end if;
  if p_seen_version is null or p_seen_version <> cver then
    return jsonb_build_object('result', 'stale', 'version', cver, 'row', cur, 'message', 'This record changed while you were looking at it. The latest values are now shown; choose again.');
  end if;

  if p_choice = 'take_incoming' then vals := c.incoming;
  else
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into vals from jsonb_each(coalesce(p_values, '{}'::jsonb)) where key = any(c.fields);
    if (select count(*) from jsonb_object_keys(vals)) <> coalesce(array_length(c.fields, 1), 0) then
      return jsonb_build_object('result', 'refused', 'message', 'Give a value for every field in conflict');
    end if;
  end if;
  if exists (select 1 from jsonb_each(vals) where value in ('"[hidden]"'::jsonb, '"[history]"'::jsonb)) then
    return jsonb_build_object('result', 'refused', 'message', 'This involves private staff details that are not stored with conflicts. Use Edit and merge and type the value, or Keep current.');
  end if;

  r := public.apply_op(op, c.entity, c.record_id, 'update', vals, cver);
  if r ->> 'result' not in ('applied', 'duplicate') then
    return jsonb_build_object('result', coalesce(r ->> 'result', 'refused'), 'message', coalesce(r ->> 'message', 'Not saved'));
  end if;
  perform set_config('fr.op_id', op::text, true);
  perform fr_internal._conflict_close(c.id, st, jsonb_build_object('choice', p_choice, 'version', (r ->> 'version')::int, 'values', fr_internal._op_mask(c.entity, vals)), op);
  perform fr_internal._op_log(op, c.entity, c.record_id, c.company_id, 'resolve', 'applied', cver, (r ->> 'version')::int, null,
    jsonb_build_object('conflict_id', c.id, 'choice', p_choice, 'fields', c.fields), vals);
  return jsonb_build_object('result', 'applied', 'choice', p_choice, 'op_id', op, 'version', (r ->> 'version')::int, 'row', r -> 'row');
end $function$
;

CREATE OR REPLACE FUNCTION public.restore_deleted(p_batch uuid)
 RETURNS public.deletions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d public.deletions; t text; parent_gone boolean := false; me text := public.my_email();
begin
  if public.is_admin() is not true then raise exception 'Only a Group Admin can restore'; end if;
  select * into d from public.deletions where id = p_batch;
  if d.id is null then raise exception 'Nothing to restore'; end if;
  if d.restored_at is not null then raise exception 'Already restored'; end if;
  if d.purged_at is not null then raise exception 'This was deleted permanently and cannot be restored'; end if;
  if d.entity = 'candidates' then select exists (select 1 from public.candidates c join public.roles r on r.id = c.role where c.id = d.record_id and r.deleted_at is not null) into parent_gone;
  elsif d.entity = 'issues' then select exists (select 1 from public.issues i join public.candidates c on c.id = i.candidate_id where i.id = d.record_id and c.deleted_at is not null) into parent_gone;
  elsif d.entity in ('staff_documents', 'leave_requests') then execute format('select exists (select 1 from public.%I x join public.staff s on s.id = x.staff_id where x.id::text = $1 and s.deleted_at is not null)', d.entity) into parent_gone using d.record_id;
  elsif d.entity in ('press_payments', 'press_files') then execute format('select exists (select 1 from public.%I x join public.press_jobs j on j.id = x.job_id where x.id::text = $1 and j.deleted_at is not null)', d.entity) into parent_gone using d.record_id;
  end if;
  if parent_gone then raise exception 'Restore the record this belongs to first'; end if;
  foreach t in array array['roles','candidates','issues','staff','staff_private','staff_documents','leave_requests','press_customers','press_rate_items','press_jobs','press_payments','press_materials','press_files','customer_requests'] loop
    execute format('update public.%I set deleted_at = null, deleted_by = null, delete_batch = null where delete_batch = $1', t) using p_batch;
  end loop;
  update public.deletions set restored_at = now(), restored_by = me where id = p_batch returning * into d;
  return d;
end $function$
;

CREATE OR REPLACE FUNCTION public.save_app_settings(p_id text, p_data jsonb)
 RETURNS public.settings
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare r public.settings;
begin
  if coalesce(public.my_email(), '') = '' then raise exception 'Sign in first'; end if;
  if p_id not in ('scoring', 'outreach', 'interviewEmail') then raise exception 'Unknown setting'; end if;
  if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Settings must be an object'; end if;
  insert into public.settings as s (id, data) values (p_id, p_data)
  on conflict (id) do update set data = excluded.data
  returning * into r;
  return r;
exception when insufficient_privilege then raise exception 'Only a Group Admin can change hiring settings' using errcode = '42501';
end $function$
;

CREATE OR REPLACE FUNCTION public.save_company_settings(p_company text, p_module text, p_data jsonb)
 RETURNS public.company_settings
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare r public.company_settings;
begin
  if coalesce(public.my_email(), '') = '' then raise exception 'Sign in first'; end if;
  if p_module not in ('press', 'portal') then raise exception 'Unknown settings area'; end if;
  if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Settings must be an object'; end if;
  insert into public.company_settings as s (company_id, module, data, updated_by, updated_at)
  values (p_company, p_module, p_data, public.my_email(), now())
  on conflict (company_id, module) do update set data = excluded.data, updated_by = excluded.updated_by, updated_at = excluded.updated_at
  returning * into r;
  return r;
exception when insufficient_privilege then raise exception 'You do not have permission to change these settings' using errcode = '42501';
end $function$
;

CREATE OR REPLACE FUNCTION public.soft_can_delete(p_entity text, p_company text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(case
    when p_entity in ('roles', 'candidates', 'issues') then public.is_admin()
    when p_entity in ('press_customers', 'press_jobs', 'press_files', 'customer_requests') then public.can_write_company(p_company)
    else public.can_manage_company(p_company)
  end, false)
$function$
;

CREATE OR REPLACE FUNCTION public.soft_delete(p_entity text, p_id text)
 RETURNS public.deletions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare cid text; already timestamptz; lbl text; n int; b uuid := gen_random_uuid(); me text := public.my_email(); ch jsonb := '{}'::jsonb; d public.deletions;
  lbl_expr text := case p_entity
    when 'roles' then 'name' when 'candidates' then 'name' when 'issues' then 'name || '': '' || issue'
    when 'staff' then 'full_name' when 'staff_documents' then 'title' when 'leave_requests' then 'kind::text || '' leave, '' || start_date || '' to '' || end_date'
    when 'press_customers' then 'name' when 'press_rate_items' then 'name' when 'press_jobs' then 'number || '' '' || title'
    when 'press_payments' then 'coalesce(receipt_no, ''payment'') || '' · '' || amount' when 'press_materials' then 'name' when 'press_files' then 'title'
    when 'customer_requests' then 'ref || '' '' || title' end;
begin
  if coalesce(me, '') = '' then raise exception 'Sign in first'; end if;
  if not coalesce(public.soft_entity_ok(p_entity), false) then raise exception 'This kind of record cannot be deleted here'; end if;
  execute format('select company_id::text, deleted_at, coalesce((%s)::text, '''') from public.%I where id::text = $1', lbl_expr, p_entity) into cid, already, lbl using p_id;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Record not found'; end if;
  if already is not null then raise exception 'Already deleted'; end if;
  if public.soft_can_delete(p_entity, cid) is not true then raise exception 'You do not have permission to delete this'; end if;
  execute format('update public.%I set deleted_at = now(), deleted_by = $1, delete_batch = $2 where id::text = $3', p_entity) using me, b, p_id;
  if p_entity = 'roles' then
    update public.issues set deleted_at = now(), deleted_by = me, delete_batch = b where deleted_at is null and candidate_id in (select id from public.candidates where role = p_id and deleted_at is null);
    get diagnostics n = row_count; if n > 0 then ch := ch || jsonb_build_object('issues', n); end if;
    update public.candidates set deleted_at = now(), deleted_by = me, delete_batch = b where role = p_id and deleted_at is null;
    get diagnostics n = row_count; if n > 0 then ch := ch || jsonb_build_object('candidates', n); end if;
  elsif p_entity = 'candidates' then
    update public.issues set deleted_at = now(), deleted_by = me, delete_batch = b where candidate_id = p_id and deleted_at is null;
    get diagnostics n = row_count; if n > 0 then ch := ch || jsonb_build_object('issues', n); end if;
  elsif p_entity = 'staff' then
    update public.staff_documents set deleted_at = now(), deleted_by = me, delete_batch = b where staff_id::text = p_id and deleted_at is null;
    get diagnostics n = row_count; if n > 0 then ch := ch || jsonb_build_object('staff_documents', n); end if;
    update public.staff_private set deleted_at = now(), deleted_by = me, delete_batch = b where id::text = p_id and deleted_at is null;
    update public.leave_requests set deleted_at = now(), deleted_by = me, delete_batch = b where staff_id::text = p_id and deleted_at is null;
    get diagnostics n = row_count; if n > 0 then ch := ch || jsonb_build_object('leave_requests', n); end if;
  elsif p_entity = 'press_jobs' then
    update public.press_payments set deleted_at = now(), deleted_by = me, delete_batch = b where job_id::text = p_id and deleted_at is null;
    get diagnostics n = row_count; if n > 0 then ch := ch || jsonb_build_object('press_payments', n); end if;
    update public.press_files set deleted_at = now(), deleted_by = me, delete_batch = b where job_id::text = p_id and deleted_at is null;
    get diagnostics n = row_count; if n > 0 then ch := ch || jsonb_build_object('press_files', n); end if;
  end if;
  insert into public.deletions (id, entity, record_id, label, company_id, children, deleted_by)
  values (b, p_entity, p_id, left(lbl, 200), cid, ch, me) returning * into d;
  return d;
end $function$
;

CREATE OR REPLACE FUNCTION public.soft_entity_ok(p_entity text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select p_entity = any (array['roles','candidates','issues','staff','staff_documents','leave_requests','press_customers','press_rate_items','press_jobs','press_payments','press_materials','press_files','customer_requests'])
$function$
;

CREATE OR REPLACE FUNCTION public.staff_private_company()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  select s.company_id into new.company_id from public.staff s where s.id = new.id;
  if new.company_id is null then raise exception 'No staff record for these private details'; end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.stamp_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.sync_job_customer_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.name is distinct from old.name then
    update public.press_jobs set customer_name = new.name where customer_id = new.id and customer_name is distinct from new.name;
  end if;
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public.touch_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at := now(); new.updated_by := lower(coalesce(nullif(public.my_email(), ''), new.updated_by));
  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, public.my_email()); end if;
  if tg_table_name = 'staff' then new.full_name := trim(concat_ws(' ', nullif(new.first_name, ''), nullif(new.other_names, ''), nullif(new.surname, ''))); end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin new.updated_at = now(); return new; end $function$
;

CREATE OR REPLACE FUNCTION public.update_my_profile(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare e text := public.my_email(); fullname text;
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
end $function$
;

-- defaults that use the functions above

alter table public.company_members alter column role set default 'viewer'::public.company_role;
alter table public.customer_requests alter column status set default 'new'::public.request_status;
alter table public.leave_requests alter column kind set default 'annual'::public.leave_kind;
alter table public.leave_requests alter column status set default 'pending'::public.leave_status;
alter table public.members alter column level set default 'viewer'::public.member_level;
alter table public.members alter column status set default 'active'::public.member_status;
alter table public.press_jobs alter column stage set default 'quote'::public.press_stage;
alter table public.press_payments alter column method set default 'cash'::public.pay_method;
alter table public.staff alter column employment_type set default 'full_time'::public.employment_type;
alter table public.staff alter column status set default 'active'::public.staff_status;

-- who may call each function

revoke all on function fr_internal._conflict_close(uuid,text,jsonb,uuid) from public, anon, authenticated; grant execute on function fr_internal._conflict_close(uuid,text,jsonb,uuid) to authenticated;
revoke all on function fr_internal._op_changed_fields(text,text,integer,integer) from public, anon, authenticated; grant execute on function fr_internal._op_changed_fields(text,text,integer,integer) to authenticated;
revoke all on function fr_internal._op_log(uuid,text,text,text,text,text,integer,integer,text,jsonb,jsonb) from public, anon, authenticated; grant execute on function fr_internal._op_log(uuid,text,text,text,text,text,integer,integer,text,jsonb,jsonb) to authenticated;
revoke all on function fr_internal._op_mask(text,jsonb) from public, anon, authenticated; grant execute on function fr_internal._op_mask(text,jsonb) to authenticated;
revoke all on function fr_internal._op_receipt_begin(uuid,text,text,text) from public, anon, authenticated; grant execute on function fr_internal._op_receipt_begin(uuid,text,text,text) to authenticated;
revoke all on function fr_internal._op_receipt_end(uuid,text,text,integer) from public, anon, authenticated; grant execute on function fr_internal._op_receipt_end(uuid,text,text,integer) to authenticated;
revoke all on function fr_internal._op_record_conflict(uuid,text,text,text,integer,integer,text[],jsonb,jsonb) from public, anon, authenticated; grant execute on function fr_internal._op_record_conflict(uuid,text,text,text,integer,integer,text[],jsonb,jsonb) to authenticated;
revoke all on function public.accept_invite() from public, anon, authenticated; grant execute on function public.accept_invite() to authenticated; grant execute on function public.accept_invite() to service_role;
revoke all on function public.admin_approve(text,text,public.company_role,boolean) from public, anon, authenticated; grant execute on function public.admin_approve(text,text,public.company_role,boolean) to authenticated; grant execute on function public.admin_approve(text,text,public.company_role,boolean) to service_role;
revoke all on function public.admin_count() from public, anon, authenticated; grant execute on function public.admin_count() to authenticated; grant execute on function public.admin_count() to service_role;
revoke all on function public.admin_invite(text,public.member_level,text,text,public.company_role) from public, anon, authenticated; grant execute on function public.admin_invite(text,public.member_level,text,text,public.company_role) to authenticated; grant execute on function public.admin_invite(text,public.member_level,text,text,public.company_role) to service_role;
revoke all on function public.admin_remove_member(text) from public, anon, authenticated; grant execute on function public.admin_remove_member(text) to authenticated; grant execute on function public.admin_remove_member(text) to service_role;
revoke all on function public.admin_save_company(text,text,text,boolean,text[]) from public, anon, authenticated; grant execute on function public.admin_save_company(text,text,text,boolean,text[]) to authenticated; grant execute on function public.admin_save_company(text,text,text,boolean,text[]) to service_role;
revoke all on function public.admin_set_company_role(text,text,public.company_role) from public, anon, authenticated; grant execute on function public.admin_set_company_role(text,text,public.company_role) to authenticated; grant execute on function public.admin_set_company_role(text,text,public.company_role) to service_role;
revoke all on function public.admin_set_member(text,public.member_level,public.member_status) from public, anon, authenticated; grant execute on function public.admin_set_member(text,public.member_level,public.member_status) to authenticated; grant execute on function public.admin_set_member(text,public.member_level,public.member_status) to service_role;
revoke all on function public.apply_op(uuid,text,text,text,jsonb,integer) from public, anon, authenticated; grant execute on function public.apply_op(uuid,text,text,text,jsonb,integer) to authenticated; grant execute on function public.apply_op(uuid,text,text,text,jsonb,integer) to service_role;
revoke all on function public.backup_export() from public, anon, authenticated; grant execute on function public.backup_export() to service_role;
revoke all on function public.backup_last_success() from public, anon, authenticated; grant execute on function public.backup_last_success() to authenticated; grant execute on function public.backup_last_success() to service_role;
revoke all on function public.can_manage_company(text) from public, anon, authenticated; grant execute on function public.can_manage_company(text) to authenticated; grant execute on function public.can_manage_company(text) to service_role;
revoke all on function public.can_write() from public, anon, authenticated; grant execute on function public.can_write() to authenticated; grant execute on function public.can_write() to anon; grant execute on function public.can_write() to service_role; grant execute on function public.can_write() to public;
revoke all on function public.can_write_company(text) from public, anon, authenticated; grant execute on function public.can_write_company(text) to authenticated; grant execute on function public.can_write_company(text) to service_role;
revoke all on function public.candidate_company() from public, anon, authenticated; grant execute on function public.candidate_company() to authenticated; grant execute on function public.candidate_company() to anon; grant execute on function public.candidate_company() to service_role; grant execute on function public.candidate_company() to public;
revoke all on function public.check_same_company() from public, anon, authenticated; grant execute on function public.check_same_company() to service_role;
revoke all on function public.is_admin() from public, anon, authenticated; grant execute on function public.is_admin() to authenticated; grant execute on function public.is_admin() to service_role;
revoke all on function public.is_company_admin(text) from public, anon, authenticated; grant execute on function public.is_company_admin(text) to authenticated; grant execute on function public.is_company_admin(text) to service_role;
revoke all on function public.is_editor() from public, anon, authenticated; grant execute on function public.is_editor() to authenticated; grant execute on function public.is_editor() to anon; grant execute on function public.is_editor() to service_role; grant execute on function public.is_editor() to public;
revoke all on function public.issue_company() from public, anon, authenticated; grant execute on function public.issue_company() to authenticated; grant execute on function public.issue_company() to anon; grant execute on function public.issue_company() to service_role; grant execute on function public.issue_company() to public;
revoke all on function public.leave_calendar(text) from public, anon, authenticated; grant execute on function public.leave_calendar(text) to authenticated; grant execute on function public.leave_calendar(text) to service_role;
revoke all on function public.leave_decide(uuid,public.leave_status,text) from public, anon, authenticated; grant execute on function public.leave_decide(uuid,public.leave_status,text) to authenticated; grant execute on function public.leave_decide(uuid,public.leave_status,text) to service_role;
revoke all on function public.log_config() from public, anon, authenticated; grant execute on function public.log_config() to service_role;
revoke all on function public.log_op() from public, anon, authenticated; grant execute on function public.log_op() to service_role;
revoke all on function public.my_access() from public, anon, authenticated; grant execute on function public.my_access() to authenticated; grant execute on function public.my_access() to service_role;
revoke all on function public.my_company_role(text) from public, anon, authenticated; grant execute on function public.my_company_role(text) to authenticated; grant execute on function public.my_company_role(text) to service_role;
revoke all on function public.my_email() from public, anon, authenticated; grant execute on function public.my_email() to authenticated; grant execute on function public.my_email() to service_role;
revoke all on function public.my_level() from public, anon, authenticated; grant execute on function public.my_level() to authenticated; grant execute on function public.my_level() to service_role;
revoke all on function public.my_member() from public, anon, authenticated; grant execute on function public.my_member() to authenticated; grant execute on function public.my_member() to service_role;
revoke all on function public.next_number(text,text) from public, anon, authenticated; grant execute on function public.next_number(text,text) to authenticated; grant execute on function public.next_number(text,text) to service_role;
revoke all on function public.portal_attach_file(uuid,text,text,bigint,text) from public, anon, authenticated; grant execute on function public.portal_attach_file(uuid,text,text,bigint,text) to authenticated; grant execute on function public.portal_attach_file(uuid,text,text,bigint,text) to service_role;
revoke all on function public.portal_public(text) from public, anon, authenticated; grant execute on function public.portal_public(text) to authenticated; grant execute on function public.portal_public(text) to anon; grant execute on function public.portal_public(text) to service_role; grant execute on function public.portal_public(text) to public;
revoke all on function public.portal_submit_request(text,text,text,text,text,date,text,text,text,uuid) from public, anon, authenticated; grant execute on function public.portal_submit_request(text,text,text,text,text,date,text,text,text,uuid) to authenticated; grant execute on function public.portal_submit_request(text,text,text,text,text,date,text,text,text,uuid) to service_role;
revoke all on function public.press_apply_move() from public, anon, authenticated; grant execute on function public.press_apply_move() to service_role;
revoke all on function public.public_companies() from public, anon, authenticated; grant execute on function public.public_companies() to authenticated; grant execute on function public.public_companies() to service_role;
revoke all on function public.purge_deleted(uuid,text) from public, anon, authenticated; grant execute on function public.purge_deleted(uuid,text) to authenticated; grant execute on function public.purge_deleted(uuid,text) to service_role;
revoke all on function public.request_access(public.member_level,text,text,public.company_role) from public, anon, authenticated; grant execute on function public.request_access(public.member_level,text,text,public.company_role) to authenticated; grant execute on function public.request_access(public.member_level,text,text,public.company_role) to service_role;
revoke all on function public.request_to_quote(uuid) from public, anon, authenticated; grant execute on function public.request_to_quote(uuid) to authenticated; grant execute on function public.request_to_quote(uuid) to service_role;
revoke all on function public.resolve_conflict(uuid,text,jsonb,integer,uuid) from public, anon, authenticated; grant execute on function public.resolve_conflict(uuid,text,jsonb,integer,uuid) to authenticated; grant execute on function public.resolve_conflict(uuid,text,jsonb,integer,uuid) to service_role;
revoke all on function public.restore_deleted(uuid) from public, anon, authenticated; grant execute on function public.restore_deleted(uuid) to authenticated; grant execute on function public.restore_deleted(uuid) to service_role;
revoke all on function public.save_app_settings(text,jsonb) from public, anon, authenticated; grant execute on function public.save_app_settings(text,jsonb) to authenticated; grant execute on function public.save_app_settings(text,jsonb) to service_role;
revoke all on function public.save_company_settings(text,text,jsonb) from public, anon, authenticated; grant execute on function public.save_company_settings(text,text,jsonb) to authenticated; grant execute on function public.save_company_settings(text,text,jsonb) to service_role;
revoke all on function public.soft_can_delete(text,text) from public, anon, authenticated; grant execute on function public.soft_can_delete(text,text) to service_role;
revoke all on function public.soft_delete(text,text) from public, anon, authenticated; grant execute on function public.soft_delete(text,text) to authenticated; grant execute on function public.soft_delete(text,text) to service_role;
revoke all on function public.soft_entity_ok(text) from public, anon, authenticated; grant execute on function public.soft_entity_ok(text) to service_role;
revoke all on function public.staff_private_company() from public, anon, authenticated; grant execute on function public.staff_private_company() to service_role;
revoke all on function public.stamp_row() from public, anon, authenticated; grant execute on function public.stamp_row() to authenticated; grant execute on function public.stamp_row() to anon; grant execute on function public.stamp_row() to service_role; grant execute on function public.stamp_row() to public;
revoke all on function public.sync_job_customer_name() from public, anon, authenticated; grant execute on function public.sync_job_customer_name() to service_role;
revoke all on function public.touch_row() from public, anon, authenticated; grant execute on function public.touch_row() to authenticated; grant execute on function public.touch_row() to anon; grant execute on function public.touch_row() to service_role; grant execute on function public.touch_row() to public;
revoke all on function public.touch_updated_at() from public, anon, authenticated; grant execute on function public.touch_updated_at() to authenticated; grant execute on function public.touch_updated_at() to anon; grant execute on function public.touch_updated_at() to service_role; grant execute on function public.touch_updated_at() to public;
revoke all on function public.update_my_profile(jsonb) from public, anon, authenticated; grant execute on function public.update_my_profile(jsonb) to authenticated; grant execute on function public.update_my_profile(jsonb) to service_role;

-- triggers

CREATE TRIGGER zz_log_config AFTER INSERT OR DELETE OR UPDATE ON public.app_config FOR EACH ROW EXECUTE FUNCTION public.log_config();
CREATE TRIGGER candidates_company BEFORE INSERT OR UPDATE OF role ON public.candidates FOR EACH ROW EXECUTE FUNCTION public.candidate_company();
CREATE TRIGGER candidates_touch BEFORE UPDATE ON public.candidates FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER zz_log_op AFTER INSERT OR DELETE OR UPDATE ON public.candidates FOR EACH ROW EXECUTE FUNCTION public.log_op();
CREATE TRIGGER zz_stamp_row BEFORE INSERT OR UPDATE ON public.candidates FOR EACH ROW EXECUTE FUNCTION public.stamp_row();
CREATE TRIGGER zz_log_config AFTER INSERT OR DELETE OR UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.log_config();
CREATE TRIGGER zz_log_config AFTER INSERT OR DELETE OR UPDATE ON public.company_members FOR EACH ROW EXECUTE FUNCTION public.log_config();
CREATE TRIGGER zz_log_config AFTER INSERT OR DELETE OR UPDATE ON public.company_settings FOR EACH ROW EXECUTE FUNCTION public.log_config();
CREATE TRIGGER a_same_company_request BEFORE INSERT OR UPDATE OF request_id, company_id ON public.customer_request_files FOR EACH ROW EXECUTE FUNCTION public.check_same_company('customer_requests', 'request_id');
CREATE TRIGGER a_same_company_request BEFORE INSERT OR UPDATE OF request_id, company_id ON public.customer_request_messages FOR EACH ROW EXECUTE FUNCTION public.check_same_company('customer_requests', 'request_id');
CREATE TRIGGER a_same_company_customer BEFORE INSERT OR UPDATE OF customer_id, company_id ON public.customer_requests FOR EACH ROW EXECUTE FUNCTION public.check_same_company('press_customers', 'customer_id');
CREATE TRIGGER a_same_company_job BEFORE INSERT OR UPDATE OF job_id, company_id ON public.customer_requests FOR EACH ROW EXECUTE FUNCTION public.check_same_company('press_jobs', 'job_id');
CREATE TRIGGER zz_log_op AFTER INSERT OR DELETE OR UPDATE ON public.customer_requests FOR EACH ROW EXECUTE FUNCTION public.log_op();
CREATE TRIGGER zz_stamp_row BEFORE INSERT OR UPDATE ON public.customer_requests FOR EACH ROW EXECUTE FUNCTION public.stamp_row();
CREATE TRIGGER issues_company BEFORE INSERT OR UPDATE OF candidate_id ON public.issues FOR EACH ROW EXECUTE FUNCTION public.issue_company();
CREATE TRIGGER zz_log_op AFTER INSERT OR DELETE OR UPDATE ON public.issues FOR EACH ROW EXECUTE FUNCTION public.log_op();
CREATE TRIGGER zz_stamp_row BEFORE INSERT OR UPDATE ON public.issues FOR EACH ROW EXECUTE FUNCTION public.stamp_row();
CREATE TRIGGER a_same_company_staff BEFORE INSERT OR UPDATE OF staff_id, company_id ON public.leave_requests FOR EACH ROW EXECUTE FUNCTION public.check_same_company('staff', 'staff_id');
CREATE TRIGGER zz_log_op AFTER INSERT OR DELETE OR UPDATE ON public.leave_requests FOR EACH ROW EXECUTE FUNCTION public.log_op();
CREATE TRIGGER zz_stamp_row BEFORE INSERT OR UPDATE ON public.leave_requests FOR EACH ROW EXECUTE FUNCTION public.stamp_row();
CREATE TRIGGER zz_log_config AFTER INSERT OR DELETE OR UPDATE ON public.member_invites FOR EACH ROW EXECUTE FUNCTION public.log_config();
CREATE TRIGGER zz_log_config AFTER INSERT OR DELETE OR UPDATE ON public.members FOR EACH ROW EXECUTE FUNCTION public.log_config();
CREATE TRIGGER press_customers_touch BEFORE INSERT OR UPDATE ON public.press_customers FOR EACH ROW EXECUTE FUNCTION public.touch_row();
CREATE TRIGGER sync_job_customer_name AFTER UPDATE OF name ON public.press_customers FOR EACH ROW EXECUTE FUNCTION public.sync_job_customer_name();
CREATE TRIGGER zz_log_op AFTER INSERT OR DELETE OR UPDATE ON public.press_customers FOR EACH ROW EXECUTE FUNCTION public.log_op();
CREATE TRIGGER zz_stamp_row BEFORE INSERT OR UPDATE ON public.press_customers FOR EACH ROW EXECUTE FUNCTION public.stamp_row();
CREATE TRIGGER a_same_company_job BEFORE INSERT OR UPDATE OF job_id, company_id ON public.press_files FOR EACH ROW EXECUTE FUNCTION public.check_same_company('press_jobs', 'job_id');
CREATE TRIGGER zz_log_op AFTER INSERT OR DELETE OR UPDATE ON public.press_files FOR EACH ROW EXECUTE FUNCTION public.log_op();
CREATE TRIGGER zz_stamp_row BEFORE INSERT OR UPDATE ON public.press_files FOR EACH ROW EXECUTE FUNCTION public.stamp_row();
CREATE TRIGGER a_same_company_customer BEFORE INSERT OR UPDATE OF customer_id, company_id ON public.press_jobs FOR EACH ROW EXECUTE FUNCTION public.check_same_company('press_customers', 'customer_id');
CREATE TRIGGER press_jobs_touch BEFORE INSERT OR UPDATE ON public.press_jobs FOR EACH ROW EXECUTE FUNCTION public.touch_row();
CREATE TRIGGER zz_log_op AFTER INSERT OR DELETE OR UPDATE ON public.press_jobs FOR EACH ROW EXECUTE FUNCTION public.log_op();
CREATE TRIGGER zz_stamp_row BEFORE INSERT OR UPDATE ON public.press_jobs FOR EACH ROW EXECUTE FUNCTION public.stamp_row();
CREATE TRIGGER a_same_company_job BEFORE INSERT OR UPDATE OF job_id, company_id ON public.press_material_moves FOR EACH ROW EXECUTE FUNCTION public.check_same_company('press_jobs', 'job_id');
CREATE TRIGGER a_same_company_material BEFORE INSERT OR UPDATE OF material_id, company_id ON public.press_material_moves FOR EACH ROW EXECUTE FUNCTION public.check_same_company('press_materials', 'material_id');
CREATE TRIGGER press_material_moves_apply AFTER INSERT ON public.press_material_moves FOR EACH ROW EXECUTE FUNCTION public.press_apply_move();
CREATE TRIGGER zz_log_op AFTER INSERT OR DELETE OR UPDATE ON public.press_materials FOR EACH ROW EXECUTE FUNCTION public.log_op();
CREATE TRIGGER zz_stamp_row BEFORE INSERT OR UPDATE ON public.press_materials FOR EACH ROW EXECUTE FUNCTION public.stamp_row();
CREATE TRIGGER a_same_company_job BEFORE INSERT OR UPDATE OF job_id, company_id ON public.press_payments FOR EACH ROW EXECUTE FUNCTION public.check_same_company('press_jobs', 'job_id');
CREATE TRIGGER zz_log_op AFTER INSERT OR DELETE OR UPDATE ON public.press_payments FOR EACH ROW EXECUTE FUNCTION public.log_op();
CREATE TRIGGER zz_stamp_row BEFORE INSERT OR UPDATE ON public.press_payments FOR EACH ROW EXECUTE FUNCTION public.stamp_row();
CREATE TRIGGER zz_log_op AFTER INSERT OR DELETE OR UPDATE ON public.press_rate_items FOR EACH ROW EXECUTE FUNCTION public.log_op();
CREATE TRIGGER zz_stamp_row BEFORE INSERT OR UPDATE ON public.press_rate_items FOR EACH ROW EXECUTE FUNCTION public.stamp_row();
CREATE TRIGGER zz_log_op AFTER INSERT OR DELETE OR UPDATE ON public.roles FOR EACH ROW EXECUTE FUNCTION public.log_op();
CREATE TRIGGER zz_stamp_row BEFORE INSERT OR UPDATE ON public.roles FOR EACH ROW EXECUTE FUNCTION public.stamp_row();
CREATE TRIGGER settings_touch BEFORE UPDATE ON public.settings FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER zz_log_config AFTER INSERT OR DELETE OR UPDATE ON public.settings FOR EACH ROW EXECUTE FUNCTION public.log_config();
CREATE TRIGGER staff_touch BEFORE INSERT OR UPDATE ON public.staff FOR EACH ROW EXECUTE FUNCTION public.touch_row();
CREATE TRIGGER zz_log_op AFTER INSERT OR DELETE OR UPDATE ON public.staff FOR EACH ROW EXECUTE FUNCTION public.log_op();
CREATE TRIGGER zz_stamp_row BEFORE INSERT OR UPDATE ON public.staff FOR EACH ROW EXECUTE FUNCTION public.stamp_row();
CREATE TRIGGER a_same_company_staff BEFORE INSERT OR UPDATE OF staff_id, company_id ON public.staff_documents FOR EACH ROW EXECUTE FUNCTION public.check_same_company('staff', 'staff_id');
CREATE TRIGGER zz_log_op AFTER INSERT OR DELETE OR UPDATE ON public.staff_documents FOR EACH ROW EXECUTE FUNCTION public.log_op();
CREATE TRIGGER zz_stamp_row BEFORE INSERT OR UPDATE ON public.staff_documents FOR EACH ROW EXECUTE FUNCTION public.stamp_row();
CREATE TRIGGER staff_private_company BEFORE INSERT OR UPDATE ON public.staff_private FOR EACH ROW EXECUTE FUNCTION public.staff_private_company();
CREATE TRIGGER zz_log_op AFTER INSERT OR DELETE OR UPDATE ON public.staff_private FOR EACH ROW EXECUTE FUNCTION public.log_op();
CREATE TRIGGER zz_stamp_row BEFORE INSERT OR UPDATE ON public.staff_private FOR EACH ROW EXECUTE FUNCTION public.stamp_row();

-- row-level security

alter table public.app_config enable row level security;
alter table public.candidates enable row level security;
alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.company_settings enable row level security;
alter table public.conflicts enable row level security;
alter table public.counters enable row level security;
alter table public.customer_request_files enable row level security;
alter table public.customer_request_messages enable row level security;
alter table public.customer_requests enable row level security;
alter table public.deletions enable row level security;
alter table public.issues enable row level security;
alter table public.leave_requests enable row level security;
alter table public.member_invites enable row level security;
alter table public.members enable row level security;
alter table public.op_receipts enable row level security;
alter table public.ops_log enable row level security;
alter table public.portal_profiles enable row level security;
alter table public.press_customers enable row level security;
alter table public.press_files enable row level security;
alter table public.press_jobs enable row level security;
alter table public.press_material_moves enable row level security;
alter table public.press_materials enable row level security;
alter table public.press_payments enable row level security;
alter table public.press_rate_items enable row level security;
alter table public.roles enable row level security;
alter table public.settings enable row level security;
alter table public.staff enable row level security;
alter table public.staff_documents enable row level security;
alter table public.staff_private enable row level security;
alter table public.sync_runs enable row level security;

create policy candidates_hide_deleted on public.candidates as RESTRICTIVE for SELECT to authenticated using (((deleted_at IS NULL) OR public.is_admin()));
create policy candidates_no_hard_delete on public.candidates as RESTRICTIVE for DELETE to authenticated using (public.is_admin());
create policy candidates_read on public.candidates as PERMISSIVE for SELECT to authenticated using (public.is_admin());
create policy candidates_write on public.candidates as PERMISSIVE for ALL to authenticated using (public.is_admin()) with check (public.is_admin());
create policy companies_read on public.companies as PERMISSIVE for SELECT to authenticated using ((public.my_level() IS NOT NULL));
create policy company_members_read on public.company_members as PERMISSIVE for SELECT to authenticated using ((public.my_level() IS NOT NULL));
create policy company_settings_read on public.company_settings as PERMISSIVE for SELECT to authenticated using ((public.my_company_role(company_id) IS NOT NULL));
create policy company_settings_write on public.company_settings as PERMISSIVE for ALL to authenticated using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));
create policy conflicts_read on public.conflicts as PERMISSIVE for SELECT to authenticated using ((public.is_admin() OR (actor = public.my_email())));
create policy crf_customer_insert on public.customer_request_files as PERMISSIVE for INSERT to authenticated with check (((uploaded_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.customer_requests r
  WHERE ((r.id = customer_request_files.request_id) AND (r.user_id = auth.uid()) AND (r.company_id = customer_request_files.company_id))))));
create policy crf_customer_read on public.customer_request_files as PERMISSIVE for SELECT to authenticated using ((EXISTS ( SELECT 1
   FROM public.customer_requests r
  WHERE ((r.id = customer_request_files.request_id) AND (r.user_id = auth.uid())))));
create policy crf_staff_read on public.customer_request_files as PERMISSIVE for SELECT to authenticated using ((public.my_company_role(company_id) IS NOT NULL));
create policy crm_customer_insert on public.customer_request_messages as PERMISSIVE for INSERT to authenticated with check (((author = 'customer'::text) AND (EXISTS ( SELECT 1
   FROM public.customer_requests r
  WHERE ((r.id = customer_request_messages.request_id) AND (r.user_id = auth.uid()) AND (r.company_id = customer_request_messages.company_id))))));
create policy crm_customer_read on public.customer_request_messages as PERMISSIVE for SELECT to authenticated using ((EXISTS ( SELECT 1
   FROM public.customer_requests r
  WHERE ((r.id = customer_request_messages.request_id) AND (r.user_id = auth.uid())))));
create policy crm_staff_insert on public.customer_request_messages as PERMISSIVE for INSERT to authenticated with check (((author = 'staff'::text) AND public.can_write_company(company_id)));
create policy crm_staff_read on public.customer_request_messages as PERMISSIVE for SELECT to authenticated using ((public.my_company_role(company_id) IS NOT NULL));
create policy cr_customer_read on public.customer_requests as PERMISSIVE for SELECT to authenticated using ((user_id = auth.uid()));
create policy cr_staff_read on public.customer_requests as PERMISSIVE for SELECT to authenticated using ((public.my_company_role(company_id) IS NOT NULL));
create policy cr_staff_write on public.customer_requests as PERMISSIVE for UPDATE to authenticated using (public.can_write_company(company_id)) with check (public.can_write_company(company_id));
create policy customer_requests_hide_deleted on public.customer_requests as RESTRICTIVE for SELECT to authenticated using (((deleted_at IS NULL) OR public.is_admin()));
create policy customer_requests_no_hard_delete on public.customer_requests as RESTRICTIVE for DELETE to authenticated using (public.is_admin());
create policy deletions_admin_read on public.deletions as PERMISSIVE for SELECT to authenticated using (public.is_admin());
create policy issues_hide_deleted on public.issues as RESTRICTIVE for SELECT to authenticated using (((deleted_at IS NULL) OR public.is_admin()));
create policy issues_no_hard_delete on public.issues as RESTRICTIVE for DELETE to authenticated using (public.is_admin());
create policy issues_read on public.issues as PERMISSIVE for SELECT to authenticated using (public.is_admin());
create policy issues_write on public.issues as PERMISSIVE for ALL to authenticated using (public.is_admin()) with check (public.is_admin());
create policy leave_cancel_own on public.leave_requests as PERMISSIVE for UPDATE to authenticated using (((status = 'pending'::public.leave_status) AND (lower(requested_by) = public.my_email()))) with check ((status = 'cancelled'::public.leave_status));
create policy leave_insert on public.leave_requests as PERMISSIVE for INSERT to authenticated with check ((public.can_manage_company(company_id) OR (EXISTS ( SELECT 1
   FROM public.staff s
  WHERE ((s.id = leave_requests.staff_id) AND (lower(s.member_email) = public.my_email()))))));
create policy leave_read on public.leave_requests as PERMISSIVE for SELECT to public using ((public.can_manage_company(company_id) OR (lower(requested_by) = public.my_email()) OR (EXISTS ( SELECT 1
   FROM public.staff s
  WHERE ((s.id = leave_requests.staff_id) AND (lower(s.member_email) = public.my_email()))))));
create policy leave_requests_hide_deleted on public.leave_requests as RESTRICTIVE for SELECT to authenticated using (((deleted_at IS NULL) OR public.is_admin()));
create policy leave_requests_no_hard_delete on public.leave_requests as RESTRICTIVE for DELETE to authenticated using (public.is_admin());
create policy members_read on public.members as PERMISSIVE for SELECT to authenticated using ((public.my_level() IS NOT NULL));
create policy ops_log_admin_read on public.ops_log as PERMISSIVE for SELECT to authenticated using (public.is_admin());
create policy portal_profiles_own on public.portal_profiles as PERMISSIVE for ALL to authenticated using ((user_id = auth.uid())) with check ((user_id = auth.uid()));
create policy portal_profiles_staff_read on public.portal_profiles as PERMISSIVE for SELECT to authenticated using ((EXISTS ( SELECT 1
   FROM public.customer_requests r
  WHERE ((r.user_id = portal_profiles.user_id) AND (public.my_company_role(r.company_id) IS NOT NULL)))));
create policy press_customers_hide_deleted on public.press_customers as RESTRICTIVE for SELECT to authenticated using (((deleted_at IS NULL) OR public.is_admin()));
create policy press_customers_no_hard_delete on public.press_customers as RESTRICTIVE for DELETE to authenticated using (public.is_admin());
create policy press_customers_read on public.press_customers as PERMISSIVE for SELECT to authenticated using ((public.my_company_role(company_id) IS NOT NULL));
create policy press_customers_write on public.press_customers as PERMISSIVE for ALL to authenticated using (public.can_write_company(company_id)) with check (public.can_write_company(company_id));
create policy press_files_hide_deleted on public.press_files as RESTRICTIVE for SELECT to authenticated using (((deleted_at IS NULL) OR public.is_admin()));
create policy press_files_no_hard_delete on public.press_files as RESTRICTIVE for DELETE to authenticated using (public.is_admin());
create policy press_files_read on public.press_files as PERMISSIVE for SELECT to authenticated using ((public.my_company_role(company_id) IS NOT NULL));
create policy press_files_write on public.press_files as PERMISSIVE for ALL to authenticated using (public.can_write_company(company_id)) with check (public.can_write_company(company_id));
create policy press_jobs_hide_deleted on public.press_jobs as RESTRICTIVE for SELECT to authenticated using (((deleted_at IS NULL) OR public.is_admin()));
create policy press_jobs_no_hard_delete on public.press_jobs as RESTRICTIVE for DELETE to authenticated using (public.is_admin());
create policy press_jobs_read on public.press_jobs as PERMISSIVE for SELECT to authenticated using ((public.my_company_role(company_id) IS NOT NULL));
create policy press_jobs_write on public.press_jobs as PERMISSIVE for ALL to authenticated using (public.can_write_company(company_id)) with check (public.can_write_company(company_id));
create policy press_moves_insert on public.press_material_moves as PERMISSIVE for INSERT to authenticated with check (public.can_write_company(company_id));
create policy press_moves_read on public.press_material_moves as PERMISSIVE for SELECT to authenticated using ((public.my_company_role(company_id) IS NOT NULL));
create policy press_materials_hide_deleted on public.press_materials as RESTRICTIVE for SELECT to authenticated using (((deleted_at IS NULL) OR public.is_admin()));
create policy press_materials_no_hard_delete on public.press_materials as RESTRICTIVE for DELETE to authenticated using (public.is_admin());
create policy press_materials_read on public.press_materials as PERMISSIVE for SELECT to authenticated using ((public.my_company_role(company_id) IS NOT NULL));
create policy press_materials_write on public.press_materials as PERMISSIVE for ALL to authenticated using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));
create policy press_payments_delete on public.press_payments as PERMISSIVE for DELETE to authenticated using (public.can_manage_company(company_id));
create policy press_payments_hide_deleted on public.press_payments as RESTRICTIVE for SELECT to authenticated using (((deleted_at IS NULL) OR public.is_admin()));
create policy press_payments_insert on public.press_payments as PERMISSIVE for INSERT to authenticated with check (public.can_write_company(company_id));
create policy press_payments_no_hard_delete on public.press_payments as RESTRICTIVE for DELETE to authenticated using (public.is_admin());
create policy press_payments_read on public.press_payments as PERMISSIVE for SELECT to authenticated using ((public.my_company_role(company_id) IS NOT NULL));
create policy press_rate_items_hide_deleted on public.press_rate_items as RESTRICTIVE for SELECT to authenticated using (((deleted_at IS NULL) OR public.is_admin()));
create policy press_rate_items_no_hard_delete on public.press_rate_items as RESTRICTIVE for DELETE to authenticated using (public.is_admin());
create policy press_rate_read on public.press_rate_items as PERMISSIVE for SELECT to authenticated using ((public.my_company_role(company_id) IS NOT NULL));
create policy press_rate_write on public.press_rate_items as PERMISSIVE for ALL to authenticated using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));
create policy roles_hide_deleted on public.roles as RESTRICTIVE for SELECT to authenticated using (((deleted_at IS NULL) OR public.is_admin()));
create policy roles_no_hard_delete on public.roles as RESTRICTIVE for DELETE to authenticated using (public.is_admin());
create policy roles_read on public.roles as PERMISSIVE for SELECT to authenticated using (public.is_admin());
create policy roles_write on public.roles as PERMISSIVE for ALL to authenticated using (public.is_admin()) with check (public.is_admin());
create policy settings_read on public.settings as PERMISSIVE for SELECT to authenticated using ((public.my_level() IS NOT NULL));
create policy settings_write on public.settings as PERMISSIVE for ALL to authenticated using ((public.is_editor() AND (id = ANY (ARRAY['scoring'::text, 'outreach'::text, 'interviewEmail'::text])))) with check ((public.is_editor() AND (id = ANY (ARRAY['scoring'::text, 'outreach'::text, 'interviewEmail'::text]))));
create policy staff_hide_deleted on public.staff as RESTRICTIVE for SELECT to authenticated using (((deleted_at IS NULL) OR public.is_admin()));
create policy staff_no_hard_delete on public.staff as RESTRICTIVE for DELETE to authenticated using (public.is_admin());
create policy staff_read on public.staff as PERMISSIVE for SELECT to authenticated using (((public.my_company_role(company_id) IS NOT NULL) OR (EXISTS ( SELECT 1
   FROM unnest(staff.companies) c(c)
  WHERE (public.my_company_role(c.c) IS NOT NULL)))));
create policy staff_write on public.staff as PERMISSIVE for ALL to authenticated using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));
create policy staff_documents_hide_deleted on public.staff_documents as RESTRICTIVE for SELECT to authenticated using (((deleted_at IS NULL) OR public.is_admin()));
create policy staff_documents_no_hard_delete on public.staff_documents as RESTRICTIVE for DELETE to authenticated using (public.is_admin());
create policy staff_documents_read on public.staff_documents as PERMISSIVE for SELECT to public using ((public.can_manage_company(company_id) OR (EXISTS ( SELECT 1
   FROM public.staff s
  WHERE ((s.id = staff_documents.staff_id) AND (lower(s.member_email) = public.my_email()))))));
create policy staff_documents_write on public.staff_documents as PERMISSIVE for ALL to authenticated using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));
create policy staff_private_hide_deleted on public.staff_private as RESTRICTIVE for SELECT to public using (((deleted_at IS NULL) OR public.is_admin()));
create policy staff_private_no_hard_delete on public.staff_private as RESTRICTIVE for DELETE to public using (public.is_admin());
create policy staff_private_read on public.staff_private as PERMISSIVE for SELECT to public using ((public.can_manage_company(company_id) OR (EXISTS ( SELECT 1
   FROM public.staff s
  WHERE ((s.id = staff_private.id) AND (lower(s.member_email) = public.my_email()))))));
create policy staff_private_write on public.staff_private as PERMISSIVE for ALL to public using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));
create policy sync_runs_admin_read on public.sync_runs as PERMISSIVE for SELECT to authenticated using (public.is_admin());
create policy "avatars are public" on storage.objects as PERMISSIVE for SELECT to public using ((bucket_id = 'avatars'::text));
create policy "customer files own read" on storage.objects as PERMISSIVE for SELECT to authenticated using (((bucket_id = 'customer-files'::text) AND ((storage.foldername(name))[2] = (auth.uid())::text)));
create policy "customer files own write" on storage.objects as PERMISSIVE for INSERT to authenticated with check (((bucket_id = 'customer-files'::text) AND ((storage.foldername(name))[2] = (auth.uid())::text)));
create policy "customer files staff read" on storage.objects as PERMISSIVE for SELECT to authenticated using (((bucket_id = 'customer-files'::text) AND (public.my_company_role((storage.foldername(name))[1]) IS NOT NULL)));
create policy "own avatar delete" on storage.objects as PERMISSIVE for DELETE to authenticated using (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy "own avatar insert" on storage.objects as PERMISSIVE for INSERT to authenticated with check (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy "own avatar update" on storage.objects as PERMISSIVE for UPDATE to authenticated using (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy "press files delete by staff" on storage.objects as PERMISSIVE for DELETE to authenticated using (((bucket_id = 'press-files'::text) AND public.can_write_company((storage.foldername(name))[1])));
create policy "press files read by company" on storage.objects as PERMISSIVE for SELECT to authenticated using (((bucket_id = 'press-files'::text) AND (public.my_company_role((storage.foldername(name))[1]) IS NOT NULL)));
create policy "press files write by staff" on storage.objects as PERMISSIVE for INSERT to authenticated with check (((bucket_id = 'press-files'::text) AND public.can_write_company((storage.foldername(name))[1])));
create policy "staff docs delete by managers" on storage.objects as PERMISSIVE for DELETE to authenticated using (((bucket_id = 'staff-docs'::text) AND public.can_manage_company((storage.foldername(name))[1])));
create policy "staff docs read by managers or owner" on storage.objects as PERMISSIVE for SELECT to public using (((bucket_id = 'staff-docs'::text) AND (public.can_manage_company((storage.foldername(name))[1]) OR (EXISTS ( SELECT 1
   FROM public.staff s
  WHERE (((s.id)::text = (storage.foldername(objects.name))[2]) AND (lower(s.member_email) = public.my_email())))))));
create policy "staff docs write by managers" on storage.objects as PERMISSIVE for INSERT to authenticated with check (((bucket_id = 'staff-docs'::text) AND public.can_manage_company((storage.foldername(name))[1])));
create policy "staff photos by managers delete" on storage.objects as PERMISSIVE for DELETE to authenticated using (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = 'staff'::text) AND public.can_manage_company((storage.foldername(name))[2])));
create policy "staff photos by managers insert" on storage.objects as PERMISSIVE for INSERT to authenticated with check (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = 'staff'::text) AND public.can_manage_company((storage.foldername(name))[2])));
create policy "staff photos by managers update" on storage.objects as PERMISSIVE for UPDATE to authenticated using (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = 'staff'::text) AND public.can_manage_company((storage.foldername(name))[2])));

-- table rights the API never uses (stage9c)

revoke truncate, trigger, references on all tables in schema public from anon, authenticated;

-- realtime

do $p$ begin if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if; end $p$;

alter publication supabase_realtime add table public.candidates;
alter publication supabase_realtime add table public.companies;
alter publication supabase_realtime add table public.company_members;
alter publication supabase_realtime add table public.company_settings;
alter publication supabase_realtime add table public.conflicts;
alter publication supabase_realtime add table public.customer_request_messages;
alter publication supabase_realtime add table public.customer_requests;
alter publication supabase_realtime add table public.deletions;
alter publication supabase_realtime add table public.issues;
alter publication supabase_realtime add table public.leave_requests;
alter publication supabase_realtime add table public.members;
alter publication supabase_realtime add table public.press_customers;
alter publication supabase_realtime add table public.press_files;
alter publication supabase_realtime add table public.press_jobs;
alter publication supabase_realtime add table public.press_material_moves;
alter publication supabase_realtime add table public.press_materials;
alter publication supabase_realtime add table public.press_payments;
alter publication supabase_realtime add table public.press_rate_items;
alter publication supabase_realtime add table public.roles;
alter publication supabase_realtime add table public.settings;
alter publication supabase_realtime add table public.staff;
alter publication supabase_realtime add table public.staff_documents;
alter publication supabase_realtime add table public.sync_runs;

-- storage buckets (files themselves are not in database backups)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('avatars', 'avatars', true, 2097152, '{image/jpeg,image/png,image/webp}'::text[]) on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('customer-files', 'customer-files', false, 26214400, '{image/png,image/jpeg,image/webp,image/svg+xml,application/pdf,application/postscript,application/zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/plain}'::text[]) on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('press-files', 'press-files', false, 26214400, null) on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('staff-docs', 'staff-docs', false, 10485760, '{application/pdf,image/jpeg,image/png,image/webp,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document}'::text[]) on conflict (id) do nothing;

reset check_function_bodies;
