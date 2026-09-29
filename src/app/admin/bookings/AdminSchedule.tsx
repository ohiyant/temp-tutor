"use client";

/**
 * Admin bookings calendar: every tutor's sessions for a week, colored by
 * tutor, in the admin's own timezone. Sessions that overlap (different
 * tutors at the same time) sit side by side. Click one for details and
 * Cancel. Tutor chips filter the view; cancelled sessions can be shown.
 */

import { useEffect, useRef, useState } from "react";
import { CONFIG } from "@/config";
import CalendarNav from "@/components/CalendarNav";
import TimeZoneSelect from "@/components/TimeZoneSelect";
import { SessionDetails, type ScheduleSession } from "@/components/TutorSchedule";
import {
  WINDOW_LENGTH_MIN,
  addDays,
  dateFmt,
  dayFmt,
  daySegment,
  fmtLongDate,
  fmtTime,
  hourMarks,
  minutesFromWindowStart,
  todayIn,
} from "@/lib/calendarUi";
import { localTimeZone } from "@/lib/timezone";

interface AdminSession extends ScheduleSession {
  tutorId: string;
  tutorName: string;
  color: string;
}

interface TutorChip {
  id: string;
  name: string;
  color: string;
}

const PX_PER_MIN = 0.8;
const HOURS = hourMarks();

