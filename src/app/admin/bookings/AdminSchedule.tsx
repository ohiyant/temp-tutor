"use client";

/**
 * Admin bookings calendar: every tutor's sessions for a week, colored by
 * tutor, in the admin's own timezone. Sessions that overlap (different
 * tutors at the same time) sit side by side. Click one for details and
 * Cancel. Tutor chips filter the view; checkboxes show or hide bookings,
 * cancelled bookings, and each tutor's availability (drawn underneath,
 * tinted in their color, one slot per tutor so they don't cover each other).
 */

import { useEffect, useState } from "react";
import { CONFIG } from "@/config";
import CalendarNav from "@/components/CalendarNav";
import TimeZoneSelect from "@/components/TimeZoneSelect";
import { useFitCalendar } from "@/components/useFitCalendar";
import CalendarViewSwitch, { type CalendarView } from "@/components/CalendarViewSwitch";
import MonthGrid, { type MonthItem } from "@/components/MonthGrid";
import { SessionDetails, needsOutcome, statusSuffix, type ScheduleSession } from "@/components/TutorSchedule";
import {
  WINDOW_LENGTH_MIN,
  addDays,
  dateFmt,
  dayFmt,
  daySegment,
  fmtLongDate,
  fmtShortTime,
  fmtTime,
  hexToRgba,
  hourMarks,
  initialScrollTop,
  minutesFromWindowStart,
  startOfWeek,
  todayIn,
} from "@/lib/calendarUi";
import { localTimeZone } from "@/lib/timezone";

interface AdminSession extends ScheduleSession {
  tutorId: string;
  tutorName: string;
  color: string;
}

interface AvailabilityRange {
  tutorId: string;
  tutorName: string;
  color: string;
  start: string;
  end: string;
}

