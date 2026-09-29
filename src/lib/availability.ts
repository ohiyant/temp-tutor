/**
 * Availability engine.
 *
 * Deliberately a PURE function: no Prisma, no fetch, no Date.now() called
 * internally (caller passes `now` in). That makes it trivial to unit test
 * every edge case without touching a database, and safe to reuse anywhere
 * (API route, a cron job re-validating a hold, a script).
 *
 * TIMEZONES: a tutor's recurring blocks and exceptions are "HH:mm" wall-clock
 * times in the tutor's own IANA timezone (`timeZone`, default "UTC"). The
 * engine walks the tutor's local calendar dates and converts each block to
 * real UTC instants for that date, so a "15:00" block stays 3pm local across
 * daylight saving changes. Everything it returns (and every busy range it's
 * given) is a real instant. See src/lib/timezone.ts.
 */

import { dayOfWeek, hhmmToMinutes, zonedParts, zonedTimeToUtc, addDays } from "./timezone";

export interface TimeRange {
  start: Date;
  end: Date;
}

/** A busy range that (optionally) knows the session mode, so the engine can
 *  pad in-person bookings with transport/buffer time. Holds and online
 *  sessions have no `mode` (or mode "online") and get no padding. */
export interface BusyRange extends TimeRange {
  mode?: "online" | "in_person";
}

export interface RecurringBlock {
  dayOfWeek: number; // 0 = Sunday ... 6 = Saturday
  startTime: string; // "HH:mm", 24-hour
  endTime: string;
}

export interface AvailabilityExceptionInput {
  date: Date; // only the Y/M/D is used
  startTime: string;
  endTime: string;
  isAvailable: boolean; // false = blackout, true = extra availability
}

export interface GetAvailableSlotsInput {
  now: Date;
  rangeStart: Date;
  rangeEnd: Date;
  durationMin: number;
  startIncrementMin: number;
  minBookingNoticeHours: number;
  maxBookingWindowHours: number;
  recurringBlocks: RecurringBlock[];
  exceptions: AvailabilityExceptionInput[];
  /** Already-confirmed sessions + active checkout holds for this tutor (and/or student). */
  busyRanges: BusyRange[];
  /** Minutes of transport buffer to pad around in-person busy ranges. Default 0 (off). */
  bufferMin?: number;
  /** The tutor's IANA timezone, which blocks and exceptions are written in. Default "UTC". */
  timeZone?: string;
}

function isoDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Remove `toRemove` from every range in `ranges`, splitting ranges as needed. */
function subtractRange(ranges: TimeRange[], toRemove: TimeRange): TimeRange[] {
  const result: TimeRange[] = [];
  for (const r of ranges) {
    const noOverlap = toRemove.end <= r.start || toRemove.start >= r.end;
    if (noOverlap) {
      result.push(r);
      continue;
    }
    if (toRemove.start > r.start) {
      result.push({ start: r.start, end: new Date(Math.min(toRemove.start.getTime(), r.end.getTime())) });
    }
    if (toRemove.end < r.end) {
      result.push({ start: new Date(Math.max(toRemove.end.getTime(), r.start.getTime())), end: r.end });
    }
  }
  return result.filter((r) => r.end.getTime() > r.start.getTime());
}

function clipRange(range: TimeRange, bounds: TimeRange): TimeRange | null {
  const start = new Date(Math.max(range.start.getTime(), bounds.start.getTime()));
  const end = new Date(Math.min(range.end.getTime(), bounds.end.getTime()));
  if (end <= start) return null;
  return { start, end };
}

/** Pad in-person busy ranges by `bufferMin` on both sides. Ranges with no
 *  mode, or mode "online", pass through unchanged — only in-person sessions
 *  need travel time on either side. */
function expandBusyForBuffer(busyRanges: BusyRange[], bufferMin: number): TimeRange[] {
  if (!bufferMin) return busyRanges;
  return busyRanges.map((r) =>
    r.mode === "in_person"
      ? {
          start: new Date(r.start.getTime() - bufferMin * 60 * 1000),
          end: new Date(r.end.getTime() + bufferMin * 60 * 1000),
        }
      : r
  );
}

