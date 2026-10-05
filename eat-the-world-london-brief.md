# Build brief: Eat the World — London

A private game for a group of friends: eat at a restaurant that specialises in one country's cuisine, collect that country's stamp, and see how much of the world London can feed you. It's for fun, not money. If fun and polish conflict, choose fun. If fun conflicts with the privacy rules in section 8, the privacy rules win.

---

## 0. How to build this (read first)

You are a Claude Code session building the MVP from this brief. Read all of it before writing code. Every product decision has been made (section 11), so don't stop to ask unless something here turns out to be impossible or contradicts a verified fact. If that happens, say which.

- **Repo.** `github.com/andrewjpage/eat-the-world` (private, personal account, never the `originsciences` org). Commit as andrewjpage@gmail.com. One branch and PR per milestone; keep `main` deployable.
- **Process.** Start in plan mode and show the plan once. After approval, build milestone by milestone (section 10) without further check-ins, committing as you go. A milestone is done when its tests pass, Playwright screenshots of its new screens at a phone viewport (390×844) are attached, and the PR has a three-line demo note.
- **Andrew's accounts.** M1–M6 run entirely on the local Supabase stack. The only things you need from Andrew are account actions: the Vercel project, the Supabase cloud project, the Google OAuth client and the Brevo sender. Put them in one README checklist with exact steps, and ask for them at M7.
- **Models.** Claude subscription only. Don't use Amazon Bedrock or any other external model API.
- **Orchestration.** Use the Workflow tool with subagents, and match model and effort to the task:

  | Task | Model | Effort |
  |---|---|---|
  | Schema, RLS policies, scoring rules, stamp and cap functions, milestone review, security review | Opus | high |
  | Screens, route handlers, seed script, Playwright tests | Sonnet | medium |
  | Mechanical work: fixtures, copy, CSV/JSON reshaping, lint fixes, README | Haiku | low |

  Run independent work in parallel (for example RLS tests alongside screens). Give implementers their own worktrees when they edit files concurrently. Before each milestone merges, an Opus reviewer who didn't write the code checks it.
- **Skills.** `superpowers:writing-plans` for the plan, `superpowers:subagent-driven-development` to execute it, and `superpowers:test-driven-development` for scoring, the daily cap and stamp creation. Use `webapp-testing` for Playwright, `run` to launch the app and take screenshots, and `superpowers:verification-before-completion` before calling a milestone done. Use `code-review` and `security-review` before launch (RLS and location privacy are the risks).

---

## 1. The game

- Friends form small private groups of 2–20 people. Each country whose cuisine you've eaten at a specialist restaurant becomes a stamp in your passport.
- The core loop is the **group dinner**. Spin for a country nobody in the group has, pick a restaurant and propose a date. Eat together, and one check-in stamps everyone at the table. Trade banter over the leaderboard, then spin again.
- Beli already does ranked restaurant logging with friend feeds; don't rebuild it. This app differs in three ways. The unit of progress is the **country**, not the restaurant. A **curated specialist rule** decides what counts. The **group dinner** is the core loop.
- Feel: a passport, not a spreadsheet. The stamp moment is a small celebration: an ink-stamp animation, the points breakdown, and a haptic buzz where the phone supports it. Friendly banter beats policing.
- Not in the game: money, ads, public profiles, growth features, streaks, or anything that rewards spending more or eating out more often.

---

## 2. Rules (these drive the schema; don't soften them)

