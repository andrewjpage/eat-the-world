import { afterEach, describe, expect, it } from "vitest";
import { deriveStamps, isFutureDate, localToday, logOutcome } from "@solo/domain/stamps";
import type {
  Backfill,
  SeedCountry,
  SeedRestaurant,
  SoloRestaurant,
  SoloVisit,
} from "@solo/domain/types";
import { buildPassport, buildWorldData, soloPins, stampDate } from "@solo/domain/views";

function restaurant(id: string, countryIso2: string, over: Partial<SoloRestaurant> = {}): SoloRestaurant {
  return {
    id,
    seedId: null,
    name: `Restaurant ${id}`,
    countryIso2,
    address: null,
    lat: 51.5,
    lon: -0.12,
    createdAt: "2026-01-01T10:00:00.000Z",
    ...over,
  };
}

function visit(id: string, restaurantId: string, visitedOn: string, over: Partial<SoloVisit> = {}): SoloVisit {
  return {
    id,
    restaurantId,
    visitedOn,
    dishId: null,
    dishOther: null,
    rating: null,
    note: null,
    photoId: null,
    createdAt: `${visitedOn}T18:00:00.000Z`,
    ...over,
  };
}

function backfill(countryIso2: string, createdAt = "2026-02-03T09:30:00.000Z"): Backfill {
  return { countryIso2, createdAt };
}

function country(iso2: string, name: string, numeric: string | null = null): SeedCountry {
  return { iso2, iso_numeric: numeric, name, iso_name: `${name} (ISO)`, m49_group: "Somewhere" };
}

function seedRestaurant(id: string, countryIso2: string, over: Partial<SeedRestaurant> = {}): SeedRestaurant {
  return {
    id,
    countryIso2,
    name: `Seed ${id}`,
    address: "1 High Street, London",
    postcode: "W1T 3LD",
    lat: 51.52,
    lon: -0.13,
    confidence: "curated",
    curatorNote: "Order the jollof.",
    googlePlaceId: null,
    ...over,
  };
}

describe("deriveStamps", () => {
  const restaurants = [restaurant("r-fr", "FR"), restaurant("r-fr2", "FR"), restaurant("r-jp", "JP")];

  it("gives one stamp per country, from the earliest visit", () => {
    const visits = [
      visit("v2", "r-fr2", "2026-05-02"),
      visit("v1", "r-fr", "2026-04-01"),
      visit("v3", "r-jp", "2026-06-10"),
    ];
    const stamps = deriveStamps(restaurants, visits, []);
    expect(stamps).toHaveLength(2);
    expect(stamps.find((s) => s.countryIso2 === "FR")).toEqual({
      countryIso2: "FR",
      kind: "visit",
      visitId: "v1",
      earnedOn: "2026-04-01",
    });
    expect(stamps.find((s) => s.countryIso2 === "JP")).toEqual({
      countryIso2: "JP",
      kind: "visit",
      visitId: "v3",
      earnedOn: "2026-06-10",
    });
  });

  it("breaks a same-day tie by when the visit was logged", () => {
    const visits = [
      visit("late", "r-fr", "2026-04-01", { createdAt: "2026-04-01T21:00:00.000Z" }),
      visit("early", "r-fr2", "2026-04-01", { createdAt: "2026-04-01T12:00:00.000Z" }),
    ];
    expect(deriveStamps(restaurants, visits, [])[0].visitId).toBe("early");
  });

  it("moves the stamp earlier when a visit is backdated", () => {
    const visits = [visit("v1", "r-fr", "2026-04-01")];
    expect(deriveStamps(restaurants, visits, [])[0].earnedOn).toBe("2026-04-01");

    const withBackdated = [...visits, visit("v0", "r-fr2", "2025-12-25", { createdAt: "2026-04-02T08:00:00.000Z" })];
    const [stamp] = deriveStamps(restaurants, withBackdated, []);
    expect(stamp.earnedOn).toBe("2025-12-25");
    expect(stamp.visitId).toBe("v0");
  });

  it("replaces a backfill with a visit stamp for the same country", () => {
    const stamps = deriveStamps(restaurants, [visit("v1", "r-fr", "2026-04-01")], [backfill("FR"), backfill("ES")]);
    expect(stamps.map((s) => [s.countryIso2, s.kind]).sort()).toEqual([
      ["ES", "backfilled"],
      ["FR", "visit"],
    ]);
  });

  it("falls back to the backfill, then to nothing, when the only visit is deleted", () => {
    const withVisit = deriveStamps(restaurants, [visit("v1", "r-fr", "2026-04-01")], [backfill("FR")]);
    expect(withVisit).toHaveLength(1);
    expect(withVisit[0].kind).toBe("visit");

    const afterDelete = deriveStamps(restaurants, [], [backfill("FR")]);
    expect(afterDelete).toEqual([
      { countryIso2: "FR", kind: "backfilled", visitId: null, earnedOn: "2026-02-03" },
    ]);

    expect(deriveStamps(restaurants, [], [])).toEqual([]);
  });

  it("follows a restaurant when it is moved to another country", () => {
    const moved = [restaurant("r-fr", "BE"), restaurant("r-jp", "JP")];
    const stamps = deriveStamps(moved, [visit("v1", "r-fr", "2026-04-01")], []);
    expect(stamps.map((s) => s.countryIso2)).toEqual(["BE"]);
  });

  it("ignores a visit whose restaurant is gone", () => {
    expect(deriveStamps(restaurants, [visit("v1", "missing", "2026-04-01")], [])).toEqual([]);
  });
});

