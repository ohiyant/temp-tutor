import type { ReactNode } from "react";
import { fmtLongDate, fmtPrice, fmtTime, localDate } from "@/lib/calendarUi";
import type { BookingResult } from "@/lib/bookingResult";

/**
 * The "You're booked!" card: each session with where it happens, its
 * reschedule/cancel links and the tutor's email, and the total. Used by the
 * booking page's last step and by /book/confirmed after paying.
 */
export default function BookingConfirmation({
  result,
  timeZone,
  email,
  paid,
  actions,
}: {
  result: BookingResult;
  /** The student's timezone. */
  timeZone: string;
  /** Where the confirmation email went. */
  email: string;
  /** Paid online (the total reads "Paid"). */
  paid?: boolean;
  /** Buttons under the card, e.g. "Book more sessions". */
  actions: ReactNode;
}) {
  return (
    <div className="card booking-done">
      <div className="booking-done-check" aria-hidden>
        ✓
      </div>
      <h2>You&apos;re booked!</h2>
      <p className="booking-done-sub">
        {result.sessions.length} {result.subjectName} session{result.sessions.length === 1 ? "" : "s"} confirmed. A
        confirmation email is on its way to <strong>{email}</strong>.
      </p>
      {result.sessions.map((s) => (
        <div key={s.id} className="list-row">
          <span>
            {s.tutorName} · {fmtLongDate(localDate(s.startAt, timeZone))} · {fmtTime(s.startAt, timeZone)}–
            {fmtTime(s.endAt, timeZone)} · {s.durationMin} min · {s.mode === "online" ? "Online" : "In-person"}
            <span className="session-place small">
              {s.place.label}:{" "}
              {s.place.href ? (
                <a href={s.place.href} target="_blank" rel="noopener noreferrer">
                  {s.place.text}
                </a>
              ) : (
                s.place.text
              )}
            </span>
            <span className="done-manage small">
              <a href={s.reschedulePath}>Reschedule</a> · <a href={s.cancelPath}>Cancel</a> · Questions? Email{" "}
              {s.tutorName} at <a href={`mailto:${s.tutorEmail}`}>{s.tutorEmail}</a>
            </span>
          </span>
          <span>{fmtPrice(s.priceCents)}</span>
        </div>
      ))}
      <div className="list-row">
        <span>
          <strong>{paid ? "Total paid" : "Total"}</strong>
        </span>
        <span>
          <strong>{fmtPrice(result.totalCents)}</strong>
        </span>
      </div>
      <p className="muted small materials-note">
        Have homework, notes or practice problems you&apos;d like to go over? Reply to your confirmation email with
        them before the session. Replies go straight to your tutor.
      </p>
      <div className="form-row" style={{ marginTop: "1.5rem" }}>
        {actions}
      </div>
    </div>
  );
}
