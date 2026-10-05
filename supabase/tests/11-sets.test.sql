-- Sets (brief section 3): active in a city when >= 2 of its countries are listed; completed with
-- a visit stamp for every listed country; +25 once per user per set; never revoked; re-checked
-- when stamps are created, restaurants inserted or change status, and sets are edited.
begin;
select plan(17);

select tests.create_user('sam@test.local') as sam \gset
select tests.create_user('sue@test.local') as sue \gset
select tests.create_user('sid@test.local') as sid \gset
select tests.create_user('cleo@test.local') as cleo \gset
update public.profiles set is_curator = true where user_id = :'cleo';

select tests.add_city('sets-city', array['NP', 'MN', 'BT', 'FI', 'IS', 'NO', 'CH', 'AT', 'NL']) as city \gset
select tests.make_group(:'sam', 'Sets group', array[:'sue', :'sid']::uuid[]) as g \gset

select tests.add_restaurant(:'city', 'NP', 'Sets NP') as r_np \gset
select tests.add_set('sets-s1', array['NP', 'MN', 'BT']) as s1 \gset

-- ---------------------------------------------------------------- S1: inactive, then active, awarded once, kept
set local app.now = '2026-07-01 12:00:00+01';
select tests.authenticate_as(:'sam');
select tests.checkin(:'r_np', :'g') as sam_np \gset
reset role;
select is((select count(*)::int from public.set_awards where user_id = :'sam'), 0,
  'a set with 1 listed country is inactive: no award');

select tests.add_restaurant(:'city', 'MN', 'Sets MN') as r_mn \gset
select is((select count(*)::int from public.set_awards where user_id = :'sam'), 0,
  'active set (NP, MN listed) but MN not stamped: no award');

set local app.now = '2026-07-02 12:00:00+01';
select tests.authenticate_as(:'sam');
select tests.checkin(:'r_mn', :'g') as sam_mn \gset
reset role;
select is((select count(*)::int from public.set_awards where user_id = :'sam' and set_id = :'s1'), 1,
  'all listed countries stamped: awarded');
select is((select points::int from public.set_awards where user_id = :'sam' and set_id = :'s1'), 25, 'set award is 25 points');
select is((select city_id from public.set_awards where user_id = :'sam' and set_id = :'s1'), :'city'::uuid,
  'set award records the city');
select is((select awarded_at from public.set_awards where user_id = :'sam' and set_id = :'s1'), '2026-07-02 12:00:00+01'::timestamptz,
  'awarded_at is when the completing stamp was created');

-- BT gets listed: the set now has an unstamped listed country, but the award is never revoked.
set local app.now = '2026-07-03 12:00:00+01';
select tests.add_restaurant(:'city', 'BT', 'Sets BT') as r_bt \gset
select is((select count(*)::int from public.set_awards where user_id = :'sam' and set_id = :'s1'), 1,
  'a newly listed set country does not revoke the award');

set local app.now = '2026-07-04 12:00:00+01';
select tests.authenticate_as(:'sam');
select tests.checkin(:'r_bt', :'g') as sam_bt \gset
reset role;
select is((select count(*)::int from public.set_awards where user_id = :'sam' and set_id = :'s1'), 1,
  'awarded once per user per set');
select is((select awarded_at from public.set_awards where user_id = :'sam' and set_id = :'s1'), '2026-07-02 12:00:00+01'::timestamptz,
  'the original award is kept unchanged');

-- ---------------------------------------------------------------- S2: a closure makes the stamps complete the set
select tests.add_restaurant(:'city', 'FI', 'Sets FI') as r_fi \gset
select tests.add_restaurant(:'city', 'IS', 'Sets IS') as r_is \gset
select tests.add_restaurant(:'city', 'NO', 'Sets NO') as r_no \gset
select tests.add_set('sets-s2', array['FI', 'IS', 'NO']) as s2 \gset
set local app.now = '2026-07-05 12:00:00+01';
select tests.authenticate_as(:'sue');
select tests.checkin(:'r_fi', :'g') as sue_fi \gset
select tests.checkin(:'r_is', :'g') as sue_is \gset
reset role;
select is((select count(*)::int from public.set_awards where user_id = :'sue' and set_id = :'s2'), 0,
  'FI and IS stamped, NO listed: no award');

set local app.now = '2026-07-06 12:00:00+01';
select tests.authenticate_as(:'cleo');
update public.restaurants set status = 'closed' where id = :'r_no';
reset role;
select is((select status from public.city_country_status where city_id = :'city' and country_iso2 = 'NO'), 'unlisted',
  'the only NO restaurant closed: NO unlisted');
select is((select count(*)::int from public.set_awards where user_id = :'sue' and set_id = :'s2'), 1,
  'a listing change that completes the set awards it');
select is((select awarded_at from public.set_awards where user_id = :'sue' and set_id = :'s2'), '2026-07-06 12:00:00+01'::timestamptz,
  'awarded_at is the time of the listing change');

-- ---------------------------------------------------------------- S3: a set edit completes the set
select tests.add_restaurant(:'city', 'CH', 'Sets CH') as r_ch \gset
select tests.add_restaurant(:'city', 'AT', 'Sets AT') as r_at \gset
select tests.add_restaurant(:'city', 'NL', 'Sets NL') as r_nl \gset
select tests.add_set('sets-s3', array['CH', 'AT', 'NL']) as s3 \gset
set local app.now = '2026-07-07 12:00:00+01';
select tests.authenticate_as(:'sid');
select tests.checkin(:'r_ch', :'g') as sid_ch \gset
select tests.checkin(:'r_at', :'g') as sid_at \gset
select public.backfill_countries(array['NL']) as sid_nl \gset
reset role;
select is((select count(*)::int from public.set_awards where user_id = :'sid' and set_id = :'s3'), 0,
  'CH and AT visit-stamped, NL only backfilled: no award');

select tests.authenticate_as(:'cleo');
update public.sets set country_iso2s = array['CH', 'AT'] where id = :'s3';
reset role;
select is((select count(*)::int from public.set_awards where user_id = :'sid' and set_id = :'s3'), 1,
  'editing the set so the stamps complete it awards it');
select is((select count(*)::int from public.set_awards where user_id = :'sue' and set_id = :'s3'), 0,
  'other users are not awarded the edited set');

-- Leaderboard points include the set award.
select tests.authenticate_as(:'sam');
select (select points from public.group_leaderboard(:'g', false) where user_id = :'sam') as sam_points \gset
reset role;
select is(:'sam_points'::int, 3 * 25 + 25, 'leaderboard points include the set award');

select * from finish();
rollback;
