-- Eat the World: fixes from the M1 security review (tests in supabase/tests/16-security-review.test.sql).
-- No function signature, table or column name changes.

-- ---------------------------------------------------------------------------
-- F1. set_visit_photo raises a visit to `photo` only once the photo is stored.
-- The photo route uploads the stripped JPEG with the service role, then calls
-- this with the creator's session. Without the check, a creator could call the
-- RPC directly and count in verified-only leaderboards with no photo at all.
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
  if not exists (
    select 1 from storage.objects o
     where o.bucket_id = 'visit-photos' and o.name = p_photo_path
  ) then
    raise exception 'Upload the photo first.';
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

-- ---------------------------------------------------------------------------
-- F2. A photo is readable only while a visit points at it, by members of that
-- visit's group. Paths are deterministic, so the old prefix check let members
-- read an object left behind after its visit's photo was removed (account
-- deletion, a failed Storage delete) or one no visit ever claimed.
-- ---------------------------------------------------------------------------

create index if not exists visits_photo_path_idx on public.visits (photo_path) where photo_path is not null;

create or replace function public.can_read_visit_photo(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
      from public.visits v
      join public.group_members gm on gm.group_id = v.group_id
     where v.photo_path = p_name
       and gm.user_id = auth.uid()
  )
$$;

-- ---------------------------------------------------------------------------
-- F3. Brief section 8 also applies when the auth user is deleted directly
-- (Supabase dashboard or admin API), not only through delete_my_account():
-- ownership passes to the longest-standing member (or a solo group is
-- deleted), and the user's visits are kept anonymised, without the photo,
-- only if someone else is confirmed or still pending on them. In
-- delete_my_account() this has already happened, so the trigger finds nothing.
-- Storage objects can't be removed from SQL; F2 makes any left behind
-- unreadable.
-- ---------------------------------------------------------------------------

create or replace function public.tg_profiles_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := old.user_id;
  v_group record;
  v_heir uuid;
begin
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
      delete from public.groups g where g.id = v_group.id;
    end if;
  end loop;

  update public.visits v
     set created_by = null, photo_path = null
   where v.created_by = v_uid
     and exists (
       select 1 from public.visit_attendees a
        where a.visit_id = v.id and a.user_id <> v_uid
          and public._is_live_attendance(a.status, v.visited_at)
     );

  delete from public.visits v where v.created_by = v_uid;

  return old;
end;
$$;

create trigger profiles_before_delete
before delete on public.profiles
for each row execute function public.tg_profiles_before_delete();

-- ---------------------------------------------------------------------------
-- F4. Fail closed for objects added by later migrations. Supabase's default
-- privileges grant every new table, sequence and function in public to anon
-- and authenticated; a migration that forgot RLS or a revoke would be open to
-- the Data API. New objects now need explicit grants. (PUBLIC execute on new
-- functions is a Postgres-wide default that can't be removed per schema; the
-- pgTAP allowlist guard in 16-security-review catches those.)
-- ---------------------------------------------------------------------------

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;

revoke execute on function public.tg_profiles_before_delete() from public, anon, authenticated;
