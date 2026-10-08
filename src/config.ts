/**
 * All tunable business rules live here, in one place, instead of scattered
 * as magic numbers through the codebase. Change a value here and the whole
 * app picks it up. This is also a good file to point to in an interview
 * when asked "how would you make this configurable?" — you already did it.
 */
export const CONFIG = {
  // The site's name, used in page titles, emails and sign-in pages.
  SITE_NAME: "UCR Tutoring",
  // The short line above the name on the welcome page.
  SITE_TAGLINE: "Get tutored by TJHSST alumni",

  // Scheduling granularity
  START_TIME_INCREMENT_MIN: 15,
  SESSION_DURATION_INCREMENT_MIN: 15,
  MIN_SESSION_LENGTH_MIN: 30,
  MAX_SESSION_LENGTH_MIN: 180,
  // Length of the session created by a single click (no drag) on the calendar.
  DEFAULT_SESSION_LENGTH_MIN: 60,

  // Rescheduling
  RESCHEDULE_MIN_NOTICE_HOURS: 48,
  // Spacing of the start times offered on the reschedule page.
  RESCHEDULE_SLOT_INCREMENT_MIN: 15,
  // TODO: revisit — currently locked to same duration on reschedule.
  ALLOW_RESCHEDULE_DURATION_CHANGE: false,

  // Cancellation: share of the price refunded when a student cancels, any
  // time before the session. (A tutor or admin cancelling refunds in full.)
  CANCEL_REFUND_PCT: 0.75,

  // Checkout: how long a student has to pay on Stripe's page while their
  // times are held. Stripe's minimum is 30.
  CHECKOUT_HOLD_MINUTES: 30,

  // Calendar booking UI
  DEFAULT_CALENDAR_DAYS: 7,
  // Weeks view (month-style grid): how many weeks it shows by default, and the most.
  DEFAULT_CALENDAR_WEEKS: 5,
  MAX_CALENDAR_WEEKS: 8,
  MAX_CALENDAR_DAYS: 14,
  // Minutes to pad around an in-person session on both sides, so a tutor
  // isn't double-booked back-to-back with no travel time. Only applies
  // when the *adjacent* confirmed session is in-person.
  IN_PERSON_TRANSPORT_BUFFER_MIN: 30,

  // Timezone new tutors start in (each tutor can change theirs on their profile).
  DEFAULT_TIMEZONE: "America/Chicago",

  // How long an emailed "My bookings" link keeps working.
  BOOKING_LOOKUP_LINK_HOURS: 24,

  // Spam protection (see src/lib/rateLimit.ts)
  MAX_SESSIONS_PER_BOOKING: 5,
  MAX_UPCOMING_SESSIONS_PER_STUDENT: 10,
  BOOKINGS_PER_IP_PER_HOUR: 5,
  BOOKINGS_PER_EMAIL_PER_DAY: 5,
  SIGN_IN_EMAILS_PER_IP_PER_HOUR: 10,
  LOOKUP_EMAILS_PER_IP_PER_HOUR: 10,

  // Guest form
  DESCRIPTION_MAX_CHARS: 1000,
} as const;