describe("logOutcome", () => {
  const restaurants = [restaurant("r-fr", "FR")];
  const stamps = deriveStamps(restaurants, [visit("v1", "r-fr", "2026-04-01")], [backfill("ES")]);

  it("is stamped for a country with no stamp", () => {
    expect(logOutcome(stamps, "JP")).toBe("stamped");
  });

  it("is upgraded over a backfill", () => {
    expect(logOutcome(stamps, "ES")).toBe("upgraded");
  });

  it("is repeat when a visit stamp exists", () => {
    expect(logOutcome(stamps, "FR")).toBe("repeat");
  });
});

describe("isFutureDate", () => {
  it("is true only for a day after today", () => {
    expect(isFutureDate("2026-10-22", "2026-10-21")).toBe(true);
    expect(isFutureDate("2026-10-21", "2026-10-21")).toBe(false);
    expect(isFutureDate("2026-10-20", "2026-10-21")).toBe(false);
    expect(isFutureDate("2027-01-01", "2026-12-31")).toBe(true);
  });
});

describe("localToday", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("uses the device's calendar date at 23:30, not the UTC date", () => {
    process.env.TZ = "America/Los_Angeles"; // 23:30 here is already tomorrow in UTC
    const lateEvening = new Date(2026, 9, 21, 23, 30);
    expect(lateEvening.toISOString().slice(0, 10)).toBe("2026-10-22");
    expect(localToday(lateEvening)).toBe("2026-10-21");
  });

  it("uses the device's calendar date just after midnight", () => {
    process.env.TZ = "Pacific/Auckland"; // 00:05 here is still yesterday in UTC
    const justAfterMidnight = new Date(2026, 0, 5, 0, 5);
    expect(justAfterMidnight.toISOString().slice(0, 10)).toBe("2026-01-04");
    expect(localToday(justAfterMidnight)).toBe("2026-01-05");
  });

  it("pads single-digit months and days", () => {
    expect(localToday(new Date(2026, 2, 4, 12, 0))).toBe("2026-03-04");
  });
});

describe("stampDate", () => {
  it("pins the day at midday UTC so London formatting never crosses a day", () => {
    expect(stampDate("2026-10-21")).toBe("2026-10-21T12:00:00Z");
  });
});

describe("buildPassport", () => {
  const countries = [
    country("FR", "France", "250"),
    country("JP", "Japan", "392"),
    country("ES", "Spain", "724"),
    country("NG", "Nigeria", "566"),
    country("DE", "Germany", "276"),
  ];
  const restaurants = [restaurant("r-fr", "FR"), restaurant("r-fr2", "FR"), restaurant("r-jp", "JP")];
  const visits = [
    visit("v1", "r-fr", "2026-04-01"),
    visit("v2", "r-fr2", "2026-05-02"),
    visit("v3", "r-jp", "2026-06-10"),
  ];
  const stamps = deriveStamps(restaurants, visits, [backfill("ES")]);
  const listed = new Set(["FR", "JP", "NG"]);
  const summary = buildPassport({ countries, listed, stamps, now: new Date("2026-10-21T12:00:00Z") });

  it("counts London stamps, listed countries and every stamp", () => {
    expect(summary.londonStamped).toBe(2);
    expect(summary.londonListed).toBe(3);
    expect(summary.anywhereStamps).toBe(3);
    expect(summary.isoTotal).toBe(5);
  });

  it("scores no points and has nothing pending", () => {
    expect(summary.points).toBe(0);
    expect(summary.pending).toEqual([]);
  });

  it("marks each country by its state", () => {
    const state = Object.fromEntries(summary.countries.map((c) => [c.iso2, c.state]));
    expect(state).toEqual({ FR: "stamped", JP: "stamped", ES: "backfilled", NG: "listed", DE: "unlisted" });
  });

  it("shows no verification badge on any country", () => {
    expect(summary.countries.every((c) => c.verification === null)).toBe(true);
  });

  it("dates a visit stamp from its earliest visit", () => {
    const fr = summary.countries.find((c) => c.iso2 === "FR");
    expect(fr?.date).toBe("2026-04-01T12:00:00Z");
    expect(summary.countries.find((c) => c.iso2 === "ES")?.date).toBeNull();
  });
});

