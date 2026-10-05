-- RLS writes (brief section 5): no client writes to stamps, set_awards, visits, visit_attendees;
-- is_curator protected; no direct group membership changes; curator-only reference data;
-- plans, reactions, RSVPs, submissions and closure reports.
begin;
select plan(60);

set local app.now = '2026-07-15 12:00:00+01';

-- ---------------------------------------------------------------- fixtures (as postgres)
select tests.create_user('alice@test.local') as alice \gset
select tests.create_user('bob@test.local') as bob \gset
select tests.create_user('cara@test.local') as cara \gset
select tests.create_user('dan@test.local') as dan \gset
select tests.create_user('xena@test.local') as xena \gset
select tests.create_user('cleo@test.local') as cleo \gset
update public.profiles set is_curator = true where user_id = :'cleo';

select tests.add_city('rls-writes-city', array['NP', 'MN', 'BT']) as city \gset
select tests.add_restaurant(:'city', 'NP', 'Writes Nepal') as r_np \gset
select tests.add_dish('NP', 'Writes momo', 'approved') as dish_ok \gset
select tests.add_dish('NP', 'Writes draft', 'draft') as dish_draft \gset
select tests.add_set('rls-writes-set', array['NP', 'MN']) as set_id \gset

select tests.make_group(:'alice', 'Writes group', array[:'bob', :'cara', :'dan']::uuid[]) as g1 \gset
select tests.make_group(:'xena', 'Other group') as g2 \gset

select tests.authenticate_as(:'alice');
select tests.checkin(:'r_np', :'g1', array[:'bob', :'cara']::uuid[]) as res \gset
reset role;
select (:'res'::jsonb) ->> 'visit_id' as v1 \gset

-- ---------------------------------------------------------------- visit_attendees
select tests.authenticate_as(:'cara');
select tests.try_exec(format('update public.visit_attendees set status = ''confirmed'' where visit_id = %L and user_id = %L', :'v1', :'cara')) as ignored \gset
select tests.try_exec(format('update public.visit_attendees set status = ''declined'' where visit_id = %L and user_id = %L', :'v1', :'bob')) as ignored \gset
reset role;
select is(tests.attendance_of(:'v1', :'cara') ->> 'status', 'pending', 'a tagged user cannot confirm by updating visit_attendees directly');
select is(tests.attendance_of(:'v1', :'bob') ->> 'status', 'pending', 'a user cannot change someone else''s attendance');

select tests.authenticate_as(:'dan');
select throws_ok(format('insert into public.visit_attendees (visit_id, user_id, status) values (%L, %L, ''confirmed'')', :'v1', :'dan'),
  '42501', null, 'an untagged member cannot add themselves to a visit');
select throws_ok(format('select public.confirm_attendance(%L, null, null, null, null)', :'v1'),
  null, null, 'an untagged member cannot confirm someone else''s visit');
reset role;
select is(tests.attendance_of(:'v1', :'dan'), null, 'dan has no attendance on the visit');
select is(tests.stamp_of(:'dan', 'NP'), null, 'dan has no stamp');

select tests.authenticate_as(:'xena');
select throws_ok(format('insert into public.visit_attendees (visit_id, user_id, status) values (%L, %L, ''confirmed'')', :'v1', :'xena'),
  '42501', null, 'a non-member cannot add themselves to a visit');
reset role;

-- Bob confirms through the function, so he has a stamp to tamper with.
select tests.authenticate_as(:'bob');
select tests.confirm(:'v1', :'dish_ok') as res_bob \gset

