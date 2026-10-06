-- Reactions and the owner's flag list (brief section 4, Banter): a side-eye shows as a count, never
-- with names. Members read only their own reaction rows; counts come from visit_reaction_counts.
-- group_flagged_visits is owner-only, returns no user ids, and follows flag_resolved_at through
-- dismiss_flag and downgrade_visit.
begin;
select plan(41);

select tests.create_user('olga.rx@test.local') as olga \gset
select tests.create_user('alice.rx@test.local') as alice \gset
select tests.create_user('bob.rx@test.local') as bob \gset
select tests.create_user('xena.rx@test.local') as xena \gset

select tests.add_city('reactions-city', array['NP', 'MN', 'BT']) as city \gset
select tests.add_restaurant(:'city', 'NP', 'Reactions NP') as r_np \gset
select tests.add_restaurant(:'city', 'MN', 'Reactions MN') as r_mn \gset
select tests.add_restaurant(:'city', 'BT', 'Reactions BT') as r_bt \gset

select tests.make_group(:'olga', 'Reactions group', array[:'alice', :'bob']::uuid[]) as g \gset
select tests.make_group(:'xena', 'Reactions other group') as g_x \gset

set local app.now = '2026-08-01 19:00:00+01';
select tests.authenticate_as(:'alice');
select tests.checkin(:'r_np', :'g') as res1 \gset
reset role;
select tests.authenticate_as(:'bob');
select tests.checkin(:'r_mn', :'g') as res2 \gset
reset role;
select tests.authenticate_as(:'xena');
select tests.checkin(:'r_bt', :'g_x') as resx \gset
reset role;
select (:'res1'::jsonb) ->> 'visit_id' as v1 \gset
select (:'res2'::jsonb) ->> 'visit_id' as v2 \gset
select (:'resx'::jsonb) ->> 'visit_id' as vx \gset

-- Reactions, each inserted by its own user through RLS at a known time.
-- v1: alice clap, bob clap, bob side_eye (20:00), olga drool. v2: alice side_eye (20:30).
-- vx (other group): xena side_eye.
set local app.now = '2026-08-01 20:00:00+01';
select tests.authenticate_as(:'alice');
insert into public.reactions (visit_id, user_id, emoji) values (:'v1', :'alice', 'clap');
reset role;
select tests.authenticate_as(:'bob');
insert into public.reactions (visit_id, user_id, emoji) values (:'v1', :'bob', 'clap'), (:'v1', :'bob', 'side_eye');
reset role;
select tests.authenticate_as(:'olga');
insert into public.reactions (visit_id, user_id, emoji) values (:'v1', :'olga', 'drool');
reset role;
set local app.now = '2026-08-01 20:30:00+01';
select tests.authenticate_as(:'alice');
insert into public.reactions (visit_id, user_id, emoji) values (:'v2', :'alice', 'side_eye');
reset role;
select tests.authenticate_as(:'xena');
insert into public.reactions (visit_id, user_id, emoji) values (:'vx', :'xena', 'side_eye');
reset role;
select is((select count(*)::int from public.reactions where visit_id in (:'v1', :'v2', :'vx')), 6,
  'fixtures: six reactions stored');

-- ---------------------------------------------------------------- RLS: own rows only
select tests.authenticate_as(:'bob');
select is((select count(*)::int from public.reactions where visit_id = :'v1'), 2,
  'a member reads only their own reaction rows on a visit (2 of 4)');
select is((select count(*)::int from public.reactions where user_id <> :'bob'), 0,
  'a member cannot read anyone else''s reaction rows');
select is((select count(*)::int from public.reactions where emoji = 'side_eye' and user_id = :'alice'), 0,
  'a member cannot see who side-eyed');
reset role;
select tests.authenticate_as(:'olga');
select is((select count(*)::int from public.reactions where visit_id in (:'v1', :'v2')), 1,
  'the group owner also reads only their own reaction rows');
reset role;
select tests.authenticate_as(:'xena');
select is((select count(*)::int from public.reactions where visit_id in (:'v1', :'v2')), 0,
  'a non-member reads no reaction rows on the group''s visits');
reset role;

-- ---------------------------------------------------------------- visit_reaction_counts
select ok(pg_get_function_result('public.visit_reaction_counts(uuid[])'::regprocedure) !~* 'user|name',
  'visit_reaction_counts returns no user ids or names');

