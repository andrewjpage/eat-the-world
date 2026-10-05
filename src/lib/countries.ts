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

/** Group countries by m49_group; groups and members sorted by name. */
export function groupByRegion<T extends { name: string; m49_group: string }>(
  countries: T[],
): RegionGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const c of countries) {
    if (!map.has(c.m49_group)) map.set(c.m49_group, []);
    map.get(c.m49_group)!.push(c);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, list]) => ({
      group,
      countries: [...list].sort((a, b) => a.name.localeCompare(b.name)),
    }));
}
