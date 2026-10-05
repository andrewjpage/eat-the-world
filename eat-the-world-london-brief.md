# Build brief: Eat the World — London

A private game for a group of friends: eat at a restaurant that specialises in one country's cuisine, collect that country's stamp, and see how much of the world London can feed you. It's for fun, not money. If fun and polish conflict, choose fun. If fun conflicts with the privacy rules in section 8, the privacy rules win.

---

## 0. How to build this (read first)

You are a Claude Code session building the MVP from this brief. Read all of it before writing code. Every product decision has been made, so don't stop to ask unless something here turns out to be impossible or contradicts a verified fact. If that happens, say which.

- **Repo.** `github.com/andrewjpage/eat-the-world` (private, personal account, never the `originsciences` org). It already holds this brief, `seed/` and `docs/`. Commit as andrewjpage@gmail.com. One branch and PR per milestone; keep `main` deployable.
- **Before planning,** check `docker info` (M1 needs Docker for the local Supabase stack) and a current Node LTS. If Docker is missing, say so in the plan.
- **Process.** Start in plan mode and show the plan once. After approval, build milestone by milestone (section 10) without further check-ins, committing as you go. A milestone is done when:
  - its tests pass in CI;
  - Playwright screenshots of its new screens at a phone viewport (390×844) are committed under `docs/screens/M<n>/` and linked from the PR;
  - the PR has a three-line demo note.
