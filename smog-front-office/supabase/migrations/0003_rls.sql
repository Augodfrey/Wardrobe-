-- Row Level Security: every table is scoped by shop_id = current_shop_id().
-- Anonymous customers never touch tables directly; remote signing goes
-- through the public-sign Edge Function, which exposes exactly one document.

do $$
declare t text;
begin
  foreach t in array array['shops','profiles','products','price_lists','price_list_items',
    'reasons_for_test','referral_sources','payment_types','discount_terms','companies',
    'customers','vehicles','estimates','estimate_items','payments','signatures',
    'signing_links','review_requests','audit_log','active_sessions']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Shops: members read (except the PIN hash, see column grants), owner updates
create policy shops_select on public.shops for select to authenticated
  using (id = public.current_shop_id());
create policy shops_update on public.shops for update to authenticated
  using (id = public.current_shop_id() and public.is_owner())
  with check (id = public.current_shop_id());
revoke select, update on public.shops from authenticated, anon;
grant select (id, shop_id, name, street, city, state, zip, phone, ard_number, logo_path, tax_rate,
  google_review_url, review_trigger, review_delay_minutes, public_app_url, created_at, updated_at)
  on public.shops to authenticated;
grant update (name, street, city, state, zip, phone, ard_number, logo_path, tax_rate,
  google_review_url, review_trigger, review_delay_minutes, public_app_url)
  on public.shops to authenticated;
grant select on public.shop_settings to authenticated;

-- Profiles
create policy profiles_select on public.profiles for select to authenticated
  using (shop_id = public.current_shop_id());
create policy profiles_update_owner on public.profiles for update to authenticated
  using (shop_id = public.current_shop_id() and public.is_owner())
  with check (shop_id = public.current_shop_id());
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid() and shop_id = public.current_shop_id());
-- staff may only change their own name; role/active are owner-controlled
revoke update on public.profiles from authenticated;
grant update (full_name, is_technician, role, active) on public.profiles to authenticated;
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() and (new.role is distinct from old.role or new.active is distinct from old.active
     or new.is_technician is distinct from old.is_technician) then
    raise exception 'Only the owner can change roles';
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- Admin-managed lists: everyone in the shop reads, only the owner writes
do $$
declare t text;
begin
  foreach t in array array['products','price_lists','price_list_items','reasons_for_test',
    'referral_sources','payment_types','discount_terms']
  loop
    execute format('create policy %I_select on public.%I for select to authenticated
                    using (shop_id = public.current_shop_id())', t, t);
    execute format('create policy %I_write on public.%I for all to authenticated
                    using (shop_id = public.current_shop_id() and public.is_owner())
                    with check (shop_id = public.current_shop_id() and public.is_owner())', t, t);
  end loop;
end $$;

-- Operational tables: any active member of the shop
do $$
declare t text;
begin
  foreach t in array array['companies','customers','vehicles','estimates','estimate_items']
  loop
    execute format('create policy %I_all on public.%I for all to authenticated
                    using (shop_id = public.current_shop_id())
                    with check (shop_id = public.current_shop_id())', t, t);
  end loop;
end $$;

-- Payments are written only through record_payment(); readable by members
create policy payments_select on public.payments for select to authenticated
  using (shop_id = public.current_shop_id());

-- Signatures: read-only for members (written by apply_signature)
create policy signatures_select on public.signatures for select to authenticated
  using (shop_id = public.current_shop_id());

-- Signing links & review requests: members read; written by Edge Functions / definer fns
create policy signing_links_select on public.signing_links for select to authenticated
  using (shop_id = public.current_shop_id());
create policy review_requests_select on public.review_requests for select to authenticated
  using (shop_id = public.current_shop_id());
create policy review_requests_owner on public.review_requests for update to authenticated
  using (shop_id = public.current_shop_id() and public.is_owner());

-- Audit log: owner reads; nobody writes directly
create policy audit_log_select on public.audit_log for select to authenticated
  using (shop_id = public.current_shop_id() and public.is_owner());

-- Sessions: everyone registers/heartbeats their own; owner sees & revokes all
create policy sessions_insert on public.active_sessions for insert to authenticated
  with check (user_id = auth.uid() and shop_id = public.current_shop_id());
create policy sessions_select on public.active_sessions for select to authenticated
  using (shop_id = public.current_shop_id() and (user_id = auth.uid() or public.is_owner()));
create policy sessions_update on public.active_sessions for update to authenticated
  using (shop_id = public.current_shop_id() and (user_id = auth.uid() or public.is_owner()))
  with check (shop_id = public.current_shop_id());
create policy sessions_delete on public.active_sessions for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Realtime: live sync between every device logged in to the shop
-- ---------------------------------------------------------------------------
alter table public.estimates replica identity full;
alter table public.estimate_items replica identity full;
alter table public.signing_links replica identity full;
alter table public.active_sessions replica identity full;
alter publication supabase_realtime add table
  public.estimates, public.estimate_items, public.signing_links, public.signatures,
  public.payments, public.active_sessions, public.review_requests;

-- ---------------------------------------------------------------------------
-- Storage: private buckets, objects namespaced by shop id (first path segment)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values
  ('signatures','signatures', false),
  ('documents','documents', false),
  ('branding','branding', true)
on conflict (id) do nothing;

create policy "shop members read own objects" on storage.objects for select to authenticated
  using (bucket_id in ('signatures','documents','branding')
         and (storage.foldername(name))[1] = public.current_shop_id()::text);
create policy "shop members upload signatures" on storage.objects for insert to authenticated
  with check (bucket_id = 'signatures'
              and (storage.foldername(name))[1] = public.current_shop_id()::text);
create policy "owner manages branding" on storage.objects for all to authenticated
  using (bucket_id = 'branding' and public.is_owner()
         and (storage.foldername(name))[1] = public.current_shop_id()::text)
  with check (bucket_id = 'branding' and public.is_owner()
              and (storage.foldername(name))[1] = public.current_shop_id()::text);
