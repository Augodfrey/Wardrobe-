-- Behavioural tests for the database rules. Run against a database with the
-- migrations + seed applied (see README "Testing the database").
-- Each block raises an exception on failure; success prints "ALL RULES PASS".
\set ON_ERROR_STOP 1
begin;

-- Users: first user becomes owner, second is staff. A second shop for isolation.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner@smogzone.test'),
  ('22222222-2222-2222-2222-222222222222', 'staff@smogzone.test');
insert into public.shops (id, name) values ('99999999-9999-9999-9999-999999999999', 'Other Shop');
insert into auth.users (id, email, raw_app_meta_data) values
  ('33333333-3333-3333-3333-333333333333', 'other@shop.test', '{"shop_id":"99999999-9999-9999-9999-999999999999"}');

do $$ begin
  assert (select role from public.profiles where id = '11111111-1111-1111-1111-111111111111') = 'owner', 'first user is owner';
  assert (select role from public.profiles where id = '22222222-2222-2222-2222-222222222222') = 'staff', 'second user is staff';
  assert (select role from public.profiles where id = '33333333-3333-3333-3333-333333333333') = 'owner', 'first user of other shop is its owner';
end $$;

-- Act as staff
set local role authenticated;
select set_config('request.jwt.uid', '22222222-2222-2222-2222-222222222222', true);

create temp table t (k text primary key, v uuid) on commit drop;
grant all on t to authenticated;

insert into public.estimates (customer_first_name, customer_last_name, phone, plate, vin, odometer, reason_for_test)
values ('Maria', 'Garcia', '9165550101', '7ABC123', '1HGCM82633A004352', 120000, 'Smog Test');
insert into t select 'e', id from public.estimates where plate = '7ABC123';

do $$
declare e public.estimates;
begin
  select * into e from public.estimates where id = (select v from t where k = 'e');
  assert e.estimate_number = '007875', 'sequential six-digit number, got ' || e.estimate_number;
  assert e.shop_id = '00000000-0000-0000-0000-000000238473', 'shop defaulted from profile';
end $$;

-- Default lines 01-TEST + 06-CERT
insert into public.estimate_items (estimate_id, line_no, product_id, product_code, product_type, description, unit_cost, unit_price)
select (select v from t where k='e'), sort_order, id, code, product_type, description, unit_cost, unit_price
from public.products where code in ('01-TEST','06-CERT');

do $$ begin
  assert (select total from public.estimates where id = (select v from t where k='e')) = 70.00, 'total 61.75 + 8.25';
end $$;

-- Staff cannot change the product catalog
do $$ begin
  update public.products set unit_price = 1 where code = '01-TEST';
  assert not found, 'staff must not update products (RLS)';
end $$;

-- Customer signs on the tablet
select public.submit_tablet_signature((select v from t where k='e'), 'shop/e.png', 'Maria Garcia',
  '{"authorize":true,"price":true,"sms_consent":true}', 'es', '{"email":"maria@example.com"}', 'test-agent');

do $$
declare e public.estimates; first_sig uuid;
begin
  select * into e from public.estimates where id = (select v from t where k='e');
  assert e.status = 'signed' and e.signature_id is not null, 'signed';
  assert e.email = 'maria@example.com', 'customer details applied';
  assert (select count(*) from public.review_requests where estimate_id = e.id) = 1, 'review scheduled once on signing';
  first_sig := e.signature_id;

  -- EDIT AFTER SIGNING: odometer, VIN and a price. No re-sign, stays open.
  update public.estimates set odometer = 120345, vin = '1HGCM82633A004352' where id = e.id;
  update public.estimate_items set unit_price = 55.00, price_overridden = true where estimate_id = e.id and product_code = '01-TEST';
  select * into e from public.estimates where id = e.id;
  assert e.status = 'signed' and e.signature_id = first_sig, 'still signed, same signature';
  assert e.odometer = 120345 and e.total = 63.25, 'edits applied and totals recomputed';

  -- Signing again keeps the original signature
  perform public.submit_tablet_signature(e.id, 'shop/other.png', 'Someone Else', '{}', 'en', '{}', 'x');
  assert (select signature_id from public.estimates where id = e.id) = first_sig, 'original signature kept';
  assert (select count(*) from public.signatures where estimate_id = e.id) = 1, 'no second signature row';