- **Andrew's accounts.** The plan ends with one checklist of account actions, with exact steps, for Andrew to do while M1–M2 are built:
  - a Vercel project linked to the repo;
  - a Supabase Free project in the London region;
  - a Google OAuth client, with its consent screen published "In production" (basic scopes), so friends aren't blocked as untrusted test users;
  - a Brevo SMTP key with one verified sender;
  - Supabase auth redirect URLs for production and Vercel previews;
  - GitHub secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_URL`, `SUPABASE_PROJECT_REF`, `APP_URL`, `CRON_SECRET`;
  - Vercel environment variables, including `CRON_SECRET`.

  The first deploy is at the end of M3. If an account isn't ready by then, carry on locally and deploy when it is.
- **Models.** Claude subscription only. Don't use Amazon Bedrock or any other external model API.
- **Orchestration.** Use the Workflow tool to fan out subagents, and match model and effort to the task:

  | Task | Model | Effort |
  |---|---|---|
  | Schema, RLS policies, scoring rules, stamp and cap functions, milestone review, security review | Opus | high |
  | Screens, route handlers, seed script, Playwright tests | Sonnet | medium |
  | Mechanical work: fixtures, copy, CSV/JSON reshaping, lint fixes, README | Haiku | low |

  Run independent work in parallel. Give implementers their own worktrees when they edit files concurrently. Before each milestone merges, an Opus reviewer who didn't write the code checks it.
- **Skills.**
  - `superpowers:writing-plans` for the plan, and `superpowers:subagent-driven-development` for the per-task loop.
  - `superpowers:test-driven-development` for scoring, the cap and stamp creation.
  - `webapp-testing` for Playwright, and `run` to launch the app and take screenshots.
  - `superpowers:verification-before-completion` before calling a milestone done.
  - `code-review` and `security-review` before launch: RLS and location privacy are the risks.

  If a named skill or tool isn't available, do the equivalent by hand.

---

## 1. The game

- Friends form small private groups of 2–20 people. Each country whose cuisine you've eaten at a specialist restaurant becomes a stamp in your passport.
- The core loop is the **group dinner**. Spin for a country nobody in the group has, pick a restaurant and propose a date. Eat together, and one check-in stamps everyone at the table. Trade banter over the leaderboard, then spin again.
- The headline is the group's shared progress: how much of London you've eaten *together*. The individual leaderboard is for banter.
- Beli already does ranked restaurant logging; don't rebuild it. This app differs in three ways. The unit of progress is the **country**. A **curated specialist rule** decides what counts. The **group dinner** is the core loop.
- Feel: a passport, not a spreadsheet. The stamp moment is a small celebration: an ink-stamp animation, the points breakdown, "First in the group!" when it applies, and a haptic buzz where the phone supports it. Friendly banter beats policing, and nothing ever refuses you at the table.
- Not in the game: money, ads, public profiles, growth features, streaks, or anything that rewards spending more or eating out more often.

---

## 2. Rules (these drive the schema; don't soften them)

- **Country list.** ISO 3166-1 alpha-2 is the canonical list: 249 officially assigned codes. It keeps the app out of statehood arguments: Taiwan, Palestine and Hong Kong are present because ISO lists them, and Kosovo is absent because `XK` is only user-assigned.
  - Show short common names ("Taiwan", "Vietnam", "South Korea", "Bolivia") from a small override list. Keep the ISO name as `iso_name`.
  - Group the passport by UN M49 `intermediate-region` where present, otherwise `sub-region`. That gives 22 groups plus Antarctica, and Africa splits into Western, Eastern, Middle and Southern.
- **Specialist rule.** A restaurant counts for country X only if the bulk of its menu is X's cuisine. Pan-regional places ("pan-Asian", "Middle Eastern", "Balkan", "Nordic", "Latin") don't count unless the curator assigns a single country. In v1 each restaurant has exactly one country. Edge cases are curator calls, explained in `curator_note`. Rows with `confidence = flagged` show a "contested pick" badge, so the rule gets argued about over dinner from day one.
- **Honest denominator.** Each (city, country) pair is `listed`, `unlisted` or `uncharted`.
  - `listed` is computed, never stored: at least one restaurant for the pair has status `active` or `reported_closed`. A single closure report doesn't delist a country.
  - `uncharted` is a curator assertion that there's no specialist in this city. It's the list of countries London can't give you, and it's a feature. A new listing overrides it automatically.
  - Otherwise the pair is `unlisted`: nobody has checked yet. When a restaurant becomes eligible, any stored `uncharted` row resets to `unlisted`, so the country reverts to `unlisted` if that restaurant later closes.
- **Progress.** The headline is London progress: countries you have a visit stamp for *that are listed in London*, over countries listed in London, for example "34 / 86 in London". London progress, the group's Together bar, Gaps, Spin the globe and "First in the group!" all use visit stamps only. A second line shows your stamps anywhere, including backfilled ones, and your points. When your London progress is still 0, the stamps-anywhere line goes first. The ISO total goes in small print.
- **No spend or frequency incentives.** Points never scale with price. No streaks.
- **Daily cap.** At most `MAX_NEW_STAMPS_PER_DAY = 3` visit stamps are created, claimed or upgraded per user per Europe/London calendar day, counted on `stamps.stamped_at`. That blocks bulk couch-cheating.
  - Backfilled stamps never count toward the cap.
  - A check-in or confirmation is never refused.
  - Over the cap, the attendance is saved with `stamp_waiting = true`, and the app says "Stamp waiting: claim it tomorrow". Claiming takes one tap from the next London day and keeps the visit's frozen bonuses. A claim counts toward the claim day; if that day is already full, the stamp keeps waiting.
  - Repeat visits to a stamped country never touch the cap.
- **Permanence.** Stamps stand even if the restaurant later closes, or the friend who checked in deletes their account. The rarity bonus is frozen at check-in. Set awards, once won, are kept.

---

## 3. Scoring

Implement scoring as pure TypeScript functions plus SQL (a view and Postgres functions), fully unit-tested. It must be deterministic and reproducible from stored data.

| Component | Points |
|---|---|
| New country stamp from a visit | 10 |
| **Rarity bonus**: depends on how many restaurants the city has for that country *when the visit is checked in*: those with status `active` or `reported_closed`, plus the visited restaurant whatever its status, so the minimum is 1. 1 → +15, 2–3 → +10, 4–9 → +5, 10+ → 0. Stored on the visit, so everyone at the table gets the same bonus | 0–15 |
| **Table bonus**: once ≥3 members of the visit's group have confirmed the visit, every stamp from that visit gets +5, including stamps created earlier. The person checking in counts, and so do confirmed attendees who earn no new stamp. Never removed | +5 |
| **Signature dish**: the attendee picked, by id, an approved signature dish of the visited restaurant's country. Set when the stamp is created | +2 |
| **Set completion**: a set is active in a city when ≥2 of its countries are listed there. Completing it means having a visit stamp for every listed country in it. Awarded once per user per set, stored in `set_awards`, never revoked | +25 per set |

- **Repeat visits** to a country you've already stamped score 0 but are logged. They feed friend ratings and "where next".
- **Backfilled stamps** (countries done before joining) are passport memories only.
  - They are self-reported, have no restaurant, and score 0 points. They never count on any leaderboard or toward a set.
  - Backfill is open any time from Settings.
  - If you later eat that country at a London restaurant, the backfilled stamp is upgraded in place into a full visit stamp: `backfilled = false`, bonuses set, and `earned_at` = the visit's time. The upgrade counts toward the cap.
- **When set awards are checked:** whenever a stamp is created, claimed or upgraded, whenever a restaurant is inserted or its status changes, and whenever a set is edited. With under 100 users, recomputing everyone is fine.
- **Seasons.** A group owner can set a season start and end date: inclusive, and in Europe/London time.
  - A season leaderboard counts visit stamps whose visit's `visited_at` falls in the season, and set awards whose `awarded_at` does.
  - All-time counts every visit stamp and set award.
- **Verification is displayed, not scored.** A visit is `geo_verified` if the location check passed. Otherwise it becomes `photo` once a stripped photo is stored, and otherwise it's `self_reported`.
  - A later photo can raise a visit, unless the owner has downgraded it. An owner downgrade sets it to `self_reported`. Either change is copied to every stamp from that visit in the same transaction.
  - The owner setting `groups.verified_only` makes leaderboards count only `geo_verified` and `photo` stamps, and the leaderboard says when it's on.

**Worked example (make it a test).** Alice, Bob and Cara are in the same group and eat at Lao Café, the only listed Lao restaurant in London.

1. Alice checks in, tags Bob and Cara, and picks Larb, an approved Lao dish. Her stamp is created straight away at 10 + 15 + 2 = 27, showing "+5 when 2 more confirm".
2. Bob confirms with Larb: 27.
3. Cara confirms with Larb, and the visit reaches 3. All three stamps become 32, whatever order they confirmed in.

Dan, who wasn't there, gets nothing. If a second Lao restaurant is listed next month, the stamps stay at 32. If Alice later deletes her account, Bob's and Cara's stamps stay at 32.

Sets are data the curator can edit, seeded from `seed/sets.csv`: Caucasus, Horn of Africa, Mekong, Maritime Southeast Asia, West Africa, Caribbean, Eastern Europe, Iberia, Arabian Peninsula & Levant, South America, The Stans, and Indian Ocean Islands.

---

## 4. Check-in

- **Group.** A check-in is made in one group. There's a picker if you belong to several, defaulting to the last one used. Only that group's members can be tagged, and the visit appears in that group's feed.
- **Location.** Request browser geolocation **once, at check-in**. Send `{lat, lon, accuracy}` in the request body (never the URL) to a Next.js route handler. The handler calls a Postgres function that computes the distance to the restaurant with PostGIS and stores only `distance_m` (rounded to 10 m) and `geo_verified`. **Raw coordinates are never stored or logged.** If location is denied or fails, the check-in carries on unverified.
- `geo_verified = accuracy_m ≤ 500 AND (distance_m − accuracy_m) ≤ 250`. Restaurant points are postcode centroids, hence the slack. This is a friendly badge, not anti-cheat. A determined friend can fake it, and that's fine.
- **Co-diners.**
  - The person checking in tags group members. Anyone who RSVPed "yes" to today's plan for this restaurant is pre-selected.
  - Each tagged person gets a pending attendance and confirms it in one tap. The confirm sheet has the dish picker (the country's approved dishes, plus "something else") and the 1–5 rating above the Confirm button.
  - Pending confirmations show as a banner whenever the app opens. "Nudge the table" shares a `wa.me` link to the confirm page. It appears after checking in and on any feed item that still has pending attendees.
  - The window is 7 days, enforced lazily: confirm is refused after 7 days, and older pending rows count as declined. No scheduler is needed.
- **Stamp moment.** The checker's stamp is created at check-in. It shows the points known so far, "+5 when N more confirm", and "First in the group!" if no other member has that country.
- **Photo** (optional; built in M4).
  - On the phone, decode the photo with `createImageBitmap`, resize it to at most 1600 px on the long edge, and re-encode it as JPEG (quality about 0.8) through a canvas. That drops EXIF data including GPS, and keeps uploads well under Vercel's 4.5 MB request limit.
  - The upload goes through a Next.js route handler on the Node runtime. It re-encodes the photo again with `sharp` (keeping no metadata) and stores it in a private Supabase Storage bucket. Photos are served by short-lived signed URLs.
  - An integration test sends a JPEG fixture with GPS EXIF and 48 MP dimensions through the handler, and asserts that `exiftool` finds no metadata on the stored file.
  - If `sharp` won't run on Vercel, the handler must reject any JPEG that still carries an EXIF segment. Never store a photo unstripped.
  - Andrew repeats the check with real iPhone photos, including HEIC, on the deployed app at launch.
- **Banter.**
  - Group members react to feed items with 👏, 🤤 or 🤨. A 🤨 shows as a count, never with names.
  - The group owner sees a private list of flagged visits. A visit is flagged if it has a 🤨 newer than its `flag_resolved_at` (or any 🤨 if that is null). The owner can downgrade the visit to `self_reported` or dismiss the flag; both set `flag_resolved_at`.
  - There is no public shaming UI.
- **Speed.** The whole flow takes under 30 seconds, one-handed, on poor signal. Save the check-in first and upload the photo afterwards. Show the stamp straight away and reconcile once the server confirms.

---

## 5. Data model (Postgres + PostGIS on Supabase)

Adjust names if needed, but keep the semantics. User references such as `created_by`, `updated_by`, `proposed_by`, `submitted_by`, `reported_by` and `reviewer_id` are nullable with `ON DELETE SET NULL`. Seeded rows have none.

- `countries(iso2 pk, iso_numeric char(3), name, iso_name, flag_emoji, m49_region, m49_group)`. `iso_numeric` is zero-padded (for example '004') and joins to world-atlas ids as a string. `m49_group` is the intermediate region or sub-region. `flag_emoji` is only for share text, because the UI uses SVG flags.
- `signature_dishes(id, country_iso2, name, note, status enum(draft, approved))`, unique on (country_iso2, name).
- `cities(id, name, slug)`. Seed only London, but scope everything by city so adding Cambridge needs no migration.
- `city_countries(city_id, country_iso2, status enum(unlisted, uncharted), updated_by, updated_at)`, plus a view `city_country_status` that returns `listed`, `unlisted` or `uncharted` as defined in section 2.
- `restaurants(id, city_id, country_iso2, name, address, postcode, location geography(Point), google_place_id null, website null, status enum(active, reported_closed, closed, pending), confidence enum(curated, community, flagged), curator_note, created_by, verified_at null)`, unique on (name, postcode).
- `profiles(user_id pk → auth.users, display_name, avatar_url, is_curator bool default false)`
- `groups(id, name, owner_id, invite_code, verified_only bool, season_start date null, season_end date null)`
- `group_members(group_id, user_id, role enum(owner, member), joined_at)`
- `visits(id, restaurant_id, group_id not null, created_by, visited_at, verification enum, distance_m int null, rarity_bonus int, photo_path null, flag_resolved_at timestamptz null, downgraded_at timestamptz null)`
- `visit_attendees(visit_id, user_id, status enum(pending, confirmed, declined), confirmed_at, signature_dish_id null → signature_dishes, dish_other text null, rating smallint null check 1–5, note text null, stamp_waiting bool default false)`. The person checking in gets a confirmed row.
- `reactions(visit_id, user_id, emoji enum(clap, drool, side_eye), created_at)`, unique on (visit_id, user_id, emoji).
- `stamps(user_id, country_iso2, visit_id null, earned_at, stamped_at timestamptz null, base int, rarity_bonus int, table_bonus int, dish_bonus int, verification enum, backfilled bool)`, unique on (user_id, country_iso2).
  - `earned_at` is the visit's `visited_at`, or the backfill time.
  - `stamped_at` is when a visit stamp was created, claimed or upgraded; the daily cap counts it. It is null for backfill.
  - The stamp functions create a stamp when an attendance becomes confirmed (the checker's at check-in), if the user has no visit stamp for that country yet. A backfilled stamp is upgraded instead.
  - If the cap would be exceeded, the attendance is marked `stamp_waiting` instead. A waiting or capped attendance never blocks a stamp at a later visit.
  - The functions take `pg_advisory_xact_lock` on the user id, so concurrent confirmations can't both pass the cap.
- `sets(id, slug, name, country_iso2s text[])` and `set_awards(user_id, set_id, city_id, awarded_at, points)`, unique on (user_id, set_id). `city_id` records where the set was first completed.
- `submissions(id, proposed restaurant fields, submitted_by, status enum(pending, approved, rejected), reviewer_id, review_note)`
- `closure_reports(id, restaurant_id, reported_by, note, created_at, resolved bool)`
- `plans(id, group_id, restaurant_id, proposed_by, proposed_for timestamptz, status enum(proposed, booked, done, cancelled))` and `plan_rsvps(plan_id, user_id, response enum(yes, no, maybe))`

**Row Level Security on every table.**

Reads:
- Any signed-in user can read countries, cities, `city_countries` and its view, restaurants, sets and approved dishes.
- Members of a group can read its `groups` and `group_members` rows, its plans and RSVPs, and its visits, attendees and reactions.
- People who share a group can read each other's `profiles`, `stamps` and `set_awards`.
- Photos are readable only by members of the visit's group, via a Storage policy.

Writes:
- `visits`, `visit_attendees`, `stamps` and `set_awards` have no client INSERT, UPDATE or DELETE policies. Only SECURITY DEFINER functions write them: check-in, confirm, claim, backfill, photo, downgrade and dismiss-flag. `visited_at` is set to now() at check-in.
- `create_group(name)` makes the caller owner and generates the `invite_code`. Only the owner, through a function, changes a group's name, `verified_only`, season dates or `invite_code`.
- Members can insert plans for their group. Only the proposer or the owner can update a plan.
- Users can update their own `profiles` row, but not `is_curator`: revoke column UPDATE on it from `authenticated`. The README gives the one SQL statement that makes Andrew curator.
- Joining a group goes only through `join_group(invite_code)`, which also enforces the 20-member limit. There is no direct insert into `group_members`. Members can't change `role` or `groups.owner_id`.
- Only the check-in function inserts `visit_attendees`. Each user changes only their own row, through the confirm function.
- Users insert and delete only their own reactions and RSVPs, on visits and plans they can read. Members can insert submissions and closure reports.
- Only curators write `restaurants`, `city_countries`, `sets` and `signature_dishes`, review submissions, and resolve closure reports.

---

## 6. Screens (a mobile-first installable PWA; most use is on a phone outside a restaurant)

1. **Passport (home).**
   - A flag grid grouped by region. Stamped countries show in full colour with the date and verification badge. Backfilled stamps get a distinct "before the app" style.
   - Listed-but-unstamped countries show as an outline, and unlisted ones faint. Uncharted countries are greyed out in their own "Uncharted" section.
   - The header shows London progress and points (section 2). A banner lists pending confirmations and waiting stamps.
2. **Map.** Leaflet with OpenStreetMap tiles. Pins are bright for unstamped countries, muted for stamped ones, and ringed where a friend has been. A "Nearest unstamped" button works on the phone only; the location is never sent anywhere.
3. **World view.** A choropleth of my stamps or the group's combined stamps.
   - Use `countries-50m` from `world-atlas@2.0.2` (Natural Earth 4.1, ISC licence; the repo is archived but stable), joined on ISO numeric code. The 110m file drops small islands such as Mauritius; the 50m file (756 KB) includes them.
   - Load the map only on this screen.
   - Countries too small to see get a dot marker.
   - Kosovo, Northern Cyprus and Somaliland have no ISO code and stay unshaded.
   - A build-time test checks that every listed country's numeric code exists in the file.
4. **Country page.** Signature dishes, the city's restaurants for that country with friend ratings, and "Eaten by" group members with dates. "Suggest a restaurant" lets any member enter a name, address, postcode and note; the server geocodes the postcode and creates a pending submission.
5. **Restaurant page.**
   - Name and address. A contested-pick badge with the `curator_note` if flagged.
   - An "Open in Google Maps" link: `https://www.google.com/maps/search/?api=1&query=<name, address>&query_place_id=<id>`. It needs no API key, and Google falls back to `query` if the place ID is stale.
   - Friend visits and ratings, a Check in button, and "Report closed".
