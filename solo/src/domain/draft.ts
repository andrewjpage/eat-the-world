import { toAttendanceInput, type DishRatingValue } from "@/components/checkin/DishRatingFields";
import type { SoloVisit } from "./types";

type Rating = SoloVisit["rating"];

/** The dish, rating and note fields as a form holds them, for a visit that already exists. */
export function dishValueOf(visit: SoloVisit): DishRatingValue {
  return {
    dishId: visit.dishId,
    useOther: visit.dishId === null && visit.dishOther !== null,
    otherText: visit.dishOther ?? "",
    rating: visit.rating,
    note: visit.note ?? "",
  };
}

/** What the form says, as the fields a visit stores: trimmed, with blanks as null. */
export function visitFieldsOf(value: DishRatingValue): Pick<SoloVisit, "dishId" | "dishOther" | "rating" | "note"> {
  const fields = toAttendanceInput(value);
  return {
    dishId: fields.signatureDishId,
    dishOther: fields.dishOther,
    rating: fields.rating as Rating,
    note: fields.note,
  };
}
