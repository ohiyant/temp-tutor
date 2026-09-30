/**
 * Cancellation and rescheduling rules, as pure functions of the session's
 * start and "now" (from src/config.ts). The cancel/reschedule pages show
 * these to the student and the APIs enforce them.
 */

import { CONFIG } from "../config";

const HOUR_MS = 60 * 60 * 1000;

export function hoursUntil(startAt: Date, now: Date): number {
  return (startAt.getTime() - now.getTime()) / HOUR_MS;
}

/** Share of the price refunded when the student cancels now (0–1). */
export function cancellationRefundPct(startAt: Date, now: Date): number {
  return hoursUntil(startAt, now) > CONFIG.CANCEL_NOTICE_THRESHOLD_HOURS
    ? CONFIG.CANCEL_REFUND_PCT_GT_24H
    : CONFIG.CANCEL_REFUND_PCT_LTE_24H;
}

/** Students can move a session only while it's more than RESCHEDULE_MIN_NOTICE_HOURS away. */
export function canReschedule(startAt: Date, now: Date): boolean {
  return hoursUntil(startAt, now) > CONFIG.RESCHEDULE_MIN_NOTICE_HOURS;
}
