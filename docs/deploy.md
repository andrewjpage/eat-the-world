# Deploying Eat the World

One-time account setup for Andrew, then the first deploy. Everything is on free tiers (Supabase Free, Vercel Hobby, Brevo free, GitHub Actions). Do the accounts in order: later steps need values from earlier ones.

Rules that stay true after launch:
- The dev scripts (`dev:fixtures`, `dev:login`) refuse non-localhost targets. Never point them at production.
- Never reset (`supabase db reset`) or reseed production. `npm run seed` is insert-only and is run once.
- Production schema changes only arrive as new migrations, through `db-push.yml`.

## 1. Supabase project

1. supabase.com > New project. Plan **Free**, region **West EU (London) / eu-west-2**. Choose a strong database password and store it in a password manager.
2. Project Settings > General: copy the **Project ref** (the `<ref>` in `https://<ref>.supabase.co`).
3. Project Settings > API: copy the **Project URL**, the **anon** key and the **service_role** key (secret: server only).
4. Project Settings > Database > Connection string > **URI**, with your password filled in. Use the session pooler string if the direct host is IPv6-only. This is `SUPABASE_DB_URL`.
5. Account > Access Tokens > generate one. This is `SUPABASE_ACCESS_TOKEN`.

## 2. Auth settings (Supabase dashboard > Authentication)

1. **URL Configuration**
   - Site URL: your production URL, e.g. `https://eat-the-world.vercel.app`.
   - Redirect URLs: `https://eat-the-world.vercel.app/**` and, for Vercel previews, `https://*-<your-vercel-username>.vercel.app/**`.
