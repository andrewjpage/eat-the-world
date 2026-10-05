/**
 * DEV-ONLY demo dataset on top of the seed: 5 users, 2 groups, ~6 weeks of dinners.
 * All history goes through the real Postgres functions as each user, with the clock
 * set per step (app.now). Stamps are never inserted directly.
 *
 * Usage: npm run dev:fixtures [-- --reset]
 *   (no flag)  skip if the "Supper Club" demo group exists
 *   --reset    delete only the demo users and their data, then rebuild
 */
import { existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { serverRealtimeOptions } from "../src/lib/supabase/node-realtime";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const LOCAL = /^(127\.0\.0\.1|localhost|\[?::1\]?)$/;
function assertLocal(label: string, value: string | undefined): string {
  if (!value) throw new Error(`${label} is not set`);
  const host = new URL(value).hostname;
  if (!LOCAL.test(host)) throw new Error(`Refusing to run: ${label} host "${host}" is not localhost/127.0.0.1`);
  return value;
}

const SUPABASE_URL = assertLocal("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
const DB_URL = assertLocal("SUPABASE_DB_URL", process.env.SUPABASE_DB_URL);
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");

const RESET = process.argv.includes("--reset");

const PEOPLE = [
  { key: "andrew", email: "andrew@demo.local", name: "Andrew" },
  { key: "bea", email: "bea@demo.local", name: "Bea" },
  { key: "chidi", email: "chidi@demo.local", name: "Chidi" },
  { key: "dana", email: "dana@demo.local", name: "Dana" },
  { key: "eli", email: "eli@demo.local", name: "Eli" },
] as const;
type Key = (typeof PEOPLE)[number]["key"];

const BACKFILL = ["ES", "FR", "IT", "TR", "CN", "IN"];

interface Visit {
  at: string; // London local ISO with offset
  rest: string; // restaurant name, exactly as seeded
  group: "Supper Club" | "Work Lunch";
  by: Key;
  geo: boolean; // creator passes the restaurant's own coordinates (geo_verified)
  guests: { who: Key; rating?: number; note?: string; other?: string; skipConfirm?: boolean }[];
  rating: number;
  note?: string;
  react?: [Key, "clap" | "drool" | "side_eye"][];
}

const VISITS: Visit[] = [
  { at: "2026-08-27T19:30:00+01:00", rest: "Lao Café", group: "Supper Club", by: "andrew", geo: true, rating: 5, note: "Sticky rice rescue mission. Worth the queue.",
    guests: [{ who: "bea", rating: 4 }, { who: "chidi", rating: 5, note: "The jeow bong is dangerous." }, { who: "dana", rating: 4 }] },
  { at: "2026-09-03T19:00:00+01:00", rest: "Zeret Kitchen", group: "Supper Club", by: "bea", geo: true, rating: 5, note: "Injera for the table, hands only.",
    guests: [{ who: "andrew", rating: 5 }, { who: "chidi", rating: 4 }, { who: "eli", rating: 5, note: "Doro wat, no notes." }] },
  { at: "2026-09-08T20:00:00+01:00", rest: "Akub", group: "Supper Club", by: "chidi", geo: false, rating: 3, note: "Lovely room, mains a bit shy.",
    guests: [{ who: "andrew", rating: 4 }, { who: "dana", rating: 3 }],
    react: [["dana", "side_eye"], ["andrew", "clap"]] },
  { at: "2026-09-12T19:30:00+01:00", rest: "Sabiib (Acton)", group: "Supper Club", by: "dana", geo: true, rating: 4, note: "Suqaar and a lot of banana.",
    guests: [{ who: "andrew", rating: 4 }, { who: "bea", rating: 5 }, { who: "eli", rating: 4 }] },
  { at: "2026-09-17T19:00:00+01:00", rest: "Land of Fire", group: "Supper Club", by: "andrew", geo: false, rating: 4, note: "Saj on the table. Pomegranate everything.",
    guests: [{ who: "bea", rating: 4 }, { who: "chidi", rating: 5 }] },
  { at: "2026-09-24T19:30:00+01:00", rest: "Fonda", group: "Supper Club", by: "eli", geo: true, rating: 4, note: "Eli's birthday. Mezcal happened.",
    guests: [{ who: "andrew", rating: 4 }, { who: "bea", rating: 5 }, { who: "chidi", rating: 4 }, { who: "dana", rating: 5 }],
    react: [["bea", "drool"]] },
  { at: "2026-09-27T18:30:00+01:00", rest: "Mosob", group: "Supper Club", by: "bea", geo: true, rating: 5, note: "Horn of Africa, done. Zigni all round.",
    guests: [{ who: "andrew", rating: 5 }, { who: "dana", rating: 4, other: "Shiro with extra injera" }],
    react: [["andrew", "clap"], ["dana", "drool"], ["chidi", "clap"]] },
  { at: "2026-10-01T19:00:00+01:00", rest: "BAO (Soho)", group: "Supper Club", by: "chidi", geo: true, rating: 4, note: "Fried chicken bao, then a second round.",
    guests: [{ who: "andrew", rating: 4 }, { who: "eli", rating: 4 }] },
  // Bea tags everyone; Andrew is left pending (still inside the 7-day window).
  { at: "2026-10-02T19:30:00+01:00", rest: "Lahpet (Covent Garden)", group: "Supper Club", by: "bea", geo: true, rating: 5, note: "Tea leaf salad crunch is unreal.",
    guests: [{ who: "andrew", skipConfirm: true }, { who: "chidi", rating: 4 }, { who: "dana", rating: 5 }, { who: "eli", rating: 4 }],
    react: [["eli", "clap"]] },
  // Four new countries in one London day for Eli: the fourth stamp waits (daily cap 3).
  { at: "2026-10-04T12:00:00+01:00", rest: "Lao Café", group: "Work Lunch", by: "eli", geo: false, rating: 4, note: "Lunch run 1.", guests: [{ who: "andrew", rating: 4 }] },
  { at: "2026-10-04T13:30:00+01:00", rest: "Akub", group: "Work Lunch", by: "eli", geo: false, rating: 3, note: "Lunch run 2.", guests: [{ who: "andrew", rating: 3 }] },
  { at: "2026-10-04T15:00:00+01:00", rest: "Land of Fire", group: "Work Lunch", by: "eli", geo: true, rating: 4, note: "Lunch run 3.", guests: [{ who: "andrew", rating: 4 }] },
  { at: "2026-10-04T17:00:00+01:00", rest: "Mosob", group: "Work Lunch", by: "eli", geo: false, rating: 5, note: "Lunch run 4: this stamp waits until tomorrow.", guests: [{ who: "andrew", rating: 5 }] },
];

const FUTURE_PLAN = {
  rest: "Sabiib (Harringay)",
  at: "2026-10-12T19:30:00+01:00",
  rsvps: { andrew: "yes", bea: "yes", chidi: "maybe", dana: "no" } as Record<string, string>,
};

async function main() {
  const admin = createClient(SUPABASE_URL, KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: serverRealtimeOptions(),
  });
  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();

  try {
    const ids = {} as Record<Key, string>;
    const existing = new Map<string, string>();
    for (let page = 1; ; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw error;
      for (const u of data.users) if (u.email) existing.set(u.email, u.id);
      if (data.users.length < 200) break;
    }
    for (const p of PEOPLE) if (existing.has(p.email)) ids[p.key] = existing.get(p.email)!;

    if (RESET) {
      const demoIds = Object.values(ids);
      if (demoIds.length) {
        // Groups cascade to members, visits, attendees, reactions, plans, RSVPs.
        await db.query(
          "delete from public.groups where name in ('Supper Club','Work Lunch') and (owner_id = any($1) or owner_id is null)",
          [demoIds],
        );
        await db.query("delete from public.visits where created_by = any($1)", [demoIds]);
        for (const id of demoIds) {
          const { error } = await admin.auth.admin.deleteUser(id);
          if (error) throw error;
        }
      }
      for (const p of PEOPLE) delete (ids as Partial<Record<Key, string>>)[p.key];
      console.log(`Reset: removed ${demoIds.length} demo users and their data.`);
    } else if (ids.andrew) {
      const { rows } = await db.query(
        "select 1 from public.groups where name = 'Supper Club' and owner_id = $1",
        [ids.andrew],
      );
      if (rows.length) {
        console.log("Demo group 'Supper Club' already exists; nothing to do (use --reset to rebuild).");
        await summary(db, ids);
        return;
      }
    }

    for (const p of PEOPLE) {
      if (ids[p.key]) continue;
      const { data, error } = await admin.auth.admin.createUser({
        email: p.email,
        email_confirm: true,
        user_metadata: { full_name: p.name },
      });
      if (error) throw error;
      ids[p.key] = data.user.id;
    }
    for (const p of PEOPLE) {
      await db.query("update public.profiles set display_name = $2 where user_id = $1", [ids[p.key], p.name]);
    }
    await db.query("update public.profiles set is_curator = true where user_id = $1", [ids.andrew]);

    /** One transaction per step, as the given user, with the clock pinned. */
    async function step<T = unknown>(who: Key, at: string, sql: string, params: unknown[] = []): Promise<T> {
      await db.query("begin");
      try {
        await db.query("select set_config('app.now', $1, true)", [new Date(at).toISOString()]);
        await db.query("set local role authenticated");
        await db.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ sub: ids[who], role: "authenticated" }),
        ]);
        const res = await db.query(sql, params);
        await db.query("commit");
        return res.rows[0] as T;
      } catch (e) {
        await db.query("rollback");
        throw e;
      }
    }
    const plusHours = (at: string, h: number) => new Date(new Date(at).getTime() + h * 3600_000).toISOString();

    const restRows = (await db.query("select id, name, lat, lon, country_iso2 from public.restaurants")).rows;
    const restByName = new Map<string, { id: string; lat: number; lon: number; country_iso2: string }>(
      restRows.map((r) => [r.name, r]),
    );
    const dishRows = (
      await db.query("select id, country_iso2 from public.signature_dishes where status = 'approved' order by country_iso2, name")
    ).rows;
    const dishesBy = new Map<string, string[]>();
    for (const d of dishRows) dishesBy.set(d.country_iso2, [...(dishesBy.get(d.country_iso2) ?? []), d.id]);
    let dishCounter = 0;
    const pickDish = (iso: string) => {
      const list = dishesBy.get(iso) ?? [];
      return list.length ? list[dishCounter++ % list.length] : null;
    };

    const groupId = {} as Record<string, string>;
    const invite = {} as Record<string, string>;
    for (const name of ["Supper Club", "Work Lunch"]) {
      const r = await step<{ id: string }>("andrew", "2026-08-20T10:00:00+01:00", "select public.create_group($1) as id", [name]);
      groupId[name] = r.id;
      invite[name] = (await db.query("select invite_code from public.groups where id = $1", [r.id])).rows[0].invite_code;
    }
    for (const k of ["bea", "chidi", "dana", "eli"] as Key[]) {
      await step(k, "2026-08-20T11:00:00+01:00", "select public.join_group($1)", [invite["Supper Club"]]);
    }
    await step("eli", "2026-08-20T12:00:00+01:00", "select public.join_group($1)", [invite["Work Lunch"]]);

    for (const p of PEOPLE) {
      await step(p.key, "2026-08-20T13:00:00+01:00", "select public.backfill_countries($1::text[])", [BACKFILL]);
    }

    for (const v of VISITS) {
      const rest = restByName.get(v.rest);
      if (!rest) throw new Error(`Seeded restaurant not found: ${v.rest}`);
      await step(
        v.by,
        v.at,
        "select public.check_in($1,$2,$3,$4,$5,$6::uuid[],$7,$8,$9::smallint,$10) as r",
        [
          rest.id, groupId[v.group],
          v.geo ? rest.lat : null, v.geo ? rest.lon : null, v.geo ? 15 : null,
          v.guests.map((g) => ids[g.who]), pickDish(rest.country_iso2), null, v.rating, v.note ?? null,
        ],
      );
      const visitId = (
        await db.query("select id from public.visits where restaurant_id = $1 and group_id = $2 and visited_at = $3", [
          rest.id, groupId[v.group], new Date(v.at).toISOString(),
        ])
      ).rows[0].id as string;

      let i = 1;
      for (const g of v.guests) {
        if (g.skipConfirm) continue;
        await step(g.who, plusHours(v.at, 1 + i++ * 0.25), "select public.confirm_attendance($1,$2,$3,$4::smallint,$5)", [
          visitId, g.other ? null : pickDish(rest.country_iso2), g.other ?? null, g.rating ?? null, g.note ?? null,
        ]);
      }
      for (const [who, emoji] of v.react ?? []) {
        await step(
          who,
          plusHours(v.at, 8),
          "insert into public.reactions (visit_id, user_id, emoji) values ($1, $2, $3::public.reaction_emoji)",
          [visitId, ids[who], emoji],
        );
      }
    }

    const planRest = restByName.get(FUTURE_PLAN.rest);
    if (!planRest) throw new Error(`Seeded restaurant not found: ${FUTURE_PLAN.rest}`);
    const plan = await step<{ id: string }>(
      "andrew",
      "2026-10-04T20:00:00+01:00",
      "insert into public.plans (group_id, restaurant_id, proposed_by, proposed_for, status) values ($1,$2,$3,$4,'proposed') returning id",
      [groupId["Supper Club"], planRest.id, ids.andrew, new Date(FUTURE_PLAN.at).toISOString()],
    );
    for (const [who, response] of Object.entries(FUTURE_PLAN.rsvps)) {
      await step(
        who as Key,
        "2026-10-04T21:00:00+01:00",
        "insert into public.plan_rsvps (plan_id, user_id, response) values ($1,$2,$3::public.rsvp_response)",
        [plan.id, ids[who as Key], response],
      );
    }
    await summary(db, ids);
  } finally {
    await db.end();
  }
}

