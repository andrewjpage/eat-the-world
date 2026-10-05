-- Attendance (brief section 4): decline gives no stamp; the 7-day confirm window is enforced
-- lazily, so confirm is refused after 7 days and the lapsed attendee gets nothing.
begin;
select plan(10);

select tests.create_user('alice@test.local') as alice \gset
select tests.create_user('bob@test.local') as bob \gset
select tests.create_user('cara@test.local') as cara \gset
select tests.create_user('dan@test.local') as dan \gset
select tests.add_city('attendance-city', array['NP']) as city \gset
select tests.add_restaurant(:'city', 'NP', 'Attendance NP') as r_np \gset
select tests.make_group(:'alice', 'Attendance group', array[:'bob', :'cara', :'dan']::uuid[]) as g \gset

set local app.now = '2026-07-01 12:00:00+01';
select tests.authenticate_as(:'alice');
select tests.checkin(:'r_np', :'g', array[:'bob', :'cara', :'dan']::uuid[]) as res \gset
reset role;
select (:'res'::jsonb) ->> 'visit_id' as v \gset
select is(((:'res'::jsonb) ->> 'table_pending')::int, 2, 'checker alone: 2 more needed');

-- Bob declines.
set local app.now = '2026-07-01 13:00:00+01';
select tests.authenticate_as(:'bob');
select public.decline_attendance(:'v');
reset role;
select is(tests.attendance_of(:'v', :'bob') ->> 'status', 'declined', 'decline sets status declined');
select is(tests.stamp_of(:'bob', 'NP'), null, 'a declined attendee gets no stamp');
select isnt(tests.stamp_of(:'alice', 'NP'), null, 'the checker keeps her stamp');

-- Cara confirms 6 days 23 hours later: still inside the window.
set local app.now = '2026-07-08 11:00:00+01';
select tests.authenticate_as(:'cara');
select tests.confirm(:'v') as res_cara \gset
reset role;
select is((:'res_cara'::jsonb) ->> 'outcome', 'stamped', 'confirm inside 7 days stamps');

-- Dan confirms 7 days and 1 second later: refused.
set local app.now = '2026-07-08 12:00:01+01';
select tests.authenticate_as(:'dan');
select throws_ok(format('select public.confirm_attendance(%L, null, null, null, null)', :'v'),
  null, null, 'confirm after 7 days is refused');
reset role;
select is(tests.stamp_of(:'dan', 'NP'), null, 'a lapsed attendee gets no stamp');
select isnt(tests.attendance_of(:'v', :'dan') ->> 'status', 'confirmed', 'the lapsed attendance is not confirmed');
select is((tests.stamp_of(:'alice', 'NP') ->> 'table_bonus')::int, 0, 'one decline and one lapse: no table bonus');

-- Claim on a declined attendance does nothing.
select tests.authenticate_as(:'bob');
select tests.try_exec(format('select public.claim_stamp(%L)', :'v')) as ignored \gset
reset role;
select is(tests.stamp_of(:'bob', 'NP'), null, 'claiming a declined attendance creates no stamp');

select * from finish();
rollback;
