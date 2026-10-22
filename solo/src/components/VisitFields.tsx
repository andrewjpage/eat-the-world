import { useId } from "react";
import type { DishRatingValue } from "@/components/checkin/DishRatingFields";
import { DishRating, type Dish } from "./DishRating";

/** The earliest date a diary entry can have. The service refuses anything before it. */
export const EARLIEST_DATE = "1900-01-01";

/** When, what you had, how it was and a note: the part of a visit that is the same on check-in and when editing it. */
export function VisitFields({
  visitedOn,
  onDateChange,
  today,
  dish,
  onDishChange,
  dishes,
  countryName,
}: {
  visitedOn: string;
  onDateChange: (date: string) => void;
  /** YYYY-MM-DD; nothing later can be picked. */
  today: string;
  dish: DishRatingValue;
  onDishChange: (next: DishRatingValue) => void;
  dishes: Dish[];
  countryName: string;
}) {
  const dateId = useId();
  return (
    <div className="space-y-6">
      <div>
        <label htmlFor={dateId} className="mb-1.5 block text-sm font-bold text-ink">
          When
        </label>
        <input
          id={dateId}
          type="date"
          className="input"
          min={EARLIEST_DATE}
          max={today}
          value={visitedOn}
          onChange={(e) => onDateChange(e.target.value)}
        />
        {visitedOn !== "" && visitedOn !== today && (
          <p className="mt-1.5 text-sm text-muted">Writing it up afterwards is fine.</p>
        )}
      </div>
      <DishRating dishes={dishes} value={dish} onChange={onDishChange} countryName={countryName} />
    </div>
  );
}
