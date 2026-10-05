/** Flag emoji from an ISO 3166-1 alpha-2 code (regional indicator symbols). */
export function flagEmoji(iso2: string): string {
  const c = iso2.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return "";
  return String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

/** Short common name, falling back to the ISO name, then the code. */
export function displayName(c: {
  iso2: string;
  name?: string | null;
  iso_name?: string | null;
}): string {
  return c.name || c.iso_name || c.iso2;
}

export interface RegionGroup<T> {
  group: string;
  countries: T[];
}

/** UN M49 groups roughly west to east by continent, so lists read like a passport. */
export const REGION_ORDER = [
  "Northern America",
  "Central America",
  "Caribbean",
  "South America",
  "Northern Europe",
  "Western Europe",
  "Southern Europe",
  "Eastern Europe",
  "Northern Africa",
  "Western Africa",
  "Middle Africa",
  "Eastern Africa",
  "Southern Africa",
  "Western Asia",
  "Central Asia",
  "Southern Asia",
  "Eastern Asia",
  "South-eastern Asia",
  "Australia and New Zealand",
  "Melanesia",
  "Micronesia",
  "Polynesia",
] as const;

/** Position in REGION_ORDER; unknown groups (e.g. Antarctica) sort last. */
export function regionRank(group: string): number {
  const i = (REGION_ORDER as readonly string[]).indexOf(group);
  return i === -1 ? REGION_ORDER.length : i;
}

/** Popular cuisines, offered first when backfilling (the first six are the ones the brief says the group has done). */
export const POPULAR_ISO2 = ["ES", "FR", "IT", "TR", "CN", "IN", "JP", "TH", "MX", "GR", "LB", "US"];

/** Group countries by m49_group; groups in REGION_ORDER (then by name), members by name. */
export function groupByRegion<T extends { name: string; m49_group: string }>(
  countries: T[],
): RegionGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const c of countries) {
    if (!map.has(c.m49_group)) map.set(c.m49_group, []);
    map.get(c.m49_group)!.push(c);
  }
  return [...map.entries()]
    .sort(([a], [b]) => regionRank(a) - regionRank(b) || a.localeCompare(b))
    .map(([group, list]) => ({
      group,
      countries: [...list].sort((a, b) => a.name.localeCompare(b.name)),
    }));
}
