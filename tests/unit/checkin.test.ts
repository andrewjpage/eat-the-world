import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_NAME } from "@/lib/app";
import { chromeHidden } from "@/components/nav/chrome";
import {
  CHECK_IN_FALLBACK,
  KNOWN_DB_MESSAGES,
  PREDICTED_VISIT_ID,
  predictStampResult,
  predictVerification,
  retryable,
  retryDelayMs,
  type StampPrediction,
  confirmWindowOpen,
  dailyCapFull,
  formatDistance,
  friendlyDbMessage,
  matchesQuery,
  nudgeUrl,
  outcomeCopy,
  parseAttendanceInput,
  parseCheckInBody,
  parseStampResult,
  pickDefaultGroup,
  tableHint,
} from "@/components/checkin/logic";

const R = "11111111-1111-4111-8111-111111111111";
const G = "22222222-2222-4222-8222-222222222222";
const U1 = "33333333-3333-4333-8333-333333333333";

const base = { restaurantId: R, groupId: G };

describe("parseCheckInBody", () => {
  it("accepts a full body and keeps the location", () => {
    const r = parseCheckInBody({
      ...base,
      tagged: [U1, U1],
      location: { lat: 51.5, lon: -0.12, accuracy: 20 },
      signatureDishId: R,
      rating: 4,
      note: "  great  ",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.tagged).toEqual([U1]);
    expect(r.value.location).toEqual({ lat: 51.5, lon: -0.12, accuracy: 20 });
    expect(r.value.note).toBe("great");
    expect(r.value.dishOther).toBeNull();
  });

  it("treats a missing or unusable location as unverified, not an error", () => {
    for (const location of [undefined, null, { lat: 99, lon: 0, accuracy: 1 }, { lat: "1", lon: 2, accuracy: 3 }, { lat: 1, lon: 2, accuracy: -1 }]) {
      const r = parseCheckInBody({ ...base, location });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.location).toBeNull();
    }
  });

  it("rejects bad ids, ratings and types with fixed messages", () => {
    const secret = { lat: 51.123456, lon: -0.654321, accuracy: 5 };
    const bad: unknown[] = [
      null,
      "x",
      [],
      { ...base, restaurantId: "nope" },
      { ...base, groupId: 7 },
      { ...base, tagged: "x" },
      { ...base, tagged: ["nope"] },
      { ...base, tagged: Array(30).fill(U1) },
      { ...base, rating: 0 },
      { ...base, rating: 6 },
      { ...base, rating: 3.5 },
      { ...base, rating: "4" },
      { ...base, signatureDishId: "nope" },
      { ...base, dishOther: "x".repeat(121) },
      { ...base, note: "x".repeat(1001) },
      { ...base, note: 5 },
    ];
    for (const b of bad) {
      const r = parseCheckInBody(b && typeof b === "object" ? { ...b, location: secret } : b);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).not.toMatch(/51\.1|0\.65/);
        expect(r.error.length).toBeGreaterThan(5);
      }
    }
  });

  it("accepts a uuid client key and refuses anything else", () => {
    const k = parseCheckInBody({ ...base, clientKey: U1 });
    expect(k.ok && k.value.clientKey).toBe(U1);
    const none = parseCheckInBody(base);
    expect(none.ok && none.value.clientKey).toBeNull();
    for (const clientKey of ["nope", 5, {}]) expect(parseCheckInBody({ ...base, clientKey }).ok).toBe(false);
  });

  it("prefers an approved dish over free text", () => {
    const r = parseAttendanceInput({ signatureDishId: R, dishOther: "Other" });
    expect(r.ok && r.value.dishOther).toBeNull();
    const o = parseAttendanceInput({ dishOther: "  Sticky rice " });
    expect(o.ok && o.value.dishOther).toBe("Sticky rice");
  });
});

