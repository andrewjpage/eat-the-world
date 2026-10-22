# Eat the World

A private, friends-only game: eat at a restaurant that specialises in each country's cuisine, collect passport stamps, and plan the next dinner together. It starts in London. Built with Next.js 16, Supabase and Tailwind.

- `eat-the-world-london-brief.md`: the build brief (the spec).
- `docs/architecture.md`: the binding contract (tables, functions, routes). `docs/design.md`: the design system.
- `docs/deploy.md`: the one-time account checklist and first deploy.
- `docs/solo.md`: Solo, the offline one-person build in `solo/` (commands, GitHub Pages setup, installing on Android).
- `seed/`: the fact-checked London restaurants, sets, signature dishes and the ISO country list. `docs/fact-check-2026-10-05.md` has the evidence.

## Local quickstart

Needs Node 20.19+ and Docker.

```bash
npm ci
npx supabase start        # local Postgres, Auth, Storage; emails at http://127.0.0.1:54324
npm run env:local         # writes .env.local from the running stack
npm run seed              # countries, London, restaurants, sets, dishes (insert-only)
npm run dev:fixtures      # demo users and groups (local only); andrew@demo.local is the curator
npm run dev                                   # http://localhost:3000
npm run dev:login -- andrew@demo.local --port 3000   # prints a one-click sign-in URL
```

The dev scripts refuse any Supabase target that is not localhost.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run lint` / `typecheck` | ESLint; `next typegen` + `tsc` |
| `npm test` | Vitest: unit tests, plus integration tests that run only against the local stack |
| `npm run test:db` | pgTAP database tests (`supabase test db`) |
| `npm run test:e2e` | Playwright at 390x844 |
| `npm run seed` | Insert-only seed. Never reset or reseed production |
| `npm run dev:fixtures` / `dev:login` | Local demo data and sign-in links |

CI (`.github/workflows/ci.yml`) runs all of the above. Other workflows: `keepalive.yml` (daily ping), `backup.yml` (weekly database dump), `db-push.yml` (migrations to production on merge to `main`).

## Deploying

See [docs/deploy.md](docs/deploy.md).

## Credits

- Country list: [lukes/ISO-3166-Countries-with-Regional-Codes](https://github.com/lukes/ISO-3166-Countries-with-Regional-Codes) v10.0, CC BY-SA 4.0 (see `seed/iso-3166-all.LICENSE.md`).
- Postcodes: [postcodes.io](https://postcodes.io). Contains Ordnance Survey, Royal Mail and National Statistics data, Crown and Royal Mail copyright and database right.
- Maps: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL), under the OSMF tile usage policy. If OSM ever blocks the app, MapTiler or Stadia Maps (free non-commercial tiers) are a one-line tile-URL swap.
- World map: [Natural Earth](https://www.naturalearthdata.com) (public domain) via [world-atlas](https://github.com/topojson/world-atlas) (ISC).
- Flags: [flag-icons](https://github.com/lipis/flag-icons) (MIT). Fonts: Fraunces, DM Sans, DM Mono (SIL OFL).

The same credits are in the app at `/credits`.
