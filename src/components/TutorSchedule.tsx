"use client";

/**
 * A tutor's own week: availability underneath, booked sessions on top.
 * Click a session for the student's details and a Cancel button (the
 * tutor can cancel their own sessions; admins can cancel any).
 *
 * Laid out in the TUTOR's timezone (even for an admin looking from
 * elsewhere), since that's the zone their weekly hours are written in.
 */

import { useEffect, useState } from "react";
import { CONFIG } from "@/config";
import CalendarNav from "@/components/CalendarNav";
import { useFitCalendar } from "@/components/useFitCalendar";
import CalendarViewSwitch, { type CalendarView } from "@/components/CalendarViewSwitch";
import MonthGrid, { type MonthItem } from "@/components/MonthGrid";
import {
  WINDOW_LENGTH_MIN,
  addDays,
  dateFmt,
  dayFmt,
  daySegment,
  fmtLongDate,
  fmtPrice,
  fmtShortTime,
  fmtTime,
  hexToRgba,
  hourMarks,
  initialScrollTop,
  localDate,
  minutesFromWindowStart,
  startOfWeek,
  todayIn,
  zoneLabel,
} from "@/lib/calendarUi";

interface RangeIso {
  start: string;
  end: string;
}

export interface ScheduleSession {
  id: string;
  startAt: string;
  endAt: string;
  durationMin: number;
  mode: "online" | "in_person";
  status: string;
  priceCents: number;
  subjectName: string;
  studentName: string;
  studentEmail: string;
  studentPhone: string | null;
  description: string;
  /** Set on the admin calendar, where sessions from several tutors mix. */
  tutorName?: string;
}

interface ScheduleResponse {
  start: string;
  timeZone: string;
  available: RangeIso[];
  blocked: RangeIso[];
  sessions: ScheduleSession[];
}

const HOURS = hourMarks();

