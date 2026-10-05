-- Groups: create_group, join_group (codes, idempotence, 20-member limit), rotate_invite_code,
-- update_group_settings (owner only).
begin;
select plan(24);

set local app.now = '2026-07-15 12:00:00+01';

select tests.create_user('owner@test.local') as owner \gset
select tests.create_user('bob@test.local') as bob \gset
select tests.create_user('late@test.local') as late \gset
select tests.create_user('extra@test.local') as extra \gset

-- ---------------------------------------------------------------- create_group
-- Groups are invite-only (20-launch-review covers the gate): the owner is the curator here.
update public.profiles set is_curator = true where user_id = :'owner';
select tests.authenticate_as(:'owner');
select public.create_group('Supper club') as g \gset
reset role;
update public.profiles set is_curator = false where user_id = :'owner';
select is((select owner_id from public.groups where id = :'g'), :'owner'::uuid, 'create_group makes the caller owner_id');
select is((select role::text from public.group_members where group_id = :'g' and user_id = :'owner'), 'owner', 'creator is a member with role owner');
select is((select length(invite_code) from public.groups where id = :'g'), 8, 'invite_code has 8 characters');
select is((select verified_only from public.groups where id = :'g'), false, 'verified_only defaults to false');
select invite_code as code from public.groups where id = :'g' \gset

-- ---------------------------------------------------------------- join_group
select tests.authenticate_as(:'bob');
select throws_ok('select public.join_group(''WRONG000'')', null, null, 'join_group with a wrong code fails');
reset role;
select is((select count(*)::int from public.group_members where group_id = :'g' and user_id = :'bob'), 0, 'wrong code: not a member');

select tests.authenticate_as(:'bob');
select is(public.join_group(:'code'), :'g'::uuid, 'join_group with the right code returns the group');
select is(public.join_group(:'code'), :'g'::uuid, 'join_group is idempotent');
reset role;
select is((select count(*)::int from public.group_members where group_id = :'g' and user_id = :'bob'), 1, 'joined exactly once');
select is((select role::text from public.group_members where group_id = :'g' and user_id = :'bob'), 'member', 'joiner has role member');

-- ---------------------------------------------------------------- 20-member limit
-- Fill the group to 20 (owner + bob + 18).
select array_agg(tests.create_user('filler' || i || '@test.local')) as fillers from generate_series(1, 18) as i \gset
select tests.join_as(:'fillers'::uuid[], :'code') as joined \gset
select is((select count(*)::int from public.group_members where group_id = :'g'), 20, 'group filled to 20 members');

select tests.authenticate_as(:'late');
select throws_ok(format('select public.join_group(%L)', :'code'), null, null, 'the 21st member is refused');
reset role;
select is((select count(*)::int from public.group_members where group_id = :'g'), 20, 'still 20 members');
select is((select count(*)::int from public.group_members where group_id = :'g' and user_id = :'late'), 0, 'the 21st user is not a member');

-- An existing member re-joining a full group is still idempotent.
select tests.authenticate_as(:'bob');
select lives_ok(format('select public.join_group(%L)', :'code'), 'a member re-joining a full group is not refused');
reset role;

-- ---------------------------------------------------------------- rotate_invite_code
select tests.make_group(:'owner', 'Small group', array[:'bob']::uuid[]) as g2 \gset
select invite_code as old_code from public.groups where id = :'g2' \gset

select tests.authenticate_as(:'bob');
select throws_ok(format('select public.rotate_invite_code(%L)', :'g2'), null, null, 'a non-owner cannot rotate the invite code');
reset role;
select is((select invite_code from public.groups where id = :'g2'), :'old_code', 'code unchanged after the refused rotation');

select tests.authenticate_as(:'owner');
select public.rotate_invite_code(:'g2') as new_code \gset
reset role;
select isnt(:'new_code'::text, :'old_code'::text, 'the owner rotates the code');
select is((select invite_code from public.groups where id = :'g2'), :'new_code', 'groups.invite_code holds the new code');

select tests.authenticate_as(:'extra');
select throws_ok(format('select public.join_group(%L)', :'old_code'), null, null, 'the old code no longer works');
select is(public.join_group(:'new_code'), :'g2'::uuid, 'the new code works');
reset role;

-- ---------------------------------------------------------------- update_group_settings
select tests.authenticate_as(:'bob');
select throws_ok(format('select public.update_group_settings(%L, ''Bob rules'', true, ''2026-07-01'', ''2026-07-31'')', :'g2'),
  null, null, 'a non-owner cannot change group settings');
reset role;
select tests.authenticate_as(:'owner');
select lives_ok(format('select public.update_group_settings(%L, ''Season club'', true, ''2026-07-01'', ''2026-07-31'')', :'g2'),
  'the owner changes group settings');
reset role;
select is((select name || '/' || verified_only::text || '/' || season_start::text || '/' || season_end::text from public.groups where id = :'g2'),
  'Season club/true/2026-07-01/2026-07-31', 'settings stored');

select * from finish();
rollback;
