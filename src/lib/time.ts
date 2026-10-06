export const TIMEZONE = "Europe/London";

const dateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Europe/London calendar date (YYYY-MM-DD) of an instant. DST-safe. */
export function londonDate(ts: Date | string | number): string {
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) throw new RangeError("Invalid date");
  const parts = dateFmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