6. **Check-in flow.** Group → locate → tag co-diners → dish and 1–5 rating → stamp moment → "Nudge the table" / "Share recap". The optional photo step joins in M4.
7. **Group.**
   - A "Together" header: listed countries stamped by anyone in the group, out of London's total, with a progress bar.
   - The leaderboard, season or all-time, showing countries and points and saying when verified-only is on.
   - The activity feed with reactions.
   - **Gaps**: listed countries no member has.
   - **Spin the globe**: picks a random country from Gaps, suggests one of its restaurants, and proposes a dinner in one tap.
   - **Plan a dinner**: restaurant and date, RSVP yes/no/maybe, an "Add to calendar" `.ics` download, and "Share to WhatsApp".
   - The owner's flag list (section 4).
8. **Curator** (role-gated). Submissions queue, closure reports, restaurant edit, city-country status, and editors for sets and signature dishes.
9. **Settings.** Display name and avatar, backfill, Create group (also offered on an empty passport), the privacy and credits pages, and Delete account.

**Recap card.** After a check-in, render a PNG with the flags, the people at the table, the dish, the rating and the points. Share it with `navigator.share({ files })` from the tap handler, after checking `navigator.canShare`; that works in Safari/iOS 14+ and Chrome Android 76+. Otherwise download the PNG or open a `wa.me` text link.

