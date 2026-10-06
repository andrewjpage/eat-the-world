-- Table bonus (+5 once >= 3 group members confirmed, reaching every stamp from the visit, never
-- with 2) and the signature dish bonus (+2 only for an approved dish of the country, by id).
begin;
select plan(28);

select tests.create_user('tina@test.local') as tina \gset
select tests.create_user('u1@test.local') as u1 \gset
select tests.create_user('u2@test.local') as u2 \gset
select tests.create_user('u3@test.local') as u3 \gset
select tests.create_user('outsider@test.local') as outsider \gset

select tests.add_city('table-dish-city', array['NP', 'MN', 'BT']) as city \gset
select tests.add_restaurant(:'city', 'NP', 'Table NP') as r_np \gset
select tests.add_restaurant(:'city', 'MN', 'Table MN') as r_mn \gset
select tests.add_restaurant(:'city', 'BT', 'Table BT') as r_bt \gset
select tests.add_dish('BT', 'Ema datshi (table test)', 'approved') as dish_bt_ok \gset
select tests.add_dish('BT', 'Draft BT dish (table test)', 'draft') as dish_bt_draft \gset
select tests.add_dish('NP', 'Momo (table test)', 'approved') as dish_np_ok \gset

select tests.make_group(:'tina', 'Table group', array[:'u1', :'u2', :'u3']::uuid[]) as g \gset
select tests.make_group(:'outsider', 'Outsider group') as g_out \gset

-- ---------------------------------------------------------------- tagging rules
set local app.now = '2026-07-01 12:00:00+01';
select tests.authenticate_as(:'tina');
select throws_ok(format('select public.check_in(%L, %L, null, null, null, array[%L]::uuid[], null, null, null, null)',
  :'r_np', :'g', :'outsider'), null, null, 'tagging a non-member is refused');
select throws_ok(format('select public.check_in(%L, %L, null, null, null, ''{}''::uuid[], null, null, null, null)',
  :'r_np', :'g_out'), null, null, 'checking in to a group you are not in is refused');
reset role;
select is((select count(*)::int from public.visits where created_by = :'tina'), 0, 'no visit was created by the refused check-ins');
select is(tests.stamp_of(:'tina', 'NP'), null, 'no stamp from the refused check-ins');

-- u1 already has MN from a solo visit.
select tests.authenticate_as(:'u1');
select tests.checkin(:'r_mn', :'g') as res_u1_mn \gset
reset role;
select (:'res_u1_mn'::jsonb) ->> 'visit_id' as v_u1_mn \gset

-- ---------------------------------------------------------------- never with 2; all stamps at 3
set local app.now = '2026-07-02 12:00:00+01';
select tests.authenticate_as(:'tina');
select tests.checkin(:'r_np', :'g', array[:'u1', :'u2', :'u3']::uuid[]) as res_np \gset
reset role;
select (:'res_np'::jsonb) ->> 'visit_id' as v_np \gset
select is(((:'res_np'::jsonb) ->> 'table_pending')::int, 2, 'checker alone: 2 more needed');

select tests.authenticate_as(:'u1');
select public.decline_attendance(:'v_np');
reset role;
select is(tests.attendance_of(:'v_np', :'u1') ->> 'status', 'declined', 'u1 declined');

select tests.authenticate_as(:'u2');
select tests.confirm(:'v_np') as res_np_u2 \gset
reset role;
select is(((:'res_np_u2'::jsonb) ->> 'table_pending')::int, 1, 'two confirmed: 1 more needed');
select is((tests.stamp_of(:'tina', 'NP') ->> 'table_bonus')::int, 0, 'two confirmed: no table bonus for the checker');
select is((tests.stamp_of(:'u2', 'NP') ->> 'table_bonus')::int, 0, 'two confirmed: no table bonus for the confirmer');

