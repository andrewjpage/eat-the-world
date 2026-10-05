# Architecture contract

The brief (`eat-the-world-london-brief.md`) is the spec. This file fixes the names and interfaces, so the database, the tests and the UI can be built in parallel. If they disagree, the brief wins; update this file in the same commit.

## Layout

| Path | Contents |
|---|---|
| `supabase/migrations/` | Schema, RLS, functions and triggers (SQL) |
| `supabase/tests/` | pgTAP tests (`*.test.sql`), run by `npm run test:db` |
| `scripts/seed.ts` | `npm run seed`: insert-only, reads `seed/*.csv` |
| `src/lib/` | Pure logic: `scoring.ts`, `time.ts`, `geo.ts`, `maps-url.ts`, `ics.ts`, `countries.ts`, plus Supabase clients in `src/lib/supabase/{browser,server,admin}.ts` |
| `src/app/` | Routes (App Router) and route handlers under `src/app/api/` |
| `src/components/` | Shared UI |
| `tests/unit/` | Vitest (`npm test`) |
| `tests/e2e/` | Playwright (`npm run test:e2e`) at 390×844 |
| `docs/screens/M<n>/` | Committed milestone screenshots |

Next.js 16 differs from older versions. Read the relevant guide in `node_modules/next/dist/docs/` before writing Next code. For example, session refresh lives in `proxy.ts`, not `middleware.ts`, if the docs say so.

A dev server started with `NEXT_DIST_DIR=.next-<name>` adds `.next-<name>/...` lines to `tsconfig.json` `include`. Remove them before committing; ESLint already ignores `.next-*/`.

## Constants

- `MAX_NEW_STAMPS_PER_DAY = 3`: in TypeScript `src/lib/scoring.ts`, and in SQL `public.max_new_stamps_per_day()`. A test checks that they match.
- `CONFIRM_WINDOW_DAYS = 7`, `GROUP_MAX_MEMBERS = 20`, `TABLE_BONUS_MIN = 3`, `TIMEZONE = 'Europe/London'`.
- Points: base 10; rarity by count: 1 → 15, 2–3 → 10, 4–9 → 5, 10+ → 0; table +5; dish +2; set +25. Backfilled stamps score 0.

## Database

Extensions: `postgis` in schema `extensions`, and `pgtap` for tests only. Every SECURITY DEFINER function sets `search_path = ''` and schema-qualifies names.

### Grants for new objects

New tables, sequences and functions get no grants by default (migration `20261005130000_security_review.sql`). Add explicit `grant ... to authenticated` for each new table or API function, `revoke execute ... from public, anon, authenticated` on internal and trigger functions (Postgres grants PUBLIC execute on every new function), and add every new API function to the allowlist in `supabase/tests/16-security-review.test.sql`.

Related rules from the same review: `set_visit_photo` refuses unless the `visit-photos` object already exists (upload with the service role first); photo reads require a visit whose `photo_path` equals the object name; `profiles.avatar_url` only accepts Google profile photos or Supabase Storage URLs (`20261005140000_avatar_url_hosts.sql`).

### Enums

`city_country_stored_status(unlisted, uncharted)` (the column type of `city_countries.status`; the view below owns the name `city_country_status`), `restaurant_status(active, reported_closed, closed, pending)`, `confidence(curated, community, flagged)`, `dish_status(draft, approved)`, `member_role(owner, member)`, `verification(geo_verified, photo, self_reported)`, `attendance_status(pending, confirmed, declined)`, `reaction_emoji(clap, drool, side_eye)`, `submission_status(pending, approved, rejected)`, `plan_status(proposed, booked, done, cancelled)`, `rsvp_response(yes, no, maybe)`.

### Tables

Tables as in brief section 5, with these exact names and the following additions:

- `restaurants` has `lat double precision`, `lon double precision` (both not null) and `location geography(Point,4326)`, kept in sync by a trigger. `restaurants.id` is a uuid.
- Primary keys:
  - `visit_attendees (visit_id, user_id)`
  - `stamps (user_id, country_iso2)`
  - `set_awards (user_id, set_id)`
  - `group_members (group_id, user_id)`
  - `plan_rsvps (plan_id, user_id)`
  - `reactions (visit_id, user_id, emoji)`
  - `city_countries (city_id, country_iso2)`
- `reactions` and `submissions` have `created_at`. `submissions` stores the proposed `city_id`, `country_iso2`, `name`, `address`, `postcode`, `lat`, `lon`, `google_place_id`, `website` and `note`.
- Every id is a uuid with `default gen_random_uuid()`, except `countries.iso2`.
- Members insert submissions directly (RLS: `submitted_by = auth.uid()`, `status = 'pending'`, caller in a group or curator); reviewer fields are curator-only.

### Views (`security_invoker = true`)

- `city_country_status(city_id, country_iso2, status text, restaurant_count int)`. `status` is `listed`, `unlisted` or `uncharted` (brief section 2). `restaurant_count` counts restaurants with status `active` or `reported_closed`.
- `stamp_totals(user_id, country_iso2, visit_id, points, backfilled, verification, earned_at, stamped_at)`, where `points = base + rarity_bonus + table_bonus + dish_bonus`.

### Functions (all return errors as `raise exception` with a friendly message)

