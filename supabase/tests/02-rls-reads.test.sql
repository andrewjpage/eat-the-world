-- RLS reads (brief section 5): group-private data, people who share a group, shared reference
-- data, draft dishes, photos in Storage, and anon.
begin;
select plan(47);

set local app.now = '2026-07-15 12:00:00+01';

-- ---------------------------------------------------------------- fixtures (as postgres)
select tests.create_user('alice@test.local') as alice \gset
select tests.create_user('bob@test.local') as bob \gset
select tests.create_user('xena@test.local') as xena \gset
select tests.create_user('yuri@test.local') as yuri \gset
select tests.create_user('cleo@test.local') as cleo \gset
update public.profiles set is_curator = true where user_id = :'cleo';

select tests.add_city('rls-reads-city', array['NP', 'MN']) as city \gset
select tests.add_restaurant(:'city', 'NP', 'Reads Nepal') as r_np \gset
select tests.add_dish('NP', 'Reads approved momo', 'approved') as dish_ok \gset
select tests.add_dish('NP', 'Reads draft dish', 'draft') as dish_draft \gset
select tests.add_set('rls-reads-set', array['NP', 'MN']) as set_id \gset

select tests.make_group(:'alice', 'Reads group 1', array[:'bob']::uuid[]) as g1 \gset
select tests.make_group(:'xena', 'Reads group 2') as g2 \gset

select tests.authenticate_as(:'alice');
select tests.checkin(:'r_np', :'g1', array[:'bob']::uuid[], :'dish_ok') as res \gset
reset role;
select (:'res'::jsonb) ->> 'visit_id' as v1 \gset
select tests.authenticate_as(:'bob');
select tests.confirm(:'v1', :'dish_ok') as res_bob \gset
reset role;

insert into public.reactions (visit_id, user_id, emoji) values (:'v1', :'bob', 'clap');
insert into public.plans (group_id, restaurant_id, proposed_by, proposed_for, status)
values (:'g1', :'r_np', :'alice', '2026-07-20 19:00:00+01', 'proposed')
returning id as plan_id \gset
insert into public.plan_rsvps (plan_id, user_id, response) values (:'plan_id', :'bob', 'yes');
insert into public.set_awards (user_id, set_id, city_id, awarded_at, points)
values (:'alice', :'set_id', :'city', '2026-07-15 12:00:00+01', 25)
on conflict do nothing;
insert into storage.objects (bucket_id, name, owner)
values ('visit-photos', :'g1' || '/' || :'v1' || '.jpg', :'alice');
update public.visits set photo_path = :'g1' || '/' || :'v1' || '.jpg' where id = :'v1';

-- ---------------------------------------------------------------- a non-member who shares no group
select tests.authenticate_as(:'xena');
select is((select count(*)::int from public.visits where id = :'v1'), 0, 'non-member cannot read the visit');
select is((select count(*)::int from public.visit_attendees where visit_id = :'v1'), 0, 'non-member cannot read attendees');
select is((select count(*)::int from public.reactions where visit_id = :'v1'), 0, 'non-member cannot read reactions');
select is((select count(*)::int from public.plans where group_id = :'g1'), 0, 'non-member cannot read plans');
select is((select count(*)::int from public.plan_rsvps where plan_id = :'plan_id'), 0, 'non-member cannot read RSVPs');
select is((select count(*)::int from public.groups where id = :'g1'), 0, 'non-member cannot read the group');
select is((select count(*)::int from public.group_members where group_id = :'g1'), 0, 'non-member cannot read group_members');
select is((select count(*)::int from storage.objects where bucket_id = 'visit-photos'), 0, 'non-member cannot read the visit photo object');
select is((select count(*)::int from public.stamps where user_id = :'alice'), 0, 'no shared group: cannot read stamps');
select is((select count(*)::int from public.stamp_totals where user_id = :'alice'), 0, 'no shared group: cannot read stamp_totals');
select is((select count(*)::int from public.set_awards where user_id = :'alice'), 0, 'no shared group: cannot read set_awards');
select is((select count(*)::int from public.profiles where user_id = :'alice'), 0, 'no shared group: cannot read profile');
select is((select count(*)::int from public.profiles where user_id = :'xena'), 1, 'a user can read their own profile');
select is((select count(*)::int from public.groups where id = :'g2'), 1, 'a member can read their own group');
select ok(tests.try_count(format('select * from public.group_leaderboard(%L, false)', :'g1')) <= 0,
  'non-member gets nothing from group_leaderboard');
select ok(tests.try_count(format('select * from public.group_gaps(%L, %L)', :'g1', :'city')) <= 0,
  'non-member gets nothing from group_gaps');
