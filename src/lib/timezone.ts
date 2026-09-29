/**
 * Timezone helpers built on the built-in Intl API (no library), shared by
 * the server and the browser.
 *
 * The model:
 *   - Every stored DateTime (sessions, holds) is a real UTC instant.
 *   - A tutor's weekly hours and one-off exceptions are "HH:mm" wall-clock
 *     times in the tutor's own IANA timezone (Tutor.timeZone), converted to
 *     instants per calendar date, so daylight saving is handled.
 *   - Everything shown to a person is formatted in THEIR timezone: students
 *     see their browser's zone, tutors see their own.
 *
 * Calendar dates travel as "YYYY-MM-DD" strings; they only mean a span of
 * time together with a timezone.
 */

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatters.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The browser's (or server's) own timezone. */
export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** All IANA zones this runtime knows, for pickers. */
export function allTimeZones(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  const zones = supported ? supported("timeZone") : [];
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
}

interface ZonedParts {
  /** YYYY-MM-DD in that zone */
  date: string;
  /** minutes since that zone's midnight, 0–1439 */
  minutes: number;
  /** 0 = Sunday … 6 = Saturday */
  dayOfWeek: number;
}

function rawParts(instant: Date, timeZone: string) {
  const out: Record<string, number> = {};
  for (const p of partsFormatter(timeZone).formatToParts(instant)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** What a wall clock in `timeZone` reads at `instant`. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const p = rawParts(instant, timeZone);
  const date = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  return { date, minutes: p.hour * 60 + p.minute, dayOfWeek: dayOfWeek(date) };
}

/** Offset of `timeZone` from UTC at `instant`, in ms (New York in winter: -5h). */
function offsetMs(instant: Date, timeZone: string): number {
  const p = rawParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant when a wall clock in `timeZone` reads `minutes` past midnight
 * on `date`. `minutes` may be 1440 (the next midnight). Around a daylight
 * saving change: a time that happens twice resolves to the first one, and a
 * time that's skipped (spring forward) resolves to the same clock time plus
 * the jump (2:30am -> 3:30am).
 */
export function zonedTimeToUtc(date: string, minutes: number, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d) + minutes * 60 * 1000;
  // The offsets in force a little before and after this wall time; outside a
  // DST change they're equal and both candidates are the same instant.
  const halfDay = 12 * 60 * 60 * 1000;
  const candidates = [
    wall - offsetMs(new Date(wall - halfDay), timeZone),
    wall - offsetMs(new Date(wall + halfDay), timeZone),
  ];
  const matching = candidates.filter((utc) => utc + offsetMs(new Date(utc), timeZone) === wall);
  return new Date(matching.length ? Math.min(...matching) : Math.max(...candidates));
}

/** Start of `date` in `timeZone`. */
export function startOfDay(date: string, timeZone: string): Date {
  return zonedTimeToUtc(date, 0, timeZone);
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

export function todayIn(timeZone: string): string {
  return zonedParts(new Date(), timeZone).date;
}

/** "15:00" -> 900 */
export function hhmmToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Short zone name at that instant, e.g. "CDT", or "GMT+5:30" where there's no abbreviation. */
export function zoneAbbreviation(instant: Date, timeZone: string): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
    .formatToParts(instant)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? timeZone;
}

/** e.g. "Central Daylight Time" */
export function zoneLongName(instant: Date, timeZone: string): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "long" })
    .formatToParts(instant)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? timeZone;
}

/** "Thu, Oct 1, 5:00 PM CDT" — for emails and lists. */
export function formatDateTime(instant: Date, timeZone: string): string {
  const text = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(instant);
  return `${text} ${zoneAbbreviation(instant, timeZone)}`;
}

/** The US zones most people will want, shown first in pickers. */
export const COMMON_TIME_ZONES: { zone: string; name: string }[] = [
  { zone: "America/New_York", name: "Eastern Time" },
  { zone: "America/Chicago", name: "Central Time" },
  { zone: "America/Denver", name: "Mountain Time" },
  { zone: "America/Phoenix", name: "Mountain Time – Arizona" },
  { zone: "America/Los_Angeles", name: "Pacific Time" },
  { zone: "America/Anchorage", name: "Alaska Time" },
  { zone: "Pacific/Honolulu", name: "Hawaii Time" },
];

/** "UTC−5", "UTC+5:30", "UTC" — the zone's offset right now. */
export function utcOffsetLabel(timeZone: string, at: Date = new Date()): string {
  const minutes = Math.round(offsetMs(at, timeZone) / 60000);
  if (minutes === 0) return "UTC";
  const sign = minutes > 0 ? "+" : "−";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

/**
 * Picker label: "Central Time (CDT)" for the common US zones, otherwise the
 * place and current offset, e.g. "London, Europe (UTC+1)".
 */
export function timeZoneOptionLabel(timeZone: string, at: Date = new Date()): string {
  const common = COMMON_TIME_ZONES.find((z) => z.zone === timeZone);
  if (common) return `${common.name} (${zoneAbbreviation(at, timeZone)})`;
  const parts = timeZone.split("/");
  const place = parts.slice(1).reverse().join(", ").replace(/_/g, " ");
  return place ? `${place}, ${parts[0]} (${utcOffsetLabel(timeZone, at)})` : `${timeZone} (${utcOffsetLabel(timeZone, at)})`;
}
