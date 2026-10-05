# Build brief: "Eat the World — London" (working title)

You are building an MVP web app. Read the whole brief before writing code. Start in plan mode and show me the plan. Where the brief gives a default, use it. Where it lists an open decision (section 11), ask me before building that part.

---

## 1. What this is

A private, friends-only challenge: eat at a restaurant that **specialises in a single country's cuisine**, for as many countries as possible, starting with London. Each country is a stamp in your passport. Friends compete in small private groups (2–20 people) and, more importantly, plan dinners together.

It is **not** a restaurant review app. Beli already owns ranked restaurant logging with friend feeds and leaderboards counted by number of restaurants logged. Do not rebuild that. The wedge here is three things Beli doesn't do:

1. The unit of progress is the **country**, not the restaurant.
2. A **curated specialist rule** decides what counts.
3. The **group dinner** is the core loop: one check-in stamps everyone at the table.

---

## 2. Product rules (these drive the schema — don't soften them)

- **Country list.** Use ISO 3166-1 alpha-2 as the canonical list, with UN M49 region/sub-region for grouping. This keeps the app out of statehood arguments: Taiwan, Palestine and Hong Kong are present because ISO includes them. Use a maintained dataset and cite it in the README.
- **Specialist rule.** A restaurant counts for country X only if the bulk of its menu is X's cuisine. Pan-regional places ("pan-Asian", "Middle Eastern", "Balkan", "Nordic", "Latin") do not count unless a curator assigns a single country. **Exactly one country per restaurant in v1.** Edge cases are curator decisions, recorded in `curator_note`. The seed deliberately includes some edge cases (marked `flagged`) so the rule is exercised from day one.
- **Honest denominator.** Each (city, country) pair has a status:
  - `listed` — at least one active, approved restaurant
  - `unlisted` — nobody has checked yet
  - `uncharted` — a curator has confirmed there is no specialist in this city

  Progress is shown as `stamped / listed` (e.g. "34 / 86 in London"), with the full ISO count secondary. "Uncharted" is a feature: it's the list of countries London can't give you.
- **No spend or frequency incentives.** Points never scale with price. No daily or weekly streaks.
- **Daily cap.** At most `MAX_NEW_STAMPS_PER_DAY = 3` (config constant) new stamps per user per calendar day (Europe/London). A check-in that would exceed it is refused with a clear message. Three allows a genuine food crawl; it blocks couch-cheating in bulk.
- **Stamps are permanent.** If a restaurant later closes, stamps earned there stand.

---

## 3. Scoring

Implement as pure TypeScript functions plus a SQL view, fully unit-tested. Scoring must be deterministic and reproducible from stored data.