2. **Email templates** (Emails > Templates): paste the HTML of `supabase/templates/magic_link.html` into **Magic Link** and `supabase/templates/confirmation.html` into **Confirm signup**. Use the same subjects as `supabase/config.toml`.
3. **Brevo SMTP** (Supabase's built-in email only reaches organisation members, 2 an hour):
   1. brevo.com > sign up (free: 300 emails a day).
   2. Senders, Domains & Dedicated IPs > Senders > add one sender and verify it from the email Brevo sends. A gmail.com sender can land in spam; test delivery to Gmail and Outlook.
   3. SMTP & API > SMTP > **Generate a new SMTP key** and copy it.
   4. Supabase > Authentication > Emails > SMTP Settings > enable custom SMTP:
      - Host `smtp-relay.brevo.com`, port `587`
      - Username: the SMTP login shown in Brevo (not the API key)
      - Password: the SMTP key
      - Sender email: the verified sender; sender name `Eat the World`
4. Authentication > Rate Limits: raise **emails sent per hour** (custom SMTP lifts the 2 an hour cap; 30 is plenty for friends).
5. Authentication > Providers > **Email**: keep enabled, and keep "Confirm email" on.

## 3. Google sign-in

1. console.cloud.google.com > create a project (or reuse one) > APIs & Services > **OAuth consent screen** (Google Auth Platform > Branding/Audience).
   - User type **External**, app name `Eat the World`, your support and developer email.
   - Scopes: only the basic ones (`openid`, `email`, `profile`).
   - Audience > **Publish app** so the status is **In production**. Otherwise only listed test users can sign in. Basic scopes need no Google verification.
2. Credentials > Create credentials > **OAuth client ID** > Application type **Web application**.
   - Authorised redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`
   - Authorised JavaScript origins: the production URL.
   - Copy the client ID and client secret.
3. Supabase > Authentication > Providers > **Google** > enable, paste the client ID and secret, save.
4. Set `NEXT_PUBLIC_GOOGLE_AUTH=true` in Vercel (next section) and redeploy. It is read at build time.

## 4. Vercel project

1. vercel.com > Add New > Project > import the GitHub repo (a personal account's repo; the **Hobby** plan is for personal, non-commercial use, which this is). Framework preset: Next.js.
2. Settings > Environment Variables (Production, and Preview if you want previews to work). Set `NEXT_PUBLIC_APP_URL` for **Production only**: it is baked in at build time, and previews fall back to their own origin for invite, nudge and `.ics` links.

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key (never prefix with `NEXT_PUBLIC_`) |
   | `CRON_SECRET` | a long random string, e.g. `openssl rand -hex 32` |
   | `NEXT_PUBLIC_APP_URL` | production URL, no trailing slash |
   | `NEXT_PUBLIC_GOOGLE_AUTH` | `true` |

   Vercel Cron sends `Authorization: Bearer $CRON_SECRET` to `/api/keepalive` by itself (`vercel.json` schedules it daily at 04:23 UTC; Hobby allows one run a day).
3. Do not deploy yet: finish section 6 steps 1 to 3 first (the app needs the schema).

## 5. GitHub secrets

Repo > Settings > Secrets and variables > Actions > New repository secret:

| Secret | Value |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | from section 1 step 5 |
| `SUPABASE_DB_URL` | from section 1 step 4 |
| `SUPABASE_PROJECT_REF` | from section 1 step 2 |
| `APP_URL` | production URL, no trailing slash |
| `CRON_SECRET` | the same value as in Vercel |

Then Settings > Environments > New environment `production` > **Required reviewers**: add yourself. `db-push.yml` runs in that environment, so every production migration waits for your approval.

The workflows skip cleanly while a secret is missing. `keepalive.yml` pings the app daily at 03:17 UTC (a backup for the Vercel cron), `backup.yml` dumps schema and data weekly (kept 90 days as a workflow artifact; Supabase Free has no automatic backups), `db-push.yml` applies new `supabase/migrations/**` on merge to `main`. A free project pauses after a week of low activity (restorable for 90 days), which the keepalive prevents.

## 6. First deploy

1. **Schema.** From a checkout of `main`: `npx supabase db push --db-url "$SUPABASE_DB_URL"` (or run the `DB push` workflow from the Actions tab).
2. **Seed, once.** The service key is read from the environment and wins over `.env.local`:
   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service_role key> npm run seed
   ```
   Run it exactly once. It is insert-only, so a repeat inserts nothing, but never run a reset against production.
3. **Make yourself curator.** Sign in to the deployed app once so your profile exists, then in the Supabase SQL editor:
   ```sql
   update public.profiles set is_curator = true where user_id = (select id from auth.users where email = 'you@example.com');
   ```
   Groups are invite-only: only the curator, or someone already in a group, can start one. Create the first group after this step and share its invite link; everyone else comes in through an invite.
4. **Deploy** on Vercel (push to `main`, or Deployments > Redeploy).
5. **Log settings.** Coordinates reach Postgres only as bind parameters of `check_in`. In the SQL editor run:
   ```sql
   show log_min_duration_statement;
   show log_parameter_max_length;
   show log_parameter_max_length_on_error;
   ```
   Record the results in the M7 security review. If statements are logged with their parameters, ask Supabase support to turn parameter logging off for the project before friends start playing.
6. **Keepalive.** `curl -i -H "Authorization: Bearer <CRON_SECRET>" https://<app>/api/keepalive` returns `{"ok":true}`; without the header it returns 401.
7. **Definition-of-done run** (brief section 13), on a phone at the production URL: sign in with Google and with an email code; create a group (as the curator) and join it from a second account with the invite link; check in with and without location; confirm as a tagged friend. With two accounts expect 10 + 15 + 2 = 27 points each (rarity 15 for a one-restaurant country, plus the signature dish); the table bonus needs three confirmed, so to see the 32-point worked example tag two friends (three accounts) and have both confirm. Add a photo; open `/map` and `/world`; check `/privacy` and `/credits`; delete a test account from Settings and confirm the friends keep their stamps.
8. **Automated definition of done.** Run only this spec against production (the others need local fixtures):
   ```bash
   E2E_BASE_URL=https://<app> NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service_role key> npx playwright test tests/e2e/dod.spec.ts
   ```
   It creates two throwaway users with the service-role key (lending one the curator flag just long enough to start a group), runs brief section 13 at 390x844, and deletes both users through Settings, with a clean-up fallback if a step fails.
