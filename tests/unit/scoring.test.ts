import { describe, expect, it } from "vitest";
import {
  MAX_NEW_STAMPS_PER_DAY,
  capAllows,
  countsForVerifiedOnly,
  geoVerified,
  rarityBonus,
  roundDistance,
  seasonIncludes,
  setActive,
  setComplete,
  stampPoints,
  tableBonusApplies,
  tablePending,
  visitVerification,
} from "@/lib/scoring";
import { londonDate } from "@/lib/time";

describe("rarityBonus tiers", () => {
  it.each([
    [0, 15],
    [1, 15],
    [2, 10],
    [3, 10],
    [4, 5],
    [9, 5],
    [10, 0],
    [50, 0],
  ])("count %i -> %i", (n, b) => expect(rarityBonus(n)).toBe(b));
});

describe("table bonus", () => {
  it("applies at 3 confirmed", () => {
    expect(tableBonusApplies(2)).toBe(false);
    expect(tableBonusApplies(3)).toBe(true);
    expect(tableBonusApplies(7)).toBe(true);
  });
  it("pending count", () => {
    expect(tablePending(1)).toBe(2);
    expect(tablePending(3)).toBe(0);
    expect(tablePending(5)).toBe(0);
  });
});

describe("stampPoints", () => {
  it("worked example: Lao Cafe, 27 then 32", () => {
    const r = rarityBonus(1);
    const before = stampPoints({ rarityBonus: r, confirmedMembers: 1, signatureDishMatches: true });
    expect(before).toEqual({ base: 10, rarity: 15, table: 0, dish: 2, total: 27 });
    expect(tablePending(1)).toBe(2);
    // Bob confirms: still 27
    expect(stampPoints({ rarityBonus: r, confirmedMembers: 2, signatureDishMatches: true }).total).toBe(27);
    // Cara confirms: all three become 32
    for (let i = 0; i < 3; i++) {
      expect(stampPoints({ rarityBonus: r, confirmedMembers: 3, signatureDishMatches: true })).toEqual({
        base: 10,
        rarity: 15,
        table: 5,
        dish: 2,
        total: 32,
      });
    }
  });
  it("later second Lao restaurant does not change a frozen bonus", () => {
    expect(stampPoints({ rarityBonus: 15, tableBonus: true, signatureDishMatches: true }).total).toBe(32);
  });
  it("no dish match, no table", () => {
    expect(stampPoints({ rarityBonus: 0 }).total).toBe(10);
  });
  it("backfilled scores 0", () => {
    expect(stampPoints({ rarityBonus: 15, tableBonus: true, signatureDishMatches: true, backfilled: true }).total).toBe(0);
  });
});

describe("daily cap (Europe/London days)", () => {
  const three = (iso: string) => [iso, iso, iso];
  it("constant is 3", () => expect(MAX_NEW_STAMPS_PER_DAY).toBe(3));
  it("allows under the cap, blocks at it", () => {
    const now = new Date("2026-07-10T12:00:00Z");
    expect(capAllows([], now)).toBe(true);
    expect(capAllows(two(), now)).toBe(true);
    expect(capAllows(three("2026-07-10T08:00:00Z"), now)).toBe(false);
    function two() {
      return ["2026-07-10T08:00:00Z", "2026-07-10T09:00:00Z"];
    }
  });
  it("ignores null stamped_at (backfill)", () => {
    expect(capAllows([null, null, null, undefined], new Date("2026-07-10T12:00:00Z"))).toBe(true);
  });
  it("BST midnight boundary: 23:00Z is already the next London day", () => {
    // 2026-07-10T22:59:59Z is 23:59:59 BST on the 10th; 23:00Z is 00:00 BST on the 11th.
    const stamps = three("2026-07-10T22:59:59Z");
    expect(capAllows(stamps, new Date("2026-07-10T22:59:59Z"))).toBe(false);
    expect(capAllows(stamps, new Date("2026-07-10T23:00:00Z"))).toBe(true);
    expect(capAllows(three("2026-07-10T23:00:00Z"), new Date("2026-07-11T10:00:00Z"))).toBe(false);
  });
  it("across the 2026-10-25 clock change (GMT from 01:00Z)", () => {
    // 24 Oct 23:00Z = 00:00 BST on 25 Oct. 25 Oct is a 25-hour day ending 26 Oct 00:00Z.
    expect(londonDate(new Date("2026-10-24T22:59:59Z"))).toBe("2026-10-24");
    expect(londonDate(new Date("2026-10-24T23:00:00Z"))).toBe("2026-10-25");
    expect(londonDate(new Date("2026-10-25T23:59:59Z"))).toBe("2026-10-25");
    expect(londonDate(new Date("2026-10-26T00:00:00Z"))).toBe("2026-10-26");
    const early = three("2026-10-24T23:30:00Z");
    expect(capAllows(early, new Date("2026-10-25T23:59:00Z"))).toBe(false);
    expect(capAllows(early, new Date("2026-10-26T00:00:00Z"))).toBe(true);
  });
});

