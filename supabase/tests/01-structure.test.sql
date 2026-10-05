-- Structure: tables, views, enums, functions, privacy of columns, constants, time helpers.
begin;
select plan(94);

-- app_now() is now() until app.now is set (session_user is postgres here).
select is(public.app_now(), now(), 'app_now() is now() when app.now is unset');
set local app.now = '2026-07-15 12:00:00+00';
select is(public.app_now(), '2026-07-15 12:00:00+00'::timestamptz, 'app_now() honours app.now for postgres');

-- ---------------------------------------------------------------- extensions
select has_extension('extensions', 'postgis', 'postgis is installed in schema extensions');

-- ---------------------------------------------------------------- tables and views
select has_table('public', 'countries', 'table countries');
select has_table('public', 'signature_dishes', 'table signature_dishes');
select has_table('public', 'cities', 'table cities');
select has_table('public', 'city_countries', 'table city_countries');
select has_table('public', 'restaurants', 'table restaurants');
select has_table('public', 'profiles', 'table profiles');
select has_table('public', 'groups', 'table groups');
select has_table('public', 'group_members', 'table group_members');
select has_table('public', 'visits', 'table visits');
select has_table('public', 'visit_attendees', 'table visit_attendees');
select has_table('public', 'reactions', 'table reactions');
select has_table('public', 'stamps', 'table stamps');
select has_table('public', 'sets', 'table sets');
select has_table('public', 'set_awards', 'table set_awards');
select has_table('public', 'submissions', 'table submissions');
select has_table('public', 'closure_reports', 'table closure_reports');
select has_table('public', 'plans', 'table plans');
select has_table('public', 'plan_rsvps', 'table plan_rsvps');
select has_view('public', 'city_country_status', 'view city_country_status');
select has_view('public', 'stamp_totals', 'view stamp_totals');

select col_is_pk('public', 'visit_attendees', array['visit_id', 'user_id'], 'visit_attendees pk');
select col_is_pk('public', 'stamps', array['user_id', 'country_iso2'], 'stamps pk');
select col_is_pk('public', 'set_awards', array['user_id', 'set_id'], 'set_awards pk');
select col_is_pk('public', 'group_members', array['group_id', 'user_id'], 'group_members pk');
select col_is_pk('public', 'plan_rsvps', array['plan_id', 'user_id'], 'plan_rsvps pk');
select col_is_pk('public', 'reactions', array['visit_id', 'user_id', 'emoji'], 'reactions pk');
select col_is_pk('public', 'city_countries', array['city_id', 'country_iso2'], 'city_countries pk');

select is(
  (select coalesce(array_agg(c.relname::text order by c.relname), '{}')
   from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity),
  '{}'::text[],
  'row level security is enabled on every table in public');

select is(
  (select coalesce(array_agg(c.relname::text order by c.relname), '{}')
   from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relname in ('city_country_status', 'stamp_totals')
     and not coalesce('security_invoker=true' = any(c.reloptions)
                      or 'security_invoker=on' = any(c.reloptions), false)),
  '{}'::text[],
  'city_country_status and stamp_totals are security_invoker views');

