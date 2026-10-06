import { readFileSync, existsSync } from "node:fs";
import { parse } from "csv-parse/sync";
import { flagEmoji } from "../../src/lib/countries";

export interface CountryRow {
  iso2: string;
  iso_numeric: string;
  name: string;
  iso_name: string;
  flag_emoji: string;
  m49_region: string;
  m49_group: string;
}

const OVERRIDES: Record<string, { region: string; group: string }> = {
  TW: { region: "Asia", group: "Eastern Asia" },
  AQ: { region: "Antarctica", group: "Antarctica" },
};

function readCsv(path: string): Record<string, string>[] {
  return parse(readFileSync(path, "utf8"), {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    trim: true,
  });
}

/** Build the 249 country rows from the ISO CSV plus display-name overrides. */
export function loadCountries(isoPath: string, namesPath: string): CountryRow[] {
  const display = new Map<string, string>();
  if (existsSync(namesPath)) {
    for (const r of readCsv(namesPath)) display.set(r.iso2.toUpperCase(), r.name);
  } else {
    console.warn(`WARNING: ${namesPath} not found; falling back to ISO names`);
  }
  const rows = readCsv(isoPath).map((r): CountryRow => {
    const iso2 = r["alpha-2"].toUpperCase();
    const ov = OVERRIDES[iso2];
    const region = r["region"] || ov?.region || "";
    const group = r["intermediate-region"] || r["sub-region"] || ov?.group || "";
    return {
      iso2,
      iso_numeric: r["country-code"].padStart(3, "0"),
      name: display.get(iso2) || r["name"],
      iso_name: r["name"],
      flag_emoji: flagEmoji(iso2),
      m49_region: region,
      m49_group: group,
    };
  });
  return rows;
}

export function assertCountries(rows: CountryRow[]): void {
  if (rows.length !== 249) throw new Error(`Expected 249 countries, got ${rows.length}`);
  if (new Set(rows.map((r) => r.iso2)).size !== 249) throw new Error("Duplicate iso2 codes");
  const bad = rows.filter((r) => !r.m49_region || !r.m49_group);
  if (bad.length) throw new Error(`Countries without a region: ${bad.map((r) => r.iso2).join(", ")}`);
}
