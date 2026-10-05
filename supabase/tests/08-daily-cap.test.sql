-- Daily cap (brief section 2): at most 3 visit stamps created, claimed or upgraded per user per
-- Europe/London day, counted on stamps.stamped_at. Over the cap the attendance waits; claim from
-- the next London day keeps the frozen bonuses. Repeats and backfill never count; a capped
-- attendance never blocks a later stamp; check-ins and confirmations are never refused.
begin;
select plan(47);

select tests.create_user('alice@test.local') as alice \gset
select tests.create_user('bob@test.local') as bob \gset
select tests.create_user('cara@test.local') as cara \gset
select tests.create_user('bea@test.local') as bea \gset
select tests.create_user('cleo@test.local') as cleo \gset
select tests.create_user('rex@test.local') as rex \gset
select tests.create_user('bf@test.local') as bf \gset

select tests.add_city('cap-city', array['NP','MN','BT','FI','IS','NO','SE','DK','IE','CH','AT']) as city \gset
select tests.add_restaurant(:'city', 'NP', 'Cap NP') as r_np \gset
select tests.add_restaurant(:'city', 'MN', 'Cap MN') as r_mn \gset
select tests.add_restaurant(:'city', 'BT', 'Cap BT') as r_bt \gset
select tests.add_restaurant(:'city', 'FI', 'Cap FI') as r_fi \gset
select tests.add_restaurant(:'city', 'IS', 'Cap IS') as r_is \gset
select tests.add_restaurant(:'city', 'NO', 'Cap NO') as r_no \gset
select tests.add_dish('FI', 'Karjalanpiirakka (cap test)', 'approved') as dish_fi \gset

select tests.make_group(:'alice', 'Cap group',
  array[:'bob', :'cara', :'bea', :'cleo', :'rex', :'bf']::uuid[]) as g \gset

-- ---------------------------------------------------------------- A: waiting, claim, frozen bonuses
-- Bob collects 3 stamps on Wednesday 15 July 2026 (BST).
set local app.now = '2026-07-15 10:00:00+01';
select tests.authenticate_as(:'bob');
select tests.checkin(:'r_np', :'g') as a1 \gset
set local app.now = '2026-07-15 11:00:00+01';
select tests.checkin(:'r_mn', :'g') as a2 \gset
set local app.now = '2026-07-15 12:00:00+01';
select tests.checkin(:'r_bt', :'g') as a3 \gset
reset role;
select is((:'a3'::jsonb) ->> 'outcome', 'stamped', 'A: third stamp of the day is created');

-- Alice checks in at the FI restaurant (the only one) and tags Bob and Cara.
set local app.now = '2026-07-15 19:00:00+01';
select tests.authenticate_as(:'alice');
select tests.checkin(:'r_fi', :'g', array[:'bob', :'cara']::uuid[]) as a_fi \gset
reset role;
select (:'a_fi'::jsonb) ->> 'visit_id' as v_fi \gset

set local app.now = '2026-07-15 19:05:00+01';
select tests.authenticate_as(:'bob');
select tests.confirm(:'v_fi', :'dish_fi') as a_bob \gset
reset role;
select is((:'a_bob'::jsonb) ->> 'outcome', 'waiting', 'A: Bob''s 4th of the day waits (confirmation not refused)');
select is(tests.attendance_of(:'v_fi', :'bob') ->> 'status', 'confirmed', 'A: Bob''s attendance is confirmed');
select is((tests.attendance_of(:'v_fi', :'bob') ->> 'stamp_waiting')::boolean, true, 'A: stamp_waiting = true');
select is(tests.stamp_of(:'bob', 'FI'), null, 'A: no FI stamp yet');

-- Cara confirms: 3 confirmed (Bob counts, though waiting), so the table bonus applies.
set local app.now = '2026-07-15 19:10:00+01';
select tests.authenticate_as(:'cara');
select tests.confirm(:'v_fi') as a_cara \gset
reset role;
select is((tests.stamp_of(:'alice', 'FI') ->> 'table_bonus')::int, 5, 'A: a waiting confirmed attendee counts toward the table');

-- A second FI restaurant opens later that evening; Bob's claim must keep the frozen rarity.
select tests.add_restaurant(:'city', 'FI', 'Cap FI 2') as r_fi2 \gset

-- Claim at 23:59:59 the same London day: still waiting.
set local app.now = '2026-07-15 22:59:59+00';
select tests.authenticate_as(:'bob');
select public.claim_stamp(:'v_fi') as a_claim1 \gset
reset role;
select is((:'a_claim1'::jsonb) ->> 'outcome', 'waiting', 'A: claim at 23:59:59 the same London day keeps waiting');
select is(tests.stamp_of(:'bob', 'FI'), null, 'A: still no FI stamp');
select is((tests.attendance_of(:'v_fi', :'bob') ->> 'stamp_waiting')::boolean, true, 'A: still stamp_waiting');