- **Country list.** ISO 3166-1 alpha-2 is the canonical list: 249 officially assigned codes. It keeps the app out of statehood arguments: Taiwan, Palestine and Hong Kong are present because ISO lists them, and Kosovo is absent because `XK` is only user-assigned. Group countries by UN M49 region and sub-region. M49 has no entry for Taiwan.
- **Specialist rule.** A restaurant counts for country X only if the bulk of its menu is X's cuisine. Pan-regional places ("pan-Asian", "Middle Eastern", "Balkan", "Nordic", "Latin") don't count unless the curator assigns a single country. In v1 each restaurant has exactly one country. Edge cases are curator calls, explained in `curator_note`. Rows with `confidence = flagged` show a "contested pick" badge. The seed includes some on purpose, so the rule gets argued about over dinner from day one.
- **Honest denominator.** Each (city, country) pair has one of three statuses:
  - `listed`: at least one active, approved restaurant. This is derived from the restaurants table.
  - `unlisted`: nobody has checked yet.
  - `uncharted`: the curator has confirmed there is no specialist in this city.

  Uncharted is a feature: it's the list of countries London can't give you.
- **Progress.** The headline is London progress: countries you've stamped *that are listed in London* over countries listed in London, for example "34 / 86 in London". A second line shows your total stamps anywhere (including backfilled and unlisted countries) and your points. The ISO total goes in small print. Stamps for countries London doesn't list never inflate the headline. They join it automatically if that country is listed later.
- **No spend or frequency incentives.** Points never scale with price. No streaks.
- **Daily cap.** `MAX_NEW_STAMPS_PER_DAY = 3` new stamps per user per calendar day of `visited_at` in Europe/London time. That's enough for a genuine food crawl but blocks bulk couch-cheating. The stamp-creating database function enforces it. A check-in that would exceed the cap is refused with a clear message. A co-diner confirmation that would exceed it still records the attendance but earns no stamp, and the app says why.
- **Permanence.** Stamps stand even if the restaurant later closes. The rarity bonus is frozen at stamp time. Set awards, once won, are kept.

---

## 3. Scoring

Implement scoring as pure TypeScript functions plus SQL (a view and Postgres functions), fully unit-tested. It must be deterministic and reproducible from stored data.

| Component | Points |
|---|---|
| New country stamp | 10 |
| **Rarity bonus**: depends on how many active listed restaurants the country has in the city *at the moment of the stamp*, frozen on the stamp. 1 → +15, 2–3 → +10, 4–9 → +5, 10+ → 0 | 0–15 |
| **Table bonus**: the visit has ≥3 confirmed attendees from the same group, including the person checking in | +5 |
| **Signature dish**: the dish this user declared is one of the country's *approved* signature dishes | +2 |
| **Set completion**: a set is active in a city when ≥2 of its countries are listed there. Completing it means stamping every listed country in it. The award is stored once in `set_awards` and never revoked | +25 per set |

- Repeat visits to a country you've already stamped score 0 but are logged. They feed friend ratings and "where next".
- **Backfilled stamps** (countries done before joining) are self-reported, have no restaurant, and earn the base 10 only: no rarity, table or dish bonus.
- Set awards are checked whenever a stamp is created and whenever the curator changes a city's listings. With under 100 users, recomputing for everyone is fine.
- **Seasons.** A group can set a season start and end date. Season leaderboards count stamps and set awards whose `earned_at` or `awarded_at` falls inside the season; all-time counts everything.
- **Verification is displayed, not scored.** Each stamp carries `geo_verified`, `photo` or `self_reported`. Group owners can switch their leaderboard to verified stamps only.

**Worked example (make it a test).** Alice, Bob and Cara are in the same group and eat at Lao Café, the only listed Lao restaurant in London. Alice checks in and tags Bob and Cara. Each of them picks "larb" (an approved Lao dish), and both co-diners confirm. Each gets a Laos stamp worth 10 + 15 + 5 + 2 = 32. Dan, who wasn't there, gets nothing. If a second Lao restaurant is listed next month, their stamps stay at 32.

Sets are data the curator can edit, seeded from `seed/sets.csv`: Caucasus, Horn of Africa, Mekong, Maritime Southeast Asia, West Africa, Caribbean, Eastern Europe, Iberia, Arabian Peninsula & Levant, South America, The Stans, and Indian Ocean Islands.

---

## 4. Check-in

