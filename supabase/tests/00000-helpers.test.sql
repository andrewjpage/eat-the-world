-- Test helpers, committed (not rolled back) so later files can use them.
-- Every later file runs inside begin; ... rollback; and builds its own fixtures.
--
-- Conventions used by the other files:
--   * psql variables via \gset hold ids:  select tests.create_user('alice@test.local') as alice \gset
--   * tests.authenticate_as(uuid) switches to role authenticated with that user's JWT claims;
--     tests.clear_authentication() (or plain `reset role`) returns to the postgres session user.
--   * set local app.now = '<timestamptz>' controls app_now() (honoured only for session_user postgres).
--   * tests.stamp_of / visit_of / attendance_of are SECURITY DEFINER "peek" helpers that read the
--     true state regardless of the current role, for assertions.

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;

-- ---------------------------------------------------------------- users and auth

create or replace function tests.create_user(p_email text, p_full_name text default null)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', p_email, '',
    now(), '{"provider":"email","providers":["email"]}'::jsonb,
    case when p_full_name is null then '{}'::jsonb
         else jsonb_build_object('full_name', p_full_name, 'name', p_full_name) end,
    now(), now()
  );
  return v_id;
end;
$$;

create or replace function tests.authenticate_as(p_user_id uuid)
returns void
language plpgsql
as $$
declare
  v_email text;
begin
  select email into v_email from auth.users where id = p_user_id;
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated', 'aud', 'authenticated',
                      'email', v_email)::text, true);
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function tests.authenticate_as_anon()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('role', 'anon', true);
end;
$$;

-- Back to the session user (postgres), with no JWT claims.
create or replace function tests.clear_authentication()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('role', 'none', true);
end;
$$;

-- ---------------------------------------------------------------- running SQL that may fail

-- Runs p_sql as the current role. Returns null on success, else the SQLSTATE.
create or replace function tests.try_exec(p_sql text)
returns text
language plpgsql
as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate;
end;
$$;

-- Runs `select count(*) from (<p_sql>)` as the current role. Returns -1 if it raises.
create or replace function tests.try_count(p_sql text)
returns int
language plpgsql
as $$
declare
  v_n int;
begin
  execute format('select count(*)::int from (%s) as q', p_sql) into v_n;
  return v_n;
exception when others then
  return -1;
end;
$$;

-- ---------------------------------------------------------------- fixtures (call as postgres)

create or replace function tests.ensure_country(p_iso2 text)
returns void
language plpgsql
as $$
declare
  v_num text;
  v_region text;
  v_group text;
begin
  select n, r, g into v_num, v_region, v_group
  from (values
    ('LA','418','Asia','South-eastern Asia'), ('NP','524','Asia','Southern Asia'),
    ('MN','496','Asia','Eastern Asia'), ('BT','064','Asia','Southern Asia'),
    ('FI','246','Europe','Northern Europe'), ('IS','352','Europe','Northern Europe'),
    ('NO','578','Europe','Northern Europe'), ('SE','752','Europe','Northern Europe'),
    ('DK','208','Europe','Northern Europe'), ('IE','372','Europe','Northern Europe'),
    ('CH','756','Europe','Western Europe'), ('AT','040','Europe','Western Europe'),
    ('NL','528','Europe','Western Europe'), ('BE','056','Europe','Western Europe'),
    ('CZ','203','Europe','Eastern Europe'), ('SK','703','Europe','Eastern Europe'),
    ('SI','705','Europe','Southern Europe'), ('HR','191','Europe','Southern Europe'),
    ('RS','688','Europe','Southern Europe'), ('AL','008','Europe','Southern Europe'),
    ('GR','300','Europe','Southern Europe'), ('CY','196','Asia','Western Asia'),
    ('MT','470','Europe','Southern Europe'), ('KE','404','Africa','Eastern Africa'),
    ('TZ','834','Africa','Eastern Africa'), ('UG','800','Africa','Eastern Africa'),
    ('ZA','710','Africa','Southern Africa'), ('EG','818','Africa','Northern Africa'),
    ('TN','788','Africa','Northern Africa'), ('MA','504','Africa','Northern Africa'),
    ('JP','392','Asia','Eastern Asia'), ('KR','410','Asia','Eastern Asia'),
    ('MX','484','Americas','Central America'), ('CA','124','Americas','Northern America'),
    ('AU','036','Oceania','Australia and New Zealand'), ('NZ','554','Oceania','Australia and New Zealand'),
    ('DE','276','Europe','Western Europe'), ('FR','250','Europe','Western Europe'),
    ('IT','380','Europe','Southern Europe'), ('IL','376','Asia','Western Asia'),
    ('BG','100','Europe','Eastern Europe'), ('MK','807','Europe','Southern Europe'),
    ('BA','070','Europe','Southern Europe'), ('ME','499','Europe','Southern Europe'),
    ('LT','440','Europe','Northern Europe'), ('LV','428','Europe','Northern Europe'),
    ('EE','233','Europe','Northern Europe'), ('BY','112','Europe','Eastern Europe'),
    ('MD','498','Europe','Eastern Europe')
  ) as m(i, n, r, g)
  where m.i = p_iso2;

  if v_num is null then
    raise exception 'tests.ensure_country: no fixture mapping for %', p_iso2;
  end if;

  insert into public.countries (iso2, iso_numeric, name, iso_name, flag_emoji, m49_region, m49_group)
  values (p_iso2, v_num, 'Test ' || p_iso2, 'Test ' || p_iso2, '', v_region, v_group)
  on conflict do nothing;
