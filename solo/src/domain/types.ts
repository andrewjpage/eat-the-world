/** Solo-mode data model. Plain data only: the storage layer persists these, the views derive from them. */

/** A restaurant on this device: copied from a seed suggestion, or added by hand. */
export interface SoloRestaurant {
  id: string;
  /** The seed suggestion this was copied from, or null when added by hand. */
  seedId: string | null;
  name: string;
  countryIso2: string;
  address: string | null;
  /** Null when the place has no known position; such a restaurant stays off the map. */
  lat: number | null;
  lon: number | null;
  createdAt: string;
}

export interface SoloVisit {
  id: string;
  restaurantId: string;
  /** The day I ate there, YYYY-MM-DD. May be backdated, never in the future. */
  visitedOn: string;
  dishId: string | null;
  dishOther: string | null;
  rating: 1 | 2 | 3 | 4 | 5 | null;
  note: string | null;
  photoId: string | null;
  createdAt: string;
}

/** A country I had eaten from before the app: no restaurant, no date. */
export interface Backfill {
  countryIso2: string;
  createdAt: string;
}

/** One per country, derived from visits and backfills; never stored. */
export interface SoloStamp {
  countryIso2: string;
  kind: "visit" | "backfilled";
  /** The visit that earned the stamp (the earliest in the country); null for a backfill. */
  visitId: string | null;
  /** YYYY-MM-DD. */
  earnedOn: string;
}

/** What logging a visit did to the country's stamp. */
export type LogOutcome = "stamped" | "upgraded" | "repeat";

/** Seed shapes, generated at build time into JSON (Task 4). */
export interface SeedCountry {
  iso2: string;
  iso_numeric: string | null;
  name: string;
  iso_name: string;
  m49_group: string;
}

export interface SeedRestaurant {
  /** "seed:<slug>". */
  id: string;
  countryIso2: string;
  name: string;
  address: string | null;
  postcode: string | null;
  lat: number;
  lon: number;
  confidence: "curated" | "flagged";
  curatorNote: string | null;
  googlePlaceId: string | null;
}

export interface SeedDish {
  id: string;
  countryIso2: string;
  name: string;
  note: string | null;
}

export interface SeedData {
  generatedAt: string;
  countries: SeedCountry[];
  restaurants: SeedRestaurant[];
  dishes: SeedDish[];
}
