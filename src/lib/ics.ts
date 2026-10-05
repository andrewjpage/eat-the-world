export interface IcsEvent {
  uid: string;
  start: Date;
  end?: Date;
  summary: string;
  location?: string;
  description?: string;
  now?: Date;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function icsDate(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(
    d.getUTCHours(),
  )}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** RFC 5545 TEXT escaping. */
export function icsEscape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Fold lines to 75 octets (continuation lines start with a space). */
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let curBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (curBytes + b > limit) {
      out.push(cur);
      cur = "";
      curBytes = 0;
      limit = 74;
    }
    cur += ch;
    curBytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

/** Build a one-event VCALENDAR. Defaults to a 2 hour event. */
export function buildIcs(ev: IcsEvent): string {
  const end = ev.end ?? new Date(ev.start.getTime() + 2 * 3600_000);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Eat the World//London//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${ev.uid}`,
    `DTSTAMP:${icsDate(ev.now ?? new Date())}`,
    `DTSTART:${icsDate(ev.start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsEscape(ev.summary)}`,
  ];
  if (ev.location) lines.push(`LOCATION:${icsEscape(ev.location)}`);
  if (ev.description) lines.push(`DESCRIPTION:${icsEscape(ev.description)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
