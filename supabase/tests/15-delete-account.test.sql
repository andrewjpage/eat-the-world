-- delete_my_account (brief section 8): removes the user's profile, memberships, attendances,
-- reactions, RSVPs, stamps and set awards; keeps visits others are confirmed or pending on (with
-- created_by null and the photo removed); deletes the others; passes ownership to the
-- longest-standing member; deletes a group with no other members; returns the photo paths.
begin;
select plan(34);

select tests.create_user('alice@test.local') as alice \gset
select tests.create_user('bob@test.local') as bob \gset
select tests.create_user('cara@test.local') as cara \gset
select tests.create_user('dan@test.local') as dan \gset
select tests.create_user('xena@test.local') as xena \gset

select tests.add_city('delete-city', array['NP', 'MN', 'BT', 'FI']) as city \gset
select tests.add_restaurant(:'city', 'NP', 'Delete NP') as r_np \gset
select tests.add_restaurant(:'city', 'MN', 'Delete MN') as r_mn \gset
select tests.add_restaurant(:'city', 'BT', 'Delete BT') as r_bt \gset
select tests.add_restaurant(:'city', 'FI', 'Delete FI') as r_fi \gset
select tests.add_set('delete-set', array['NP', 'MN']) as set_id \gset

select tests.make_group(:'alice', 'Alice''s group', array[:'bob', :'cara', :'dan']::uuid[]) as g \gset
select tests.make_group(:'alice', 'Alice alone') as g_solo \gset
select tests.make_group(:'xena', 'Xena''s group', array[:'alice']::uuid[]) as g_x \gset
-- Cara is the longest-standing member after Alice, though she joined second.
update public.group_members set joined_at = '2026-01-01 00:00:00+00' where group_id = :'g' and user_id = :'alice';
update public.group_members set joined_at = '2026-02-01 00:00:00+00' where group_id = :'g' and user_id = :'cara';
update public.group_members set joined_at = '2026-03-01 00:00:00+00' where group_id = :'g' and user_id = :'bob';
update public.group_members set joined_at = '2026-04-01 00:00:00+00' where group_id = :'g' and user_id = :'dan';

-- ---------------------------------------------------------------- Alice's visits
set local app.now = '2026-07-01 12:00:00+01';
select tests.authenticate_as(:'alice');
select tests.checkin(:'r_np', :'g', array[:'bob', :'cara']::uuid[]) as v1r \gset
select tests.checkin(:'r_mn', :'g') as v2r \gset
select tests.checkin(:'r_bt', :'g', array[:'dan']::uuid[]) as v3r \gset
reset role;
set local app.now = '2026-07-02 12:00:00+01';
select tests.authenticate_as(:'alice');
select tests.checkin(:'r_fi', :'g', array[:'bob']::uuid[]) as v4r \gset
reset role;
select (:'v1r'::jsonb) ->> 'visit_id' as v1 \gset
select (:'v2r'::jsonb) ->> 'visit_id' as v2 \gset
select (:'v3r'::jsonb) ->> 'visit_id' as v3 \gset
select (:'v4r'::jsonb) ->> 'visit_id' as v4 \gset

select tests.authenticate_as(:'bob');
select tests.confirm(:'v1') as v1_bob \gset
select public.decline_attendance(:'v4');
reset role;
select tests.authenticate_as(:'cara');
select tests.confirm(:'v1') as v1_cara \gset
reset role;

insert into storage.objects (bucket_id, name) values
  ('visit-photos', :'g' || '/' || :'v1' || '.jpg'),
  ('visit-photos', :'g' || '/' || :'v2' || '.jpg'),
  ('visit-photos', :'g' || '/' || :'v4' || '.jpg');
select tests.authenticate_as(:'alice');
select public.set_visit_photo(:'v1', :'g' || '/' || :'v1' || '.jpg');
select public.set_visit_photo(:'v2', :'g' || '/' || :'v2' || '.jpg');
select public.set_visit_photo(:'v4', :'g' || '/' || :'v4' || '.jpg');
reset role;

-- Alice's other data.
insert into public.reactions (visit_id, user_id, emoji) values (:'v1', :'alice', 'clap'), (:'v1', :'bob', 'drool');
insert into public.plans (group_id, restaurant_id, proposed_by, proposed_for, status)
values (:'g', :'r_fi', :'alice', '2026-07-20 19:00:00+01', 'proposed')
returning id as plan_id \gset
insert into public.plan_rsvps (plan_id, user_id, response) values (:'plan_id', :'alice', 'yes'), (:'plan_id', :'bob', 'maybe');
insert into public.submissions (city_id, country_iso2, name, address, postcode, lat, lon, note, submitted_by, status)
values (:'city', 'BT', 'Alice Suggests', '3 Alice St', 'ALI 1AA', 51.5, -0.1, 'try it', :'alice', 'pending')
returning id as sub_id \gset
select is((select count(*)::int from public.set_awards where user_id = :'alice' and set_id = :'set_id'), 1,
  'fixture: Alice won the NP+MN set');
