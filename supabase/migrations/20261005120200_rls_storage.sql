-- Eat the World: grants, Row Level Security (brief section 5) and Storage.
--
-- Table privileges are revoked wholesale and granted back narrowly, so a
-- missing policy can never be papered over by a default grant. anon gets
-- nothing. visits, visit_attendees, stamps, set_awards, groups and
-- group_members have no client write privileges or policies at all: only the
-- SECURITY DEFINER functions write them.

-- ---------------------------------------------------------------------------
-- Table privileges
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;

grant select on
  public.countries, public.cities, public.city_countries, public.restaurants,
  public.signature_dishes, public.sets, public.profiles, public.groups,
  public.group_members, public.visits, public.visit_attendees, public.reactions,
  public.stamps, public.set_awards, public.submissions, public.closure_reports,
  public.plans, public.plan_rsvps,
  public.city_country_status, public.stamp_totals
to authenticated;

-- Own profile: display name and avatar only, never is_curator.
grant update (display_name, avatar_url) on public.profiles to authenticated;

-- Curator-only tables (RLS limits these to curators).
grant insert, update, delete on
  public.restaurants, public.city_countries, public.sets, public.signature_dishes
to authenticated;

grant insert (city_id, country_iso2, name, address, postcode, lat, lon,
              google_place_id, website, note, submitted_by, status)
  on public.submissions to authenticated;
grant update on public.submissions to authenticated;

grant insert (restaurant_id, reported_by, note) on public.closure_reports to authenticated;
grant update (resolved) on public.closure_reports to authenticated;

grant insert (group_id, restaurant_id, proposed_by, proposed_for, status) on public.plans to authenticated;
grant update (restaurant_id, proposed_for, status) on public.plans to authenticated;

grant insert (plan_id, user_id, response) on public.plan_rsvps to authenticated;
grant update (response) on public.plan_rsvps to authenticated;
grant delete on public.plan_rsvps to authenticated;

grant insert (visit_id, user_id, emoji) on public.reactions to authenticated;
grant delete on public.reactions to authenticated;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.max_new_stamps_per_day(),
  public.app_now(),
  public.london_date(timestamptz),
  public.is_curator(),
  public.is_group_member(uuid),
  public.is_group_owner(uuid),
  public.shares_group_with(uuid),
  public.can_read_visit(uuid),
  public.can_read_plan(uuid),
  public.can_read_visit_photo(text),
  public.create_group(text),
  public.join_group(text),
  public.update_group_settings(uuid, text, boolean, date, date),
  public.rotate_invite_code(uuid),
  public.check_in(uuid, uuid, float8, float8, float8, uuid[], uuid, text, smallint, text),
  public.confirm_attendance(uuid, uuid, text, smallint, text),
  public.decline_attendance(uuid),
  public.claim_stamp(uuid),
  public.backfill_countries(text[]),
  public.remove_backfilled_stamp(text),
  public.set_visit_photo(uuid, text),
  public.downgrade_visit(uuid),
  public.dismiss_flag(uuid),
  public.group_leaderboard(uuid, boolean),
  public.group_together(uuid, uuid),
  public.group_gaps(uuid, uuid),
  public.delete_my_account(),
  public.approve_submission(uuid, float8, float8),
  public.reject_submission(uuid, text)
to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.countries        enable row level security;
alter table public.cities           enable row level security;
alter table public.profiles         enable row level security;
alter table public.signature_dishes enable row level security;
alter table public.city_countries   enable row level security;
alter table public.restaurants      enable row level security;
alter table public.groups           enable row level security;
alter table public.group_members    enable row level security;
alter table public.visits           enable row level security;
alter table public.visit_attendees  enable row level security;
alter table public.reactions        enable row level security;
alter table public.stamps           enable row level security;
alter table public.sets             enable row level security;
alter table public.set_awards       enable row level security;
alter table public.submissions      enable row level security;
alter table public.closure_reports  enable row level security;
alter table public.plans            enable row level security;
alter table public.plan_rsvps       enable row level security;

-- Reference data: any signed-in user reads; curators write the curated ones.

create policy countries_select on public.countries
  for select to authenticated using (true);

create policy cities_select on public.cities
  for select to authenticated using (true);

create policy city_countries_select on public.city_countries
  for select to authenticated using (true);
create policy city_countries_curator_insert on public.city_countries
  for insert to authenticated with check ((select public.is_curator()));
create policy city_countries_curator_update on public.city_countries
  for update to authenticated using ((select public.is_curator())) with check ((select public.is_curator()));
create policy city_countries_curator_delete on public.city_countries
  for delete to authenticated using ((select public.is_curator()));

create policy restaurants_select on public.restaurants
  for select to authenticated using (true);
create policy restaurants_curator_insert on public.restaurants
  for insert to authenticated with check ((select public.is_curator()));
create policy restaurants_curator_update on public.restaurants
  for update to authenticated using ((select public.is_curator())) with check ((select public.is_curator()));
create policy restaurants_curator_delete on public.restaurants
  for delete to authenticated using ((select public.is_curator()));

