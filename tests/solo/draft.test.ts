import { describe, expect, it } from "vitest";
import { EMPTY_DISH_RATING } from "@/components/checkin/DishRatingFields";
import { dishValueOf, visitFieldsOf } from "@solo/domain/draft";
import type { SoloVisit } from "@solo/domain/types";

const visit = (over: Partial<SoloVisit> = {}): SoloVisit => ({
  id: "v1",
  restaurantId: "r1",
  visitedOn: "2026-10-01",
  dishId: null,
  dishOther: null,
  rating: null,
  note: null,
  photoId: null,
  createdAt: "2026-10-01T19:00:00.000Z",
  ...over,
});

describe("visit form fields", () => {
  it("round-trips an approved dish, a rating and a note", () => {
    const v = visit({ dishId: "seed:dish:NG:suya", rating: 4, note: "Smoky" });
    expect(visitFieldsOf(dishValueOf(v))).toEqual({ dishId: "seed:dish:NG:suya", dishOther: null, rating: 4, note: "Smoky" });
  });

  it("round-trips typed dish text as 'something else'", () => {
    const value = dishValueOf(visit({ dishOther: "Pepper soup" }));
    expect(value).toMatchObject({ dishId: null, useOther: true, otherText: "Pepper soup" });
    expect(visitFieldsOf(value)).toMatchObject({ dishId: null, dishOther: "Pepper soup" });
  });

  it("starts an untouched form empty and saves nothing from it", () => {
    expect(dishValueOf(visit())).toEqual(EMPTY_DISH_RATING);
    expect(visitFieldsOf(EMPTY_DISH_RATING)).toEqual({ dishId: null, dishOther: null, rating: null, note: null });
  });

  it("trims, and saves 'something else' with no text as no dish", () => {
    expect(visitFieldsOf({ ...EMPTY_DISH_RATING, useOther: true, otherText: "   ", note: "  hi  " })).toEqual({
      dishId: null,
      dishOther: null,
      rating: null,
      note: "hi",
    });
  });
});