interface TutorChip {
  id: string;
  name: string;
  color: string;
}

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
  const [view, setView] = useState<CalendarView>("days");
  const [weeks, setWeeks] = useState<number>(CONFIG.DEFAULT_CALENDAR_WEEKS);
  // Days view: a week from `start`. Weeks view: whole weeks from a Sunday.
  const days = view === "weeks" ? weeks * 7 : CONFIG.DEFAULT_CALENDAR_DAYS;
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
  const [showBookings, setShowBookings] = useState(true);
  const [showAvailability, setShowAvailability] = useState(true);
  const [availability, setAvailability] = useState<AvailabilityRange[]>([]);
  const { scrollRef, scrollEl, size, pxPerMin } = useFitCalendar();
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
        return body as { sessions: AdminSession[]; availability: AvailabilityRange[] };
      })
      .then((body) => {
        if (cancelled) return;
        setSessions(body.sessions);
        setAvailability(body.availability);
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

  const visible = showBookings
    ? sessions.filter((s) => !hidden.has(s.tutorId) && (showCancelled || s.status !== "cancelled"))
    : [];
  const visibleAvailability = showAvailability ? availability.filter((a) => !hidden.has(a.tutorId)) : [];

  // The grid covers the whole day and scrolls: on a new range (and once the
  // box reaches its final size), start just above the earliest thing shown.
  useEffect(() => {
    if (!loadedFor || !scrollEl) return;
    const starts = [...visible.map((s) => s.startAt), ...visibleAvailability.map((a) => a.start)].map((iso) =>
      minutesFromWindowStart(iso, timeZone)
    );
    scrollEl.scrollTop = initialScrollTop(starts.length ? Math.min(...starts) : null, pxPerMin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedFor, scrollEl, pxPerMin, size.height]);

  const today = todayIn(timeZone);
  const displayDays = Array.from({ length: days }, (_, i) => addDays(start, i));
  const gridHeight = WINDOW_LENGTH_MIN * pxPerMin;
  const selected = sessions.find((s) => s.id === selectedId) ?? null;
  const confirmedCount = visible.filter((s) => s.status !== "cancelled").length;
  const toMark = visible.filter(needsOutcome).length;

  function changeView(next: CalendarView) {
    setView(next);
    if (next === "weeks") setStart(startOfWeek(start));
  }

  function openDay(date: string) {
    setView("days");
    setStart(date);
  }

  const monthItems: MonthItem[] = [
    ...visibleAvailability.map((a, i) => ({
      id: `a-${i}`,
      start: a.start,
      end: a.end,
      label: `${a.tutorName} ${fmtShortTime(a.start, timeZone)}–${fmtShortTime(a.end, timeZone)}`,
      title: `${a.tutorName} available ${fmtTime(a.start, timeZone)}–${fmtTime(a.end, timeZone)}`,
      color: a.color,
      variant: "tint" as const,
    })),
    ...visible.map((s) => ({
      id: s.id,
      start: s.startAt,
      end: s.endAt,
      label: `${fmtShortTime(s.startAt, timeZone)} ${s.tutorName} · ${s.studentName}`,
      title: `${fmtTime(s.startAt, timeZone)}–${fmtTime(s.endAt, timeZone)} · ${s.tutorName} · ${s.studentName} · ${
        s.subjectName
      }${statusSuffix(s.status)}`,
      color: s.color,
      variant: s.status === "cancelled" ? ("cancelled" as const) : ("solid" as const),
      className: `status-${s.status}`,
      selected: s.id === selectedId,
      onClick: () => setSelectedId(s.id === selectedId ? null : s.id),
    })),
  ];
  // Chips for every tutor, plus any in this week's data that aren't listed (e.g. just removed).
  const chips = [...tutors];
  for (const s of sessions) {
    if (!chips.some((c) => c.id === s.tutorId)) chips.push({ id: s.tutorId, name: s.tutorName, color: s.color });
  }
  const chipOrder = (tutorId: string) => chips.findIndex((c) => c.id === tutorId);

  function toggleTutor(id: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="fit-calendar admin-schedule">
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
            : showBookings
            ? `${confirmedCount} booking${confirmedCount === 1 ? "" : "s"}${toMark ? ` · ${toMark} to mark` : ""}`
            : "Bookings hidden"}
        </span>
        <CalendarViewSwitch view={view} onViewChange={changeView} weeks={weeks} onWeeksChange={setWeeks} />
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
        <div className="admin-toggles">
          <label className="checkbox-row">
            <input type="checkbox" checked={showBookings} onChange={(e) => setShowBookings(e.target.checked)} />{" "}
            Bookings
          </label>
          <label className={`checkbox-row${showBookings ? "" : " is-disabled"}`}>
            <input
              type="checkbox"
              checked={showCancelled}
              disabled={!showBookings}
              onChange={(e) => setShowCancelled(e.target.checked)}
            />{" "}
            Cancelled
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={showAvailability}
              onChange={(e) => setShowAvailability(e.target.checked)}
            />{" "}
            Availability
          </label>
        </div>
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
            const placed = visible.flatMap((s) => {
              const seg = daySegment({ start: s.startAt, end: s.endAt }, date, timeZone, pxPerMin);
              return seg ? [{ s, seg, id: s.id, start: seg.top, end: seg.top + seg.height }] : [];
            });
            const lanes = layoutLanes(placed);
            // Availability: one slot per tutor who's free this day, in chip order.
            const availSegs = visibleAvailability.flatMap((a) => {
              const seg = daySegment(a, date, timeZone, pxPerMin);
              return seg ? [{ a, seg }] : [];
            });
            const availTutors = [...new Set(availSegs.map(({ a }) => a.tutorId))].sort(
              (x, y) => chipOrder(x) - chipOrder(y)
            );
            const slotPct = availTutors.length ? 100 / availTutors.length : 100;
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
                  {availSegs.map(({ a, seg }, i) => {
                    const slot = availTutors.indexOf(a.tutorId);
                    return (
                      <div
                        key={`a-${i}`}
                        className="calendar-block available"
                        style={{
                          top: seg.top,
                          height: seg.height,
                          left: `${slot * slotPct}%`,
                          width: `${slotPct}%`,
                          background: hexToRgba(a.color, 0.14),
                          borderLeftColor: a.color,
                        }}
                        title={`${a.tutorName} available ${fmtTime(seg.start, timeZone)}–${fmtTime(seg.end, timeZone)}`}
                      >
                        {availTutors.length > 1 ? a.tutorName : `${fmtTime(seg.start, timeZone)}–${fmtTime(seg.end, timeZone)}`}
                      </div>
                    );
                  })}
                  {placed.map(({ s, seg }) => {
                    const { lane, lanes: count } = lanes.get(s.id)!;
                    const widthPct = 100 / count;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        className={`calendar-block session admin-session status-${s.status}${
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
                        )}${statusSuffix(s.status)}`}
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
      )}

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
          onChanged={() => setReloadKey((k) => k + 1)}
        />
      )}
    </div>
  );
}