select ok(tests.try_count(format('select * from public.group_together(%L, %L) where stamped > 0', :'g1', :'city')) <= 0,
  'non-member gets no stamped count from group_together');
reset role;

-- ---------------------------------------------------------------- a fellow member
select tests.authenticate_as(:'bob');
select is((select count(*)::int from public.visits where id = :'v1'), 1, 'member reads the visit');
select is((select count(*)::int from public.visit_attendees where visit_id = :'v1'), 2, 'member reads both attendees');
select is((select count(*)::int from public.reactions where visit_id = :'v1'), 1, 'member reads reactions');
select is((select count(*)::int from public.plans where group_id = :'g1'), 1, 'member reads plans');
select is((select count(*)::int from public.plan_rsvps where plan_id = :'plan_id'), 1, 'member reads RSVPs');
select is((select count(*)::int from public.group_members where group_id = :'g1'), 2, 'member reads group_members');
select is((select count(*)::int from storage.objects where bucket_id = 'visit-photos' and name = :'g1' || '/' || :'v1' || '.jpg'), 1,
  'member reads the visit photo object');
select is((select count(*)::int from public.stamps where user_id = :'alice'), 1, 'shared group: reads stamps');
select is((select count(*)::int from public.stamp_totals where user_id = :'alice'), 1, 'shared group: reads stamp_totals');
select is((select count(*)::int from public.set_awards where user_id = :'alice'), 1, 'shared group: reads set_awards');
select is((select count(*)::int from public.profiles where user_id = :'alice'), 1, 'shared group: reads profile');
select is((select count(*)::int from public.signature_dishes where id = :'dish_draft'), 0, 'member (non-curator) cannot read a draft dish');
reset role;

-- ---------------------------------------------------------------- a signed-in user with no group
select tests.authenticate_as(:'yuri');
select is((select count(*)::int from public.profiles where user_id = :'bob'), 0, 'no group: cannot read others'' profiles');
select is((select count(*)::int from public.stamps where user_id = :'bob'), 0, 'no group: cannot read others'' stamps');
select is((select count(*)::int from public.countries where iso2 = 'NP'), 1, 'signed-in reads countries');
select is((select count(*)::int from public.cities where id = :'city'), 1, 'signed-in reads cities');
select is((select count(*)::int from public.city_countries where city_id = :'city'), 2, 'signed-in reads city_countries');
select is((select count(*)::int from public.restaurants where id = :'r_np'), 1, 'signed-in reads restaurants');
select is((select count(*)::int from public.sets where id = :'set_id'), 1, 'signed-in reads sets');
select is((select count(*)::int from public.signature_dishes where id = :'dish_ok'), 1, 'signed-in reads approved dishes');
select is((select count(*)::int from public.signature_dishes where id = :'dish_draft'), 0, 'non-curator cannot read draft dishes');
select is((select status::text from public.city_country_status where city_id = :'city' and country_iso2 = 'NP'), 'listed',
  'signed-in reads city_country_status');
select is((select count(*)::int from public.visits), 0, 'no group: reads no visits at all');
select is((select count(*)::int from public.visit_attendees), 0, 'no group: reads no attendees at all');
reset role;

-- ---------------------------------------------------------------- curator
select tests.authenticate_as(:'cleo');
select is((select count(*)::int from public.signature_dishes where id = :'dish_draft'), 1, 'curator reads draft dishes');
select is((select count(*)::int from public.visits where id = :'v1'), 0, 'curator role does not grant reading group visits');
reset role;

-- ---------------------------------------------------------------- anon
select tests.authenticate_as_anon();
select is(
  (select coalesce(array_agg(t order by t), '{}')
   from unnest(array[
     'public.countries', 'public.cities', 'public.city_countries', 'public.restaurants', 'public.sets',
     'public.signature_dishes', 'public.profiles', 'public.groups', 'public.group_members', 'public.visits',
     'public.visit_attendees', 'public.stamps', 'public.set_awards', 'public.reactions', 'public.plans',
     'public.plan_rsvps', 'public.submissions', 'public.closure_reports', 'public.city_country_status',
     'public.stamp_totals']) as t
   where tests.try_count('select 1 from ' || t) > 0),
  '{}'::text[],
  'anon reads nothing from any public table or view');
select ok(tests.try_count('select 1 from storage.objects where bucket_id = ''visit-photos''') <= 0,
  'anon reads no visit photos');
select ok(tests.try_count(format('select * from public.group_leaderboard(%L, false)', :'g1')) <= 0,
  'anon gets nothing from group_leaderboard');
reset role;

-- The fixtures really exist (so the zeros above mean something).
select is((select count(*)::int from public.stamps where user_id in (:'alice', :'bob')), 2, 'fixture: alice and bob both have stamps');

select * from finish();
rollback;