end $$;

-- Status cannot jump to issued directly
do $$ begin
  begin
    update public.estimates set status = 'issued' where id = (select v from t where k='e');
    raise exception 'direct issue should fail';
  exception when raise_exception then
    if sqlerrm = 'direct issue should fail' then raise; end if;
  end;
end $$;

-- ISSUE
select public.issue_estimate((select v from t where k='e'), 'PASS', 'AB123456C',
  '22222222-2222-2222-2222-222222222222', '1', null);

do $$
declare e public.estimates;
begin
  select * into e from public.estimates where id = (select v from t where k='e');
  assert e.status = 'issued' and e.issued_at is not null and e.result = 'PASS', 'issued';
  assert e.customer_id is not null and e.vehicle_id is not null, 'customer & vehicle linked';
  assert e.signature_id is not null, 'original signature carried onto invoice';

  -- Locked: field edits fail
  begin
    update public.estimates set odometer = 1 where id = e.id;
    raise exception 'edit of issued invoice should fail';
  exception when raise_exception then
    if sqlerrm like 'edit of issued%' then raise; end if;
  end;
  -- Locked: line edits fail
  begin
    update public.estimate_items set quantity = 2 where estimate_id = e.id;
    raise exception 'line edit of issued invoice should fail';
  exception when raise_exception then
    if sqlerrm like 'line edit%' then raise; end if;
  end;
  -- Locked: cannot be reopened
  begin
    update public.estimates set status = 'signed' where id = e.id;
    raise exception 'reopen should fail';
  exception when raise_exception then
    if sqlerrm like 'reopen%' then raise; end if;
  end;
  -- Cannot be deleted
  begin
    delete from public.estimates where id = e.id;
    raise exception 'delete should fail';
  exception when raise_exception then
    if sqlerrm like 'delete should%' then raise; end if;
  end;
end $$;

-- PAYMENT: split cash + visa, with change on cash
select public.record_payment((select v from t where k='e'), jsonb_build_array(
  jsonb_build_object('payment_type_id', (select id from public.payment_types where name='Cash'), 'amount', 40, 'tendered', 50),
  jsonb_build_object('payment_type_id', (select id from public.payment_types where name='Visa'), 'amount', 23.25)
));

do $$
declare e public.estimates;
begin
  select * into e from public.estimates where id = (select v from t where k='e');
  assert e.paid_at is not null and e.amount_paid = 63.25, 'paid in full';
  assert e.change_due = 10, 'change on cash';
  assert e.payment_type_id = (select id from public.payment_types where name='Cash'), 'PAID BY = largest tender';
  assert (select count(*) from public.review_requests where estimate_id = e.id) = 1, 'still one review request per visit';
  assert (select scheduled_for <= now() from public.review_requests where estimate_id = e.id), 'paid moves review to now (whichever first)';
end $$;

-- OWNER cannot edit the invoice either
select set_config('request.jwt.uid', '11111111-1111-1111-1111-111111111111', true);
do $$ begin
  begin
    update public.estimates set notes = 'owner edit' where id = (select v from t where k='e');
    raise exception 'owner edit should fail';
  exception when raise_exception then
    if sqlerrm like 'owner edit%' then raise; end if;
  end;
end $$;

-- MONTHLY COMPANY billing
insert into public.companies (name, billing_mode) values ('Acme Fleet', 'monthly');
insert into public.estimates (customer_first_name, phone, company_id)
values ('Acme Fleet', '9165550199', (select id from public.companies where name = 'Acme Fleet'));
insert into t select 'c', id from public.estimates where customer_first_name = 'Acme Fleet';
insert into public.estimate_items (estimate_id, product_code, product_type, description, unit_price)
values ((select v from t where k='c'), '015-Test', 'test', 'Dealer', 31.75);
select public.issue_estimate((select v from t where k='c'), 'PASS', 'AB123457C', null, '2', null);
do $$ begin
  assert (select billed_to_company and paid_at is null from public.estimates where id = (select v from t where k='c')), 'monthly company invoice left unpaid';
