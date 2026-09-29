"use client";

/**
 * Weeks view (like Google Calendar's month view): rows of weeks, Sunday
 * first, with each day listing its items as small chips. Shared by the
 * booking, tutor and admin calendars; each decides what the items are.
 *
 * Clicking a chip runs its onClick; clicking anywhere else in a day (or
 * "+N more") opens that day in the days view via onDayClick.
 */

import { addDays, dateFmt, hexToRgba, localDate, overlapsDay } from "@/lib/calendarUi";

export interface MonthItem {
  id: string;
  start: string; // ISO instant
  end: string;
  label: string;
  color: string;
  /** solid = a booking or selection; tint = availability; cancelled = faded and struck through. */
  variant: "solid" | "tint" | "cancelled";
  title?: string;
  onClick?: () => void;
  selected?: boolean;
  /** Extra class, e.g. a session's status ("status-completed"). */
  className?: string;
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function MonthGrid({
  start,
  weeks,
  timeZone,
  today,
  items,
  onDayClick,
  loading,
}: {
  /** A Sunday: the first day shown. */
  start: string;
  weeks: number;
  timeZone: string;
  today: string;
  items: MonthItem[];
  onDayClick: (date: string) => void;
  loading?: boolean;
}) {
  // Fewer rows leave more room per day.
  const maxChips = weeks <= 4 ? 5 : weeks <= 5 ? 4 : 3;
  // Like a month view: days outside the month in the middle of the range are greyed.
  const focusMonth = addDays(start, Math.floor((weeks * 7) / 2)).slice(0, 7);

  return (
    <div className={`month-grid${loading ? " is-loading" : ""}`} style={{ gridTemplateRows: `auto repeat(${weeks}, 1fr)` }}>
      {WEEKDAY_NAMES.map((d) => (
        <div key={d} className="month-weekday">
          {d}
        </div>
      ))}
      {Array.from({ length: weeks * 7 }, (_, i) => {
        const date = addDays(start, i);
        // Items whose chip belongs on this day: anything that touches it,
        // availability first, then everything else by start time.
        const dayItems = items
          .filter((it) => overlapsDay(it, date, timeZone))
          .sort(
            (a, b) =>
              Number(a.variant !== "tint") - Number(b.variant !== "tint") || a.start.localeCompare(b.start)
          );
        const shown = dayItems.slice(0, dayItems.length > maxChips ? maxChips - 1 : maxChips);
        const hiddenCount = dayItems.length - shown.length;
        const isOtherMonth = date.slice(0, 7) !== focusMonth;
        const dayNum = Number(date.slice(8, 10));
        return (
          <div
            key={date}
            className={`month-day${date === today ? " is-today" : ""}${date < today ? " is-past" : ""}${
              isOtherMonth ? " is-other-month" : ""
            }`}
            onClick={() => onDayClick(date)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onDayClick(date);
              }
            }}
            aria-label={`Open ${date}`}
          >
            <span className="month-day-num">
              {dayNum === 1 || i === 0 ? dateFmt.format(new Date(`${date}T00:00:00.000Z`)) : dayNum}
            </span>
            <div className="month-chips">
              {shown.map((it) => {
                // A range that started the day before only continues here.
                const continues = localDate(it.start, timeZone) !== date;
                return (
                  <button
                    key={it.id}
                    type="button"
                    className={`month-chip ${it.variant}${it.selected ? " is-selected" : ""}${
                      it.className ? ` ${it.className}` : ""
                    }`}
                    style={
                      it.variant === "tint"
                        ? { background: hexToRgba(it.color, 0.16), borderLeftColor: it.color }
                        : { background: it.color }
                    }
                    title={it.title ?? it.label}
                    onClick={(e) => {
                      if (!it.onClick) return; // let the click open the day
                      e.stopPropagation();
                      it.onClick();
                    }}
                  >
                    {continues ? "… " : ""}
                    {it.label}
                  </button>
                );
              })}
              {hiddenCount > 0 && <span className="month-more">+{hiddenCount} more</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