create policy sets_select on public.sets
  for select to authenticated using (true);
create policy sets_curator_insert on public.sets
  for insert to authenticated with check ((select public.is_curator()));
create policy sets_curator_update on public.sets
  for update to authenticated using ((select public.is_curator())) with check ((select public.is_curator()));
create policy sets_curator_delete on public.sets
  for delete to authenticated using ((select public.is_curator()));

-- Approved dishes for everyone; drafts for curators only.
create policy signature_dishes_select on public.signature_dishes
  for select to authenticated using (status = 'approved' or (select public.is_curator()));
create policy signature_dishes_curator_insert on public.signature_dishes
  for insert to authenticated with check ((select public.is_curator()));
create policy signature_dishes_curator_update on public.signature_dishes
  for update to authenticated using ((select public.is_curator())) with check ((select public.is_curator()));
create policy signature_dishes_curator_delete on public.signature_dishes
  for delete to authenticated using ((select public.is_curator()));

-- Profiles: yourself and people you share a group with. Update your own
-- (column grants exclude is_curator).
create policy profiles_select on public.profiles
  for select to authenticated using (public.shares_group_with(user_id));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Groups and memberships: members read. Writes only through functions.
create policy groups_select on public.groups
  for select to authenticated using (public.is_group_member(id));

create policy group_members_select on public.group_members
  for select to authenticated using (public.is_group_member(group_id));

-- Visits, attendees and reactions: members of the visit's group read.
create policy visits_select on public.visits
  for select to authenticated using (public.is_group_member(group_id));

create policy visit_attendees_select on public.visit_attendees
  for select to authenticated using (public.can_read_visit(visit_id));

create policy reactions_select on public.reactions
  for select to authenticated using (public.can_read_visit(visit_id));
create policy reactions_insert_own on public.reactions
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.can_read_visit(visit_id));
create policy reactions_delete_own on public.reactions
  for delete to authenticated using (user_id = (select auth.uid()));

-- Stamps and set awards: yourself and people you share a group with.
create policy stamps_select on public.stamps
  for select to authenticated using (public.shares_group_with(user_id));

create policy set_awards_select on public.set_awards
  for select to authenticated using (public.shares_group_with(user_id));

-- Submissions and closure reports: members insert their own; the submitter
-- reads their own; curators read and review all.
create policy submissions_select on public.submissions
  for select to authenticated
  using (submitted_by = (select auth.uid()) or (select public.is_curator()));
create policy submissions_insert_member on public.submissions
  for insert to authenticated
  with check (
    submitted_by = (select auth.uid())
    and status = 'pending'
    and (
      exists (select 1 from public.group_members gm where gm.user_id = (select auth.uid()))
      or (select public.is_curator())
    )
  );
create policy submissions_curator_update on public.submissions
  for update to authenticated using ((select public.is_curator())) with check ((select public.is_curator()));

create policy closure_reports_select on public.closure_reports
  for select to authenticated
  using (reported_by = (select auth.uid()) or (select public.is_curator()));
create policy closure_reports_insert_member on public.closure_reports
  for insert to authenticated
  with check (
    reported_by = (select auth.uid())
    and (
      exists (select 1 from public.group_members gm where gm.user_id = (select auth.uid()))
      or (select public.is_curator())
    )
  );
create policy closure_reports_curator_update on public.closure_reports
  for update to authenticated using ((select public.is_curator())) with check ((select public.is_curator()));

-- Plans: members read and propose for their group; the proposer or the group
-- owner updates.
create policy plans_select on public.plans
  for select to authenticated using (public.is_group_member(group_id));
create policy plans_insert_member on public.plans
  for insert to authenticated
  with check (proposed_by = (select auth.uid()) and public.is_group_member(group_id));
create policy plans_update_proposer_or_owner on public.plans
  for update to authenticated
  using (
    public.is_group_member(group_id)
    and (proposed_by = (select auth.uid()) or public.is_group_owner(group_id))
  )
  with check (
    public.is_group_member(group_id)
    and (proposed_by = (select auth.uid()) or public.is_group_owner(group_id))
  );

-- RSVPs: members read; each user writes only their own, on plans they can read.
create policy plan_rsvps_select on public.plan_rsvps
  for select to authenticated using (public.can_read_plan(plan_id));
create policy plan_rsvps_insert_own on public.plan_rsvps
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.can_read_plan(plan_id));
create policy plan_rsvps_update_own on public.plan_rsvps
  for update to authenticated
  using (user_id = (select auth.uid()) and public.can_read_plan(plan_id))
  with check (user_id = (select auth.uid()) and public.can_read_plan(plan_id));
create policy plan_rsvps_delete_own on public.plan_rsvps
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Storage: private bucket for stripped visit photos, <group_id>/<visit_id>.jpg
-- Members of the group read. No client insert, update or delete: the photo
-- route uploads with the service role after checking the user's session.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('visit-photos', 'visit-photos', false, 5242880, array['image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy visit_photos_select_group_members on storage.objects
  for select to authenticated
  using (bucket_id = 'visit-photos' and public.can_read_visit_photo(name));
