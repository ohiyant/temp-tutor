/**
 * All tunable business rules live here, in one place, instead of scattered
 * as magic numbers through the codebase. Change a value here and the whole
 * app picks it up. This is also a good file to point to in an interview
 * when asked "how would you make this configurable?" — you already did it.
 */
export const CONFIG = {
  // Scheduling granularity
  START_TIME_INCREMENT_MIN: 5,
  SESSION_DURATION_INCREMENT_MIN: 5,
  MIN_SESSION_LENGTH_MIN: 30,
  MAX_SESSION_LENGTH_MIN: 120,
  // Length of the session created by a single click (no drag) on the calendar.
  DEFAULT_SESSION_LENGTH_MIN: 60,

  // Rescheduling
  RESCHEDULE_FEE_PCT: 0.25,
  RESCHEDULE_MIN_NOTICE_HOURS: 48,
  // Spacing of the start times offered on the reschedule page.
  RESCHEDULE_SLOT_INCREMENT_MIN: 15,
  // TODO: revisit — currently locked to same duration on reschedule.
  ALLOW_RESCHEDULE_DURATION_CHANGE: false,

  // Cancellation
  CANCEL_NOTICE_THRESHOLD_HOURS: 24,
  CANCEL_REFUND_PCT_GT_24H: 0.5,
  CANCEL_REFUND_PCT_LTE_24H: 0.0,

  // Checkout
  CHECKOUT_HOLD_MINUTES: 10,

  // Calendar booking UI
  DEFAULT_CALENDAR_DAYS: 7,
  MAX_CALENDAR_DAYS: 14,
  // Minutes to pad around an in-person session on both sides, so a tutor
  // isn't double-booked back-to-back with no travel time. Only applies
  // when the *adjacent* confirmed session is in-person.
  IN_PERSON_TRANSPORT_BUFFER_MIN: 30,

  // Timezone new tutors start in (each tutor can change theirs on their profile).
  DEFAULT_TIMEZONE: "America/Chicago",

  // Guest form
  DESCRIPTION_MAX_CHARS: 1000,
} as const;
