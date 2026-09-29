"use client";

/**
 * Pick a new start time for an existing session: a week of days, each with
 * the open start times as buttons. Times are shown in the student's
 * timezone (the one they booked in), which they can change.
 */

import { useEffect, useState } from "react";
import { CONFIG } from "@/config";
import CalendarNav from "@/components/CalendarNav";
import TimeZoneSelect from "@/components/TimeZoneSelect";
import { addDays, dateFmt, dayFmt, fmtLongDate, fmtTime, localDate, todayIn } from "@/lib/calendarUi";

interface Moved {
  startAt: string;
  endAt: string;
  cancelPath: string;
  reschedulePath: string;
}

export default function RescheduleForm({
  token,
  initialTimeZone,
  durationMin,
  currentStartAt,
}: {
  token: string;
  initialTimeZone: string;
  durationMin: number;
  currentStartAt: string;
}) {
  const days = CONFIG.DEFAULT_CALENDAR_DAYS;
  const [timeZone, setTimeZone] = useState(initialTimeZone);
  const [start, setStart] = useState(() => todayIn(initialTimeZone));
  const [slots, setSlots] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [moved, setMoved] = useState<Moved | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    const params = new URLSearchParams({ token, start, days: String(days), tz: timeZone });
    fetch(`/api/manage/reschedule/slots?${params.toString()}`)
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok) throw new Error(body?.error ?? "Couldn't load open times.");
        return body.slots as string[];
      })
      .then((s) => {
        if (!cancelled) setSlots(s);
      })
      .catch((e: Error) => {
        if (!cancelled) setLoadError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, start, days, timeZone, reloadKey]);

  async function confirm() {
    if (!chosen) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/manage/reschedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, startAt: chosen }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setSaveError(body?.error ?? "Couldn't reschedule. Try again.");
        // The time may have just been taken; show fresh options.
        if (res.status === 409) {
          setChosen(null);
          setReloadKey((k) => k + 1);
        }
        return;
      }
      setMoved(body as Moved);
    } catch {
      setSaveError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  if (moved) {
    return (
      <div className="manage-done">
        <p>
          <strong>
            Moved to {fmtLongDate(localDate(moved.startAt, timeZone))}, {fmtTime(moved.startAt, timeZone)}–
            {fmtTime(moved.endAt, timeZone)}.
          </strong>{" "}
          We&apos;ve emailed you and your tutor, with new links in case you need to change it again.
        </p>
        <p className="small">
          <a href={moved.reschedulePath}>Reschedule again</a> · <a href={moved.cancelPath}>Cancel</a>
        </p>
      </div>
    );
  }

  const displayDays = Array.from({ length: days }, (_, i) => addDays(start, i));
  const byDay = new Map<string, string[]>();
  for (const s of slots ?? []) {
    const d = localDate(s, timeZone);
    byDay.set(d, [...(byDay.get(d) ?? []), s]);
  }
  const chosenEnd = chosen ? new Date(new Date(chosen).getTime() + durationMin * 60000).toISOString() : null;

  return (
    <div className="reschedule">
      <div className="calendar-nav">
        <CalendarNav start={start} days={days} today={todayIn(timeZone)} onChange={setStart} />
        <span className="range-label">
          {fmtLongDate(start)} – {fmtLongDate(addDays(start, days - 1))}
        </span>
        <div className="form-field reschedule-tz">
          <label htmlFor="reschedule-tz">Timezone</label>
          <TimeZoneSelect id="reschedule-tz" value={timeZone} onChange={setTimeZone} />
        </div>
      </div>

      {loadError && <p className="error-text">{loadError}</p>}
      <div className={`slot-grid${loading ? " is-loading" : ""}`}>
        {displayDays.map((date) => {
          const daySlots = byDay.get(date) ?? [];
          return (
            <div key={date} className="slot-day">
              <div className="slot-day-head">
                <span className="dow">{dayFmt.format(new Date(`${date}T00:00:00.000Z`))}</span>
                <span>{dateFmt.format(new Date(`${date}T00:00:00.000Z`))}</span>
              </div>
              {daySlots.length === 0 ? (
                <span className="slot-none">{loading ? "…" : "—"}</span>
              ) : (
                daySlots.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`slot-btn${s === chosen ? " is-chosen" : ""}`}
                    onClick={() => setChosen(s === chosen ? null : s)}
                  >
                    {fmtTime(s, timeZone)}
                  </button>
                ))
              )}
            </div>
          );
        })}
      </div>
      {!loading && slots && slots.length === 0 && (
        <p className="muted small">No open times this week. Use » to look further ahead.</p>
      )}

      <div className="reschedule-confirm">
        {chosen && chosenEnd ? (
          <span>
            New time: <strong>{fmtLongDate(localDate(chosen, timeZone))}</strong>, {fmtTime(chosen, timeZone)}–
            {fmtTime(chosenEnd, timeZone)}
            <span className="muted small">
              {" "}
              (was {fmtLongDate(localDate(currentStartAt, timeZone))}, {fmtTime(currentStartAt, timeZone)})
            </span>
          </span>
        ) : (
          <span className="muted">Choose a new start time above.</span>
        )}
        <button onClick={confirm} disabled={!chosen || saving}>
          {saving ? "Moving…" : "Confirm new time"}
        </button>
      </div>
      {saveError && <p className="error-text">{saveError}</p>}
    </div>
  );
}