select is(tests.points(:'bob', 'NP'), 30, 'fixture: Bob''s stamp from V1 is 30');
select is(tests.points(:'cara', 'NP'), 30, 'fixture: Cara''s stamp from V1 is 30');

-- ---------------------------------------------------------------- delete
select tests.authenticate_as(:'alice');
select public.delete_my_account() as paths \gset
reset role;

select ok(:'paths'::text[] @> array[:'g' || '/' || :'v1' || '.jpg'], 'returns the photo path of the kept visit');
select ok(:'paths'::text[] @> array[:'g' || '/' || :'v2' || '.jpg'], 'returns the photo path of a deleted solo visit');
select ok(:'paths'::text[] @> array[:'g' || '/' || :'v4' || '.jpg'], 'returns the photo path of a deleted visit with only a decline');

select is((select count(*)::int from auth.users where id = :'alice'), 0, 'auth.users row deleted');
select is((select count(*)::int from public.profiles where user_id = :'alice'), 0, 'profile deleted');
select is((select count(*)::int from public.group_members where user_id = :'alice'), 0, 'memberships deleted');
select is((select count(*)::int from public.visit_attendees where user_id = :'alice'), 0, 'attendances deleted');
select is((select count(*)::int from public.reactions where user_id = :'alice'), 0, 'reactions deleted');
select is((select count(*)::int from public.plan_rsvps where user_id = :'alice'), 0, 'RSVPs deleted');
select is((select count(*)::int from public.stamps where user_id = :'alice'), 0, 'stamps deleted');
select is((select count(*)::int from public.set_awards where user_id = :'alice'), 0, 'set awards deleted');

-- Visits.
select isnt(tests.visit_of(:'v1'), null, 'V1 (others confirmed) kept');
select is(tests.visit_of(:'v1') ->> 'created_by', null, 'V1 created_by set to null');
select is(tests.visit_of(:'v1') ->> 'photo_path', null, 'V1 photo removed');
select isnt(tests.visit_of(:'v3'), null, 'V3 (someone pending) kept');
select is(tests.visit_of(:'v3') ->> 'created_by', null, 'V3 created_by set to null');
select is(tests.visit_of(:'v2'), null, 'V2 (nobody else) deleted');
select is(tests.visit_of(:'v4'), null, 'V4 (only a decline) deleted');

-- Co-diners keep everything, unrecomputed.
select is(tests.attendance_of(:'v1', :'bob') ->> 'status', 'confirmed', 'Bob''s attendance kept');
select is(tests.points(:'bob', 'NP'), 30, 'Bob''s stamp unchanged at 30');
select is(tests.points(:'cara', 'NP'), 30, 'Cara''s stamp unchanged at 30');
select is((select count(*)::int from public.reactions where user_id = :'bob' and visit_id = :'v1'), 1, 'Bob''s reaction kept');
select is((select count(*)::int from public.plan_rsvps where user_id = :'bob'), 1, 'Bob''s RSVP kept');
select is((select proposed_by from public.plans where id = :'plan_id'), null, 'the plan is kept with proposed_by null');
select is((select submitted_by from public.submissions where id = :'sub_id'), null, 'the submission is kept with submitted_by null');

-- Dan can still confirm the kept pending visit.
set local app.now = '2026-07-03 12:00:00+01';
select tests.authenticate_as(:'dan');
select tests.confirm(:'v3') as v3_dan \gset
reset role;
select is((:'v3_dan'::jsonb) ->> 'outcome', 'stamped', 'Dan confirms the kept visit and is stamped');

-- Groups.
select is((select owner_id from public.groups where id = :'g'), :'cara'::uuid, 'ownership passes to the longest-standing member');
select is((select role::text from public.group_members where group_id = :'g' and user_id = :'cara'), 'owner', 'the new owner has role owner');
select is((select role::text from public.group_members where group_id = :'g' and user_id = :'bob'), 'member', 'other members stay members');
select is((select count(*)::int from public.groups where id = :'g_solo'), 0, 'a group with no other members is deleted');
select is((select owner_id from public.groups where id = :'g_x'), :'xena'::uuid, 'a group Alice only belonged to keeps its owner');

select * from finish();
rollback;
