-- Eat the World: core schema (brief sections 2, 3 and 5; docs/architecture.md).
-- Tables, enums, indexes, row triggers and the two security_invoker views.
-- Functions live in 20261005120100_functions.sql; RLS, grants and Storage in
-- 20261005120200_rls_storage.sql.

create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Constants and clock
-- ---------------------------------------------------------------------------

create or replace function public.max_new_stamps_per_day()
returns int
language sql
immutable
set search_path = ''
as $$ select 3 $$;

-- now(), unless the session user is postgres (pgTAP tests) and app.now is set.
-- API callers connect as authenticator, so they can never move the clock.
create or replace function public.app_now()
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_override text;
begin
  if session_user = 'postgres' then
    v_override := nullif(current_setting('app.now', true), '');
    if v_override is not null then
      return v_override::timestamptz;
    end if;
  end if;
  return pg_catalog.now();
end;
$$;

create or replace function public.london_date(p_ts timestamptz)
returns date
language sql
immutable
set search_path = ''
as $$ select (p_ts at time zone 'Europe/London')::date $$;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.city_country_stored_status as enum ('unlisted', 'uncharted');
create type public.restaurant_status as enum ('active', 'reported_closed', 'closed', 'pending');
create type public.confidence as enum ('curated', 'community', 'flagged');
create type public.dish_status as enum ('draft', 'approved');
create type public.member_role as enum ('owner', 'member');
create type public.verification as enum ('geo_verified', 'photo', 'self_reported');
create type public.attendance_status as enum ('pending', 'confirmed', 'declined');
create type public.reaction_emoji as enum ('clap', 'drool', 'side_eye');
create type public.submission_status as enum ('pending', 'approved', 'rejected');
create type public.plan_status as enum ('proposed', 'booked', 'done', 'cancelled');
create type public.rsvp_response as enum ('yes', 'no', 'maybe');

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------

create table public.countries (
  iso2        text primary key check (iso2 ~ '^[A-Z]{2}$'),
  iso_numeric char(3) not null unique check (iso_numeric ~ '^[0-9]{3}$'),
  name        text not null,
  iso_name    text not null,
  flag_emoji  text,
  m49_region  text,
  m49_group   text
);

create table public.cities (
  id   uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9-]+$')
);

-- User references point at profiles (which cascade from auth.users), so
-- PostgREST can embed display names and deletion sets them to null.
create table public.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  avatar_url   text,
  is_curator   boolean not null default false,
  created_at   timestamptz not null default public.app_now()
);

create table public.signature_dishes (
  id           uuid primary key default gen_random_uuid(),
  country_iso2 text not null references public.countries (iso2),
  name         text not null check (char_length(name) between 1 and 120),
  note         text,
  status       public.dish_status not null default 'draft',
  unique (country_iso2, name)
);

create table public.city_countries (
  city_id      uuid not null references public.cities (id) on delete cascade,
  country_iso2 text not null references public.countries (iso2),
  status       public.city_country_stored_status not null default 'unlisted',
  updated_by   uuid references public.profiles (user_id) on delete set null,
  updated_at   timestamptz not null default public.app_now(),
  primary key (city_id, country_iso2)
);

create table public.restaurants (
  id              uuid primary key default gen_random_uuid(),
  city_id         uuid not null references public.cities (id),
  country_iso2    text not null references public.countries (iso2),
  name            text not null check (char_length(name) between 1 and 200),
  address         text,
  postcode        text not null,
  lat             double precision not null check (lat between -90 and 90),
  lon             double precision not null check (lon between -180 and 180),
  location        extensions.geography(Point, 4326),
  google_place_id text,
  website         text,
  status          public.restaurant_status not null default 'active',
  confidence      public.confidence not null default 'curated',
  curator_note    text,
  created_by      uuid references public.profiles (user_id) on delete set null,
  verified_at     timestamptz,
  created_at      timestamptz not null default public.app_now(),
  unique (name, postcode)
);

create index restaurants_location_gist on public.restaurants using gist (location);
create index restaurants_city_country_status_idx on public.restaurants (city_id, country_iso2, status);

-- ---------------------------------------------------------------------------
-- Groups
-- ---------------------------------------------------------------------------

create table public.groups (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 1 and 60),
  owner_id      uuid references public.profiles (user_id) on delete set null,
  invite_code   text not null unique check (invite_code ~ '^[A-Z0-9]{8}$'),
  verified_only boolean not null default false,
  season_start  date,
  season_end    date,
  created_at    timestamptz not null default public.app_now(),
  check (season_start is null or season_end is null or season_end >= season_start)
);

create table public.group_members (
  group_id  uuid not null references public.groups (id) on delete cascade,
  user_id   uuid not null references public.profiles (user_id) on delete cascade,
  role      public.member_role not null default 'member',
  joined_at timestamptz not null default public.app_now(),
  primary key (group_id, user_id)
);

