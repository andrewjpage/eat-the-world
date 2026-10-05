import { describe, expect, it } from "vitest";
import {
  formatWhen,
  icsFilename,
  isUpcoming,
  londonToInstant,
  nextFridayLondon,
  parsePlanDate,
  planIcs,
  planWhatsAppUrl,
  summariseRsvps,
} from "@/components/plans/logic";
import {
  arrangePeople,
  dishLabel,
  recapFooter,
  recapPointsLabel,
  recapText,
  recapTotal,
  recapWhatsAppUrl,
} from "@/components/recap/logic";

describe("londonToInstant", () => {
  it("applies BST in summer and GMT in winter", () => {
    expect(londonToInstant("2026-07-04", "19:30")?.toISOString()).toBe("2026-07-04T18:30:00.000Z");
    expect(londonToInstant("2026-12-04", "19:30")?.toISOString()).toBe("2026-12-04T19:30:00.000Z");
  });
  it("handles the clock change days", () => {
    expect(londonToInstant("2026-03-29", "00:30")?.toISOString()).toBe("2026-03-29T00:30:00.000Z");
    expect(londonToInstant("2026-03-29", "12:00")?.toISOString()).toBe("2026-03-29T11:00:00.000Z");
    expect(londonToInstant("2026-10-25", "12:00")?.toISOString()).toBe("2026-10-25T12:00:00.000Z");
  });
  it("rejects the skipped hour and bad input", () => {
    expect(londonToInstant("2026-03-29", "01:30")).toBeNull();
    expect(londonToInstant("2026-02-31", "19:00")).toBeNull();
    expect(londonToInstant("nope", "19:00")).toBeNull();
    expect(londonToInstant("2026-07-04", "25:00")).toBeNull();
  });
  it("round-trips through formatWhen", () => {
    expect(formatWhen(londonToInstant("2026-07-04", "19:30")!)).toContain("19:30");
  });
});

describe("plans", () => {
  it("groups RSVPs by answer, sorted", () => {
    const s = summariseRsvps([
      { response: "yes", name: "Zed" },
      { response: "yes", name: "Amy" },
      { response: "maybe", name: "Bo" },
      { response: "no", name: "Cy" },
    ]);
    expect(s).toEqual({ yes: ["Amy", "Zed"], maybe: ["Bo"], no: ["Cy"] });
  });

  it("lists only open, recent plans", () => {
    const now = new Date("2026-10-05T12:00:00Z");
    expect(isUpcoming({ status: "proposed", proposed_for: "2026-10-06T18:00:00Z" }, now)).toBe(true);
    expect(isUpcoming({ status: "booked", proposed_for: "2026-10-05T10:00:00Z" }, now)).toBe(true);
    expect(isUpcoming({ status: "booked", proposed_for: "2026-10-05T08:00:00Z" }, now)).toBe(false);
    expect(isUpcoming({ status: "cancelled", proposed_for: "2026-10-06T18:00:00Z" }, now)).toBe(false);
    expect(isUpcoming({ status: "done", proposed_for: "2026-10-06T18:00:00Z" }, now)).toBe(false);
  });

  it("builds a two hour RFC 5545 event with CRLF line ends", () => {
    const ics = planIcs(
      {
        id: "11111111-1111-4111-8111-111111111111",
        proposed_for: "2026-07-04T18:30:00Z",
        restaurant: { name: "Pho, Soho; Co", address: "1 High St", postcode: "W1" },
      },
      "Supper Club",
      "https://example.test/group/g",
      new Date("2026-07-01T09:00:00Z"),
    );
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(ics).toContain("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n");
    expect(ics).toContain("UID:11111111-1111-4111-8111-111111111111@eattheworld\r\n");
    expect(ics).toContain("DTSTART:20260704T183000Z\r\n");
    expect(ics).toContain("DTEND:20260704T203000Z\r\n");
    expect(ics).toContain("SUMMARY:Dinner at Pho\\, Soho\\; Co\r\n");
    expect(ics).toContain("LOCATION:Pho\\, Soho\\; Co\\, 1 High St\\, W1\r\n");
    expect(ics).toContain("END:VEVENT\r\nEND:VCALENDAR\r\n");
  });

  it("makes safe file names", () => {
    expect(icsFilename("Café Rouge & Sons")).toBe("dinner-cafe-rouge-sons.ics");
    expect(icsFilename("???")).toBe("dinner-plan.ics");
  });

  it("builds the WhatsApp link with restaurant, date and absolute group link", () => {
    const u = new URL(
      planWhatsAppUrl({ restaurantName: "Pho", proposedFor: "2026-07-04T18:30:00Z", groupUrl: "https://x.test/group/g" }),
    );
    expect(u.origin + u.pathname).toBe("https://wa.me/");
    const text = u.searchParams.get("text")!;
    expect(text).toContain("Pho");
    expect(text).toContain("Sat 4 Jul");
    expect(text).toContain("19:30");
    expect(text).toContain("https://x.test/group/g");
  });
});

