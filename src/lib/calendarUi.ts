/**
 * Shared helpers for the week-calendar grids (student booking calendar and
 * the tutor schedule).
 *
 * Two kinds of values flow through here:
 *   - Instants (ISO strings from the API): always formatted and positioned
 *     in an explicit IANA timezone — the viewer's on the booking page, the
 *     tutor's on their schedule.
 *   - Calendar dates ("YYYY-MM-DD"): the grid's day columns, already dates
 *     in that timezone, so they're labelled with UTC formatting (a pure date
 *     has no time to shift).
 */

import { addDays, timeZoneOptionLabel, todayIn, zonedParts, zonedTimeToUtc } from "@/lib/timezone";

export { addDays, todayIn };

// ---------- Visible window of the grid ----------

// The hour grid covers the whole day and scrolls inside its box; it's sized
// so about FIT_HOURS hours fill the box, and opens at the earliest thing
// shown (or DEFAULT_SCROLL_MIN when there's nothing).
export const WINDOW_START_MIN = 0; // 12:00 am
export const WINDOW_END_MIN = 24 * 60; // the next 12:00 am
export const WINDOW_LENGTH_MIN = WINDOW_END_MIN - WINDOW_START_MIN;
export const FIT_HOURS = 14;
export const DEFAULT_SCROLL_MIN = 7 * 60; // 7:00 am

// ---------- Date labels (pure calendar dates) ----------

export const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" });
export const dateFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
export const longDateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

export function fmtLongDate(dateStr: string): string {
  return longDateFmt.format(new Date(`${dateStr}T00:00:00.000Z`));
}
export function fmtPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// ---------- Instants, in a timezone ----------

const timeFormatters = new Map<string, Intl.DateTimeFormat>();

/** "3:00 PM" as a clock in `timeZone` reads it. */
export function fmtTime(iso: string, timeZone: string): string {
  let f = timeFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone });
    timeFormatters.set(timeZone, f);
  }
  return f.format(new Date(iso));
}

/** The calendar date an instant falls on in `timeZone`. */
export function localDate(iso: string, timeZone: string): string {
  return zonedParts(new Date(iso), timeZone).date;
}

/** Minutes from the grid's 7am window-start, on the clock in `timeZone`. */
export function minutesFromWindowStart(iso: string, timeZone: string): number {
  return zonedParts(new Date(iso), timeZone).minutes - WINDOW_START_MIN;
}

/** "Central Time (CDT)" — a short label for which timezone times are shown in. */
export function zoneLabel(timeZone: string): string {
  return timeZoneOptionLabel(timeZone);
}

export interface DaySegment {
  /** Pixel position within the day column. */
  top: number;
  height: number;
  /** The part of the range that falls on this day, as instants. */
  start: string;
  end: string;
}

/**
 * Where a range sits in one day's column: clipped to that day (so a range
 * crossing midnight shows in both columns) and to the 7am–9pm window.
 * Positions come from the wall clock in `timeZone`, so they stay right on
 * daylight-saving days. Null if none of it is visible that day.
 */
export function daySegment(
  range: { start: string; end: string },
  date: string,
  timeZone: string,
  pxPerMin: number
): DaySegment | null {
  const dayStart = zonedTimeToUtc(date, 0, timeZone).getTime();
  const dayEnd = zonedTimeToUtc(addDays(date, 1), 0, timeZone).getTime();
  const start = Math.max(new Date(range.start).getTime(), dayStart);
  const end = Math.min(new Date(range.end).getTime(), dayEnd);
  if (end <= start) return null;

  const startMin = zonedParts(new Date(start), timeZone).minutes;
  const endMin = end === dayEnd ? 24 * 60 : zonedParts(new Date(end), timeZone).minutes;
  const top = Math.max(0, startMin - WINDOW_START_MIN);
  const bottom = Math.min(WINDOW_LENGTH_MIN, endMin - WINDOW_START_MIN);
  if (bottom <= 0 || top >= WINDOW_LENGTH_MIN) return null;

  // Report the visible part only, so a click's pixel offset from the top of
  // the drawn block maps back onto the right instant.
  const visibleStart = startMin < WINDOW_START_MIN ? zonedTimeToUtc(date, WINDOW_START_MIN, timeZone).getTime() : start;
  const visibleEnd = endMin > WINDOW_END_MIN ? zonedTimeToUtc(date, WINDOW_END_MIN, timeZone).getTime() : end;

  return {
    top: top * pxPerMin,
    height: Math.max(2, (bottom - top) * pxPerMin),
    start: new Date(visibleStart).toISOString(),
    end: new Date(visibleEnd).toISOString(),
  };
}

/** Hour labels down the time axis: one per hour from window start to end. */
export function hourMarks(): { index: number; label: string }[] {
  const labelFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
  const last = WINDOW_LENGTH_MIN / 60;
  return Array.from({ length: last + 1 }, (_, index) => {
    const minute = WINDOW_START_MIN + index * 60;
    // No label on the grid's top and bottom edges (midnight), where it would be cut in half.
    const label =
      index === 0 || index === last
        ? ""
        : labelFmt.format(new Date(Date.UTC(2000, 0, 1, Math.floor(minute / 60) % 24, minute % 60)));
    return { index, label };
  });
}

/** Scroll position (px) that puts `earliestMin` (minutes from the grid's top) just below the top, with a little room above. */
export function initialScrollTop(earliestMin: number | null, pxPerMin: number): number {
  const target = earliestMin ?? DEFAULT_SCROLL_MIN - WINDOW_START_MIN;
  return Math.max(0, (target - 30) * pxPerMin);
}

/** "#2563eb" + 0.5 -> "rgba(37, 99, 235, 0.5)" — for tinted blocks in a tutor's color. */
export function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** The Sunday on or before `date` (weeks view rows start on Sunday). */
export function startOfWeek(date: string): string {
  return addDays(date, -new Date(`${date}T00:00:00.000Z`).getUTCDay());
}

/** "5pm", "5:30pm" as a clock in `timeZone` reads it — compact, for month-view chips. */
export function fmtShortTime(iso: string, timeZone: string): string {
  const { minutes } = zonedParts(new Date(iso), timeZone);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}

/** Does the range touch this calendar day (in `timeZone`) at all? */
export function overlapsDay(range: { start: string; end: string }, date: string, timeZone: string): boolean {
  const dayStart = zonedTimeToUtc(date, 0, timeZone).getTime();
  const dayEnd = zonedTimeToUtc(addDays(date, 1), 0, timeZone).getTime();
  return new Date(range.start).getTime() < dayEnd && new Date(range.end).getTime() > dayStart;
}
