# Eat the World Solo: design

Status: draft for approval, 2026-10-21. Next step is the implementation plan (`docs/superpowers/plans/2026-10-21-solo-mode.md`).

## Intent

Andrew wants to log where he has eaten on his own Android phone, with no backend to run, no account, and no way for a bill to arrive. The group game (Next.js on Vercel, Supabase) stays as it is. Solo is a second, much smaller build of the same idea: one person, one device, the country passport.

## Goals

- An installable app for Android Chrome ("Add to Home screen") that opens offline once it has loaded. Only the map tiles need a connection.
- The country passport: each country eaten is a stamp. A visit can be logged for any restaurant anywhere, and the visitor picks its country.
- Zero running cost and zero upkeep: static files on a free host. No database, functions, cron, auth, SMTP or keepalive.
- Data lives on the device. A one-tap export and import of a backup file, because losing the phone or clearing Chrome's data would otherwise lose everything.
- Reuse the look and the pure logic of the existing app. Solo must not fork scoring, country, geo or time code.

## Non-goals

Groups, accounts, sync between devices, points and bonuses, sets, the daily stamp cap, leaderboard, plans and RSVPs, reactions, flags, the curator tools, restaurant submissions, closure reports, the recap share card (a later canvas version is possible), an APK or Play Store listing, offline map tiles (the OSM tile policy forbids prefetching them), iOS polish.

## Anti-goals

Solo fails even if it works when any of these is true:

- It can bill: any paid tier, any card, any metered service.
- It can lose data without warning: export and import must round-trip every field, and the app must ask the browser for persistent storage.
- It phones home: no analytics and no third-party calls except OpenStreetMap tiles (as in the group app). No geocoding service is called at runtime.
- It drifts into a fork: logic shared with the group app is imported from `src/`, not copied.

## What the user decided

- The country passport, not a plain restaurant diary.
- Android, for Andrew alone.
- The defaults offered: log any restaurant anywhere, the user picks its country and that becomes the stamp; points, sets and the cap are left out.

## What the builder decides, and my calls

These are my choices, made so the plan could be written. Change any of them before approval.

1. **Installable web app, not an APK.** It installs from Chrome with no tooling, no signing and no store. A Capacitor APK can wrap the same build later.
2. **A separate Vite + React + Tailwind 4 app in `solo/`**, importing from `src/` through the existing `@` alias. A static export of the Next app is not possible: its pages are server components that query Supabase. Three small shims stand in for `next/link`, `next/navigation` and `next/dynamic`, so the existing presentational components (`Stamp`, `Flag`, `FlagGrid`, `WorldMap`, the map pins, the photo resizer in `src/lib/photos.ts`) are reused unchanged. One `package.json` and one lockfile, so there is one copy of React.
3. **Hash routing** (`#/country/FR`), so any static host serves it with no rewrite rules.
4. **Storage is IndexedDB** through `idb`. Stores: `settings`, `restaurants` (those the user added), `visits`, `backfills`, `photos` (JPEG blobs, already resized and stripped of EXIF by the existing client code). A stamp is derived, never stored: the earliest visit to a country, or a backfill if there is no visit. Choosing a London suggestion copies it into `restaurants`, so visits only ever reference that store.
5. **Seed data is bundled as JSON.** A script turns `seed/*.csv` into `solo/src/data/seed.json`: 249 countries, 68 London restaurants in 39 countries, 140 dishes. Coordinates come from postcodes.io once, at generation time, and the JSON is committed. The London restaurants are suggestions ("where next"), not a rulebook. The specialist rule is shown as a hint when picking a country and is not enforced.
6. **Offline through a service worker** (`vite-plugin-pwa`) that precaches the app shell, the seed, the world map (`countries-50m`, 756 KB) and self-hosted fonts. It never caches OSM tiles. This is a deliberate exception to the brief's "no service worker in v1", and applies to solo only.
7. **Fonts are self-hosted** (`@fontsource` packages for Fraunces, DM Sans and DM Mono). The group app loads them through `next/font`, which solo cannot use.
8. **Screens:** Passport (home), Map, World, Country, Restaurant, Check-in (find or add a restaurant, optional "I'm here" GPS for a new restaurant's pin, visit date (today by default, or earlier, because a diary is often written afterwards), dish, 1–5 rating, note, optional photo, then the stamp moment with ink animation and haptics), a visit page to edit or delete a visit (stamps follow, because they are derived), Backfill, Settings (export, import, storage status, delete everything). Headline: "N / 249 countries", with "N / 39 London suggestions" underneath.
9. **Backup:** export is a versioned JSON file, shared through the Android share sheet (`navigator.share` with a file) or downloaded. Photos are a separate checkbox because they make the file large. Import validates the version, shows what it will add or replace, and asks before replacing. A quiet banner after 10 new visits or 30 days since the last export suggests a backup.
10. **Hosting: GitHub Pages (free), deployed by a GitHub Actions workflow** on pushes to `main`. Andrew is making the repo public, which is what makes Pages free (Pages on a private repo needs a paid plan). The app lives at `https://andrewjpage.github.io/eat-the-world/`, so the build uses relative asset paths (`base: "./"`) and hash routing needs no rewrite rules. Pages cannot set response headers, so the page carries `<meta name="robots" content="noindex, nofollow">` instead of `X-Robots-Tag`. A second Vercel project is out because the repo-root `vercel.json` registers the keepalive cron for every project that deploys it. Cloudflare Pages (deployed by hand with `wrangler pages deploy`) is the fallback if the repo stays private.
11. **Tests and CI:** Vitest with `fake-indexeddb` for storage, stamp derivation and the export/import round trip; Playwright at 390×844 for the offline check-in path. A new `solo` job in `ci.yml` runs lint, typecheck, unit tests, build and the Playwright test, so it never depends on the Supabase stack.

## What stays open for the setup

Andrew makes the repo public, sets Settings > Pages > Source to "GitHub Actions", and installs the app on the phone. `docs/solo.md` gives the steps, and a check to do before making the repo public: the weekly `backup.yml` workflow uploads a Supabase data dump as a workflow artifact, and on a public repo anyone with a GitHub account can download artifacts. Nothing else is outstanding.

## Constraints from the existing repo

- The Next.js here has breaking changes: read `node_modules/next/dist/docs/` before touching any Next code. Solo adds no Next code.
- Commit as andrewjpage@gmail.com. The remote is `andrewjpage/eat-the-world` (personal account).
- Subscription models only. Ask before adding anything that costs money.
- The group app keeps working: its tests and CI jobs must pass unchanged.