describe("recap", () => {
  it("prefers the approved dish and trims", () => {
    expect(dishLabel("Pad Thai", "other")).toBe("Pad Thai");
    expect(dishLabel(null, "  Mystery stew ")).toBe("Mystery stew");
    expect(dishLabel(null, "  ")).toBeNull();
  });

  it("orders people by points and counts the overflow", () => {
    const mk = (name: string, points: number) => ({ name, points, dish: null, rating: null });
    const { shown, more } = arrangePeople([mk("B", 10), mk("A", 10), mk("C", 20), mk("D", 0)], 3);
    expect(shown.map((p) => p.name)).toEqual(["C", "A", "B"]);
    expect(more).toBe(1);
  });

  it("puts confirmed people before pending ones at equal points", () => {
    const { shown } = arrangePeople([
      { name: "A", points: 0, state: "pending" as const },
      { name: "B", points: 0, state: "repeat" as const },
      { name: "C", points: 12, state: "stamped" as const },
    ]);
    expect(shown.map((p) => p.name)).toEqual(["C", "B", "A"]);
  });

  it("labels each person and never shows a sad zero", () => {
    expect(recapPointsLabel({ state: "stamped", points: 27 })).toEqual({ text: "+27", isPoints: true });
    expect(recapPointsLabel({ state: "waiting", points: 0 })).toEqual({ text: "Stamp waiting", isPoints: false });
    expect(recapPointsLabel({ state: "repeat", points: 0 })).toEqual({ text: "Repeat visit", isPoints: false });
    expect(recapPointsLabel({ state: "pending", points: 0 })).toEqual({ text: "Confirming…", isPoints: false });

    const stamped = { state: "stamped" as const, points: 20 };
    const pending = { state: "pending" as const, points: 99 }; // never counted
    const repeat = { state: "repeat" as const, points: 0 };
    const waiting = { state: "waiting" as const, points: 0 };
    expect(recapTotal([stamped, pending, repeat])).toBe(20);
    expect(recapFooter([stamped, pending])).toBe("20 points on the table");
    expect(recapFooter([repeat, waiting])).toBe("Stamps on the way");
    expect(recapFooter([repeat, pending])).toBe("Stamps on the way");
    expect(recapFooter([repeat])).toBe("Back for seconds");
  });

  it("writes the share text", () => {
    const t = recapText({
      restaurantName: "Pho",
      countryName: "Vietnam",
      names: ["Amy", "Bo", "Cy"],
      totalPoints: 54,
      link: "https://x.test/visit/1",
    });
    expect(t).toBe("Stamped Vietnam at Pho with Amy, Bo and Cy. 54 points on the table. https://x.test/visit/1");
    expect(recapText({ restaurantName: "Pho", countryName: "Vietnam", names: [], totalPoints: 0, link: "L" })).toBe(
      "Stamped Vietnam at Pho. L",
    );
    expect(recapWhatsAppUrl("a b")).toBe("https://wa.me/?text=a%20b");
  });
});

describe("plan date defaults", () => {
  it("picks this Friday, or next week's once Friday dinner time has passed (London)", () => {
    // Wed 8 Oct 2025, 10:00 BST
    expect(nextFridayLondon(new Date("2025-10-08T09:00:00Z"))).toBe("2025-10-10");
    // Fri 10 Oct, 18:00 BST: still tonight
    expect(nextFridayLondon(new Date("2025-10-10T17:00:00Z"))).toBe("2025-10-10");
    // Fri 10 Oct, 20:00 BST: next week
    expect(nextFridayLondon(new Date("2025-10-10T19:00:00Z"))).toBe("2025-10-17");
    // Sat 11 Oct, 00:30 BST is still Friday 23:30 UTC: London says Saturday
    expect(nextFridayLondon(new Date("2025-10-10T23:30:00Z"))).toBe("2025-10-17");
    // Across the month and the clocks going back (Sun 26 Oct)
    expect(nextFridayLondon(new Date("2025-10-25T12:00:00Z"))).toBe("2025-10-31");
  });

  it("accepts only a real date from today to a year ahead", () => {
    const now = new Date("2025-10-08T09:00:00Z");
    expect(parsePlanDate("2025-10-08", now)).toBe("2025-10-08");
    expect(parsePlanDate("2025-12-24", now)).toBe("2025-12-24");
    expect(parsePlanDate("2025-10-07", now)).toBeNull();
    expect(parsePlanDate("2027-01-01", now)).toBeNull();
    expect(parsePlanDate("2025-02-31", now)).toBeNull();
    expect(parsePlanDate("tomorrow", now)).toBeNull();
    expect(parsePlanDate(undefined, now)).toBeNull();
    expect(parsePlanDate(["2025-10-09"], now)).toBeNull();
  });
});
