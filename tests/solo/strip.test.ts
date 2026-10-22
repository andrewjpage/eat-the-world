import { describe, expect, it } from "vitest";
import type { PassportCountry } from "@/lib/passport";
import { STRIP_CAP, stampStrip } from "@solo/domain/strip";

const country = (iso2: string, state: PassportCountry["state"], date: string | null = null): PassportCountry => ({
  iso2,
  name: `Country ${iso2}`,
  region: "Anywhere",
  state,
  date,
  verification: null,
});

const day = (d: string) => `${d}T12:00:00Z`;

const isoOf = (list: PassportCountry[]) => list.map((c) => c.iso2);

describe("stampStrip", () => {
  it("is empty when there is no stamp, however many countries are listed", () => {
    const none = [country("AA", "listed"), country("BB", "unlisted"), country("CC", "uncharted")];
    expect(stampStrip(none)).toEqual({ shown: [], total: 0 });
  });

  it("leaves out countries that are not stamped", () => {
    const { shown, total } = stampStrip([
      country("AA", "listed"),
      country("BB", "stamped", day("2026-10-01")),
      country("CC", "unlisted"),
    ]);
    expect(isoOf(shown)).toEqual(["BB"]);
    expect(total).toBe(1);
  });

  it("puts visit stamps first, newest first", () => {
    const { shown } = stampStrip([
      country("AA", "stamped", day("2026-10-03")),
      country("BB", "stamped", day("2026-10-09")),
      country("CC", "stamped", day("2026-10-05")),
    ]);
    expect(isoOf(shown)).toEqual(["BB", "CC", "AA"]);
  });

  it("breaks a tie between visit stamps by name", () => {
    const { shown } = stampStrip([
      country("ZZ", "stamped", day("2026-10-03")),
      country("AA", "stamped", day("2026-10-03")),
    ]);
    expect(isoOf(shown)).toEqual(["AA", "ZZ"]);
  });

  it("follows the visit stamps with the memories, alphabetically", () => {
    const { shown } = stampStrip([
      country("MM", "backfilled"),
      country("AA", "backfilled"),
      country("VV", "stamped", day("2026-10-01")),
      country("ZZ", "backfilled"),
    ]);
    expect(isoOf(shown)).toEqual(["VV", "AA", "MM", "ZZ"]);
  });

  it("shows at most twelve and still counts them all", () => {
    expect(STRIP_CAP).toBe(12);
    // Fifteen stamps: five visits (days 1 to 5) and ten memories.
    const visits = [1, 2, 3, 4, 5].map((n) => country(`V${n}`, "stamped", day(`2026-10-0${n}`)));
    const memories = "ABCDEFGHIJ".split("").map((letter) => country(`M${letter}`, "backfilled"));
    const { shown, total } = stampStrip([...memories, ...visits]);

    expect(total).toBe(15);
    expect(shown).toHaveLength(12);
    // The cap cuts the memories, never the visit stamps.
    expect(isoOf(shown)).toEqual(["V5", "V4", "V3", "V2", "V1", "MA", "MB", "MC", "MD", "ME", "MF", "MG"]);
  });

  it("does not reorder the countries it was given", () => {
    const input = [country("BB", "backfilled"), country("AA", "backfilled")];
    stampStrip(input);
    expect(isoOf(input)).toEqual(["BB", "AA"]);
  });
});
