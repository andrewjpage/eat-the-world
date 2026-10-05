-- Security review of the M1 database (an adversarial pass by a reviewer who did not write it).
-- Each block names the finding it guards. Fixes live in 20261005130000_security_review.sql.
begin;
select plan(42);

select tests.create_user('vic.sec@test.local') as vic \gset
select tests.create_user('bob.sec@test.local') as bob \gset
select tests.create_user('cara.sec@test.local') as cara \gset
select tests.create_user('xena.sec@test.local') as xena \gset
select tests.create_user('owen.sec@test.local') as owen \gset
select tests.create_user('mia.sec@test.local') as mia \gset
select tests.create_user('max.sec@test.local') as max \gset

select tests.add_city('security-city', array['NP', 'MN', 'BT', 'FI']) as city \gset
select tests.add_restaurant(:'city', 'NP', 'Security NP') as r_np \gset
select tests.add_restaurant(:'city', 'MN', 'Security MN') as r_mn \gset
select tests.add_restaurant(:'city', 'BT', 'Security BT') as r_bt \gset
select tests.add_restaurant(:'city', 'FI', 'Security FI') as r_fi \gset

select tests.make_group(:'vic', 'Security group', array[:'bob', :'cara']::uuid[]) as g \gset
select tests.make_group(:'xena', 'Other group') as g_x \gset

set local app.now = '2026-07-01 12:00:00+01';
select tests.authenticate_as(:'vic');
select tests.checkin(:'r_mn', :'g', array[:'bob']::uuid[]) as res_mn \gset
select tests.checkin(:'r_np', :'g') as res_np \gset
reset role;
select (:'res_mn'::jsonb) ->> 'visit_id' as v_mn \gset
select (:'res_np'::jsonb) ->> 'visit_id' as v_np \gset
select tests.authenticate_as(:'bob');
select tests.confirm(:'v_mn') as res_bob \gset
reset role;

-- ---------------------------------------------------------------- F1: photo verification without a photo
-- set_visit_photo used to raise a visit to `photo` on the caller's word, so any creator could
-- call the RPC directly and count in verified-only leaderboards with no photo stored.
select tests.authenticate_as(:'vic');
select throws_ok(format('select public.set_visit_photo(%L, %L)', :'v_mn', :'g' || '/' || :'v_mn' || '.jpg'),
  null, null, 'F1: set_visit_photo refuses when no photo object is stored');
reset role;
select is(tests.visit_of(:'v_mn') ->> 'verification', 'self_reported', 'F1: the visit stays self_reported without a stored photo');
select is(tests.stamp_of(:'bob', 'MN') ->> 'verification', 'self_reported', 'F1: the stamps stay self_reported without a stored photo');

-- The photo route uploads with the service role, then the creator's session calls set_visit_photo.
insert into storage.objects (bucket_id, name) values ('visit-photos', :'g' || '/' || :'v_mn' || '.jpg');
select tests.authenticate_as(:'vic');
select lives_ok(format('select public.set_visit_photo(%L, %L)', :'v_mn', :'g' || '/' || :'v_mn' || '.jpg'),
  'F1: set_visit_photo works once the photo object is stored');
reset role;
select is(tests.visit_of(:'v_mn') ->> 'verification', 'photo', 'F1: a stored photo raises the visit to photo');
select is(tests.stamp_of(:'bob', 'MN') ->> 'verification', 'photo', 'F1: and every stamp from it');

select tests.authenticate_as(:'vic');
select throws_ok(format('select public.set_visit_photo(%L, %L)', :'v_np', :'g' || '/' || :'v_np' || '.jpg'),
  null, null, 'F1: a visit with no stored object still cannot be raised');
reset role;

-- ---------------------------------------------------------------- F2: photo reads follow the visit row
-- Photo paths are deterministic (<group_id>/<visit_id>.jpg). Members could read any object under
-- their group's prefix, including one left behind after its visit's photo was removed.
insert into storage.objects (bucket_id, name) values
  ('visit-photos', :'g' || '/' || :'v_np' || '.jpg'),
  ('visit-photos', :'g' || '/stray.jpg');
select tests.authenticate_as(:'bob');
select is((select count(*)::int from storage.objects where bucket_id = 'visit-photos' and name = :'g' || '/' || :'v_mn' || '.jpg'), 1,
  'F2: a member reads the photo of a visit that has it');
select is((select count(*)::int from storage.objects where bucket_id = 'visit-photos' and name = :'g' || '/' || :'v_np' || '.jpg'), 0,
  'F2: a member cannot read an object no visit points at');
select is((select count(*)::int from storage.objects where bucket_id = 'visit-photos' and name = :'g' || '/stray.jpg'), 0,
  'F2: a member cannot read a stray object under the group prefix');
