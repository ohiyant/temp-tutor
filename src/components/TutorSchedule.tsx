"use client";

/**
 * A tutor's own week: availability underneath, booked sessions on top.
 * Click a session for the student's details and a Cancel button (the
 * tutor can cancel their own sessions; admins can cancel any).
 *
 * Click and drag on the grid (like booking) to add availability: a plain
 * click adds an hour. Then choose "just this day" (a one-off exception) or
 * "every <weekday>" (a weekly block), the same two kinds the Availability
 * tab manages.
 *
 * The availability is drawn as the blocks it's made of. Drag one to move
 * it, drag its top or bottom edge to change its hours, or click it to
 * remove it. Weekly hours ask whether the change is for every week or only
 * this week (which is saved as one-day changes, leaving other weeks alone).
 *
 * On touchscreens a quick swipe scrolls and a tap clicks; to drag, press and
 * hold for LONG_PRESS_MS first (like Google Calendar), then move.
 *
 * Laid out in the TUTOR's timezone (even for an admin looking from
 * elsewhere), since that's the zone their weekly hours are written in.
 */

import { useEffect, useRef, useState } from "react";
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
  /** In-person: where the student chose to meet. */
  location?: string | null;
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
  /** What the availability is made of, per day (see the schedule API). */
  blocks: EditableBlock[];
  sessions: ScheduleSession[];
}

const HOURS = hourMarks();

// Dragging out availability snaps to this many minutes; a click adds CLICK_ADD_MIN.
const SNAP_MIN = 15;
const CLICK_ADD_MIN = 60;
// Pointer movement below this counts as a click/tap rather than a drag.
const DRAG_THRESHOLD_PX = 4;
// Touch: hold this long (without moving more than TOUCH_SLOP_PX) to start dragging.
const LONG_PRESS_MS = 350;
const TOUCH_SLOP_PX = 8;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** A stretch of one day, in minutes after midnight in the tutor's timezone. */
interface DayRange {
  date: string;
  startMin: number;
  endMin: number;
}

/**
 * One piece of availability on one day: weekly hours, one-day extra hours,
 * or a one-day block-off. "draft" is a new range that's been dragged out but
 * not saved yet; it can be moved and resized the same way before choosing
 * "just this day" or "every week".
 */
interface EditableBlock extends DayRange {
  kind: "weekly" | "extra" | "blocked" | "draft";
  id: string;
}

/** Dragging a block: the whole thing, or its top or bottom edge. */
interface BlockDrag {
  block: EditableBlock;
  mode: "move" | "start" | "end";
  startClientY: number;
  startClientX: number;
  touch: boolean;
  /** Touch only: held long enough, so moving now drags instead of scrolling. */
  armed: boolean;
  moved: boolean;
  /** Where it would land. */
  to: DayRange;
}

/** What the panel under the calendar is asking about. */
type Panel =
  | { type: "new"; range: DayRange }
  | { type: "block"; block: EditableBlock }
  | { type: "edit"; block: EditableBlock; to: DayRange };

interface AvailabilityDrag {
  date: string;
  anchorMin: number;
  currentMin: number;
  startClientY: number;
  startClientX: number;
  touch: boolean;
  /** Touch only: held long enough, so moving now drags instead of scrolling. */
  armed: boolean;
  moved: boolean;
  /** The day column's body, to measure the pointer against as the grid scrolls. */
  body: HTMLElement;
}

function snapMin(y: number, pxPerMin: number): number {
  const min = Math.round(y / pxPerMin / SNAP_MIN) * SNAP_MIN;
  return Math.max(0, Math.min(WINDOW_LENGTH_MIN, min));
}

/** The range a drag (or click) covers. */
function dragRange(d: AvailabilityDrag): DayRange {
  if (!d.moved) {
    return { date: d.date, startMin: d.anchorMin, endMin: Math.min(WINDOW_LENGTH_MIN, d.anchorMin + CLICK_ADD_MIN) };
  }
  const startMin = Math.min(d.anchorMin, d.currentMin);
  const endMin = Math.max(d.anchorMin, d.currentMin);
  return { date: d.date, startMin, endMin: Math.max(endMin, Math.min(WINDOW_LENGTH_MIN, startMin + SNAP_MIN)) };
}