**Flags.** Use `flag-icons` 7.5 (MIT) SVGs rather than emoji, because Chrome and Edge on Windows show emoji flags as two letters. It includes TW, PS and HK. Add a test that loops over all 249 codes, because the file count alone proves nothing. Emoji flags are fine in WhatsApp share text.

**Onboarding.** Open an invite link → sign in → optionally backfill countries already done → passport. Andrew's group has already done Spain, France, Italy, Turkey, China and India.

---

## 7. Stack (checked 5 October 2026)

Pin these major versions, and run `npm view` before installing to pick up patch releases. The whole stack runs on free tiers. Ask before adding anything that costs money.

- **App.** Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS 4. TypeScript 7 is current; if Next.js or Vitest tooling objects, use 5.x.
- **PWA.** Use the built-in `app/manifest.ts` for installability, plus an "Add to Home Screen" hint on iOS, which has no install prompt. No service worker or offline caching in v1.
- **Supabase Free.**
  - Postgres + PostGIS, installed into the `extensions` schema so it isn't exposed through the Data API.
  - Auth, a private Storage bucket for photos, and RLS.
  - `@supabase/supabase-js` 2 and `@supabase/ssr` 0.12 (pre-1.0, so pin it).
  - No Edge Functions. Server logic lives in Next.js route handlers or server actions (Node runtime) and in Postgres functions, so there's one runtime to debug.