- Request browser geolocation **once, at check-in**. Send `{lat, lon, accuracy}` in the request body (never the URL) to a Next.js route handler. The handler calls a Postgres function that computes the distance to the restaurant with PostGIS and stores only `distance_m` (rounded to 10 m) and `geo_verified`. **Raw coordinates are never stored or logged.**
- `geo_verified = accuracy_m ≤ 500 AND (distance_m − accuracy_m) ≤ 250`. Restaurant points are postcode centroids, hence the slack. This is a friendly badge, not anti-cheat. A determined friend can fake it, and that's fine.
- **Photo** (optional).
  - On the phone, decode the photo with `createImageBitmap`, resize it to at most 1600 px on the long edge, and re-encode it as JPEG (quality about 0.8) through a canvas. That drops EXIF data including GPS, and keeps uploads well under Vercel's 4.5 MB request limit.
  - The upload goes through a Next.js route handler on the Node runtime. It re-encodes the photo again with `sharp` (keeping no metadata) and stores it in a private Supabase Storage bucket. Photos are served by short-lived signed URLs.
  - Prove this in M3 on a deployed preview: upload real iPhone photos that have GPS (including a HEIC and a 48 MP shot) and run `exiftool` on the stored files.
  - If `sharp` won't run on Vercel, the handler must reject any JPEG that still carries an EXIF segment. Never store a photo unstripped.
- **Co-diners.** The person checking in tags group members. Each tagged person gets a pending attendance and confirms it in one tap within 48 hours, optionally adding their own dish and rating. After 48 hours an unconfirmed attendance lapses to `declined`. The visit's verification level carries over to confirmed co-diners.
- **Banter.** Any group member can react to a feed item with 👏, 🤤 or 🤨. A 🤨 is flagged to the group owner, who can downgrade that visit to `self_reported`. There is no public shaming UI.
- **Speed.** The whole flow takes under 30 seconds, one-handed, on poor signal. Save the check-in first and upload the photo afterwards. Show the stamp straight away and reconcile once the server confirms.

---

## 5. Data model (Postgres + PostGIS on Supabase)

Adjust names if needed, but keep the semantics.

- `countries(iso2 pk, iso_numeric, name, flag_emoji, m49_region, m49_subregion)`. `iso_numeric` joins the world map; `flag_emoji` is only for share text, because the UI uses SVG flags.
- `signature_dishes(id, country_iso2, name, note, status enum(draft, approved))`
- `cities(id, name, slug)`. Seed only London, but scope everything by city so adding Cambridge needs no migration.
- `city_countries(city_id, country_iso2, status enum(listed, unlisted, uncharted), updated_by, updated_at)`. `listed` is derived from restaurants; `uncharted` is a curator assertion.
- `restaurants(id, city_id, country_iso2, name, address, postcode, location geography(Point), google_place_id null, website null, status enum(active, reported_closed, closed, pending), confidence enum(curated, community, flagged), curator_note, created_by, verified_at null)`
- `profiles(user_id pk → auth.users, display_name, avatar_url, is_curator bool default false)`
- `groups(id, name, owner_id, invite_code, verified_only bool, season_start date null, season_end date null)`
- `group_members(group_id, user_id, role enum(owner, member), joined_at)`
- `visits(id, restaurant_id, group_id null, created_by, visited_at, verification enum, distance_m int null, photo_path null)`
- `visit_attendees(visit_id, user_id, status enum(pending, confirmed, declined), confirmed_at, dish text null, rating smallint null check 1–5, note text null)`. The person checking in gets a confirmed row.
- `reactions(visit_id, user_id, emoji enum(clap, drool, side_eye), created_at)`, unique on (visit_id, user_id, emoji).
- `stamps(user_id, country_iso2, visit_id null, earned_at, base int, rarity_bonus int, table_bonus int, dish_bonus int, verification enum, backfilled bool)`, unique on (user_id, country_iso2). A database function creates the stamp when an attendance is confirmed, provided it's that user's first confirmed visit for the country and the daily cap allows it.
- `sets(id, slug, name, country_iso2s text[])` and `set_awards(user_id, set_id, city_id, awarded_at, points)`, unique on (user_id, set_id, city_id).
- `submissions(id, proposed restaurant fields, submitted_by, status enum(pending, approved, rejected), reviewer_id, review_note)`
- `closure_reports(id, restaurant_id, reported_by, note, created_at, resolved bool)`
- `plans(id, group_id, restaurant_id, proposed_by, proposed_for timestamptz, status enum(proposed, booked, done, cancelled))` and `plan_rsvps(plan_id, user_id, response enum(yes, no, maybe))`

