-- Eat the World: reaction privacy and the owner's flag list (brief section 4, M4).
-- Tests in supabase/tests/19-reactions-and-flags.test.sql.
--
-- "A 🤨 shows as a count, never with names." Members used to be able to read
-- every reaction row on their group's visits, which carries user_id. Now each
-- user reads only their own reaction rows; everyone else's arrive as counts
-- through visit_reaction_counts(). The owner's private flag list comes from
-- group_flagged_visits(), which returns counts and times but no user ids.

-- ---------------------------------------------------------------------------
-- RLS: own reaction rows only, on visits the caller can still read.
-- ---------------------------------------------------------------------------

drop policy if exists reactions_select on public.reactions;
drop policy if exists reactions_delete_own on public.reactions;

create policy reactions_select_own on public.reactions
  for select to authenticated
  using (user_id = (select auth.uid()) and public.can_read_visit(visit_id));

create policy reactions_delete_own on public.reactions
  for delete to authenticated
  using (user_id = (select auth.uid()) and public.can_read_visit(visit_id));

-- reactions_insert_own is unchanged: user_id = auth.uid() and can_read_visit(visit_id).

-- ---------------------------------------------------------------------------
-- visit_reaction_counts: per visit and emoji, how many reacted and whether the
-- caller is one of them. Only visits in groups the caller belongs to; visits
-- with no reactions return no rows.
-- ---------------------------------------------------------------------------

create or replace function public.visit_reaction_counts(p_visit_ids uuid[])
returns table (visit_id uuid, emoji public.reaction_emoji, n int, mine boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select r.visit_id,
         r.emoji,
         count(*)::int,
         coalesce(bool_or(r.user_id = auth.uid()), false)
    from public.reactions r
    join public.visits v on v.id = r.visit_id
    join public.group_members gm on gm.group_id = v.group_id and gm.user_id = auth.uid()
   where auth.uid() is not null
     and r.visit_id = any (p_visit_ids)
   group by r.visit_id, r.emoji
   order by r.visit_id, r.emoji
$$;

-- ---------------------------------------------------------------------------
-- group_flagged_visits: the owner's private flag list. A visit is flagged when
-- it has a side_eye created after its flag_resolved_at (any side_eye when that
-- is null). side_eye_count counts only those unresolved side-eyes. downgrade_visit
-- and dismiss_flag both set flag_resolved_at, so either clears the flag until a
-- newer side-eye arrives. Newest first.
-- ---------------------------------------------------------------------------

create or replace function public.group_flagged_visits(p_group_id uuid)
returns table (visit_id uuid, side_eye_count int, latest_side_eye_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
begin
  if not exists (
    select 1 from public.groups g where g.id = p_group_id and g.owner_id = v_uid
  ) then
    raise exception 'Only the group owner can see flagged visits.';
  end if;

  return query
  select v.id,
         count(*)::int,
         max(r.created_at)
    from public.visits v
    join public.reactions r on r.visit_id = v.id and r.emoji = 'side_eye'
   where v.group_id = p_group_id
     and (v.flag_resolved_at is null or r.created_at > v.flag_resolved_at)
   group by v.id
   order by max(r.created_at) desc, v.id;
end;
$$;

revoke execute on function
  public.visit_reaction_counts(uuid[]),
  public.group_flagged_visits(uuid)
from public, anon, authenticated;

grant execute on function
  public.visit_reaction_counts(uuid[]),
  public.group_flagged_visits(uuid)
to authenticated;