describe("parseStampResult", () => {
  const ok = {
    visit_id: R,
    outcome: "stamped",
    country_iso2: "LA",
    points: { base: 10, rarity: 15, table: 0, dish: 2, total: 27 },
    table_pending: 2,
    first_in_group: true,
    verification: "geo_verified",
  };
  it("accepts the contract shape, including null points", () => {
    expect(parseStampResult(ok)?.points?.total).toBe(27);
    expect(parseStampResult({ ...ok, outcome: "waiting", points: null })?.points).toBeNull();
  });
  it("rejects anything else", () => {
    expect(parseStampResult(null)).toBeNull();
    expect(parseStampResult({ ...ok, outcome: "boom" })).toBeNull();
    expect(parseStampResult({ ...ok, country_iso2: "la" })).toBeNull();
    expect(parseStampResult({ ...ok, points: { base: "10" } })).toBeNull();
  });
});

describe("friendly errors", () => {
  it("passes our own sentences and hides everything else", () => {
    expect(friendlyDbMessage("You can only tag people in this group.", "x")).toBe(
      "You can only tag people in this group.",
    );
    expect(friendlyDbMessage('invalid input syntax for type double precision: "51.5"', CHECK_IN_FALLBACK)).toBe(
      CHECK_IN_FALLBACK,
    );
    expect(friendlyDbMessage(undefined, "fallback")).toBe("fallback");
  });

  it("lists only sentences a migration still raises word for word", () => {
    const dir = "supabase/migrations";
    const sql = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("\n");
    for (const m of KNOWN_DB_MESSAGES) {
      expect(sql, m).toContain(`raise exception '${m.replaceAll("'", "''")}'`);
    }
  });
});

describe("retries", () => {
  it("retries lost replies and server errors, never a refusal", () => {
    for (const s of [null, 408, 429, 500, 502, 503]) expect(retryable(s)).toBe(true);
    for (const s of [400, 401, 403, 413, 415, 422]) expect(retryable(s)).toBe(false);
    expect(retryDelayMs(2)).toBeLessThan(retryDelayMs(3));
  });
});

describe("the predicted stamp", () => {
  const G2 = "44444444-4444-4444-8444-444444444444";
  const fresh: StampPrediction = {
    hasVisitStamp: false,
    hasBackfilledStamp: false,
    stampedAts: [],
    rarityCount: 1,
    firstInGroup: { [G]: true, [G2]: false },
  };
  const input = { countryIso2: "LA", groupId: G, dishBonus: true, tagged: 2, verification: "geo_verified" as const };
  const now = new Date("2026-10-04T18:00:00Z");

  it("matches the brief's worked example for Alice: 10 + 15 + 2, +5 when 2 more confirm", () => {
    const r = predictStampResult(fresh, input, now);
    expect(r.outcome).toBe("stamped");
    expect(r.points).toEqual({ base: 10, rarity: 15, table: 0, dish: 2, total: 27 });
    expect(tableHint(r.table_pending)).toBe("+5 when 2 more confirm");
    expect(r.first_in_group).toBe(true);
    expect(r.visit_id).toBe(PREDICTED_VISIT_ID);
  });

  it("shows no table hint for 'Just me' or a single tag: the bonus can't happen", () => {
    expect(tableHint(predictStampResult(fresh, { ...input, tagged: 0 }, now).table_pending)).toBeNull();
    expect(tableHint(predictStampResult(fresh, { ...input, tagged: 1 }, now).table_pending)).toBeNull();
  });

  it("predicts repeat, waiting and upgraded like the stamp algorithm", () => {
    expect(predictStampResult({ ...fresh, hasVisitStamp: true }, input, now)).toMatchObject({ outcome: "repeat", points: null });
    const today = ["2026-10-04T09:00:00Z", "2026-10-04T10:00:00Z", "2026-10-04T11:00:00Z"];
    expect(predictStampResult({ ...fresh, stampedAts: today }, input, now)).toMatchObject({ outcome: "waiting", points: null });
    expect(predictStampResult({ ...fresh, stampedAts: today, hasVisitStamp: true }, input, now).outcome).toBe("repeat");
    expect(predictStampResult({ ...fresh, hasBackfilledStamp: true }, input, now).outcome).toBe("upgraded");
  });

  it("uses rarity by count, the group's first flag and no dish bonus without a listed dish", () => {
    const r = predictStampResult({ ...fresh, rarityCount: 4 }, { ...input, groupId: G2, dishBonus: false }, now);
    expect(r.points).toEqual({ base: 10, rarity: 5, table: 0, dish: 0, total: 15 });
    expect(r.first_in_group).toBe(false);
  });

  it("works out the badge on the phone with the brief's rule", () => {
    const place = { lat: 51.5, lon: -0.1 };
    expect(predictVerification(null, place)).toBe("self_reported");
    expect(predictVerification({ lat: 51.5, lon: -0.1, accuracy: 20 }, place)).toBe("geo_verified");
    // About 560 m north with 20 m accuracy: too far.
    expect(predictVerification({ lat: 51.505, lon: -0.1, accuracy: 20 }, place)).toBe("self_reported");
    expect(predictVerification({ lat: 51.5, lon: -0.1, accuracy: 600 }, place)).toBe("self_reported");
  });
});

