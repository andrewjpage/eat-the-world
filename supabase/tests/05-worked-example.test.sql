-- The brief's worked example (section 3), in two confirmation orders, plus Dan, a second Lao
-- restaurant listed later, and Alice deleting her account.
begin;
select plan(41);

set local app.now = '2026-07-15 19:30:00+01';

select tests.create_user('alice@test.local') as alice \gset
select tests.create_user('bob@test.local') as bob \gset
select tests.create_user('cara@test.local') as cara \gset
select tests.create_user('dan@test.local') as dan \gset
select tests.create_user('alice2@test.local') as alice2 \gset
select tests.create_user('bob2@test.local') as bob2 \gset
select tests.create_user('cara2@test.local') as cara2 \gset

select tests.add_city('worked-example-city', array['LA']) as city \gset
select tests.add_restaurant(:'city', 'LA', 'Lao Cafe (worked example)') as r_lao \gset
select tests.add_dish('LA', 'Larb (worked example)', 'approved') as larb \gset

select tests.make_group(:'alice', 'Worked example', array[:'bob', :'cara', :'dan']::uuid[]) as g \gset
select tests.make_group(:'alice2', 'Worked example, other order', array[:'bob2', :'cara2']::uuid[]) as g2 \gset

-- ---------------------------------------------------------------- order 1: Alice, Bob, Cara
-- 1. Alice checks in, tags Bob and Cara, and picks Larb.
select tests.authenticate_as(:'alice');
select tests.checkin(:'r_lao', :'g', array[:'bob', :'cara']::uuid[], :'larb') as res_a \gset
reset role;
select (:'res_a'::jsonb) ->> 'visit_id' as v \gset

select is((:'res_a'::jsonb) ->> 'outcome', 'stamped', 'Alice: stamped at check-in');
select is((:'res_a'::jsonb) -> 'points', '{"base": 10, "rarity": 15, "table": 0, "dish": 2, "total": 27}'::jsonb,
  'Alice: points 10 + 15 + 2 = 27');
select is(((:'res_a'::jsonb) ->> 'table_pending')::int, 2, 'Alice: +5 when 2 more confirm');
select is(((:'res_a'::jsonb) ->> 'first_in_group')::boolean, true, 'Alice: first in the group');
select is((:'res_a'::jsonb) ->> 'country_iso2', 'LA', 'Alice: country LA');
select is(tests.points(:'alice', 'LA'), 27, 'Alice: stored stamp 27');
select is((tests.visit_of(:'v') ->> 'rarity_bonus')::int, 15, 'visit rarity frozen at 15');
select is(tests.attendance_of(:'v', :'alice') ->> 'status', 'confirmed', 'Alice has a confirmed attendance');
select is(tests.attendance_of(:'v', :'bob') ->> 'status', 'pending', 'Bob has a pending attendance');
select is(tests.stamp_of(:'bob', 'LA'), null, 'Bob has no stamp before confirming');

-- 2. Bob confirms with Larb.
select tests.authenticate_as(:'bob');
select tests.confirm(:'v', :'larb') as res_b \gset
reset role;
select is((:'res_b'::jsonb) ->> 'outcome', 'stamped', 'Bob: stamped on confirm');
select is(((:'res_b'::jsonb) -> 'points' ->> 'total')::int, 27, 'Bob: 27');
select is(((:'res_b'::jsonb) ->> 'table_pending')::int, 1, 'Bob: +5 when 1 more confirms');
select is(((:'res_b'::jsonb) ->> 'first_in_group')::boolean, false, 'Bob: not first in the group');
select is(tests.points(:'bob', 'LA'), 27, 'Bob: stored stamp 27');
select is(tests.points(:'alice', 'LA'), 27, 'Alice: still 27 with two confirmed');

-- 3. Cara confirms with Larb; the visit reaches 3.
select tests.authenticate_as(:'cara');
select tests.confirm(:'v', :'larb') as res_c \gset
reset role;
select is(((:'res_c'::jsonb) -> 'points' ->> 'total')::int, 32, 'Cara: 32');
select is(((:'res_c'::jsonb) ->> 'table_pending')::int, 0, 'Cara: table bonus applies');
select is(tests.points(:'alice', 'LA'), 32, 'Alice: 32');
select is(tests.points(:'bob', 'LA'), 32, 'Bob: 32');
select is(tests.points(:'cara', 'LA'), 32, 'Cara: 32');
select is((select array_agg(points::int order by user_id) from public.stamp_totals where visit_id = :'v'),
  array[32, 32, 32], 'stamp_totals: 32 for all three');

