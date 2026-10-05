import { describe, expect, it } from "vitest";
import { buildIcs, icsEscape, icsDate } from "@/lib/ics";
import { mapsUrl } from "@/lib/maps-url";
import { haversineMetres, nearest } from "@/lib/geo";
import { displayName, flagEmoji, groupByRegion } from "@/lib/countries";
import { londonDate } from "@/lib/time";

describe("londonDate", () => {
  it("handles BST and GMT", () => {
    expect(londonDate("2026-07-01T23:30:00Z")).toBe("2026-07-02");
    expect(londonDate("2026-01-01T23:30:00Z")).toBe("2026-01-01");
  });
  it("throws on invalid", () => expect(() => londonDate("nope")).toThrow());
});

describe("mapsUrl", () => {
  it("encodes name, address and place id", () => {
    const u = mapsUrl({ name: "Café & Co", address: "1 High St, London", google_place_id: "ChIJ97wx" });
    expect(u).toBe(
      "https://www.google.com/maps/search/?api=1&query=Caf%C3%A9%20%26%20Co%2C%201%20High%20St%2C%20London&query_place_id=ChIJ97wx",
    );
  });
  it("omits place id and address when absent", () => {
    expect(mapsUrl({ name: "Lao Cafe" })).toBe("https://www.google.com/maps/search/?api=1&query=Lao%20Cafe");
  });
});

describe("ics", () => {
  const out = buildIcs({
    uid: "plan-1@eattheworld",
    start: new Date("2026-10-10T18:30:00Z"),
    summary: "Dinner; Lao, Cafe",
    location: "1 High St, London",
    description: "Line1\nLine2",
    now: new Date("2026-10-05T09:00:00Z"),
  });
  it("uses CRLF everywhere", () => {
    expect(out.endsWith("\r\n")).toBe(true);
    expect(out.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });
  it("has required fields", () => {
    const lines = out.split("\r\n");
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines).toContain("VERSION:2.0");
    expect(lines.some((l) => l.startsWith("PRODID:"))).toBe(true);
    expect(lines).toContain("UID:plan-1@eattheworld");
    expect(lines).toContain("DTSTAMP:20261005T090000Z");
    expect(lines).toContain("DTSTART:20261010T183000Z");
    expect(lines).toContain("DTEND:20261010T203000Z");
    expect(lines).toContain("END:VCALENDAR");
  });
  it("escapes text", () => {
    expect(out).toContain("SUMMARY:Dinner\\; Lao\\, Cafe");
    expect(out).toContain("DESCRIPTION:Line1\\nLine2");
    expect(icsEscape("a\\b")).toBe("a\\\\b");
  });
  it("folds long lines at 75 octets", () => {
    const long = buildIcs({ uid: "x", start: new Date(0), summary: "x".repeat(200) });
    for (const l of long.split("\r\n")) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    expect(long.replace(/\r\n /g, "")).toContain("SUMMARY:" + "x".repeat(200));
  });
  it("formats dates in UTC", () => expect(icsDate(new Date("2026-03-01T00:00:00Z"))).toBe("20260301T000000Z"));
});

describe("geo", () => {
  it("zero distance", () => expect(haversineMetres({ lat: 51.5, lon: -0.1 }, { lat: 51.5, lon: -0.1 })).toBe(0));
  it("one degree of latitude is about 111.2 km", () => {
    expect(haversineMetres({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(111195, -2);
  });
  it("London to Paris is about 344 km", () => {
    const d = haversineMetres({ lat: 51.5074, lon: -0.1278 }, { lat: 48.8566, lon: 2.3522 });
    expect(d / 1000).toBeGreaterThan(340);
    expect(d / 1000).toBeLessThan(348);
  });
  it("nearest", () => {
    const items = [
      { id: "far", lat: 52, lon: 0 },
      { id: "near", lat: 51.501, lon: -0.1 },
    ];
    expect(nearest({ lat: 51.5, lon: -0.1 }, items)?.item.id).toBe("near");
    expect(nearest({ lat: 0, lon: 0 }, [])).toBeNull();
  });
});

describe("countries", () => {
  it("flag emoji", () => {
    expect(flagEmoji("GB")).toBe("\u{1F1EC}\u{1F1E7}");
    expect(flagEmoji("la")).toBe("\u{1F1F1}\u{1F1E6}");
    expect(flagEmoji("X")).toBe("");
  });
  it("display name fallback", () => {
    expect(displayName({ iso2: "TW", name: "Taiwan", iso_name: "Taiwan, Province of China" })).toBe("Taiwan");
    expect(displayName({ iso2: "TW", iso_name: "Taiwan, Province of China" })).toBe("Taiwan, Province of China");
    expect(displayName({ iso2: "TW" })).toBe("TW");
  });
  it("groups by region", () => {
    const g = groupByRegion([
      { name: "B", m49_group: "Z" },
      { name: "A", m49_group: "Z" },
      { name: "C", m49_group: "Y" },
    ]);
    expect(g.map((x) => x.group)).toEqual(["Y", "Z"]);
    expect(g[1].countries.map((c) => c.name)).toEqual(["A", "B"]);
  });
});
