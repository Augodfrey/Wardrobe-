-- Smog Zone Front Office — business rules, RPCs, audit, review scheduling

-- ---------------------------------------------------------------------------
-- New auth users get a profile. Public sign-ups should be DISABLED in the
-- Supabase dashboard; staff are invited by the owner (Settings > Users),
-- which puts shop_id/role into app_metadata (only the service role can set it).
-- The very first user of a shop becomes its owner.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_shop uuid := nullif(new.raw_app_meta_data->>'shop_id','')::uuid;
  v_role text := coalesce(new.raw_app_meta_data->>'role','staff');
begin
  if v_shop is null then
    select id into v_shop from public.shops order by created_at limit 1;
  end if;
  if v_shop is null then
    return new;
  end if;
  if not exists (select 1 from public.profiles where shop_id = v_shop) then
    v_role := 'owner';
  end if;
  insert into public.profiles (id, shop_id, full_name, role)
  values (new.id, v_shop,
          coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
          case when v_role in ('owner','staff') then v_role else 'staff' end)
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Sequential six-digit estimate numbers per shop
-- ---------------------------------------------------------------------------
create or replace function public.assign_estimate_number() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if new.estimate_number is null or new.estimate_number = '' then
    update public.shops set next_estimate_number = next_estimate_number + 1
      where id = new.shop_id
      returning next_estimate_number - 1 into n;
    new.estimate_number := lpad(n::text, 6, '0');
  end if;
  return new;
end $$;

create trigger estimates_number before insert on public.estimates
  for each row execute function public.assign_estimate_number();

-- ---------------------------------------------------------------------------
-- THE EDITING RULE
--  * draft / awaiting_signature / signed: fully editable, any number of times.
--    Signing never locks and never resets the signature.
--  * issued: final. Only payment bookkeeping, PDF bookkeeping, and void are
--    permitted. Nobody (admins included) can edit or reopen it.
--  * void: final.
--  * status can become 'issued' only through issue_estimate().
-- ---------------------------------------------------------------------------
create or replace function public.enforce_estimate_lock() returns trigger
language plpgsql as $$
declare
  allowed text[] := array['payment_type_id','amount_paid','change_due','card_fee_total',
    'paid_at','billed_to_company','pdf_path','print_count','updated_at'];
  void_cols text[] := array['status','voided_at','voided_by','void_reason'];
  o jsonb; n jsonb;
begin
  if tg_op = 'DELETE' then
    if old.status in ('issued','void') then
      raise exception 'Issued invoices and voided documents cannot be deleted';
    end if;
    return old;
  end if;

  if old.status = 'void' then
    raise exception 'This document is void and cannot be changed';
  end if;

  if new.status = 'issued' and old.status <> 'issued'
     and coalesce(current_setting('app.issuing', true), '') <> 'on' then
    raise exception 'Use Issue to convert an estimate into an invoice';
  end if;

  if old.status = 'issued' then
    if new.status = 'void' then
      o := to_jsonb(old) - allowed - void_cols;
      n := to_jsonb(new) - allowed - void_cols;
    else
      o := to_jsonb(old) - allowed;
      n := to_jsonb(new) - allowed;
    end if;
    if o is distinct from n then
      raise exception 'Invoice % is closed and cannot be edited', old.estimate_number;
    end if;
  end if;

  -- Customer signature is permanent once captured
  if old.signature_id is not null and new.signature_id is distinct from old.signature_id then
    raise exception 'The customer signature cannot be replaced';
  end if;
  return new;
end $$;

create trigger estimates_lock before update or delete on public.estimates
  for each row execute function public.enforce_estimate_lock();

create or replace function public.enforce_item_lock() returns trigger
language plpgsql security definer set search_path = public as $$
declare s text;
begin
  select status into s from public.estimates
    where id = coalesce(new.estimate_id, old.estimate_id);
  if s in ('issued','void') then
    raise exception 'Line items of a closed invoice cannot be changed';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.total_price := round(new.quantity * new.unit_price - new.discount_amount, 2);
  return new;
end $$;

create trigger estimate_items_lock before insert or update or delete on public.estimate_items
  for each row execute function public.enforce_item_lock();

