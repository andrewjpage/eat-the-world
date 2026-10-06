-- Rarity bonus (brief section 3): counted at check-in from restaurants with status active or
-- reported_closed in the city for the country, plus the visited restaurant whatever its status
-- (minimum 1). 1 -> 15, 2-3 -> 10, 4-9 -> 5, 10+ -> 0. Frozen on the visit, same for everyone.
begin;
select plan(22);

select tests.create_user('rita@test.local') as rita \gset
select tests.create_user('bob@test.local') as bob \gset
select tests.create_user('cara@test.local') as cara \gset
select tests.add_city('rarity-city', array['NP','MN','BT','FI','IS','NO','SE','DK','IE','CH','AT']) as city \gset
select tests.make_group(:'rita', 'Rarity group', array[:'bob', :'cara']::uuid[]) as g \gset

-- Restaurant counts per country (name '<ISO> 1' is the one visited).
select count(tests.add_restaurant(:'city', c, 'Rarity ' || c || ' ' || i))
from (values ('NP', 1), ('MN', 2), ('BT', 3), ('FI', 4), ('IS', 9), ('NO', 10)) as v(c, n),
     generate_series(1, v.n) as i;
select tests.add_restaurant(:'city', 'SE', 'Rarity SE 1') as r_se \gset
select tests.add_restaurant(:'city', 'SE', 'Rarity SE closure reported', 'reported_closed') as r_se_rc \gset
select tests.add_restaurant(:'city', 'DK', 'Rarity DK closed', 'closed') as r_dk \gset
select tests.add_restaurant(:'city', 'IE', 'Rarity IE closed', 'closed') as r_ie \gset
select tests.add_restaurant(:'city', 'IE', 'Rarity IE active') as r_ie_active \gset
select tests.add_restaurant(:'city', 'CH', 'Rarity CH 1') as r_ch \gset
select tests.add_restaurant(:'city', 'CH', 'Rarity CH closed a', 'closed') as r_ch_c1 \gset
select tests.add_restaurant(:'city', 'CH', 'Rarity CH closed b', 'closed') as r_ch_c2 \gset
select tests.add_restaurant(:'city', 'CH', 'Rarity CH pending', 'pending') as r_ch_p \gset
select tests.add_restaurant(:'city', 'AT', 'Rarity AT reported', 'reported_closed') as r_at \gset

select id as r_np from public.restaurants where name = 'Rarity NP 1' \gset
select id as r_mn from public.restaurants where name = 'Rarity MN 1' \gset
select id as r_bt from public.restaurants where name = 'Rarity BT 1' \gset
select id as r_fi from public.restaurants where name = 'Rarity FI 1' \gset
select id as r_is from public.restaurants where name = 'Rarity IS 1' \gset
select id as r_no from public.restaurants where name = 'Rarity NO 1' \gset

-- One check-in per day, so the daily cap never interferes.
set local app.now = '2026-07-01 12:00:00+01';
select tests.authenticate_as(:'rita');
select tests.checkin(:'r_np', :'g') as res_np \gset
set local app.now = '2026-07-02 12:00:00+01';
select tests.checkin(:'r_mn', :'g') as res_mn \gset
set local app.now = '2026-07-03 12:00:00+01';
select tests.checkin(:'r_bt', :'g') as res_bt \gset
set local app.now = '2026-07-04 12:00:00+01';
select tests.checkin(:'r_fi', :'g') as res_fi \gset
set local app.now = '2026-07-05 12:00:00+01';
select tests.checkin(:'r_is', :'g') as res_is \gset
set local app.now = '2026-07-06 12:00:00+01';
select tests.checkin(:'r_no', :'g') as res_no \gset
set local app.now = '2026-07-07 12:00:00+01';
select tests.checkin(:'r_dk', :'g') as res_dk \gset
set local app.now = '2026-07-08 12:00:00+01';
select tests.checkin(:'r_ie', :'g') as res_ie \gset
set local app.now = '2026-07-09 12:00:00+01';
select tests.checkin(:'r_ch', :'g') as res_ch \gset
set local app.now = '2026-07-10 12:00:00+01';
select tests.checkin(:'r_at', :'g') as res_at \gset
reset role;

