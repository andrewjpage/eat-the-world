import { describe, expect, it } from "vitest";
import { rankRows, seasonLabel } from "@/components/group/leaderboard";
import { pickIndex, proposeDinnerHref, spinDelays, spinPick, type GapCountry } from "@/components/group/spin";

const gap = (iso2: string, n = 1): GapCountry => ({
  iso2,
  name: iso2,
  restaurants: Array.from({ length: n }, (_, i) => ({ id: `${iso2}-${i}`, name: `${iso2} ${i}` })),
});

describe("spin the globe", () => {
  it("pickIndex stays in range, even for random() = 0.999..", () => {
    expect(pickIndex(3, () => 0)).toBe(0);
    expect(pickIndex(3, () => 0.9999999)).toBe(2);
    expect(pickIndex(0)).toBe(-1);
  });

  it("never lands on the previous country when there is a choice", () => {
    const gaps = [gap("LA"), gap("ER"), gap("NG")];
    for (let i = 0; i < 50; i++) {
      expect(spinPick(gaps, "LA", Math.random)?.country.iso2).not.toBe("LA");
    }
  });

  it("lands on the only gap, and returns null with none", () => {
    expect(spinPick([gap("LA")], "LA")?.country.iso2).toBe("LA");
    expect(spinPick([], null)).toBeNull();
  });

  it("suggests one of the country's restaurants, or none", () => {
    const pick = spinPick([gap("LA", 3)], null, () => 0.5);
    expect(pick?.restaurant?.id).toBe("LA-1");
    expect(spinPick([gap("LA", 0)], null)?.restaurant).toBeNull();
  });

  it("slows down: delays never decrease", () => {
    const d = spinDelays();
    expect(d.length).toBe(16);
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThanOrEqual(d[i - 1]);
  });

  it("links to the plan page with the restaurant id", () => {
    expect(proposeDinnerHref("g1", "r 1")).toBe("/group/g1/plan/new?restaurant=r%201");
  });
});

describe("leaderboard helpers", () => {
  const row = (name: string, points: number, countries: number) => ({
    user_id: name,
    display_name: name,
    points,
    countries,
  });

  it("ties share a rank (competition ranking)", () => {
    const ranked = rankRows([row("a", 30, 2), row("b", 30, 2), row("c", 10, 1)]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  it("same points with more countries ranks higher (matches the SQL order)", () => {
    expect(rankRows([row("a", 30, 3), row("b", 30, 2)]).map((r) => r.rank)).toEqual([1, 2]);
  });

  it("formats the season in London calendar dates, inclusive", () => {
    expect(seasonLabel("2026-09-01", "2026-09-30")).toBe("1 Sept 2026 to 30 Sept 2026");
    expect(seasonLabel("2026-09-01", null)).toBe("from 1 Sept 2026");
    expect(seasonLabel(null, "2026-12-31")).toBe("until 31 Dec 2026");
    expect(seasonLabel(null, null)).toBeNull();
  });
});
