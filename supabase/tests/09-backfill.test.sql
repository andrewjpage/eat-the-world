-- Backfill (brief section 3): 0 points, never on a leaderboard or toward a set, never toward the
-- cap; a later visit upgrades in place (counts toward the cap); remove_backfilled_stamp only
-- removes backfilled stamps.
begin;
select plan(33);

select tests.create_user('pat@test.local') as pat \gset
select tests.create_user('mate@test.local') as mate \gset
select tests.add_city('backfill-city', array['NP', 'MN', 'BT', 'FI', 'IS', 'NO']) as city \gset
select tests.add_restaurant(:'city', 'NP', 'Backfill NP') as r_np \gset
select tests.add_restaurant(:'city', 'MN', 'Backfill MN') as r_mn \gset
select tests.add_restaurant(:'city', 'BT', 'Backfill BT') as r_bt \gset
select tests.add_restaurant(:'city', 'FI', 'Backfill FI') as r_fi \gset
select tests.add_restaurant(:'city', 'IS', 'Backfill IS') as r_is \gset
select tests.make_group(:'pat', 'Backfill group', array[:'mate']::uuid[]) as g \gset

-- ---------------------------------------------------------------- day 1: backfill
set local app.now = '2026-07-10 12:00:00+01';
select tests.authenticate_as(:'pat');
select public.backfill_countries(array['NP', 'MN', 'BT']) as n1 \gset
select public.backfill_countries(array['NP', 'FI']) as n2 \gset
select tests.checkin(:'r_is', :'g') as res_is \gset
select public.backfill_countries(array['IS']) as n3 \gset
reset role;
select is(:'n1'::int, 3, 'backfill_countries creates 3');
select is(:'n2'::int, 1, 'backfill_countries skips a country already backfilled');
select is(:'n3'::int, 0, 'backfill_countries skips a country with a visit stamp');
select is((tests.stamp_of(:'pat', 'IS') ->> 'backfilled')::boolean, false, 'the visit stamp is untouched by backfill');
select is(tests.points(:'pat', 'NP'), 0, 'a backfilled stamp scores 0');
select ok((select bool_and(s.backfilled and s.stamped_at is null and s.visit_id is null
                           and s.base + s.rarity_bonus + s.table_bonus + s.dish_bonus = 0
                           and s.verification = 'self_reported')
           from public.stamps s where s.user_id = :'pat' and s.country_iso2 in ('NP', 'MN', 'BT', 'FI')),
  'backfilled stamps: no stamped_at, no visit, 0 points, self_reported');
select is((tests.stamp_of(:'pat', 'NP') ->> 'earned_at')::timestamptz, '2026-07-10 12:00:00+01'::timestamptz,
  'a backfilled stamp''s earned_at is the backfill time');

-- A set whose listed countries pat has only backfilled is not awarded.
select tests.add_set('backfill-set', array['NP', 'MN']) as set_id \gset
select is((select count(*)::int from public.set_awards where user_id = :'pat'), 0, 'backfilled stamps never complete a set');

-- Backfilled stamps are excluded from the leaderboard.
select tests.authenticate_as(:'mate');
select public.backfill_countries(array['NP', 'MN']) as n_mate \gset
select coalesce((select countries from public.group_leaderboard(:'g', false) where user_id = :'mate'), 0) as mate_countries \gset
select coalesce((select points from public.group_leaderboard(:'g', false) where user_id = :'mate'), 0) as mate_points \gset
select (select countries from public.group_leaderboard(:'g', false) where user_id = :'pat') as pat_countries1 \gset
select (select points from public.group_leaderboard(:'g', false) where user_id = :'pat') as pat_points1 \gset
reset role;
select is(:'mate_countries'::int, 0, 'leaderboard: backfill-only member has 0 countries');
select is(:'mate_points'::int, 0, 'leaderboard: backfill-only member has 0 points');
select is(:'pat_countries1'::int, 1, 'leaderboard: only the visit stamp counts');
select is(:'pat_points1'::int, 25, 'leaderboard: only the visit stamp scores');

