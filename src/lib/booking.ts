/**
 * Server-side booking validation.
 *
 * Pure, like the availability engine: the booking API loads everything from
 * the database and hands it in, so every rule here is unit-testable. The
 * calendar UI enforces the same rules as the student clicks, but the client
 * can be stale (someone else booked meanwhile) or tampered with, so the API
 * re-checks each requested session against fresh data with this function.
 */

import { CONFIG } from "../config";
import {
  getFreeRanges,
  type AvailabilityExceptionInput,
  type BusyRange,
  type RecurringBlock,
} from "./availability";

export interface CheckSessionFitsInput {
  now: Date;
  startAt: Date;
  durationMin: number;
  minBookingNoticeHours: number;
  maxBookingWindowHours: number;
  recurringBlocks: RecurringBlock[];
  exceptions: AvailabilityExceptionInput[];
  /** The tutor's confirmed sessions + active holds, plus any sessions
   *  already accepted earlier in the same booking request. */
  busyRanges: BusyRange[];
  bufferMin: number;
  /** The tutor's IANA timezone. */
  timeZone: string;
}

/** Price is always derived server-side from the tutor's rate. */
export function sessionPriceCents(hourlyRateCents: number, durationMin: number): number {
  return Math.round((hourlyRateCents * durationMin) / 60);
}

/** Returns null if the session is bookable, otherwise a human-readable reason. */
export function checkSessionFits(input: CheckSessionFitsInput): string | null {
  const { now, startAt, durationMin } = input;

  if (durationMin < CONFIG.MIN_SESSION_LENGTH_MIN || durationMin > CONFIG.MAX_SESSION_LENGTH_MIN) {
    return `Sessions must be between ${CONFIG.MIN_SESSION_LENGTH_MIN} and ${CONFIG.MAX_SESSION_LENGTH_MIN} minutes.`;
  }
  if ((durationMin - CONFIG.MIN_SESSION_LENGTH_MIN) % CONFIG.SESSION_DURATION_INCREMENT_MIN !== 0) {
    return `Session length must be in ${CONFIG.SESSION_DURATION_INCREMENT_MIN}-minute steps.`;
  }

  const endAt = new Date(startAt.getTime() + durationMin * 60 * 1000);
  // A day either side covers whichever of the tutor's local days this falls on.
  const DAY_MS = 24 * 60 * 60 * 1000;

  const { earliestAllowedStart, latestAllowedStart, days } = getFreeRanges({
    now,
    rangeStart: new Date(startAt.getTime() - DAY_MS),
    rangeEnd: new Date(endAt.getTime() + DAY_MS),
    minBookingNoticeHours: input.minBookingNoticeHours,
    maxBookingWindowHours: input.maxBookingWindowHours,
    recurringBlocks: input.recurringBlocks,
    exceptions: input.exceptions,
    busyRanges: input.busyRanges,
    bufferMin: input.bufferMin,
    timeZone: input.timeZone,
    startIncrementMin: CONFIG.START_TIME_INCREMENT_MIN,
  });

  if (startAt.getTime() < earliestAllowedStart.getTime()) {
    return `That time is too soon — bookings need at least ${input.minBookingNoticeHours} hours' notice.`;
  }
  if (startAt.getTime() > latestAllowedStart.getTime()) {
    return "That time is too far ahead to book yet.";
  }

  const fits = days.some((d) =>
    d.ranges.some((r) => r.start.getTime() <= startAt.getTime() && endAt.getTime() <= r.end.getTime())
  );
  return fits ? null : "That time is no longer available.";
}

/** True if any two ranges overlap (touching end-to-start is fine). */
export function hasOverlap(ranges: { start: Date; end: Date }[]): boolean {
  const sorted = [...ranges].sort((a, b) => a.start.getTime() - b.start.getTime());
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start.getTime() < sorted[i - 1].end.getTime()) return true;
  }
  return false;
}
