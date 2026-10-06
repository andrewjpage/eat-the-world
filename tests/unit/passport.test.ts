import { describe, expect, it } from "vitest";
import {
  summarisePassport,
  type PassportAttendanceRow,
  type PassportStampRow,
} from "@/lib/passport";

const NOW = new Date("2026-10-05T19:00:00Z"); // 20:00 in London (BST)
const DAY = 86_400_000;

const countries = ["LA", "ET", "AE", "ES", "KP", "PE"].map((iso2) => ({
  iso2,
  name: iso2 === "KP" ? null : `Country ${iso2}`,
  iso_name: `ISO ${iso2}`,
  m49_group: iso2 === "PE" ? null : "Somewhere",
}));
// LA, ET, PE listed; AE, ES unlisted (ES has no row at all); KP uncharted.
const statusRows = [
  { country_iso2: "LA", status: "listed" },
  { country_iso2: "ET", status: "listed" },
  { country_iso2: "PE", status: "listed" },
  { country_iso2: "AE", status: "unlisted" },
  { country_iso2: "KP", status: "uncharted" },
];

function stamp(country_iso2: string, over: Partial<PassportStampRow> = {}): PassportStampRow {
  return {
    country_iso2,
    points: 0,
    backfilled: false,
    verification: "geo_verified",
    earned_at: "2026-09-01T19:00:00Z",
    stamped_at: "2026-09-01T19:00:00Z",
    ...over,
  };
}

function attendance(
  visit_id: string,
  country_iso2: string,
  over: Partial<PassportAttendanceRow> = {},
  visitedAt = new Date(NOW.getTime() - DAY).toISOString(),
): PassportAttendanceRow {
  return {
    visit_id,
    status: "pending",
    stamp_waiting: false,
    visits: { visited_at: visitedAt, restaurants: { name: `R ${country_iso2}`, country_iso2 } },
    ...over,
  };
}

function run(over: Partial<Parameters<typeof summarisePassport>[0]> = {}) {
  return summarisePassport({
    countries,
    statusRows,
    stamps: [],
    awards: [],
    attendances: [],
    now: NOW,
    ...over,
  });
}

const byIso = (s: ReturnType<typeof run>) => new Map(s.countries.map((c) => [c.iso2, c]));

describe("summarisePassport", () => {
  it("counts listed countries as the London denominator and every ISO code as the total", () => {
    const s = run();
    expect(s.londonListed).toBe(3);
    expect(s.londonStamped).toBe(0);
    expect(s.isoTotal).toBe(6);
    expect(s.anywhereStamps).toBe(0);
    expect(s.points).toBe(0);
    const m = byIso(s);
    expect(m.get("LA")!.state).toBe("listed");
    expect(m.get("ES")!.state).toBe("unlisted"); // no status row → unlisted
    expect(m.get("KP")!.name).toBe("ISO KP");
    expect(m.get("PE")!.region).toBe("Elsewhere");
  });

  it("excludes a backfilled stamp on a listed country from London but counts it anywhere, at 0 points", () => {
    const s = run({ stamps: [stamp("LA", { backfilled: true, points: 0, stamped_at: null })] });
    expect(s.londonStamped).toBe(0);
    expect(s.anywhereStamps).toBe(1);
    expect(s.points).toBe(0);
    const la = byIso(s).get("LA")!;
    expect(la.state).toBe("backfilled");
    expect(la.date).toBeNull();
    expect(la.verification).toBeNull();
  });

  it("ignores a backfilled stamp's stored points", () => {
    const s = run({ stamps: [stamp("LA", { backfilled: true, points: 10, stamped_at: null })] });
    expect(s.points).toBe(0);
  });

  it("counts a visit stamp on a listed country in London, with its points and date", () => {
    const s = run({ stamps: [stamp("ET", { points: 30 })] });
    expect(s.londonStamped).toBe(1);
    expect(s.points).toBe(30);
    const et = byIso(s).get("ET")!;
    expect(et.state).toBe("stamped");
    expect(et.date).toBe("2026-09-01T19:00:00Z");
    expect(et.verification).toBe("geo_verified");
  });

  it("excludes a visit stamp on an unlisted country from London", () => {
    const s = run({ stamps: [stamp("AE", { points: 25 })] });
    expect(s.londonStamped).toBe(0);
    expect(s.londonListed).toBe(3);
    expect(s.anywhereStamps).toBe(1);
    expect(s.points).toBe(25);
    expect(byIso(s).get("AE")!.state).toBe("stamped");
  });

  it("marks an uncharted country uncharted, outside the London denominator", () => {
    const s = run();
    expect(byIso(s).get("KP")!.state).toBe("uncharted");
    expect(s.londonListed).toBe(3);
  });

  it("adds set-award points", () => {
    const s = run({ stamps: [stamp("LA", { points: 35 })], awards: [{ points: 25 }, { points: 25 }] });
    expect(s.points).toBe(85);
  });

  it("drops pending rows older than the 7-day window", () => {
    const fresh = attendance("v1", "LA", {}, new Date(NOW.getTime() - 6 * DAY).toISOString());
    const stale = attendance("v2", "ET", {}, new Date(NOW.getTime() - 8 * DAY).toISOString());
    const s = run({ attendances: [fresh, stale] });
    expect(s.pending.map((p) => p.visitId)).toEqual(["v1"]);
    expect(s.pending[0].kind).toBe("pending");
  });

  it("drops a waiting row for a country already stamped at another visit", () => {
    const waiting = attendance("v1", "LA", { status: "confirmed", stamp_waiting: true });
    const s = run({ stamps: [stamp("LA", { points: 10 })], attendances: [waiting] });
    expect(s.pending).toEqual([]);
  });

  it("keeps a waiting row when the country is only backfilled (claiming upgrades it)", () => {
    const waiting = attendance("v1", "LA", { status: "confirmed", stamp_waiting: true });
    const s = run({
      stamps: [stamp("LA", { backfilled: true, stamped_at: null })],
      attendances: [waiting],
    });
    expect(s.pending.map((p) => p.kind)).toEqual(["waiting"]);
  });

  it("says claim tomorrow while today's cap is full, and now once it isn't", () => {
    const waiting = attendance("v1", "LA", { status: "confirmed", stamp_waiting: true });
    // 19:30Z on 4 Oct is 20:30 on 4 Oct in London; 23:30Z on 4 Oct is 00:30 on 5 Oct.
    const today = ["2026-10-05T08:00:00Z", "2026-10-04T23:30:00Z", "2026-10-05T18:00:00Z"];
    const full = run({
      stamps: today.map((t, i) => stamp(["ET", "AE", "PE"][i], { stamped_at: t })),
      attendances: [waiting],
    });
    expect(full.pending[0]).toMatchObject({ kind: "waiting", claimTomorrow: true });

    const yesterday = ["2026-10-05T08:00:00Z", "2026-10-04T19:30:00Z", "2026-10-05T18:00:00Z"];
    const open = run({
      stamps: yesterday.map((t, i) => stamp(["ET", "AE", "PE"][i], { stamped_at: t })),
      attendances: [waiting],
    });
    expect(open.pending[0]).toMatchObject({ kind: "waiting", claimTomorrow: false });
  });

  it("lists waiting stamps before pending confirmations and ignores declined rows", () => {
    const s = run({
      attendances: [
        attendance("p1", "ET"),
        attendance("w1", "LA", { status: "confirmed", stamp_waiting: true }),
        attendance("d1", "PE", { status: "declined" }),
      ],
    });
    expect(s.pending.map((p) => `${p.kind}:${p.visitId}`)).toEqual(["waiting:w1", "pending:p1"]);
  });
});
