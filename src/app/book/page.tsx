"use client";

/**
 * Booking page — interactive calendar version.
 *
 * Replaces the old linear wizard (subject -> mode -> date -> tutor list ->
 * slot buttons) with a single screen: filters + a weekly calendar where
 * every matching tutor's free time is drawn as a block. Hovering a free
 * block shows a line at the start time a click would pick (snapped to
 * START_TIME_INCREMENT_MIN). A short click adds a DEFAULT_SESSION_LENGTH_MIN
 * session; clicking and dragging down picks the length instead. Several
 * sessions can be selected before pressing "Continue" to open the
 * guest-details form.
 *
 * The calendar is sized to fill the viewport: day columns stretch to the
 * available width and the 7am–9pm window is scaled to the available height,
 * so the page itself never scrolls while the calendar is shown.
 *
 * DISPLAY NOTE: all times are rendered with `timeZone: "UTC"` on purpose.
 * The availability engine treats stored times as tutor "wall clock" values
 * (see the big comment in src/lib/availability.ts) — they are NOT true UTC
 * instants, just UTC-shaped storage for a single shared timezone. Formatting
 * with the browser's local timezone (as the old wizard did via
 * `toLocaleString(undefined, ...)`) would silently shift every displayed
 * time by the visitor's UTC offset. Forcing `timeZone: "UTC"` here displays
 * exactly the wall-clock time a tutor configured, which is correct under
 * that same-timezone MVP assumption.
 */

import { useEffect, useRef, useState } from "react";
import { CONFIG } from "@/config";

// ---------- Types matching /api/calendar's response ----------

interface Subject {
  id: string;
  name: string;
}

interface RangeIso {
  start: string;
  end: string;
}

interface BusyRangeIso extends RangeIso {
  kind: "session" | "hold";
}

interface DayCell {
  date: string;
  free: RangeIso[];
  busy: BusyRangeIso[];
  buffer: RangeIso[];
}

interface CalendarTutor {
  tutorId: string;
  tutorName: string;
  color: string;
  hourlyRateCents: number;
  onlineAvailable: boolean;
  inPersonAvailable: boolean;
  earliestAllowedStart: string;
  latestAllowedStart: string;
  days: DayCell[];
}

interface CalendarResponse {
  start: string;
  days: string[];
  bufferMin: number;
  tutors: CalendarTutor[];
}

type SessionMode = "online" | "in_person";
type FilterMode = SessionMode | "both";
type Step = "calendar" | "details" | "review";

interface Selected {
  id: string;
  tutorId: string;
  tutorName: string;
  color: string;
  hourlyRateCents: number;
  onlineAvailable: boolean;
  inPersonAvailable: boolean;
  date: string;
  startAt: string; // ISO
  blockEndAt: string; // ISO — the free block's own end, bounds max duration
  durationMin: number;
  sessionMode: SessionMode;
}

// ---------- Layout constants for the grid ----------

const WINDOW_START_MIN = 7 * 60; // 7:00 am
const WINDOW_END_MIN = 21 * 60; // 9:00 pm
const WINDOW_LENGTH_MIN = WINDOW_END_MIN - WINDOW_START_MIN;
// The grid is scaled to fit the available height, but never squashed below
// this — past that point the calendar scrolls inside its own box instead.
const MIN_PX_PER_MIN = 0.6;
// Same idea horizontally: columns stretch to fill the width down to this.
const MIN_COLUMN_WIDTH_PX = 110;
const TIME_AXIS_WIDTH_PX = 52; // keep in sync with .calendar-time-axis
const DAY_HEADER_HEIGHT_PX = 44; // keep in sync with .calendar-day-header
// Mouse movement below this counts as a click rather than a drag.
const DRAG_THRESHOLD_PX = 4;

// ---------- Formatting helpers (all forced to UTC, see file header) ----------

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" });
const dateFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const longDateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