describe("buildWorldData", () => {
  const countries = [country("FR", "France", "250"), country("ES", "Spain", "724"), country("JP", "Japan", null)];
  const restaurants = [restaurant("r-fr", "FR"), restaurant("r-jp", "JP")];
  const stamps = deriveStamps(
    restaurants,
    [visit("v1", "r-fr", "2026-04-01"), visit("v3", "r-jp", "2026-06-10")],
    [backfill("ES")],
  );
  const data = buildWorldData({ countries, listed: new Set(["JP", "FR"]), stamps });

  it("splits visit stamps from backfilled ones", () => {
    expect(data.visitStamped).toEqual(["FR", "JP"]);
    expect(data.backfilled).toEqual(["ES"]);
  });

  it("has no groups", () => {
    expect(data.groups).toEqual([]);
  });

  it("passes countries through with their numeric ids and the listed set", () => {
    expect(data.countries).toEqual([
      { iso2: "FR", iso_numeric: "250", name: "France" },
      { iso2: "ES", iso_numeric: "724", name: "Spain" },
      { iso2: "JP", iso_numeric: null, name: "Japan" },
    ]);
    expect(data.listed).toEqual(["FR", "JP"]);
  });
});

describe("soloPins", () => {
  const countryNames = new Map([
    ["FR", "France"],
    ["NG", "Nigeria"],
    ["JP", "Japan"],
  ]);
  const own = [restaurant("r-fr", "FR", { name: "Chez Moi", lat: 48.85, lon: 2.35 })];
  const stamps = deriveStamps(own, [visit("v1", "r-fr", "2026-04-01")], []);

  it("marks a suggestion in a stamped country stamped and one elsewhere new", () => {
    const pins = soloPins({
      suggestions: [seedRestaurant("seed:fr-a", "FR"), seedRestaurant("seed:ng-a", "NG")],
      own: [],
      visits: [],
      stamps,
      countryNames,
    });
    const byId = new Map(pins.map((p) => [p.id, p]));
    expect(byId.get("seed:fr-a")?.state).toBe("stamped");
    expect(byId.get("seed:ng-a")?.state).toBe("new");
    expect(byId.get("seed:ng-a")?.countryName).toBe("Nigeria");
  });

  it("carries the seed's confidence and curator note on a suggestion", () => {
    const [pin] = soloPins({
      suggestions: [seedRestaurant("seed:ng-a", "NG", { confidence: "flagged", curatorNote: "Pan-regional." })],
      own: [],
      visits: [],
      stamps: [],
      countryNames,
    });
    expect(pin).toMatchObject({
      status: "active",
      confidence: "flagged",
      curator_note: "Pan-regional.",
      country_iso2: "NG",
      postcode: "W1T 3LD",
    });
  });

  it("shows a suggestion once when it has already been copied", () => {
    const copied = restaurant("r-ng", "NG", { seedId: "seed:ng-a", name: "Akoko", lat: 51.52, lon: -0.13 });
    const pins = soloPins({
      suggestions: [seedRestaurant("seed:ng-a", "NG"), seedRestaurant("seed:ng-b", "NG")],
      own: [copied],
      visits: [],
      stamps: [],
      countryNames,
    });
    expect(pins.map((p) => p.id).sort()).toEqual(["r-ng", "seed:ng-b"]);
  });

  it("gives an own restaurant community confidence and no curator note", () => {
    const [pin] = soloPins({ suggestions: [], own, visits: [], stamps: [], countryNames });
    expect(pin).toMatchObject({ id: "r-fr", confidence: "community", curator_note: null, status: "active" });
    expect(pin.state).toBe("new");
  });

  it("leaves a restaurant without coordinates off the map", () => {
    const noCoords = [
      restaurant("r-a", "FR", { lat: null, lon: null }),
      restaurant("r-b", "FR", { lat: 48.8, lon: null }),
      restaurant("r-c", "FR"),
    ];
    const pins = soloPins({ suggestions: [], own: noCoords, visits: [], stamps: [], countryNames });
    expect(pins.map((p) => p.id)).toEqual(["r-c"]);
  });

  it("rings the restaurants that have a visit", () => {
    const two = [restaurant("r-fr", "FR"), restaurant("r-jp", "JP")];
    const pins = soloPins({
      suggestions: [seedRestaurant("seed:ng-a", "NG")],
      own: two,
      visits: [visit("v1", "r-fr", "2026-04-01")],
      stamps: deriveStamps(two, [visit("v1", "r-fr", "2026-04-01")], []),
      countryNames,
    });
    const ringed = Object.fromEntries(pins.map((p) => [p.id, p.friendVisited]));
    expect(ringed).toEqual({ "seed:ng-a": false, "r-fr": true, "r-jp": false });
  });

  it("keeps a backfilled country bright", () => {
    const pins = soloPins({
      suggestions: [seedRestaurant("seed:ng-a", "NG")],
      own: [],
      visits: [],
      stamps: deriveStamps([], [], [backfill("NG")]),
      countryNames,
    });
    expect(pins[0].state).toBe("new");
  });
});
