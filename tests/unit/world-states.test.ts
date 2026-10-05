import { describe, expect, it } from "vitest";
import { byNumeric, groupStates, mineStates, summarise } from "@/components/world/states";

const iso2s = ["LA", "FR", "ES", "NG", "MU"];
const listed = new Set(["LA", "FR", "ES"]);

describe("mineStates", () => {
  const states = mineStates({
    iso2s,
    listed,
    visitStamped: new Set(["FR"]),
    backfilled: new Set(["ES", "NG"]),
  });

  it("visit stamp = stamped, backfilled = sepia, listed-only = outline, rest neutral", () => {
    expect(states.get("FR")?.state).toBe("stamped");
    expect(states.get("ES")?.state).toBe("backfilled"); // listed too, but the memory shows
    expect(states.get("NG")?.state).toBe("backfilled");
    expect(states.get("LA")?.state).toBe("listed");
    expect(states.get("MU")?.state).toBe("neutral");
  });

  it("a visit stamp wins over a backfilled one", () => {
    const s = mineStates({ iso2s: ["FR"], listed, visitStamped: new Set(["FR"]), backfilled: new Set(["FR"]) });
    expect(s.get("FR")?.state).toBe("stamped");
  });

  it("counts: backfilled countries still count as to go in London", () => {
    expect(summarise(states, listed)).toEqual({ stamped: 1, backfilled: 2, toGo: 2, listed: 3 });
  });
});

describe("groupStates", () => {
  const states = groupStates({ iso2s, listed, counts: { FR: 2, NG: 1 }, members: 4 });

  it("any member's visit stamp colours the country, shaded by the share of the table", () => {
    expect(states.get("FR")).toEqual({ state: "stamped", share: 0.5 });
    expect(states.get("NG")).toEqual({ state: "stamped", share: 0.25 });
  });

  it("listed countries nobody has stamped are the gaps", () => {
    expect(states.get("LA")?.state).toBe("listed");
    expect(states.get("MU")?.state).toBe("neutral");
    // NG is stamped but not listed, so it adds to stamped and not to the London gaps.
    expect(summarise(states, listed)).toEqual({ stamped: 2, backfilled: 0, toGo: 2, listed: 3 });
  });

  it("never divides by zero members", () => {
    const s = groupStates({ iso2s: ["FR"], listed, counts: { FR: 1 }, members: 0 });
    expect(s.get("FR")?.share).toBe(1);
  });
});

describe("byNumeric", () => {
  it("joins on the zero-padded numeric code and skips countries without one", () => {
    const m = byNumeric([
      { iso2: "AF", iso_numeric: "004", name: "Afghanistan" },
      { iso2: "XK", iso_numeric: null, name: "Kosovo" },
    ]);
    expect(m.get("004")?.iso2).toBe("AF");
    expect(m.size).toBe(1);
  });
});
