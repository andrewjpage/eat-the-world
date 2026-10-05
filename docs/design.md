# Design system

A passport, not a spreadsheet: warm paper, navy ink, red rubber stamps. If fun and polish conflict, choose fun. Design for one thumb at 390×844 first.

## Tokens (`src/app/globals.css`)

Use the Tailwind classes; never hard-code hex values in components. Every token has a dark-mode value (`prefers-color-scheme`).

| Token | Class examples | Use |
|---|---|---|
| `paper` / `paper-raised` / `paper-sunk` | `bg-paper`, `bg-paper-raised`, `bg-paper-sunk` | Page background / cards / inset panels |
| `line` | `border-line` | Hairlines and card borders |
| `ink` / `ink-soft` / `muted` | `text-ink`, `text-ink-soft`, `text-muted` | Headings and body / secondary copy / hints |
| `stamp-red` (+ `-soft`, `on-stamp-red`) | `bg-stamp-red text-on-stamp-red` | Primary actions, active tab, progress |
| `verified-teal` (+ `-soft`) | `text-verified-teal` | Verification only (geo/photo). Don't use teal for anything else |
| `gold` (+ `-soft`) | `text-gold` | Contested picks, stamp ink variety |

Fonts: `font-display` (Fraunces, headings, big numbers), `font-sans` (DM Sans, default body), `font-mono` (DM Mono, codes and stamp dates). Animations: `animate-stamp-in` (the stamp moment), `animate-sheet-up`, `animate-fade-in`, `animate-toast-in`; all respect reduced motion.

## The stamp language

`.stamp-ink` makes anything a stamp: dashed `currentColor` border, inner ring, speckled ink mask and a tilt from `--stamp-rotate`. Colour it with `text-*`. Use it for stamps, empty-state roundels and celebratory moments, not for ordinary cards. `stampStyle(iso2)` gives each country a stable tilt, ink and shape.

## Components

Import from `@/components/ui` (or the file directly).

- `Page` (phone column, 16px gutters) and `PageHeader` (kicker + display title). Full-bleed screens such as the map skip `Page`.
- `Button` / `ButtonLink`: `primary` (one per screen), `secondary`, `ghost`, `teal`, `danger`; `size="lg"` for the main action; `block` for full width; `loading`.
- `Card` (`perforated` for a passport-page edge, `tone="sunk"` for secondary panels) and `Eyebrow` (small caps label).
- `Badge` plus `ContestedBadge` (restaurants with `confidence = 'flagged'`; pass `curator_note`), `VerificationBadge` (`geo_verified` / `photo` / `self_reported`, `compact` for icon only) and `BackfilledBadge`.
- `Flag iso2="LA"`: flag-icons SVG (never emoji in the UI). Sizes `xs`–`xl`, `square`, or `size={null}` and a `text-*` class.
- `Stamp`: a square country stamp that fills its grid cell. `state`: `stamped`, `backfilled` (sepia "before the app"), `listed` (outline), `unlisted` (faint), `uncharted` (greyed). Pass `date`, `verification`, and `inking` for the stamp-in animation.
- `ProgressBar value max label tone`: e.g. "34 / 86 in London".
- `BottomSheet open onClose title footer`: confirm sheets, pickers. Put the primary action in `footer`.
- `EmptyState emoji title action`: every empty list gets one, with a next step.
- `useToast().toast(message, "success" | "error" | "info")`: short feedback. `ToastProvider` is in the root layout.
- `Avatar name src`: initials fallback; plain `<img>`, never `next/image`. Shows a photo only from Google or Supabase Storage (matches the `profiles_avatar_url` trigger).
- `Skeleton`, `PageSkeleton label`: for `loading.tsx`. Root `not-found.tsx` and `error.tsx` (with `retry()`) catch dead ends app-wide.

Nav (`src/components/nav`): `TopBar` and `BottomNav` are rendered by the root layout for signed-in users; pages don't add them. They hide on the prefixes in `CHROME_HIDDEN_PREFIXES` (`chrome.ts`). `main` already pads for the bottom nav; sticky footers sit at `bottom-[calc(4.5rem+env(safe-area-inset-bottom))]`.

## Auth helpers (`src/components/auth/session.ts`, server only)

`requireUser(returnTo)` (redirects to `/login?next=`), `getSessionUser()`, `getMyProfile()`, `friendlyError(error, fallback)` for showing SQL `raise exception` messages. `safeNext()`, `loginUrl()`, `redirectTo()`, `CHECK_IN_LIVE` and `APP_NAME` live in `src/lib/app.ts`. `safeNext()` is idempotent and never returns `//host`, so pass any user-supplied path through it before `redirect()` or `router.push()`. `CHECK_IN_LIVE` stays false until M3 ships `/check-in` and `/visit`; M3 flips it. Passport maths is the pure `summarisePassport()` in `src/lib/passport.ts`; region order (`REGION_ORDER`) is in `src/lib/countries.ts`. The proxy (`src/proxy.ts`) refreshes the session and redirects signed-out page visits; every page and server action must still check the user.

## Rules

- Copy is friendly and short; banter, never policing. Errors say what to do next.
- Links in long lists (the 249-flag grid) use `prefetch={false}`.
- Tap targets ≥ 44px; inputs use the `.input` class (16px text so iOS doesn't zoom).
- Respect `env(safe-area-inset-*)` on anything fixed.
- No raw coordinates in UI state that leaves the device, URLs or logs.
- Check both colour schemes before calling a screen done.
