/** "1 visit", "3 visits"; pass the plural when it is not just an s. */
export function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "21 Oct 2026", in the phone's own language and time zone. */
export function formatDay(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "an unknown date";
  return at.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