/** 900 -> "15:00", for the availability APIs; midnight at the end of the day is "23:59". */
function toHhmm(min: number): string {
  if (min >= 24 * 60) return "23:59";
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** 900 -> "3:00 PM" */
function prettyMin(min: number): string {
  if (min >= 24 * 60) return "12:00 AM";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function sameBlock(a: EditableBlock, b: EditableBlock): boolean {
  return a.kind === b.kind && a.id === b.id && a.date === b.date;
}

/** The day column under the pointer, while dragging a block sideways. */
function dateUnderPointer(e: PointerEvent): string | null {
  for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
    const date = (el as HTMLElement).closest<HTMLElement>("[data-date]")?.dataset.date;
    if (date) return date;
  }
  return null;
}

/** "Mon, Oct 5" */
function shortDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00.000Z`)
  );
}

/** Day of the week (0 = Sunday) of a "YYYY-MM-DD" date. */
function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

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

  // Adding availability by dragging on the grid.
  const [drag, setDrag] = useState<AvailabilityDrag | null>(null);
  const dragRef = useRef<AvailabilityDrag | null>(null);
  /** The question under the calendar: add a dragged-out range, or change or remove a block. */
  const [panel, setPanel] = useState<Panel | null>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  // Moving or resizing an existing block.
  const [blockDrag, setBlockDrag] = useState<BlockDrag | null>(null);
  const blockDragRef = useRef<BlockDrag | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Touch: after a long press, arm whichever drag is waiting so the next moves drag it. */
  function armAfterLongPress() {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => {
      pressTimer.current = null;
      const create = dragRef.current;
      const move = blockDragRef.current;
      if (create?.touch && !create.armed) {
        dragRef.current = { ...create, armed: true };
        setDrag(dragRef.current);
      } else if (move?.touch && !move.armed) {
        blockDragRef.current = { ...move, armed: true };
        setBlockDrag(blockDragRef.current);
      } else return;
      navigator.vibrate?.(15); // a small buzz on Android when it picks up
    }, LONG_PRESS_MS);
  }

  function cancelLongPress() {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  }

  // Once a touch drag is armed, stop the finger from scrolling the page or calendar.
  // (Needs a non-passive listener; React's touch handlers are passive.)
  useEffect(() => {
    function onTouchMove(e: TouchEvent) {
      if (dragRef.current?.armed || blockDragRef.current?.armed) e.preventDefault();
    }
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      window.removeEventListener("touchmove", onTouchMove);
      cancelLongPress();
    };
  }, []);

  const isDragging = drag !== null;
  useEffect(() => {
    if (!isDragging) return;
    function stop() {
      cancelLongPress();
      dragRef.current = null;
      setDrag(null);
    }
    function onMove(e: PointerEvent) {
      const d = dragRef.current;
      if (!d) return;
      const dy = e.clientY - d.startClientY;
      if (d.touch && !d.armed) {
        // Moving before the long press: the finger is scrolling the calendar.
        if (Math.abs(dy) >= TOUCH_SLOP_PX || Math.abs(e.clientX - d.startClientX) >= TOUCH_SLOP_PX) stop();
        return;
      }
      if (!d.moved && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
      const updated = {
        ...d,
        moved: true,
        currentMin: snapMin(e.clientY - d.body.getBoundingClientRect().top, pxPerMin),
      };
      dragRef.current = updated;
      setDrag(updated);
    }
    function onUp() {
      const d = dragRef.current;
      stop();
      if (d) {
        setSelectedId(null);
        setAddError(null);
        setPanel({ type: "new", range: dragRange(d) });
      }
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", stop);
    };
  }, [isDragging, pxPerMin]);

  function startAvailabilityDrag(e: React.PointerEvent<HTMLDivElement>, date: string) {
    // Sessions are buttons with their own click; only empty space (or availability) starts a drag.
    if ((e.target as HTMLElement).closest("button")) return;
    const touch = e.pointerType !== "mouse";
    if (!touch && e.button !== 0) return;
    if (!touch) e.preventDefault(); // no text selection while dragging
    if (date < today) {
      setPanel(null);
      setAddError("That day has already passed.");
      return;
    }
    const body = e.currentTarget;
    // The start of the 15-minute slot under the pointer.
    const y = e.clientY - body.getBoundingClientRect().top;
    const anchorMin = Math.min(Math.floor(y / pxPerMin / SNAP_MIN) * SNAP_MIN, WINDOW_LENGTH_MIN - SNAP_MIN);
    const d: AvailabilityDrag = {
      date,
      anchorMin,
      currentMin: anchorMin,
      startClientY: e.clientY,
      startClientX: e.clientX,
      touch,
      armed: false,
      moved: false,
      body,
    };
    dragRef.current = d;
    setDrag(d);
    if (touch) armAfterLongPress();
  }

  const isBlockDragging = blockDrag !== null;
  useEffect(() => {
    if (!isBlockDragging) return;
    function stop() {
      cancelLongPress();
      blockDragRef.current = null;
      setBlockDrag(null);
    }
    function onMove(e: PointerEvent) {
      const d = blockDragRef.current;
      if (!d) return;
      const dy = e.clientY - d.startClientY;
      const dx = e.clientX - d.startClientX;
      if (d.touch && !d.armed) {
        // Moving before the long press: the finger is scrolling; a tap still opens the block.
        if (Math.abs(dy) >= TOUCH_SLOP_PX || Math.abs(dx) >= TOUCH_SLOP_PX) stop();
        return;
      }
      if (!d.moved && Math.abs(dy) < DRAG_THRESHOLD_PX && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
      const delta = Math.round(dy / pxPerMin / SNAP_MIN) * SNAP_MIN;
      const b = d.block;
      const length = b.endMin - b.startMin;
      let to: DayRange;
      if (d.mode === "move") {
        const startMin = clamp(b.startMin + delta, 0, WINDOW_LENGTH_MIN - length);
        to = { date: dateUnderPointer(e) ?? d.to.date, startMin, endMin: startMin + length };
      } else if (d.mode === "start") {
        to = { date: b.date, startMin: clamp(b.startMin + delta, 0, b.endMin - SNAP_MIN), endMin: b.endMin };
      } else {
        to = { date: b.date, startMin: b.startMin, endMin: clamp(b.endMin + delta, b.startMin + SNAP_MIN, WINDOW_LENGTH_MIN) };
      }
      const updated = { ...d, moved: true, to };
      blockDragRef.current = updated;
      setBlockDrag(updated);
    }
    function onUp() {
      const d = blockDragRef.current;
      stop();
      if (!d) return;
      setSelectedId(null);
      setAddError(null);
      const b = d.block;
      if (b.kind === "draft") {
        // Not saved yet: a click discards it, a drag just changes the range being asked about.
        if (!d.moved) setPanel(null);
        else if (d.to.date < today) setAddError("That day has already passed.");
        else setPanel({ type: "new", range: d.to });
        return;
      }
      if (!d.moved) {
        setPanel({ type: "block", block: b });
        return;
      }
      if (d.to.date === b.date && d.to.startMin === b.startMin && d.to.endMin === b.endMin) return;
      // Weekly hours: ask whether it's every week or only this one. One-day changes just move.
      if (b.kind === "weekly") setPanel({ type: "edit", block: b, to: d.to });
      else void editBlock(b, d.to, "all");
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", stop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBlockDragging, pxPerMin]);

  function startBlockDrag(e: React.PointerEvent<HTMLElement>, block: EditableBlock) {
    e.stopPropagation(); // not the start of a new range on the empty grid
    const touch = e.pointerType !== "mouse";
    if (!touch && e.button !== 0) return;
    if (!touch) e.preventDefault();
    const edge = (e.target as HTMLElement).dataset.edge;
    const d: BlockDrag = {
      block,
      mode: edge === "start" ? "start" : edge === "end" ? "end" : "move",
      startClientY: e.clientY,
      startClientX: e.clientX,
      touch,
      armed: false,
      moved: false,
      to: { date: block.date, startMin: block.startMin, endMin: block.endMin },
    };
    blockDragRef.current = d;
    setBlockDrag(d);
    if (touch) armAfterLongPress();
  }

  /** Sends one change to the API; returns an error message, or null when it worked. */
  async function send(path: string, method: string, body?: unknown): Promise<string | null> {
    try {
      const res = await fetch(`/api/tutors/${tutorId}/${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.ok) return null;
      const data = await res.json().catch(() => null);
      return data?.error ?? "Couldn't save that. Try again.";
    } catch {
      return "Couldn't reach the server. Try again.";
    }
  }

  /** Runs a change, then closes the panel and reloads (or shows what went wrong). */
  async function runChange(change: () => Promise<string | null>) {
    setAdding(true);
    setAddError(null);
    const err = await change();
    setAdding(false);
    if (err) {
      setAddError(err);
      return;
    }
    setPanel(null);
    setReloadKey((k) => k + 1);
  }

  const hours = (r: DayRange) => ({ startTime: toHhmm(r.startMin), endTime: toHhmm(r.endMin) });

  function addAvailability(range: DayRange, repeat: "once" | "weekly") {
    return runChange(() =>
      repeat === "weekly"
        ? send("availability", "POST", { dayOfWeek: weekdayOf(range.date), ...hours(range) })
        : send("exceptions", "POST", { date: range.date, ...hours(range), isAvailable: true })
    );
  }

  /** "day" on weekly hours blocks off just that date; anything else deletes the block. */
  function removeBlock(b: EditableBlock, scope: "all" | "day") {
    return runChange(() =>
      b.kind === "weekly" && scope === "day"
        ? send("exceptions", "POST", { date: b.date, ...hours(b), isAvailable: false })
        : send(`${b.kind === "weekly" ? "availability" : "exceptions"}?id=${encodeURIComponent(b.id)}`, "DELETE")
    );
  }

  /**
   * Moves or resizes a block. For weekly hours, "day" leaves the weekly
   * block alone: it blocks off the old time on that date and adds the new
   * time as one-day extra hours.
   */
  function editBlock(b: EditableBlock, to: DayRange, scope: "all" | "day") {
    return runChange(async () => {
      if ((scope === "day" || b.kind !== "weekly") && to.date < today) return "That day has already passed.";
      if (b.kind === "weekly" && scope === "day") {
        const err = await send("exceptions", "POST", { date: b.date, ...hours(b), isAvailable: false });
        return err ?? send("exceptions", "POST", { date: to.date, ...hours(to), isAvailable: true });
      }
      if (b.kind === "weekly") {
        return send(`availability?id=${encodeURIComponent(b.id)}`, "PATCH", {
          dayOfWeek: weekdayOf(to.date),
          ...hours(to),
        });
      }
      return send(`exceptions?id=${encodeURIComponent(b.id)}`, "PATCH", { date: to.date, ...hours(to) });
    });
  }

  // What's drawn as the new availability: the drag in progress, or the range awaiting a choice.
  const draft: DayRange | null = drag
    ? drag.moved || !drag.touch || drag.armed
      ? dragRange(drag)
      : null
    : panel?.type === "new"
    ? panel.range
    : null;
  // Where a block being moved or resized would land (while dragging, or while asking "every week?").
  const ghost: DayRange | null = blockDrag?.moved ? blockDrag.to : panel?.type === "edit" ? panel.to : null;
  const ghostOf = blockDrag?.moved ? blockDrag.block : panel?.type === "edit" ? panel.block : null;

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
        {view === "days" && (
          <span className="calendar-hint">
            Drag empty space to add hours · drag hours to move or resize · click hours to remove
            <span className="touch-only"> · on a phone, press and hold first, then drag</span>
          </span>
        )}
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
            return (
              <div key={date} className="calendar-day-col fill-day-col">
                <div className={`calendar-day-header${date === today ? " is-today" : ""}`}>
                  <span className="dow">{dayFmt.format(new Date(`${date}T00:00:00.000Z`))}</span>
                  <span>{dateFmt.format(new Date(`${date}T00:00:00.000Z`))}</span>
                </div>
                <div
                  className="calendar-body adds-availability"
                  data-date={date}
                  style={{ height: gridHeight }}
                  onPointerDown={(e) => startAvailabilityDrag(e, date)}
                  onContextMenu={(e) => e.preventDefault()}
                >
                  {HOURS.map((h) => (
                    <div key={h.index} className="calendar-hour-line" style={{ top: h.index * 60 * pxPerMin }} />
                  ))}
                  {draft?.date === date &&
                    (drag ? (
                      // Being dragged out right now: just a preview.
                      <div
                        className="calendar-block drag-preview availability-draft"
                        style={{
                          top: draft.startMin * pxPerMin,
                          height: (draft.endMin - draft.startMin) * pxPerMin,
                          left: 0,
                          right: 0,
                          background: hexToRgba(color, 0.35),
                          borderLeftColor: color,
                        }}
                      >
                        {prettyMin(draft.startMin)}–{prettyMin(draft.endMin)}
                      </div>
                    ) : (
                      // Waiting for "just this day" / "every week": move, resize or click to discard.
                      <div
                        className={`calendar-block editable-block pending-draft${
                          ghostOf?.kind === "draft" ? " is-moving" : ""
                        }${blockDrag?.armed && !blockDrag.moved && blockDrag.block.kind === "draft" ? " is-lifted" : ""}`}
                        style={{
                          top: draft.startMin * pxPerMin,
                          height: (draft.endMin - draft.startMin) * pxPerMin,
                          left: 0,
                          right: 0,
                          background: hexToRgba(color, 0.35),
                          borderLeftColor: color,
                        }}
                        title="Not saved yet. Drag to move, drag an edge to resize, click to discard."
                        onPointerDown={(e) => startBlockDrag(e, { ...draft, kind: "draft", id: "draft" })}
                      >
                        <span className="block-edge top" data-edge="start" />
                        {prettyMin(draft.startMin)}–{prettyMin(draft.endMin)}
                        <span className="block-edge bottom" data-edge="end" />
                      </div>
                    ))}
                  {ghost?.date === date && (
                    <div
                      className="calendar-block drag-preview availability-draft"
                      style={{
                        top: ghost.startMin * pxPerMin,
                        height: (ghost.endMin - ghost.startMin) * pxPerMin,
                        left: 0,
                        right: 0,
                        ...(ghostOf?.kind === "blocked"
                          ? {}
                          : { background: hexToRgba(color, 0.35), borderLeftColor: color }),
                      }}
                    >
                      {prettyMin(ghost.startMin)}–{prettyMin(ghost.endMin)}
                    </div>
                  )}
                  {(data?.blocks ?? [])
                    .filter((b) => b.date === date)
                    .map((b) => {
                      const isMoving = ghostOf !== null && sameBlock(ghostOf, b);
                      const isOpen = panel?.type === "block" && sameBlock(panel.block, b);
                      const isLifted = !!blockDrag?.armed && !blockDrag.moved && sameBlock(blockDrag.block, b);
                      const label =
                        b.kind === "weekly"
                          ? `Every ${DAY_NAMES[weekdayOf(b.date)]}`
                          : b.kind === "extra"
                          ? "Extra hours (this day)"
                          : "Blocked off (this day)";
                      return (
                        <div
                          key={`${b.kind}-${b.id}`}
                          className={`calendar-block editable-block ${b.kind === "blocked" ? "buffer" : "available"} kind-${
                            b.kind
                          }${isMoving ? " is-moving" : ""}${isOpen ? " is-selected" : ""}${isLifted ? " is-lifted" : ""}`}
                          style={{
                            top: b.startMin * pxPerMin,
                            height: (b.endMin - b.startMin) * pxPerMin,
                            left: 0,
                            right: 0,
                            ...(b.kind === "blocked"
                              ? {}
                              : { background: hexToRgba(color, 0.14), borderLeftColor: color }),
                          }}
                          title={`${label}: ${prettyMin(b.startMin)}–${prettyMin(b.endMin)}. Drag to move, drag an edge to resize, click to remove.`}
                          onPointerDown={(e) => startBlockDrag(e, b)}
                        >
                          <span className="block-edge top" data-edge="start" />
                          {b.kind !== "blocked" && (
                            <>
                              {prettyMin(b.startMin)}–{prettyMin(b.endMin)}
                            </>
                          )}
                          <span className="block-edge bottom" data-edge="end" />
                        </div>
                      );
                    })}
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

      {addError && !panel && <p className="error-text">{addError}</p>}
      {panel && (
        <div className="card session-details add-availability">
          <div className="session-details-head">
            <h2>
              {panel.type === "new"
                ? "Add availability"
                : panel.type === "edit"
                ? "Change weekly hours"
                : panel.block.kind === "weekly"
                ? "Weekly hours"
                : panel.block.kind === "extra"
                ? "Extra hours"
                : "Blocked off"}
            </h2>
            <button type="button" className="secondary" onClick={() => setPanel(null)} disabled={adding}>
              {panel.type === "block" ? "Close" : "Cancel"}
            </button>
          </div>

          {panel.type === "new" && (
            <>
              <p>
                {fmtLongDate(panel.range.date)}, {prettyMin(panel.range.startMin)}–{prettyMin(panel.range.endMin)}{" "}
                <span className="muted small">({zoneLabel(timeZone)})</span>
              </p>
              <div className="form-row" style={{ marginBottom: 0 }}>
                <button type="button" disabled={adding} onClick={() => addAvailability(panel.range, "once")}>
                  Just this day
                </button>
                <button type="button" disabled={adding} onClick={() => addAvailability(panel.range, "weekly")}>
                  Every {DAY_NAMES[weekdayOf(panel.range.date)]}
                </button>
              </div>
            </>
          )}

          {panel.type === "block" && (
            <>
              <p>
                {panel.block.kind === "weekly"
                  ? `Every ${DAY_NAMES[weekdayOf(panel.block.date)]}`
                  : fmtLongDate(panel.block.date)}
                , {prettyMin(panel.block.startMin)}–{prettyMin(panel.block.endMin)}{" "}
                <span className="muted small">({zoneLabel(timeZone)})</span>
              </p>
              <div className="form-row" style={{ marginBottom: 0 }}>
                {panel.block.kind === "weekly" ? (
                  <>
                    <button
                      type="button"
                      className="danger"
                      disabled={adding}
                      onClick={() => removeBlock(panel.block, "day")}
                    >
                      Remove only {shortDate(panel.block.date)}
                    </button>
                    <button
                      type="button"
                      className="danger"
                      disabled={adding}
                      onClick={() => removeBlock(panel.block, "all")}
                    >
                      Remove every {DAY_NAMES[weekdayOf(panel.block.date)]}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="danger"
                    disabled={adding}
                    onClick={() => removeBlock(panel.block, "all")}
                  >
                    {panel.block.kind === "blocked" ? "Remove block-off" : "Remove"}
                  </button>
                )}
              </div>
              <p className="muted small" style={{ marginBottom: 0 }}>
                {panel.block.kind === "blocked"
                  ? "Removing it makes your usual hours available again that day."
                  : "To change the hours instead, drag the block, or drag its top or bottom edge."}
              </p>
            </>
          )}

          {panel.type === "edit" && (
            <>
              <p>
                Every {DAY_NAMES[weekdayOf(panel.block.date)]}, {prettyMin(panel.block.startMin)}–
                {prettyMin(panel.block.endMin)} → {weekdayOf(panel.to.date) !== weekdayOf(panel.block.date) &&
                  `${DAY_NAMES[weekdayOf(panel.to.date)]}, `}
                {prettyMin(panel.to.startMin)}–{prettyMin(panel.to.endMin)}
              </p>
              <div className="form-row" style={{ marginBottom: 0 }}>
                <button type="button" disabled={adding} onClick={() => editBlock(panel.block, panel.to, "all")}>
                  Every week
                </button>
                <button type="button" disabled={adding} onClick={() => editBlock(panel.block, panel.to, "day")}>
                  Only this week
                </button>
              </div>
              <p className="muted small" style={{ marginBottom: 0 }}>
                &ldquo;Only this week&rdquo; changes {shortDate(panel.block.date)}
                {panel.to.date !== panel.block.date ? ` and ${shortDate(panel.to.date)}` : ""} and leaves your
                weekly hours as they are.
              </p>
            </>
          )}

          {addError && <p className="error-text">{addError}</p>}
          {panel.type === "new" && (
            <p className="muted small" style={{ marginBottom: 0 }}>
              Not saved yet: drag the new block to move it, drag its top or bottom edge to resize it, or click it to
              discard it. On a phone, press and hold before dragging.
            </p>
          )}
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
        {s.mode === "in_person" && s.location && (
          <>
            <dt>Where</dt>
            <dd>{s.location}</dd>
          </>
        )}
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
                {s.studentName} will be emailed, with your message if you add one. If they paid online, they get a
                full refund to their card.
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