end;
$$;

-- A fresh city (so seeded London rows never affect rarity or listings), with an `unlisted`
-- city_countries row for each given country, as the seed does for London.
create or replace function tests.add_city(p_slug text, p_iso2s text[])
returns uuid
language plpgsql
as $$
declare
  v_city uuid;
  v_iso text;
begin
  insert into public.cities (name, slug) values ('City ' || p_slug, p_slug) returning id into v_city;
  foreach v_iso in array p_iso2s loop
    perform tests.ensure_country(v_iso);
    insert into public.city_countries (city_id, country_iso2, status)
    values (v_city, v_iso, 'unlisted')
    on conflict do nothing;
  end loop;
  return v_city;
end;
$$;

create or replace function tests.add_restaurant(
  p_city uuid, p_iso2 text, p_name text, p_status text default 'active',
  p_lat double precision default 51.5074, p_lon double precision default -0.1278)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  perform tests.ensure_country(p_iso2);
  insert into public.city_countries (city_id, country_iso2, status)
  values (p_city, p_iso2, 'unlisted')
  on conflict do nothing;
  insert into public.restaurants (city_id, country_iso2, name, address, postcode, lat, lon,
                                  status, confidence, curator_note)
  values (p_city, p_iso2, p_name, p_name || ' Street, London',
          'T' || upper(substr(md5(p_name || p_city::text), 1, 6)), p_lat, p_lon,
          p_status::public.restaurant_status, 'curated', null)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function tests.add_dish(p_iso2 text, p_name text, p_status text default 'approved')
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  perform tests.ensure_country(p_iso2);
  insert into public.signature_dishes (country_iso2, name, note, status)
  values (p_iso2, p_name, null, p_status::public.dish_status)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function tests.add_set(p_slug text, p_iso2s text[])
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into public.sets (slug, name, country_iso2s)
  values (p_slug, 'Set ' || p_slug, p_iso2s)
  returning id into v_id;
  return v_id;
end;
$$;

-- Creates a group through the real functions: the owner calls create_group, then each member
-- calls join_group with the invite code. Call as postgres; returns as postgres.
create or replace function tests.make_group(p_owner uuid, p_name text, p_members uuid[] default '{}')
returns uuid
language plpgsql
as $$
declare
  v_group uuid;
  v_code text;
  v_member uuid;
  v_was_curator boolean;
