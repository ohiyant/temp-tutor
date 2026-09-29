"use client";

/**
 * A tutor's own week: availability underneath, booked sessions on top.
 * Click a session for the student's details and a Cancel button (the
 * tutor can cancel their own sessions; admins can cancel any).
 *
 * Laid out in the TUTOR's timezone (even for an admin looking from
 * elsewhere), since that's the zone their weekly hours are written in.
 */

import { useEffect, useRef, useState } from "react";
import { CONFIG } from "@/config";
import CalendarNav from "@/components/CalendarNav";
import {
  WINDOW_LENGTH_MIN,
  addDays,
  dateFmt,
  dayFmt,
  daySegment,
  fmtLongDate,
  fmtPrice,
  fmtTime,
  hourMarks,
  localDate,
  minutesFromWindowStart,
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

const PX_PER_MIN = 0.8;
const HOURS = hourMarks();

export default function TutorSchedule({
  tutorId,
  timeZone,
  canCancel,
}: {
  tutorId: string;
  /** The tutor's timezone. */
  timeZone: string;
  canCancel: boolean;
}) {
  const today = todayIn(timeZone);
  const [start, setStart] = useState(today);
  const days = CONFIG.DEFAULT_CALENDAR_DAYS;
  const [data, setData] = useState<ScheduleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // When a new week loads, scroll to just above its earliest availability
  // or booking, so an afternoon-only tutor doesn't open on empty mornings.
  const loadedStart = data?.start;
  useEffect(() => {
    if (!data || !scrollRef.current) return;
    const starts = [...data.available.map((r) => r.start), ...data.sessions.map((s) => s.startAt)].map((iso) =>
      minutesFromWindowStart(iso, timeZone)
    );
    const earliest = starts.length ? Math.min(...starts) : 0;
    scrollRef.current.scrollTop = Math.max(0, (earliest - 30) * PX_PER_MIN);
    // Only on a new week, not on a reload after cancelling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedStart, timeZone]);

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
  const gridHeight = WINDOW_LENGTH_MIN * PX_PER_MIN;
  const sessions = data?.sessions ?? [];
  const selected = sessions.find((s) => s.id === selectedId) ?? null;
  const upcomingInView = sessions.filter((s) => new Date(s.endAt).getTime() > Date.now()).length;

  return (
    <div className="tutor-schedule">
      <div className="calendar-nav">
        <CalendarNav start={start} days={days} today={today} onChange={setStart} />
        <span className="range-label">
          {fmtLongDate(start)} – {fmtLongDate(addDays(start, days - 1))}
        </span>
        <span className="zone-note" title={timeZone}>
          Times in {zoneLabel(timeZone)}
        </span>
        {loading ? (
          <span className="calendar-status loading">Loading…</span>
        ) : (
          <span className="calendar-status empty">
            {sessions.length === 0
              ? "No bookings this week"
              : `${sessions.length} booking${sessions.length === 1 ? "" : "s"}${
                  upcomingInView !== sessions.length ? ` · ${upcomingInView} upcoming` : ""
                }`}
          </span>
        )}
        <div className="calendar-legend">
          <span>
            <span className="legend-swatch schedule-swatch-available" /> Available
          </span>
          <span>
            <span className="legend-swatch schedule-swatch-booked" /> Booked
          </span>
          <span>
            <span className="legend-swatch schedule-swatch-blocked" /> Blocked off
          </span>
        </div>
      </div>
      {error && <p className="error-text">{error}</p>}

      <div className={`calendar-scroll schedule-scroll${loading ? " is-loading" : ""}`} ref={scrollRef}>
        <div className="calendar-grid schedule-grid">
          <div className="calendar-time-axis">
            <div className="calendar-time-axis-header" />
            <div style={{ position: "relative", height: gridHeight }}>
              {HOURS.map((h) => (
                <span key={h.index} className="calendar-time-label" style={{ top: h.index * 60 * PX_PER_MIN }}>
                  {h.label}
                </span>
              ))}
            </div>
          </div>

          {displayDays.map((date) => {
            const segments = (ranges: RangeIso[]) =>
              ranges.flatMap((r) => {
                const seg = daySegment(r, date, timeZone, PX_PER_MIN);
                return seg ? [seg] : [];
              });
            const isToday = date === today;
            return (
              <div key={date} className="calendar-day-col schedule-day-col">
                <div className={`calendar-day-header${isToday ? " is-today" : ""}`}>
                  <span className="dow">{dayFmt.format(new Date(`${date}T00:00:00.000Z`))}</span>
                  <span>{dateFmt.format(new Date(`${date}T00:00:00.000Z`))}</span>
                </div>
                <div className="calendar-body" style={{ height: gridHeight }}>
                  {HOURS.map((h) => (
                    <div key={h.index} className="calendar-hour-line" style={{ top: h.index * 60 * PX_PER_MIN }} />
                  ))}
                  {segments(data?.available ?? []).map((seg, i) => (
                    <div
                      key={`a-${i}`}
                      className="calendar-block schedule-available"
                      style={{ top: seg.top, height: seg.height, left: 0, right: 0 }}
                      title={`Available ${fmtTime(seg.start, timeZone)}–${fmtTime(seg.end, timeZone)}`}
                    >
                      {fmtTime(seg.start, timeZone)}–{fmtTime(seg.end, timeZone)}
                    </div>
                  ))}
                  {segments(data?.blocked ?? []).map((seg, i) => (
                    <div
                      key={`b-${i}`}
                      className="calendar-block schedule-blocked"
                      style={{ top: seg.top, height: seg.height, left: 0, right: 0 }}
                      title={`Blocked off ${fmtTime(seg.start, timeZone)}–${fmtTime(seg.end, timeZone)}`}
                    />
                  ))}
                  {sessions.map((s) => {
                    const seg = daySegment({ start: s.startAt, end: s.endAt }, date, timeZone, PX_PER_MIN);
                    if (!seg) return null;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        className={`calendar-block schedule-session${s.id === selectedId ? " is-selected" : ""}${
                          new Date(s.endAt).getTime() < Date.now() ? " is-past" : ""
                        }`}
                        style={{ top: seg.top, height: seg.height, left: 4, right: 4 }}
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
        />
      )}
    </div>
  );
}

export function SessionDetails({
  session: s,
  timeZone,
  canCancel,
  onClose,
  onCancelled,
}: {
  session: ScheduleSession;
  timeZone: string;
  canCancel: boolean;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isPast = new Date(s.startAt).getTime() < Date.now();

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
        {s.status === "cancelled" && (
          <>
            <dt>Status</dt>
            <dd>Cancelled</dd>
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