-- ---------------------------------------------------------------------------
-- Totals (server is source of truth; client mirrors the same formula)
-- ---------------------------------------------------------------------------
create or replace function public.recalc_estimate(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_rate numeric;
  v_status text;
begin
  select s.tax_rate, e.status into v_rate, v_status
    from public.estimates e join public.shops s on s.id = e.shop_id where e.id = p_id;
  if v_status is null or v_status in ('issued','void') then return; end if;

  update public.estimates e set
    subtotal         = t.sub,
    subtotal_parts   = t.parts,
    subtotal_labor   = t.labor,
    state_certificate= t.cert,
    dmv_fees         = t.dmv,
    discount_total   = t.disc,
    tax              = round(t.taxable * v_rate, 2),
    total            = t.sub + round(t.taxable * v_rate, 2)
  from (
    select
      coalesce(sum(total_price),0) as sub,
      coalesce(sum(total_price) filter (where product_type in ('parts','other')),0) as parts,
      coalesce(sum(total_price) filter (where product_type in ('test','labor')),0) as labor,
      coalesce(sum(total_price) filter (where product_type = 'certificate'),0) as cert,
      coalesce(sum(total_price) filter (where product_type = 'dmv_fee'),0) as dmv,
      coalesce(sum(discount_amount),0) as disc,
      coalesce(sum(total_price) filter (where taxable),0) as taxable
    from public.estimate_items where estimate_id = p_id
  ) t
  where e.id = p_id
    and (e.subtotal, e.tax, e.total, e.discount_total, e.subtotal_parts, e.subtotal_labor,
         e.state_certificate, e.dmv_fees)
        is distinct from
        (t.sub, round(t.taxable * v_rate, 2), t.sub + round(t.taxable * v_rate, 2), t.disc,
         t.parts, t.labor, t.cert, t.dmv);
end $$;

create or replace function public.items_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.recalc_estimate(coalesce(new.estimate_id, old.estimate_id));
  return null;
end $$;

create trigger estimate_items_recalc after insert or update or delete on public.estimate_items
  for each row execute function public.items_changed();

-- ---------------------------------------------------------------------------
-- Quiet audit log: who, when, before & after (changed columns only)
-- ---------------------------------------------------------------------------
create or replace function public.write_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  b jsonb := '{}'::jsonb; a jsonb := '{}'::jsonb; k text;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if k <> 'updated_at' and (o->k) is distinct from (n->k) then
        b := b || jsonb_build_object(k, o->k);
        a := a || jsonb_build_object(k, n->k);
      end if;
    end loop;
    if a = '{}'::jsonb then return null; end if;
  else
    b := o; a := n;
  end if;
  insert into public.audit_log (shop_id, table_name, row_id, action, actor_id, before, after)
  values (coalesce((n->>'shop_id')::uuid, (o->>'shop_id')::uuid), tg_table_name,
          coalesce((n->>'id')::uuid, (o->>'id')::uuid), lower(tg_op), auth.uid(), b, a);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['estimates','estimate_items','payments','products','price_lists',
    'price_list_items','payment_types','companies','customers','signatures','profiles']
  loop
    execute format('create trigger %I_audit after insert or update or delete on public.%I
                    for each row execute function public.write_audit()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Review request scheduling — one per visit (unique estimate_id)
-- ---------------------------------------------------------------------------
create or replace function public.schedule_review(p_estimate uuid, p_event text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_trigger text; v_delay int; v_shop uuid; v_customer uuid; v_when timestamptz;
begin
  select s.review_trigger, s.review_delay_minutes, e.shop_id, e.customer_id
    into v_trigger, v_delay, v_shop, v_customer
    from public.estimates e join public.shops s on s.id = e.shop_id where e.id = p_estimate;
  if v_shop is null then return; end if;

  if p_event = 'signed' then
    if v_trigger = 'signed' then v_when := now();
    elsif v_trigger = 'first' then v_when := now() + make_interval(mins => v_delay);
    else return; end if;
  elsif p_event = 'paid' then
    if v_trigger in ('paid','first') then v_when := now(); else return; end if;
  else
    return;
  end if;

  insert into public.review_requests (shop_id, estimate_id, customer_id, short_code, scheduled_for)
  values (v_shop, p_estimate, v_customer,
          translate(encode(gen_random_bytes(6), 'base64'), '+/=', 'xyz'), v_when)
  on conflict (estimate_id) do update
    set scheduled_for = least(public.review_requests.scheduled_for, excluded.scheduled_for)
    where public.review_requests.status = 'pending';
end $$;

-- ---------------------------------------------------------------------------
-- Signature capture (tablet & remote share apply_signature)
-- ---------------------------------------------------------------------------
create or replace function public.apply_signature(
  p_estimate uuid, p_image_path text, p_signer text, p_method text,
  p_ip text, p_user_agent text, p_acks jsonb, p_language text, p_details jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_sig uuid; e public.estimates;
begin
  select * into e from public.estimates where id = p_estimate for update;
  if e.id is null then raise exception 'Estimate not found'; end if;
  if e.status in ('issued','void') then raise exception 'This document is closed'; end if;
  if e.signature_id is not null then
    return e.signature_id; -- already signed: never ask again, never replace
  end if;

  insert into public.signatures (shop_id, estimate_id, image_path, signer_name, method, ip,
                                 user_agent, acknowledgments, language)
  values (e.shop_id, e.id, p_image_path, p_signer, p_method, p_ip, p_user_agent,
          coalesce(p_acks,'{}'::jsonb), coalesce(p_language,'en'))
  returning id into v_sig;

  update public.estimates set
    signature_id = v_sig,
    status = 'signed',
    customer_first_name = coalesce(nullif(p_details->>'customer_first_name',''), customer_first_name),
    customer_last_name  = coalesce(p_details->>'customer_last_name', customer_last_name),
    owner_first_name = case when owner_same_as_customer
        then coalesce(nullif(p_details->>'customer_first_name',''), owner_first_name) else owner_first_name end,
    owner_last_name = case when owner_same_as_customer
        then coalesce(p_details->>'customer_last_name', owner_last_name) else owner_last_name end,
    phone = coalesce(nullif(p_details->>'phone',''), phone),
    email = coalesce(p_details->>'email', email),
    plate = coalesce(nullif(p_details->>'plate',''), plate),
    year  = coalesce(nullif(p_details->>'year','')::int, year),
    make  = coalesce(nullif(p_details->>'make',''), make),
    model = coalesce(nullif(p_details->>'model',''), model),
    sms_consent = coalesce((p_acks->>'sms_consent')::boolean, false)
  where id = e.id;

  if e.customer_id is not null then
    update public.customers set
      sms_consent = coalesce((p_acks->>'sms_consent')::boolean, sms_consent),
      sms_consent_at = case when (p_acks->>'sms_consent')::boolean then now() else sms_consent_at end,
      preferred_language = coalesce(p_language, preferred_language)
    where id = e.customer_id;
  end if;

  update public.signing_links set used_at = now()
    where estimate_id = e.id and purpose = 'sign' and used_at is null;

  perform public.schedule_review(e.id, 'signed');
  return v_sig;
end $$;
revoke all on function public.apply_signature(uuid,text,text,text,text,text,jsonb,text,jsonb) from public, anon, authenticated;

create or replace function public.submit_tablet_signature(
  p_estimate uuid, p_image_path text, p_signer text, p_acks jsonb, p_language text,
  p_details jsonb, p_user_agent text
) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.estimates where id = p_estimate and shop_id = public.current_shop_id()) then
    raise exception 'Not allowed';
  end if;
  return public.apply_signature(p_estimate, p_image_path, p_signer, 'tablet', null,
                                p_user_agent, p_acks, p_language, p_details);
end $$;

-- ---------------------------------------------------------------------------
-- Link customer & vehicle records from the estimate snapshot
-- ---------------------------------------------------------------------------
create or replace function public.link_customer_vehicle(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare e public.estimates; v_cust uuid; v_veh uuid;
begin
  select * into e from public.estimates where id = p_id;
  v_cust := e.customer_id;
  if v_cust is null and coalesce(e.phone,'') <> '' then
    select id into v_cust from public.customers
      where shop_id = e.shop_id and phone = e.phone
        and lower(last_name) = lower(e.customer_last_name)
      order by updated_at desc limit 1;
  end if;
  if v_cust is null then
    insert into public.customers (shop_id, first_name, last_name, street, unit, city, state, zip,
                                  phone, email, company_id, sms_consent)
    values (e.shop_id, e.customer_first_name, e.customer_last_name, e.street, e.unit, e.city,
            e.state, e.zip, e.phone, e.email, e.company_id, e.sms_consent)
    returning id into v_cust;
  else
    update public.customers set first_name = e.customer_first_name, last_name = e.customer_last_name,
      street = e.street, unit = e.unit, city = e.city, state = e.state, zip = e.zip,
      phone = e.phone, email = coalesce(e.email, email),
      sms_consent = sms_consent or e.sms_consent
    where id = v_cust;
  end if;

  v_veh := e.vehicle_id;
  if v_veh is null and coalesce(e.vin,'') <> '' then
    select id into v_veh from public.vehicles where shop_id = e.shop_id and vin = e.vin limit 1;
  end if;
  if v_veh is null and coalesce(e.plate,'') <> '' then
    select id into v_veh from public.vehicles
      where shop_id = e.shop_id and plate = e.plate and coalesce(plate_state,'CA') = coalesce(e.plate_state,'CA') limit 1;
  end if;
  if v_veh is null and (coalesce(e.vin,'') <> '' or coalesce(e.plate,'') <> '') then
    insert into public.vehicles (shop_id, plate, plate_state, vin, year, make, model, company_id, customer_id)
    values (e.shop_id, e.plate, e.plate_state, e.vin, e.year, e.make, e.model, e.company_id, v_cust)
    returning id into v_veh;
  elsif v_veh is not null then
    update public.vehicles set plate = coalesce(e.plate, plate), vin = coalesce(e.vin, vin),
      year = coalesce(e.year, year), make = coalesce(e.make, make), model = coalesce(e.model, model),
      company_id = coalesce(e.company_id, company_id), customer_id = v_cust
    where id = v_veh;
  end if;

  update public.estimates set customer_id = v_cust, vehicle_id = v_veh where id = p_id
    and (customer_id is distinct from v_cust or vehicle_id is distinct from v_veh);
end $$;

-- ---------------------------------------------------------------------------
-- Issue (Close): estimate -> locked invoice
-- ---------------------------------------------------------------------------
create or replace function public.issue_estimate(
  p_id uuid, p_result text, p_certificate text, p_technician uuid, p_bay text, p_time_out timestamptz
) returns public.estimates
language plpgsql security definer set search_path = public as $$
declare e public.estimates;
begin
  select * into e from public.estimates where id = p_id and shop_id = public.current_shop_id() for update;
  if e.id is null then raise exception 'Estimate not found'; end if;
  if e.status in ('issued','void') then raise exception 'Already closed'; end if;
  if coalesce(e.phone,'') = '' then raise exception 'Phone number must be entered before issuing'; end if;
  if not exists (select 1 from public.estimate_items where estimate_id = p_id) then
    raise exception 'Add at least one line item before issuing';
  end if;

  perform public.link_customer_vehicle(p_id);
  perform public.recalc_estimate(p_id);

  -- inventory
  update public.products p set on_hand = p.on_hand - i.qty
  from (select product_id, sum(quantity)::int qty from public.estimate_items
        where estimate_id = p_id and product_id is not null group by product_id) i
  where p.id = i.product_id and p.track_inventory;

  perform set_config('app.issuing', 'on', true);
  update public.estimates set
    status = 'issued',
    issued_at = now(),
    issued_by = auth.uid(),
    time_out = coalesce(p_time_out, now()),
    result = p_result,
    certificate_number = nullif(p_certificate,''),
    technician_id = p_technician,
    bay = nullif(p_bay,''),
    billed_to_company = (company_id is not null and exists (
      select 1 from public.companies c where c.id = company_id and c.billing_mode = 'monthly'))
  where id = p_id
  returning * into e;
  perform set_config('app.issuing', 'off', true);
  return e;
end $$;

-- ---------------------------------------------------------------------------
-- Void
-- ---------------------------------------------------------------------------
create or replace function public.void_document(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.estimates set status = 'void', voided_at = now(), voided_by = auth.uid(),
    void_reason = p_reason
  where id = p_id and shop_id = public.current_shop_id() and status <> 'void';
  update public.review_requests set status = 'skipped', skip_reason = 'voided'
    where estimate_id = p_id and status = 'pending';
end $$;

-- ---------------------------------------------------------------------------
-- Payments (split tender supported). p_lines: [{payment_type_id, amount, tendered, reference}]
-- ---------------------------------------------------------------------------
create or replace function public.record_payment(p_id uuid, p_lines jsonb) returns public.estimates
language plpgsql security definer set search_path = public as $$
declare
  e public.estimates; l jsonb; pt public.payment_types;
  v_amount numeric; v_fee numeric; v_tendered numeric;
  v_paid numeric; v_change numeric := 0; v_company boolean := false; v_primary uuid;
begin
  select * into e from public.estimates where id = p_id and shop_id = public.current_shop_id() for update;
  if e.id is null then raise exception 'Invoice not found'; end if;
  if e.status <> 'issued' then raise exception 'Issue the estimate before taking payment'; end if;

  for l in select * from jsonb_array_elements(p_lines) loop
    select * into pt from public.payment_types where id = (l->>'payment_type_id')::uuid and shop_id = e.shop_id;
    if pt.id is null then raise exception 'Unknown payment type'; end if;
    v_amount := round((l->>'amount')::numeric, 2);
    v_tendered := nullif(l->>'tendered','')::numeric;
    v_fee := case when pt.is_card then round(v_amount * pt.card_fee_percent / 100, 2) else 0 end;
    if pt.is_company_account then v_company := true; end if;
    if v_tendered is not null and v_tendered > v_amount then
      v_change := v_change + (v_tendered - v_amount);
    end if;
    insert into public.payments (shop_id, estimate_id, payment_type_id, amount, tendered, card_fee, reference)
    values (e.shop_id, e.id, pt.id, v_amount, v_tendered, v_fee, l->>'reference');
  end loop;

  select coalesce(sum(p.amount) filter (where not t.is_company_account),0),
         (array_agg(p.payment_type_id order by p.amount desc))[1]
    into v_paid, v_primary
    from public.payments p join public.payment_types t on t.id = p.payment_type_id
    where p.estimate_id = e.id;

  update public.estimates set
    payment_type_id = v_primary,
    amount_paid = v_paid,
    change_due = v_change,
    card_fee_total = (select coalesce(sum(card_fee),0) from public.payments where estimate_id = e.id),
    billed_to_company = billed_to_company or v_company,
    paid_at = case when v_paid >= total then coalesce(paid_at, now()) else null end
  where id = e.id
  returning * into e;

  if e.paid_at is not null then
    perform public.schedule_review(e.id, 'paid');
  end if;
  return e;
end $$;

-- Company pays its monthly statement
create or replace function public.mark_company_invoices_paid(p_ids uuid[], p_payment_type uuid, p_reference text)
returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id, total, amount_paid from public.estimates
           where id = any(p_ids) and shop_id = public.current_shop_id()
             and status = 'issued' and paid_at is null loop
    perform public.record_payment(r.id, jsonb_build_array(jsonb_build_object(
      'payment_type_id', p_payment_type, 'amount', r.total - r.amount_paid, 'reference', p_reference)));
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Staff PIN for exiting tablet mode (bcrypt via pgcrypto)
-- ---------------------------------------------------------------------------
create or replace function public.set_staff_pin(p_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_owner() then raise exception 'Only the owner can change the PIN'; end if;
  if p_pin !~ '^[0-9]{4,8}$' then raise exception 'PIN must be 4 to 8 digits'; end if;
  update public.shops set staff_pin_hash = crypt(p_pin, gen_salt('bf'))
    where id = public.current_shop_id();
end $$;

create or replace function public.verify_staff_pin(p_pin text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(staff_pin_hash = crypt(p_pin, staff_pin_hash), false)
  from public.shops where id = public.current_shop_id()
$$;

-- shops.staff_pin_hash must never be readable by clients
create or replace view public.shop_settings as
  select id, name, street, city, state, zip, phone, ard_number, logo_path, tax_rate,
         google_review_url, review_trigger, review_delay_minutes, public_app_url,
         (staff_pin_hash is not null) as has_staff_pin, created_at, updated_at
  from public.shops
  where id = public.current_shop_id();

revoke all on function public.schedule_review(uuid,text) from public, anon, authenticated;
revoke all on function public.link_customer_vehicle(uuid) from public, anon;
revoke all on function public.recalc_estimate(uuid) from public, anon;