-- ---------------------------------------------------------------- stamps, set_awards, visits
select throws_ok(format(
  'insert into public.stamps (user_id, country_iso2, earned_at, stamped_at, base, rarity_bonus, table_bonus, dish_bonus, verification, backfilled)
   values (%L, ''MN'', now(), now(), 10, 15, 5, 2, ''geo_verified'', false)', :'bob'),
  '42501', null, 'a user cannot insert a stamp');
select tests.try_exec(format('update public.stamps set rarity_bonus = 100, table_bonus = 5 where user_id = %L', :'bob')) as ignored \gset
select tests.try_exec(format('delete from public.stamps where user_id = %L', :'alice')) as ignored \gset
select throws_ok(format(
  'insert into public.set_awards (user_id, set_id, city_id, awarded_at, points) values (%L, %L, %L, now(), 25)',
  :'bob', :'set_id', :'city'),
  '42501', null, 'a user cannot insert a set award');
select throws_ok(format(
  'insert into public.visits (restaurant_id, group_id, created_by, visited_at, verification, rarity_bonus)
   values (%L, %L, %L, now(), ''geo_verified'', 15)', :'r_np', :'g1', :'bob'),
  '42501', null, 'a user cannot insert a visit');
reset role;
select is((tests.stamp_of(:'bob', 'NP') ->> 'rarity_bonus')::int, 15, 'a user cannot update their stamp');
select is((tests.stamp_of(:'bob', 'NP') ->> 'table_bonus')::int, 0, 'a user cannot give themselves a table bonus');
select isnt(tests.stamp_of(:'alice', 'NP'), null, 'a user cannot delete stamps');

select tests.authenticate_as(:'alice');
select tests.try_exec(format('update public.visits set verification = ''geo_verified'', rarity_bonus = 0 where id = %L', :'v1')) as ignored \gset
select tests.try_exec(format('delete from public.visits where id = %L', :'v1')) as ignored \gset
reset role;
select is(tests.visit_of(:'v1') ->> 'verification', 'self_reported', 'the visit creator cannot update verification directly');
select is((tests.visit_of(:'v1') ->> 'rarity_bonus')::int, 15, 'the visit creator cannot update rarity directly');

-- ---------------------------------------------------------------- profiles
select tests.authenticate_as(:'bob');
select lives_ok(format('update public.profiles set display_name = ''Bobby'' where user_id = %L', :'bob'),
  'a user can update their own display_name');
select throws_ok(format('update public.profiles set is_curator = true where user_id = %L', :'bob'),
  '42501', null, 'a user cannot set is_curator');
select tests.try_exec(format('update public.profiles set display_name = ''Hacked'' where user_id = %L', :'alice')) as ignored \gset
reset role;
select is((select display_name from public.profiles where user_id = :'bob'), 'Bobby', 'own display_name changed');
select is((select is_curator from public.profiles where user_id = :'bob'), false, 'is_curator still false');
select is((select display_name from public.profiles where user_id = :'alice'), 'alice', 'another user''s profile unchanged');

-- ---------------------------------------------------------------- group membership and ownership
select tests.authenticate_as(:'dan');
select throws_ok(format('insert into public.group_members (group_id, user_id, role) values (%L, %L, ''member'')', :'g2', :'dan'),
  '42501', null, 'a user cannot insert group_members directly');
reset role;
select tests.authenticate_as(:'bob');
select tests.try_exec(format('update public.group_members set role = ''owner'' where group_id = %L and user_id = %L', :'g1', :'bob')) as ignored \gset
select tests.try_exec(format('update public.groups set owner_id = %L where id = %L', :'bob', :'g1')) as ignored \gset
select tests.try_exec(format('delete from public.group_members where group_id = %L and user_id = %L', :'g1', :'alice')) as ignored \gset
reset role;
select is((select role::text from public.group_members where group_id = :'g1' and user_id = :'bob'), 'member', 'a member cannot change their role');
select is((select owner_id from public.groups where id = :'g1'), :'alice'::uuid, 'a member cannot change groups.owner_id');
select is((select count(*)::int from public.group_members where group_id = :'g1' and user_id = :'alice'), 1, 'a member cannot remove the owner');

select tests.authenticate_as(:'alice');
select tests.try_exec(format('update public.groups set verified_only = true, name = ''Renamed'' where id = %L', :'g1')) as ignored \gset
select tests.try_exec(format('update public.group_members set role = ''member'' where group_id = %L and user_id = %L', :'g1', :'alice')) as ignored \gset
reset role;
select is((select verified_only from public.groups where id = :'g1'), false, 'even the owner changes settings only through the function');
select is((select name from public.groups where id = :'g1'), 'Writes group', 'even the owner cannot rename directly');
select is((select role::text from public.group_members where group_id = :'g1' and user_id = :'alice'), 'owner', 'the owner''s role cannot be changed directly');

-- ---------------------------------------------------------------- curator-only reference data
select tests.authenticate_as(:'bob');
select throws_ok(format(
  'insert into public.restaurants (city_id, country_iso2, name, address, postcode, lat, lon, status, confidence)
   values (%L, ''MN'', ''Bob Mongolian'', ''1 Bob St'', ''BOB 1AA'', 51.5, -0.1, ''active'', ''curated'')', :'city'),
  '42501', null, 'non-curator cannot insert restaurants');
select tests.try_exec(format('update public.restaurants set status = ''closed'' where id = %L', :'r_np')) as ignored \gset
select tests.try_exec(format('update public.city_countries set status = ''uncharted'' where city_id = %L and country_iso2 = ''MN''', :'city')) as ignored \gset
select tests.try_exec(format('update public.sets set country_iso2s = array[''NP''] where id = %L', :'set_id')) as ignored \gset
select tests.try_exec(format('update public.signature_dishes set status = ''approved'' where id = %L', :'dish_draft')) as ignored \gset
select throws_ok('insert into public.sets (slug, name, country_iso2s) values (''bob-set'', ''Bob set'', array[''NP'',''MN''])',
  '42501', null, 'non-curator cannot insert sets');
select throws_ok('insert into public.signature_dishes (country_iso2, name, status) values (''MN'', ''Bob buuz'', ''approved'')',
  '42501', null, 'non-curator cannot insert signature_dishes');
reset role;
select tests.ensure_country('SE');
select tests.authenticate_as(:'bob');
select throws_ok(format('insert into public.city_countries (city_id, country_iso2, status) values (%L, ''SE'', ''uncharted'')', :'city'),
  '42501', null, 'non-curator cannot insert city_countries');
reset role;
select is((select status::text from public.restaurants where id = :'r_np'), 'active', 'non-curator cannot update restaurants');
select is((select status::text from public.city_countries where city_id = :'city' and country_iso2 = 'MN'), 'unlisted', 'non-curator cannot update city_countries');
select is((select array(select unnest(country_iso2s) order by 1) from public.sets where id = :'set_id'), array['MN', 'NP'], 'non-curator cannot update sets');
select is((select status::text from public.signature_dishes where id = :'dish_draft'), 'draft', 'non-curator cannot update signature_dishes');

select tests.authenticate_as(:'cleo');
select lives_ok(format(
  'insert into public.restaurants (city_id, country_iso2, name, address, postcode, lat, lon, status, confidence)
   values (%L, ''MN'', ''Cleo Mongolian'', ''1 Cleo St'', ''CLE 1AA'', 51.5, -0.1, ''active'', ''curated'')', :'city'),
  'curator can insert restaurants');
select lives_ok(format('update public.city_countries set status = ''uncharted'' where city_id = %L and country_iso2 = ''BT''', :'city'),
  'curator can update city_countries');
select lives_ok('insert into public.sets (slug, name, country_iso2s) values (''cleo-set'', ''Cleo set'', array[''NP'',''BT''])',
  'curator can insert sets');
select lives_ok('insert into public.signature_dishes (country_iso2, name, status) values (''MN'', ''Cleo buuz'', ''draft'')',
  'curator can insert signature_dishes');
select lives_ok(format('update public.signature_dishes set status = ''approved'' where id = %L', :'dish_draft'),
  'curator can update signature_dishes');
reset role;
select is((select status::text from public.city_countries where city_id = :'city' and country_iso2 = 'BT'), 'uncharted', 'curator update to city_countries applied');
select is((select status::text from public.signature_dishes where id = :'dish_draft'), 'approved', 'curator update to signature_dishes applied');

-- ---------------------------------------------------------------- plans, RSVPs, reactions
select tests.authenticate_as(:'bob');
select lives_ok(format(
  'insert into public.plans (group_id, restaurant_id, proposed_by, proposed_for, status) values (%L, %L, %L, ''2026-07-20 19:00+01'', ''proposed'')',
  :'g1', :'r_np', :'bob'),
  'a member can insert a plan for their group');
reset role;
select id as plan_id from public.plans where group_id = :'g1' and proposed_by = :'bob' \gset

select tests.authenticate_as(:'xena');
select throws_ok(format(
  'insert into public.plans (group_id, restaurant_id, proposed_by, proposed_for, status) values (%L, %L, %L, ''2026-07-20 19:00+01'', ''proposed'')',
  :'g1', :'r_np', :'xena'),
  '42501', null, 'a non-member cannot insert a plan for the group');
select throws_ok(format('insert into public.plan_rsvps (plan_id, user_id, response) values (%L, %L, ''yes'')', :'plan_id', :'xena'),
  '42501', null, 'a non-member cannot RSVP');
select throws_ok(format('insert into public.reactions (visit_id, user_id, emoji) values (%L, %L, ''side_eye'')', :'v1', :'xena'),
  '42501', null, 'a non-member cannot react');
reset role;

select tests.authenticate_as(:'dan');
select tests.try_exec(format('update public.plans set status = ''cancelled'' where id = %L', :'plan_id')) as ignored \gset
reset role;
select is((select status::text from public.plans where id = :'plan_id'), 'proposed', 'a member who is neither proposer nor owner cannot update a plan');
select tests.authenticate_as(:'alice');
select lives_ok(format('update public.plans set status = ''booked'' where id = %L', :'plan_id'), 'the owner can update a plan');
reset role;
select is((select status::text from public.plans where id = :'plan_id'), 'booked', 'owner update applied');

select tests.authenticate_as(:'bob');
select lives_ok(format('insert into public.plan_rsvps (plan_id, user_id, response) values (%L, %L, ''yes'')', :'plan_id', :'bob'),
  'a member can RSVP for themselves');
select throws_ok(format('insert into public.plan_rsvps (plan_id, user_id, response) values (%L, %L, ''no'')', :'plan_id', :'cara'),
  '42501', null, 'a member cannot RSVP for someone else');
select lives_ok(format('insert into public.reactions (visit_id, user_id, emoji) values (%L, %L, ''clap'')', :'v1', :'bob'),
  'a member can react');
select throws_ok(format('insert into public.reactions (visit_id, user_id, emoji) values (%L, %L, ''drool'')', :'v1', :'alice'),
  '42501', null, 'a member cannot react as someone else');

-- ---------------------------------------------------------------- submissions, closure reports, storage
select lives_ok(format(
  'insert into public.submissions (city_id, country_iso2, name, address, postcode, lat, lon, note, submitted_by, status)
   values (%L, ''MN'', ''Bob Suggests'', ''2 Bob St'', ''BOB 2AA'', 51.51, -0.11, ''great buuz'', %L, ''pending'')', :'city', :'bob'),
  'a member can insert a submission');
select lives_ok(format('insert into public.closure_reports (restaurant_id, reported_by, note) values (%L, %L, ''shut'')', :'r_np', :'bob'),
  'a member can insert a closure report');
select throws_ok(format('insert into storage.objects (bucket_id, name, owner) values (''visit-photos'', %L, %L)',
  :'g1' || '/' || :'v1' || '.jpg', :'bob'),
  '42501', null, 'no client insert into the visit-photos bucket');
reset role;
-- If the member insert above failed, create the submission as postgres so the review tests still run.
insert into public.submissions (city_id, country_iso2, name, address, postcode, lat, lon, note, submitted_by, status)
select :'city', 'MN', 'Bob Suggests', '2 Bob St', 'BOB 2AA', 51.51, -0.11, 'great buuz', :'bob', 'pending'
where not exists (select 1 from public.submissions where name = 'Bob Suggests');
select id as sub_id from public.submissions where name = 'Bob Suggests' \gset

select tests.authenticate_as(:'bob');
select throws_ok(format('select public.approve_submission(%L, 51.51, -0.11)', :'sub_id'), null, null, 'non-curator cannot approve a submission');
select throws_ok(format('select public.reject_submission(%L, ''no'')', :'sub_id'), null, null, 'non-curator cannot reject a submission');
reset role;
select tests.authenticate_as(:'cleo');
select public.approve_submission(:'sub_id', 51.51, -0.11) as new_r \gset
reset role;
select is((select status::text || '/' || country_iso2 || '/' || (city_id = :'city')::text from public.restaurants where id = :'new_r'),
  'active/MN/true', 'curator approval inserts an active restaurant');
select is((select status::text from public.submissions where id = :'sub_id'), 'approved', 'the submission is marked approved');

select * from finish();
rollback;