begin
  -- Groups are invite-only: a new group needs a curator or an existing member. Lend the owner the
  -- curator flag for the one call, then put it back.
  select p.is_curator into v_was_curator from public.profiles p where p.user_id = p_owner;
  update public.profiles set is_curator = true where user_id = p_owner;
  perform tests.authenticate_as(p_owner);
  v_group := public.create_group(p_name);
  perform tests.clear_authentication();
  update public.profiles set is_curator = coalesce(v_was_curator, false) where user_id = p_owner;
  select invite_code into v_code from public.groups where id = v_group;
  foreach v_member in array coalesce(p_members, '{}'::uuid[]) loop
    perform tests.authenticate_as(v_member);
    perform public.join_group(v_code);
    perform tests.clear_authentication();
  end loop;
  return v_group;
end;
$$;

-- Each user in turn calls join_group(p_code). Call as postgres; returns as postgres.
create or replace function tests.join_as(p_users uuid[], p_code text)
returns int
language plpgsql
as $$
declare
  v_user uuid;
  v_n int := 0;
begin
  foreach v_user in array p_users loop
    perform tests.authenticate_as(v_user);
    perform public.join_group(p_code);
    perform tests.clear_authentication();
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------- thin wrappers (run as current role)

create or replace function tests.checkin(
  p_restaurant uuid, p_group uuid, p_tagged uuid[] default '{}', p_dish uuid default null,
  p_lat double precision default null, p_lon double precision default null,
  p_accuracy double precision default null, p_dish_other text default null)
returns jsonb
language plpgsql
as $$
begin
  return public.check_in(p_restaurant, p_group, p_lat, p_lon, p_accuracy,
                         coalesce(p_tagged, '{}'::uuid[]), p_dish, p_dish_other,
                         null::smallint, null::text);
end;
$$;

create or replace function tests.confirm(p_visit uuid, p_dish uuid default null, p_dish_other text default null)
returns jsonb
language plpgsql
as $$
begin
  return public.confirm_attendance(p_visit, p_dish, p_dish_other, null::smallint, null::text);
end;
$$;

-- ---------------------------------------------------------------- peek helpers (true state)

create or replace function tests.stamp_of(p_user uuid, p_iso2 text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  select pg_catalog.to_jsonb(s) into v from public.stamps s
  where s.user_id = p_user and s.country_iso2 = p_iso2;
  return v;
end;
$$;

-- base + rarity_bonus + table_bonus + dish_bonus of the stored stamp, or null if none.
create or replace function tests.points(p_user uuid, p_iso2 text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v int;
begin
  select s.base + s.rarity_bonus + s.table_bonus + s.dish_bonus into v from public.stamps s
  where s.user_id = p_user and s.country_iso2 = p_iso2;
  return v;
end;
$$;

create or replace function tests.stamp_count(p_user uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v int;
begin
  select count(*)::int into v from public.stamps s where s.user_id = p_user;
  return v;
end;
$$;

create or replace function tests.visit_of(p_visit uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  select pg_catalog.to_jsonb(x) into v from public.visits x where x.id = p_visit;
  return v;
end;
$$;

create or replace function tests.attendance_of(p_visit uuid, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  select pg_catalog.to_jsonb(a) into v from public.visit_attendees a
  where a.visit_id = p_visit and a.user_id = p_user;
  return v;
end;
$$;

grant execute on all functions in schema tests to anon, authenticated, service_role;
-- The peek helpers bypass RLS, so only postgres may call them (always after `reset role`).
revoke execute on function tests.stamp_of(uuid, text), tests.points(uuid, text), tests.stamp_count(uuid),
  tests.visit_of(uuid), tests.attendance_of(uuid, uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------- self-check

begin;
select plan(6);

select has_function('tests', 'create_user', array['text', 'text'], 'tests.create_user exists');
select has_function('tests', 'authenticate_as', array['uuid'], 'tests.authenticate_as exists');
select has_function('tests', 'clear_authentication', 'tests.clear_authentication exists');

select tests.create_user('helper.check@test.local') as helper_user \gset
select tests.authenticate_as(:'helper_user');
select is(current_user::text, 'authenticated', 'authenticate_as switches to role authenticated');
select is(auth.uid(), :'helper_user'::uuid, 'auth.uid() returns the authenticated user');
select tests.clear_authentication();
select is(current_user::text, session_user::text, 'clear_authentication returns to the session user');

select * from finish();
rollback;