**Row Level Security on every table.** Users can read visits, attendees, reactions, stamps and photos only for people they share a group with. Countries, cities, restaurants, sets and approved dishes are readable by any signed-in user. Only `is_curator` users can approve submissions, change a restaurant's status or confidence, set `uncharted`, or edit sets and dishes. Andrew is the only curator in v1.

---

## 6. Screens (a mobile-first installable PWA; most use is on a phone outside a restaurant)

1. **Passport (home).** A flag grid grouped by region. Stamped countries show in full colour with the date and verification badge, listed-but-unstamped ones as an outline, and unlisted ones faint. Uncharted countries are greyed out in their own "Uncharted" section. The header shows London progress and points (section 2).
2. **Map.** Leaflet with OpenStreetMap tiles. Pins are bright for unstamped countries, muted for stamped ones, and ringed where a friend has been. A "Nearest unstamped" button works on the phone only; the location is never sent anywhere.
3. **World view.** A choropleth of my stamps or the group's combined stamps.
   - Use `countries-50m` from `world-atlas@2.0.2` (Natural Earth 4.1, ISC licence; the repo is archived but stable), joined on ISO numeric code. The 110m file drops small islands such as Mauritius; the 50m file (756 KB) includes them.
   - Load the map only on this screen.
   - Countries too small to see get a dot marker.
   - Kosovo, Northern Cyprus and Somaliland have no ISO code and stay unshaded.
   - A build-time test checks that every listed country's numeric code exists in the file.
4. **Country page.** Signature dishes, the city's restaurants for that country with friend ratings, and which group members have the stamp.
5. **Restaurant page.** Name and address. A contested-pick badge with the `curator_note` if flagged. An "Open in Google Maps" link: `https://www.google.com/maps/search/?api=1&query=<name, address>&query_place_id=<id>`. It needs no API key, and Google falls back to `query` if the place ID is stale. Friend visits and ratings, a Check in button, and "Report closed".
6. **Check-in flow.** Locate → optional photo → tag co-diners → dish and 1–5 rating → stamp animation with the points breakdown → "Share recap".
7. **Group.**
   - Leaderboard: season and all-time, with a verified-only toggle.
   - Activity feed with reactions.
   - **Gaps**: listed countries no group member has.
   - **Spin the globe**: picks a random country from Gaps, suggests one of its restaurants, and proposes a dinner in one tap.
   - **Plan a dinner**: restaurant and date, RSVP yes/no/maybe, an "Add to calendar" `.ics` download, and "Share to WhatsApp".
8. **Curator** (role-gated). Submissions queue, closure reports, restaurant edit, city-country status, and editors for sets and signature dishes, including approving the drafts.

**Recap card.** After a check-in, render a PNG with the flags, the people at the table and the points. Share it with `navigator.share({ files })` from the tap handler, after checking `navigator.canShare`; that works in Safari/iOS 14+ and Chrome Android 76+. Otherwise download the PNG or open a `wa.me` text link.

**Flags.** Use `flag-icons` 7.5 (MIT) SVGs rather than emoji, because Chrome and Edge on Windows show emoji flags as two letters. It includes TW, PS and HK. Add a test that loops over all 249 codes, because the file count alone proves nothing. Emoji flags are fine in WhatsApp share text.

**Onboarding.** Open an invite link → sign in → optionally backfill countries already done (self-reported) → passport. Andrew's group has already done Spain, France, Italy, Turkey, China and India.

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
  - Use Brevo's free tier (300 emails a day, single verified sender, no domain needed), or Resend if Andrew has a domain.
  - Locally, the Supabase CLI captures emails, so SMTP isn't needed until launch.
