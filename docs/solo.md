# Eat the World Solo

A separate build of the game for one person, in `solo/`. It runs from static files, works offline once loaded, and keeps every visit on the phone. It reuses components, tokens and the country list from `src/`, and nothing in it talks to the group app, Supabase or any account.

It is not a client of the group app: no sign-in, groups, friends, points, sets, daily cap or sync. The only network use is OpenStreetMap map tiles. There is no analytics and no geocoding at runtime (London coordinates were looked up once, by `npm run solo:seed`, and are committed in `solo/src/data/seed.json`).

## Commands

| Command | What it does |
|---|---|
| `npm run solo:dev` | Vite dev server. The service worker is registered in production builds only. |
| `npm run solo:build` | Production build into `solo/dist`. |
| `npm run solo:preview -- --base /eat-the-world/ --port 4173` | Serves the build as GitHub Pages will, at `http://localhost:4173/eat-the-world/`. |
| `npx vitest run tests/solo` | Unit tests. |
| `npm run test:solo-e2e` | Playwright at 390x844. Builds and serves the app itself, and rewrites the pictures in `docs/screens/solo/`. |
| `npm run solo:seed` | Regenerates `solo/src/data/seed.json` from `seed/` and postcodes.io (needs network). Commit the result. |

`.github/workflows/ci.yml` runs the unit tests and the Playwright suite in its `solo` job, and fails if the build mentions `supabase`.

## Publishing on GitHub Pages

The app lives at <https://andrewjpage.github.io/eat-the-world/>. `.github/workflows/solo-pages.yml` builds `solo/dist` and deploys it on every push to `main` that touches `solo/`, `src/`, `seed/` or the lockfile.

One-time setup:

1. Make the repository public (free GitHub accounts serve Pages only from public repositories). Work through the checklist below first.
2. Settings > Pages > Source: **GitHub Actions**.
3. Run the workflow once from the Actions tab (Solo on GitHub Pages > Run workflow), or merge a change to `main`.

Pages cannot set response headers, so the page carries `<meta name="robots" content="noindex, nofollow">` instead.

If the repository stays private, use Cloudflare Pages instead: connect the repository, set the build command to `npm ci && npm run solo:build`, the output directory to `solo/dist` and the environment variable `NODE_VERSION` to `22`. Every address in the build is relative, so it works at the root of a `pages.dev` address as well as under `/eat-the-world/`.

### Before making the repo public

- [ ] `.github/workflows/backup.yml` uploads a weekly `supabase db dump` (schema and data) as a workflow artifact kept for 90 days. In a public repository anyone signed in to GitHub can download it. Delete the existing `supabase-backup-*` artifacts (Actions > the workflow runs), and encrypt or remove the upload, before the switch.
- [ ] The code, the docs and the workflow logs become public. The history was scanned for obvious secrets (JWTs, `sb_secret_` keys, GitHub tokens, private keys, credentialed database URLs) and none were found, but a pattern match is not a guarantee. Rotate anything doubtful.

## Installing on Android

1. On Wi-Fi, open the address in Chrome and let the passport appear. The first visit downloads about 5.6 MiB, which the service worker keeps for offline use.
2. Chrome menu > **Add to Home screen** (or **Install app**), then open the app from its icon.
3. Confirm offline works: switch on airplane mode, close the app, open it from the icon. The passport, the world map, countries, restaurants and a new visit all work. The London map shows its pins but no map tiles, which come from OpenStreetMap and are never stored.

An update installs itself: the next time the app is opened with a connection, the new files replace the old ones and the visits are untouched.

## Keeping the data

The visits exist only in the browser's storage on that phone. Clearing Chrome's site data, uninstalling the app's browser, or losing the phone loses them.

- Settings > **Export backup** writes one JSON file (with photos unless you untick them). Send it somewhere off the phone: email it to yourself or save it to a drive.
- The passport shows a reminder after ten unsaved additions, or thirty days since the last backup.
- Settings > **Ask the browser to protect it** requests persistent storage, so Chrome does not clear the data when the phone runs short of space.
- A backup restores with Settings > **Import a backup**: **Merge** adds what is missing and keeps what is on the phone; **Replace everything** swaps all of it for the file.

## Phone checklist

Done by hand on a real phone, because a desktop browser cannot stand in for it:

- [ ] Airplane mode: the installed app opens and shows the passport, and a new visit saves.
- [ ] Log a visit, swipe the app away, open it again: the visit and its stamp are still there.
- [ ] Export a backup, open the app in a second browser profile, import it: the headline count and the stamps match.

## Known copies of shared components

Three solo components copy a shared one because the shared one cannot yet take the small differences (wording, links, no points line). Keep each in step with its original until optional props are added upstream.

| Solo | Mirrors |
|---|---|
| `solo/src/components/SoloMap.tsx` and `MapCards.tsx` | `src/components/map/LondonMap.tsx` |
| `solo/src/components/DishRating.tsx` | `src/components/checkin/DishRatingFields.tsx` |
