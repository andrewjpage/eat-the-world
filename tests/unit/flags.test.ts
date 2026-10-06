import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import { describe, expect, it } from "vitest";

// Brief section 6: loop over all 249 codes, because the file count alone proves nothing.
const ROOT = join(__dirname, "..", "..");
const FLAGS = join(ROOT, "node_modules", "flag-icons");

const rows = parse(readFileSync(join(ROOT, "seed", "iso-3166-all.csv")), {
  columns: true,
  skip_empty_lines: true,
}) as { "alpha-2": string }[];
const codes = rows.map((r) => r["alpha-2"].toLowerCase());
const css = readFileSync(join(FLAGS, "css", "flag-icons.min.css"), "utf8");

describe("flag-icons covers every ISO 3166-1 code", () => {
  it("has 249 distinct codes in the seed", () => {
    expect(new Set(codes).size).toBe(249);
  });

  it.each(codes)("%s has a 4x3 SVG and a .fi-%s class", (code) => {
    expect(existsSync(join(FLAGS, "flags", "4x3", `${code}.svg`))).toBe(true);
    expect(css).toContain(`.fi-${code}{`);
  });
});
