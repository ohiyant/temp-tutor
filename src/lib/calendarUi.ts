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

export const WINDOW_START_MIN = 7 * 60; // 7:00 am
export const WINDOW_END_MIN = 21 * 60; // 9:00 pm
export const WINDOW_LENGTH_MIN = WINDOW_END_MIN - WINDOW_START_MIN;

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
  return Array.from({ length: WINDOW_LENGTH_MIN / 60 + 1 }, (_, index) => {
    const minute = WINDOW_START_MIN + index * 60;
    return { index, label: labelFmt.format(new Date(Date.UTC(2000, 0, 1, Math.floor(minute / 60), minute % 60))) };
  });
}
