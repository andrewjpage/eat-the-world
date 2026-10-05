-- Verification (brief sections 3 and 4): geo rule accuracy <= 500 and distance - accuracy <= 250,
-- only distance_m (rounded to 10 m) stored; photo raises self_reported; geo stays geo; owner
-- downgrade reaches every stamp and blocks a later photo raise; owner-only downgrade/dismiss.
begin;
select plan(39);

select tests.create_user('olga@test.local') as olga \gset
select tests.create_user('vic@test.local') as vic \gset
select tests.create_user('bob@test.local') as bob \gset
select tests.create_user('cara@test.local') as cara \gset
select tests.add_city('verification-city', array['NP', 'MN', 'BT', 'FI']) as city \gset
-- Every restaurant sits at 51.5074, -0.1278.
select tests.add_restaurant(:'city', 'NP', 'Verify NP') as r_np \gset
select tests.add_restaurant(:'city', 'MN', 'Verify MN') as r_mn \gset
select tests.add_restaurant(:'city', 'BT', 'Verify BT') as r_bt \gset
select tests.add_restaurant(:'city', 'FI', 'Verify FI') as r_fi \gset
select tests.make_group(:'olga', 'Verification group', array[:'vic', :'bob', :'cara']::uuid[]) as g \gset

-- ---------------------------------------------------------------- geo rule
-- 51.510995156908, -0.1278 is 399.99 m due north of the restaurant (WGS84), so distance_m = 400.
set local app.now = '2026-07-01 12:00:00+01';
select tests.authenticate_as(:'vic');
select tests.checkin(:'r_np', :'g') as geo_null \gset
select tests.checkin(:'r_np', :'g', '{}', null, 51.5074, -0.1278, 500) as geo_500 \gset
select tests.checkin(:'r_np', :'g', '{}', null, 51.5074, -0.1278, 501) as geo_501 \gset
select tests.checkin(:'r_np', :'g', '{}', null, 51.510995156908, -0.1278, 150) as geo_250 \gset
select tests.checkin(:'r_np', :'g', '{}', null, 51.510995156908, -0.1278, 149) as geo_251 \gset
select tests.checkin(:'r_np', :'g', '{}', null, 51.510995156908, -0.1278, 600) as geo_600 \gset
reset role;
select ((:'geo_null'::jsonb) ->> 'visit_id') as v_null \gset
select ((:'geo_500'::jsonb) ->> 'visit_id') as v_500 \gset
select ((:'geo_501'::jsonb) ->> 'visit_id') as v_501 \gset
select ((:'geo_250'::jsonb) ->> 'visit_id') as v_250 \gset
select ((:'geo_251'::jsonb) ->> 'visit_id') as v_251 \gset
select ((:'geo_600'::jsonb) ->> 'visit_id') as v_600 \gset

select is(tests.visit_of(:'v_null') ->> 'verification', 'self_reported', 'no location: self_reported');
select is(tests.visit_of(:'v_null') ->> 'distance_m', null, 'no location: distance_m null');
select is((:'geo_null'::jsonb) ->> 'verification', 'self_reported', 'StampResult reports self_reported');
select is(tests.visit_of(:'v_500') ->> 'verification', 'geo_verified', 'accuracy 500 at the door: geo_verified');
select is((tests.visit_of(:'v_500') ->> 'distance_m')::int, 0, 'at the door: distance_m 0');
select is(tests.visit_of(:'v_501') ->> 'verification', 'self_reported', 'accuracy 501: not verified');
select is((tests.visit_of(:'v_250') ->> 'distance_m')::int, 400, 'distance_m is rounded to 10 m (399.99 -> 400)');
select is(tests.visit_of(:'v_250') ->> 'verification', 'geo_verified', 'distance - accuracy = 250: geo_verified');
select is(tests.visit_of(:'v_251') ->> 'verification', 'self_reported', 'distance - accuracy = 251: not verified');
select is(tests.visit_of(:'v_600') ->> 'verification', 'self_reported', 'accuracy 600 is over 500 even when the circle covers the door');
select is((:'geo_500'::jsonb) ->> 'outcome', 'repeat', 'repeat visits are logged with their own verification');
select is(tests.stamp_of(:'vic', 'NP') ->> 'verification', 'self_reported', 'the stamp keeps the first visit''s verification');

-- No raw coordinates anywhere in the stored rows.
select ok((select bool_and(pg_catalog.to_jsonb(x)::text not like '%51.5109%')
           from public.visits x where x.created_by = :'vic'),
  'visits rows hold no raw coordinates');
select ok((select bool_and(pg_catalog.to_jsonb(a)::text not like '%51.5109%')
           from public.visit_attendees a where a.user_id = :'vic'),
  'visit_attendees rows hold no raw coordinates');

-- ---------------------------------------------------------------- photo raises self_reported
set local app.now = '2026-07-02 12:00:00+01';
select tests.authenticate_as(:'vic');
select tests.checkin(:'r_mn', :'g', array[:'bob', :'cara']::uuid[]) as p \gset
reset role;
select ((:'p'::jsonb) ->> 'visit_id') as v_p \gset
select tests.authenticate_as(:'bob');
select tests.confirm(:'v_p') as p_bob \gset
select throws_ok(format('select public.set_visit_photo(%L, %L)', :'v_p', :'g' || '/' || :'v_p' || '.jpg'),
  null, null, 'only the visit creator can set the photo');
reset role;
select tests.authenticate_as(:'cara');
select tests.confirm(:'v_p') as p_cara \gset
reset role;
select is(tests.visit_of(:'v_p') ->> 'verification', 'self_reported', 'before the photo: self_reported');

