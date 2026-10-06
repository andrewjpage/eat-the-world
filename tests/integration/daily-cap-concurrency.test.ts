import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { isLocalUrl, testCountryRows } from "../helpers/local-db";

// Concurrency proofs for confirm_attendance and check_in (brief sections 2, 4 and 5). Runs only
// against the local stack (SUPABASE_DB_URL on localhost, e.g. from .env.local) and skips
// otherwise: it commits rows. No coordinates are used.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const dbUrl = process.env.SUPABASE_DB_URL;
const local = isLocalUrl(dbUrl);
const NOW = "2026-07-15 12:00:00+01"; // fixed app.now for every connection
const COUNTRIES = ["NP", "MN", "BT", "FI", "IS", "NO", "SE", "DK"];

const userIds: string[] = [];
const cityIds: string[] = [];
let admin: Client;
let tag = "";

type Result = { visit_id: string; outcome: string };

async function connect(): Promise<Client> {
  const c = new Client({ connectionString: dbUrl });
  await c.connect();
  return c;
}

async function q<T>(c: Client, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await c.query(sql, params)).rows as T[];
}

const AS_USER_SQL = `select set_config('app.now', $2, true),
  set_config('request.jwt.claims', json_build_object('sub', $1::text,
    'role', 'authenticated', 'aud', 'authenticated')::text, true),
  set_config('request.jwt.claim.sub', $1::text, true),
  set_config('role', 'authenticated', true)`;

async function createUser(label: string): Promise<string> {
  const id = randomUUID();
  await admin.query(
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
       email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, '',
       now(), '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('full_name', $3::text), now(), now())`,
    [id, `conc-${tag}-${userIds.length}-${label}@test.local`, `Conc ${label}`],
  );
  userIds.push(id);
  return id;
}

async function createCity(): Promise<string> {
  const slug = `conc-${tag}-${cityIds.length}`;
  const [{ id }] = await q<{ id: string }>(
    admin,
    `insert into public.cities (name, slug) values ($1, $1) returning id`,
    [slug],
  );
  cityIds.push(id);
  for (const c of testCountryRows(COUNTRIES)) {
    await admin.query(
      `insert into public.countries (iso2, iso_numeric, name, iso_name) values ($1, $2, $3, $4)
       on conflict do nothing`,
      [c.iso2, c.iso_numeric, c.name, c.iso_name],
    );
  }
  for (const iso of COUNTRIES) {
    await admin.query(
      `insert into public.city_countries (city_id, country_iso2, status) values ($1, $2, 'unlisted')`,
      [id, iso],
    );
  }
  return id;
}

async function createRestaurant(cityId: string, iso: string, name: string): Promise<string> {
  const [{ id }] = await q<{ id: string }>(
    admin,
    `insert into public.restaurants (city_id, country_iso2, name, address, postcode, lat, lon,
       status, confidence)
     values ($1, $2, $3, $3 || ' Street', $4, 51.5074, -0.1278, 'active', 'curated') returning id`,
    [cityId, iso, name, `C${randomUUID().slice(0, 6).toUpperCase()}`],
  );
  return id;
}

// One committed transaction in which `who` runs `sql` (as role authenticated, app.now fixed).
async function asUserTx<T>(who: string, sql: string, params: unknown[]): Promise<T> {
  await admin.query("begin");
  try {
    await admin.query(AS_USER_SQL, [who, NOW]);
    const rows = await q<{ r: T }>(admin, sql, params);
    await admin.query("commit");
    return rows[0].r;
  } catch (e) {
    await admin.query("rollback");
    throw e;
  }
}

async function createGroup(owner: string, members: string[]): Promise<string> {
  // Groups are invite-only: only a curator or an existing member can start one.
  await admin.query(`update public.profiles set is_curator = true where user_id = $1`, [owner]);
  const gid = await asUserTx<string>(owner, `select public.create_group($1) as r`, [`Conc ${tag}`]);
  await admin.query(`update public.profiles set is_curator = false where user_id = $1`, [owner]);
  const [{ invite_code }] = await q<{ invite_code: string }>(
    admin,
    `select invite_code from public.groups where id = $1`,
    [gid],
  );
  for (const m of members) {
    await asUserTx(m, `select public.join_group($1) as r`, [invite_code]);
  }
  return gid;
}

// check_in as `who`, tagging `tagged`. No location is sent.
function checkIn(who: string, restaurant: string, group: string, tagged: string[] = []) {
  return asUserTx<Result>(
    who,
    `select public.check_in($1, $2, null, null, null, $3::uuid[], null, null,
       null::smallint, null::text) as r`,
    [restaurant, group, tagged],
  );
}

// Each call runs on its own connection inside its own open transaction as its user. Every
// statement is issued before any transaction commits; each commits as its statement returns.
async function concurrently(
  calls: { user: string; sql: string; params: unknown[] }[],
): Promise<Result[]> {
  const conns = await Promise.all(calls.map(connect));
  try {
    for (const [i, c] of conns.entries()) {
      await c.query("begin");
      await c.query(AS_USER_SQL, [calls[i].user, NOW]);
    }
    const pending = conns.map((c, i) => c.query(calls[i].sql, calls[i].params));
    return await Promise.all(
      pending.map(async (p, i) => {
        const res = await p;
        await conns[i].query("commit");
        return res.rows[0].r as Result;
      }),
    );
  } finally {
    await Promise.all(
      conns.map(async (c) => {
        await c.query("rollback").catch(() => {});
        await c.end().catch(() => {});
      }),
    );
  }
}