| Component | Points |
|---|---|
| New country stamp | 10 |
| **Rarity bonus** — by number of active listed restaurants for that country in the city **at the moment of the stamp** (frozen and stored on the stamp, so later additions don't devalue it): 1 → +15, 2–3 → +10, 4–9 → +5, 10+ → 0 | 0–15 |
| **Table bonus** — stamp earned at a visit with ≥3 confirmed members of the same group | +5 |
| **Signature dish** — user declares they ate one of the country's listed signature dishes | +2 |
| **Set completion** — every *listed* country in a curated set is stamped. A set is only active in a city if ≥2 of its countries are listed there | +25 per set |

- Repeat visits to an already-stamped country score 0 but are logged; they feed friend ratings and "where next".
- **Backfilled stamps** (countries done before joining) are self-reported, have no restaurant, and earn the base 10 only — no rarity, table or dish bonus.
- **Seasons:** a group can optionally set a season start/end date. Leaderboards show season and all-time.
- **Verification is displayed, not scored.** Each stamp carries `geo_verified | photo | self_reported`. Group owners can toggle "verified stamps only" for their leaderboard.

Initial sets (store as data, editable by curator):
Caucasus (GE, AM, AZ) · Horn of Africa (ET, ER, SO) · Mekong (VN, LA, KH, MM, TH) · Maritime Southeast Asia (MY, ID, PH) · West Africa (NG, GH, SN) · Caribbean (JM, TT) · Eastern Europe (PL, HU, RO, UA) · Iberia (ES, PT) · Arabian Peninsula & Levant (YE, PS, LB, SY, JO, IQ)

---

## 4. Check-in and verification

- Request browser geolocation **once, at check-in**. Send coordinates to a server-side function that computes distance to the restaurant and stores only `distance_m` (rounded to 10 m) and `geo_verified`. **Raw user coordinates are never persisted.**
- `geo_verified = (distance_m − reported_accuracy_m) ≤ 250`.
- Photo is optional. Strip all EXIF (especially GPS) server-side before storage; resize to max 1600 px on the long edge.
- **Co-diners:** the person checking in tags group members. Each gets a pending attendance they confirm in one tap within 48 h. The check-in's verification level propagates to confirmed co-diners.
- Any group member can **query** a check-in. That flags it to the group owner, who resolves it. No public shaming UI.
- Target: the whole check-in flow completes in under 30 seconds, one-handed, on a phone with poor signal.

---

## 5. Data model (Postgres + PostGIS)

Suggested tables — adjust names, keep the semantics.

- `countries(iso2 pk, name, flag_emoji, m49_region, m49_subregion)`
- `signature_dishes(id, country_iso2, name, status enum(draft, approved))`
- `cities(id, name, slug)` — seed London only, but everything is city-scoped so Cambridge can be added without a migration.
- `city_countries(city_id, country_iso2, status enum(listed, unlisted, uncharted), updated_by, updated_at)` — `listed` is derived from restaurants; `uncharted` is a curator assertion.
- `restaurants(id, city_id, country_iso2, name, address, postcode, location geography(Point), google_place_id null, website null, status enum(active, reported_closed, closed, pending), confidence enum(curated, community, flagged), curator_note, created_by, verified_at null)`
- `profiles(user_id pk → auth.users, display_name, avatar_url, is_curator bool default false)`
- `groups(id, name, owner_id, invite_code, verified_only bool, season_start date null, season_end date null)`
- `group_members(group_id, user_id, role enum(owner, member), joined_at)`
- `visits(id, restaurant_id, group_id null, created_by, visited_at, verification enum, distance_m int null, photo_path null, dish text null, rating smallint null check 1–5, note text null, queried bool default false)`
- `visit_attendees(visit_id, user_id, status enum(pending, confirmed, declined), confirmed_at)`
- `stamps(user_id, country_iso2, visit_id null, earned_at, base int, rarity_bonus int, table_bonus int, dish_bonus int, verification enum, backfilled bool)` — `unique(user_id, country_iso2)`. Created by a database function when an attendance is confirmed and it is that user's first confirmed visit for the country.
- `sets(id, name, country_iso2s text[])`
- `submissions(id, proposed restaurant fields, submitted_by, status enum(pending, approved, rejected), reviewer_id, review_note)`
- `closure_reports(id, restaurant_id, reported_by, note, created_at, resolved bool)`
- `plans(id, group_id, restaurant_id, proposed_by, proposed_for timestamptz, status)` and `plan_rsvps(plan_id, user_id, response enum(yes, no, maybe))`

**Row Level Security on every table.** Users can read visits, stamps, attendees and photos only for people they share a group with. Countries, cities, restaurants and sets are public-read. Only `is_curator` users can approve submissions, change restaurant status or confidence, set `uncharted`, or edit sets and signature dishes. I am the only curator in v1.

---

## 6. Screens (mobile-first installable PWA — most use is on a phone outside a restaurant)

1. **Passport (home).** Flag grid grouped by region. Stamped = full colour with date and verification badge; listed-but-unstamped = outline; unlisted = faint; uncharted = greyed in an "Uncharted" section. Header: `stamped / listed` and total points.
2. **Map.** Leaflet + OpenStreetMap tiles. Pins: unstamped country (bright), stamped country (muted), a friend has been (ring). "Nearest unstamped" button — compute client-side, don't persist the location.
3. **World view.** Choropleth of the user's stamps, or the group's combined stamps, using Natural Earth 110m TopoJSON.
4. **Country page.** Signature dishes, the city's restaurants for that country with friend ratings, which group members have the stamp.
5. **Restaurant page.** Name, address, contested-pick badge if `flagged` (show `curator_note`), "Open in Google Maps" (deep link by `google_place_id` if present, else by address), friend visits and ratings, Check in button, "Report closed".
6. **Check-in flow.** Locate → optional photo → tag co-diners → dish and 1–5 rating → stamp animation with the points breakdown.
7. **Group.** Leaderboard (season / all-time, verified-only toggle), activity feed, **Gaps** (listed countries no group member has — the main planning prompt), **Plan a dinner** (propose restaurant + date, RSVP).
8. **Curator** (role-gated). Submissions queue, closure reports, restaurant edit, city-country status, sets and signature-dish editor.

**Onboarding:** open a group invite link → magic-link sign-in → optional backfill of countries already done (self-reported). My own group has already done Spain, France, Italy, Turkey, China and India.

---

## 7. Stack (default — challenge it only with a concrete reason)

- Next.js (App Router) + TypeScript + Tailwind; installable PWA.
- Supabase: Postgres + PostGIS, Auth (email magic link + Google), Storage for photos, RLS, Edge Functions for check-in verification and EXIF stripping.
- Leaflet + OpenStreetMap tiles. Respect the OSM tile usage policy; note in the README where to swap in a hosted tile provider if usage grows.
- Geocoding: **postcodes.io** (free, UK open data) from postcode at import time.
- Hosting: Vercel + Supabase free tiers. Expected scale: under 100 users.
- Tests: Vitest for scoring and pure functions; SQL tests for RLS (minimum: a non-member cannot read another group's visits, stamps or photos); Playwright for the check-in happy path.

---

## 8. Data and legal constraints (hard requirements)

- **Google Maps data.** Store `google_place_id` only — Google permits indefinite storage of place IDs. Do **not** store Google-sourced coordinates (30-day cache limit), ratings, reviews, photos, opening hours or descriptions. Coordinates come from postcodes.io. No Places API calls in v1.
- The seed list was compiled from public listings in October 2026. Every row starts with `verified_at = null`; I will check each against the restaurant's own site before launch.
- **Do not invent restaurants.** If a country has no seed entry, it is `unlisted`. New restaurants arrive only through the submission flow or from me.
- **UK GDPR basics.** Privacy notice page. Account deletion removes the user's visits, attendances, photos and stamps. No raw location storage. Groups private by default; no public profiles in v1.

---

## 9. Seed data

Write an idempotent `npm run seed` that upserts:

1. The full ISO 3166-1 country list with M49 regions.
2. London.
3. The restaurants below, geocoded via postcodes.io (bulk `POST /postcodes`). If a postcode doesn't resolve, try `GET /terminated_postcodes/{postcode}` — it still returns coordinates — and log a warning naming the restaurant. If neither resolves, **fail loudly**; don't skip silently. Two seed postcodes are already known to be terminated (EC1V 1LP, SE1 8NN — checked October 2026), so this fallback is required, not hypothetical.
4. `city_countries` for London: `listed` for every country with a seeded restaurant, `unlisted` for everything else.
5. The sets in section 3.

Signature dishes: draft 2–4 per seeded country from general knowledge, insert as `draft`, and list them in the PR description for my review. Don't block on this.

`flagged` rows import normally but display a "contested pick" badge.

**Coverage gap — important:** this seed deliberately covers the *harder* countries. Common cuisines (Japan, Thailand, Korea, Greece, Lebanon, Iran, Morocco, the six my group has done, and so on) are not seeded and will show as `unlisted` until I add them. Don't fill them yourself.

```csv
country_iso2,country,restaurant,address,postcode,google_place_id,confidence,curator_note
NG,Nigeria,Enish Oxford Street,"3 Berners St, London",W1T 3LD,ChIJ97wxu34bdkgRnbFvkY0konM,curated,"Classic Nigerian; some reviewers find flavours toned down"
NG,Nigeria,Akoko,"21 Berners St, London",W1T 3LP,ChIJU7uHDYcbdkgRttS28-dNO7E,flagged,"West African tasting menu, Nigerian-led but pan-regional; fine dining"
ET,Ethiopia,Zeret Kitchen,"216-218 Camberwell Rd, London",SE5 0ED,ChIJJd_nKX4DdkgRdsLXS_Ey8As,curated,"Coffee ceremony"
ET,Ethiopia,Gebeta Ethiopian Kitchen,"51 Leather Ln, London",EC1N 7TJ,ChIJiWL3J0wbdkgRd_MQlmXHxxY,curated,""
ER,Eritrea,Mosob,"339 Harrow Rd, London",W9 3RB,ChIJMR9KxxoQdkgRi2UM1BG9bqU,curated,"Long-established, family-run"
ER,Eritrea,Merhaba Restaurant & Bar,"5-7 Vining St, London",SW9 8QA,ChIJx2Cl4GkFdkgRQINRJfizRpM,flagged,"Listed as Ethiopian; reviewers describe Eritrean food; recent opening"
SN,Senegal,Little Baobab,"66-68 Great Suffolk St, London",SE1 0BL,ChIJZ4dhp2YFdkgR6QhcaekqOfA,curated,"Inside the Africa Centre"
SO,Somalia,Sabiib (Harringay),"5-6 Grand Parade, Green Lanes, London",N4 1JX,ChIJ59NWEA0bdkgRC-tA0wIulA4,curated,""
SO,Somalia,Sabiib (Acton),"139 High St, London",W3 6LX,ChIJvYi9nOoPdkgRuXpEniYL7Yg,curated,""
ZA,South Africa,High Timber,"8 High Timber St, London",EC4V 3PA,ChIJ96ezSaoEdkgRYACW4QGP4LY,flagged,"Steakhouse with South African owners, own Stellenbosch wines, biltong and malva pudding; borderline on specialist rule"
MU,Mauritius,Devi Deluxe,"147 Green Lanes, London",N13 4SP,ChIJeS0oVZsZdkgRz-WreL1oe8E,curated,""
MU,Mauritius,Dhall Puri Factory,"595 High Rd Leyton, London",E10 6PY,ChIJk6UBdI8ddkgRXs3RLmTAh1s,flagged,"Recent reviews mixed since reopening"
JM,Jamaica,Ma Petite Jamaica (Shoreditch),"130-132 Curtain Rd, London",EC2A 3AR,ChIJY85l2MQddkgRxvDe2ZNBNPQ,curated,""
JM,Jamaica,Ma Petite Jamaica (Camden),"4 Inverness St, London",NW1 7HJ,ChIJsSGoo-EadkgRuw3X2EzVkC0,curated,""
TT,Trinidad and Tobago,Trini Vibez,"485 Kingsland Rd, London",E8 4AU,ChIJAe8UjEgddkgRnfKArH2IRXE,curated,"Mostly takeaway; doubles"
PE,Peru,MAKA Peruvian Cuisine,"62 Brixton Rd, London",SW9 6BS,ChIJWXUFFQAFdkgRv0y5F7TAgaY,curated,""
PE,Peru,Señor Ceviche (Soho),"Kingly Ct, Carnaby, London",W1B 5PW,ChIJBS3jB9UEdkgRVZR_jxtt_WE,curated,"Peruvian with Nikkei dishes"
VE,Venezuela,Papelón,"171 Ladbroke Grove, London",W10 6HJ,ChIJo0OzfUsRdkgRCRvB3KmMwfQ,curated,"Cachapas"
VE,Venezuela,Arepa & Co (Haggerston),"58A De Beauvoir Cres, London",N1 5TZ,ChIJbfH7y5ccdkgRzc6uwoS5qLE,curated,""
CO,Colombia,El Rancho De Lalo,"1 Buckner Rd, London",SW2 5BY,ChIJq_jCq2gEdkgRs_DxcY1rzfc,curated,""
AR,Argentina,Buen Ayre,"50 Broadway Market, London",E8 4QJ,ChIJuTXOzOkcdkgR3wrWzQYTMF8,curated,"Parrilla"
AR,Argentina,La Patagonia,"31 Camden High St, London",NW1 7JE,ChIJra4hIyAbdkgRL1Hm68uICC0,curated,""
MX,Mexico,Fonda,"12 Heddon St, London",W1B 4BZ,ChIJz5cqMpsFdkgRhFTxy5uq87w,curated,""
MX,Mexico,Mestizo,"103 Hampstead Rd, London",NW1 3EL,ChIJL4h3pScbdkgR-k0QZ7xnYy8,curated,""
GE,Georgia,Ikhaltos Valley,"70 Stoke Newington High St, London",N16 7PA,ChIJ-_BtMloddkgRsH830J87OYg,curated,"Family-run"
GE,Georgia,Qarva,"23 Kensington Church St, London",W8 4LF,ChIJA94cixAPdkgRS70tR9F7iqs,curated,""
AM,Armenia,Jakobs,"20 Gloucester Rd, London",SW7 4RB,ChIJL2NLy14FdkgR8aAVCyq2DxM,flagged,"Armenian-run café with a broader Mediterranean/Persian menu"
AZ,Azerbaijan,Land of Fire,"95 Caledonian Rd, London",N1 9BT,ChIJB0h73UcbdkgRnGcVVmXz5x4,curated,""
UZ,Uzbekistan,Uzbek Corner,"2 Central Parade, Streatham High Rd, London",SW16 1HT,ChIJ2aYbjVUFdkgRkeP7FsawL90,flagged,"Listing says Streatham but several reviews describe a Queensway site; verify location"
UZ,Uzbekistan,Oshpaz (Regent Street),"7 Regent Street St James's, London",SW1Y 4LR,ChIJ1UJ97-IFdkgRYfMS2HnzoN0,curated,""
UZ,Uzbekistan,Marokand,"431 Roman Rd, London",E3 5LX,ChIJLZTUIAYddkgRNLDUOIjPwNQ,curated,""
MM,Myanmar,Lahpet (Covent Garden),"21 Slingsby Pl, London",WC2E 9AB,ChIJk7lTkwEFdkgRoBblIAt48gc,curated,""
MM,Myanmar,Lahpet Larder (London Bridge),"39-45 Bermondsey St, London",SE1 3XF,ChIJTUfROQADdkgRwbJ1TS-LpeI,curated,""
PH,Philippines,Kasa and Kin,"52-53 Poland St, London",W1F 7NQ,ChIJFXPozbkFdkgRDXyH1C-H_gM,curated,""
PH,Philippines,Donia,"Kingly Ct, Carnaby St, London",W1B 5PW,ChIJTUoBsQAFdkgRNfxmFv7zQIU,curated,"Modern Filipino"
PH,Philippines,Inihaw (Charlton),"3 The Village, London",SE7 8UG,ChIJYX6VWw2p2EcRd2u86WxPL00,curated,"Home-style"
MY,Malaysia,Malay Fellas,"82 Queensway, London",W2 3RL,ChIJV4m-mNEbdkgRjyL4V36k7DI,curated,""
MY,Malaysia,Padi@London,"62 Kensington High St, London",W8 4PE,ChIJcz2JtlcPdkgRljlSydMuVA0,curated,"Malay; nasi ambeng"
LK,Sri Lanka,Hoppers (Soho),"49 Frith St, London",W1D 4SG,ChIJr0tb59IEdkgRv-YdFGtD1CA,curated,"Some South Indian dishes; curated as Sri Lankan"
LK,Sri Lanka,The Coconut Island (Angel),"9 White Lion St, London",N1 9PD,ChIJLypnHAAbdkgRZ_SV0s90HNI,curated,""
NP,Nepal,Taste of Nepal (Blackfriars Rd),"200 Blackfriars Rd, London",SE1 8NN,ChIJI1ccWDEFdkgRZFjl8x8N2mY,curated,"Casual counter; purely Nepali menu; postcode terminated 2023 — confirm current postcode"
LA,Laos,Lao Café,"60 Chandos Pl, London",WC2N 4HG,ChIJ6fyXI8wEdkgRhTjBNfU77j0,curated,"Categorised as Thai on Google; menu is Lao; only known Lao specialist"
KH,Cambodia,Heng Heng,"59 Sheen Rd, Richmond",TW9 1YJ,ChIJ4cTxqcENdkgRwJLIGT1sIao,flagged,"Thai and Khmer menu in a pub; only known Khmer kitchen; curator exception to the specialist rule"
TW,Taiwan,BAO (Soho),"53 Lexington St, London",W1F 9AS,ChIJxc4vk9QEdkgRjJ2al7_P9uw,curated,""
TW,Taiwan,Din Tai Fung (Centre Point),"11 St Giles Square, London",WC2H 8AP,ChIJE3meifgbdkgRrICKCH8s9eU,curated,"Taiwanese chain"
VN,Vietnam,Sông Quê Café,"134 Kingsland Rd, London",E2 8DY,ChIJybk4BLwcdkgRlNpyGIPk3n4,curated,""
VN,Vietnam,Bếp House,"97 Kingsland Rd, London",E2 8AG,ChIJdw7vF3QddkgRgY8kLi_ewPU,curated,""
PL,Poland,Miód Malina,"315 Horn Ln, London",W3 0BU,ChIJj_ba6eMRdkgRCcGYEmMZWP0,curated,""
PL,Poland,Ognisko,"55 Exhibition Rd, London",SW7 2PG,ChIJP1Z1gkQFdkgRsyjCnpNoYsM,curated,""
HU,Hungary,TRIOBITE,"625 High Rd Leyton, London",E10 6RF,ChIJc-RIaEgddkgRI8oEQz-Z30w,curated,""
HU,Hungary,Lakehouse Hungarian Restaurant,"83 High Rd, London",E18 2QP,ChIJH2Cygu2n2EcRuf6E6M7UOQM,curated,""
RO,Romania,Noroc,"149 Green Lanes, London",N13 4SP,ChIJ1-9c-kQZdkgRDoWgMKUAQRk,curated,""
RO,Romania,La Papy,"459 High Rd Leyton, London",E10 5EL,ChIJTw7K46gddkgRT7Xa27B0LG4,flagged,"Romanian-run; seafood-led menu"
UA,Ukraine,Tatar Bunar,"152 Curtain Rd, London",EC2A 3AT,ChIJfxYFtJQddkgRbSUI_OpCweg,curated,""
UA,Ukraine,Ole Kyiv (Old Street),"145 City Rd, London",EC1V 1LP,ChIJKyRpg3AddkgReK0URWxu9Ws,curated,"Postcode terminated 2015 — confirm current postcode"
PT,Portugal,Luso,"30 Charlotte St, London",W1T 2NG,ChIJc7bMMVUbdkgRuiK_2aHFMrg,curated,""
PT,Portugal,Casa do Frango (Southwark),"32 Southwark St, London",SE1 1TU,ChIJfY7AT_UDdkgRF2ch8sfQVJg,curated,""
SE,Sweden,Ekstedt at The Yard,"3-5 Great Scotland Yard, London",SW1A 2HN,ChIJL-HmB88EdkgRfH-wI_8ELLQ,curated,"Open-fire tasting menu; expensive; reportedly the only Swedish restaurant in London"
AF,Afghanistan,Marhaba Kabul,"301 North End Rd, London",W14 9NS,ChIJW5YvVq8PdkgRwHuuiE2aM1g,curated,""
AF,Afghanistan,Afghan Eats,"134 Brick Ln, London",E1 6RU,ChIJ8ZRBBqUddkgR59d1iwiSaRg,curated,""
YE,Yemen,Diwan Al Yemen,"228 Edgware Rd, London",W2 1DW,ChIJZx0XOT8bdkgRYDV-yOhgsag,curated,"Floor seating; mandi"
YE,Yemen,Yemen Land,"69 Edgware Rd, London",W2 2HZ,ChIJs2BdIy8bdkgRWO3CIVKH55M,curated,""
PS,Palestine,Akub,"27 Uxbridge St, London",W8 7TQ,ChIJATbscqsPdkgRCYAYH3uom80,curated,""
PS,Palestine,Taste of Palestine,"27 The Market, Sutton",SM5 1AG,ChIJOR4jMVEJdkgRBcBq_erWOqg,curated,"Rose Hill, Sutton"
IQ,Iraq,Al Sulaymaniyah,"360 Edgware Rd, London",W2 1EB,ChIJgW7FLwAbdkgRE_AtF40Jlso,curated,"Iraqi/Kurdish"
IQ,Iraq,Samad Al Iraqi,"284-286 Kensington High St, London",W14 8NZ,ChIJaZH9XqoPdkgRZ5zU0EKcRNY,curated,"Traditional fish dish must be pre-ordered"
GH,Ghana,Asafo,"60 Morrish Rd, London",SW2 4EG,ChIJ2deO3jsEdkgRXrENACPYeCo,flagged,"Main standalone Ghanaian; reviews genuinely mixed; better option wanted"
BR,Brazil,Fogo de Chão (Soho),"17 Wardour St, London",W1D 6PJ,ChIJSygJ478FdkgRWqGGRTqVUTg,flagged,"Brazilian-origin churrascaria chain; no strong independent found yet"
ID,Indonesia,Bali Bali,"150 Shaftesbury Ave, London",WC2H 8HL,ChIJuzVKQs0EdkgRdmnylm7yjiw,flagged,"Reviewers say toned down; a reviewer recommends Warung Nusantara (unverified lead, not seeded)"
```

---

## 10. Milestones (each ends with passing tests and a short demo note)

1. Schema, RLS policies and RLS tests; seed script with postcodes.io geocoding.
2. Auth, profiles, groups and invite links; backfill flow.
3. Passport, country page, restaurant page, London map.
4. Check-in flow: server-side geo verification, EXIF stripping, co-diner confirmation, daily cap.
5. Scoring functions and view, stamp creation, leaderboard, feed. Unit tests must cover: rarity frozen at stamp time; table bonus threshold; set activation (≥2 listed) and completion; daily cap boundary at midnight Europe/London; backfilled stamps getting base points only; a declined attendee getting no stamp.
6. Gaps view and dinner planner.
7. Curator console.

---

## 11. Open decisions — ask me before building these

1. **Name.** "Eat the World — London" is a placeholder.
2. **Hosting.** Default Vercel + Supabase. My usual stack is AWS; if you think that's materially better here, say why before switching.
3. **Daily cap value.** Default 3.
4. **Submissions.** Default: any group member can submit a restaurant; only the curator approves.

---

## 12. Out of scope for v1

Public profiles or discovery, native apps, cities other than London (but the schema must support them), Google Places API calls, push notifications, payments, reservations.

## 13. Definition of done

A new user can open an invite link on their phone, sign in, backfill past countries, see their passport with an honest denominator, check in at a seeded restaurant with a co-diner, watch both stamps appear with the correct points breakdown, and see the group leaderboard update — with no raw location stored anywhere and RLS tests green.