select tests.authenticate_as(:'bob');
select results_eq(
  format('select visit_id, emoji::text, n, mine from public.visit_reaction_counts(array[%L, %L]::uuid[]) order by 1, 2', :'v1', :'v2'),
  format($q$values (%L::uuid, 'clap', 2, true), (%L::uuid, 'drool', 1, false), (%L::uuid, 'side_eye', 1, true),
                   (%L::uuid, 'side_eye', 1, false) order by 1, 2$q$, :'v1', :'v1', :'v1', :'v2'),
  'counts per visit and emoji for Bob, with mine set on his own');
select results_eq(
  format('select n, mine from public.visit_reaction_counts(array[%L]::uuid[]) where emoji = ''clap''', :'v1'),
  $$values (2, true)$$,
  'clap on v1: two, including Bob');
reset role;

select tests.authenticate_as(:'alice');
select results_eq(
  format('select emoji::text, n, mine from public.visit_reaction_counts(array[%L]::uuid[]) order by 1', :'v1'),
  $$values ('clap', 2, true), ('drool', 1, false), ('side_eye', 1, false)$$,
  'Alice sees the same counts on v1, mine only for her clap');
select results_eq(
  format('select emoji::text, n, mine from public.visit_reaction_counts(array[%L]::uuid[])', :'v2'),
  $$values ('side_eye', 1, true)$$,
  'Alice''s own side-eye on v2 is mine');
select is(tests.try_count(format('select * from public.visit_reaction_counts(array[%L]::uuid[])', :'vx')), 0,
  'a member gets nothing for another group''s visit');
select is(tests.try_count(format('select * from public.visit_reaction_counts(array[%L, %L]::uuid[])', :'v1', :'vx')), 3,
  'a mixed list returns only the caller''s groups'' visits');
select is(tests.try_count('select * from public.visit_reaction_counts(''{}''::uuid[])'), 0, 'an empty list returns nothing');
select is(tests.try_count('select * from public.visit_reaction_counts(null)'), 0, 'a null list returns nothing');
reset role;

select tests.authenticate_as(:'xena');
select is(tests.try_count(format('select * from public.visit_reaction_counts(array[%L, %L]::uuid[])', :'v1', :'v2')), 0,
  'a non-member gets no counts');
select results_eq(
  format('select emoji::text, n, mine from public.visit_reaction_counts(array[%L, %L]::uuid[])', :'v1', :'vx'),
  $$values ('side_eye', 1, true)$$,
  'a non-member asking for v1 and their own visit gets only their own visit');
reset role;

select tests.clear_authentication();
select is(tests.try_count(format('select * from public.visit_reaction_counts(array[%L]::uuid[])', :'v1')), 0,
  'no session (no auth.uid): no counts');
select ok(not has_function_privilege('anon', 'public.visit_reaction_counts(uuid[])', 'execute'), 'anon cannot execute visit_reaction_counts');
select ok(not has_function_privilege('anon', 'public.group_flagged_visits(uuid)', 'execute'), 'anon cannot execute group_flagged_visits');

-- ---------------------------------------------------------------- insert and delete own reactions
select tests.authenticate_as(:'bob');
select lives_ok(format('delete from public.reactions where visit_id = %L and user_id = %L and emoji = ''clap''', :'v1', :'bob'),
  'a member can remove their own reaction');
select lives_ok(format('delete from public.reactions where visit_id = %L and user_id = %L', :'v1', :'alice'),
  'deleting someone else''s reaction runs but matches nothing');
select results_eq(
  format('select n, mine from public.visit_reaction_counts(array[%L]::uuid[]) where emoji = ''clap''', :'v1'),
  $$values (1, false)$$,
  'after removing his clap, Bob sees one clap that is not his');
select lives_ok(format('insert into public.reactions (visit_id, user_id, emoji) values (%L, %L, ''clap'')', :'v1', :'bob'),
  'a member can react again');
select throws_ok(format('insert into public.reactions (visit_id, user_id, emoji) values (%L, %L, ''drool'')', :'v1', :'alice'),
  '42501', null, 'a member cannot react as someone else');
reset role;
select is((select count(*)::int from public.reactions where visit_id = :'v1' and user_id = :'alice'), 1,
  'Alice''s clap survived Bob''s delete');
select tests.authenticate_as(:'xena');
select throws_ok(format('insert into public.reactions (visit_id, user_id, emoji) values (%L, %L, ''side_eye'')', :'v1', :'xena'),
  '42501', null, 'a non-member cannot react');
reset role;

-- ---------------------------------------------------------------- group_flagged_visits: access
select ok(pg_get_function_result('public.group_flagged_visits(uuid)'::regprocedure) !~* 'user|name',
  'group_flagged_visits returns no user ids or names');
select tests.authenticate_as(:'bob');
select throws_ok(format('select * from public.group_flagged_visits(%L)', :'g'), null, null,
  'a member who is not the owner cannot list flags');