function confirmConcurrently(calls: { user: string; visit: string }[]): Promise<Result[]> {
  return concurrently(
    calls.map((c) => ({
      user: c.user,
      sql: `select public.confirm_attendance($1, null, null, null::smallint, null::text) as r`,
      params: [c.visit],
    })),
  );
}

describe.skipIf(!local)("confirm_attendance and check_in under concurrency", () => {
  beforeAll(async () => {
    tag = randomUUID().slice(0, 8);
    admin = await connect();
  });

  afterAll(async () => {
    if (!admin) return;
    try {
      if (userIds.length) {
        await admin.query(
          `delete from public.groups where id in
             (select group_id from public.group_members where user_id = any($1::uuid[]))`,
          [userIds],
        );
        await admin.query(`delete from auth.users where id = any($1::uuid[])`, [userIds]);
      }
      if (cityIds.length) {
        await admin.query(`delete from public.restaurants where city_id = any($1::uuid[])`, [cityIds]);
        await admin.query(`delete from public.city_countries where city_id = any($1::uuid[])`, [
          cityIds,
        ]);
        await admin.query(`delete from public.cities where id = any($1::uuid[])`, [cityIds]);
      }
    } finally {
      await admin.end();
    }
  });

  it.each([1, 2, 3, 4, 5])(
    "two concurrent confirmations cannot both pass the daily cap (run %i)",
    async () => {
      const city = await createCity();
      const u = await createUser("u");
      const c = await createUser("c");
      const group = await createGroup(c, [u]);
      // One at a time: the shared admin client runs one query at a time.
      const r: string[] = [];
      for (const [i, iso] of COUNTRIES.slice(0, 4).entries()) {
        r.push(await createRestaurant(city, iso, `R${i} ${randomUUID()}`));
      }

      // U earns exactly 2 stamps today through the real functions.
      expect((await checkIn(u, r[0], group)).outcome).toBe("stamped");
      expect((await checkIn(u, r[1], group)).outcome).toBe("stamped");

      // C checks in at two more countries tagging U, who is pending on both.
      const v1 = (await checkIn(c, r[2], group, [u])).visit_id;
      const v2 = (await checkIn(c, r[3], group, [u])).visit_id;

      const results = await confirmConcurrently([
        { user: u, visit: v1 },
        { user: u, visit: v2 },
      ]);
      expect(results.map((x) => x.outcome).sort()).toEqual(["stamped", "waiting"]);

      const [{ n }] = await q<{ n: number }>(
        admin,
        `select count(*)::int as n from public.stamps
          where user_id = $1 and stamped_at is not null
            and public.london_date(stamped_at) = public.london_date($2::timestamptz)`,
        [u, NOW],
      );
      expect(n).toBe(3);
      const [{ w }] = await q<{ w: number }>(
        admin,
        `select count(*)::int as w from public.visit_attendees where user_id = $1 and stamp_waiting`,
        [u],
      );
      expect(w).toBe(1);
    },
    30_000,
  );

  it("concurrent confirmations on the same visit still give every stamp the table bonus", async () => {
    const city = await createCity();
    const c = await createUser("tc");
    const u1 = await createUser("t1");
    const u2 = await createUser("t2");
    const group = await createGroup(c, [u1, u2]);
    const rest = await createRestaurant(city, "FI", `T ${randomUUID()}`);

    const { visit_id } = await checkIn(c, rest, group, [u1, u2]);
    const results = await confirmConcurrently([
      { user: u1, visit: visit_id },
      { user: u2, visit: visit_id },
    ]);
    expect(results.map((x) => x.outcome)).toEqual(["stamped", "stamped"]);

    const rows = await q<{ table_bonus: number }>(
      admin,
      `select table_bonus from public.stamps where visit_id = $1`,
      [visit_id],
    );
    expect(rows).toHaveLength(3);
    expect(rows.map((s) => s.table_bonus)).toEqual([5, 5, 5]);
  }, 30_000);

  it("a check-in and its retry racing with the same client key make one visit", async () => {
    const city = await createCity();
    const c = await createUser("ik");
    const u = await createUser("iu");
    const group = await createGroup(c, [u]);
    const rest = await createRestaurant(city, "IS", `K ${randomUUID()}`);
    const key = randomUUID();
    const call = {
      user: c,
      sql: `select public.check_in($1, $2, null, null, null, $3::uuid[], null, null,
              null::smallint, null::text, $4) as r`,
      params: [rest, group, [u], key],
    };

    const [a, b] = await concurrently([call, call]);
    expect(b).toEqual(a);
    expect(a.outcome).toBe("stamped");
    const [{ n }] = await q<{ n: number }>(
      admin,
      `select count(*)::int as n from public.visits where created_by = $1`,
      [c],
    );
    expect(n).toBe(1);
    const [{ p }] = await q<{ p: number }>(
      admin,
      `select count(*)::int as p from public.visit_attendees where user_id = $1`,
      [u],
    );
    expect(p).toBe(1);
  }, 30_000);
});
