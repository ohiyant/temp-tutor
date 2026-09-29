"use client";

import { addDays } from "@/lib/calendarUi";

/**
 * The « ‹ Today › » control: « » jump by the visible range, ‹ › by one step
 * (a day in the days view, a week in the weeks view).
 */
export default function CalendarNav({
  start,
  days,
  today,
  onChange,
  stepDays = 1,
}: {
  start: string;
  days: number;
  /** Where "Today" goes: today's date in the timezone the calendar is shown in (or its week start). */
  today: string;
  onChange: (start: string) => void;
  stepDays?: number;
}) {
  const stepLabel = stepDays === 7 ? "1 week" : stepDays === 1 ? "1 day" : `${stepDays} days`;
  const rangeLabel = days % 7 === 0 && stepDays === 7 ? `${days / 7} weeks` : `${days} days`;
  return (
    <div className="calendar-nav-group" role="group" aria-label="Calendar navigation">
      <button
        className="nav-btn"
        onClick={() => onChange(addDays(start, -days))}
        title={`Back ${rangeLabel}`}
        aria-label={`Back ${rangeLabel}`}
      >
        «
      </button>
      <button
        className="nav-btn"
        onClick={() => onChange(addDays(start, -stepDays))}
        title={`Back ${stepLabel}`}
        aria-label={`Back ${stepLabel}`}
      >
        ‹
      </button>
      <button className="nav-btn nav-today" onClick={() => onChange(today)} disabled={start === today}>
        Today
      </button>
      <button
        className="nav-btn"
        onClick={() => onChange(addDays(start, stepDays))}
        title={`Forward ${stepLabel}`}
        aria-label={`Forward ${stepLabel}`}
      >
        ›
      </button>
      <button
        className="nav-btn"
        onClick={() => onChange(addDays(start, days))}
        title={`Forward ${rangeLabel}`}
        aria-label={`Forward ${rangeLabel}`}
      >
        »
      </button>
    </div>
  );
}