- **Auth.**
  - Google sign-in is the main path: free, and no email involved.
  - Email one-time codes are the fallback and need custom SMTP. Supabase's built-in email only sends to members of the Supabase organisation, and only 2 an hour.
  - Use Brevo's free tier (300 emails a day, single verified sender, no domain needed), or Resend if Andrew has a domain. A gmail.com sender may land in spam, so test delivery to Gmail and Outlook before launch.
  - Locally, the Supabase CLI captures emails, so SMTP isn't needed until launch.
- **Maps.** Leaflet 1.9.4 (2.0 is still alpha) with react-leaflet 5.
  - OpenStreetMap tiles under the OSMF tile usage policy: visible "© OpenStreetMap contributors" attribution, the default referrer policy, and no prefetched or offline tiles.
  - The README names MapTiler or Stadia Maps (free non-commercial tiers) as the one-line swap if OSM ever blocks the app.
- **Geocoding.** postcodes.io at seed and submission time: free, no key, 100 postcodes per bulk request. Show its three attribution lines (Ordnance Survey, Royal Mail, National Statistics, current year) in the footer.
- **Hosting.**
  - Vercel Hobby is for personal, non-commercial use, which this app is. It also needs a GitHub repo owned by a person, not an organisation, which this one is.
  - Supabase Free allows 500 MB of database, 1 GB of storage and 50,000 monthly users.
  - Free Supabase projects pause after a week of low activity and stay restorable for 90 days. Add a daily Vercel Cron (Hobby allows one a day) that hits `/api/keepalive`, which checks `CRON_SECRET` and does a real database read. Back it up with a GitHub Actions schedule at an off-peak minute.
  - Supabase Free has no automatic backups, so add a weekly GitHub Action that runs `supabase db dump` and keeps the result as a workflow artifact.