reset role;
select tests.authenticate_as(:'xena');
select is((select count(*)::int from storage.objects where bucket_id = 'visit-photos'), 0,
  'F2: a non-member still reads no photos');
reset role;
select is(public.can_read_visit_photo(:'g' || '/' || :'v_mn' || '.jpg'), false, 'F2: no session, no photo');

-- ---------------------------------------------------------------- F3: deletion outside delete_my_account
-- Deleting the auth user directly (Supabase dashboard, admin API) used to leave groups with no
-- owner and keep visits (and photo paths) that brief section 8 says must go.
select tests.make_group(:'owen', 'Owen''s group', array[:'mia', :'max']::uuid[]) as g_o \gset
select tests.make_group(:'owen', 'Owen alone') as g_o_solo \gset
update public.group_members set joined_at = '2026-01-01 00:00:00+00' where group_id = :'g_o' and user_id = :'owen';
update public.group_members set joined_at = '2026-02-01 00:00:00+00' where group_id = :'g_o' and user_id = :'max';
update public.group_members set joined_at = '2026-03-01 00:00:00+00' where group_id = :'g_o' and user_id = :'mia';

set local app.now = '2026-07-02 12:00:00+01';
select tests.authenticate_as(:'owen');
select tests.checkin(:'r_bt', :'g_o', array[:'mia']::uuid[]) as res_shared \gset
select tests.checkin(:'r_fi', :'g_o') as res_alone \gset
reset role;
select (:'res_shared'::jsonb) ->> 'visit_id' as v_shared \gset
select (:'res_alone'::jsonb) ->> 'visit_id' as v_alone \gset
select tests.authenticate_as(:'mia');
select tests.confirm(:'v_shared') as res_mia \gset
reset role;
insert into storage.objects (bucket_id, name) values
  ('visit-photos', :'g_o' || '/' || :'v_shared' || '.jpg'),
  ('visit-photos', :'g_o' || '/' || :'v_alone' || '.jpg');
select tests.authenticate_as(:'owen');
select public.set_visit_photo(:'v_shared', :'g_o' || '/' || :'v_shared' || '.jpg');
select public.set_visit_photo(:'v_alone', :'g_o' || '/' || :'v_alone' || '.jpg');
reset role;

delete from auth.users where id = :'owen';

select is((select owner_id from public.groups where id = :'g_o'), :'max'::uuid,
  'F3: admin deletion passes ownership to the longest-standing member');
select is((select role::text from public.group_members where group_id = :'g_o' and user_id = :'max'), 'owner',
  'F3: the heir gets role owner');
select is((select count(*)::int from public.groups where id = :'g_o_solo'), 0, 'F3: admin deletion deletes a group with no other members');
select is(tests.visit_of(:'v_alone'), null, 'F3: admin deletion deletes a visit nobody else is on');
select isnt(tests.visit_of(:'v_shared'), null, 'F3: admin deletion keeps a visit a co-diner confirmed');
select is(tests.visit_of(:'v_shared') ->> 'photo_path', null, 'F3: the kept visit''s photo path is removed');
select is(tests.attendance_of(:'v_shared', :'mia') ->> 'status', 'confirmed', 'F3: the co-diner keeps their attendance');
select is(tests.stamp_of(:'mia', 'BT') ->> 'base', '10', 'F3: the co-diner keeps their stamp');
select tests.authenticate_as(:'mia');
select is((select count(*)::int from storage.objects where bucket_id = 'visit-photos' and name like :'g_o' || '/%'), 0,
  'F3: a photo object left in Storage after deletion is no longer readable');
reset role;

-- delete_my_account still works with the profile trigger in place.
select tests.authenticate_as(:'cara');
select lives_ok('select public.delete_my_account()', 'F3: delete_my_account still runs with the profile delete trigger');
reset role;
select is((select count(*)::int from public.profiles where user_id = :'cara'), 0, 'F3: delete_my_account removes the profile');

-- ---------------------------------------------------------------- F4: fail-closed defaults
-- Supabase's default privileges grant every new table and sequence in public to anon and
-- authenticated, so a later migration that forgot RLS or grants would be open to the API.
create table public.zz_security_probe (id int);
create sequence public.zz_security_probe_seq;
select ok(not has_table_privilege('anon', 'public.zz_security_probe', 'select'), 'F4: a new table is not readable by anon');
select ok(not has_table_privilege('anon', 'public.zz_security_probe', 'insert'), 'F4: a new table is not writable by anon');
select ok(not has_table_privilege('authenticated', 'public.zz_security_probe', 'select'), 'F4: a new table is not readable by authenticated until granted');
select ok(not has_table_privilege('authenticated', 'public.zz_security_probe', 'insert'), 'F4: a new table is not writable by authenticated until granted');
select ok(not has_sequence_privilege('anon', 'public.zz_security_probe_seq', 'usage'), 'F4: a new sequence is not usable by anon');
drop table public.zz_security_probe;
drop sequence public.zz_security_probe_seq;