- **Maps.** Leaflet 1.9.4 (2.0 is still alpha) with react-leaflet 5.
  - OpenStreetMap tiles under the OSMF tile usage policy: visible "© OpenStreetMap contributors" attribution, the default referrer policy, and no prefetched or offline tiles.
  - The README names MapTiler or Stadia Maps (free non-commercial tiers) as the one-line swap if OSM ever blocks the app.
- **Geocoding.** postcodes.io at seed and submission time: free, no key, 100 postcodes per bulk request. Show its three attribution lines (Ordnance Survey, Royal Mail, National Statistics, current year) in the footer.
- **Hosting.**
  - Vercel Hobby is for personal, non-commercial use, which this app is. It also needs a GitHub repo owned by a person, not an organisation, which this one is.
  - Supabase Free allows 500 MB of database, 1 GB of storage and 50,000 monthly users.
  - Free Supabase projects pause after a week of low activity and stay restorable for 90 days. Add a daily Vercel Cron (Hobby allows one a day) that hits `/api/keepalive`, which does a real database read. Back it up with a GitHub Actions schedule at an off-peak minute.
  - Supabase Free has no automatic backups, so add a weekly GitHub Action that runs `supabase db dump` and keeps the result as a workflow artifact.
- **Images.** Don't use `next/image` optimisation for user photos: Hobby includes only 5,000 transformations a month, and the photos are already resized.
- **Tests.**
  - Vitest 5 for scoring, the cap and other pure functions.
  - pgTAP via `supabase test db` for RLS and database functions. It needs Docker and `supabase start`. Use the Basejump `supabase-test-helpers` to act as different users.
  - Playwright for the check-in happy path at a phone viewport.

  CI runs all three on every PR.

---

## 8. Data, privacy and legal (hard requirements)

- **Google Maps data.** Store `google_place_id` only, because place IDs are exempt from Google's caching restrictions. Don't store any Google-sourced coordinates, ratings, reviews, photos, opening hours or descriptions. No Places API calls in v1. Coordinates come from postcodes.io.
- **No raw location stored anywhere**, whether in tables, logs, analytics or URLs.
- **Don't invent restaurants.** New ones arrive only through submissions or from the curator.
- **Privacy.** A purely personal, invite-only app with no commercial side falls outside UK GDPR under the domestic-purposes exemption (ICO guidance). Keep it that way and keep the good habits:
  - The app is invite-only, behind a login and `noindex`, with no analytics or ads.
  - A short privacy page says who runs the app and how to get data deleted.
  - Account deletion removes the user's visits, attendances, reactions, photos and stamps.
  - Groups are private, and there are no public profiles.
- **Credits.** The README and an in-app credits page cover the sources that require it: the country dataset (CC BY-SA 4.0), postcodes.io (OS, Royal Mail, ONS), OpenStreetMap, Natural Earth/world-atlas and flag-icons.

---

## 9. Seed data

Write an idempotent `npm run seed` that upserts from the files in `seed/`:

1. **Countries.** The full ISO 3166-1 list with M49 regions, from `all/all.csv` in `lukes/ISO-3166-Countries-with-Regional-Codes` (v10.0, CC BY-SA 4.0). Vendor it as a static file alongside its licence; never fetch it at runtime.
   - That file leaves Taiwan's and Antarctica's regions blank, so apply a small override table: TW → Asia / Eastern Asia, AQ → Antarctica.
   - Test that all 249 countries end up with a region.
   - Add `iso_numeric` from the same file.