- **Images.** Don't use `next/image` optimisation for user photos: Hobby includes only 5,000 transformations a month, and the photos are already resized.
- **Tests.**
  - Vitest 5 for scoring, the cap and other pure functions.
  - pgTAP via `supabase test db` for RLS and database functions. It needs Docker and `supabase start`. Use the Basejump `supabase-test-helpers` to act as different users.
  - Playwright for the check-in happy path at a phone viewport. Playwright signs in by creating users with the service-role key on the local stack. Never deploy a test-login route.

  GitHub Actions CI runs all three on every PR.

---

## 8. Data, privacy and legal (hard requirements)

- **Google Maps data.** Store `google_place_id` only, because place IDs are exempt from Google's caching restrictions. Don't store any Google-sourced coordinates, ratings, reviews, photos, opening hours or descriptions. No Places API calls in v1. Coordinates come from postcodes.io.
- **No raw location stored anywhere**, whether in tables, logs, analytics or URLs.
- **Don't invent restaurants.** New ones arrive only through submissions or from the curator.
- **Privacy.** A purely personal, invite-only app with no commercial side falls outside UK GDPR under the domestic-purposes exemption (ICO guidance). Keep it that way and keep the good habits:
  - The app is invite-only, behind a login and `noindex`, with no analytics or ads.
  - A short privacy page says who runs the app and how to get data deleted.