describe("full-screen check-in", () => {
  it("hides the nav in the stepper but not on the picker", () => {
    expect(chromeHidden(`/check-in/${R}`)).toBe(true);
    expect(chromeHidden("/check-in")).toBe(false);
    expect(chromeHidden("/check-inn")).toBe(false);
    expect(chromeHidden(`/visit/${R}`)).toBe(false);
  });
});

describe("copy and links", () => {
  it("covers every outcome", () => {
    expect(outcomeCopy("repeat").body).toBe("Already stamped — logged as a repeat visit, 0 points.");
    expect(outcomeCopy("waiting").body).toContain("Stamp waiting: claim it tomorrow");
    expect(outcomeCopy("waiting").inked).toBe(false);
    expect(outcomeCopy("upgraded").body).toBe("Your before-the-app stamp is now a full stamp.");
    expect(outcomeCopy("stamped").inked).toBe(true);
  });
  it("hints the table bonus only while confirmations are missing", () => {
    expect(tableHint(2)).toBe("+5 when 2 more confirm");
    expect(tableHint(0)).toBeNull();
  });
  it("builds an absolute wa.me nudge link to /visit/[id]", () => {
    const u = new URL(nudgeUrl({ visitId: R, restaurantName: "Lao Café", baseUrl: "https://eat.example/" }));
    expect(u.origin + u.pathname).toBe("https://wa.me/");
    expect(u.searchParams.get("text")).toContain(`https://eat.example/visit/${R}`);
    expect(u.searchParams.get("text")).toContain("Lao Café");
    expect(u.searchParams.get("text")).toContain(`on ${APP_NAME}.`);
  });
  it("rounds distances", () => {
    expect(formatDistance(3)).toBe("10 m");
    expect(formatDistance(124)).toBe("120 m");
    expect(formatDistance(1449)).toBe("1.4 km");
    expect(formatDistance(23_400)).toBe("23 km");
  });
});

describe("windows, caps and search", () => {
  it("closes the confirm window after 7 days", () => {
    const visited = "2026-10-01T12:00:00Z";
    expect(confirmWindowOpen(visited, new Date("2026-10-08T11:59:00Z"))).toBe(true);
    expect(confirmWindowOpen(visited, new Date("2026-10-08T12:01:00Z"))).toBe(false);
  });
  it("counts the cap on the London day", () => {
    const now = new Date("2026-10-04T22:30:00Z"); // 23:30 BST, still the 4th
    const same = ["2026-10-04T10:00:00Z", "2026-10-04T11:00:00Z", "2026-10-04T12:00:00Z"];
    expect(dailyCapFull(same, now)).toBe(true);
    expect(dailyCapFull([...same.slice(0, 2), null, "2026-10-03T12:00:00Z"], now)).toBe(false);
    // 00:30 BST on the 5th is a new London day even though UTC is still the 4th.
    expect(dailyCapFull(same, new Date("2026-10-04T23:30:00Z"))).toBe(false);
  });
  it("matches search terms across fields", () => {
    const r = { name: "Lao Café", address: "1 High St", postcode: "E8 3PN", country: "Laos" };
    expect(matchesQuery(r, "lao")).toBe(true);
    expect(matchesQuery(r, "e8 high")).toBe(true);
    expect(matchesQuery(r, "thai")).toBe(false);
    expect(matchesQuery(r, "   ")).toBe(true);
  });
  it("defaults to the remembered group only when it is still mine", () => {
    expect(pickDefaultGroup([R, G], G)).toBe(G);
    expect(pickDefaultGroup([R, G], "gone")).toBe(R);
    expect(pickDefaultGroup([], null)).toBeNull();
  });
});
