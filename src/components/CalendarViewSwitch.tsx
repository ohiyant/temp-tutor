"use client";

import { CONFIG } from "@/config";

export type CalendarView = "days" | "weeks";

/** [Days | Weeks] toggle, plus how many weeks to show when in the weeks view. */
export default function CalendarViewSwitch({
  view,
  onViewChange,
  weeks,
  onWeeksChange,
}: {
  view: CalendarView;
  onViewChange: (view: CalendarView) => void;
  weeks: number;
  onWeeksChange: (weeks: number) => void;
}) {
  return (
    <div className="view-switch">
      <div className="calendar-nav-group" role="group" aria-label="Calendar view">
        {(["days", "weeks"] as const).map((v) => (
          <button
            key={v}
            type="button"
            className={`nav-btn view-btn${view === v ? " is-active" : ""}`}
            aria-pressed={view === v}
            onClick={() => onViewChange(v)}
          >
            {v === "days" ? "Days" : "Weeks"}
          </button>
        ))}
      </div>
      {view === "weeks" && (
        <select
          aria-label="Weeks shown"
          className="weeks-select"
          value={weeks}
          onChange={(e) => onWeeksChange(Number(e.target.value))}
        >
          {Array.from({ length: CONFIG.MAX_CALENDAR_WEEKS - 1 }, (_, i) => i + 2).map((n) => (
            <option key={n} value={n}>
              {n} weeks
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
