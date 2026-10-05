-- group_leaderboard (brief section 3): season = inclusive Europe/London dates, counting visit
-- stamps by their visit's visited_at and set awards by awarded_at; verified_only counts only
-- geo_verified and photo stamps. Plus group_together and group_gaps (visit stamps, listed only).
begin;
select plan(18);

select tests.create_user('ann@test.local') as ann \gset
select tests.create_user('ben@test.local') as ben \gset
select tests.create_user('cat@test.local') as cat \gset
select tests.create_user('xena@test.local') as xena \gset
select tests.add_city('leaderboard-city', array['NP', 'MN', 'BT', 'FI', 'IS', 'NO']) as city \gset
select tests.add_restaurant(:'city', 'NP', 'Board NP') as r_np \gset
select tests.add_restaurant(:'city', 'MN', 'Board MN') as r_mn \gset
select tests.add_restaurant(:'city', 'BT', 'Board BT') as r_bt \gset
select tests.add_restaurant(:'city', 'FI', 'Board FI') as r_fi \gset
select tests.add_restaurant(:'city', 'IS', 'Board IS') as r_is \gset
select tests.add_set('board-set-a', array['NP', 'MN']) as set_a \gset
select tests.add_set('board-set-b', array['BT', 'FI']) as set_b \gset
select tests.make_group(:'ann', 'Board group', array[:'ben', :'cat']::uuid[]) as g \gset

select tests.authenticate_as(:'ann');
select public.update_group_settings(:'g', 'Board group', false, '2026-07-01', '2026-07-31');
reset role;

-- ---------------------------------------------------------------- Ann: visits either side of both season edges
set local app.now = '2026-06-30 22:30:00+00';   -- 23:30 BST 30 June: before the season
select tests.authenticate_as(:'ann');
select tests.checkin(:'r_np', :'g') as ann_np \gset
set local app.now = '2026-06-30 23:00:00+00';   -- 00:00 BST 1 July: first moment of the season; completes set A
select tests.checkin(:'r_mn', :'g') as ann_mn \gset
set local app.now = '2026-07-31 22:59:00+00';   -- 23:59 BST 31 July: last minute of the season (geo_verified)
select tests.checkin(:'r_bt', :'g', '{}', null, 51.5074, -0.1278, 10) as ann_bt \gset
set local app.now = '2026-07-31 23:00:00+00';   -- 00:00 BST 1 August: after the season; completes set B
select tests.checkin(:'r_fi', :'g') as ann_fi \gset
reset role;

-- ---------------------------------------------------------------- Ben: four visits on 31 July, one claimed on 1 August
set local app.now = '2026-07-31 10:00:00+01';
select tests.authenticate_as(:'ben');
select tests.checkin(:'r_bt', :'g') as ben_bt \gset
set local app.now = '2026-07-31 11:00:00+01';   -- completes set B
select tests.checkin(:'r_fi', :'g') as ben_fi \gset
set local app.now = '2026-07-31 12:00:00+01';
select tests.checkin(:'r_np', :'g') as ben_np \gset
set local app.now = '2026-07-31 13:00:00+01';
select tests.checkin(:'r_mn', :'g') as ben_mn \gset
set local app.now = '2026-08-01 10:00:00+01';   -- claim completes set A, awarded after the season
select public.claim_stamp(((:'ben_mn'::jsonb) ->> 'visit_id')::uuid) as ben_claim \gset
reset role;
select is((:'ben_mn'::jsonb) ->> 'outcome', 'waiting', 'fixture: Ben''s 4th stamp on 31 July waited');
select is((:'ben_claim'::jsonb) ->> 'outcome', 'stamped', 'fixture: Ben claimed it on 1 August');

-- Cat has only a backfilled IS.
select tests.authenticate_as(:'cat');
select public.backfill_countries(array['IS']) as cat_n \gset
reset role;