- **Account deletion.**
  - It removes the user's profile, group memberships, attendances, reactions, RSVPs, stamps and set awards.
  - A visit the user created is deleted only if nobody else is confirmed or pending on it. Otherwise it stays, with `created_by` set to null and its photo deleted, so co-diners keep their attendances and stamps. Other users' stored points are never recomputed.
  - If the user owns a group, ownership passes to the longest-standing member. A group with no other members is deleted.
- **Credits.** The README and the in-app credits page cover the sources that require it: the country dataset (CC BY-SA 4.0), postcodes.io (OS, Royal Mail, ONS), OpenStreetMap, Natural Earth/world-atlas and flag-icons.

---

## 9. Seed data

Write `npm run seed`. It is **insert-only** (`ON CONFLICT DO NOTHING`), keyed on:
- `iso2` for countries;
- `slug` for cities and sets;
- (country_iso2, name) for dishes;
- (name, postcode) for restaurants.

It never updates a row that already exists, so re-running it can't overwrite curator edits. It reads from `seed/`:

1. **Countries.** `seed/iso-3166-all.csv`: `all/all.csv` from lukes/ISO-3166-Countries-with-Regional-Codes v10.0, CC BY-SA 4.0 (see `seed/iso-3166-all.LICENSE.md`). It has 249 rows.
   - Apply the overrides: TW → Asia / Eastern Asia and AQ → Antarctica (both have blank regions in the file), plus the short display names.
   - Test that every country ends up with a region.
2. **London.**
3. **Restaurants.** `seed/london-restaurants.csv`: 68 restaurants across 39 countries, fact-checked on 5 October 2026 (see `docs/fact-check-2026-10-05.md`).
   - Geocode with the postcodes.io bulk `POST /postcodes`.
   - If a postcode doesn't resolve, try `GET /terminated_postcodes/{postcode}`, which still returns coordinates, and log a warning naming the restaurant. If neither resolves, **fail loudly**.
   - Every seed postcode is currently live: the fact-check replaced the two terminated ones. Cover the fallback with a test using EC1V 1LP, which was terminated in March 2015.
   - Seed rows import with status `active`, and `verified_at` stays null until the curator has checked each row personally.
4. **City statuses.** `city_countries` for London: one `unlisted` row for each of the 249 countries. The view derives which are listed.
5. **Sets.** `seed/sets.csv`: 12 sets, with country codes separated by spaces.
6. **Signature dishes.** `seed/signature-dishes.csv`: 140 dishes for the 40 countries checked. Senegal's stay ready for when it's listed again. Andrew reviews them in the brief's PR, so they import as `approved`, and the curator can demote any of them later.

`flagged` rows import normally and show a "contested pick" badge.

Production is seeded once, at the first deploy, by running `npm run seed` against the cloud project with the service key. Never reset or reseed the production database.

**Coverage gap (deliberate).** The seed covers the *harder* countries. Common cuisines are `unlisted` until the curator adds them: Japan, Thailand, Korea, Greece, Lebanon, Iran, Morocco, the six the group has done, and so on. Don't fill them in. Leads found during fact-checking are in the log, not the seed.