-- ---------------------------------------------------------------- day 2: upgrades in place
set local app.now = '2026-07-11 12:00:00+01';
select tests.authenticate_as(:'pat');
select tests.checkin(:'r_np', :'g') as up_np \gset
reset role;
select is((:'up_np'::jsonb) ->> 'outcome', 'upgraded', 'a visit to a backfilled country upgrades it');
select is((tests.stamp_of(:'pat', 'NP') ->> 'backfilled')::boolean, false, 'upgraded: backfilled = false');
select is((tests.stamp_of(:'pat', 'NP') ->> 'visit_id')::uuid, ((:'up_np'::jsonb) ->> 'visit_id')::uuid, 'upgraded: visit_id set');
select is((tests.stamp_of(:'pat', 'NP') ->> 'rarity_bonus')::int, 15, 'upgraded: rarity bonus set');
select is(tests.points(:'pat', 'NP'), 25, 'upgraded: 10 + 15');
select is((tests.stamp_of(:'pat', 'NP') ->> 'earned_at')::timestamptz, '2026-07-11 12:00:00+01'::timestamptz,
  'upgraded: earned_at = the visit time');
select is((tests.stamp_of(:'pat', 'NP') ->> 'stamped_at')::timestamptz, '2026-07-11 12:00:00+01'::timestamptz,
  'upgraded: stamped_at = the upgrade time');
select is((select count(*)::int from public.stamps where user_id = :'pat' and country_iso2 = 'NP'), 1, 'upgraded in place: still one NP stamp');
select is((select count(*)::int from public.set_awards where user_id = :'pat'), 0, 'NP visit + MN backfilled does not complete the set');

set local app.now = '2026-07-11 13:00:00+01';
select tests.authenticate_as(:'pat');
select tests.checkin(:'r_mn', :'g') as up_mn \gset
reset role;
select is((select points::int from public.set_awards where user_id = :'pat' and set_id = :'set_id'), 25,
  'upgrading MN completes the set: +25');

-- Upgrades count toward the cap.
set local app.now = '2026-07-11 14:00:00+01';
select tests.authenticate_as(:'pat');
select tests.checkin(:'r_bt', :'g') as up_bt \gset
set local app.now = '2026-07-11 15:00:00+01';
select tests.checkin(:'r_fi', :'g') as up_fi \gset
reset role;
select is((:'up_bt'::jsonb) ->> 'outcome', 'upgraded', 'third upgrade of the day');
select is((:'up_fi'::jsonb) ->> 'outcome', 'waiting', 'a 4th upgrade the same day waits: upgrades count toward the cap');
select is((tests.stamp_of(:'pat', 'FI') ->> 'backfilled')::boolean, true, 'the waiting country stays backfilled');

set local app.now = '2026-07-12 09:00:00+01';
select tests.authenticate_as(:'pat');
select public.claim_stamp(((:'up_fi'::jsonb) ->> 'visit_id')::uuid) as claim_fi \gset
reset role;
select is((:'claim_fi'::jsonb) ->> 'outcome', 'upgraded', 'claiming the next day upgrades the backfilled stamp');
select is((tests.stamp_of(:'pat', 'FI') ->> 'earned_at')::timestamptz, '2026-07-11 15:00:00+01'::timestamptz,
  'claimed upgrade: earned_at = the visit time');

-- ---------------------------------------------------------------- remove_backfilled_stamp
select tests.authenticate_as(:'pat');
select public.backfill_countries(array['NO']) as n_no \gset
select public.remove_backfilled_stamp('NO');
select tests.try_exec('select public.remove_backfilled_stamp(''NP'')') as ignored \gset
select tests.try_exec('select public.remove_backfilled_stamp(''IS'')') as ignored \gset
reset role;
select is(tests.stamp_of(:'pat', 'NO'), null, 'remove_backfilled_stamp removes a backfilled stamp');
select isnt(tests.stamp_of(:'pat', 'NP'), null, 'remove_backfilled_stamp leaves an upgraded visit stamp');
select isnt(tests.stamp_of(:'pat', 'IS'), null, 'remove_backfilled_stamp leaves a visit stamp');

-- ---------------------------------------------------------------- leaderboard after upgrades
select tests.authenticate_as(:'pat');
select (select countries from public.group_leaderboard(:'g', false) where user_id = :'pat') as pat_countries2 \gset
select (select points from public.group_leaderboard(:'g', false) where user_id = :'pat') as pat_points2 \gset
reset role;
select is(:'pat_countries2'::int, 5, 'leaderboard: 5 visit stamps after upgrades');
select is(:'pat_points2'::int, 150, 'leaderboard: 5 x 25 + 25 set award');
select is((select count(*)::int from public.stamps where user_id = :'mate' and backfilled), 2, 'mate''s backfilled stamps exist');

select * from finish();
rollback;
