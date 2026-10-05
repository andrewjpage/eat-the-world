-- Eat the World: fixes from the M7 launch security review.
-- Tests: supabase/tests/20-launch-review.test.sql.
--
-- 1. check_in keeps distance_m only for a geo-verified check-in. A remote check-in (dinner logged
--    from home) stores no distance, so repeated remote check-ins can't be trilaterated from the
--    public restaurant points. Existing rows are cleaned. Members can no longer read distance_m or
--    client_key at all (column grants).
-- 2. Invite-only: create_group needs the caller to be the curator or already in a group. Everyone
--    else comes in through an invite link.
-- 3. invite_preview(code): the group name and member count behind an invite, so /join can show
--    "Join Supper Club?" without joining on a GET.
-- 4. submissions: the client can't insert lat/lon (the curator geocodes on approval), the free-text
--    columns get length and shape checks, and a trigger caps a user at 10 pending suggestions.

-- ---------------------------------------------------------------------------
-- 1. distance_m only when geo-verified
-- ---------------------------------------------------------------------------

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

  -- The distance is worked out in memory. It is kept only when the check-in is geo-verified
  -- (so it is within ~750 m of a public restaurant point); otherwise it is thrown away.
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
    p_restaurant_id, p_group_id, v_uid, public.app_now(), v_verification,
    case when v_verification = 'geo_verified' then v_distance_m end,
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

update public.visits
   set distance_m = null
 where distance_m is not null
   and (verification <> 'geo_verified' or distance_m > 750);

-- Nothing in the app reads distance_m or client_key; members no longer can either.
revoke select on public.visits from authenticated;
grant select (
  id, restaurant_id, group_id, created_by, visited_at, verification, rarity_bonus, photo_path,
  flag_resolved_at, downgraded_at, table_qualified_at
) on public.visits to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Invite-only group creation
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
  if not public.is_curator()
     and not exists (select 1 from public.group_members gm where gm.user_id = v_uid) then
    raise exception 'Ask a friend for an invite link first.';
  end if;

  insert into public.groups (name, owner_id, invite_code)
  values (v_name, v_uid, public._new_invite_code())
  returning id into v_id;

  insert into public.group_members (group_id, user_id, role)
  values (v_id, v_uid, 'owner');

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. invite_preview
-- ---------------------------------------------------------------------------

-- The group behind an invite code: its name and member count, nothing else. No row for an
-- unknown code. Signed-in callers only (the code itself is the secret).
create function public.invite_preview(p_invite_code text)
returns table (name text, members int)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_code text := upper(regexp_replace(coalesce(p_invite_code, ''), '\s', '', 'g'));
begin
  perform public._require_uid();
  return query
    select g.name, (select count(*)::int from public.group_members gm where gm.group_id = g.id)
      from public.groups g
     where g.invite_code = v_code;
end;
$$;

revoke execute on function public.invite_preview(text) from public, anon;
grant execute on function public.invite_preview(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Submissions
-- ---------------------------------------------------------------------------

-- Coordinates come only from postcodes.io, looked up when the curator approves.
revoke insert (lat, lon) on public.submissions from authenticated;

alter table public.submissions
  add constraint submissions_website_check
    check (website is null or (website ~ '^https?://' and char_length(website) <= 300)),
  add constraint submissions_postcode_check
    check (char_length(postcode) <= 10),
  add constraint submissions_address_check
    check (address is null or char_length(address) <= 300),
  add constraint submissions_place_id_check
    check (google_place_id is null or google_place_id ~ '^[A-Za-z0-9_-]{10,200}$');

create function public._submissions_pending_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.submitted_by is null or new.status <> 'pending' then
    return new;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('submissions:' || new.submitted_by::text));
  if (select count(*) from public.submissions s
       where s.submitted_by = new.submitted_by and s.status = 'pending') >= 10 then
    raise exception 'You have lots of suggestions waiting. Give the curator a chance to catch up.';
  end if;
  return new;
end;
$$;

revoke execute on function public._submissions_pending_cap() from public, anon, authenticated;

create trigger submissions_pending_cap
  before insert on public.submissions
  for each row execute function public._submissions_pending_cap();