async function summary(db: pg.Client, ids: Partial<Record<Key, string>>) {
  console.log("\nDemo users (sign in with an email code; see MAILPIT_URL):");
  for (const p of PEOPLE) console.log(`  ${p.email}  ${p.name}  ${ids[p.key] ?? "-"}`);
  const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;
  const demo = Object.values(ids);
  const visits = await q(
    `select g.name grp, count(*)::int visits from public.visits v join public.groups g on g.id = v.group_id
      where v.created_by = any($1) group by g.name order by 1`,
    [demo],
  );
  console.log("\nVisits:", visits.map((r) => `${r.grp}=${r.visits}`).join(", "));
  const pend = await q("select count(*)::int n from public.visit_attendees where status='pending' and user_id = any($1)", [demo]);
  const wait = await q("select count(*)::int n from public.visit_attendees where stamp_waiting and user_id = any($1)", [demo]);
  console.log(`Pending confirmations: ${pend[0].n}; waiting stamps: ${wait[0].n}`);
  console.log("\nStamps per user (visit-earned / backfilled):");
  for (const p of PEOPLE) {
    const r = await q(
      "select count(*) filter (where not backfilled)::int v, count(*) filter (where backfilled)::int b, coalesce(sum(base+rarity_bonus+table_bonus+dish_bonus),0)::int pts from public.stamps where user_id = $1",
      [ids[p.key]],
    );
    console.log(`  ${p.name.padEnd(7)} ${r[0].v} / ${r[0].b}  (${r[0].pts} pts)`);
  }
  const awards = await q(
    "select p.display_name n, s.name s from public.set_awards a join public.profiles p on p.user_id=a.user_id join public.sets s on s.id=a.set_id where a.user_id = any($1) order by 1",
    [demo],
  );
  console.log("Set awards:", awards.map((a) => `${a.n}: ${a.s}`).join("; ") || "none");
  const reacts = await q("select emoji, count(*)::int n from public.reactions group by 1 order by 1");
  console.log("Reactions:", reacts.map((r) => `${r.emoji}=${r.n}`).join(", "));
  const grp = await q("select id from public.groups where name='Supper Club' and owner_id = $1", [ids.andrew]);
  if (grp[0]) {
    await db.query("begin");
    try {
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: ids.andrew, role: "authenticated" }),
      ]);
      const lb = (
        await db.query("select display_name, countries, points from public.group_leaderboard($1, false) order by points desc", [grp[0].id])
      ).rows;
      console.log("\nSupper Club leaderboard:");
      for (const r of lb) console.log(`  ${String(r.display_name).padEnd(7)} ${r.countries} countries, ${r.points} pts`);
    } finally {
      await db.query("rollback");
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