export default function TutorSchedule({
  tutorId,
  timeZone,
  color,
  canCancel,
}: {
  tutorId: string;
  /** The tutor's timezone. */
  timeZone: string;
  /** The tutor's calendar color (same as on the booking and admin calendars). */
  color: string;
  canCancel: boolean;
}) {
  const today = todayIn(timeZone);
  const [start, setStart] = useState(today);
  const [view, setView] = useState<CalendarView>("days");
  const [weeks, setWeeks] = useState<number>(CONFIG.DEFAULT_CALENDAR_WEEKS);
  // Days view: a week from `start`. Weeks view: whole weeks from a Sunday.
  const days = view === "weeks" ? weeks * 7 : CONFIG.DEFAULT_CALENDAR_DAYS;
  const [data, setData] = useState<ScheduleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { scrollRef, scrollEl, size, pxPerMin } = useFitCalendar();

  // The grid covers the whole day and scrolls: open a new week just above
  // its earliest availability or booking (7am if there's nothing).
  const loadedStart = data?.start;
  useEffect(() => {
    if (!data || !scrollEl) return;
    const starts = [...data.available.map((r) => r.start), ...data.sessions.map((s) => s.startAt)].map((iso) =>
      minutesFromWindowStart(iso, timeZone)
    );
    scrollEl.scrollTop = initialScrollTop(starts.length ? Math.min(...starts) : null, pxPerMin);
    // On a new week, and again once the box reaches its final size (styles
    // can land after the first paint) — not on a reload after cancelling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedStart, timeZone, scrollEl, pxPerMin, size.height]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/tutors/${tutorId}/schedule?start=${start}&days=${days}`)
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok) throw new Error(body?.error ?? "Failed to load");
        return body as ScheduleResponse;
      })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load the schedule. Try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tutorId, start, days, reloadKey]);

  const displayDays = Array.from({ length: days }, (_, i) => addDays(start, i));
  const gridHeight = WINDOW_LENGTH_MIN * pxPerMin;
  const sessions = data?.sessions ?? [];
  const selected = sessions.find((s) => s.id === selectedId) ?? null;
  const upcomingInView = sessions.filter((s) => new Date(s.endAt).getTime() > Date.now()).length;
  const toMark = sessions.filter(needsOutcome).length;

  function changeView(next: CalendarView) {
    setView(next);
    if (next === "weeks") setStart(startOfWeek(start));
  }

  function openDay(date: string) {
    setView("days");
    setStart(date);
  }

  const monthItems: MonthItem[] = [
    ...(data?.available ?? []).map((r, i) => ({
      id: `a-${i}`,
      start: r.start,
      end: r.end,
      label: `${fmtShortTime(r.start, timeZone)}–${fmtShortTime(r.end, timeZone)}`,
      title: `Available ${fmtTime(r.start, timeZone)}–${fmtTime(r.end, timeZone)}`,
      color,
      variant: "tint" as const,
    })),
    ...sessions.map((s) => ({
      id: s.id,
      start: s.startAt,
      end: s.endAt,
      label: `${fmtShortTime(s.startAt, timeZone)} ${s.studentName}`,
      title: `${fmtTime(s.startAt, timeZone)}–${fmtTime(s.endAt, timeZone)} · ${s.studentName} · ${
        s.subjectName
      }${statusSuffix(s.status)}`,
      color,
      variant: "solid" as const,
      className: `status-${s.status}`,
      selected: s.id === selectedId,
      onClick: () => setSelectedId(s.id === selectedId ? null : s.id),
    })),
  ];

  return (
    <div className="fit-calendar tutor-schedule">
      <div className="calendar-nav">
        <CalendarNav
          start={start}
          days={days}
          today={view === "weeks" ? startOfWeek(today) : today}
          stepDays={view === "weeks" ? 7 : 1}
          onChange={setStart}
        />
        <span className="range-label">
          {fmtLongDate(start)} – {fmtLongDate(addDays(start, days - 1))}
        </span>
        <span className={`calendar-status ${loading ? "loading" : "empty"}`}>
          {loading
            ? "Loading…"
            : sessions.length === 0
            ? "No bookings in view"
            : `${sessions.length} booking${sessions.length === 1 ? "" : "s"}${
                upcomingInView !== sessions.length ? ` · ${upcomingInView} upcoming` : ""
              }${toMark ? ` · ${toMark} to mark` : ""}`}
        </span>
        <div className="calendar-legend">
          <span>
            <span className="legend-swatch" style={{ background: hexToRgba(color, 0.22) }} /> Available
          </span>
          <span>
            <span className="legend-swatch" style={{ background: color }} /> Booked
          </span>
          <span>
            <span className="legend-swatch legend-hatched" /> Blocked off
          </span>
          <span className="zone-note" title={timeZone}>
            {zoneLabel(timeZone)}
          </span>
        </div>
        <CalendarViewSwitch view={view} onViewChange={changeView} weeks={weeks} onWeeksChange={setWeeks} />
      </div>
      {error && <p className="error-text">{error}</p>}

      {view === "weeks" ? (
        <MonthGrid
          start={start}
          weeks={weeks}
          timeZone={timeZone}
          today={today}
          items={monthItems}
          onDayClick={openDay}
          loading={loading}
        />
      ) : (
      <div className={`calendar-scroll${loading ? " is-loading" : ""}`} ref={scrollRef}>
        <div className="calendar-grid fill-grid">
          <div className="calendar-time-axis">
            <div className="calendar-time-axis-header" />
            <div style={{ position: "relative", height: gridHeight }}>
              {HOURS.map((h) => (
                <span key={h.index} className="calendar-time-label" style={{ top: h.index * 60 * pxPerMin }}>
                  {h.label}
                </span>
              ))}
            </div>
          </div>

          {displayDays.map((date) => {
            const segments = (ranges: RangeIso[]) =>
              ranges.flatMap((r) => {
                const seg = daySegment(r, date, timeZone, pxPerMin);
                return seg ? [seg] : [];
              });
            return (
              <div key={date} className="calendar-day-col fill-day-col">
                <div className={`calendar-day-header${date === today ? " is-today" : ""}`}>
                  <span className="dow">{dayFmt.format(new Date(`${date}T00:00:00.000Z`))}</span>
                  <span>{dateFmt.format(new Date(`${date}T00:00:00.000Z`))}</span>
                </div>
                <div className="calendar-body" style={{ height: gridHeight }}>
                  {HOURS.map((h) => (
                    <div key={h.index} className="calendar-hour-line" style={{ top: h.index * 60 * pxPerMin }} />
                  ))}
                  {segments(data?.available ?? []).map((seg, i) => (
                    <div
                      key={`a-${i}`}
                      className="calendar-block available"
                      style={{
                        top: seg.top,
                        height: seg.height,
                        left: 0,
                        right: 0,
                        background: hexToRgba(color, 0.14),
                        borderLeftColor: color,
                      }}
                      title={`Available ${fmtTime(seg.start, timeZone)}–${fmtTime(seg.end, timeZone)}`}
                    >
                      {fmtTime(seg.start, timeZone)}–{fmtTime(seg.end, timeZone)}
                    </div>
                  ))}
                  {segments(data?.blocked ?? []).map((seg, i) => (
                    <div
                      key={`b-${i}`}
                      className="calendar-block buffer"
                      style={{ top: seg.top, height: seg.height, left: 0, right: 0 }}
                      title={`Blocked off ${fmtTime(seg.start, timeZone)}–${fmtTime(seg.end, timeZone)}`}
                    />
                  ))}
                  {sessions.map((s) => {
                    const seg = daySegment({ start: s.startAt, end: s.endAt }, date, timeZone, pxPerMin);
                    if (!seg) return null;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        className={`calendar-block session status-${s.status}${
                          s.id === selectedId ? " is-selected" : ""
                        }${new Date(s.endAt).getTime() < Date.now() ? " is-past" : ""}`}
                        style={{ top: seg.top, height: seg.height, left: 4, right: 4, background: color }}
                        onClick={() => setSelectedId(s.id === selectedId ? null : s.id)}
                      >
                        <strong>
                          {fmtTime(s.startAt, timeZone)}–{fmtTime(s.endAt, timeZone)}
                        </strong>
                        <br />
                        {s.studentName} · {s.subjectName}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}

      {selected && (
        <SessionDetails
          session={selected}
          timeZone={timeZone}
          canCancel={canCancel}
          onClose={() => setSelectedId(null)}
          onCancelled={() => {
            setSelectedId(null);
            setReloadKey((k) => k + 1);
          }}
          onChanged={() => setReloadKey((k) => k + 1)}
        />
      )}
    </div>
  );
}

/** A session that has started but hasn't been marked completed or no-show yet. */
export function needsOutcome(s: { status: string; startAt: string }): boolean {
  return s.status === "confirmed" && new Date(s.startAt).getTime() <= Date.now();
}

/** " (completed)" etc. for tooltips. */
export function statusSuffix(status: string): string {
  return status === "completed"
    ? " (completed)"
    : status === "no_show"
    ? " (no-show)"
    : status === "cancelled"
    ? " (cancelled)"
    : "";
}

export function SessionDetails({
  session: s,
  timeZone,
  canCancel,
  onClose,
  onCancelled,
  onChanged,
}: {
  session: ScheduleSession;
  timeZone: string;
  /** The tutor or an admin: may cancel upcoming sessions and mark past ones. */
  canCancel: boolean;
  onClose: () => void;
  onCancelled: () => void;
  /** After marking an outcome: reload, keeping the panel open. */
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isPast = new Date(s.startAt).getTime() < Date.now();

  async function markOutcome(outcome: "completed" | "no_show" | "confirmed") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/bookings/${s.id}/outcome`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? "Couldn't save. Try again.");
        return;
      }
      onChanged();
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/bookings/${s.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? "Couldn't cancel. Try again.");
        return;
      }
      onCancelled();
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card session-details">
      <div className="session-details-head">
        <h2>
          {s.subjectName} with {s.studentName}
        </h2>
        <button type="button" className="secondary" onClick={onClose}>
          Close
        </button>
      </div>
      <dl className="details-list">
        {s.tutorName && (
          <>
            <dt>Tutor</dt>
            <dd>{s.tutorName}</dd>
          </>
        )}
        {s.status !== "confirmed" && (
          <>
            <dt>Status</dt>
            <dd>{s.status === "no_show" ? "No-show" : s.status === "completed" ? "Completed" : "Cancelled"}</dd>
          </>
        )}
        <dt>When</dt>
        <dd>
          {fmtLongDate(localDate(s.startAt, timeZone))}, {fmtTime(s.startAt, timeZone)}–
          {fmtTime(s.endAt, timeZone)} ({s.durationMin} min)
        </dd>
        <dt>Mode</dt>
        <dd>{s.mode === "online" ? "Online" : "In-person"}</dd>
        <dt>Student email</dt>
        <dd>{s.studentEmail}</dd>
        {s.studentPhone && (
          <>
            <dt>Phone</dt>
            <dd>{s.studentPhone}</dd>
          </>
        )}
        <dt>Price</dt>
        <dd>{fmtPrice(s.priceCents)}</dd>
        {s.description && (
          <>
            <dt>Needs help with</dt>
            <dd className="details-description">{s.description}</dd>
          </>
        )}
      </dl>

      {canCancel && isPast && ["confirmed", "completed", "no_show"].includes(s.status) && (
        <div className="session-outcome">
          <span className="session-outcome-label">
            {s.status === "confirmed" ? "How did it go?" : "Outcome"}
          </span>
          <button
            type="button"
            className={`outcome-btn completed${s.status === "completed" ? " is-on" : ""}`}
            disabled={busy}
            aria-pressed={s.status === "completed"}
            onClick={() => markOutcome(s.status === "completed" ? "confirmed" : "completed")}
          >
            ✓ Completed
          </button>
          <button
            type="button"
            className={`outcome-btn no-show${s.status === "no_show" ? " is-on" : ""}`}
            disabled={busy}
            aria-pressed={s.status === "no_show"}
            onClick={() => markOutcome(s.status === "no_show" ? "confirmed" : "no_show")}
          >
            ✗ No-show
          </button>
          {s.status !== "confirmed" && <span className="muted small">Click again to undo.</span>}
        </div>
      )}
      {error && !confirming && <p className="error-text">{error}</p>}

      {canCancel && s.status === "confirmed" && !isPast && (
        <div className="session-cancel">
          {!confirming ? (
            <button className="danger" onClick={() => setConfirming(true)}>
              Cancel this booking…
            </button>
          ) : (
            <>
              <div className="form-field" style={{ marginBottom: "0.6rem" }}>
                <label htmlFor={`cancel-reason-${s.id}`}>Message to {s.studentName} (optional)</label>
                <textarea
                  id={`cancel-reason-${s.id}`}
                  rows={3}
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Sorry, I'm sick that day. Feel free to book another time."
                  className="cancel-reason"
                />
              </div>
              <p className="small">
                {s.studentName} and the tutor will be emailed, with your message if you add one. No refund is issued
                yet, since payments aren&apos;t set up.
              </p>
              <div className="form-row" style={{ marginBottom: 0 }}>
                <button className="danger" disabled={busy} onClick={cancel}>
                  {busy ? "Cancelling…" : "Yes, cancel booking"}
                </button>
                <button className="secondary" disabled={busy} onClick={() => setConfirming(false)}>
                  Keep it
                </button>
              </div>
            </>
          )}
          {error && <p className="error-text">{error}</p>}
        </div>
      )}
    </div>
  );
}
