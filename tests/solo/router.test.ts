import { describe, expect, it } from "vitest";
import { matchRoute } from "@solo/router";

describe("matchRoute", () => {
  it("matches the screens that take no parameters", () => {
    expect(matchRoute("/")).toEqual({ name: "passport", params: {} });
    expect(matchRoute("/map")).toEqual({ name: "map", params: {} });
    expect(matchRoute("/world")).toEqual({ name: "world", params: {} });
    expect(matchRoute("/check-in")).toEqual({ name: "check-in", params: {} });
    expect(matchRoute("/backfill")).toEqual({ name: "backfill", params: {} });
    expect(matchRoute("/settings")).toEqual({ name: "settings", params: {} });
  });

  it("reads the country code out of /country/:iso2", () => {
    expect(matchRoute("/country/FR")).toEqual({ name: "country", params: { iso2: "FR" } });
  });

  it("upper-cases the country code, because stamps are keyed by upper-case codes", () => {
    expect(matchRoute("/country/fr")).toEqual({ name: "country", params: { iso2: "FR" } });
  });

  it("rejects a country segment that is not a two-letter code", () => {
    expect(matchRoute("/country/FRA").name).toBe("not-found");
    expect(matchRoute("/country/F1").name).toBe("not-found");
    expect(matchRoute("/country/").name).toBe("not-found");
    expect(matchRoute("/country").name).toBe("not-found");
  });

  it("keeps the colon in a seed restaurant id", () => {
    expect(matchRoute("/restaurant/seed:enish-w1t-3ld")).toEqual({
      name: "restaurant",
      params: { id: "seed:enish-w1t-3ld" },
    });
  });

  it("decodes an id whose colon was percent-encoded", () => {
    expect(matchRoute("/restaurant/seed%3Aenish-w1t-3ld").params.id).toBe("seed:enish-w1t-3ld");
  });

  it("reads the visit id out of /visit/:id", () => {
    expect(matchRoute("/visit/abc")).toEqual({ name: "visit", params: { id: "abc" } });
  });

  it("ignores a trailing slash", () => {
    expect(matchRoute("/map/").name).toBe("map");
    expect(matchRoute("/country/FR/")).toEqual({ name: "country", params: { iso2: "FR" } });
  });

  it("is not-found for unknown paths, missing ids and extra segments", () => {
    expect(matchRoute("/nope")).toEqual({ name: "not-found", params: {} });
    expect(matchRoute("/visit").name).toBe("not-found");
    expect(matchRoute("/visit/").name).toBe("not-found");
    expect(matchRoute("/visit/a/b").name).toBe("not-found");
    expect(matchRoute("/map/extra").name).toBe("not-found");
    expect(matchRoute("").name).toBe("not-found");
  });

  it("does not mistake object property names for routes", () => {
    expect(matchRoute("constructor").name).toBe("not-found");
    expect(matchRoute("/constructor/abc").name).toBe("not-found");
    expect(matchRoute("/__proto__/abc").name).toBe("not-found");
  });

  it("is not-found, not a crash, for a malformed percent escape", () => {
    expect(matchRoute("/visit/%E0%A4%A").name).toBe("not-found");
  });
});
