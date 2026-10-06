-- M7 launch review (migration 20261005170000_launch_review.sql): distance_m only for geo-verified
-- check-ins and unreadable by members; invite-only create_group; invite_preview; submission
-- column grants, checks and the pending cap.
begin;
select plan(35);

select tests.create_user('gina@test.local') as gina \gset
select tests.create_user('hal@test.local') as hal \gset
select tests.create_user('ivy@test.local') as ivy \gset
select tests.create_user('cur@test.local') as cur \gset
select tests.create_user('newbie@test.local') as newbie \gset
update public.profiles set is_curator = true where user_id = :'cur';

select tests.add_city('launch-city', array['NP', 'MN']) as city \gset
-- Both restaurants sit at 51.5074, -0.1278.
select tests.add_restaurant(:'city', 'NP', 'Launch NP') as r_np \gset
select tests.add_restaurant(:'city', 'MN', 'Launch MN') as r_mn \gset
select tests.make_group(:'gina', 'Launch group', array[:'hal']::uuid[]) as g \gset
select invite_code as code from public.groups where id = :'g' \gset

-- ---------------------------------------------------------------- 1. distance_m
set local app.now = '2026-07-01 12:00:00+01';
select tests.authenticate_as(:'gina');
-- 51.5524 is about 5 km due north of the restaurant: a dinner logged from home.
select tests.checkin(:'r_np', :'g', '{}', null, 51.5524, -0.1278, 20) as far \gset
select tests.checkin(:'r_mn', :'g', '{}', null, 51.5074, -0.1278, 20) as near \gset
reset role;
select ((:'far'::jsonb) ->> 'visit_id') as v_far \gset
select ((:'near'::jsonb) ->> 'visit_id') as v_near \gset

select is((:'far'::jsonb) ->> 'verification', 'self_reported', 'A: a check-in 5 km away is self_reported');
select is(tests.visit_of(:'v_far') ->> 'distance_m', null, 'A: and keeps no distance_m');
select is(tests.visit_of(:'v_near') ->> 'verification', 'geo_verified', 'A: at the door it is geo_verified');
select is((tests.visit_of(:'v_near') ->> 'distance_m')::int, 0, 'A: and keeps its rounded distance');
select ok((select bool_and(to_jsonb(x)::text not like '%51.552%') from public.visits x where x.created_by = :'gina'),
  'A: no raw coordinates on the visits');

select tests.authenticate_as(:'hal');
select is(tests.try_count(format('select 1 from public.visits where id = %L', :'v_near')), 1,
  'A: a member still reads the visit');
select is(tests.try_exec(format('select distance_m from public.visits where id = %L', :'v_near')), '42501',
  'A: a member cannot read distance_m');
select is(tests.try_exec(format('select client_key from public.visits where id = %L', :'v_near')), '42501',
  'A: a member cannot read client_key');
select is(tests.try_exec('select * from public.visits'), '42501', 'A: select * on visits is refused');
select is(tests.try_count(format(
  'select id, restaurant_id, group_id, created_by, visited_at, verification, rarity_bonus, photo_path, '
  'flag_resolved_at, downgraded_at, table_qualified_at from public.visits where id = %L', :'v_near')), 1,
  'A: every other visits column is still readable');
reset role;
select tests.authenticate_as(:'gina');
select is(tests.try_exec(format('select distance_m from public.visits where id = %L', :'v_near')), '42501',
  'A: not even the checker reads distance_m');
reset role;

-- ---------------------------------------------------------------- 2. invite-only create_group
select tests.authenticate_as(:'newbie');
select throws_ok('select public.create_group(''Gatecrashers'')', 'P0001', 'Ask a friend for an invite link first.',
  'B: a new user with no group cannot create one');
reset role;
select is((select count(*)::int from public.groups where owner_id = :'newbie'), 0, 'B: and no group was made');

select tests.authenticate_as(:'cur');
select lives_ok('select public.create_group(''Curator table'')', 'B: the curator can create the first group');
reset role;

