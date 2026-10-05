-- Retries on poor signal (brief section 4, Speed): a check-in retried with the same client key
-- returns the first result and creates nothing; a retried confirm or claim reports the stamp it
-- made; table_pending is 0 when the table bonus can no longer happen.
begin;
select plan(32);

select tests.create_user('ria@test.local') as ria \gset
select tests.create_user('sam@test.local') as sam \gset
select tests.create_user('tom@test.local') as tom \gset
select tests.create_user('uma@test.local') as uma \gset

select tests.add_city('retry-city', array['NP', 'MN', 'BT', 'FI', 'IS', 'NO']) as city \gset
select tests.add_restaurant(:'city', 'NP', 'Retry NP') as r_np \gset
select tests.add_restaurant(:'city', 'MN', 'Retry MN') as r_mn \gset
select tests.add_restaurant(:'city', 'BT', 'Retry BT') as r_bt \gset
select tests.add_restaurant(:'city', 'FI', 'Retry FI') as r_fi \gset
select tests.add_restaurant(:'city', 'IS', 'Retry IS') as r_is \gset
select tests.add_restaurant(:'city', 'NO', 'Retry NO') as r_no \gset
select tests.add_dish('NP', 'Momo (retry test)', 'approved') as momo \gset

select tests.make_group(:'ria', 'Retry group', array[:'sam', :'tom', :'uma']::uuid[]) as g \gset

create function pg_temp.ci(p_restaurant uuid, p_group uuid, p_tagged uuid[], p_key uuid, p_dish uuid default null)
returns jsonb language sql as $$
  select public.check_in(p_restaurant, p_group, null, null, null, p_tagged, p_dish, null,
                         null::smallint, null::text, p_key)
$$;

-- ---------------------------------------------------------------- A: same key, same result, one visit
set local app.now = '2026-07-01 19:00:00+01';
select tests.authenticate_as(:'ria');
select pg_temp.ci(:'r_np', :'g', array[:'sam', :'tom']::uuid[], 'aaaaaaaa-0000-4000-8000-000000000001', :'momo') as a1 \gset
select pg_temp.ci(:'r_np', :'g', array[:'sam', :'tom']::uuid[], 'aaaaaaaa-0000-4000-8000-000000000001', :'momo') as a2 \gset
reset role;
select is((:'a1'::jsonb) ->> 'outcome', 'stamped', 'A: the first call stamps');
select is(:'a2'::jsonb, :'a1'::jsonb, 'A: the retry returns the same StampResult');
select is((select count(*)::int from public.visits where created_by = :'ria'), 1, 'A: one visit');
select is((select count(*)::int from public.visit_attendees where visit_id = ((:'a1'::jsonb) ->> 'visit_id')::uuid),
  3, 'A: one row each for the checker and the two tagged friends');
select is(tests.points(:'ria', 'NP'), 27, 'A: the stamp is unchanged (10 + 15 + 2)');

-- A retry with different inputs still replays the first call (nothing is re-applied).
select tests.authenticate_as(:'ria');
select pg_temp.ci(:'r_mn', :'g', '{}', 'aaaaaaaa-0000-4000-8000-000000000001') as a3 \gset
reset role;
select is(:'a3'::jsonb, :'a1'::jsonb, 'A: a retry with changed inputs replays the first result');
select is(tests.stamp_of(:'ria', 'MN'), null, 'A: and creates no MN stamp');

-- ---------------------------------------------------------------- B: keys are per user; null keys never match
select tests.authenticate_as(:'sam');
select pg_temp.ci(:'r_mn', :'g', '{}', 'aaaaaaaa-0000-4000-8000-000000000001') as b1 \gset
reset role;
select isnt((:'b1'::jsonb) ->> 'visit_id', (:'a1'::jsonb) ->> 'visit_id', 'B: another user''s key is not shared');
select is((:'b1'::jsonb) ->> 'outcome', 'stamped', 'B: Sam gets his own stamp');

select tests.authenticate_as(:'ria');
select pg_temp.ci(:'r_bt', :'g', '{}', null) as b2 \gset
select pg_temp.ci(:'r_bt', :'g', '{}', null) as b3 \gset
reset role;
select isnt((:'b3'::jsonb) ->> 'visit_id', (:'b2'::jsonb) ->> 'visit_id', 'B: without a key every call is a new visit');
select is((:'b3'::jsonb) ->> 'outcome', 'repeat', 'B: and the second is a repeat');

select tests.authenticate_as(:'ria');
select pg_temp.ci(:'r_bt', :'g', '{}', 'aaaaaaaa-0000-4000-8000-000000000002') as b4 \gset
select pg_temp.ci(:'r_bt', :'g', '{}', 'aaaaaaaa-0000-4000-8000-000000000002') as b5 \gset
reset role;
select is((:'b5'::jsonb) ->> 'outcome', 'repeat', 'B: a replayed repeat is still a repeat');
select is(:'b5'::jsonb, :'b4'::jsonb, 'B: with the same result');

-- ---------------------------------------------------------------- C: a replayed waiting stamp still waits
-- Ria has NP and BT today; FI is her third new stamp and IS waits.
select tests.authenticate_as(:'ria');
select pg_temp.ci(:'r_fi', :'g', '{}', null) as c0 \gset
select pg_temp.ci(:'r_is', :'g', '{}', 'aaaaaaaa-0000-4000-8000-000000000003') as c1 \gset
select pg_temp.ci(:'r_is', :'g', '{}', 'aaaaaaaa-0000-4000-8000-000000000003') as c2 \gset
reset role;
select is((:'c1'::jsonb) ->> 'outcome', 'waiting', 'C: the fourth new country waits');
select is(:'c2'::jsonb, :'c1'::jsonb, 'C: the retry reports the same waiting result');
select is((select count(*)::int from public.visit_attendees where user_id = :'ria' and stamp_waiting), 1,
  'C: one waiting attendance');