describe("sets", () => {
  const set = ["GE", "AM", "AZ"];
  it("active needs >= 2 listed", () => {
    expect(setActive(set, [])).toBe(false);
    expect(setActive(set, ["GE"])).toBe(false);
    expect(setActive(set, ["GE", "AM", "FR"])).toBe(true);
  });
  it("complete needs a stamp for every listed country; unlisted ones are not required", () => {
    expect(setComplete(set, ["GE", "AM"], ["GE"])).toBe(false);
    expect(setComplete(set, ["GE", "AM"], ["GE", "AM"])).toBe(true);
    expect(setComplete(set, ["GE"], ["GE"])).toBe(false); // inactive
    expect(setComplete(set, ["GE", "AM", "AZ"], ["GE", "AM"])).toBe(false);
  });
});

describe("seasonIncludes (inclusive London dates)", () => {
  it("start and end days are included", () => {
    expect(seasonIncludes("2026-07-01T00:00:00+01:00", "2026-07-01", "2026-07-31")).toBe(true);
    expect(seasonIncludes("2026-07-31T23:59:59+01:00", "2026-07-01", "2026-07-31")).toBe(true);
  });
  it("outside excluded; London time not UTC", () => {
    expect(seasonIncludes("2026-06-30T22:59:59Z", "2026-07-01", "2026-07-31")).toBe(false);
    expect(seasonIncludes("2026-06-30T23:00:00Z", "2026-07-01", "2026-07-31")).toBe(true); // 00:00 BST
    expect(seasonIncludes("2026-07-31T23:00:00Z", "2026-07-01", "2026-07-31")).toBe(false); // 00:00 BST 1 Aug
  });
  it("open bounds", () => {
    expect(seasonIncludes("2020-01-01T00:00:00Z", null, null)).toBe(true);
    expect(seasonIncludes("2020-01-01T00:00:00Z", "2021-01-01", null)).toBe(false);
    expect(seasonIncludes("2030-01-01T00:00:00Z", null, "2029-12-31")).toBe(false);
  });
});

describe("geoVerified", () => {
  it("accuracy 500 ok, 501 not", () => {
    expect(geoVerified(100, 500)).toBe(true);
    expect(geoVerified(100, 501)).toBe(false);
  });
  it("distance - accuracy: 250 ok, 251 not", () => {
    expect(geoVerified(300, 50)).toBe(true);
    expect(geoVerified(301, 50)).toBe(false);
    expect(geoVerified(750, 500)).toBe(true);
    expect(geoVerified(751, 500)).toBe(false);
  });
  it("close with tiny accuracy", () => expect(geoVerified(0, 0)).toBe(true));
  it("rejects NaN", () => expect(geoVerified(NaN, 10)).toBe(false));
  it("rounds distance to 10 m", () => {
    expect(roundDistance(124)).toBe(120);
    expect(roundDistance(125)).toBe(130);
  });
});

describe("visitVerification", () => {
  it("precedence", () => {
    expect(visitVerification({ geoVerified: true, hasPhoto: true })).toBe("geo_verified");
    expect(visitVerification({ geoVerified: false, hasPhoto: true })).toBe("photo");
    expect(visitVerification({ geoVerified: false, hasPhoto: false })).toBe("self_reported");
  });
  it("owner downgrade wins", () => {
    expect(visitVerification({ geoVerified: true, hasPhoto: true, downgraded: true })).toBe("self_reported");
  });
  it("verified_only filter", () => {
    expect(countsForVerifiedOnly("geo_verified")).toBe(true);
    expect(countsForVerifiedOnly("photo")).toBe(true);
    expect(countsForVerifiedOnly("self_reported")).toBe(false);
  });
});
