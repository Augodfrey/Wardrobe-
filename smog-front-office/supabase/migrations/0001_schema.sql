-- Smog Zone Front Office — core schema
-- Every business table carries shop_id, created_at, updated_at.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Shops & people
-- ---------------------------------------------------------------------------
create table public.shops (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid generated always as (id) stored,
  name text not null,
  street text, city text, state text default 'CA', zip text,
  phone text,
  ard_number text,
  logo_path text,
  tax_rate numeric(6,4) not null default 0.0875,
  google_review_url text,
  -- 'signed' | 'paid' | 'first' (whichever first, or delay after signing)
  review_trigger text not null default 'first' check (review_trigger in ('signed','paid','first')),
  review_delay_minutes int not null default 120,
  staff_pin_hash text,
  next_estimate_number int not null default 1,
  public_app_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  shop_id uuid not null references public.shops(id),
  full_name text not null default '',
  role text not null default 'staff' check (role in ('owner','staff')),
  is_technician boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.current_shop_id() returns uuid
language sql stable security definer set search_path = public as $$
  select shop_id from public.profiles where id = auth.uid() and active
$$;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'owner' and active)
$$;

-- ---------------------------------------------------------------------------
-- Admin-managed lists
-- ---------------------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id),
  code text not null,
  description text not null,
  product_type text not null default 'other'
    check (product_type in ('test','certificate','labor','parts','dmv_fee','other')),
  unit_cost numeric(10,2) not null default 0,
  unit_price numeric(10,2) not null default 0,
  taxable boolean not null default false,
  track_inventory boolean not null default false,
  on_hand int not null default 0,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, code)
);

create table public.price_lists (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id),
  name text not null,
  is_default boolean not null default false,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.price_list_items (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id),
  price_list_id uuid not null references public.price_lists(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  unit_price numeric(10,2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (price_list_id, product_id)
);

create table public.reasons_for_test (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id),
  name text not null,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.referral_sources (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id),
  name text not null,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payment_types (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id),
  name text not null,
  is_card boolean not null default false,
  card_fee_percent numeric(5,2) not null default 0,
  is_company_account boolean not null default false,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.discount_terms (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id),
  name text not null,
  percent numeric(5,2) not null default 0,
  amount numeric(10,2) not null default 0,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Customers, companies, vehicles
-- ---------------------------------------------------------------------------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id),
  name text not null,
  contact_person text,
  phone text, email text,
  street text, unit text, city text, state text default 'CA', zip text,
  notes text,
  billing_mode text not null default 'on_the_spot' check (billing_mode in ('on_the_spot','monthly')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id),
  first_name text not null default '',
  last_name text not null default '',
  street text, unit text, city text, state text default 'CA', zip text,
  phone text, email text,
  company_id uuid references public.companies(id),
  sms_consent boolean not null default false,
  sms_consent_at timestamptz,
  sms_opt_out boolean not null default false,
  email_opt_out boolean not null default false,
  preferred_language text not null default 'en' check (preferred_language in ('en','es')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index customers_phone_idx on public.customers (shop_id, phone);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id),
  plate text, plate_state text default 'CA',
  vin text,
  year int, make text, model text,
  company_id uuid references public.companies(id),
  customer_id uuid references public.customers(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index vehicles_vin_idx on public.vehicles (shop_id, vin);
create index vehicles_plate_idx on public.vehicles (shop_id, plate);

-- ---------------------------------------------------------------------------
-- Estimates / invoices
-- ---------------------------------------------------------------------------
create table public.estimates (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) default public.current_shop_id(),
  estimate_number text not null,
  manual_estimate_number text,
  po_number text,
  account_id text not null default '0',
  status text not null default 'draft'
    check (status in ('draft','awaiting_signature','signed','issued','void')),

  -- vehicle snapshot (the document keeps its own copy)
  vehicle_id uuid references public.vehicles(id),
  plate text, plate_none boolean not null default false, plate_state text default 'CA',
  year int, make text, model text,
  odometer int, odometer_none boolean not null default false,
  vin text,

  -- customer snapshot
  customer_id uuid references public.customers(id),
  company_id uuid references public.companies(id),
  customer_first_name text not null default '',
  customer_last_name text not null default '',
  owner_first_name text not null default '',
  owner_last_name text not null default '',
  owner_same_as_customer boolean not null default true,
  street text, unit text, zip text, city text, state text default 'CA',
  phone text, email text,
  registration_due_date date,

  retest_of_invoice_number text,
  retest_of_date date,

  reason_for_test text,
  referral_source_id uuid references public.referral_sources(id),
  price_list_id uuid references public.price_lists(id),
  is_star boolean not null default false,
  tire_pressure_check text,
  notes text,

  subtotal numeric(10,2) not null default 0,
  subtotal_parts numeric(10,2) not null default 0,
  subtotal_labor numeric(10,2) not null default 0,
  state_certificate numeric(10,2) not null default 0,
  dmv_fees numeric(10,2) not null default 0,
  discount_total numeric(10,2) not null default 0,
  tax numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,

  -- issue / test result
  issued_at timestamptz,
  issued_by uuid references public.profiles(id),
  time_in timestamptz not null default now(),
  time_out timestamptz,
  result text check (result in ('PASS','FAIL')),
  certificate_number text,
  technician_id uuid references public.profiles(id),
  bay text,

  -- payment
  payment_type_id uuid references public.payment_types(id),
  amount_paid numeric(10,2) not null default 0,
  change_due numeric(10,2) not null default 0,
  card_fee_total numeric(10,2) not null default 0,
  paid_at timestamptz,
  billed_to_company boolean not null default false,

  signature_id uuid,
  sms_consent boolean not null default false,
  pdf_path text,
  print_count int not null default 0,

  voided_at timestamptz,
  voided_by uuid references public.profiles(id),
  void_reason text,

  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, estimate_number)
);
create index estimates_status_idx on public.estimates (shop_id, status);
create index estimates_vin_idx on public.estimates (shop_id, vin);
create index estimates_plate_idx on public.estimates (shop_id, plate);
create index estimates_created_idx on public.estimates (shop_id, created_at);