reset role;
select tests.authenticate_as(:'xena');
select throws_ok(format('select * from public.group_flagged_visits(%L)', :'g'), null, null,
  'a non-member cannot list flags');
reset role;

-- ---------------------------------------------------------------- flags: counts and order
select tests.authenticate_as(:'olga');
select results_eq(
  format('select visit_id, side_eye_count, latest_side_eye_at from public.group_flagged_visits(%L)', :'g'),
  format($q$values (%L::uuid, 1, '2026-08-01 20:30:00+01'::timestamptz), (%L::uuid, 1, '2026-08-01 20:00:00+01'::timestamptz)$q$, :'v2', :'v1'),
  'owner sees both flagged visits, newest side-eye first');
reset role;
select tests.authenticate_as(:'xena');
select results_eq(
  format('select visit_id, side_eye_count from public.group_flagged_visits(%L)', :'g_x'),
  format($q$values (%L::uuid, 1)$q$, :'vx'),
  'another group''s owner sees only their own group''s flags');
reset role;

-- ---------------------------------------------------------------- dismiss, then a newer side-eye re-flags
set local app.now = '2026-08-02 09:00:00+01';
select tests.authenticate_as(:'olga');
select public.dismiss_flag(:'v1');
select results_eq(
  format('select visit_id from public.group_flagged_visits(%L)', :'g'),
  format($q$values (%L::uuid)$q$, :'v2'),
  'dismiss_flag clears the flag on v1');
reset role;

set local app.now = '2026-08-02 10:00:00+01';
select tests.authenticate_as(:'alice');
insert into public.reactions (visit_id, user_id, emoji) values (:'v1', :'alice', 'side_eye');
reset role;
select tests.authenticate_as(:'olga');
select results_eq(
  format('select side_eye_count, latest_side_eye_at from public.group_flagged_visits(%L) where visit_id = %L', :'g', :'v1'),
  $$values (1, '2026-08-02 10:00:00+01'::timestamptz)$$,
  'a side-eye newer than the dismissal re-flags v1, counting only the new one');
select is(tests.try_count(format('select * from public.group_flagged_visits(%L)', :'g')), 2, 'two visits flagged again');
reset role;

-- A clap or drool never flags.
select tests.authenticate_as(:'olga');
insert into public.reactions (visit_id, user_id, emoji) values (:'v2', :'olga', 'clap');
reset role;

-- ---------------------------------------------------------------- downgrade resolves the flag
set local app.now = '2026-08-02 11:00:00+01';
select tests.authenticate_as(:'olga');
select public.downgrade_visit(:'v2');
select results_eq(
  format('select visit_id from public.group_flagged_visits(%L)', :'g'),
  format($q$values (%L::uuid)$q$, :'v1'),
  'downgrade_visit clears the flag on v2');
-- A side-eye at the same instant as the resolution is not newer, so it does not re-flag.
insert into public.reactions (visit_id, user_id, emoji) values (:'v2', :'olga', 'side_eye');
select is(tests.try_count(format('select * from public.group_flagged_visits(%L) where visit_id = %L', :'g', :'v2')), 0,
  'a side-eye at the resolution instant does not re-flag');
reset role;

set local app.now = '2026-08-03 12:00:00+01';
select tests.authenticate_as(:'bob');
insert into public.reactions (visit_id, user_id, emoji) values (:'v2', :'bob', 'side_eye');
reset role;
select tests.authenticate_as(:'olga');
select results_eq(
  format('select side_eye_count from public.group_flagged_visits(%L) where visit_id = %L', :'g', :'v2'),
  $$values (1)$$,
  'a later side-eye re-flags a downgraded visit for the owner to see');
reset role;
select is(tests.visit_of(:'v2') ->> 'verification', 'self_reported', 'the downgraded visit stays self_reported');

-- Removing the side-eye that flagged it clears the flag again.
select tests.authenticate_as(:'bob');
delete from public.reactions where visit_id = :'v2' and user_id = :'bob' and emoji = 'side_eye';
reset role;
select tests.authenticate_as(:'olga');
select is(tests.try_count(format('select * from public.group_flagged_visits(%L) where visit_id = %L', :'g', :'v2')), 0,
  'withdrawing the side-eye unflags the visit');

-- Totals stay visible to everyone as counts.
select results_eq(
  format('select n from public.visit_reaction_counts(array[%L]::uuid[]) where emoji = ''side_eye''', :'v2'),
  $$values (2)$$,
  'members still see the side-eye total on v2 as a count');
reset role;

select * from finish();
rollback;
