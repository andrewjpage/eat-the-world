-- avatar_url may only point at Google profile photos or Supabase Storage
-- (20261005140000_avatar_url_hosts.sql): any other host could log viewers.
begin;
select plan(7);

-- Sign-up metadata is user-controlled: a tracking URL is dropped, never fatal.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '5b0c1d2e-0000-4000-8000-00000000a001',
        'authenticated', 'authenticated', 'tracker.avatar@test.local', '', now(),
        '{"provider":"email","providers":["email"]}',
        '{"full_name":"Tracker","avatar_url":"https://evil.example/pixel.png"}', now(), now());
select is((select avatar_url from public.profiles where user_id = '5b0c1d2e-0000-4000-8000-00000000a001'),
          null, 'sign-up with a foreign avatar_url creates the profile with no photo');

-- Google sign-in keeps its photo.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '5b0c1d2e-0000-4000-8000-00000000a002',
        'authenticated', 'authenticated', 'google.avatar@test.local', '', now(),
        '{"provider":"google","providers":["google"]}',
        '{"full_name":"Gina","picture":"https://lh3.googleusercontent.com/a/abc=s96-c"}', now(), now());
select is((select avatar_url from public.profiles where user_id = '5b0c1d2e-0000-4000-8000-00000000a002'),
          'https://lh3.googleusercontent.com/a/abc=s96-c', 'a Google profile photo is kept');

select tests.authenticate_as('5b0c1d2e-0000-4000-8000-00000000a002');
select throws_ok(
  $$update public.profiles set avatar_url = 'https://evil.example/pixel.png'
     where user_id = '5b0c1d2e-0000-4000-8000-00000000a002'$$,
  'Profile photos must come from Google or the app''s own storage.',
  'a member cannot point their avatar at another host');
select throws_ok(
  $$update public.profiles set avatar_url = 'http://lh3.googleusercontent.com/a/abc'
     where user_id = '5b0c1d2e-0000-4000-8000-00000000a002'$$,
  'Profile photos must come from Google or the app''s own storage.',
  'plain http is refused');
select throws_ok(
  $$update public.profiles set avatar_url = 'https://lh3.googleusercontent.com.evil.example/a'
     where user_id = '5b0c1d2e-0000-4000-8000-00000000a002'$$,
  'Profile photos must come from Google or the app''s own storage.',
  'a look-alike host is refused');
select lives_ok(
  $$update public.profiles
       set avatar_url = 'https://abcdefgh.supabase.co/storage/v1/object/public/avatars/x.jpg', display_name = 'Gina'
     where user_id = '5b0c1d2e-0000-4000-8000-00000000a002'$$,
  'Supabase Storage URLs are allowed');
select lives_ok(
  $$update public.profiles set avatar_url = null where user_id = '5b0c1d2e-0000-4000-8000-00000000a002'$$,
  'clearing the photo is allowed');

select * from finish();
rollback;
