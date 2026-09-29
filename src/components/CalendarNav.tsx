"use client";

import { addDays } from "@/lib/calendarUi";

/** The « ‹ Today › » control: jump by the visible range, or by one day. */
export default function CalendarNav({
  start,
  days,
  today,
  onChange,
}: {
  start: string;
  days: number;
  /** Today's date in the timezone the calendar is shown in. */
  today: string;
  onChange: (start: string) => void;
}) {
  return (
    <div className="calendar-nav-group" role="group" aria-label="Calendar navigation">
      <button
        className="nav-btn"
        onClick={() => onChange(addDays(start, -days))}
        title={`Back ${days} days`}
        aria-label={`Back ${days} days`}
      >
        «
      </button>
      <button className="nav-btn" onClick={() => onChange(addDays(start, -1))} title="Back 1 day" aria-label="Back 1 day">
        ‹
      </button>
      <button
        className="nav-btn nav-today"
        onClick={() => onChange(today)}
        disabled={start === today}
      >
        Today
      </button>
      <button
        className="nav-btn"
        onClick={() => onChange(addDays(start, 1))}
        title="Forward 1 day"
        aria-label="Forward 1 day"
      >
        ›
      </button>
      <button
        className="nav-btn"
        onClick={() => onChange(addDays(start, days))}
        title={`Forward ${days} days`}
        aria-label={`Forward ${days} days`}
      >
        »
      </button>
    </div>
  );
}
