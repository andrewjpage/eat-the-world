import { MAX_DISH_OTHER, MAX_NOTE } from "@/components/checkin/logic";
import { seed as bundledSeed } from "@solo/data/seed";
import type { SoloData } from "@solo/db/schema";
import type { SoloStore } from "@solo/db/store";
import { deriveStamps, isFutureDate, localToday, logOutcome } from "@solo/domain/stamps";
import type { LogOutcome, SeedData, SoloRestaurant, SoloVisit } from "@solo/domain/types";

export interface NewVisitInput {
  /** My own restaurant, a London suggestion (copied on first use), or a place I am adding now. */
  restaurant:
    | { existingId: string }
    | { seedId: string }
    | { name: string; countryIso2: string; address?: string | null; coords?: { lat: number; lon: number } | null };
  /** YYYY-MM-DD, today or earlier. */
  visitedOn: string;
  dishId: string | null;
  dishOther: string | null;
  rating: 1 | 2 | 3 | 4 | 5 | null;
  note: string | null;
  photo: Blob | null;
}

export interface LogResult {
  visit: SoloVisit;
  restaurant: SoloRestaurant;
  /** What the visit did to the country's stamp, judged before it was saved. */
  outcome: LogOutcome;
  /** Whether the visit now has a photo: false when none was given or when it could not be stored. */
  photoSaved: boolean;
}

/** A problem with what was asked for. The message is plain language, safe to show on screen. */
export class VisitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VisitError";
  }
}

/**
 * The visit itself could not be written (the place, if it was new, already had been). `restaurantId` is
 * that place, which is now on the device: retry with `{ existingId: restaurantId }` so a place added by
 * hand is not added a second time. The message is the storage layer's, not for the screen.
 */
export class VisitSaveError extends Error {
  constructor(
    readonly restaurantId: string,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "VisitSaveError";
  }
}

const NO_RESTAURANT = "We couldn't find that restaurant.";
const NO_VISIT = "We couldn't find that visit.";
const NO_NAME = "Give the place a name.";
const NO_COUNTRY = "Pick the country this place cooks.";
const BAD_DATE = "Pick a real date.";
const FUTURE_DATE = "That date is in the future. Pick today or earlier.";
const BAD_RATING = "Ratings go from 1 to 5.";
const PHOTO_NOT_SAVED = "The photo didn't save, so nothing was changed. Try again, or save without it.";
const EARLIEST = "1900-01-01";

const newId = () => crypto.randomUUID();

/** Zero-padded YYYY-MM-DD that exists on the calendar, and not absurdly long ago. */
export function isRealDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < EARLIEST) return false;
  const [y, m, d] = date.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === m - 1 && at.getUTCDate() === d;
}

function checkDate(visitedOn: string, now: Date): string {
  if (!isRealDate(visitedOn)) throw new VisitError(BAD_DATE);
  if (isFutureDate(visitedOn, localToday(now))) throw new VisitError(FUTURE_DATE);
  return visitedOn;
}

export function isRating(rating: unknown): rating is 1 | 2 | 3 | 4 | 5 {
  return typeof rating === "number" && Number.isInteger(rating) && rating >= 1 && rating <= 5;
}

function checkRating(rating: number | null): 1 | 2 | 3 | 4 | 5 | null {
  if (rating === null) return null;
  if (!isRating(rating)) throw new VisitError(BAD_RATING);
  return rating;
}

/** Trimmed; blank becomes null; over `max` is refused with `tooLong`. */
function cleanText(text: string | null, max: number, tooLong: string): string | null {
  const trimmed = text?.trim() ?? "";
  if (trimmed.length > max) throw new VisitError(tooLong);
  return trimmed === "" ? null : trimmed;
}

const cleanNote = (note: string | null) => cleanText(note, MAX_NOTE, `Keep the note under ${MAX_NOTE} characters.`);
const cleanDish = (dish: string | null) =>
  cleanText(dish, MAX_DISH_OTHER, `Keep the dish name under ${MAX_DISH_OTHER} characters.`);