-- Claim at 00:00:00 the next London day: stamped with the frozen bonuses.
set local app.now = '2026-07-15 23:00:00+00';
select tests.authenticate_as(:'bob');
select public.claim_stamp(:'v_fi') as a_claim2 \gset
reset role;
select is((:'a_claim2'::jsonb) ->> 'outcome', 'stamped', 'A: claim at 00:00:00 the next London day succeeds');
select is((tests.stamp_of(:'bob', 'FI') ->> 'rarity_bonus')::int, 15, 'A: claim keeps the visit''s frozen rarity');
select is((tests.stamp_of(:'bob', 'FI') ->> 'table_bonus')::int, 5, 'A: claim keeps the table bonus');
select is((tests.stamp_of(:'bob', 'FI') ->> 'dish_bonus')::int, 2, 'A: claim keeps the dish bonus');
select is(tests.points(:'bob', 'FI'), 32, 'A: claimed stamp 32');
select is((tests.stamp_of(:'bob', 'FI') ->> 'stamped_at')::timestamptz, '2026-07-15 23:00:00+00'::timestamptz, 'A: stamped_at is the claim time');
select is((tests.stamp_of(:'bob', 'FI') ->> 'earned_at')::timestamptz, (tests.visit_of(:'v_fi') ->> 'visited_at')::timestamptz,
  'A: earned_at is the visit time');
select is((tests.stamp_of(:'bob', 'FI') ->> 'visit_id')::uuid, :'v_fi'::uuid, 'A: stamp points at the visit');
select is((tests.attendance_of(:'v_fi', :'bob') ->> 'stamp_waiting')::boolean, false, 'A: stamp_waiting cleared after the claim');

-- ---------------------------------------------------------------- B: midnight boundary on a BST date
set local app.now = '2026-07-20 10:00:00+01';
select tests.authenticate_as(:'bea');
select tests.checkin(:'r_np', :'g') as b1 \gset
set local app.now = '2026-07-20 20:00:00+01';
select tests.checkin(:'r_mn', :'g') as b2 \gset
set local app.now = '2026-07-20 22:59:59+00';   -- 23:59:59 BST, 20 July
select tests.checkin(:'r_bt', :'g') as b3 \gset
select tests.checkin(:'r_fi', :'g') as b4 \gset
set local app.now = '2026-07-20 23:00:00+00';   -- 00:00:00 BST, 21 July
select tests.checkin(:'r_is', :'g') as b5 \gset
select public.claim_stamp(((:'b4'::jsonb) ->> 'visit_id')::uuid) as b4_claim \gset
reset role;
select is((:'b3'::jsonb) ->> 'outcome', 'stamped', 'B: 3rd stamp at 23:59:59 BST is created');
select is((:'b4'::jsonb) ->> 'outcome', 'waiting', 'B: 4th at 23:59:59 BST waits');
select is((:'b5'::jsonb) ->> 'outcome', 'stamped', 'B: at 00:00:00 BST the next day a new stamp is created');
select is((:'b4_claim'::jsonb) ->> 'outcome', 'stamped', 'B: the waiting stamp is claimed at 00:00:00 BST');
select is(tests.stamp_count(:'bea'), 5, 'B: bea has 5 stamps');

-- ---------------------------------------------------------------- D: repeats never refused, never counted
set local app.now = '2026-07-25 09:00:00+01';
select tests.authenticate_as(:'rex');
select tests.checkin(:'r_np', :'g') as d1 \gset
set local app.now = '2026-07-25 10:00:00+01';
select tests.checkin(:'r_np', :'g') as d2 \gset
set local app.now = '2026-07-25 11:00:00+01';
select tests.checkin(:'r_np', :'g') as d3 \gset
set local app.now = '2026-07-25 12:00:00+01';
select tests.checkin(:'r_mn', :'g') as d4 \gset
set local app.now = '2026-07-25 13:00:00+01';
select tests.checkin(:'r_bt', :'g') as d5 \gset
set local app.now = '2026-07-25 14:00:00+01';
select tests.checkin(:'r_fi', :'g') as d6 \gset
set local app.now = '2026-07-25 15:00:00+01';
select tests.checkin(:'r_np', :'g') as d7 \gset
reset role;
select is((:'d2'::jsonb) ->> 'outcome', 'repeat', 'D: second NP visit is a repeat');
select is((:'d3'::jsonb) ->> 'outcome', 'repeat', 'D: third NP visit is a repeat');
select is((:'d5'::jsonb) ->> 'outcome', 'stamped', 'D: repeats did not use up the cap: 3rd new stamp created');
select is((:'d6'::jsonb) ->> 'outcome', 'waiting', 'D: 4th new country waits');
select is((:'d7'::jsonb) ->> 'outcome', 'repeat', 'D: a repeat over the cap is a repeat, not refused and not waiting');
select is((tests.attendance_of(((:'d7'::jsonb) ->> 'visit_id')::uuid, :'rex') ->> 'stamp_waiting')::boolean, false,
  'D: a repeat over the cap is not marked waiting');