-- Guards for functions (PUBLIC execute on new functions is a Postgres-wide default, so a test is
-- the reliable net): anon executes nothing in public, and authenticated only the API allowlist.
select is(
  (select coalesce(array_agg(p.oid::regprocedure::text order by 1), '{}')
     from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and has_function_privilege('anon', p.oid, 'execute')),
  '{}'::text[],
  'guard: anon can execute no function in public');
select is(
  (select coalesce(array_agg(p.proname::text order by 1), '{}')
     from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and has_function_privilege('authenticated', p.oid, 'execute')
      and p.proname not in (
        'max_new_stamps_per_day', 'app_now', 'london_date', 'is_curator', 'is_group_member',
        'is_group_owner', 'shares_group_with', 'can_read_visit', 'can_read_plan', 'can_read_visit_photo',
        'create_group', 'join_group', 'update_group_settings', 'rotate_invite_code', 'check_in',
        'confirm_attendance', 'decline_attendance', 'claim_stamp', 'backfill_countries',
        'remove_backfilled_stamp', 'set_visit_photo', 'downgrade_visit', 'dismiss_flag',
        'group_leaderboard', 'group_together', 'group_gaps', 'delete_my_account',
        'approve_submission', 'reject_submission')),
  '{}'::text[],
  'guard: authenticated executes only the API functions (no internal helpers or triggers)');

-- ---------------------------------------------------------------- guards: no raw coordinates
select is(
  (select coalesce(array_agg(table_name || '.' || column_name order by 1), '{}')
     from information_schema.columns
    where table_schema = 'public'
      and column_name ~* '(^|_)(lat|lon|lng|latitude|longitude|accuracy|coords?|geo(m|metry|graphy)?)($|_)'
      and table_name not in ('restaurants', 'submissions')),
  '{}'::text[],
  'guard: no table or view outside restaurants/submissions has a coordinate column');
select is(
  (select coalesce(array_agg(p.proname::text order by 1), '{}')
     from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prosrc ~* 'raise\s+(notice|log|info|debug|warning)'),
  '{}'::text[],
  'guard: no function in public logs with RAISE NOTICE/LOG/INFO/DEBUG/WARNING');

create function pg_temp.checkin_error(p_restaurant uuid, p_group uuid, p_tagged uuid[])
returns text language plpgsql as $$
begin
  perform public.check_in(p_restaurant, p_group, 51.123456789, -0.987654321, 12.3456789,
                          p_tagged, null, null, null::smallint, null::text);
  return 'no error';
exception when others then
  return sqlerrm;
end;
$$;
select tests.authenticate_as(:'vic');
select ok(pg_temp.checkin_error(:'r_np', :'g', array[:'xena']::uuid[]) !~ '(51\.12|0\.98|12\.34)',
  'guard: a refused check-in does not echo the coordinates');
select ok(pg_temp.checkin_error(:'r_np', :'g_x', '{}') !~ '(51\.12|0\.98|12\.34)',
  'guard: a check-in to a foreign group does not echo the coordinates');
reset role;

-- ---------------------------------------------------------------- guards: cross-group abuse
select tests.authenticate_as(:'xena');
select throws_ok(format('select public.check_in(%L, %L, null, null, null, ''{}'', null, null, null, null)', :'r_np', :'g'),
  null, null, 'guard: cannot check in to a group you are not in');
select throws_ok(format('select public.confirm_attendance(%L, null, null, null, null)', :'v_mn'),
  null, null, 'guard: cannot confirm a visit you were not tagged on');
select throws_ok(format('select public.claim_stamp(%L)', :'v_mn'),
  null, null, 'guard: cannot claim on a visit you were not on');
select throws_ok(format('select public.downgrade_visit(%L)', :'v_mn'),
  null, null, 'guard: a non-member cannot downgrade a visit');
select throws_ok(format('insert into public.plans (group_id, restaurant_id, proposed_by, proposed_for) values (%L, %L, %L, now())', :'g', :'r_np', :'xena'),
  '42501', null, 'guard: cannot propose a plan in another group');
select throws_ok(format('insert into public.reactions (visit_id, user_id, emoji) values (%L, %L, ''side_eye'')', :'v_mn', :'xena'),
  '42501', null, 'guard: cannot react to another group''s visit');
reset role;
select tests.authenticate_as(:'vic');
select throws_ok(format('select public.check_in(%L, %L, null, null, null, array[%L]::uuid[], null, null, null, null)', :'r_np', :'g', :'xena'),
  null, null, 'guard: cannot tag someone outside the group');
reset role;
select tests.authenticate_as(:'bob');
select throws_ok(format('select public.dismiss_flag(%L)', :'v_mn'),
  null, null, 'guard: a member who is not the owner cannot dismiss a flag');
reset role;

select * from finish();
rollback;