-- Dan, who wasn't there, gets nothing.
select is(tests.stamp_of(:'dan', 'LA'), null, 'Dan gets nothing');
select tests.authenticate_as(:'dan');
select throws_ok(format('select public.confirm_attendance(%L, %L, null, null, null)', :'v', :'larb'),
  null, null, 'Dan cannot confirm a visit he was not tagged on');
reset role;

-- ---------------------------------------------------------------- order 2: Alice, Cara, Bob
select tests.authenticate_as(:'alice2');
select tests.checkin(:'r_lao', :'g2', array[:'bob2', :'cara2']::uuid[], :'larb') as res_a2 \gset
reset role;
select (:'res_a2'::jsonb) ->> 'visit_id' as v2 \gset
select is(((:'res_a2'::jsonb) -> 'points' ->> 'total')::int, 27, 'order 2, Alice: 27');
select is(((:'res_a2'::jsonb) ->> 'first_in_group')::boolean, true, 'order 2, Alice: first in her group');

select tests.authenticate_as(:'cara2');
select tests.confirm(:'v2', :'larb') as res_c2 \gset
reset role;
select is(((:'res_c2'::jsonb) -> 'points' ->> 'total')::int, 27, 'order 2, Cara first: 27');
select is(tests.points(:'alice2', 'LA'), 27, 'order 2, Alice still 27');

select tests.authenticate_as(:'bob2');
select tests.confirm(:'v2', :'larb') as res_b2 \gset
reset role;
select is(((:'res_b2'::jsonb) -> 'points' ->> 'total')::int, 32, 'order 2, Bob last: 32');
select is((select array_agg(tests.points(u, 'LA') order by u) from unnest(array[:'alice2', :'bob2', :'cara2']::uuid[]) as u),
  array[32, 32, 32], 'order 2: all three at 32');

-- ---------------------------------------------------------------- a second Lao restaurant listed later
set local app.now = '2026-08-15 19:30:00+01';
select tests.add_restaurant(:'city', 'LA', 'Second Lao (worked example)') as r_lao2 \gset
select is((select count(*)::int from public.stamps where country_iso2 = 'LA'
           and user_id in (:'alice', :'bob', :'cara', :'alice2', :'bob2', :'cara2')
           and base + rarity_bonus + table_bonus + dish_bonus = 32),
  6, 'a second Lao restaurant listed later leaves all six stamps at 32');
select is((tests.visit_of(:'v') ->> 'rarity_bonus')::int, 15, 'the visit keeps rarity 15');

-- A new visit now sees two listed Lao restaurants: rarity 10.
select tests.authenticate_as(:'dan');
select tests.checkin(:'r_lao2', :'g') as res_d \gset
reset role;
select is(((:'res_d'::jsonb) -> 'points' ->> 'rarity')::int, 10, 'a later visit gets rarity 10 (2 listed)');
select is(tests.points(:'dan', 'LA'), 20, 'Dan, solo later: 10 + 10');
select is(((:'res_d'::jsonb) ->> 'first_in_group')::boolean, false, 'Dan is not first in the group');

-- ---------------------------------------------------------------- Alice deletes her account
select tests.authenticate_as(:'alice');
select public.delete_my_account() as deleted_paths \gset
reset role;
select is(tests.points(:'bob', 'LA'), 32, 'after Alice deletes her account, Bob stays at 32');
select is(tests.points(:'cara', 'LA'), 32, 'after Alice deletes her account, Cara stays at 32');
select isnt(tests.visit_of(:'v'), null, 'the visit is kept');
select is(tests.visit_of(:'v') ->> 'created_by', null, 'the kept visit has created_by null');
select is(tests.stamp_of(:'alice', 'LA'), null, 'Alice''s stamp is gone');
select is((select count(*)::int from auth.users where id = :'alice'), 0, 'Alice''s auth user is gone');

select * from finish();
rollback;