select tests.authenticate_as(:'hal');
select lives_ok('select public.create_group(''Hal''''s lunch'')', 'B: an existing member can create another group');
reset role;

-- ---------------------------------------------------------------- 3. invite_preview
select tests.authenticate_as(:'ivy');
select is((select name from public.invite_preview(:'code')), 'Launch group', 'C: invite_preview shows the group name');
select is((select members from public.invite_preview(:'code')), 2, 'C: and the member count');
select is((select name from public.invite_preview(lower(substr(:'code', 1, 4)) || ' ' || substr(:'code', 5))),
  'Launch group', 'C: codes are matched ignoring case and spaces');
select is((select count(*)::int from public.invite_preview('ZZZZZZZZ')), 0, 'C: an unknown code returns nothing');
select is((select count(*)::int from public.invite_preview(null)), 0, 'C: a null code returns nothing');
reset role;
select is((select count(*)::int from public.group_members where group_id = :'g' and user_id = :'ivy'), 0,
  'C: previewing does not join');
select ok(not has_function_privilege('anon', 'public.invite_preview(text)', 'execute'), 'C: anon cannot preview');
select ok(has_function_privilege('authenticated', 'public.invite_preview(text)', 'execute'),
  'C: signed-in users can preview');

-- ---------------------------------------------------------------- 4. submissions
create function pg_temp.suggest(p_city uuid, p_user uuid, p_extra_cols text default '', p_extra_vals text default '',
                                p_postcode text default 'SW1A 1AA', p_name text default 'Suggested')
returns text language sql as $$
  select tests.try_exec(format(
    'insert into public.submissions (city_id, country_iso2, name, postcode, submitted_by, status%s) '
    'values (%L, %L, %L, %L, %L, %L%s)',
    p_extra_cols, p_city, 'NP', p_name, p_postcode, p_user, 'pending', p_extra_vals))
$$;

select tests.authenticate_as(:'hal');
select is(pg_temp.suggest(:'city', :'hal', ', lat, lon', ', 51.5007, -0.1246'), '42501',
  'D: a member cannot insert coordinates');
select is(pg_temp.suggest(:'city', :'hal', ', website', ', ''javascript:alert(document.cookie)'''), '23514',
  'D: a javascript: website is refused');
select is(pg_temp.suggest(:'city', :'hal', ', website', ', ''https://' || repeat('a', 300) || '.com'''), '23514',
  'D: a website over 300 characters is refused');
select is(pg_temp.suggest(:'city', :'hal', '', '', 'not a postcode at all'), '23514',
  'D: a postcode over 10 characters is refused');
select is(pg_temp.suggest(:'city', :'hal', ', address', ', ''' || repeat('x', 301) || ''''), '23514',
  'D: an address over 300 characters is refused');
select is(pg_temp.suggest(:'city', :'hal', ', google_place_id', ', ''<script>'''), '23514',
  'D: a malformed Google place id is refused');
select is(pg_temp.suggest(:'city', :'hal', ', website, google_place_id, address',
  ', ''https://launch.example/menu'', ''ChIJdd4hrwug2EcRmSrV3Vo6llI'', ''1 Launch Street'''), null,
  'D: a well-formed suggestion is accepted');
reset role;
select is((select lat from public.submissions where submitted_by = :'hal'), null, 'D: and it has no coordinates');

-- Hal has 1 pending; 9 more reach the cap of 10, and the 11th is refused.
select tests.authenticate_as(:'hal');
select is((select count(*)::int from generate_series(1, 9) i
            where pg_temp.suggest(:'city', :'hal', '', '', 'SW1A 1AA', 'Cap ' || i) is null), 9,
  'D: up to 10 pending suggestions are accepted');
select throws_ok(format(
  'insert into public.submissions (city_id, country_iso2, name, postcode, submitted_by, status) values (%L, %L, %L, %L, %L, %L)',
  :'city', 'NP', 'One too many', 'SW1A 1AA', :'hal', 'pending'),
  'P0001', 'You have lots of suggestions waiting. Give the curator a chance to catch up.',
  'D: the 11th pending suggestion is refused');
reset role;
select is((select count(*)::int from public.submissions where submitted_by = :'hal' and status = 'pending'), 10,
  'D: Hal has exactly 10 pending');

-- A reviewed suggestion frees a slot.
select tests.authenticate_as(:'cur');
select public.reject_submission((select id from public.submissions where submitted_by = :'hal' order by created_at, name limit 1), 'No');
reset role;
select tests.authenticate_as(:'hal');
select is(pg_temp.suggest(:'city', :'hal', '', '', 'SW1A 1AA', 'After review'), null,
  'D: once one is reviewed, a new suggestion is accepted');
reset role;

select * from finish();
rollback;