end $$;
select public.mark_company_invoices_paid(array[(select v from t where k='c')],
  (select id from public.payment_types where name='Check'), 'CHK 1001');
do $$ begin
  assert (select paid_at is not null from public.estimates where id = (select v from t where k='c')), 'company invoice paid';
end $$;

-- PIN: owner sets, verify works, hash not readable
select public.set_staff_pin('4321');
do $$ begin
  assert public.verify_staff_pin('4321'), 'correct PIN';
  assert not public.verify_staff_pin('0000'), 'wrong PIN';
  assert (select has_staff_pin from public.shop_settings), 'settings view reports PIN set';
  begin
    perform staff_pin_hash from public.shops;
    raise exception 'pin hash readable';
  exception when insufficient_privilege then null;
  end;
end $$;

-- AUDIT log captured the post-signing edits quietly
do $$ begin
  assert (select count(*) from public.audit_log where row_id = (select v from t where k='e') and action = 'update'
          and after ? 'odometer') >= 1, 'odometer edit audited';
end $$;

-- RLS isolation: the other shop sees nothing of ours
select set_config('request.jwt.uid', '33333333-3333-3333-3333-333333333333', true);
do $$ begin
  assert (select count(*) from public.estimates) = 0, 'other shop sees no estimates';
  assert (select count(*) from public.products) = 0, 'other shop sees no products';
  assert (select count(*) from public.customers) = 0, 'other shop sees no customers';
end $$;

-- REMOTE SIGN-OUT: owner revokes a staff device; that device loses access at once
select set_config('request.jwt.uid', '22222222-2222-2222-2222-222222222222', true);
select set_config('request.jwt.claims', '{"session_id":"44444444-4444-4444-4444-444444444444"}', true);
reset role;
insert into auth.sessions values ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222');
set local role authenticated;
select public.register_session('Counter tablet', 'test');
do $$ begin assert (select count(*) from public.estimates) > 0, 'device can read before revoke'; end $$;
select set_config('request.jwt.uid', '11111111-1111-1111-1111-111111111111', true);
select set_config('request.jwt.claims', '{"session_id":"55555555-5555-5555-5555-555555555555"}', true);
select public.revoke_session((select id from public.active_sessions where device_label = 'Counter tablet'));
select set_config('request.jwt.uid', '22222222-2222-2222-2222-222222222222', true);
select set_config('request.jwt.claims', '{"session_id":"44444444-4444-4444-4444-444444444444"}', true);
do $$ begin assert (select count(*) from public.estimates) = 0, 'revoked device is locked out'; end $$;
select set_config('request.jwt.claims', '{"session_id":"66666666-6666-6666-6666-666666666666"}', true);
do $$ begin assert (select count(*) from public.estimates) > 0, 'same login on another device still works'; end $$;
reset role;
do $$ begin assert not exists (select 1 from auth.sessions where id = '44444444-4444-4444-4444-444444444444'), 'auth session deleted'; end $$;

-- Anonymous users see nothing
reset role;
set local role anon;
do $$ begin
  assert (select count(*) from public.estimates) = 0, 'anon sees nothing';
end $$;
reset role;

-- VOID an unissued estimate, then it is frozen
set local role authenticated;
select set_config('request.jwt.uid', '22222222-2222-2222-2222-222222222222', true);
insert into public.estimates (customer_first_name, phone) values ('Void Me', '1');
select public.void_document((select id from public.estimates where customer_first_name = 'Void Me'), 'test');
do $$ begin
  begin
    update public.estimates set notes = 'x' where customer_first_name = 'Void Me';
    raise exception 'void edit should fail';
  exception when raise_exception then
    if sqlerrm like 'void edit%' then raise; end if;
  end;
end $$;

-- Unsigned drafts can be deleted ("Delete" on the unissued warning)
insert into public.estimates (customer_first_name) values ('Delete Me');
delete from public.estimates where customer_first_name = 'Delete Me';
do $$ begin assert not exists (select 1 from public.estimates where customer_first_name = 'Delete Me'), 'draft deleted'; end $$;

reset role;
select 'ALL RULES PASS' as result;
rollback;