function checkCountry(seed: SeedData, iso2: string): string {
  if (!seed.countries.some((c) => c.iso2 === iso2)) throw new VisitError(NO_COUNTRY);
  return iso2;
}

function validCoords(coords: { lat: number; lon: number } | null | undefined) {
  const ok =
    !!coords &&
    Number.isFinite(coords.lat) &&
    Number.isFinite(coords.lon) &&
    Math.abs(coords.lat) <= 90 &&
    Math.abs(coords.lon) <= 180;
  return ok ? coords : null;
}

/**
 * The restaurant a visit is for. A suggestion I have already copied resolves to my copy, so a
 * second visit there never makes a second restaurant. Nothing is written here.
 */
function resolveRestaurant(
  data: SoloData,
  seed: SeedData,
  ref: NewVisitInput["restaurant"],
  now: Date,
): { restaurant: SoloRestaurant; isNew: boolean } {
  if ("existingId" in ref) {
    const mine = data.restaurants.find((r) => r.id === ref.existingId);
    if (!mine) throw new VisitError(NO_RESTAURANT);
    return { restaurant: mine, isNew: false };
  }

  if ("seedId" in ref) {
    const copy = data.restaurants.find((r) => r.seedId === ref.seedId);
    if (copy) return { restaurant: copy, isNew: false };
    const suggestion = seed.restaurants.find((s) => s.id === ref.seedId);
    if (!suggestion) throw new VisitError(NO_RESTAURANT);
    return {
      restaurant: {
        id: newId(),
        seedId: suggestion.id,
        name: suggestion.name,
        countryIso2: suggestion.countryIso2,
        address: suggestion.address,
        lat: suggestion.lat,
        lon: suggestion.lon,
        createdAt: now.toISOString(),
      },
      isNew: true,
    };
  }

  const name = ref.name.trim();
  if (!name) throw new VisitError(NO_NAME);
  const coords = validCoords(ref.coords);
  return {
    restaurant: {
      id: newId(),
      seedId: null,
      name,
      countryIso2: checkCountry(seed, ref.countryIso2),
      address: ref.address?.trim() || null,
      lat: coords?.lat ?? null,
      lon: coords?.lon ?? null,
      createdAt: now.toISOString(),
    },
    isNew: true,
  };
}

/**
 * Saves one visit. Everything is checked before anything is written. Writes go restaurant, then
 * photo, then visit last, so a failure part-way leaves at worst an unused restaurant, never a lost
 * visit; if the visit is what fails, the `VisitSaveError` names that restaurant for the retry. A photo
 * that cannot be stored (a full phone) does not stop the visit: `photoSaved` says so.
 *
 * `data` is what is on the device now, from which the stamp outcome and the restaurant copy are
 * worked out, so read it fresh just before calling.
 */
export async function logVisit(
  store: SoloStore,
  data: SoloData,
  seed: SeedData,
  input: NewVisitInput,
  now: Date = new Date(),
): Promise<LogResult> {
  const visitedOn = checkDate(input.visitedOn, now);
  const rating = checkRating(input.rating);
  const note = cleanNote(input.note);
  const dishOther = input.dishId ? null : cleanDish(input.dishOther);
  const { restaurant, isNew } = resolveRestaurant(data, seed, input.restaurant, now);
  const outcome = logOutcome(deriveStamps(data.restaurants, data.visits, data.backfills), restaurant.countryIso2);

  if (isNew) await store.putRestaurant(restaurant);

  let photoId: string | null = null;
  if (input.photo) {
    const id = newId();
    try {
      await store.putPhoto(id, input.photo);
      photoId = id;
    } catch (error) {
      console.warn("Eat the World: the photo could not be stored; saving the visit without it", error);
    }
  }

  const visit: SoloVisit = {
    id: newId(),
    restaurantId: restaurant.id,
    visitedOn,
    dishId: input.dishId,
    dishOther,
    rating,
    note,
    photoId,
    createdAt: now.toISOString(),
  };
  try {
    await store.putVisit(visit);
  } catch (error) {
    if (photoId) await store.deletePhoto(photoId).catch(() => {});
    throw new VisitSaveError(restaurant.id, error);
  }
  return { visit, restaurant, outcome, photoSaved: photoId !== null };
}

