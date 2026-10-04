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
 * TIMEZONES: the calendar is shown in the visitor's timezone (their
 * browser's, changeable with the Timezone picker). The API returns real UTC
 * instants; each day column is a date in that zone, and every block is
 * clipped to the column's day and placed by that zone's wall clock (see
 * daySegment in src/lib/calendarUi.ts). Tutors in other zones just show up
 * at the right local times.
 */

import { useEffect, useRef, useState } from "react";
import { CONFIG } from "@/config";
import { sessionPriceCents } from "@/lib/booking";
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
  hourMarks as buildHourMarks,
  initialScrollTop,
  localDate,
  minutesFromWindowStart,
  todayIn,
  hexToRgba,
  startOfWeek,
} from "@/lib/calendarUi";
import { useFitCalendar } from "@/components/useFitCalendar";
import CalendarViewSwitch, { type CalendarView } from "@/components/CalendarViewSwitch";
import TurnstileWidget, { turnstileOn } from "@/components/TurnstileWidget";
import MonthGrid, { type MonthItem } from "@/components/MonthGrid";
import { localTimeZone } from "@/lib/timezone";
import TimeZoneSelect from "@/components/TimeZoneSelect";
import CalendarNav from "@/components/CalendarNav";
import BookingConfirmation from "@/components/BookingConfirmation";
import type { BookingResult } from "@/lib/bookingResult";

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

interface CalendarTutor {
  tutorId: string;
  tutorName: string;
  timeZone: string;
  color: string;
  hourlyRateCents: number;
  onlineAvailable: boolean;
  inPersonAvailable: boolean;
  inPersonLocation: string | null;
  earliestAllowedStart: string;
  latestAllowedStart: string;
  // Real UTC instants, not split by day: the grid clips them to its own columns.
  free: RangeIso[];
  busy: BusyRangeIso[];
  buffer: RangeIso[];
  // The tutor's hours that can't be booked: inside their minimum notice, or
  // further ahead than they take bookings. Shaded so they don't look empty.
  unbookable: (RangeIso & { reason: "too_soon" | "too_far" })[];
  minBookingNoticeHours: number;
  maxBookingWindowDays: number;
}

interface CalendarResponse {
  start: string;
  days: string[];
  timeZone: string;
  bufferMin: number;
  tutors: CalendarTutor[];
}

type SessionMode = "online" | "in_person";
type FilterMode = SessionMode | "both";
type Step = "calendar" | "details" | "review" | "done";

interface Selected {
  id: string;
  tutorId: string;
  tutorName: string;
  color: string;
  hourlyRateCents: number;
  onlineAvailable: boolean;
  inPersonAvailable: boolean;
  inPersonLocation: string | null;
  startAt: string; // ISO
  blockEndAt: string; // ISO — the free block's own end, bounds max duration
  durationMin: number;
  sessionMode: SessionMode;
  /** In-person: where to meet. Starts as the tutor's usual spot; the student can change it. */
  location: string;
}

// ---------- Layout constants for the grid ----------

// The height scaling is shared with the other calendars (useFitCalendar).
// Columns stretch to fill the width, down to this minimum; this calendar
// measures them (rather than using flex) because drag previews need pixels.
const MIN_COLUMN_WIDTH_PX = 96;
const TIME_AXIS_WIDTH_PX = 52; // keep in sync with .calendar-time-axis
// Pointer movement below this counts as a click/tap rather than a drag.
const DRAG_THRESHOLD_PX = 4;

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

function selectionEndIso(s: Selected): string {
  return new Date(new Date(s.startAt).getTime() + s.durationMin * 60000).toISOString();
}

/** The start time a click `offsetY` px into a drawn free block would pick:
 *  snapped to START_TIME_INCREMENT_MIN and pulled back so a minimum-length
 *  session still fits inside the block and the tutor's booking window.
 *  `drawnStart` is where the drawn part of the block begins (it may be
 *  clipped to the column's day); `blockEnd` is the free range's real end. */