select tests.authenticate_as(:'u3');
select tests.confirm(:'v_np') as res_np_u3 \gset
reset role;
select is(((:'res_np_u3'::jsonb) ->> 'table_pending')::int, 0, 'three confirmed: table bonus applies');
select is((tests.stamp_of(:'u3', 'NP') ->> 'table_bonus')::int, 5, 'third confirmer gets +5');
select is((tests.stamp_of(:'tina', 'NP') ->> 'table_bonus')::int, 5, 'earlier checker stamp raised to +5');
select is((tests.stamp_of(:'u2', 'NP') ->> 'table_bonus')::int, 5, 'earlier confirmer stamp raised to +5');
select is(tests.points(:'tina', 'NP'), 30, 'checker: 10 + 15 + 5 = 30');
select is(tests.stamp_of(:'u1', 'NP'), null, 'the declined attendee gets no stamp');

-- ---------------------------------------------------------------- a confirmed repeat attendee counts
set local app.now = '2026-07-03 12:00:00+01';
select tests.authenticate_as(:'tina');
select tests.checkin(:'r_mn', :'g', array[:'u1', :'u2']::uuid[]) as res_mn \gset
reset role;
select (:'res_mn'::jsonb) ->> 'visit_id' as v_mn \gset
select tests.authenticate_as(:'u1');
select tests.confirm(:'v_mn') as res_mn_u1 \gset
reset role;
select is((:'res_mn_u1'::jsonb) ->> 'outcome', 'repeat', 'u1 already had MN: repeat');
select is(((:'res_mn_u1'::jsonb) ->> 'table_pending')::int, 1, 'the repeat attendee still counts toward the table');
select tests.authenticate_as(:'u2');
select tests.confirm(:'v_mn') as res_mn_u2 \gset
reset role;
select is((tests.stamp_of(:'tina', 'MN') ->> 'table_bonus')::int, 5, 'checker gets +5 with a repeat attendee as the third');
select is((tests.stamp_of(:'u2', 'MN') ->> 'table_bonus')::int, 5, 'confirmer gets +5 with a repeat attendee as the third');
select is((tests.stamp_of(:'u1', 'MN') ->> 'visit_id')::uuid, :'v_u1_mn'::uuid, 'the repeat attendee keeps the stamp from the first visit');
select is((tests.stamp_of(:'u1', 'MN') ->> 'table_bonus')::int, 0, 'the repeat attendee''s earlier stamp is not changed');

-- ---------------------------------------------------------------- signature dish bonus
set local app.now = '2026-07-04 12:00:00+01';
select tests.authenticate_as(:'tina');
select tests.checkin(:'r_bt', :'g', array[:'u1', :'u2', :'u3']::uuid[], :'dish_bt_draft') as res_bt \gset
reset role;
select (:'res_bt'::jsonb) ->> 'visit_id' as v_bt \gset
select tests.authenticate_as(:'u1');
select tests.confirm(:'v_bt', :'dish_np_ok') as res_bt_u1 \gset
reset role;
select tests.authenticate_as(:'u2');
select tests.confirm(:'v_bt', null, 'something else') as res_bt_u2 \gset
reset role;
select tests.authenticate_as(:'u3');
select tests.confirm(:'v_bt', :'dish_bt_ok') as res_bt_u3 \gset
reset role;
select is((tests.stamp_of(:'tina', 'BT') ->> 'dish_bonus')::int, 0, 'a draft dish gives no dish bonus');
select is((tests.stamp_of(:'u1', 'BT') ->> 'dish_bonus')::int, 0, 'another country''s approved dish gives no dish bonus');
select is((tests.stamp_of(:'u2', 'BT') ->> 'dish_bonus')::int, 0, 'dish_other gives no dish bonus');
select is((tests.stamp_of(:'u3', 'BT') ->> 'dish_bonus')::int, 2, 'an approved dish of the country, by id: +2');
select is(((:'res_bt_u3'::jsonb) -> 'points' ->> 'dish')::int, 2, 'StampResult shows dish 2');
select is(tests.points(:'u3', 'BT'), 32, 'u3: 10 + 15 + 5 + 2 = 32');
select is((tests.attendance_of(:'v_bt', :'u2') ->> 'dish_other'), 'something else', 'dish_other is stored on the attendance');

select * from finish();
rollback;