select is(
  (select coalesce(array_agg(p.proname::text order by p.proname), '{}')
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prosecdef
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and not coalesce('search_path=""' = any(p.proconfig), false)),
  '{}'::text[],
  'every SECURITY DEFINER function in public sets search_path = ''''');

-- ---------------------------------------------------------------- enums
-- city_country_status(unlisted, uncharted) is checked behaviourally in the city_country_status
-- tests: an enum cannot share its name with the view of the same name.
select enum_has_labels('public', 'restaurant_status', array['active', 'reported_closed', 'closed', 'pending'], 'enum restaurant_status');
select enum_has_labels('public', 'confidence', array['curated', 'community', 'flagged'], 'enum confidence');
select enum_has_labels('public', 'dish_status', array['draft', 'approved'], 'enum dish_status');
select enum_has_labels('public', 'member_role', array['owner', 'member'], 'enum member_role');
select enum_has_labels('public', 'verification', array['geo_verified', 'photo', 'self_reported'], 'enum verification');
select enum_has_labels('public', 'attendance_status', array['pending', 'confirmed', 'declined'], 'enum attendance_status');
select enum_has_labels('public', 'reaction_emoji', array['clap', 'drool', 'side_eye'], 'enum reaction_emoji');
select enum_has_labels('public', 'submission_status', array['pending', 'approved', 'rejected'], 'enum submission_status');
select enum_has_labels('public', 'plan_status', array['proposed', 'booked', 'done', 'cancelled'], 'enum plan_status');
select enum_has_labels('public', 'rsvp_response', array['yes', 'no', 'maybe'], 'enum rsvp_response');

-- ---------------------------------------------------------------- functions (contract signatures)
select has_function('public', 'max_new_stamps_per_day', '{}'::name[], 'max_new_stamps_per_day()');
select has_function('public', 'app_now', '{}'::name[], 'app_now()');
select has_function('public', 'london_date', array['timestamp with time zone'], 'london_date(timestamptz)');
select has_function('public', 'create_group', array['text'], 'create_group(text)');
select has_function('public', 'join_group', array['text'], 'join_group(text)');
select has_function('public', 'update_group_settings', array['uuid', 'text', 'boolean', 'date', 'date'], 'update_group_settings(...)');
select has_function('public', 'rotate_invite_code', array['uuid'], 'rotate_invite_code(uuid)');
select has_function('public', 'check_in',
  array['uuid', 'uuid', 'double precision', 'double precision', 'double precision', 'uuid[]', 'uuid', 'text', 'smallint', 'text'],
  'check_in(...)');
select has_function('public', 'confirm_attendance', array['uuid', 'uuid', 'text', 'smallint', 'text'], 'confirm_attendance(...)');
select has_function('public', 'decline_attendance', array['uuid'], 'decline_attendance(uuid)');
select has_function('public', 'claim_stamp', array['uuid'], 'claim_stamp(uuid)');
select has_function('public', 'backfill_countries', array['text[]'], 'backfill_countries(text[])');
select has_function('public', 'remove_backfilled_stamp', array['text'], 'remove_backfilled_stamp(text)');
select has_function('public', 'set_visit_photo', array['uuid', 'text'], 'set_visit_photo(uuid, text)');
select has_function('public', 'downgrade_visit', array['uuid'], 'downgrade_visit(uuid)');
select has_function('public', 'dismiss_flag', array['uuid'], 'dismiss_flag(uuid)');
select has_function('public', 'group_leaderboard', array['uuid', 'boolean'], 'group_leaderboard(uuid, bool)');
select has_function('public', 'group_together', array['uuid', 'uuid'], 'group_together(uuid, uuid)');
select has_function('public', 'group_gaps', array['uuid', 'uuid'], 'group_gaps(uuid, uuid)');
select has_function('public', 'delete_my_account', '{}'::name[], 'delete_my_account()');
select has_function('public', 'approve_submission', array['uuid', 'double precision', 'double precision'], 'approve_submission(...)');
select has_function('public', 'reject_submission', array['uuid', 'text'], 'reject_submission(uuid, text)');
select function_returns('public', 'check_in',
  array['uuid', 'uuid', 'double precision', 'double precision', 'double precision', 'uuid[]', 'uuid', 'text', 'smallint', 'text'],
  'jsonb', 'check_in returns jsonb');
select function_returns('public', 'delete_my_account', '{}'::name[], 'text[]', 'delete_my_account returns text[]');

-- ---------------------------------------------------------------- constants and time
select is(public.max_new_stamps_per_day(), 3, 'max_new_stamps_per_day() = 3');
select is(public.london_date('2026-07-15 22:59:59+00'), '2026-07-15'::date, 'london_date: 23:59:59 BST is still the same day');
select is(public.london_date('2026-07-15 23:00:00+00'), '2026-07-16'::date, 'london_date: 00:00:00 BST is the next day');
select is(public.london_date('2026-10-24 23:00:00+00'), '2026-10-25'::date, 'london_date: midnight before the clock change (BST)');
select is(public.london_date('2026-10-25 23:59:59+00'), '2026-10-25'::date, 'london_date: 23:59:59 GMT after the clock change');
select is(public.london_date('2026-10-26 00:00:00+00'), '2026-10-26'::date, 'london_date: midnight GMT after the clock change');

-- ---------------------------------------------------------------- privacy of columns
-- No table may hold a user's raw coordinates: only restaurants and submissions have lat/lon.
select is(
  (select coalesce(array_agg(distinct c.table_name::text order by c.table_name::text), '{}')
   from information_schema.columns c
   join information_schema.tables t
     on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
   where c.table_schema = 'public'
     and (c.column_name ~* '(^|_)(lat|lon|lng|latitude|longitude|coord|coords|coordinates|accuracy|geom|geog|geography|geometry|location|position|point)(_|$)'
          or c.udt_name in ('geography', 'geometry', 'point'))),
  array['restaurants', 'submissions'],
  'only restaurants and submissions have coordinate-like columns');
select is(
  (select coalesce(array_agg(distinct c.table_name::text order by c.table_name::text), '{}')
   from information_schema.columns c
   where c.table_schema = 'public' and c.udt_name in ('geography', 'geometry')),
  array['restaurants'],
  'only restaurants has a PostGIS column');
select has_column('public', 'visits', 'distance_m', 'visits stores distance_m');

-- User references are nullable and ON DELETE SET NULL.
select is(
  (select coalesce(array_agg(v.t || '.' || v.c order by v.t, v.c), '{}')
   from (values ('visits', 'created_by'), ('restaurants', 'created_by'), ('city_countries', 'updated_by'),
                ('plans', 'proposed_by'), ('submissions', 'submitted_by'), ('submissions', 'reviewer_id'),
                ('closure_reports', 'reported_by')) as v(t, c)
   where not exists (
     select 1
     from pg_constraint k
     join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any(k.conkey)
     where k.contype = 'f' and k.conrelid = ('public.' || v.t)::regclass
       and a.attname = v.c and k.confdeltype = 'n')),
  '{}'::text[],
  'user references are ON DELETE SET NULL');

-- is_curator can't be updated by API roles.
select ok(not has_column_privilege('authenticated', 'public.profiles', 'is_curator', 'UPDATE'),
  'authenticated has no UPDATE on profiles.is_curator');
select ok(not has_column_privilege('anon', 'public.profiles', 'is_curator', 'UPDATE'),
  'anon has no UPDATE on profiles.is_curator');

-- Storage bucket.
select is((select public from storage.buckets where id = 'visit-photos'), false, 'visit-photos bucket exists and is private');

-- ---------------------------------------------------------------- profile trigger
select tests.create_user('zed.local@test.local') as zed \gset
select tests.create_user('gina@test.local', 'Gina Google') as gina \gset
select is((select display_name from public.profiles where user_id = :'zed'), 'zed.local', 'profile created with the email local part as display_name');
select is((select is_curator from public.profiles where user_id = :'zed'), false, 'is_curator defaults to false');
select is((select display_name from public.profiles where user_id = :'gina'), 'Gina Google', 'profile display_name uses the Google name when present');

-- ---------------------------------------------------------------- restaurants.location sync
select tests.add_city('structure-city', array['NP', 'MN']) as city \gset
select tests.add_restaurant(:'city', 'NP', 'Structure Nepal') as r_np \gset
select is((select round(extensions.st_y(location::extensions.geometry)::numeric, 4) from public.restaurants where id = :'r_np'),
  51.5074, 'restaurants.location is set from lat on insert');
update public.restaurants set lat = 51.6, lon = -0.2 where id = :'r_np';
select is((select round(extensions.st_y(location::extensions.geometry)::numeric, 4) || ',' || round(extensions.st_x(location::extensions.geometry)::numeric, 4)
           from public.restaurants where id = :'r_np'),
  '51.6000,-0.2000', 'restaurants.location follows lat/lon updates');

-- ---------------------------------------------------------------- stamp_totals points
select tests.make_group(:'zed', 'Structure group') as grp \gset
select tests.authenticate_as(:'zed');
select tests.checkin(:'r_np', :'grp') as res \gset
select public.backfill_countries(array['MN']) as n_backfilled \gset
reset role;

select is((:'res'::jsonb) ->> 'outcome', 'stamped', 'check_in result: stamped');
select is((select points::int from public.stamp_totals where user_id = :'zed' and country_iso2 = 'NP'), 25,
  'stamp_totals.points = 10 base + 15 rarity');
select is((select points::int from public.stamp_totals where user_id = :'zed' and country_iso2 = 'NP'),
          tests.points(:'zed', 'NP'),
  'stamp_totals.points = base + rarity_bonus + table_bonus + dish_bonus');
select is((select visit_id from public.stamp_totals where user_id = :'zed' and country_iso2 = 'NP'),
          ((:'res'::jsonb) ->> 'visit_id')::uuid, 'stamp_totals.visit_id is the visit');
select is(:'n_backfilled'::int, 1, 'backfill_countries returns the number created');
select is((select points::int from public.stamp_totals where user_id = :'zed' and country_iso2 = 'MN'), 0, 'backfilled stamp scores 0');
select ok((select backfilled and stamped_at is null and visit_id is null and earned_at is not null
           from public.stamp_totals where user_id = :'zed' and country_iso2 = 'MN'),
  'backfilled stamp: backfilled, no stamped_at, no visit, has earned_at');
select is((select verification::text from public.stamp_totals where user_id = :'zed' and country_iso2 = 'MN'), 'self_reported',
  'backfilled stamp is self_reported');

-- visit_attendees.rating is 1-5.
select throws_ok(
  format('update public.visit_attendees set rating = 6 where visit_id = %L', (:'res'::jsonb) ->> 'visit_id'),
  '23514', null, 'visit_attendees.rating rejects 6');

select * from finish();
rollback;