select is((select count(*)::int from public.visits where created_by = :'rex'), 7, 'D: all 7 check-ins were saved');
select is(tests.stamp_count(:'rex'), 3, 'D: rex has 3 stamps');

-- ---------------------------------------------------------------- E: a capped attendance does not block a later stamp
set local app.now = '2026-07-26 12:00:00+01';
select tests.authenticate_as(:'rex');
select tests.checkin(:'r_fi2', :'g') as e1 \gset
reset role;
select is((:'e1'::jsonb) ->> 'outcome', 'stamped', 'E: a later FI visit stamps despite the waiting FI attendance');
select is((tests.stamp_of(:'rex', 'FI') ->> 'visit_id')::uuid, ((:'e1'::jsonb) ->> 'visit_id')::uuid, 'E: the stamp comes from the later visit');
select tests.authenticate_as(:'rex');
select public.claim_stamp(((:'d6'::jsonb) ->> 'visit_id')::uuid) as e_claim \gset
reset role;
select ok((:'e_claim'::jsonb) ->> 'outcome' in ('repeat', 'no_change'), 'E: claiming the old waiting attendance changes nothing');
select is((tests.stamp_of(:'rex', 'FI') ->> 'visit_id')::uuid, ((:'e1'::jsonb) ->> 'visit_id')::uuid, 'E: the stamp still comes from the later visit');

-- ---------------------------------------------------------------- F: backfill never counts toward the cap
set local app.now = '2026-07-27 09:00:00+01';
select tests.authenticate_as(:'bf');
select public.backfill_countries(array['SE', 'DK', 'IE', 'CH', 'AT']) as f_backfilled \gset
set local app.now = '2026-07-27 10:00:00+01';
select tests.checkin(:'r_np', :'g') as f1 \gset
select tests.checkin(:'r_mn', :'g') as f2 \gset
select tests.checkin(:'r_bt', :'g') as f3 \gset
select tests.checkin(:'r_is', :'g') as f4 \gset
select public.backfill_countries(array['NO']) as f_backfilled2 \gset
reset role;
select is(:'f_backfilled'::int, 5, 'F: 5 countries backfilled');
select is((:'f3'::jsonb) ->> 'outcome', 'stamped', 'F: 3 visit stamps after 5 backfills the same day');
select is((:'f4'::jsonb) ->> 'outcome', 'waiting', 'F: the 4th visit stamp waits');
select is(:'f_backfilled2'::int, 1, 'F: backfill still works when the day is full');

-- ---------------------------------------------------------------- C: across the 25 October 2026 clock change
-- BST ends at 01:00 UTC on Sunday 25 October; that London day runs 2026-10-24 23:00Z to 2026-10-26 00:00Z.
set local app.now = '2026-10-24 22:59:59+00';   -- 23:59:59 BST, Saturday 24 October
select tests.authenticate_as(:'cleo');
select tests.checkin(:'r_np', :'g') as c1 \gset
set local app.now = '2026-10-24 23:00:00+00';   -- 00:00:00 BST, Sunday 25 October
select tests.checkin(:'r_mn', :'g') as c2 \gset
set local app.now = '2026-10-25 12:00:00+00';   -- 12:00 GMT
select tests.checkin(:'r_bt', :'g') as c3 \gset
set local app.now = '2026-10-25 23:30:00+00';   -- 23:30 GMT, still 25 October
select tests.checkin(:'r_fi', :'g') as c4 \gset
set local app.now = '2026-10-25 23:59:59+00';   -- 23:59:59 GMT, still 25 October
select tests.checkin(:'r_is', :'g') as c5 \gset
set local app.now = '2026-10-26 00:00:00+00';   -- 00:00:00 GMT, Monday 26 October
select tests.checkin(:'r_no', :'g') as c6 \gset
select public.claim_stamp(((:'c5'::jsonb) ->> 'visit_id')::uuid) as c5_claim \gset
reset role;
select is((:'c1'::jsonb) ->> 'outcome', 'stamped', 'C: 23:59:59 BST on 24 Oct is stamped (24 Oct)');
select is((:'c2'::jsonb) ->> 'outcome', 'stamped', 'C: 00:00 BST on 25 Oct starts a new day');
select is((:'c3'::jsonb) ->> 'outcome', 'stamped', 'C: 2nd stamp of 25 Oct');
select is((:'c4'::jsonb) ->> 'outcome', 'stamped', 'C: 23:30 GMT is still 25 Oct: 3rd stamp');
select is((:'c5'::jsonb) ->> 'outcome', 'waiting', 'C: 23:59:59 GMT on 25 Oct (a 25-hour day) waits');
select is((:'c6'::jsonb) ->> 'outcome', 'stamped', 'C: 00:00 GMT on 26 Oct is a new day');
select is((:'c5_claim'::jsonb) ->> 'outcome', 'stamped', 'C: the waiting stamp is claimed on 26 Oct');
select is(tests.stamp_count(:'cleo'), 6, 'C: cleo has 6 stamps');

select * from finish();
rollback;