create table public.estimate_items (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) default public.current_shop_id(),
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  line_no int not null default 0,
  product_id uuid references public.products(id),
  product_code text,
  product_type text not null default 'other',
  description text not null default '',
  quantity numeric(10,2) not null default 1,
  unit_cost numeric(10,2) not null default 0,
  unit_price numeric(10,2) not null default 0,
  price_overridden boolean not null default false,
  taxable boolean not null default false,
  discount_term_id uuid references public.discount_terms(id),
  discount_amount numeric(10,2) not null default 0,
  total_price numeric(10,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index estimate_items_estimate_idx on public.estimate_items (estimate_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) default public.current_shop_id(),
  estimate_id uuid not null references public.estimates(id),
  payment_type_id uuid not null references public.payment_types(id),
  amount numeric(10,2) not null,
  tendered numeric(10,2),
  card_fee numeric(10,2) not null default 0,
  reference text, -- check number, last-4 is NOT stored; free text like "Zelle conf #"
  received_by uuid references public.profiles(id) default auth.uid(),
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_estimate_idx on public.payments (estimate_id);

create table public.signatures (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id),
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  image_path text not null,          -- storage path in bucket "signatures"
  signer_name text not null,
  signed_at timestamptz not null default now(),
  method text not null check (method in ('tablet','remote')),
  ip text,
  user_agent text,
  acknowledgments jsonb not null default '{}'::jsonb,
  language text not null default 'en',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.estimates
  add constraint estimates_signature_fk foreign key (signature_id) references public.signatures(id) on delete set null;

create table public.signing_links (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id),
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  token_hash text not null unique,   -- sha256 of the token; the raw token is only in the URL
  purpose text not null default 'sign' check (purpose in ('sign','view_invoice')),
  channel text check (channel in ('sms','email','both')),
  sent_to text,
  expires_at timestamptz not null,
  used_at timestamptz,
  opened_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.review_requests (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id),
  estimate_id uuid not null unique references public.estimates(id) on delete cascade, -- once per visit
  customer_id uuid references public.customers(id),
  short_code text not null unique,
  status text not null default 'pending'
    check (status in ('pending','sent','skipped','failed')),
  scheduled_for timestamptz not null,
  channel text check (channel in ('sms','email')),
  sent_to text,
  sent_at timestamptz,
  skip_reason text,
  error text,
  clicked_at timestamptz,
  click_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index review_requests_due_idx on public.review_requests (status, scheduled_for);

create table public.audit_log (
  id bigint generated always as identity primary key,
  shop_id uuid not null references public.shops(id),
  table_name text not null,
  row_id uuid not null,
  action text not null,
  actor_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index audit_log_row_idx on public.audit_log (row_id, created_at);

create table public.active_sessions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) default public.current_shop_id(),
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  device_label text,
  user_agent text,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- updated_at triggers on every table
do $$
declare t text;
begin
  foreach t in array array['shops','profiles','products','price_lists','price_list_items',
    'reasons_for_test','referral_sources','payment_types','discount_terms','companies',
    'customers','vehicles','estimates','estimate_items','payments','signatures',
    'signing_links','review_requests','audit_log','active_sessions']
  loop
    execute format('create trigger %I_touch before update on public.%I
                    for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;

-- shop_id defaults to the signed-in user's shop everywhere
do $$
declare t text;
begin
  foreach t in array array['products','price_lists','price_list_items','reasons_for_test',
    'referral_sources','payment_types','discount_terms','companies','customers','vehicles',
    'estimates','estimate_items','payments','signatures','signing_links','review_requests',
    'active_sessions']
  loop
    execute format('alter table public.%I alter column shop_id set default public.current_shop_id()', t);
  end loop;
end $$;