function fmtTime(iso: string): string {
  return timeFmt.format(new Date(iso));
}
function fmtLongDate(dateStr: string): string {
  return longDateFmt.format(new Date(`${dateStr}T00:00:00.000Z`));
}
function fmtPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}
function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Minutes from the grid's 7am window-start, clamped into [0, windowLength]. */
function minutesFromWindowStart(iso: string): number {
  const d = new Date(iso);
  const minutesSinceMidnight = d.getUTCHours() * 60 + d.getUTCMinutes();
  return minutesSinceMidnight - WINDOW_START_MIN;
}

function blockStyle(startIso: string, endIso: string, pxPerMin: number): { top: number; height: number } {
  const top = Math.max(0, minutesFromWindowStart(startIso)) * pxPerMin;
  const rawEnd = Math.min(WINDOW_LENGTH_MIN, minutesFromWindowStart(endIso));
  const height = Math.max(2, rawEnd * pxPerMin - top);
  return { top, height };
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Overlay offset when several tutors' blocks share one day column: each
// tutor after the first is nudged right and slightly narrowed, so blocks
// fan out like stacked cards instead of one totally hiding another.
function overlayOffset(tutorIndex: number, columnWidthPx: number) {
  const step = Math.min(18, Math.floor(columnWidthPx / 6));
  const capped = Math.min(tutorIndex, 6);
  const left = capped * step;
  const width = Math.max(columnWidthPx * 0.55, columnWidthPx - left);
  return { left, width };
}

function sessionPriceCents(hourlyRateCents: number, durationMin: number): number {
  return Math.round((hourlyRateCents * durationMin) / 60);
}

function selectionEndIso(s: Selected): string {
  return new Date(new Date(s.startAt).getTime() + s.durationMin * 60000).toISOString();
}

/** The start time a click `offsetY` px into a free block would pick: snapped
 *  to START_TIME_INCREMENT_MIN and pulled back so a minimum-length session
 *  still fits inside the block and the tutor's booking window. */
function snapStartAt(tutor: CalendarTutor, free: RangeIso, offsetY: number, pxPerMin: number): Date {
  const blockStart = new Date(free.start);
  const blockEnd = new Date(free.end);
  const step = CONFIG.START_TIME_INCREMENT_MIN;
  const snappedMin = Math.floor(offsetY / pxPerMin / step) * step;
  let startAt = new Date(blockStart.getTime() + snappedMin * 60000);

  const latest = new Date(tutor.latestAllowedStart);
  if (startAt.getTime() > latest.getTime()) startAt = latest;
  if (startAt.getTime() < blockStart.getTime()) startAt = new Date(blockStart);

  const maxStartForMin = new Date(blockEnd.getTime() - CONFIG.MIN_SESSION_LENGTH_MIN * 60000);
  if (startAt.getTime() > maxStartForMin.getTime()) {
    startAt = maxStartForMin.getTime() < blockStart.getTime() ? new Date(blockStart) : maxStartForMin;
  }
  return startAt;
}

/** Longest session (snapped to SESSION_DURATION_INCREMENT_MIN) that can start
 *  at `startMs` without running past the free block or into another selected
 *  session. May be below MIN_SESSION_LENGTH_MIN, meaning nothing fits. */
function maxDurationAt(startMs: number, blockEndMs: number, others: Selected[]): number {
  let limitMs = blockEndMs;
  for (const o of others) {
    const oStart = new Date(o.startAt).getTime();
    if (oStart >= startMs && oStart < limitMs) limitMs = oStart;
  }
  const room = Math.min(CONFIG.MAX_SESSION_LENGTH_MIN, Math.floor((limitMs - startMs) / 60000));
  if (room < CONFIG.MIN_SESSION_LENGTH_MIN) return room;
  const step = CONFIG.SESSION_DURATION_INCREMENT_MIN;
  return CONFIG.MIN_SESSION_LENGTH_MIN + Math.floor((room - CONFIG.MIN_SESSION_LENGTH_MIN) / step) * step;
}

interface DragState {
  tutor: CalendarTutor;
  date: string;
  blockEnd: Date;
  startAt: Date;
  startClientY: number;
  pxPerMin: number;
  maxDurationMin: number;
  durationMin: number;
  moved: boolean; // false until the mouse passes DRAG_THRESHOLD_PX — i.e. still a click
  columnLeft: number;
  columnWidth: number;
}

interface HoverState {
  date: string;
  startAt: string; // ISO
}

export default function BookPage() {
  const [step, setStep] = useState<Step>("calendar");
  const [error, setError] = useState<string | null>(null);

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectId, setSubjectId] = useState<string>("");
  const [filterMode, setFilterMode] = useState<FilterMode>("both");
  const [filterTutorId, setFilterTutorId] = useState<string>(""); // "" = any tutor

  const [calendarStart, setCalendarStart] = useState<string>(todayDateString());
  const [calendarDays, setCalendarDays] = useState<number>(CONFIG.DEFAULT_CALENDAR_DAYS);

  const [calendarData, setCalendarData] = useState<CalendarResponse | null>(null);
  const [loadingCalendar, setLoadingCalendar] = useState(false);

  // Size of the calendar's scroll box, so the grid can be scaled to fill it.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [scrollSize, setScrollSize] = useState({ width: 0, height: 0 });

  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  const [selections, setSelections] = useState<Selected[]>([]);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [description, setDescription] = useState("");
  const [detailsError, setDetailsError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/subjects")
      .then((r) => r.json())
      .then(setSubjects)
      .catch(() => setError("Failed to load subjects. Refresh and try again."));
  }, []);

  useEffect(() => {
    if (!subjectId) {
      setCalendarData(null);
      return;
    }
    setLoadingCalendar(true);
    setError(null);
    const params = new URLSearchParams({
      subjectId,
      mode: filterMode,
      start: calendarStart,
      days: String(calendarDays),
    });
    fetch(`/api/calendar?${params.toString()}`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load the calendar");
        return r.json();
      })
      .then((data: CalendarResponse) => setCalendarData(data))
      .catch(() => setError("Failed to load the calendar. Try again."))
      .finally(() => setLoadingCalendar(false));
  }, [subjectId, filterMode, calendarStart, calendarDays]);

  useEffect(() => {
    if (!scrollEl) return;
    const measure = () => setScrollSize({ width: scrollEl.clientWidth, height: scrollEl.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scrollEl);
    return () => observer.disconnect();
  }, [scrollEl]);

  const subjectName = subjects.find((s) => s.id === subjectId)?.name ?? "";

  const allTutorsForFilter = calendarData?.tutors ?? [];
  const visibleTutors = filterTutorId
    ? allTutorsForFilter.filter((t) => t.tutorId === filterTutorId)
    : allTutorsForFilter;

  const dayCount = calendarData?.days.length ?? calendarDays;
  const columnWidthPx = scrollSize.width
    ? Math.max(MIN_COLUMN_WIDTH_PX, Math.floor((scrollSize.width - TIME_AXIS_WIDTH_PX) / dayCount))
    : 168;
  // Leave a few px of slack so rounding never tips the box into scrolling.
  const pxPerMin = scrollSize.height
    ? Math.max(MIN_PX_PER_MIN, (scrollSize.height - DAY_HEADER_HEIGHT_PX - 8) / WINDOW_LENGTH_MIN)
    : 1;
  const gridHeight = WINDOW_LENGTH_MIN * pxPerMin;
  // Blocks sit inside the column's 1px right border.
  const blockAreaWidth = columnWidthPx - 1;

  // ---------- Drag lifecycle: attach window listeners only while dragging ----------
  const isDragging = drag !== null;
  useEffect(() => {
    if (!isDragging) return;

    function onMove(e: MouseEvent) {
      const d = dragRef.current;
      if (!d) return;
      const deltaY = e.clientY - d.startClientY;
      if (!d.moved && Math.abs(deltaY) < DRAG_THRESHOLD_PX) return;
      const step = CONFIG.SESSION_DURATION_INCREMENT_MIN;
      let duration = Math.round(deltaY / d.pxPerMin / step) * step;
      duration = Math.max(CONFIG.MIN_SESSION_LENGTH_MIN, Math.min(d.maxDurationMin, duration));
      const updated = { ...d, moved: true, durationMin: duration };
      dragRef.current = updated;
      setDrag(updated);
    }

    function onUp() {
      const d = dragRef.current;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      dragRef.current = null;
      setDrag(null);
      if (d) addSelection(d);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging]);

  function handleFreeBlockMouseDown(
    e: React.MouseEvent,
    tutor: CalendarTutor,
    date: string,
    free: RangeIso,
    columnLeft: number,
    columnWidth: number
  ) {
    if (e.button !== 0) return;
    e.preventDefault();
    setError(null);
    const rect = e.currentTarget.getBoundingClientRect();
    const startAt = snapStartAt(tutor, free, e.clientY - rect.top, pxPerMin);
    const startMs = startAt.getTime();

    const clash = selections.some(
      (s) => new Date(s.startAt).getTime() <= startMs && startMs < new Date(selectionEndIso(s)).getTime()
    );
    if (clash) {
      setError("You already have a session selected at that time.");
      return;
    }

    const blockEnd = new Date(free.end);
    const maxDurationMin = maxDurationAt(startMs, blockEnd.getTime(), selections);
    if (maxDurationMin < CONFIG.MIN_SESSION_LENGTH_MIN) {
      setError(`There isn't room to book there — a session needs at least ${CONFIG.MIN_SESSION_LENGTH_MIN} minutes.`);
      return;
    }

    const newDrag: DragState = {
      tutor,
      date,
      blockEnd,
      startAt,
      startClientY: e.clientY,
      pxPerMin,
      maxDurationMin,
      // What a plain click (no drag) books; replaced once the mouse moves.
      durationMin: Math.min(CONFIG.DEFAULT_SESSION_LENGTH_MIN, maxDurationMin),
      moved: false,
      columnLeft,
      columnWidth,
    };
    dragRef.current = newDrag;
    setDrag(newDrag);
  }

  function handleFreeBlockMouseMove(e: React.MouseEvent, tutor: CalendarTutor, date: string, free: RangeIso) {
    const rect = e.currentTarget.getBoundingClientRect();
    const startAt = snapStartAt(tutor, free, e.clientY - rect.top, pxPerMin).toISOString();
    if (hover?.date !== date || hover.startAt !== startAt) setHover({ date, startAt });
  }

  function addSelection(d: DragState) {
    const defaultMode: SessionMode =
      filterMode !== "both" ? filterMode : d.tutor.onlineAvailable ? "online" : "in_person";
    const startAt = d.startAt.toISOString();
    setSelections((prev) => [
      ...prev,
      {
        id: `${d.tutor.tutorId}-${startAt}`,
        tutorId: d.tutor.tutorId,
        tutorName: d.tutor.tutorName,
        color: d.tutor.color,
        hourlyRateCents: d.tutor.hourlyRateCents,
        onlineAvailable: d.tutor.onlineAvailable,
        inPersonAvailable: d.tutor.inPersonAvailable,
        date: d.date,
        startAt,
        blockEndAt: d.blockEnd.toISOString(),
        durationMin: d.durationMin,
        sessionMode: defaultMode,
      },
    ]);
  }

  function updateSelection(id: string, patch: Partial<Selected>) {
    setSelections((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function removeSelection(id: string) {
    setSelections((prev) => prev.filter((s) => s.id !== id));
  }

  function goToReview() {
    setDetailsError(null);
    if (!name.trim()) return setDetailsError("Enter your name.");
    if (!/^\S+@\S+\.\S+$/.test(email)) return setDetailsError("Enter a valid email.");
    if (description.length > CONFIG.DESCRIPTION_MAX_CHARS) {
      return setDetailsError(`Description must be ${CONFIG.DESCRIPTION_MAX_CHARS} characters or fewer.`);
    }
    setStep("review");
  }

  const sortedSelections = [...selections].sort((a, b) => a.startAt.localeCompare(b.startAt));
  const totalCents = selections.reduce((sum, s) => sum + sessionPriceCents(s.hourlyRateCents, s.durationMin), 0);
  const hourMarks = Array.from({ length: WINDOW_LENGTH_MIN / 60 + 1 }, (_, i) => i);

  return (
    <div className={`container-wide ${step === "calendar" ? "calendar-mode" : ""}`}>
      <h1>Book a Tutor</h1>
      {error && <p className="error-text">{error}</p>}

      {step === "calendar" && (
        <>
          <div className="filters-bar">
            <div className="form-field">
              <label>Subject</label>
              <select
                value={subjectId}
                onChange={(e) => {
                  setSubjectId(e.target.value);
                  setSelections([]);
                }}
              >
                <option value="">Choose a subject...</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label>Mode</label>
              <select value={filterMode} onChange={(e) => setFilterMode(e.target.value as FilterMode)}>
                <option value="both">Online or in-person</option>
                <option value="online">Online only</option>
                <option value="in_person">In-person only</option>
              </select>
            </div>
            <div className="form-field">
              <label>Tutor</label>
              <select value={filterTutorId} onChange={(e) => setFilterTutorId(e.target.value)}>
                <option value="">Any tutor</option>
                {allTutorsForFilter.map((t) => (
                  <option key={t.tutorId} value={t.tutorId}>
                    {t.tutorName}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label>Days shown</label>
              <input
                type="number"
                min={1}
                max={CONFIG.MAX_CALENDAR_DAYS}
                value={calendarDays}
                onChange={(e) =>
                  setCalendarDays(Math.max(1, Math.min(CONFIG.MAX_CALENDAR_DAYS, Number(e.target.value) || 1)))
                }
                style={{ width: "4rem" }}
              />
            </div>
          </div>

          {!subjectId && <p className="note">Pick a subject to see tutors&apos; availability on the calendar.</p>}

          {subjectId && (
            <>
              <div className="calendar-nav">
                <button onClick={() => setCalendarStart(addDays(calendarStart, -calendarDays))} style={{ background: "#e5e5e5", color: "#333" }}>
                  ← Previous {calendarDays}
                </button>
                <button onClick={() => setCalendarStart(todayDateString())} style={{ background: "#e5e5e5", color: "#333" }}>
                  Today
                </button>
                <button onClick={() => setCalendarStart(addDays(calendarStart, calendarDays))} style={{ background: "#e5e5e5", color: "#333" }}>
                  Next {calendarDays} →
                </button>
                <span className="range-label">
                  {fmtLongDate(calendarStart)} – {fmtLongDate(addDays(calendarStart, calendarDays - 1))}
                </span>
                <div className="calendar-legend">
                  {allTutorsForFilter.map((t) => (
                    <span key={t.tutorId}>
                      <span className="legend-swatch" style={{ background: t.color }} />
                      {t.tutorName}
                    </span>
                  ))}
                  <span>
                    <span className="legend-swatch" style={{ background: "#8a8a8a" }} /> Booked
                  </span>
                  <span>
                    <span className="legend-swatch" style={{ background: "#c9b458" }} /> Pending checkout
                  </span>
                  <span>
                    <span className="legend-swatch" style={{ background: "repeating-linear-gradient(45deg,#ccc,#ccc 3px,#eee 3px,#eee 6px)" }} /> Travel buffer
                  </span>
                </div>
              </div>

              {loadingCalendar && <p>Loading availability...</p>}
              {!loadingCalendar && calendarData && allTutorsForFilter.length === 0 && (
                <p>No tutors match this subject and mode yet.</p>
              )}

              {!loadingCalendar && calendarData && allTutorsForFilter.length > 0 && (
                <>
                  <div className="calendar-scroll" ref={setScrollEl}>
                    <div className="calendar-grid">
                      <div className="calendar-time-axis">
                        <div className="calendar-time-axis-header" />
                        <div style={{ position: "relative", height: gridHeight }}>
                          {hourMarks.map((i) => {
                            const minute = WINDOW_START_MIN + i * 60;
                            const label = timeFmt.format(new Date(Date.UTC(2000, 0, 1, Math.floor(minute / 60), minute % 60)));
                            return (
                              <span key={i} className="calendar-time-label" style={{ top: i * 60 * pxPerMin }}>
                                {label}
                              </span>
                            );
                          })}
                        </div>
                      </div>

                      {calendarData.days.map((date) => (
                        <div key={date} className="calendar-day-col" style={{ width: columnWidthPx }}>
                          <div className="calendar-day-header">
                            <span className="dow">{dayFmt.format(new Date(`${date}T00:00:00.000Z`))}</span>
                            <span>{dateFmt.format(new Date(`${date}T00:00:00.000Z`))}</span>
                          </div>
                          <div className="calendar-body" style={{ height: gridHeight }}>
                            {hourMarks.map((i) => (
                              <div key={i} className="calendar-hour-line" style={{ top: i * 60 * pxPerMin }} />
                            ))}

                            {visibleTutors.map((tutor, tIdx) => {
                              const day = tutor.days.find((d) => d.date === date);
                              if (!day) return null;
                              const { left, width } = overlayOffset(tIdx, blockAreaWidth);
                              return (
                                <div key={tutor.tutorId}>
                                  {day.busy.map((b, i) => {
                                    const { top, height } = blockStyle(b.start, b.end, pxPerMin);
                                    return (
                                      <div
                                        key={`busy-${i}`}
                                        className={`calendar-block ${b.kind === "hold" ? "busy-hold" : "busy-session"}`}
                                        style={{ top, height, left, width, zIndex: tIdx }}
                                        title={b.kind === "hold" ? "Someone else is checking out for this time" : "Booked"}
                                      >
                                        {b.kind === "hold" ? "Pending" : "Booked"}
                                      </div>
                                    );
                                  })}
                                  {day.buffer.map((b, i) => {
                                    const { top, height } = blockStyle(b.start, b.end, pxPerMin);
                                    return (
                                      <div
                                        key={`buf-${i}`}
                                        className="calendar-block buffer"
                                        style={{ top, height, left, width, zIndex: tIdx }}
                                        title="Travel buffer"
                                      />
                                    );
                                  })}
                                  {day.free.map((f, i) => {
                                    const { top, height } = blockStyle(f.start, f.end, pxPerMin);
                                    return (
                                      <div
                                        key={`free-${i}`}
                                        className="calendar-block free"
                                        style={{
                                          top,
                                          height,
                                          left,
                                          width,
                                          zIndex: tIdx + 10,
                                          background: hexToRgba(tutor.color, 0.55),
                                        }}
                                        onMouseDown={(e) => handleFreeBlockMouseDown(e, tutor, date, f, left, width)}
                                        onMouseMove={(e) => handleFreeBlockMouseMove(e, tutor, date, f)}
                                        onMouseLeave={() => setHover(null)}
                                        title={`${tutor.tutorName} — click for ${CONFIG.DEFAULT_SESSION_LENGTH_MIN} min, or drag down to choose the length`}
                                      >
                                        {subjectName} · {tutor.tutorName}
                                        <br />
                                        {filterMode === "both"
                                          ? [tutor.onlineAvailable && "Online", tutor.inPersonAvailable && "In-person"]
                                              .filter(Boolean)
                                              .join("/")
                                          : filterMode === "online"
                                          ? "Online"
                                          : "In-person"}
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })}

                            {selections
                              .filter((s) => s.date === date)
                              .map((s) => {
                                const tIdx = visibleTutors.findIndex((t) => t.tutorId === s.tutorId);
                                const { left, width } =
                                  tIdx >= 0 ? overlayOffset(tIdx, blockAreaWidth) : { left: 0, width: blockAreaWidth };
                                const endIso = selectionEndIso(s);
                                return (
                                  <div
                                    key={s.id}
                                    className="calendar-block selected"
                                    style={{ ...blockStyle(s.startAt, endIso, pxPerMin), left, width, background: s.color }}
                                    title={`${s.tutorName} · ${fmtTime(s.startAt)}–${fmtTime(endIso)}`}
                                  >
                                    <button
                                      type="button"
                                      className="selected-remove"
                                      aria-label="Remove this session"
                                      onMouseDown={(e) => e.stopPropagation()}
                                      onClick={() => removeSelection(s.id)}
                                    >
                                      ×
                                    </button>
                                    {fmtTime(s.startAt)}–{fmtTime(endIso)}
                                    <br />
                                    {s.tutorName} · {s.durationMin} min
                                  </div>
                                );
                              })}

                            {hover && hover.date === date && !drag?.moved && (
                              <div
                                className="calendar-hover-line"
                                style={{ top: minutesFromWindowStart(hover.startAt) * pxPerMin }}
                              >
                                <span>{fmtTime(hover.startAt)}</span>
                              </div>
                            )}

                            {drag && drag.moved && drag.date === date && (
                              <div
                                className="calendar-block drag-preview"
                                style={{
                                  ...blockStyle(
                                    drag.startAt.toISOString(),
                                    new Date(drag.startAt.getTime() + drag.durationMin * 60000).toISOString(),
                                    pxPerMin
                                  ),
                                  left: drag.columnLeft,
                                  width: drag.columnWidth,
                                  background: hexToRgba(drag.tutor.color, 0.85),
                                }}
                              >
                                {fmtTime(drag.startAt.toISOString())} · {drag.durationMin} min ·{" "}
                                {fmtPrice(sessionPriceCents(drag.tutor.hourlyRateCents, drag.durationMin))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="selection-bar">
                    <span className="summary">
                      {selections.length === 0
                        ? `Click a free block to add a ${CONFIG.DEFAULT_SESSION_LENGTH_MIN}-minute session, or drag down to choose the length. You can add several.`
                        : `${selections.length} session${selections.length === 1 ? "" : "s"} selected · ${fmtPrice(totalCents)}`}
                    </span>
                    {selections.length > 0 && (
                      <button onClick={() => setSelections([])} style={{ background: "#e5e5e5", color: "#333" }}>
                        Clear
                      </button>
                    )}
                    <button
                      disabled={selections.length === 0}
                      onClick={() => {
                        setError(null);
                        setStep("details");
                      }}
                    >
                      Continue
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}

      {step === "details" && selections.length > 0 && (
        <div className="card">
          <h2>Your details</h2>

          {sortedSelections.map((s) => {
            const others = selections.filter((o) => o.id !== s.id);
            const maxDuration = maxDurationAt(new Date(s.startAt).getTime(), new Date(s.blockEndAt).getTime(), others);
            return (
              <div key={s.id} className="session-item">
                <p className="session-summary">
                  {s.tutorName} · {subjectName} · {fmtLongDate(s.date)} · {fmtTime(s.startAt)}–{fmtTime(selectionEndIso(s))}
                </p>
                <div className="form-row">
                  <div className="form-field">
                    <label>Mode</label>
                    <select
                      value={s.sessionMode}
                      onChange={(e) => updateSelection(s.id, { sessionMode: e.target.value as SessionMode })}
                    >
                      {s.onlineAvailable && <option value="online">Online</option>}
                      {s.inPersonAvailable && <option value="in_person">In-person</option>}
                    </select>
                  </div>
                  <div className="form-field duration-field">
                    <label>
                      Duration: {s.durationMin} min · {fmtPrice(sessionPriceCents(s.hourlyRateCents, s.durationMin))}
                    </label>
                    <input
                      type="range"
                      min={CONFIG.MIN_SESSION_LENGTH_MIN}
                      max={maxDuration}
                      step={CONFIG.SESSION_DURATION_INCREMENT_MIN}
                      value={s.durationMin}
                      onChange={(e) => updateSelection(s.id, { durationMin: Number(e.target.value) })}
                    />
                  </div>
                  {selections.length > 1 && (
                    <button className="danger" onClick={() => removeSelection(s.id)}>
                      Remove
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {detailsError && <p className="error-text">{detailsError}</p>}
          <div className="form-field" style={{ marginBottom: "0.75rem" }}>
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="form-field" style={{ marginBottom: "0.75rem" }}>
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="form-field" style={{ marginBottom: "0.75rem" }}>
            <label>Phone</label>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="form-field" style={{ marginBottom: "0.75rem" }}>
            <label>
              What do you need help with? ({description.length}/{CONFIG.DESCRIPTION_MAX_CHARS})
            </label>
            <textarea
              value={description}
              maxLength={CONFIG.DESCRIPTION_MAX_CHARS}
              rows={4}
              onChange={(e) => setDescription(e.target.value)}
              style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px", fontFamily: "inherit" }}
            />
          </div>
          <div className="form-row">
            <button onClick={goToReview}>Review Booking</button>
            <button onClick={() => setStep("calendar")} style={{ background: "#e5e5e5", color: "#333" }}>
              Back to calendar
            </button>
          </div>
        </div>
      )}

      {step === "review" && selections.length > 0 && (
        <div className="card">
          <h2>Review & confirm</h2>
          <div className="list-row">
            <span>Subject</span>
            <span>{subjectName}</span>
          </div>
          {sortedSelections.map((s) => (
            <div key={s.id} className="list-row">
              <span>
                {s.tutorName} · {fmtLongDate(s.date)} · {fmtTime(s.startAt)}–{fmtTime(selectionEndIso(s))} ·{" "}
                {s.durationMin} min · {s.sessionMode === "online" ? "Online" : "In-person"}
              </span>
              <span>{fmtPrice(sessionPriceCents(s.hourlyRateCents, s.durationMin))}</span>
            </div>
          ))}
          <div className="list-row">
            <span>
              <strong>Total price</strong>
            </span>
            <span>
              <strong>{fmtPrice(totalCents)}</strong>
            </span>
          </div>

          <div style={{ marginTop: "1rem", fontSize: "0.85rem", color: "#555" }}>
            <p>
              <strong>Cancellation policy:</strong> more than {CONFIG.CANCEL_NOTICE_THRESHOLD_HOURS} hours before your
              session, {CONFIG.CANCEL_REFUND_PCT_GT_24H * 100}% refund. {CONFIG.CANCEL_NOTICE_THRESHOLD_HOURS} hours
              or less before, {CONFIG.CANCEL_REFUND_PCT_LTE_24H * 100}% refund.
            </p>
            <p>
              <strong>Rescheduling policy:</strong> allowed only more than {CONFIG.RESCHEDULE_MIN_NOTICE_HOURS} hours
              before your session, for a {CONFIG.RESCHEDULE_FEE_PCT * 100}% fee.
            </p>
          </div>

          <div className="form-row" style={{ marginTop: "1.5rem" }}>
            <button disabled title="Stripe checkout is built in the next step">
              Continue to Payment
            </button>
            <button onClick={() => setStep("details")} style={{ background: "#e5e5e5", color: "#333" }}>
              Back
            </button>
          </div>
          <p style={{ fontSize: "0.8rem", color: "#888" }}>Payment isn&apos;t wired up yet — that&apos;s the next build step.</p>
        </div>
      )}
    </div>
  );
}