function snapStartAt(tutor: CalendarTutor, drawnStart: string, blockEnd: Date, offsetY: number, pxPerMin: number): Date {
  const blockStart = new Date(drawnStart);
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
  // Touch: a tap adds a default-length session and any movement is a scroll,
  // so there's no drag-to-size (the length can be changed on the next step).
  touch: boolean;
  startClientX: number;
  columnLeft: number;
  columnWidth: number;
}

/** Top/height of the session being dragged out, within its day column. */
function dragPreviewPosition(drag: DragState, date: string, timeZone: string, pxPerMin: number) {
  const end = new Date(drag.startAt.getTime() + drag.durationMin * 60000).toISOString();
  const seg = daySegment({ start: drag.startAt.toISOString(), end }, date, timeZone, pxPerMin);
  return seg ? { top: seg.top, height: seg.height } : { display: "none" };
}

/** Remembers the open Stripe checkout, so coming back without paying can cancel it. */
const PENDING_CHECKOUT_KEY = "pendingCheckout";

interface HoverState {
  date: string;
  startAt: string; // ISO
}

export default function BookingCalendar({
  paymentsEnabled,
}: {
  /** Stripe is on: "Confirm booking" goes to Stripe's payment page. */
  paymentsEnabled: boolean;
}) {
  const [step, setStep] = useState<Step>("calendar");
  const [error, setError] = useState<string | null>(null);
  /** A one-off message above the calendar, e.g. after backing out of payment. */
  const [notice, setNotice] = useState<string | null>(null);

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectId, setSubjectId] = useState<string>("");
  const [filterMode, setFilterMode] = useState<FilterMode>("both");
  const [filterTutorId, setFilterTutorId] = useState<string>(""); // "" = any tutor

  // The visitor's timezone. Only known in the browser, so it's null during
  // server rendering and the first paint, then set from the browser.
  const [timeZoneChoice, setTimeZoneChoice] = useState<string | null>(null);
  const timeZone = timeZoneChoice ?? "UTC";
  const [calendarStart, setCalendarStart] = useState<string>(() => todayIn("UTC"));
  const [calendarDays, setCalendarDays] = useState<number>(CONFIG.DEFAULT_CALENDAR_DAYS);
  // Days view shows `calendarDays` days; weeks view shows whole weeks from a Sunday.
  const [view, setView] = useState<CalendarView>("days");
  const [weeks, setWeeks] = useState<number>(CONFIG.DEFAULT_CALENDAR_WEEKS);
  const rangeDays = view === "weeks" ? weeks * 7 : calendarDays;

  const [calendarData, setCalendarData] = useState<CalendarResponse | null>(null);
  const [loadingCalendar, setLoadingCalendar] = useState(false);
  // Bumped to force a calendar refetch (e.g. after a booking conflict).
  const [reloadKey, setReloadKey] = useState(0);

  // Size of the calendar's scroll box, so the grid can be scaled to fill it.
  const { scrollRef, scrollEl, size: scrollSize, pxPerMin } = useFitCalendar();

  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  const [selections, setSelections] = useState<Selected[]>([]);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [description, setDescription] = useState("");
  // Honeypot: hidden from people, so only bots fill it in.
  const [website, setWebsite] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  // Each Turnstile pass works once; bumping this re-mounts the widget for a fresh one.
  const [turnstileKey, setTurnstileKey] = useState(0);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [bookingResult, setBookingResult] = useState<BookingResult | null>(null);
  const [bookingError, setBookingError] = useState<string | null>(null);

  // Touchscreens get a tap-oriented hint (no drag-to-size there).
  const [coarsePointer, setCoarsePointer] = useState(false);

  useEffect(() => {
    const zone = localTimeZone();
    setTimeZoneChoice(zone);
    setCalendarStart(todayIn(zone));
    // Links from the welcome page ("Book with Alex") preselect a subject and tutor.
    const query = new URLSearchParams(window.location.search);
    const subjectParam = query.get("subject");
    const tutorParam = query.get("tutor");
    if (subjectParam) setSubjectId(subjectParam);
    if (tutorParam) setFilterTutorId(tutorParam);
    setCoarsePointer(window.matchMedia("(pointer: coarse)").matches);
    // Phones: 3 days fit on screen; 7 would need sideways scrolling.
    if (window.innerWidth < 640) setCalendarDays(3);

    // Back from Stripe without paying, by its "back" link: free the times held for them.
    const bookingRef = query.get("checkout") === "cancelled" ? query.get("ref") : null;
    if (bookingRef) {
      window.history.replaceState(null, "", window.location.pathname);
      releasePendingCheckout(bookingRef);
    }

    // ...or by the browser's Back button, which can restore this page as it
    // was (button still saying "Opening payment…").
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      setSubmitting(false);
      releasePendingCheckout(null);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Cancels the checkout this page opened (if any) and frees its held times. */
  function releasePendingCheckout(bookingRef: string | null) {
    let checkoutId: string | undefined;
    try {
      const saved = JSON.parse(sessionStorage.getItem(PENDING_CHECKOUT_KEY) ?? "null");
      if (saved && (!bookingRef || saved.bookingRef === bookingRef)) {
        bookingRef = saved.bookingRef;
        checkoutId = saved.checkoutId;
      }
      sessionStorage.removeItem(PENDING_CHECKOUT_KEY);
    } catch {
      // Storage unavailable; releasing by bookingRef alone still works.
    }
    if (!bookingRef) return;
    setNotice("Payment cancelled, so nothing was booked or charged. Pick your times again whenever you're ready.");
    setStep("calendar");
    fetch("/api/bookings/release", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingRef, checkoutId }),
    })
      .catch(() => {})
      .finally(() => setReloadKey((k) => k + 1));
  }

  useEffect(() => {
    fetch("/api/subjects")
      .then((r) => r.json())
      .then(setSubjects)
      .catch(() => setError("Failed to load subjects. Refresh and try again."));
  }, []);

  useEffect(() => {
    setError(null);
    if (!subjectId || !timeZoneChoice) {
      setCalendarData(null);
      setLoadingCalendar(false);
      return;
    }
    // Ignore responses from superseded requests (e.g. clicking › quickly),
    // so an older range can't land on top of a newer one.
    let cancelled = false;
    setLoadingCalendar(true);
    const params = new URLSearchParams({
      subjectId,
      mode: filterMode,
      start: calendarStart,
      days: String(rangeDays),
      tz: timeZoneChoice,
    });
    fetch(`/api/calendar?${params.toString()}`)
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok) throw new Error(body?.error ?? "Failed to load the calendar");
        return body as CalendarResponse;
      })
      .then((data) => {
        if (!cancelled) setCalendarData(data);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load the calendar. Try again.");
      })
      .finally(() => {
        if (!cancelled) setLoadingCalendar(false);
      });
    return () => {
      cancelled = true;
    };
  }, [subjectId, filterMode, calendarStart, rangeDays, reloadKey, timeZoneChoice]);

  const subjectName = subjects.find((s) => s.id === subjectId)?.name ?? "";

  const allTutorsForFilter = calendarData?.tutors ?? [];
  // With just one tutor for this subject, "Any tutor" means the same thing, so
  // the picker shows only them.
  const onlyTutor = allTutorsForFilter.length === 1 ? allTutorsForFilter[0] : null;
  const visibleTutors = onlyTutor
    ? [onlyTutor]
    : filterTutorId
    ? allTutorsForFilter.filter((t) => t.tutorId === filterTutorId)
    : allTutorsForFilter;

  // The hour grid covers the whole day and scrolls: when new availability
  // loads (or the grid appears), open it just above the earliest free time,
  // or at 7am if there's none.
  const loadedKey = calendarData ? `${calendarData.start}|${calendarData.timeZone}|${calendarData.days.length}` : null;
  useEffect(() => {
    if (!scrollEl) return;
    const starts = (calendarData?.tutors ?? []).flatMap((t) =>
      t.free.map((f) => minutesFromWindowStart(f.start, timeZone))
    );
    scrollEl.scrollTop = initialScrollTop(starts.length ? Math.min(...starts) : null, pxPerMin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedKey, scrollEl, pxPerMin, scrollSize.height]);

  // The grid is drawn from the requested range, not the response, so it's
  // there even with no subject picked (or while a new range is loading).
  const displayDays = Array.from({ length: calendarDays }, (_, i) => addDays(calendarStart, i));
  const dayCount = displayDays.length;
  const columnWidthPx = scrollSize.width
    ? Math.max(MIN_COLUMN_WIDTH_PX, Math.floor((scrollSize.width - TIME_AXIS_WIDTH_PX) / dayCount))
    : 168;
  const gridHeight = WINDOW_LENGTH_MIN * pxPerMin;
  // Blocks sit inside the column's 1px right border.
  const blockAreaWidth = columnWidthPx - 1;

  // ---------- Drag lifecycle: attach window listeners only while dragging ----------
  const isDragging = drag !== null;
  useEffect(() => {
    if (!isDragging) return;

    function cancelDrag() {
      dragRef.current = null;
      setDrag(null);
    }

    function onMove(e: PointerEvent) {
      const d = dragRef.current;
      if (!d) return;
      const deltaY = e.clientY - d.startClientY;
      if (d.touch) {
        // The finger is moving: it's a scroll, not a tap.
        if (Math.abs(deltaY) >= DRAG_THRESHOLD_PX || Math.abs(e.clientX - d.startClientX) >= DRAG_THRESHOLD_PX) {
          cancelDrag();
        }
        return;
      }
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
      cancelDrag();
      if (d) addSelection(d);
    }

    // pointercancel: the browser took over the gesture (e.g. started scrolling).
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", cancelDrag);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", cancelDrag);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging]);

  function handleFreeBlockPointerDown(
    e: React.PointerEvent,
    tutor: CalendarTutor,
    date: string,
    free: RangeIso,
    drawnStart: string,
    columnLeft: number,
    columnWidth: number
  ) {
    const touch = e.pointerType !== "mouse";
    if (!touch && e.button !== 0) return;
    // Mouse: stop text selection while dragging. Touch: leave it alone so the calendar can still scroll.
    if (!touch) e.preventDefault();
    setError(null);
    const rect = e.currentTarget.getBoundingClientRect();
    const startAt = snapStartAt(tutor, drawnStart, new Date(free.end), e.clientY - rect.top, pxPerMin);
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
      startClientX: e.clientX,
      touch,
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

  function handleFreeBlockPointerMove(
    e: React.PointerEvent,
    tutor: CalendarTutor,
    date: string,
    free: RangeIso,
    drawnStart: string
  ) {
    if (e.pointerType !== "mouse") return; // the hover line is a mouse-only hint
    const rect = e.currentTarget.getBoundingClientRect();
    const startAt = snapStartAt(tutor, drawnStart, new Date(free.end), e.clientY - rect.top, pxPerMin).toISOString();
    if (hover?.date !== date || hover.startAt !== startAt) setHover({ date, startAt });
  }

  function addSelection(d: DragState) {
    if (selections.length >= CONFIG.MAX_SESSIONS_PER_BOOKING) {
      setError(`You can book up to ${CONFIG.MAX_SESSIONS_PER_BOOKING} sessions at a time.`);
      return;
    }
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
        inPersonLocation: d.tutor.inPersonLocation,
        startAt,
        blockEndAt: d.blockEnd.toISOString(),
        durationMin: d.durationMin,
        sessionMode: defaultMode,
        location: d.tutor.inPersonLocation ?? "",
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
    if (selections.some((s) => s.sessionMode === "in_person" && !s.location.trim())) {
      return setDetailsError("Enter where you'd like to meet for each in-person session.");
    }
    setBookingError(null);
    setStep("review");
  }

  async function confirmBooking() {
    setSubmitting(true);
    setBookingError(null);
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectId,
          studentName: name,
          studentEmail: email,
          studentPhone: phone || null,
          description,
          timeZone,
          acceptedPolicies: agreed,
          website,
          turnstileToken: turnstileToken ?? undefined,
          sessions: selections.map((s) => ({
            tutorId: s.tutorId,
            startAt: s.startAt,
            durationMin: s.durationMin,
            mode: s.sessionMode,
            ...(s.sessionMode === "in_person" ? { location: s.location.trim() } : {}),
          })),
        }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.checkoutUrl) {
        // Off to Stripe. Keep the button disabled while the page changes.
        try {
          sessionStorage.setItem(
            PENDING_CHECKOUT_KEY,
            JSON.stringify({ bookingRef: body.bookingRef, checkoutId: body.checkoutId })
          );
        } catch {
          // Not essential (see the release on return).
        }
        window.location.assign(body.checkoutUrl);
        return;
      }
      if (!res.ok) {
        // The bot-check pass was used up by this attempt; get a fresh one for a retry.
        setTurnstileToken(null);
        setTurnstileKey((k) => k + 1);
        setBookingError(body?.error ?? "Something went wrong saving your booking. Please try again.");
        // Availability changed under us — make sure the calendar is fresh when they go back.
        if (res.status === 409) setReloadKey((k) => k + 1);
        return;
      }
      setBookingResult(body as BookingResult);
      setSelections([]);
      setReloadKey((k) => k + 1);
      setStep("done");
      setSubmitting(false);
    } catch {
      setBookingError("Couldn't reach the server. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  const sortedSelections = [...selections].sort((a, b) => a.startAt.localeCompare(b.startAt));
  const totalCents = selections.reduce((sum, s) => sum + sessionPriceCents(s.hourlyRateCents, s.durationMin), 0);
  const hourMarks = buildHourMarks();
  const today = todayIn(timeZone);

  function changeView(next: CalendarView) {
    setView(next);
    if (next === "weeks") setCalendarStart(startOfWeek(calendarStart));
  }

  function openDay(date: string) {
    setView("days");
    setCalendarStart(date);
  }

  // Weeks view: each tutor's open times as tinted chips (click a day to book
  // in the days view), and the student's picks as solid ones.
  const monthItems: MonthItem[] = [
    ...visibleTutors.flatMap((t) =>
      t.free.map((f, i) => ({
        id: `${t.tutorId}-${i}`,
        start: f.start,
        end: f.end,
        label: `${t.tutorName.split(" ")[0]} ${fmtShortTime(f.start, timeZone)}–${fmtShortTime(f.end, timeZone)}`,
        title: `${t.tutorName} free ${fmtTime(f.start, timeZone)}–${fmtTime(f.end, timeZone)} — click to book`,
        color: t.color,
        variant: "tint" as const,
      }))
    ),
    ...selections.map((sel) => ({
      id: sel.id,
      start: sel.startAt,
      end: selectionEndIso(sel),
      label: `${fmtShortTime(sel.startAt, timeZone)} ${sel.tutorName.split(" ")[0]} (selected)`,
      color: sel.color,
      variant: "solid" as const,
    })),
  ];

  return (
    <div className={`container-wide ${step === "calendar" ? "calendar-mode" : ""}`}>
      <h1>Book Sessions</h1>
      {error && <p className="error-text">{error}</p>}
      {notice && step === "calendar" && <p className="booking-notice">{notice}</p>}

      {step === "calendar" && (
        <>
          <div className="filters-bar">
            <div className="form-field">
              <label>Subject</label>
              <select
                value={subjectId}
                className={subjectId ? undefined : "needs-choice"}
                onChange={(e) => {
                  setSubjectId(e.target.value);
                  setFilterTutorId("");
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
              <select
                value={onlyTutor ? onlyTutor.tutorId : filterTutorId}
                onChange={(e) => setFilterTutorId(e.target.value)}
              >
                {!onlyTutor && <option value="">Any tutor</option>}
                {allTutorsForFilter.map((t) => (
                  <option key={t.tutorId} value={t.tutorId}>
                    {t.tutorName}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field" hidden={view === "weeks"}>
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
            <div className="form-field">
              <label htmlFor="booking-tz">Timezone</label>
              <TimeZoneSelect
                id="booking-tz"
                value={timeZone}
                disabled={!timeZoneChoice}
                onChange={setTimeZoneChoice}
              />
            </div>
          </div>

          <div className="calendar-nav">
            <CalendarNav
              start={calendarStart}
              days={rangeDays}
              today={view === "weeks" ? startOfWeek(today) : today}
              stepDays={view === "weeks" ? 7 : 1}
              onChange={setCalendarStart}
            />
            <span className="range-label">
              {fmtLongDate(calendarStart)} – {fmtLongDate(addDays(calendarStart, rangeDays - 1))}
            </span>
            <CalendarViewSwitch view={view} onViewChange={changeView} weeks={weeks} onWeeksChange={setWeeks} />
            {!subjectId ? (
              <span className="calendar-status prompt">Pick a subject to see tutors&apos; availability</span>
            ) : loadingCalendar ? (
              <span className="calendar-status loading">Loading availability…</span>
            ) : calendarData && allTutorsForFilter.length === 0 ? (
              <span className="calendar-status empty">No tutors match this subject and mode yet</span>
            ) : null}
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
              <span>
                <span className="legend-swatch legend-unbookable" /> Too soon to book
              </span>
            </div>
          </div>

          {view === "weeks" ? (
            <MonthGrid
              start={calendarStart}
              weeks={weeks}
              timeZone={timeZone}
              today={today}
              items={monthItems}
              onDayClick={openDay}
              loading={loadingCalendar}
            />
          ) : (
          <div className={`calendar-scroll${loadingCalendar ? " is-loading" : ""}`} ref={scrollRef}>
            <div className="calendar-grid">
              <div className="calendar-time-axis">
                <div className="calendar-time-axis-header" />
                <div style={{ position: "relative", height: gridHeight }}>
                  {hourMarks.map((h) => (
                    <span key={h.index} className="calendar-time-label" style={{ top: h.index * 60 * pxPerMin }}>
                      {h.label}
                    </span>
                  ))}
                </div>
              </div>

              {displayDays.map((date) => (
                <div key={date} className="calendar-day-col" style={{ width: columnWidthPx }}>
                  <div className={`calendar-day-header${date === today ? " is-today" : ""}`}>
                    <span className="dow">{dayFmt.format(new Date(`${date}T00:00:00.000Z`))}</span>
                    <span>{dateFmt.format(new Date(`${date}T00:00:00.000Z`))}</span>
                  </div>
                  <div className="calendar-body" style={{ height: gridHeight }}>
                    {hourMarks.map((h) => (
                      <div key={h.index} className="calendar-hour-line" style={{ top: h.index * 60 * pxPerMin }} />
                    ))}

                    {visibleTutors.map((tutor, tIdx) => {
                      const { left, width } = overlayOffset(tIdx, blockAreaWidth);
                      const seg = (r: RangeIso) => daySegment(r, date, timeZone, pxPerMin);
                      return (
                        <div key={tutor.tutorId}>
                          {tutor.unbookable.map((u, i) => {
                            const sg = seg(u);
                            if (!sg) return null;
                            const why =
                              u.reason === "too_soon"
                                ? `Needs ${tutor.minBookingNoticeHours}h notice`
                                : "Not bookable yet";
                            return (
                              <div
                                key={`unbookable-${i}`}
                                className="calendar-block unbookable"
                                style={{
                                  top: sg.top,
                                  height: sg.height,
                                  left,
                                  width,
                                  zIndex: tIdx,
                                  borderLeftColor: tutor.color,
                                }}
                                title={
                                  u.reason === "too_soon"
                                    ? `${tutor.tutorName} needs ${tutor.minBookingNoticeHours} hours' notice, so this time is too soon to book.`
                                    : `${tutor.tutorName} takes bookings up to ${tutor.maxBookingWindowDays} days ahead, so this time can't be booked yet.`
                                }
                              >
                                {sg.height >= 28 ? why : ""}
                              </div>
                            );
                          })}
                          {tutor.busy.map((b, i) => {
                            const sg = seg(b);
                            if (!sg) return null;
                            const { top, height } = sg;
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
                          {tutor.buffer.map((b, i) => {
                            const sg = seg(b);
                            if (!sg) return null;
                            const { top, height } = sg;
                            return (
                              <div
                                key={`buf-${i}`}
                                className="calendar-block buffer"
                                style={{ top, height, left, width, zIndex: tIdx }}
                                title="Travel buffer"
                              />
                            );
                          })}
                          {tutor.free.map((f, i) => {
                            const sg = seg(f);
                            if (!sg) return null;
                            const { top, height } = sg;
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
                                onPointerDown={(e) => handleFreeBlockPointerDown(e, tutor, date, f, sg.start, left, width)}
                                onPointerMove={(e) => handleFreeBlockPointerMove(e, tutor, date, f, sg.start)}
                                onPointerLeave={() => setHover(null)}
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

                    {selections.map((s) => {
                      const endIso = selectionEndIso(s);
                      const sg = daySegment({ start: s.startAt, end: endIso }, date, timeZone, pxPerMin);
                      if (!sg) return null;
                      const tIdx = visibleTutors.findIndex((t) => t.tutorId === s.tutorId);
                      const { left, width } =
                        tIdx >= 0 ? overlayOffset(tIdx, blockAreaWidth) : { left: 0, width: blockAreaWidth };
                      return (
                          <div
                            key={s.id}
                            className="calendar-block selected"
                            style={{ top: sg.top, height: sg.height, left, width, background: s.color }}
                            title={`${s.tutorName} · ${fmtTime(s.startAt, timeZone)}–${fmtTime(endIso, timeZone)}`}
                          >
                            <button
                              type="button"
                              className="selected-remove"
                              aria-label="Remove this session"
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={() => removeSelection(s.id)}
                            >
                              ×
                            </button>
                            {fmtTime(s.startAt, timeZone)}–{fmtTime(endIso, timeZone)}
                            <br />
                            {s.tutorName} · {s.durationMin} min
                          </div>
                        );
                    })}

                    {hover && hover.date === date && !drag?.moved && (
                      <div
                        className="calendar-hover-line"
                        style={{ top: minutesFromWindowStart(hover.startAt, timeZone) * pxPerMin }}
                      >
                        <span>{fmtTime(hover.startAt, timeZone)}</span>
                      </div>
                    )}

                    {drag && drag.moved && drag.date === date && (
                      <div
                        className="calendar-block drag-preview"
                        style={{
                          ...dragPreviewPosition(drag, date, timeZone, pxPerMin),
                          left: drag.columnLeft,
                          width: drag.columnWidth,
                          background: hexToRgba(drag.tutor.color, 0.85),
                        }}
                      >
                        {fmtTime(drag.startAt.toISOString(), timeZone)} · {drag.durationMin} min
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
          )}

          <div className="selection-bar">
            <span className="summary">
              {selections.length === 0
                ? view === "weeks"
                  ? `${coarsePointer ? "Tap" : "Click"} a day to see its open times and book.`
                  : coarsePointer
                  ? `Tap a free block to add a ${CONFIG.DEFAULT_SESSION_LENGTH_MIN}-minute session. You can change the length on the next step.`
                  : `Click a free block to add a ${CONFIG.DEFAULT_SESSION_LENGTH_MIN}-minute session, or drag down to choose the length. You can add several.`
                : `${selections.length} session${selections.length === 1 ? "" : "s"} selected`}
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

      {step === "details" && selections.length > 0 && (
        <div className="card">
          <h2>Your details</h2>

          {sortedSelections.map((s) => {
            const others = selections.filter((o) => o.id !== s.id);
            const maxDuration = maxDurationAt(new Date(s.startAt).getTime(), new Date(s.blockEndAt).getTime(), others);
            return (
              <div key={s.id} className="session-item">
                <p className="session-summary">
                  {s.tutorName} · {subjectName} · {fmtLongDate(localDate(s.startAt, timeZone))} ·{" "}
                  {fmtTime(s.startAt, timeZone)}–{fmtTime(selectionEndIso(s), timeZone)}
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
                    {s.sessionMode === "online" ? (
                      <span className="muted small session-mode-note">
                        The meeting link comes in your confirmation email.
                      </span>
                    ) : (
                      <>
                        <label htmlFor={`location-${s.id}`} className="location-label">
                          Where to meet
                        </label>
                        <input
                          id={`location-${s.id}`}
                          type="text"
                          maxLength={200}
                          placeholder="e.g. Rivera Library, 2nd floor"
                          value={s.location}
                          onChange={(e) => updateSelection(s.id, { location: e.target.value })}
                        />
                        {s.inPersonLocation && (
                          <span className="muted small session-mode-note">
                            {s.location.trim() === s.inPersonLocation
                              ? `${s.tutorName}'s usual spot. Change it if you'd like to meet somewhere else.`
                              : `${s.tutorName} usually meets at ${s.inPersonLocation}.`}
                          </span>
                        )}
                      </>
                    )}
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
            <label htmlFor="booking-email">Email</label>
            <input id="booking-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <span className="email-note">
              <strong>Use an email you check.</strong> It&apos;s how we identify your bookings: your confirmation,
              meeting details and reschedule/cancel links go there, and you&apos;ll use it to find your bookings
              later under <em>My bookings</em>.
            </span>
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
            <span className="muted small materials-note">
              Have homework or notes to share? Paste a link here (Google Drive, Docs), or reply to your
              confirmation email with them. Replies go straight to your tutor.
            </span>
          </div>
          {/* Honeypot: off-screen and skipped by keyboard and screen readers; bots fill every field. */}
          <div className="honeypot" aria-hidden="true">
            <label htmlFor="booking-website">Website</label>
            <input
              id="booking-website"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
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
                {s.tutorName} · {fmtLongDate(localDate(s.startAt, timeZone))} · {fmtTime(s.startAt, timeZone)}–
                {fmtTime(selectionEndIso(s), timeZone)} ·{" "}
                {s.durationMin} min · {s.sessionMode === "online" ? "Online" : `In person at ${s.location.trim()}`}
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
              <strong>Cancellation policy:</strong> cancel any time before your session for a{" "}
              {Math.round(CONFIG.CANCEL_REFUND_PCT * 100)}% refund.
            </p>
            <p>
              <strong>Rescheduling policy:</strong> free, up to {CONFIG.RESCHEDULE_MIN_NOTICE_HOURS} hours before your
              session.
            </p>
          </div>

          <p className="review-email">
            Your confirmation, meeting details and reschedule/cancel links will go to <strong>{email}</strong>. Your
            bookings are tied to this address, so make sure it&apos;s right.
          </p>

          <label className="checkbox-row policy-agree">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            <span>
              I agree to the{" "}
              <a href="/policies" target="_blank" rel="noopener">
                cancellation and rescheduling policies
              </a>
              .
            </span>
          </label>
          <TurnstileWidget key={turnstileKey} onToken={setTurnstileToken} />

          {bookingError && <p className="error-text">{bookingError}</p>}
          <div className="form-row" style={{ marginTop: "1.5rem" }}>
            <button
              onClick={confirmBooking}
              disabled={submitting || !agreed || (turnstileOn && !turnstileToken)}
              title={!agreed ? "Agree to the policies first" : undefined}
            >
              {paymentsEnabled
                ? submitting
                  ? "Opening payment…"
                  : "Continue to payment"
                : submitting
                ? "Booking…"
                : "Confirm booking"}
            </button>
            <button
              onClick={() => setStep("details")}
              disabled={submitting}
              style={{ background: "#e5e5e5", color: "#333" }}
            >
              Back
            </button>
            {bookingError && (
              <button
                onClick={() => setStep("calendar")}
                disabled={submitting}
                style={{ background: "#e5e5e5", color: "#333" }}
              >
                Back to calendar
              </button>
            )}
          </div>
          <p className="muted small">
            {paymentsEnabled
              ? `You'll pay by card on Stripe's secure page. Your times are held for ${CONFIG.CHECKOUT_HOLD_MINUTES} minutes while you pay, and you're booked once payment goes through.`
              : "Payments are off, so confirming books the sessions without charging."}
          </p>
        </div>
      )}

      {step === "done" && bookingResult && (
        <BookingConfirmation
          result={bookingResult}
          timeZone={timeZone}
          email={email}
          actions={
            <button
              onClick={() => {
                setBookingResult(null);
                setStep("calendar");
              }}
            >
              Book more sessions
            </button>
          }
        />
      )}
    </div>
  );
}