/** The padding-only slivers (not the busy range itself) — useful for
 *  rendering a distinct "buffer" strip next to a booked in-person block. */
export function computeBufferPadding(busyRanges: BusyRange[], bufferMin: number): TimeRange[] {
  if (!bufferMin) return [];
  const pads: TimeRange[] = [];
  for (const r of busyRanges) {
    if (r.mode !== "in_person") continue;
    pads.push({ start: new Date(r.start.getTime() - bufferMin * 60 * 1000), end: new Date(r.start) });
    pads.push({ start: new Date(r.end), end: new Date(r.end.getTime() + bufferMin * 60 * 1000) });
  }
  return pads;
}

export interface DayFreeRanges {
  date: string; // YYYY-MM-DD, the tutor's local calendar date
  ranges: TimeRange[];
}

interface ComputeDailyFreeRangesInput {
  rangeStart: Date;
  rangeEnd: Date;
  recurringBlocks: RecurringBlock[];
  exceptions: AvailabilityExceptionInput[];
  busyRanges: BusyRange[];
  bufferMin: number;
  timeZone: string;
}

/** Shared core: recurring blocks -> apply exceptions -> clip to range ->
 *  subtract busy (+ buffer) time. Returns continuous free ranges per day of
 *  the TUTOR's calendar (`date` is their local date), with NO
 *  notice/window filtering applied yet (that's start-time-specific and
 *  handled by each caller below, since the two callers need it applied
 *  differently). */
function computeDailyFreeRanges(input: ComputeDailyFreeRangesInput): DayFreeRanges[] {
  const { rangeStart, rangeEnd, recurringBlocks, exceptions, busyRanges, bufferMin, timeZone } = input;
  const effectiveBusy = expandBusyForBuffer(busyRanges, bufferMin);
  const atLocal = (date: string, hhmm: string) => zonedTimeToUtc(date, hhmmToMinutes(hhmm), timeZone);

  const results: DayFreeRanges[] = [];
  const lastDate = zonedParts(rangeEnd, timeZone).date;

  for (let date = zonedParts(rangeStart, timeZone).date; date <= lastDate; date = addDays(date, 1)) {
    const dow = dayOfWeek(date);

    let freeRanges: TimeRange[] = recurringBlocks
      .filter((b) => b.dayOfWeek === dow)
      .map((b) => ({ start: atLocal(date, b.startTime), end: atLocal(date, b.endTime) }));

    // An exception's `date` is stored as UTC midnight of the tutor-local
    // calendar date it applies to, so compare by its Y-M-D.
    const todaysExceptions = exceptions.filter((e) => isoDateOnly(e.date) === date);
    for (const exc of todaysExceptions) {
      const excRange: TimeRange = { start: atLocal(date, exc.startTime), end: atLocal(date, exc.endTime) };
      if (exc.isAvailable) {
        freeRanges.push(excRange);
      } else {
        freeRanges = subtractRange(freeRanges, excRange);
      }
    }

    freeRanges = freeRanges
      .map((r) => clipRange(r, { start: rangeStart, end: rangeEnd }))
      .filter((r): r is TimeRange => r !== null);

    for (const busy of effectiveBusy) {
      freeRanges = subtractRange(freeRanges, busy);
    }

    results.push({ date, ranges: freeRanges });
  }

  return results;
}

export function getAvailableSlots(input: GetAvailableSlotsInput): Date[] {
  const {
    now,
    rangeStart,
    rangeEnd,
    durationMin,
    startIncrementMin,
    minBookingNoticeHours,
    maxBookingWindowHours,
    recurringBlocks,
    exceptions,
    busyRanges,
    bufferMin = 0,
    timeZone = "UTC",
  } = input;

  const earliestAllowedStart = new Date(now.getTime() + minBookingNoticeHours * 60 * 60 * 1000);
  const latestAllowedStart = new Date(now.getTime() + maxBookingWindowHours * 60 * 60 * 1000);

  const dailyFree = computeDailyFreeRanges({
    rangeStart,
    rangeEnd,
    recurringBlocks,
    exceptions,
    busyRanges,
    bufferMin,
    timeZone,
  });

  const slots: Date[] = [];
  for (const { ranges } of dailyFree) {
    for (const range of ranges) {
      let candidate = new Date(range.start);
      while (candidate.getTime() + durationMin * 60 * 1000 <= range.end.getTime()) {
        const withinNotice = candidate.getTime() >= earliestAllowedStart.getTime();
        const withinWindow = candidate.getTime() <= latestAllowedStart.getTime();
        if (withinNotice && withinWindow) {
          slots.push(new Date(candidate));
        }
        candidate = new Date(candidate.getTime() + startIncrementMin * 60 * 1000);
      }
    }
  }

  return slots.sort((a, b) => a.getTime() - b.getTime());
}