2. **London.**
3. **Restaurants.** `seed/london-restaurants.csv`: 68 restaurants across 39 countries, fact-checked on 5 October 2026 (see `docs/fact-check-2026-10-05.md`).
   - Geocode with the postcodes.io bulk `POST /postcodes`, 100 postcodes per request.
   - If a postcode doesn't resolve, try `GET /terminated_postcodes/{postcode}`, which still returns coordinates, and log a warning naming the restaurant. If neither resolves, **fail loudly**.
   - After the fact-check, every seed postcode is live: the two terminated ones were replaced. Cover the fallback with a test using EC1V 1LP, which was terminated in March 2015.
   - `verified_at` stays null until the curator has checked each row personally.
4. **City statuses.** `city_countries` for London: `listed` for every country with a seeded restaurant, `unlisted` for everything else.
5. **Sets.** `seed/sets.csv`: 12 sets.
6. **Signature dishes.** `seed/signature-dishes.csv`: 140 draft dishes for the 40 countries checked (Senegal's stay ready for when it's listed again). Import them as `draft` for the curator to approve. The check-in dish picker offers the country's approved dishes plus "something else".

`flagged` rows import normally and show a "contested pick" badge.

**Coverage gap (deliberate).** The seed covers the *harder* countries. Common cuisines are `unlisted` until the curator adds them: Japan, Thailand, Korea, Greece, Lebanon, Iran, Morocco, the six the group has done, and so on. Don't fill them in. Leads found during fact-checking are in the log, not the seed.

---

## 10. Milestones

Each milestone ends with passing tests, phone screenshots and a short demo note. Friends can start playing after M3.

1. **Foundations.** Supabase local stack, schema, RLS policies and pgTAP tests (at minimum: a non-member can't read another group's visits, stamps or photos), and the seed script.
2. **Join and browse.** Auth, profiles, groups and invite links, backfill, and the Passport, Country and Restaurant pages.
3. **Check-in and scoring.** The check-in flow (geolocation, photo, co-diners, daily cap), stamp creation, scoring functions and view, and the stamp animation. Unit tests cover:
   - rarity frozen at stamp time;
   - the table-bonus threshold (2 vs 3);
   - the dish bonus only for approved dishes;
   - set activation (≥2 listed), completion and permanence;
   - the daily-cap boundary at midnight Europe/London, including across a clock change;
   - backfilled stamps earning the base only;
   - a declined or lapsed attendee getting no stamp;
   - the worked example in section 3.
4. **Group play.** Leaderboard, feed and reactions, Gaps, Spin the globe, Plan a dinner (RSVP, `.ics`, WhatsApp), and the recap card.
5. **Maps.** The London map with "Nearest unstamped", and the world view.
6. **Curator console.**
7. **Launch.** Deploy to Vercel + Supabase with Google sign-in and Brevo SMTP. Add the keep-alive cron and the weekly backup, the privacy and credits pages, and a README with data sources and licences. Do a `security-review` pass, then the section 13 run on a real phone.

---

## 11. Decisions (all closed)

1. **Name:** "Eat the World", held in an `APP_NAME` constant.
2. **Hosting:** Vercel Hobby + Supabase Free. It costs nothing and needs no ops; AWS would cost money for no gain at under 100 users.
3. **Daily cap:** 3.
4. **Submissions:** any group member can submit; only the curator approves.
5. **Disputes:** reactions plus an owner downgrade, not a formal query process.
6. **Server logic:** Next.js and Postgres functions, no Edge Functions.
7. **Sign-in:** Google first, with email codes via Brevo SMTP as the fallback.

---

## 12. Later (out of scope for v1)

Public profiles or discovery, native apps, cities other than London (the schema already supports them), Google Places API calls, push notifications, payments, reservations, cosmetic badges (first stamp, a continent swept), and an offline check-in queue.

---

## 13. Definition of done

On a real phone against the deployed URL:

1. A new friend opens an invite link, signs in and backfills past countries.
2. They see their passport with the London denominator.
3. They check in at a seeded restaurant with a co-diner, who confirms.
4. Both stamps appear with the correct points breakdown.
5. They share the recap card to WhatsApp, then spin the globe and propose the next dinner.
6. The group leaderboard updates.

Throughout, no raw location is stored anywhere and the RLS tests are green.