/** Side-by-side lanes for overlapping items: each gets its lane and the lane count of its overlap group. */
function layoutLanes<T extends { id: string; start: number; end: number }>(items: T[]) {
  const out = new Map<string, { lane: number; lanes: number }>();
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
  let cluster: { id: string; lane: number }[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    for (const c of cluster) out.set(c.id, { lane: c.lane, lanes: laneEnds.length });
    cluster = [];
    laneEnds = [];
  };
  for (const it of sorted) {
    if (it.start >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= it.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(it.end);
    } else {
      laneEnds[lane] = it.end;
    }
    cluster.push({ id: it.id, lane });
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  flush();
  return out;
}

export default function AdminSchedule({ tutors }: { tutors: TutorChip[] }) {
  const days = CONFIG.DEFAULT_CALENDAR_DAYS;
  // The admin's timezone is only known in the browser.
  const [zoneChoice, setZoneChoice] = useState<string | null>(null);
  const timeZone = zoneChoice ?? "UTC";
  const [start, setStart] = useState(() => todayIn("UTC"));
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [showCancelled, setShowCancelled] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  useEffect(() => {
    const zone = localTimeZone();
    setZoneChoice(zone);
    setStart(todayIn(zone));
  }, []);

  useEffect(() => {
    if (!zoneChoice) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ start, days: String(days), tz: zoneChoice });
    fetch(`/api/admin/schedule?${params.toString()}`)
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok) throw new Error(body?.error ?? "Failed to load");
        return body.sessions as AdminSession[];
      })
      .then((s) => {
        if (cancelled) return;
        setSessions(s);
        setLoadedFor(`${start}|${zoneChoice}`);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load bookings. Try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [start, days, zoneChoice, reloadKey]);

  const visible = sessions.filter((s) => !hidden.has(s.tutorId) && (showCancelled || s.status !== "cancelled"));

  // On a new week, scroll to just above the earliest session.
  useEffect(() => {
    if (!loadedFor || !scrollRef.current) return;
    const starts = visible.map((s) => minutesFromWindowStart(s.startAt, timeZone));
    const earliest = starts.length ? Math.min(...starts) : 60;
    scrollRef.current.scrollTop = Math.max(0, (earliest - 30) * PX_PER_MIN);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedFor]);

  const today = todayIn(timeZone);
  const displayDays = Array.from({ length: days }, (_, i) => addDays(start, i));
  const gridHeight = WINDOW_LENGTH_MIN * PX_PER_MIN;
  const selected = sessions.find((s) => s.id === selectedId) ?? null;
  const confirmedCount = visible.filter((s) => s.status !== "cancelled").length;
  // Chips for every tutor, plus any in this week's data that aren't listed (e.g. just removed).
  const chips = [...tutors];
  for (const s of sessions) {
    if (!chips.some((c) => c.id === s.tutorId)) chips.push({ id: s.tutorId, name: s.tutorName, color: s.color });
  }

  function toggleTutor(id: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="tutor-schedule admin-schedule">
      <div className="calendar-nav">
        <CalendarNav start={start} days={days} today={today} onChange={setStart} />
        <span className="range-label">
          {fmtLongDate(start)} – {fmtLongDate(addDays(start, days - 1))}
        </span>
        <span className={`calendar-status ${loading ? "loading" : "empty"}`}>
          {loading ? "Loading…" : `${confirmedCount} booking${confirmedCount === 1 ? "" : "s"}`}
        </span>
        <div className="form-field admin-tz">
          <label htmlFor="admin-tz">Timezone</label>
          <TimeZoneSelect id="admin-tz" value={timeZone} disabled={!zoneChoice} onChange={setZoneChoice} />
        </div>
      </div>

      <div className="admin-filters">
        {chips.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tutor-chip${hidden.has(t.id) ? " is-off" : ""}`}
            onClick={() => toggleTutor(t.id)}
            aria-pressed={!hidden.has(t.id)}
            title={hidden.has(t.id) ? `Show ${t.name}` : `Hide ${t.name}`}
          >
            <span className="legend-swatch" style={{ background: t.color }} />
            {t.name}
          </button>
        ))}
        <label className="checkbox-row admin-show-cancelled">
          <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /> Show
          cancelled
        </label>
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
            const placed = visible.flatMap((s) => {
              const seg = daySegment({ start: s.startAt, end: s.endAt }, date, timeZone, PX_PER_MIN);
              return seg ? [{ s, seg, id: s.id, start: seg.top, end: seg.top + seg.height }] : [];
            });
            const lanes = layoutLanes(placed);
            return (
              <div key={date} className="calendar-day-col schedule-day-col">
                <div className={`calendar-day-header${date === today ? " is-today" : ""}`}>
                  <span className="dow">{dayFmt.format(new Date(`${date}T00:00:00.000Z`))}</span>
                  <span>{dateFmt.format(new Date(`${date}T00:00:00.000Z`))}</span>
                </div>
                <div className="calendar-body" style={{ height: gridHeight }}>
                  {HOURS.map((h) => (
                    <div key={h.index} className="calendar-hour-line" style={{ top: h.index * 60 * PX_PER_MIN }} />
                  ))}
                  {placed.map(({ s, seg }) => {
                    const { lane, lanes: count } = lanes.get(s.id)!;
                    const widthPct = 100 / count;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        className={`calendar-block schedule-session admin-session${
                          s.id === selectedId ? " is-selected" : ""
                        }${s.status === "cancelled" ? " is-cancelled" : ""}${
                          new Date(s.endAt).getTime() < Date.now() ? " is-past" : ""
                        }`}
                        style={{
                          top: seg.top,
                          height: seg.height,
                          left: `calc(${lane * widthPct}% + 2px)`,
                          width: `calc(${widthPct}% - 4px)`,
                          background: s.color,
                        }}
                        title={`${s.tutorName} · ${s.studentName} · ${fmtTime(s.startAt, timeZone)}–${fmtTime(
                          s.endAt,
                          timeZone
                        )}${s.status === "cancelled" ? " (cancelled)" : ""}`}
                        onClick={() => setSelectedId(s.id === selectedId ? null : s.id)}
                      >
                        <strong>
                          {fmtTime(s.startAt, timeZone)}–{fmtTime(s.endAt, timeZone)}
                        </strong>
                        <br />
                        {s.tutorName} · {s.studentName}
                        <br />
                        {s.subjectName}
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
          canCancel
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
