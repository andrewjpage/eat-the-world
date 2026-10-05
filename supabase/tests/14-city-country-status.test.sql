-- city_country_status (brief section 2): listed is computed (>= 1 restaurant active or
-- reported_closed); uncharted is a stored curator assertion that a new listing resets to
-- unlisted, so the pair reverts to unlisted when that restaurant closes; otherwise unlisted.
begin;
select plan(24);

select tests.create_user('cleo@test.local') as cleo \gset
update public.profiles set is_curator = true where user_id = :'cleo';
select tests.add_city('status-city', array['NP', 'MN', 'BT', 'FI', 'IS', 'NO', 'SE', 'DK', 'IE']) as city \gset

select tests.add_restaurant(:'city', 'MN', 'Status MN a') as r_mn_a \gset
select tests.add_restaurant(:'city', 'BT', 'Status BT reported', 'reported_closed') as r_bt \gset
select tests.add_restaurant(:'city', 'FI', 'Status FI closed', 'closed') as r_fi \gset
select tests.add_restaurant(:'city', 'IS', 'Status IS pending', 'pending') as r_is \gset
select tests.add_restaurant(:'city', 'NO', 'Status NO active', 'active') as r_no1 \gset
select tests.add_restaurant(:'city', 'NO', 'Status NO reported', 'reported_closed') as r_no2 \gset
select tests.add_restaurant(:'city', 'NO', 'Status NO closed', 'closed') as r_no3 \gset

select is((select status || '/' || restaurant_count from public.city_country_status where city_id = :'city' and country_iso2 = 'NP'),
  'unlisted/0', 'no restaurants: unlisted, 0');
select is((select status || '/' || restaurant_count from public.city_country_status where city_id = :'city' and country_iso2 = 'MN'),
  'listed/1', 'one active restaurant: listed, 1');
select is((select status || '/' || restaurant_count from public.city_country_status where city_id = :'city' and country_iso2 = 'BT'),
  'listed/1', 'one reported_closed restaurant: listed, 1');
select is((select status || '/' || restaurant_count from public.city_country_status where city_id = :'city' and country_iso2 = 'FI'),
  'unlisted/0', 'only a closed restaurant: unlisted, 0');
select is((select status || '/' || restaurant_count from public.city_country_status where city_id = :'city' and country_iso2 = 'IS'),
  'unlisted/0', 'only a pending restaurant: unlisted, 0');
select is((select status || '/' || restaurant_count from public.city_country_status where city_id = :'city' and country_iso2 = 'NO'),
  'listed/2', 'active + reported_closed + closed: listed, 2');
select is((select count(*)::int from public.city_country_status where city_id = :'city' and country_iso2 = 'NO'), 1, 'one row per (city, country) pair');

-- A closure report doesn't delist; closing the last eligible restaurant does.
select tests.add_restaurant(:'city', 'MN', 'Status MN b') as r_mn_b \gset
update public.restaurants set status = 'reported_closed' where id = :'r_mn_a';
select is((select status from public.city_country_status where city_id = :'city' and country_iso2 = 'MN'), 'listed', 'a closure report does not delist');
update public.restaurants set status = 'closed' where id = :'r_mn_a';
select is((select status || '/' || restaurant_count from public.city_country_status where city_id = :'city' and country_iso2 = 'MN'),
  'listed/1', 'one of two closed: still listed');
update public.restaurants set status = 'closed' where id = :'r_mn_b';
select is((select status || '/' || restaurant_count from public.city_country_status where city_id = :'city' and country_iso2 = 'MN'),
  'unlisted/0', 'last restaurant closed: unlisted');

-- ---------------------------------------------------------------- uncharted
select tests.authenticate_as(:'cleo');
update public.city_countries set status = 'uncharted' where city_id = :'city' and country_iso2 in ('SE', 'DK', 'IE');
reset role;
select is((select status from public.city_country_status where city_id = :'city' and country_iso2 = 'SE'), 'uncharted', 'curator marks SE uncharted');

-- A pending restaurant is not a listing: SE stays uncharted.
select tests.add_restaurant(:'city', 'SE', 'Status SE', 'pending') as r_se \gset
select is((select status from public.city_country_status where city_id = :'city' and country_iso2 = 'SE'), 'uncharted', 'a pending restaurant leaves it uncharted');
select is((select status::text from public.city_countries where city_id = :'city' and country_iso2 = 'SE'), 'uncharted', 'stored status still uncharted');

-- The curator activates it: listed, and the stored uncharted resets to unlisted.
select tests.authenticate_as(:'cleo');
update public.restaurants set status = 'active' where id = :'r_se';
reset role;
select is((select status from public.city_country_status where city_id = :'city' and country_iso2 = 'SE'), 'listed', 'activated restaurant: listed');
select is((select status::text from public.city_countries where city_id = :'city' and country_iso2 = 'SE'), 'unlisted', 'stored uncharted reset to unlisted');
select tests.authenticate_as(:'cleo');
update public.restaurants set status = 'closed' where id = :'r_se';
reset role;
select is((select status from public.city_country_status where city_id = :'city' and country_iso2 = 'SE'), 'unlisted', 'that restaurant closes: reverts to unlisted, not uncharted');

-- A new active restaurant on an uncharted pair (curator insert).
select tests.authenticate_as(:'cleo');
insert into public.restaurants (city_id, country_iso2, name, address, postcode, lat, lon, status, confidence)
values (:'city', 'DK', 'Status DK', '1 DK St', 'DK0 1AA', 51.5, -0.1, 'active', 'curated');
reset role;
select is((select status from public.city_country_status where city_id = :'city' and country_iso2 = 'DK'), 'listed', 'a new listing overrides uncharted');
select is((select status::text from public.city_countries where city_id = :'city' and country_iso2 = 'DK'), 'unlisted', 'stored uncharted reset on insert');
update public.restaurants set status = 'closed' where city_id = :'city' and country_iso2 = 'DK';
select is((select status from public.city_country_status where city_id = :'city' and country_iso2 = 'DK'), 'unlisted', 'DK reverts to unlisted when it closes');

-- A reported_closed restaurant is eligible too.
select tests.add_restaurant(:'city', 'IE', 'Status IE', 'reported_closed') as r_ie \gset
select is((select status from public.city_country_status where city_id = :'city' and country_iso2 = 'IE'), 'listed', 'a reported_closed listing overrides uncharted');
select is((select status::text from public.city_countries where city_id = :'city' and country_iso2 = 'IE'), 'unlisted', 'stored uncharted reset by a reported_closed insert');

-- Other cities are independent.
select tests.add_city('status-city-2', array['MN']) as city2 \gset
select is((select status from public.city_country_status where city_id = :'city2' and country_iso2 = 'MN'), 'unlisted', 'another city''s pair is unaffected');

-- The stored enum accepts exactly the two stored statuses.
select throws_ok(format('update public.city_countries set status = ''listed'' where city_id = %L and country_iso2 = ''NP''', :'city'),
  null, null, '''listed'' is computed, never stored');
select is((select array_agg(distinct status::text order by status::text) from public.city_countries where city_id = :'city'),
  array['unlisted'], 'all stored statuses are back to unlisted');

select * from finish();
rollback;
