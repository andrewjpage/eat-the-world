/** Pure validation and helpers shared by the suggest route and the curator console. */

export const MAX_NAME = 200;
export const MAX_NOTE = 1000;

export function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (!t) return null;
  return t.length > max ? null : t;
}

/** http(s) URL under 300 chars, or null. */
export function cleanWebsite(v: unknown): string | null {
  const t = cleanText(v, 300);
  if (!t) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname.includes(".")) return null;
    const out = u.toString();
    // The database also caps it at 300 (submissions_website_check).
    return out.length <= 300 ? out : null;
  } catch {
    return null;
  }
}

/** Google place ids are opaque URL-safe strings (ChIJ...). Store the id only. */
export function cleanPlaceId(v: unknown): string | null {
  const t = cleanText(v, 200);
  return t && /^[A-Za-z0-9_-]{10,200}$/.test(t) ? t : null;
}

export interface SuggestionInput {
  countryIso2: string;
  name: string;
  address: string | null;
  postcode: string;
  googlePlaceId: string | null;
  website: string | null;
  note: string | null;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Validates the JSON body of POST /api/submissions. The postcode itself is checked by the geocoder. */
export function parseSuggestion(raw: unknown): ParseResult<SuggestionInput> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "That didn't look right. Please try again." };
  }
  const b = raw as Record<string, unknown>;
  const iso = typeof b.countryIso2 === "string" ? b.countryIso2.trim().toUpperCase() : "";
  if (!/^[A-Z]{2}$/.test(iso)) return { ok: false, error: "Pick a country first." };

  const name = cleanText(b.name, MAX_NAME);
  if (!name) return { ok: false, error: "Add the restaurant's name (up to 200 characters)." };

  const postcode = typeof b.postcode === "string" ? b.postcode.trim() : "";
  if (!postcode) return { ok: false, error: "Add the restaurant's postcode." };
  if (postcode.length > 20) return { ok: false, error: "That postcode looks too long." };

  const optional = (key: string, max: number, label: string): ParseResult<string | null> => {
    const v = b[key];
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
      return { ok: true, value: null };
    }
    const t = cleanText(v, max);
    return t ? { ok: true, value: t } : { ok: false, error: `Shorten the ${label} (up to ${max} characters).` };
  };

  const address = optional("address", 300, "address");
  if (!address.ok) return address;
  const note = optional("note", MAX_NOTE, "note");
  if (!note.ok) return note;

  let website: string | null = null;
  if (typeof b.website === "string" && b.website.trim()) {
    website = cleanWebsite(b.website);
    if (!website) return { ok: false, error: "That website doesn't look like a web address." };
  }
  let googlePlaceId: string | null = null;
  if (typeof b.googlePlaceId === "string" && b.googlePlaceId.trim()) {
    googlePlaceId = cleanPlaceId(b.googlePlaceId);
    if (!googlePlaceId) {
      return { ok: false, error: "That Google place ID doesn't look right. Leave it blank if unsure." };
    }
  }

  return {
    ok: true,
    value: { countryIso2: iso, name, address: address.value, postcode, googlePlaceId, website, note: note.value },
  };
}

/** "Lao Cafe & Bar" -> "lao-cafe-and-bar". Matches sets.slug: ^[a-z0-9-]+$. */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/** Upper-case, de-duplicated, valid-looking ISO codes in a stable order. */
export function cleanIsoList(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const set = new Set<string>();
  for (const v of list) {
    if (typeof v !== "string") continue;
    const c = v.trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(c)) set.add(c);
  }
  return [...set].sort();
}

export const RESTAURANT_STATUSES = ["active", "reported_closed", "closed", "pending"] as const;
export const CONFIDENCES = ["curated", "community", "flagged"] as const;
export type RestaurantStatus = (typeof RESTAURANT_STATUSES)[number];
export type Confidence = (typeof CONFIDENCES)[number];

/** True when a restaurant with this status keeps its country listed (brief section 2). */
export function isEligibleStatus(status: string): boolean {
  return status === "active" || status === "reported_closed";
}

/** One line telling the curator what a status change does to the country's listing, or null. */
export function statusImpact(opts: {
  countryName: string;
  from: string;
  to: string;
  eligibleCount: number;
}): string | null {
  const { countryName, from, to, eligibleCount } = opts;
  const was = isEligibleStatus(from);
  const will = isEligibleStatus(to);
  if (was && !will && eligibleCount <= 1) {
    return `${countryName} will become unlisted: this is its last eligible restaurant.`;
  }
  if (!was && will && eligibleCount === 0) return `${countryName} will become listed in London.`;
  return null;
}

export interface CountryOption {
  iso2: string;
  name: string;
}