-- ---------------------------------------------------------------- D: retried confirm and claim
set local app.now = '2026-07-01 20:00:00+01';
select tests.authenticate_as(:'sam');
select tests.confirm(((:'a1'::jsonb) ->> 'visit_id')::uuid, :'momo') as d1 \gset
select tests.confirm(((:'a1'::jsonb) ->> 'visit_id')::uuid, :'momo') as d2 \gset
reset role;
select is((:'d1'::jsonb) ->> 'outcome', 'stamped', 'D: the first confirm stamps');
select is(:'d2'::jsonb, :'d1'::jsonb, 'D: a second confirm reports the same stamp and points');

-- Claim the waiting IS stamp the next London day, twice.
set local app.now = '2026-07-02 09:00:00+01';
select tests.authenticate_as(:'ria');
select public.claim_stamp(((:'c1'::jsonb) ->> 'visit_id')::uuid) as d3 \gset
select public.claim_stamp(((:'c1'::jsonb) ->> 'visit_id')::uuid) as d4 \gset
reset role;
select is((:'d3'::jsonb) ->> 'outcome', 'stamped', 'D: the claim stamps');
select is(:'d4'::jsonb, :'d3'::jsonb, 'D: a second claim reports the same stamp and points');
select is((select count(*)::int from public.stamps where user_id = :'ria' and country_iso2 = 'IS'), 1,
  'D: one IS stamp');

-- A confirmed attendee whose stamp came from another visit replays as a repeat.
select tests.authenticate_as(:'tom');
select pg_temp.ci(:'r_no', :'g', '{}', null) as d5 \gset
select pg_temp.ci(:'r_no', :'g', array[:'ria']::uuid[], null) as d6 \gset
reset role;
select tests.authenticate_as(:'ria');
select tests.confirm(((:'d6'::jsonb) ->> 'visit_id')::uuid) as d7 \gset
select tests.confirm(((:'d6'::jsonb) ->> 'visit_id')::uuid) as d8 \gset
reset role;
select is((:'d8'::jsonb) ->> 'outcome', 'stamped', 'D: Ria''s first NO stamp is from this visit, so it replays as stamped');
select is(:'d8'::jsonb, :'d7'::jsonb, 'D: with the same points');
select tests.authenticate_as(:'tom');
select tests.confirm(((:'d6'::jsonb) ->> 'visit_id')::uuid) as d9 \gset
reset role;
select is((:'d9'::jsonb) ->> 'outcome', 'repeat', 'D: the checker''s own repeat replays as a repeat');

-- ---------------------------------------------------------------- E: table_pending only when it can happen
set local app.now = '2026-07-03 19:00:00+01';
select tests.authenticate_as(:'uma');
select pg_temp.ci(:'r_np', :'g', '{}', null) as e1 \gset
reset role;
select is(((:'e1'::jsonb) ->> 'table_pending')::int, 0, 'E: just me: no "+5 when 2 more confirm"');

select tests.authenticate_as(:'uma');
select pg_temp.ci(:'r_mn', :'g', array[:'sam']::uuid[], null) as e2 \gset
reset role;
select is(((:'e2'::jsonb) ->> 'table_pending')::int, 0, 'E: one friend tagged: the bonus can''t happen');

select tests.authenticate_as(:'uma');
select pg_temp.ci(:'r_bt', :'g', array[:'sam', :'tom']::uuid[], 'aaaaaaaa-0000-4000-8000-000000000004') as e3 \gset
reset role;
select is(((:'e3'::jsonb) ->> 'table_pending')::int, 2, 'E: two friends tagged: +5 when 2 more confirm');

select tests.authenticate_as(:'sam');
select public.decline_attendance(((:'e3'::jsonb) ->> 'visit_id')::uuid);
reset role;
select tests.authenticate_as(:'tom');
select tests.confirm(((:'e3'::jsonb) ->> 'visit_id')::uuid) as e4 \gset
reset role;
select is(((:'e4'::jsonb) ->> 'table_pending')::int, 0, 'E: after a decline nobody is left to make the third');

-- After the 7-day window the pending rows have lapsed.
set local app.now = '2026-07-01 19:00:00+01';
select tests.authenticate_as(:'tom');
select pg_temp.ci(:'r_fi', :'g', array[:'sam', :'uma']::uuid[], 'aaaaaaaa-0000-4000-8000-000000000005') as e5 \gset
reset role;
set local app.now = '2026-07-09 19:00:00+01';
select tests.authenticate_as(:'tom');
select pg_temp.ci(:'r_fi', :'g', array[:'sam', :'uma']::uuid[], 'aaaaaaaa-0000-4000-8000-000000000005') as e6 \gset
reset role;
select is(((:'e5'::jsonb) ->> 'table_pending')::int, 2, 'E: inside the window: 2 more needed');
select is(((:'e6'::jsonb) ->> 'table_pending')::int, 0, 'E: after 7 days the pending rows have lapsed');
select is((:'e6'::jsonb) ->> 'visit_id', (:'e5'::jsonb) ->> 'visit_id', 'E: the late retry still finds the visit');

select has_index('public', 'visits', 'visits_creator_client_key', 'visits has a unique (created_by, client_key) index');

select * from finish();
rollback;
