-- Eat the World: Postgres functions (docs/architecture.md "Functions",
-- "Stamp algorithm", "Set awards"; brief sections 2-4 and 8).
--
-- Every SECURITY DEFINER function sets search_path = '' and schema-qualifies
-- every name. API functions check auth.uid(). Internal helpers (prefixed _ or
-- tg_, plus award_sets) are not executable by authenticated; grants are in
-- 20261005120200_rls_storage.sql.

-- ---------------------------------------------------------------------------
-- RLS helpers (executable by authenticated; they only answer about the caller)
-- ---------------------------------------------------------------------------

create or replace function public.is_curator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.is_curator from public.profiles p where p.user_id = auth.uid()),
    false
  )
$$;

create or replace function public.is_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members gm
     where gm.group_id = p_group_id and gm.user_id = auth.uid()
  )
$$;

create or replace function public.is_group_owner(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.groups g
     where g.id = p_group_id and g.owner_id = auth.uid()
  )
$$;

-- True for the caller themself, or anyone who shares a group with the caller.
create or replace function public.shares_group_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and (
    p_user_id = auth.uid()
    or exists (
      select 1
        from public.group_members me
        join public.group_members them on them.group_id = me.group_id
       where me.user_id = auth.uid() and them.user_id = p_user_id
    )
  )
$$;

create or replace function public.can_read_visit(p_visit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.visits v
      join public.group_members gm on gm.group_id = v.group_id
     where v.id = p_visit_id and gm.user_id = auth.uid()
  )
$$;

create or replace function public.can_read_plan(p_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.plans p
      join public.group_members gm on gm.group_id = p.group_id
     where p.id = p_plan_id and gm.user_id = auth.uid()
  )
$$;

-- Storage read check for visit-photos objects named <group_id>/<visit_id>.jpg.
create or replace function public.can_read_visit_photo(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_first text := split_part(coalesce(p_name, ''), '/', 1);
begin
  if auth.uid() is null
     or v_first !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return false;
  end if;
  return public.is_group_member(v_first::uuid);
end;
$$;

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

create or replace function public._require_uid()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Please sign in first.';
  end if;
  return v_uid;
end;
$$;

create or replace function public._new_invite_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_code text;
  i int;
begin
  loop
    v_bytes := extensions.gen_random_bytes(8);
    v_code := '';
    for i in 0..7 loop
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.groups g where g.invite_code = v_code);
  end loop;
  return v_code;
end;
$$;

-- Rarity: restaurants for the city/country that are active or reported_closed,
-- plus the visited one whatever its status (minimum 1).
create or replace function public._rarity_bonus(p_restaurant_id uuid)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_city uuid;
  v_country text;
  v_status public.restaurant_status;
  v_count int;
begin
  select r.city_id, r.country_iso2, r.status
    into v_city, v_country, v_status
    from public.restaurants r where r.id = p_restaurant_id;

  select count(*) into v_count
    from public.restaurants r
   where r.city_id = v_city and r.country_iso2 = v_country
     and r.status in ('active', 'reported_closed');

  if v_status not in ('active', 'reported_closed') then
    v_count := v_count + 1;
  end if;

  return case
    when v_count <= 1 then 15
    when v_count <= 3 then 10
    when v_count <= 9 then 5
    else 0
  end;
end;
$$;