create index group_members_user_idx on public.group_members (user_id);

-- ---------------------------------------------------------------------------
-- Visits and stamps
-- ---------------------------------------------------------------------------

-- No lat/lon of any user is stored anywhere: only distance_m (rounded to 10 m).
-- table_qualified_at records the first moment >= 3 group members were
-- confirmed, so the table bonus is never lost if one of them later leaves.
create table public.visits (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references public.restaurants (id),
  group_id           uuid not null references public.groups (id) on delete cascade,
  created_by         uuid references public.profiles (user_id) on delete set null,
  visited_at         timestamptz not null default public.app_now(),
  verification       public.verification not null default 'self_reported',
  distance_m         int check (distance_m is null or distance_m >= 0),
  rarity_bonus       int not null check (rarity_bonus in (0, 5, 10, 15)),
  photo_path         text,
  flag_resolved_at   timestamptz,
  downgraded_at      timestamptz,
  table_qualified_at timestamptz
);

create index visits_group_idx on public.visits (group_id, visited_at desc);
create index visits_restaurant_idx on public.visits (restaurant_id);
create index visits_created_by_idx on public.visits (created_by);

create table public.visit_attendees (
  visit_id          uuid not null references public.visits (id) on delete cascade,
  user_id           uuid not null references public.profiles (user_id) on delete cascade,
  status            public.attendance_status not null default 'pending',
  confirmed_at      timestamptz,
  signature_dish_id uuid references public.signature_dishes (id) on delete set null,
  dish_other        text check (dish_other is null or char_length(dish_other) <= 120),
  rating            smallint check (rating between 1 and 5),
  note              text check (note is null or char_length(note) <= 1000),
  stamp_waiting     boolean not null default false,
  primary key (visit_id, user_id)
);

create index visit_attendees_user_idx on public.visit_attendees (user_id, status);

create table public.reactions (
  visit_id   uuid not null references public.visits (id) on delete cascade,
  user_id    uuid not null references public.profiles (user_id) on delete cascade,
  emoji      public.reaction_emoji not null,
  created_at timestamptz not null default public.app_now(),
  primary key (visit_id, user_id, emoji)
);

create table public.stamps (
  user_id      uuid not null references public.profiles (user_id) on delete cascade,
  country_iso2 text not null references public.countries (iso2),
  visit_id     uuid references public.visits (id) on delete set null,
  earned_at    timestamptz not null,
  stamped_at   timestamptz,
  base         int not null default 0,
  rarity_bonus int not null default 0,
  table_bonus  int not null default 0,
  dish_bonus   int not null default 0,
  verification public.verification not null,
  backfilled   boolean not null default false,
  primary key (user_id, country_iso2),
  check (
    not backfilled
    or (stamped_at is null and base = 0 and rarity_bonus = 0 and table_bonus = 0
        and dish_bonus = 0 and verification = 'self_reported')
  )
);

create index stamps_visit_idx on public.stamps (visit_id);
create index stamps_user_stamped_idx on public.stamps (user_id, stamped_at);

-- ---------------------------------------------------------------------------
-- Sets
-- ---------------------------------------------------------------------------

create table public.sets (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name          text not null,
  country_iso2s text[] not null check (cardinality(country_iso2s) >= 1)
);

-- Awards are permanent, so a set that has been won cannot be deleted.
create table public.set_awards (
  user_id    uuid not null references public.profiles (user_id) on delete cascade,
  set_id     uuid not null references public.sets (id) on delete restrict,
  city_id    uuid not null references public.cities (id),
  awarded_at timestamptz not null default public.app_now(),
  points     int not null default 25,
  primary key (user_id, set_id)
);

-- ---------------------------------------------------------------------------
-- Submissions, closure reports, plans
-- ---------------------------------------------------------------------------

-- lat/lon here are the postcodes.io centroid of the proposed restaurant's
-- postcode, never a user's location.
create table public.submissions (
  id              uuid primary key default gen_random_uuid(),
  city_id         uuid not null references public.cities (id),
  country_iso2    text not null references public.countries (iso2),
  name            text not null check (char_length(name) between 1 and 200),
  address         text,
  postcode        text not null,
  lat             double precision check (lat between -90 and 90),
  lon             double precision check (lon between -180 and 180),
  google_place_id text,
  website         text,
  note            text check (note is null or char_length(note) <= 1000),
  submitted_by    uuid references public.profiles (user_id) on delete set null,
  status          public.submission_status not null default 'pending',
  reviewer_id     uuid references public.profiles (user_id) on delete set null,
  review_note     text,
  reviewed_at     timestamptz,
  restaurant_id   uuid references public.restaurants (id) on delete set null,
  created_at      timestamptz not null default public.app_now()
);

create index submissions_status_idx on public.submissions (status, created_at);

create table public.closure_reports (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  reported_by   uuid references public.profiles (user_id) on delete set null,
  note          text check (note is null or char_length(note) <= 1000),
  created_at    timestamptz not null default public.app_now(),
  resolved      boolean not null default false
);

