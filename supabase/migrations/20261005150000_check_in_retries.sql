-- Eat the World: safe retries for check-in, confirm and claim on poor signal (M3 review).
-- Tests: supabase/tests/18-check-in-retries.test.sql.
--
-- 1. check_in takes an idempotency key (p_client_key). A retry with the same key returns
--    the first call's StampResult instead of creating a second visit.
-- 2. A retried confirm_attendance or claim_stamp returns the stamp the first call made
--    (not 'no_change' with no points), so the stamp moment still shows the points.
-- 3. table_pending is 0 when the table bonus can no longer happen: fewer live pending
--    group members than the confirmations still needed (attendees are only added at check-in).

alter table public.visits add column client_key uuid;
create unique index visits_creator_client_key
  on public.visits (created_by, client_key)
  where client_key is not null;

-- The outcome a repeated call reports for the user's attendance on a visit that already
-- went through the stamp algorithm. 'upgraded' replays as 'stamped' (same points).
create or replace function public._replay_outcome(p_visit_id uuid, p_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_country text;
begin
  if exists (
    select 1 from public.visit_attendees a
     where a.visit_id = p_visit_id and a.user_id = p_user_id and a.stamp_waiting
  ) then
    return 'waiting';
  end if;

  select r.country_iso2 into v_country
    from public.visits v
    join public.restaurants r on r.id = v.restaurant_id
   where v.id = p_visit_id;

  if exists (
    select 1 from public.stamps s
     where s.user_id = p_user_id and s.country_iso2 = v_country
       and s.visit_id = p_visit_id and not s.backfilled
  ) then
    return 'stamped';
  end if;
  return 'repeat';
end;
$$;

-- Same as before, except table_pending: 0 once the bonus applies, and also 0 when the
-- live pending group members (inside the 7-day window) can't make up the shortfall.
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
  v_needed int;
  v_live int;
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
    v_needed := greatest(0, 3 - public._confirmed_member_count(p_visit_id));
    select count(*)::int into v_live
      from public.visit_attendees a
      join public.group_members gm on gm.group_id = v_visit.group_id and gm.user_id = a.user_id
     where a.visit_id = p_visit_id
       and a.status = 'pending'
       and public.app_now() <= v_visit.visited_at + interval '7 days';
    v_pending := case when v_live >= v_needed then v_needed else 0 end;
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

drop function public.check_in(uuid, uuid, float8, float8, float8, uuid[], uuid, text, smallint, text);

-- Location args are used only to compute distance_m (rounded to 10 m); they
-- are never stored and never appear in an error message. p_client_key is a
-- random uuid the browser makes once per check-in: a retry with the same key
-- returns the first call's result and creates nothing.
create function public.check_in(
  p_restaurant_id uuid,
  p_group_id uuid,
  p_lat float8 default null,
  p_lon float8 default null,
  p_accuracy float8 default null,
  p_tagged uuid[] default '{}',
  p_signature_dish_id uuid default null,
  p_dish_other text default null,
  p_rating smallint default null,
  p_note text default null,
  p_client_key uuid default null
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
  -- Serialise the user's check-ins, so a retry racing the first call waits for it and
  -- then finds its visit. Re-entrant with the same lock in _stamp_for_attendance.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_uid::text));

  if p_client_key is not null then
    select v.id into v_visit
      from public.visits v
     where v.created_by = v_uid and v.client_key = p_client_key;
    if found then
      return public._stamp_result(v_visit, v_uid, public._replay_outcome(v_visit, v_uid));
    end if;
  end if;

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
    restaurant_id, group_id, created_by, visited_at, verification, distance_m, rarity_bonus,
    client_key
  ) values (
    p_restaurant_id, p_group_id, v_uid, public.app_now(), v_verification, v_distance_m,
    public._rarity_bonus(p_restaurant_id), p_client_key
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

-- A second confirm (the first one's reply was lost) reports the stamp it made.
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
    return public._stamp_result(p_visit_id, v_uid, public._replay_outcome(p_visit_id, v_uid));
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

-- A second claim (the first one's reply was lost) reports the stamp it made.
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
  if v_status <> 'confirmed' then
    return public._stamp_result(p_visit_id, v_uid, 'no_change');
  end if;
  if not v_waiting then
    return public._stamp_result(p_visit_id, v_uid, public._replay_outcome(p_visit_id, v_uid));
  end if;

  return public._after_confirmation(p_visit_id, v_uid);
end;
$$;

revoke execute on function public._replay_outcome(uuid, uuid) from public, anon, authenticated;
revoke execute on function
  public.check_in(uuid, uuid, float8, float8, float8, uuid[], uuid, text, smallint, text, uuid)
  from public, anon;
grant execute on function
  public.check_in(uuid, uuid, float8, float8, float8, uuid[], uuid, text, smallint, text, uuid)
  to authenticated;
