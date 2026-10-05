/** Google Maps search URL for a restaurant (Maps URLs API). */
export function mapsUrl(r: {
  name: string;
  address?: string | null;
  google_place_id?: string | null;
}): string {
  const query = [r.name, r.address].filter(Boolean).join(", ");
  let url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  if (r.google_place_id) url += `&query_place_id=${encodeURIComponent(r.google_place_id)}`;
  return url;
}