create index closure_reports_restaurant_idx on public.closure_reports (restaurant_id);

create table public.plans (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  proposed_by   uuid references public.profiles (user_id) on delete set null,
  proposed_for  timestamptz not null,
  status        public.plan_status not null default 'proposed',
  created_at    timestamptz not null default public.app_now()
);

create index plans_group_idx on public.plans (group_id, proposed_for);

create table public.plan_rsvps (
  plan_id  uuid not null references public.plans (id) on delete cascade,
  user_id  uuid not null references public.profiles (user_id) on delete cascade,
  response public.rsvp_response not null,
  primary key (plan_id, user_id)
);

create index plan_rsvps_user_idx on public.plan_rsvps (user_id);

-- ---------------------------------------------------------------------------
-- Row triggers
-- ---------------------------------------------------------------------------

-- restaurants.location always follows lat/lon; a client can't set it directly.
create or replace function public.tg_restaurants_sync_location()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.location := extensions.st_setsrid(extensions.st_makepoint(new.lon, new.lat), 4326)::extensions.geography;
  return new;
end;
$$;

create trigger restaurants_sync_location
before insert or update of lat, lon, location on public.restaurants
for each row execute function public.tg_restaurants_sync_location();

-- A new or re-opened eligible restaurant overrides a stored 'uncharted'.
create or replace function public.tg_restaurants_reset_uncharted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('active', 'reported_closed') then
    update public.city_countries cc
       set status = 'unlisted'
     where cc.city_id = new.city_id
       and cc.country_iso2 = new.country_iso2
       and cc.status = 'uncharted';
  end if;
  return null;
end;
$$;

create trigger restaurants_reset_uncharted
after insert or update of status, city_id, country_iso2 on public.restaurants
for each row execute function public.tg_restaurants_reset_uncharted();

create or replace function public.tg_city_countries_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Only a status change is a curator edit. Other updates (such as the
  -- ON DELETE SET NULL of updated_by during account deletion) pass through.
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  new.updated_at := public.app_now();
  new.updated_by := coalesce(auth.uid(), case when tg_op = 'UPDATE' then null else new.updated_by end);
  return new;
end;
$$;

create trigger city_countries_touch
before insert or update on public.city_countries
for each row execute function public.tg_city_countries_touch();

-- Sets hold valid, distinct, upper-case ISO codes.
create or replace function public.tg_sets_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_bad text;
begin
  new.country_iso2s := array(
    select distinct upper(btrim(c)) from unnest(new.country_iso2s) as c
    where btrim(coalesce(c, '')) <> '' order by 1
  );
  select c into v_bad
    from unnest(new.country_iso2s) as c
   where not exists (select 1 from public.countries k where k.iso2 = c)
   limit 1;
  if v_bad is not null then
    raise exception 'Unknown country code % in this set.', v_bad;
  end if;
  if cardinality(new.country_iso2s) = 0 then
    raise exception 'A set needs at least one country.';
  end if;
  return new;
end;
$$;

create trigger sets_validate
before insert or update of country_iso2s on public.sets
for each row execute function public.tg_sets_validate();

-- Every new auth user gets a profile. display_name: the Google name, else the
-- email local part.
create or replace function public.tg_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  v_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(btrim(split_part(coalesce(new.email, ''), '@', 1)), ''),
    'Friend'
  );
  insert into public.profiles (user_id, display_name, avatar_url)
  values (
    new.id,
    left(v_name, 60),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.tg_handle_new_user();

-- ---------------------------------------------------------------------------
-- Views (RLS of the caller applies)
-- ---------------------------------------------------------------------------

-- listed is computed, never stored: >= 1 restaurant with status active or
-- reported_closed. Otherwise the stored status, defaulting to unlisted.
create view public.city_country_status
with (security_invoker = true)
as
select
  c.id as city_id,
  k.iso2 as country_iso2,
  (case
     when coalesce(r.n, 0) > 0 then 'listed'
     when cc.status = 'uncharted' then 'uncharted'
     else 'unlisted'
   end)::text as status,
  coalesce(r.n, 0)::int as restaurant_count
from public.cities c
cross join public.countries k
left join public.city_countries cc
  on cc.city_id = c.id and cc.country_iso2 = k.iso2
left join (
  select city_id, country_iso2, count(*) as n
    from public.restaurants
   where status in ('active', 'reported_closed')
   group by city_id, country_iso2
) r on r.city_id = c.id and r.country_iso2 = k.iso2;

create view public.stamp_totals
with (security_invoker = true)
as
select
  s.user_id,
  s.country_iso2,
  s.visit_id,
  (s.base + s.rarity_bonus + s.table_bonus + s.dish_bonus)::int as points,
  s.backfilled,
  s.verification,
  s.earned_at,
  s.stamped_at
from public.stamps s;