/**
 * Changes a visit. A key left out stays as it was; `photo: null` removes the photo and a Blob
 * replaces it. The stamp follows by itself, because stamps are derived from visits.
 */
export async function updateVisit(
  store: SoloStore,
  id: string,
  patch: Partial<Omit<NewVisitInput, "restaurant">>,
): Promise<void> {
  const visit = (await store.load()).visits.find((v) => v.id === id);
  if (!visit) throw new VisitError(NO_VISIT);

  const next: SoloVisit = { ...visit };
  // The edit page sends the date back whether or not it changed. A visit logged in a time zone ahead of
  // home can already be dated tomorrow, so only a new date is checked.
  if (patch.visitedOn !== undefined && patch.visitedOn !== visit.visitedOn) {
    next.visitedOn = checkDate(patch.visitedOn, new Date());
  }
  if (patch.rating !== undefined) next.rating = checkRating(patch.rating);
  if (patch.note !== undefined) next.note = cleanNote(patch.note);
  if (patch.dishId !== undefined) next.dishId = patch.dishId;
  if (patch.dishOther !== undefined) next.dishOther = cleanDish(patch.dishOther);
  // Whichever of the two the change names last wins; an approved dish beats typed text.
  if (patch.dishId) next.dishOther = null;
  else if (patch.dishOther !== undefined && next.dishOther) next.dishId = null;

  // The old photo is deleted only once the visit no longer names it.
  const oldPhotoId = patch.photo !== undefined ? visit.photoId : null;
  if (patch.photo === null) {
    next.photoId = null;
  } else if (patch.photo) {
    const photoId = newId();
    try {
      await store.putPhoto(photoId, patch.photo);
    } catch (error) {
      console.warn("Eat the World: the photo could not be stored", error);
      throw new VisitError(PHOTO_NOT_SAVED);
    }
    next.photoId = photoId;
  }

  try {
    await store.putVisit(next);
  } catch (error) {
    if (next.photoId && next.photoId !== visit.photoId) await store.deletePhoto(next.photoId).catch(() => {});
    throw error;
  }
  if (oldPhotoId) await store.deletePhoto(oldPhotoId).catch(() => {});
}

/** Renames a place, moves it to another country (its stamp moves with it) or changes its address. */
export async function updateRestaurant(
  store: SoloStore,
  id: string,
  patch: { name?: string; countryIso2?: string; address?: string | null },
  seed: SeedData = bundledSeed,
): Promise<void> {
  const restaurant = (await store.load()).restaurants.find((r) => r.id === id);
  if (!restaurant) throw new VisitError(NO_RESTAURANT);

  const next: SoloRestaurant = { ...restaurant };
  if (patch.name !== undefined) {
    next.name = patch.name.trim();
    if (!next.name) throw new VisitError(NO_NAME);
  }
  if (patch.countryIso2 !== undefined) next.countryIso2 = checkCountry(seed, patch.countryIso2);
  if (patch.address !== undefined) next.address = patch.address?.trim() || null;
  await store.putRestaurant(next);
}

/** Deletes a visit and its photo. The stamp follows: the next visit in the country takes it, or it goes. */
export async function removeVisit(store: SoloStore, id: string): Promise<void> {
  await store.deleteVisit(id);
}

/** What the stamp moment says. Friendly and short; every title names the country. */
export function outcomeCopy(outcome: LogOutcome, countryName: string): { title: string; body: string } {
  switch (outcome) {
    case "stamped":
      return { title: `${countryName}, stamped!`, body: "Your first meal from here is in your passport." };
    case "upgraded":
      return {
        title: `${countryName} upgraded!`,
        body: "Your before-the-app memory is now a full stamp.",
      };
    case "repeat":
      return {
        title: `More ${countryName}`,
        body: "Logged as another visit. The stamp was already yours.",
      };
  }
}
