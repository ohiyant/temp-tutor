/**
 * Availability engine.
 *
 * Deliberately a PURE function: no Prisma, no fetch, no Date.now() called
 * internally (caller passes `now` in). That makes it trivial to unit test
 * every edge case without touching a database, and safe to reuse anywhere
 * (API route, a cron job re-validating a hold, a script).
 *
 * KNOWN SIMPLIFICATION (documented on purpose, good to mention if asked):
 * all times are treated as UTC "wall clock" values. There's no per-tutor
 * timezone field yet, so a tutor's "15:00" recurring block means 15:00 UTC
 * for everyone. Fine for a single-timezone MVP; real multi-timezone tutor
 * support would need a tutor.timezone field and a proper tz library
 * (e.g. date-fns-tz or Luxon) to convert local wall-clock times to UTC
 * instants, especially across DST boundaries.
 */

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
}

/** "15:00" -> 900 (minutes since midnight) */
function timeStringToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Build a UTC Date for `date`'s calendar day at the given minutes-since-midnight. */
function dateAtMinutes(date: Date, minutesSinceMidnight: number): Date {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  d.setUTCMinutes(minutesSinceMidnight);
  return d;
}

function isSameCalendarDate(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
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
  date: string; // YYYY-MM-DD, UTC calendar date
  ranges: TimeRange[];
}

interface ComputeDailyFreeRangesInput {
  rangeStart: Date;
  rangeEnd: Date;
  recurringBlocks: RecurringBlock[];
  exceptions: AvailabilityExceptionInput[];
  busyRanges: BusyRange[];
  bufferMin: number;
}

/** Shared core: recurring blocks -> apply exceptions -> clip to range ->
 *  subtract busy (+ buffer) time. Returns continuous free ranges per day,
 *  with NO notice/window filtering applied yet (that's start-time-specific
 *  and handled by each caller below, since the two callers need it applied
 *  differently). */
function computeDailyFreeRanges(input: ComputeDailyFreeRangesInput): DayFreeRanges[] {
  const { rangeStart, rangeEnd, recurringBlocks, exceptions, busyRanges, bufferMin } = input;
  const effectiveBusy = expandBusyForBuffer(busyRanges, bufferMin);

  const results: DayFreeRanges[] = [];
  const cursor = new Date(
    Date.UTC(rangeStart.getUTCFullYear(), rangeStart.getUTCMonth(), rangeStart.getUTCDate())
  );
  const endBoundary = new Date(
    Date.UTC(rangeEnd.getUTCFullYear(), rangeEnd.getUTCMonth(), rangeEnd.getUTCDate())
  );

  while (cursor.getTime() <= endBoundary.getTime()) {
    const dayOfWeek = cursor.getUTCDay();

    let freeRanges: TimeRange[] = recurringBlocks
      .filter((b) => b.dayOfWeek === dayOfWeek)
      .map((b) => ({
        start: dateAtMinutes(cursor, timeStringToMinutes(b.startTime)),
        end: dateAtMinutes(cursor, timeStringToMinutes(b.endTime)),
      }));

    const todaysExceptions = exceptions.filter((e) => isSameCalendarDate(e.date, cursor));
    for (const exc of todaysExceptions) {
      const excRange: TimeRange = {
        start: dateAtMinutes(cursor, timeStringToMinutes(exc.startTime)),
        end: dateAtMinutes(cursor, timeStringToMinutes(exc.endTime)),
      };
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
      if (isSameCalendarDate(busy.start, cursor) || isSameCalendarDate(busy.end, cursor)) {
        freeRanges = subtractRange(freeRanges, busy);
      }
    }

    results.push({ date: isoDateOnly(cursor), ranges: freeRanges });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
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
  } = input;

  const earliestAllowedStart = new Date(now.getTime() + minBookingNoticeHours * 60 * 60 * 1000);
  const latestAllowedStart = new Date(now.getTime() + maxBookingWindowHours * 60 * 60 * 1000);

  const dailyFree = computeDailyFreeRanges({ rangeStart, rangeEnd, recurringBlocks, exceptions, busyRanges, bufferMin });

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
  } = input;

  const earliestAllowedStart = new Date(now.getTime() + minBookingNoticeHours * 60 * 60 * 1000);
  const latestAllowedStart = new Date(now.getTime() + maxBookingWindowHours * 60 * 60 * 1000);

  const daily = computeDailyFreeRanges({ rangeStart, rangeEnd, recurringBlocks, exceptions, busyRanges, bufferMin });

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