select tests.authenticate_as(:'vic');
select public.set_visit_photo(:'v_p', :'g' || '/' || :'v_p' || '.jpg');
reset role;
select is(tests.visit_of(:'v_p') ->> 'verification', 'photo', 'a photo raises the visit to photo');
select is(tests.visit_of(:'v_p') ->> 'photo_path', :'g' || '/' || :'v_p' || '.jpg', 'photo_path stored');
select is(tests.stamp_of(:'vic', 'MN') ->> 'verification', 'photo', 'creator''s stamp raised to photo');
select is(tests.stamp_of(:'bob', 'MN') ->> 'verification', 'photo', 'a confirmed co-diner''s stamp raised to photo');
select is(tests.stamp_of(:'cara', 'MN') ->> 'verification', 'photo', 'another co-diner''s stamp raised to photo');
select is((select verification::text from public.stamp_totals where user_id = :'bob' and country_iso2 = 'MN'), 'photo',
  'stamp_totals shows photo');

-- ---------------------------------------------------------------- geo stays geo
set local app.now = '2026-07-03 12:00:00+01';
select tests.authenticate_as(:'vic');
select tests.checkin(:'r_bt', :'g', array[:'bob']::uuid[], null, 51.5074, -0.1278, 10) as q \gset
reset role;
select ((:'q'::jsonb) ->> 'visit_id') as v_q \gset
select tests.authenticate_as(:'bob');
select tests.confirm(:'v_q') as q_bob \gset
reset role;
select tests.authenticate_as(:'vic');
select public.set_visit_photo(:'v_q', :'g' || '/' || :'v_q' || '.jpg');
reset role;
select is(tests.visit_of(:'v_q') ->> 'verification', 'geo_verified', 'a photo never lowers geo_verified');
select is(tests.stamp_of(:'vic', 'BT') ->> 'verification', 'geo_verified', 'creator''s stamp stays geo_verified');
select is(tests.stamp_of(:'bob', 'BT') ->> 'verification', 'geo_verified', 'co-diner''s stamp stays geo_verified');

-- ---------------------------------------------------------------- owner downgrade
set local app.now = '2026-07-04 12:00:00+01';
select tests.authenticate_as(:'vic');
select tests.checkin(:'r_fi', :'g', array[:'bob', :'cara']::uuid[], null, 51.5074, -0.1278, 10) as d \gset
reset role;
select ((:'d'::jsonb) ->> 'visit_id') as v_d \gset
select tests.authenticate_as(:'bob');
select tests.confirm(:'v_d') as d_bob \gset
reset role;
select tests.authenticate_as(:'cara');
select tests.confirm(:'v_d') as d_cara \gset
reset role;
select is(tests.stamp_of(:'cara', 'FI') ->> 'verification', 'geo_verified', 'co-diners inherit the visit''s geo_verified');

-- A side-eye from Cara flags it.
insert into public.reactions (visit_id, user_id, emoji) values (:'v_d', :'cara', 'side_eye');

select tests.authenticate_as(:'bob');
select throws_ok(format('select public.downgrade_visit(%L)', :'v_d'), null, null, 'a member who is not the owner cannot downgrade');
select throws_ok(format('select public.dismiss_flag(%L)', :'v_d'), null, null, 'a member who is not the owner cannot dismiss a flag');
reset role;
select tests.authenticate_as(:'vic');
select throws_ok(format('select public.downgrade_visit(%L)', :'v_d'), null, null, 'the visit creator (not owner) cannot downgrade');
reset role;
select is(tests.visit_of(:'v_d') ->> 'verification', 'geo_verified', 'refused downgrades change nothing');
select is(tests.visit_of(:'v_d') ->> 'flag_resolved_at', null, 'refused dismiss changes nothing');

set local app.now = '2026-07-04 13:00:00+01';
select tests.authenticate_as(:'olga');
select public.downgrade_visit(:'v_d');
reset role;
select is(tests.visit_of(:'v_d') ->> 'verification', 'self_reported', 'owner downgrade: visit self_reported');
select isnt(tests.visit_of(:'v_d') ->> 'downgraded_at', null, 'owner downgrade sets downgraded_at');
select isnt(tests.visit_of(:'v_d') ->> 'flag_resolved_at', null, 'owner downgrade sets flag_resolved_at');
select is((select array_agg(verification::text order by user_id) from public.stamps where visit_id = :'v_d'),
  array['self_reported', 'self_reported', 'self_reported'], 'owner downgrade reaches every stamp from the visit');

-- A later photo cannot raise a downgraded visit.
select tests.authenticate_as(:'vic');
select tests.try_exec(format('select public.set_visit_photo(%L, %L)', :'v_d', :'g' || '/' || :'v_d' || '.jpg')) as ignored \gset
reset role;
select is(tests.visit_of(:'v_d') ->> 'verification', 'self_reported', 'a photo after a downgrade does not raise the visit');
select is(tests.stamp_of(:'bob', 'FI') ->> 'verification', 'self_reported', 'a photo after a downgrade does not raise the stamps');

-- Owner dismisses a flag on another visit.
select tests.authenticate_as(:'olga');
select public.dismiss_flag(:'v_p');
reset role;
select isnt(tests.visit_of(:'v_p') ->> 'flag_resolved_at', null, 'owner dismiss sets flag_resolved_at');
select is(tests.visit_of(:'v_p') ->> 'verification', 'photo', 'dismiss leaves verification unchanged');

select * from finish();
rollback;