-- ---------------------------------------------------------------- all-time and season
select tests.authenticate_as(:'ann');
select is((select countries::int || '/' || points::int from public.group_leaderboard(:'g', false) where user_id = :'ann'),
  '4/150', 'all-time, Ann: 4 countries, 4 x 25 + 2 sets');
select is((select countries::int || '/' || points::int from public.group_leaderboard(:'g', false) where user_id = :'ben'),
  '4/150', 'all-time, Ben: 4 countries, 4 x 25 + 2 sets');
select is((select countries::int || '/' || points::int from public.group_leaderboard(:'g', true) where user_id = :'ann'),
  '2/75', 'season, Ann: 1 July 00:00 and 31 July 23:59 count, set A (awarded 1 July) counts');
select is((select countries::int || '/' || points::int from public.group_leaderboard(:'g', true) where user_id = :'ben'),
  '4/125', 'season, Ben: a stamp claimed after the season counts by visited_at; set A (awarded 1 August) does not');
select is(coalesce((select countries::int from public.group_leaderboard(:'g', false) where user_id = :'cat'), 0), 0,
  'a backfill-only member has 0 countries');

-- ---------------------------------------------------------------- group_together and group_gaps
select is((select stamped::int || '/' || listed::int from public.group_together(:'g', :'city')), '4/5',
  'Together: 4 of 5 listed countries visit-stamped by the group (backfill excluded)');
select is((select array_agg(country_iso2::text order by country_iso2) from public.group_gaps(:'g', :'city')), array['IS'],
  'Gaps: the listed country no member has a visit stamp for');
reset role;

-- ---------------------------------------------------------------- verified_only
select tests.authenticate_as(:'ann');
select public.set_visit_photo(((:'ann_mn'::jsonb) ->> 'visit_id')::uuid, :'g' || '/' || ((:'ann_mn'::jsonb) ->> 'visit_id') || '.jpg');
select public.update_group_settings(:'g', 'Board group', true, '2026-07-01', '2026-07-31');
select is((select verified_only from public.groups where id = :'g'), true, 'verified_only is on');
select is((select countries::int from public.group_leaderboard(:'g', false) where user_id = :'ann'), 2,
  'verified_only, all-time, Ann: only the geo_verified BT and the photo MN count');
select is(coalesce((select countries::int from public.group_leaderboard(:'g', false) where user_id = :'ben'), 0), 0,
  'verified_only, all-time, Ben: self-reported stamps do not count');
select is((select countries::int from public.group_leaderboard(:'g', true) where user_id = :'ann'), 2,
  'verified_only, season, Ann: 2');
select ok((select points::int from public.group_leaderboard(:'g', false) where user_id = :'ann') >= 50,
  'verified_only, all-time, Ann: at least the two verified stamps score');
select ok((select points::int from public.group_leaderboard(:'g', false) where user_id = :'ann') < 150,
  'verified_only, all-time, Ann: self-reported stamps no longer score');
reset role;

-- Season edge with verified_only off again, season moved to August only.
select tests.authenticate_as(:'ann');
select public.update_group_settings(:'g', 'Board group', false, '2026-08-01', '2026-08-31');
select is((select countries::int || '/' || points::int from public.group_leaderboard(:'g', true) where user_id = :'ann'),
  '1/50', 'August season, Ann: FI at 00:00 BST 1 August counts, and set B awarded then');
select is(coalesce((select countries::int from public.group_leaderboard(:'g', true) where user_id = :'ben'), 0) || '/' ||
          coalesce((select points::int from public.group_leaderboard(:'g', true) where user_id = :'ben'), 0),
  '0/25', 'August season, Ben: no August visits, set A awarded 1 August');
reset role;

-- Members only.
select tests.authenticate_as(:'xena');
select ok(tests.try_count(format('select * from public.group_leaderboard(%L, false)', :'g')) <= 0, 'a non-member gets no leaderboard');
reset role;

select * from finish();
rollback;