---

## 10. Milestones

Each milestone ends with passing CI, committed phone screenshots and a short demo note. Friends can start playing after M3.

1. **Foundations.**
   - The Supabase local stack, schema, RLS policies, the seed script, and GitHub Actions CI (Vitest, `supabase test db`, Playwright).
   - pgTAP tests show that a non-member can't read another group's visits or photos, and that a user who shares no group with someone can't read their stamps.
   - They also show that a normal user can't insert a stamp, set `is_curator`, join a group without its invite code, or add themselves to someone else's visit.
2. **Join and browse.** Auth (local email capture in development), profiles, groups (`create_group`, invite links, `join_group`), backfill, and the Passport, Country, Restaurant and Settings pages.
3. **Check-in and scoring.** The check-in flow (group, location, co-diners, confirm sheet, nudge, waiting stamps), stamp creation, scoring functions and view, and the stamp moment. Then the first deploy, with a GitHub Action that runs `supabase db push` on every merge to `main`. Tests cover:
   - rarity frozen at check-in and the same for everyone at the table, with a minimum of 1 even when the visited restaurant is `closed` at check-in;
   - the table bonus reaching every stamp when the third person confirms, in any order, and never with only two;
   - the dish bonus only for an approved dish picked by id;
   - set activation (≥2 listed), completion and permanence: once per user per set, with backfilled stamps not counting;
   - the daily cap at midnight Europe/London, including across a clock change;
   - over-cap stamps waiting and being claimable the next day;
   - a capped attendance not blocking a later stamp;
   - two concurrent confirmations not both passing the cap;
   - backfilled stamps scoring 0, never counting toward the cap, and being upgraded in place by a visit;
   - a declined or lapsed attendee getting no stamp;
   - an owner downgrade reaching every stamp from the visit;
   - the worked example in section 3, including Alice deleting her account.
4. **Group play and photos.** The Together header, leaderboard, feed and reactions, the flag list, Gaps, Spin the globe, Plan a dinner (RSVP, `.ics`, WhatsApp), and the recap card. Also the photo pipeline with its EXIF test, plus a test that a photo added after confirmations raises every stamp to `photo`.
5. **Maps.** The London map with "Nearest unstamped", and the world view.
6. **Curator console**, plus "Suggest a restaurant" and "Report closed".
7. **Launch.**
   - Google sign-in and Brevo SMTP in production, the keep-alive cron and the weekly backup.
   - The privacy and credits pages, account deletion, and a README with data sources and licences.
   - A `security-review` pass, then the section 13 run.

---

## 11. Decisions (all closed)

1. **Name:** "Eat the World", held in an `APP_NAME` constant.
2. **Hosting:** Vercel Hobby + Supabase Free. It costs nothing and needs no ops; AWS would cost money for no gain at under 100 users.
3. **Daily cap:** 3, and it delays stamps rather than refusing check-ins.
4. **Submissions:** any group member can submit; only the curator approves.
5. **Disputes:** reactions plus an owner downgrade, not a formal query process.
6. **Server logic:** Next.js and Postgres functions, no Edge Functions.
7. **Sign-in:** Google first, with email codes via Brevo SMTP as the fallback.
8. **Backfill:** passport only, with no points.

---

## 12. Later (out of scope for v1)

Public profiles or discovery, native apps, cities other than London (the schema already supports them), Google Places API calls, push notifications, payments, reservations, cosmetic badges, and an offline check-in queue.

---

## 13. Definition of done

Claude runs this flow with Playwright at 390×844 against the deployed URL. The test creates two throwaway users with the service-role key, signs them in with `auth.admin.generateLink`, and removes them afterwards through account deletion. Claude then gives Andrew a short checklist to repeat the flow on real phones, including the Google sign-in, and sign off:

1. A new friend opens an invite link, signs in with Google and backfills past countries.
2. They see their passport with the London denominator.
3. They check in at a seeded restaurant with a co-diner, who confirms from the nudge link.
4. Both stamps appear with the correct points breakdown.
5. They share the recap card to WhatsApp, then spin the globe and propose the next dinner.
6. The Together bar and the leaderboard update.

Throughout, no raw location is stored anywhere and the RLS tests are green.