-- Confirmed attendees of the visit who are members of the visit's group.
create or replace function public._confirmed_member_count(p_visit_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
    from public.visit_attendees a
    join public.visits v on v.id = a.visit_id
    join public.group_members gm on gm.group_id = v.group_id and gm.user_id = a.user_id
   where a.visit_id = p_visit_id and a.status = 'confirmed'
$$;

-- Once >= 3 group members have confirmed, every stamp from the visit gets +5.
-- Never removed: the qualification is remembered on the visit.
create or replace function public._recompute_table_bonus(p_visit_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if public._confirmed_member_count(p_visit_id) >= 3 then
    update public.visits v
       set table_qualified_at = public.app_now()
     where v.id = p_visit_id and v.table_qualified_at is null;
  end if;

  update public.stamps s
     set table_bonus = 5
    from public.visits v
   where v.id = p_visit_id
     and v.table_qualified_at is not null
     and s.visit_id = p_visit_id
     and s.table_bonus <> 5;
end;
$$;

-- Set awards for one user: each set active in a city (>= 2 of its countries
-- listed there) and fully covered by the user's visit stamps. Never revoked.
create or replace function public.award_sets(p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into public.set_awards (user_id, set_id, city_id, awarded_at, points)
  select distinct on (s.id) p_user_id, s.id, c.id, public.app_now(), 25
    from public.sets s
   cross join public.cities c
   cross join lateral (
     select array_agg(distinct r.country_iso2) as listed
       from public.restaurants r
      where r.city_id = c.id
        and r.status in ('active', 'reported_closed')
        and r.country_iso2 = any (s.country_iso2s)
   ) l
   where cardinality(coalesce(l.listed, '{}')) >= 2
     and not exists (
       select 1 from unnest(l.listed) as needed(iso2)
        where not exists (
          select 1 from public.stamps st
           where st.user_id = p_user_id
             and st.country_iso2 = needed.iso2
             and not st.backfilled
        )
     )
   order by s.id, c.name, c.id
  on conflict (user_id, set_id) do nothing;
end;
$$;

create or replace function public._award_sets_all()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  for v_user in
    select distinct st.user_id from public.stamps st where not st.backfilled
  loop
    perform public.award_sets(v_user);
  end loop;
end;
$$;

create or replace function public.tg_award_sets_all()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._award_sets_all();
  return null;
end;
$$;

create trigger restaurants_award_sets_insert
after insert on public.restaurants
for each statement execute function public.tg_award_sets_all();

create trigger restaurants_award_sets_update
after update of status, city_id, country_iso2 on public.restaurants
for each statement execute function public.tg_award_sets_all();

create trigger restaurants_award_sets_delete
after delete on public.restaurants
for each statement execute function public.tg_award_sets_all();

create trigger sets_award_sets
after insert or update on public.sets
for each statement execute function public.tg_award_sets_all();

-- The stamp algorithm for one confirmed attendance. Returns the outcome:
-- repeat, waiting, upgraded or stamped.
create or replace function public._stamp_for_attendance(p_visit_id uuid, p_user_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_visit public.visits%rowtype;
  v_country text;
  v_existing public.stamps%rowtype;
  v_dish uuid;
  v_dish_bonus int := 0;
  v_table_bonus int := 0;
  v_today_count int;
  v_now timestamptz := public.app_now();
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_user_id::text));

  select * into v_visit from public.visits v where v.id = p_visit_id;
  select r.country_iso2 into v_country from public.restaurants r where r.id = v_visit.restaurant_id;

  select * into v_existing
    from public.stamps s
   where s.user_id = p_user_id and s.country_iso2 = v_country
   for update;

  -- 1. Already has a visit stamp: a repeat, which never touches the cap.
  if found and not v_existing.backfilled then
    update public.visit_attendees a set stamp_waiting = false
     where a.visit_id = p_visit_id and a.user_id = p_user_id and a.stamp_waiting;
    return 'repeat';
  end if;

  -- 2. Daily cap, counted on stamped_at in Europe/London.
  select count(*) into v_today_count
    from public.stamps s
   where s.user_id = p_user_id
     and s.stamped_at is not null
     and public.london_date(s.stamped_at) = public.london_date(v_now);

  if v_today_count >= public.max_new_stamps_per_day() then
    update public.visit_attendees a set stamp_waiting = true
     where a.visit_id = p_visit_id and a.user_id = p_user_id;
    return 'waiting';
  end if;

  select a.signature_dish_id into v_dish
    from public.visit_attendees a
   where a.visit_id = p_visit_id and a.user_id = p_user_id;

  if v_dish is not null and exists (
    select 1 from public.signature_dishes d
     where d.id = v_dish and d.status = 'approved' and d.country_iso2 = v_country
  ) then
    v_dish_bonus := 2;
  end if;

  if v_visit.table_qualified_at is not null
     or public._confirmed_member_count(p_visit_id) >= 3 then
    v_table_bonus := 5;
  end if;

  update public.visit_attendees a set stamp_waiting = false
   where a.visit_id = p_visit_id and a.user_id = p_user_id and a.stamp_waiting;

  -- 3. Upgrade a backfilled stamp in place.
  if v_existing.user_id is not null and v_existing.backfilled then
    update public.stamps s
       set backfilled   = false,
           visit_id     = p_visit_id,
           earned_at    = v_visit.visited_at,
           stamped_at   = v_now,
           base         = 10,
           rarity_bonus = v_visit.rarity_bonus,
           table_bonus  = v_table_bonus,
           dish_bonus   = v_dish_bonus,
           verification = v_visit.verification
     where s.user_id = p_user_id and s.country_iso2 = v_country;
    return 'upgraded';
  end if;

  -- 4. A new stamp.
  insert into public.stamps (
    user_id, country_iso2, visit_id, earned_at, stamped_at,
    base, rarity_bonus, table_bonus, dish_bonus, verification, backfilled
  ) values (
    p_user_id, v_country, p_visit_id, v_visit.visited_at, v_now,
    10, v_visit.rarity_bonus, v_table_bonus, v_dish_bonus, v_visit.verification, false
  );
  return 'stamped';
end;
$$;

-- Builds the StampResult jsonb for the caller after an action on a visit.
create or replace function public._stamp_result(p_visit_id uuid, p_user_id uuid, p_outcome text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_visit public.visits%rowtype;
  v_country text;
  v_stamp public.stamps%rowtype;
  v_points jsonb := null;
  v_first boolean := false;
  v_pending int;
begin
  select * into v_visit from public.visits v where v.id = p_visit_id;
  select r.country_iso2 into v_country from public.restaurants r where r.id = v_visit.restaurant_id;

  if p_outcome in ('stamped', 'upgraded') then
    select * into v_stamp from public.stamps s
     where s.user_id = p_user_id and s.country_iso2 = v_country;
    v_points := jsonb_build_object(
      'base', v_stamp.base,
      'rarity', v_stamp.rarity_bonus,
      'table', v_stamp.table_bonus,
      'dish', v_stamp.dish_bonus,
      'total', v_stamp.base + v_stamp.rarity_bonus + v_stamp.table_bonus + v_stamp.dish_bonus
    );
    v_first := not exists (
      select 1
        from public.stamps s
        join public.group_members gm on gm.user_id = s.user_id and gm.group_id = v_visit.group_id
       where s.country_iso2 = v_country
         and not s.backfilled
         and s.user_id <> p_user_id
    );
  end if;

  if v_visit.table_qualified_at is not null then
    v_pending := 0;
  else
    v_pending := greatest(0, 3 - public._confirmed_member_count(p_visit_id));
  end if;

  return jsonb_build_object(
    'visit_id', p_visit_id,
    'outcome', p_outcome,
    'country_iso2', v_country,
    'points', v_points,
    'table_pending', v_pending,
    'first_in_group', v_first,
    'verification', v_visit.verification
  );
end;
$$;

-- Runs after an attendance becomes confirmed (or on claim): stamp, table
-- bonus for the whole visit, then set awards for the user.
create or replace function public._after_confirmation(p_visit_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_outcome text;
begin
  -- Serialise confirmations of one visit, so two people confirming at once
  -- can't each count only 2 and both miss the table bonus. Lock order is
  -- always visit row, then the user's advisory lock.
  perform 1 from public.visits v where v.id = p_visit_id for update;
  v_outcome := public._stamp_for_attendance(p_visit_id, p_user_id);
  perform public._recompute_table_bonus(p_visit_id);
  perform public.award_sets(p_user_id);
  return public._stamp_result(p_visit_id, p_user_id, v_outcome);
end;
$$;

create or replace function public._check_dish_and_rating(p_dish_id uuid, p_rating smallint)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_dish_id is not null and not exists (
    select 1 from public.signature_dishes d where d.id = p_dish_id
  ) then
    raise exception 'That dish isn''t on the list.';
  end if;
  if p_rating is not null and (p_rating < 1 or p_rating > 5) then
    raise exception 'Ratings go from 1 to 5.';
  end if;
end;
$$;

-- A pending attendance older than 7 days counts as declined.
create or replace function public._is_live_attendance(p_status public.attendance_status, p_visited_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_status = 'confirmed'
      or (p_status = 'pending' and public.app_now() <= p_visited_at + interval '7 days')
$$;

-- ---------------------------------------------------------------------------
-- Groups
-- ---------------------------------------------------------------------------

create or replace function public.create_group(p_name text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
begin
  if char_length(v_name) < 1 or char_length(v_name) > 60 then
    raise exception 'Give the group a name of 1 to 60 characters.';
  end if;
  if not exists (select 1 from public.profiles p where p.user_id = v_uid) then
    raise exception 'Your profile is missing. Please sign out and in again.';
  end if;

  insert into public.groups (name, owner_id, invite_code)
  values (v_name, v_uid, public._new_invite_code())
  returning id into v_id;

  insert into public.group_members (group_id, user_id, role)
  values (v_id, v_uid, 'owner');

  return v_id;
end;
$$;

create or replace function public.join_group(p_invite_code text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  v_code text := upper(regexp_replace(coalesce(p_invite_code, ''), '\s', '', 'g'));
  v_group uuid;
  v_count int;
begin
  select g.id into v_group from public.groups g where g.invite_code = v_code for update;
  if v_group is null then
    raise exception 'That invite code doesn''t match any group.';
  end if;

  if exists (select 1 from public.group_members gm where gm.group_id = v_group and gm.user_id = v_uid) then
    return v_group;
  end if;

  select count(*) into v_count from public.group_members gm where gm.group_id = v_group;
  if v_count >= 20 then
    raise exception 'This group is full: 20 members is the limit.';
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (v_group, v_uid, 'member');

  return v_group;
end;
$$;

create or replace function public.update_group_settings(
  p_group_id uuid,
  p_name text,
  p_verified_only boolean,
  p_season_start date,
  p_season_end date
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  v_name text;
begin
  if not exists (select 1 from public.groups g where g.id = p_group_id and g.owner_id = v_uid) then
    raise exception 'Only the group owner can change its settings.';
  end if;

  v_name := btrim(coalesce(p_name, ''));
  if p_name is not null and (char_length(v_name) < 1 or char_length(v_name) > 60) then
    raise exception 'Give the group a name of 1 to 60 characters.';
  end if;
  if p_season_start is not null and p_season_end is not null and p_season_end < p_season_start then
    raise exception 'The season has to end on or after its start.';
  end if;

  update public.groups g
     set name          = case when p_name is null then g.name else v_name end,
         verified_only = coalesce(p_verified_only, g.verified_only),
         season_start  = p_season_start,
         season_end    = p_season_end
   where g.id = p_group_id;
end;
$$;

create or replace function public.rotate_invite_code(p_group_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  v_code text;
begin
  if not exists (select 1 from public.groups g where g.id = p_group_id and g.owner_id = v_uid) then
    raise exception 'Only the group owner can change the invite link.';
  end if;
  v_code := public._new_invite_code();
  update public.groups g set invite_code = v_code where g.id = p_group_id;
  return v_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- Check-in and attendance
-- ---------------------------------------------------------------------------

-- Location args are used only to compute distance_m (rounded to 10 m); they
-- are never stored and never appear in an error message.
create or replace function public.check_in(
  p_restaurant_id uuid,
  p_group_id uuid,
  p_lat float8 default null,
  p_lon float8 default null,
  p_accuracy float8 default null,
  p_tagged uuid[] default '{}',
  p_signature_dish_id uuid default null,
  p_dish_other text default null,
  p_rating smallint default null,
  p_note text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  v_restaurant public.restaurants%rowtype;
  v_tagged uuid[];
  v_distance_m int := null;
  v_verification public.verification := 'self_reported';
  v_visit uuid;
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'You can only check in with a group you belong to.';
  end if;

  select * into v_restaurant from public.restaurants r where r.id = p_restaurant_id;
  if v_restaurant.id is null then
    raise exception 'We couldn''t find that restaurant.';
  end if;

  perform public._check_dish_and_rating(p_signature_dish_id, p_rating);

  select coalesce(array_agg(distinct t), '{}') into v_tagged
    from unnest(coalesce(p_tagged, '{}')) as t
   where t is not null and t <> v_uid;

  if exists (
    select 1 from unnest(v_tagged) as t
     where not exists (
       select 1 from public.group_members gm where gm.group_id = p_group_id and gm.user_id = t
     )
  ) then
    raise exception 'You can only tag people in this group.';
  end if;

  if p_lat is not null and p_lon is not null
     and p_lat between -90 and 90 and p_lon between -180 and 180 then
    v_distance_m := (round(
      extensions.st_distance(
        v_restaurant.location,
        extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326)::extensions.geography
      ) / 10.0
    ) * 10)::int;
    if p_accuracy is not null and p_accuracy >= 0 and p_accuracy <= 500
       and (v_distance_m - p_accuracy) <= 250 then
      v_verification := 'geo_verified';
    end if;
  end if;

  insert into public.visits (
    restaurant_id, group_id, created_by, visited_at, verification, distance_m, rarity_bonus
  ) values (
    p_restaurant_id, p_group_id, v_uid, public.app_now(), v_verification, v_distance_m,
    public._rarity_bonus(p_restaurant_id)
  ) returning id into v_visit;

  insert into public.visit_attendees (
    visit_id, user_id, status, confirmed_at, signature_dish_id, dish_other, rating, note
  ) values (
    v_visit, v_uid, 'confirmed', public.app_now(), p_signature_dish_id,
    nullif(btrim(p_dish_other), ''), p_rating, nullif(btrim(p_note), '')
  );

  insert into public.visit_attendees (visit_id, user_id, status)
  select v_visit, t, 'pending' from unnest(v_tagged) as t;

  return public._after_confirmation(v_visit, v_uid);
end;
$$;

create or replace function public.confirm_attendance(
  p_visit_id uuid,
  p_signature_dish_id uuid default null,
  p_dish_other text default null,
  p_rating smallint default null,
  p_note text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  v_status public.attendance_status;
  v_visited_at timestamptz;
begin
  select a.status, v.visited_at into v_status, v_visited_at
    from public.visit_attendees a
    join public.visits v on v.id = a.visit_id
   where a.visit_id = p_visit_id and a.user_id = v_uid
   for update of a;

  if v_status is null then
    raise exception 'You weren''t tagged on this visit.';
  end if;
  if v_status = 'confirmed' then
    return public._stamp_result(p_visit_id, v_uid, 'no_change');
  end if;
  if v_status = 'declined' then
    raise exception 'You''ve already declined this visit.';
  end if;
  if public.app_now() > v_visited_at + interval '7 days' then
    raise exception 'This visit is more than 7 days old, so it can''t be confirmed now.';
  end if;

  perform public._check_dish_and_rating(p_signature_dish_id, p_rating);

  update public.visit_attendees a
     set status            = 'confirmed',
         confirmed_at      = public.app_now(),
         signature_dish_id = p_signature_dish_id,
         dish_other        = nullif(btrim(p_dish_other), ''),
         rating            = p_rating,
         note              = nullif(btrim(p_note), '')
   where a.visit_id = p_visit_id and a.user_id = v_uid;

  return public._after_confirmation(p_visit_id, v_uid);
end;
$$;

create or replace function public.decline_attendance(p_visit_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  v_status public.attendance_status;
begin
  select a.status into v_status
    from public.visit_attendees a
   where a.visit_id = p_visit_id and a.user_id = v_uid
   for update;

  if v_status is null then
    raise exception 'You weren''t tagged on this visit.';
  end if;
  if v_status = 'confirmed' then
    raise exception 'You''ve already confirmed this visit.';
  end if;

  update public.visit_attendees a
     set status = 'declined', stamp_waiting = false
   where a.visit_id = p_visit_id and a.user_id = v_uid;
end;
$$;

create or replace function public.claim_stamp(p_visit_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  v_status public.attendance_status;
  v_waiting boolean;
begin
  select a.status, a.stamp_waiting into v_status, v_waiting
    from public.visit_attendees a
   where a.visit_id = p_visit_id and a.user_id = v_uid
   for update;

  if v_status is null then
    raise exception 'You weren''t on this visit.';
  end if;
  if v_status <> 'confirmed' or not v_waiting then
    return public._stamp_result(p_visit_id, v_uid, 'no_change');
  end if;

  return public._after_confirmation(p_visit_id, v_uid);
end;
$$;

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------

create or replace function public.backfill_countries(p_iso2s text[])
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  v_codes text[];
  v_bad text;
  v_count int;
begin
  select coalesce(array_agg(distinct upper(btrim(c))), '{}') into v_codes
    from unnest(coalesce(p_iso2s, '{}')) as c
   where btrim(coalesce(c, '')) <> '';

  select c into v_bad from unnest(v_codes) as c
   where not exists (select 1 from public.countries k where k.iso2 = c)
   limit 1;
  if v_bad is not null then
    raise exception 'Unknown country code %.', v_bad;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_uid::text));

  insert into public.stamps (
    user_id, country_iso2, visit_id, earned_at, stamped_at,
    base, rarity_bonus, table_bonus, dish_bonus, verification, backfilled
  )
  select v_uid, c, null, public.app_now(), null, 0, 0, 0, 0, 'self_reported', true
    from unnest(v_codes) as c
  on conflict (user_id, country_iso2) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.remove_backfilled_stamp(p_iso2 text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  v_code text := upper(btrim(coalesce(p_iso2, '')));
  v_backfilled boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_uid::text));

  select s.backfilled into v_backfilled
    from public.stamps s where s.user_id = v_uid and s.country_iso2 = v_code;

  if v_backfilled is null then
    return;
  end if;
  if not v_backfilled then
    raise exception 'That stamp came from a visit, so it stays.';
  end if;

  delete from public.stamps s
   where s.user_id = v_uid and s.country_iso2 = v_code and s.backfilled;
end;
$$;

-- ---------------------------------------------------------------------------
-- Photos and flags
-- ---------------------------------------------------------------------------

create or replace function public.set_visit_photo(p_visit_id uuid, p_photo_path text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  v_visit public.visits%rowtype;
begin
  select * into v_visit from public.visits v where v.id = p_visit_id for update;
  if v_visit.id is null or v_visit.created_by is distinct from v_uid then
    raise exception 'Only the person who checked in can add the photo.';
  end if;
  if p_photo_path is distinct from (v_visit.group_id::text || '/' || v_visit.id::text || '.jpg') then
    raise exception 'The photo path must be <group_id>/<visit_id>.jpg.';
  end if;

  update public.visits v
     set photo_path   = p_photo_path,
         verification = case
           when v.verification = 'self_reported' and v.downgraded_at is null then 'photo'
           else v.verification
         end
   where v.id = p_visit_id;

  update public.stamps s
     set verification = v.verification
    from public.visits v
   where v.id = p_visit_id and s.visit_id = v.id and s.verification <> v.verification;
end;
$$;

create or replace function public.downgrade_visit(p_visit_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
begin
  if not exists (
    select 1 from public.visits v join public.groups g on g.id = v.group_id
     where v.id = p_visit_id and g.owner_id = v_uid
  ) then
    raise exception 'Only the group owner can downgrade a visit.';
  end if;

  update public.visits v
     set verification     = 'self_reported',
         downgraded_at    = public.app_now(),
         flag_resolved_at = public.app_now()
   where v.id = p_visit_id;

  update public.stamps s
     set verification = 'self_reported'
   where s.visit_id = p_visit_id and s.verification <> 'self_reported';
end;
$$;

create or replace function public.dismiss_flag(p_visit_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
begin
  if not exists (
    select 1 from public.visits v join public.groups g on g.id = v.group_id
     where v.id = p_visit_id and g.owner_id = v_uid
  ) then
    raise exception 'Only the group owner can dismiss a flag.';
  end if;

  update public.visits v set flag_resolved_at = public.app_now() where v.id = p_visit_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Group views
-- ---------------------------------------------------------------------------

-- Visit stamps only (no backfill). verified_only keeps geo_verified and photo
-- stamps. Season: inclusive Europe/London dates on the visit's visited_at
-- (= stamps.earned_at) and on set_awards.awarded_at; an open end is unbounded.
create or replace function public.group_leaderboard(p_group_id uuid, p_season boolean)
returns table (user_id uuid, display_name text, countries int, points int)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  v_group public.groups%rowtype;
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'Only members can see this leaderboard.';
  end if;
  select * into v_group from public.groups g where g.id = p_group_id;

  return query
  with members as (
    select gm.user_id from public.group_members gm where gm.group_id = p_group_id
  ),
  st as (
    select s.user_id,
           count(*)::int as n,
           sum(s.base + s.rarity_bonus + s.table_bonus + s.dish_bonus)::int as pts
      from public.stamps s
      join members m on m.user_id = s.user_id
     where not s.backfilled
       and (not v_group.verified_only or s.verification in ('geo_verified', 'photo'))
       and (not coalesce(p_season, false) or (
             (v_group.season_start is null or public.london_date(s.earned_at) >= v_group.season_start)
         and (v_group.season_end is null or public.london_date(s.earned_at) <= v_group.season_end)))
     group by s.user_id
  ),
  sa as (
    select a.user_id, sum(a.points)::int as pts
      from public.set_awards a
      join members m on m.user_id = a.user_id
     where (not coalesce(p_season, false) or (
             (v_group.season_start is null or public.london_date(a.awarded_at) >= v_group.season_start)
         and (v_group.season_end is null or public.london_date(a.awarded_at) <= v_group.season_end)))
     group by a.user_id
  )
  select m.user_id,
         p.display_name,
         coalesce(st.n, 0)::int,
         (coalesce(st.pts, 0) + coalesce(sa.pts, 0))::int
    from members m
    join public.profiles p on p.user_id = m.user_id
    left join st on st.user_id = m.user_id
    left join sa on sa.user_id = m.user_id
   order by 4 desc, 3 desc, 2 asc;
end;
$$;

create or replace function public.group_together(p_group_id uuid, p_city_id uuid)
returns table (stamped int, listed int)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'Only members can see this group.';
  end if;

  return query
  with listed as (
    select distinct r.country_iso2
      from public.restaurants r
     where r.city_id = p_city_id and r.status in ('active', 'reported_closed')
  )
  select
    (select count(*)::int from listed l
      where exists (
        select 1 from public.stamps s
          join public.group_members gm on gm.user_id = s.user_id and gm.group_id = p_group_id
         where s.country_iso2 = l.country_iso2 and not s.backfilled)),
    (select count(*)::int from listed);
end;
$$;

create or replace function public.group_gaps(p_group_id uuid, p_city_id uuid)
returns table (country_iso2 text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'Only members can see this group.';
  end if;

  return query
  select distinct r.country_iso2
    from public.restaurants r
   where r.city_id = p_city_id
     and r.status in ('active', 'reported_closed')
     and not exists (
       select 1 from public.stamps s
         join public.group_members gm on gm.user_id = s.user_id and gm.group_id = p_group_id
        where s.country_iso2 = r.country_iso2 and not s.backfilled)
   order by 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- Curator
-- ---------------------------------------------------------------------------

create or replace function public.approve_submission(p_submission_id uuid, p_lat float8, p_lon float8)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  v_sub public.submissions%rowtype;
  v_lat float8;
  v_lon float8;
  v_restaurant uuid;
begin
  if not public.is_curator() then
    raise exception 'Only the curator can approve submissions.';
  end if;

  select * into v_sub from public.submissions s where s.id = p_submission_id for update;
  if v_sub.id is null then
    raise exception 'We couldn''t find that submission.';
  end if;
  if v_sub.status <> 'pending' then
    raise exception 'That submission has already been reviewed.';
  end if;

  v_lat := coalesce(p_lat, v_sub.lat);
  v_lon := coalesce(p_lon, v_sub.lon);
  if v_lat is null or v_lon is null then
    raise exception 'This restaurant needs coordinates from its postcode first.';
  end if;

  if exists (
    select 1 from public.restaurants r where r.name = v_sub.name and r.postcode = v_sub.postcode
  ) then
    raise exception 'A restaurant with that name and postcode is already listed.';
  end if;

  insert into public.restaurants (
    city_id, country_iso2, name, address, postcode, lat, lon,
    google_place_id, website, status, confidence, created_by, verified_at
  ) values (
    v_sub.city_id, v_sub.country_iso2, v_sub.name, v_sub.address, v_sub.postcode, v_lat, v_lon,
    v_sub.google_place_id, v_sub.website, 'active', 'community', v_uid, public.app_now()
  ) returning id into v_restaurant;

  update public.submissions s
     set status        = 'approved',
         reviewer_id   = v_uid,
         reviewed_at   = public.app_now(),
         restaurant_id = v_restaurant
   where s.id = p_submission_id;

  return v_restaurant;
end;
$$;

create or replace function public.reject_submission(p_submission_id uuid, p_note text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  v_status public.submission_status;
begin
  if not public.is_curator() then
    raise exception 'Only the curator can reject submissions.';
  end if;

  select s.status into v_status from public.submissions s where s.id = p_submission_id for update;
  if v_status is null then
    raise exception 'We couldn''t find that submission.';
  end if;
  if v_status <> 'pending' then
    raise exception 'That submission has already been reviewed.';
  end if;

  update public.submissions s
     set status      = 'rejected',
         reviewer_id = v_uid,
         reviewed_at = public.app_now(),
         review_note = nullif(btrim(p_note), '')
   where s.id = p_submission_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Account deletion (brief section 8)
-- ---------------------------------------------------------------------------

-- Returns the Storage paths of photos the caller must now remove.
create or replace function public.delete_my_account()
returns text[]
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  v_paths text[] := '{}';
  v_group record;
  v_heir uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_uid::text));

  -- 1. Groups the user owns: pass to the longest-standing other member, or
  --    delete the group (and its visits) if nobody else is in it.
  for v_group in
    select g.id from public.groups g where g.owner_id = v_uid for update
  loop
    select gm.user_id into v_heir
      from public.group_members gm
     where gm.group_id = v_group.id and gm.user_id <> v_uid
     order by gm.joined_at asc, gm.user_id asc
     limit 1;

    if v_heir is not null then
      update public.groups g set owner_id = v_heir where g.id = v_group.id;
      update public.group_members gm set role = 'owner'
       where gm.group_id = v_group.id and gm.user_id = v_heir;
    else
      v_paths := v_paths || coalesce((
        select array_agg(v.photo_path) from public.visits v
         where v.group_id = v_group.id and v.photo_path is not null), '{}');
      delete from public.groups g where g.id = v_group.id;
    end if;
  end loop;

  -- 2. Visits the user created: keep (anonymised, photo removed) if anyone
  --    else is confirmed or still pending on it; otherwise delete.
  v_paths := v_paths || coalesce((
    select array_agg(v.photo_path) from public.visits v
     where v.created_by = v_uid and v.photo_path is not null), '{}');

  update public.visits v
     set created_by = null, photo_path = null
   where v.created_by = v_uid
     and exists (
       select 1 from public.visit_attendees a
        where a.visit_id = v.id and a.user_id <> v_uid
          and public._is_live_attendance(a.status, v.visited_at)
     );

  delete from public.visits v where v.created_by = v_uid;

  -- 3. The user's own data. Other users' stored points are never recomputed.
  delete from public.reactions r where r.user_id = v_uid;
  delete from public.plan_rsvps r where r.user_id = v_uid;
  delete from public.visit_attendees a where a.user_id = v_uid;
  delete from public.stamps s where s.user_id = v_uid;
  delete from public.set_awards a where a.user_id = v_uid;
  delete from public.group_members gm where gm.user_id = v_uid;
  delete from public.profiles p where p.user_id = v_uid;
  delete from auth.users u where u.id = v_uid;

  return coalesce((select array_agg(distinct x) from unnest(v_paths) as x where x is not null), '{}');
end;
$$;