| Function | Returns | Notes |
|---|---|---|
| `max_new_stamps_per_day()` | int | 3 |
| `app_now()` | timestamptz | `now()`, unless `session_user = 'postgres'` and the GUC `app.now` is set (tests only; API callers can't set it). Every function uses it instead of `now()` |
| `london_date(p_ts timestamptz)` | date | `(p_ts at time zone 'Europe/London')::date` |
| `create_group(p_name text)` | uuid | Caller becomes owner; generates an 8-character `invite_code` |
| `join_group(p_invite_code text)` | uuid | Idempotent; enforces 20 members |
| `update_group_settings(p_group_id uuid, p_name text, p_verified_only bool, p_season_start date, p_season_end date)` | void | Owner only |
| `rotate_invite_code(p_group_id uuid)` | text | Owner only |
| `check_in(p_restaurant_id uuid, p_group_id uuid, p_lat float8, p_lon float8, p_accuracy float8, p_tagged uuid[], p_signature_dish_id uuid, p_dish_other text, p_rating smallint, p_note text)` | jsonb `StampResult` | Location args may be null. Stores only `distance_m`. Tagged users must be members of the group. Inserts the creator's confirmed row and pending rows for tagged users |
| `confirm_attendance(p_visit_id uuid, p_signature_dish_id uuid, p_dish_other text, p_rating smallint, p_note text)` | jsonb `StampResult` | Caller's pending row; refused after 7 days |
| `decline_attendance(p_visit_id uuid)` | void | |
| `claim_stamp(p_visit_id uuid)` | jsonb `StampResult` | Caller's waiting attendance |
| `backfill_countries(p_iso2s text[])` | int | Number created. Skips countries already stamped. Never touches the cap |
| `remove_backfilled_stamp(p_iso2 text)` | void | Only `backfilled = true` stamps |
| `set_visit_photo(p_visit_id uuid, p_photo_path text)` | void | Visit creator only. Raises `self_reported` to `photo` unless `downgraded_at` is set; copies to stamps |
| `downgrade_visit(p_visit_id uuid)` | void | Owner of the visit's group. Sets `self_reported` and `downgraded_at`, copies to stamps, sets `flag_resolved_at` |
| `dismiss_flag(p_visit_id uuid)` | void | Owner of the visit's group. Sets `flag_resolved_at` |
| `group_leaderboard(p_group_id uuid, p_season bool)` | table(user_id uuid, display_name text, countries int, points int) | Members only. Applies `verified_only` and the season (brief section 3). Excludes backfilled stamps |
| `group_together(p_group_id uuid, p_city_id uuid)` | table(stamped int, listed int) | Visit stamps of any member ∩ listed |
| `group_gaps(p_group_id uuid, p_city_id uuid)` | table(country_iso2 text) | Listed countries no member has a visit stamp for |
| `delete_my_account()` | text[] | Applies brief section 8, deletes the `auth.users` row, and returns the photo paths for the caller to remove from Storage |
| `approve_submission(p_submission_id uuid, p_lat float8, p_lon float8)` | uuid | Curator only. Inserts an `active` restaurant |
| `reject_submission(p_submission_id uuid, p_note text)` | void | Curator only |

`StampResult` is jsonb with these fields:
- `visit_id`
- `outcome`: `stamped`, `upgraded`, `repeat`, `waiting` or `no_change`
- `country_iso2`
- `points` with `{base, rarity, table, dish, total}`, or null
- `table_pending`: how many more confirmations are needed for the table bonus, 0 once it applies
- `first_in_group` (bool)
- `verification`

### Stamp algorithm

This runs when an attendance becomes confirmed (the checker's at `check_in`), or on claim. It takes `pg_advisory_xact_lock(hashtext(user_id::text))`.

1. If the user already has a non-backfilled stamp for the country: `repeat`.
2. Else, if the count of the user's stamps whose `stamped_at` falls on today's Europe/London date is at least 3: set the attendance's `stamp_waiting = true` → `waiting`.
3. Else, if a backfilled stamp exists: upgrade it in place → `upgraded`.
4. Else, insert a new stamp → `stamped`.

A new or upgraded stamp gets:
- base 10;
- `rarity_bonus` from the visit;
- `dish_bonus` 2 if the attendee's `signature_dish_id` is approved and matches the country;
- `table_bonus` 5 if the visit already qualifies;
- the visit's verification;
- `earned_at` = `visits.visited_at` and `stamped_at` = now().

After any confirmation:
- if ≥3 group members are confirmed on the visit, set `table_bonus = 5` on every stamp with that `visit_id`;
- then award sets for the user.

### Set awards

`award_sets(p_user_id)` is internal. It inserts `set_awards(user, set, city, now(), 25)` `on conflict do nothing` for each set that is active in a city (≥2 listed) and fully covered by the user's non-backfilled stamps. Statement-level triggers on `restaurants` (insert or status update) and on `sets` re-run it for every user who has stamps.

### Storage

- A private bucket `visit-photos`, with object path `<group_id>/<visit_id>.jpg`.
- Read policy: members of `<group_id>`. There is no client insert; the photo route uploads with the service role after checking with the user's session.

## Auth

- **Local:** email one-time code, captured by the Supabase CLI at http://127.0.0.1:54324.
- **Production:** Google OAuth first, email OTP via Brevo SMTP as the fallback.
- **Sessions:** cookies via `@supabase/ssr`.
- **Profiles:** a trigger on `auth.users` insert creates the `profiles` row. `display_name` defaults to the email local part or the Google name.

## Routes

- **Pages:**
  - `/` (Passport), `/login`, `/join/[code]`
  - `/country/[iso2]`, `/restaurant/[id]`, `/check-in/[restaurantId]`, `/visit/[id]` (confirm, claim, nudge)
  - `/group/[id]` (Together, leaderboard, feed, Gaps, Spin, plans, flags), `/group/[id]/plan/new`
  - `/map`, `/world`
  - `/settings`, `/settings/backfill`, `/curator`, `/privacy`, `/credits`
- **Handlers (`src/app/api/`):**
  - `auth/callback`
  - `check-in` (POST)
  - `visits/[id]/photo` (POST)
  - `plans/[id]/ics` (GET)
  - `submissions` (POST, geocodes)
  - `account` (DELETE)
  - `keepalive` (GET, `CRON_SECRET`)

## Environment

`.env.local` (generated from `supabase status -o env`):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server only; never imported in client code)
- `CRON_SECRET`
- `NEXT_PUBLIC_APP_URL`
