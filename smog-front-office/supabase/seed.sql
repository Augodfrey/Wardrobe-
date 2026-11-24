-- Seed: Smog Zone, Rancho Cordova (ARD 238473) and its starting lists.
-- Run once after migrations (supabase db reset runs it automatically).

insert into public.shops (id, name, street, city, state, zip, phone, ard_number, tax_rate, next_estimate_number)
values ('00000000-0000-0000-0000-000000238473', 'Smog Zone', '10083 Folsom Blvd #D', 'Rancho Cordova',
        'CA', '95670', '(916) 368-9152', '238473', 0.0875, 7875)
on conflict (id) do nothing;

with s as (select '00000000-0000-0000-0000-000000238473'::uuid as id)
insert into public.products (shop_id, code, description, product_type, unit_cost, unit_price, sort_order)
select s.id, v.code, v.descr, v.ptype, v.cost, v.price, v.ord from s, (values
  ('01-TEST',   'Inspection 2000 and newer',            'test',        61.75, 61.75,  1),
  ('012-Test',  'Coupon',                               'test',        41.75, 41.75,  2),
  ('013-Test',  'Suv/Truck Coupon',                     'test',        51.75, 51.75,  3),
  ('014-Test',  'Groupon',                              'test',         0.00,  0.00,  4),
  ('015-Test',  'Dealer',                               'test',        31.75, 31.75,  5),
  ('02-TEST',   'Inspection 1996 through 1999',         'test',        71.75, 71.75,  6),
  ('03-TEST',   'Inspection 1995 and older vehicles',   'test',        81.75, 81.75,  7),
  ('04-TEST',   'Smog inspection / RVs or HD',          'test',        91.75, 91.75,  8),
  ('05-TEST',   'Smog Inspection / Diesel',             'test',        71.75, 71.75,  9),
  ('06-CERT',   'Smog Certificate',                     'certificate',  8.25,  8.25, 10),
  ('07-PRE',    'Pre-inspection',                       'test',        39.75, 39.75, 11),
  ('08-LABOR',  'Hourly Labor Rate',                    'labor',       90.00, 90.00, 12),
  ('09-RETEST', 'Re-inspection',                        'test',         0.00,  0.00, 13),
  ('10-RETEST', 'Older Re-inspection',                  'test',        20.00, 20.00, 14),
  ('11-Test',   'Clean Truck Check',                    'test',        49.75, 49.75, 15)
) as v(code, descr, ptype, cost, price, ord)
on conflict (shop_id, code) do nothing;

with s as (select '00000000-0000-0000-0000-000000238473'::uuid as id)
insert into public.reasons_for_test (shop_id, name, sort_order)
select s.id, v.n, v.o from s, (values
  ('Change of Ownership',1),('Directed',2),('Gross Polluter',3),('Out of State',4),('Smog Test',5)
) v(n,o);

with s as (select '00000000-0000-0000-0000-000000238473'::uuid as id)
insert into public.referral_sources (shop_id, name, sort_order)
select s.id, v.n, v.o from s, (values
  ('Coupon',1),('Internet',2),('Repeat Customer',3),('Walk in',4),('Yellow Pages',5)
) v(n,o);

with s as (select '00000000-0000-0000-0000-000000238473'::uuid as id)
insert into public.payment_types (shop_id, name, is_card, card_fee_percent, is_company_account, sort_order)
select s.id, v.n, v.card, v.fee, v.co, v.o from s, (values
  ('Cash',false,0,false,1),('Visa',true,0,false,2),('Mastercard',true,0,false,3),
  ('Amex',true,0,false,4),('Check',false,0,false,5),('Zelle',false,0,false,6),
  ('Company Account',false,0,true,7)
) v(n,card,fee,co,o);

with s as (select '00000000-0000-0000-0000-000000238473'::uuid as id)
insert into public.discount_terms (shop_id, name, percent, amount, sort_order)
select s.id, v.n, v.p, v.a, v.o from s, (values
  ('None',0,0,1),('Coupon $10',0,10,2),('10% Off',10,0,3),('Military 15%',15,0,4)
) v(n,p,a,o);

-- Price lists: Regular uses catalog prices; others override per product
with s as (select '00000000-0000-0000-0000-000000238473'::uuid as id)
insert into public.price_lists (shop_id, name, is_default, sort_order)
select s.id, v.n, v.d, v.o from s, (values
  ('Regular',true,1),('STAR',false,2),('Coupon',false,3),('Dealer',false,4),('Groupon',false,5)
) v(n,d,o);

insert into public.price_list_items (shop_id, price_list_id, product_id, unit_price)
select p.shop_id, pl.id, p.id,
  case pl.name
    when 'Dealer'  then case when p.product_type = 'test' then 31.75 else p.unit_price end
    when 'STAR'    then case when p.product_type = 'test' then p.unit_price + 10 else p.unit_price end
    when 'Coupon'  then case when p.product_type = 'test' then greatest(p.unit_price - 20, 0) else p.unit_price end
    when 'Groupon' then case when p.product_type = 'test' then 0 else p.unit_price end
    else p.unit_price end
from public.products p join public.price_lists pl on pl.shop_id = p.shop_id
on conflict (price_list_id, product_id) do nothing;