export interface GetFreeRangesInput {
  now: Date;
  rangeStart: Date;
  rangeEnd: Date;
  minBookingNoticeHours: number;
  maxBookingWindowHours: number;
  recurringBlocks: RecurringBlock[];
  exceptions: AvailabilityExceptionInput[];
  busyRanges: BusyRange[];
  bufferMin?: number;
  /** The tutor's IANA timezone, which blocks and exceptions are written in. Default "UTC". */
  timeZone?: string;
  /** If set, earliestAllowedStart is rounded UP and latestAllowedStart DOWN
   *  to a multiple of this many minutes, so free ranges clipped by the
   *  booking notice start on a clean time (3:40, not 3:37). */
  startIncrementMin?: number;
}

export interface GetFreeRangesResult {
  /** No session may START before this instant (min booking notice). */
  earliestAllowedStart: Date;
  /** No session may START after this instant (max booking window). Ranges
   *  below are NOT clipped to this — only the start time is bounded, a
   *  session can still end after it — so callers (e.g. the calendar UI)
   *  should grey out/reject drag-starts past this point themselves. */
  latestAllowedStart: Date;
  days: DayFreeRanges[];
}

/** Continuous free-time ranges per day — what a calendar UI needs to draw
 *  draggable blocks, as opposed to getAvailableSlots's discrete, pre-snapped
 *  start times. */
export function getFreeRanges(input: GetFreeRangesInput): GetFreeRangesResult {
  const {
    now,
    rangeStart,
    rangeEnd,
    minBookingNoticeHours,
    maxBookingWindowHours,
    recurringBlocks,
    exceptions,
    busyRanges,
    bufferMin = 0,
    startIncrementMin,
    timeZone = "UTC",
  } = input;

  let earliestAllowedStart = new Date(now.getTime() + minBookingNoticeHours * 60 * 60 * 1000);
  let latestAllowedStart = new Date(now.getTime() + maxBookingWindowHours * 60 * 60 * 1000);
  if (startIncrementMin) {
    const stepMs = startIncrementMin * 60 * 1000;
    earliestAllowedStart = new Date(Math.ceil(earliestAllowedStart.getTime() / stepMs) * stepMs);
    latestAllowedStart = new Date(Math.floor(latestAllowedStart.getTime() / stepMs) * stepMs);
  }

  const daily = computeDailyFreeRanges({
    rangeStart,
    rangeEnd,
    recurringBlocks,
    exceptions,
    busyRanges,
    bufferMin,
    timeZone,
  });

  const days = daily.map(({ date, ranges }) => ({
    date,
    ranges: ranges
      .map((r) => ({
        start: r.start.getTime() < earliestAllowedStart.getTime() ? earliestAllowedStart : r.start,
        end: r.end,
      }))
      .filter((r) => r.end.getTime() > r.start.getTime()),
  }));

  return { earliestAllowedStart, latestAllowedStart, days };
}

/** A tutor's raw availability per day — recurring blocks with exceptions
 *  applied, but NOT reduced by bookings, notice or booking window. What the
 *  tutor's own schedule view draws underneath their bookings. */
export function getAvailabilityRanges(input: {
  rangeStart: Date;
  rangeEnd: Date;
  recurringBlocks: RecurringBlock[];
  exceptions: AvailabilityExceptionInput[];
  timeZone: string;
}): DayFreeRanges[] {
  return computeDailyFreeRanges({ ...input, busyRanges: [], bufferMin: 0 });
}
