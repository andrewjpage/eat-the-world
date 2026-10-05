-- Profile photos load in every friend's browser, so avatar_url may only point at
-- hosts that can't use it to track who opens a page (brief section 8):
-- Google profile photos (from Google sign-in) and Supabase Storage.
--
-- Sign-up metadata is user-controlled and copied by handle_new_user(), so on
-- INSERT a disallowed URL is stored as null (sign-up must never fail on it).
-- On UPDATE (the Data API grant on avatar_url) it is refused with a message.
-- Avatar upload (M7+) must store a URL that matches this pattern; extend it here
-- if the photo host changes. The UI (src/components/ui/Avatar.tsx) checks too.

create or replace function public.tg_profiles_avatar_url()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.avatar_url is not null and new.avatar_url !~
     '^https://(lh[0-9]+\.googleusercontent\.com/|[a-z0-9]+\.supabase\.co/storage/v1/object/)' then
    if tg_op = 'INSERT' then
      new.avatar_url := null;
    else
      raise exception 'Profile photos must come from Google or the app''s own storage.';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.tg_profiles_avatar_url() from public, anon, authenticated;

create trigger profiles_avatar_url
before insert or update of avatar_url on public.profiles
for each row execute function public.tg_profiles_avatar_url();

-- Existing rows: drop anything that would not pass.
update public.profiles
   set avatar_url = null
 where avatar_url is not null
   and avatar_url !~ '^https://(lh[0-9]+\.googleusercontent\.com/|[a-z0-9]+\.supabase\.co/storage/v1/object/)';