select is((tests.visit_of(((:'res_np'::jsonb) ->> 'visit_id')::uuid) ->> 'rarity_bonus')::int, 15, '1 restaurant -> +15');
select is((tests.visit_of(((:'res_mn'::jsonb) ->> 'visit_id')::uuid) ->> 'rarity_bonus')::int, 10, '2 restaurants -> +10');
select is((tests.visit_of(((:'res_bt'::jsonb) ->> 'visit_id')::uuid) ->> 'rarity_bonus')::int, 10, '3 restaurants -> +10');
select is((tests.visit_of(((:'res_fi'::jsonb) ->> 'visit_id')::uuid) ->> 'rarity_bonus')::int, 5, '4 restaurants -> +5');
select is((tests.visit_of(((:'res_is'::jsonb) ->> 'visit_id')::uuid) ->> 'rarity_bonus')::int, 5, '9 restaurants -> +5');
select is((tests.visit_of(((:'res_no'::jsonb) ->> 'visit_id')::uuid) ->> 'rarity_bonus')::int, 0, '10 restaurants -> 0');
select is((tests.visit_of(((:'res_dk'::jsonb) ->> 'visit_id')::uuid) ->> 'rarity_bonus')::int, 15, 'visited restaurant closed, no others: minimum 1 -> +15');
select is((tests.visit_of(((:'res_ie'::jsonb) ->> 'visit_id')::uuid) ->> 'rarity_bonus')::int, 10, 'visited closed restaurant + 1 active -> 2 -> +10');
select is((tests.visit_of(((:'res_ch'::jsonb) ->> 'visit_id')::uuid) ->> 'rarity_bonus')::int, 15, 'closed and pending restaurants do not count -> +15');
select is((tests.visit_of(((:'res_at'::jsonb) ->> 'visit_id')::uuid) ->> 'rarity_bonus')::int, 15, 'visited reported_closed restaurant counts once -> +15');

select is(((:'res_no'::jsonb) -> 'points' ->> 'rarity')::int, 0, 'StampResult rarity 0 for 10 restaurants');
select is(tests.points(:'rita', 'NO'), 10, 'stamp with no rarity: 10');
select is(tests.points(:'rita', 'FI'), 15, 'stamp with +5 rarity: 15');
select is(tests.points(:'rita', 'DK'), 25, 'closed visited restaurant still gives a full stamp: 25');

-- reported_closed counts: SE has 1 active + 1 reported_closed. Bob and Cara are tagged.
set local app.now = '2026-07-11 12:00:00+01';
select tests.authenticate_as(:'rita');
select tests.checkin(:'r_se', :'g', array[:'bob', :'cara']::uuid[]) as res_se \gset
reset role;
select (:'res_se'::jsonb) ->> 'visit_id' as v_se \gset
select is((tests.visit_of(:'v_se') ->> 'rarity_bonus')::int, 10, 'a reported_closed restaurant counts: 2 -> +10');

-- After check-in, two more SE restaurants open (4 listed). The rarity stays frozen for the table.
select tests.add_restaurant(:'city', 'SE', 'Rarity SE late 1') as r_se_l1 \gset
select tests.add_restaurant(:'city', 'SE', 'Rarity SE late 2') as r_se_l2 \gset
select tests.authenticate_as(:'bob');
select tests.confirm(:'v_se') as res_se_bob \gset
reset role;
set local app.now = '2026-07-12 09:00:00+01';
select tests.authenticate_as(:'cara');
select tests.confirm(:'v_se') as res_se_cara \gset
reset role;
select is((tests.stamp_of(:'rita', 'SE') ->> 'rarity_bonus')::int, 10, 'checker rarity +10');
select is((tests.stamp_of(:'bob', 'SE') ->> 'rarity_bonus')::int, 10, 'Bob confirms after new listings: still +10');
select is((tests.stamp_of(:'cara', 'SE') ->> 'rarity_bonus')::int, 10, 'Cara confirms next day: still +10');
select is(((:'res_se_bob'::jsonb) -> 'points' ->> 'rarity')::int, 10, 'Bob''s StampResult shows rarity 10');
select is((tests.visit_of(:'v_se') ->> 'rarity_bonus')::int, 10, 'the visit keeps rarity 10');

-- A brand-new visit now counts 4 listed SE restaurants.
select tests.authenticate_as(:'bob');
select tests.checkin(:'r_se_l1', :'g') as res_se_new \gset
reset role;
select is((tests.visit_of(((:'res_se_new'::jsonb) ->> 'visit_id')::uuid) ->> 'rarity_bonus')::int, 5, 'a new visit sees 4 listed -> +5');
select is((tests.stamp_of(:'bob', 'SE') ->> 'rarity_bonus')::int, 10, 'Bob''s repeat visit leaves his stamp unchanged');

select * from finish();
rollback;
