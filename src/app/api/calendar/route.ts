import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getFreeRanges, computeBufferPadding, type BusyRange } from "@/lib/availability";
import { addDays, isValidTimeZone, startOfDay } from "@/lib/timezone";
import { CONFIG } from "@/config";
import { colorForTutor } from "@/lib/tutorColor";
import { z } from "zod";

const querySchema = z.object({
  subjectId: z.string().min(1),
  mode: z.enum(["online", "in_person", "both"]),
  tutorId: z.string().min(1).optional(),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "start must be YYYY-MM-DD"),
  // Up to the weeks view's range (the days view asks for far fewer).
  days: z.coerce.number().int().min(1).max(CONFIG.MAX_CALENDAR_WEEKS * 7).default(CONFIG.DEFAULT_CALENDAR_DAYS),
  /** The viewer's timezone: `start` and the day columns are dates in this zone. */
  tz: z.string().refine(isValidTimeZone, "Unknown timezone").default("UTC"),
  bufferMin: z.coerce.number().int().min(0).default(CONFIG.IN_PERSON_TRANSPORT_BUFFER_MIN),
});

const DAY_MS = 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid query" }, { status: 400 });
  }

  try {
    return await buildCalendarResponse(parsed.data);
  } catch (err) {
    // In development, surface the real cause (a common culprit: DATABASE_URL
    // not set / migrations not run). In production, keep internals out of
    // the response; the details are in the server log.
    console.error("GET /api/calendar failed:", err);
    const message =
      process.env.NODE_ENV === "production"
        ? "Couldn't load the calendar. Please try again."
        : err instanceof Error
        ? err.message
        : "Unexpected server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Every range in the response is a pair of real UTC instants (ISO strings),
 * not grouped by day: tutors and viewer can be in different timezones, so
 * the client splits them into the viewer's day columns itself.
 */
async function buildCalendarResponse(parsed: z.infer<typeof querySchema>) {
  const { subjectId, mode, tutorId, start, days, tz, bufferMin } = parsed;

  const modeFilter =
    mode === "online" ? { onlineAvailable: true } : mode === "in_person" ? { inPersonAvailable: true } : {};

  const tutors = await prisma.tutor.findMany({
    where: {
      ...modeFilter,
      subjects: { some: { subjectId } },
      ...(tutorId ? { id: tutorId } : {}),
    },
    include: { availabilityBlocks: true, availabilityExceptions: true },
    orderBy: { name: "asc" },
  });

  // The viewer's days, from their midnight on `start` to their midnight `days` later.
  const rangeStart = startOfDay(start, tz);
  const rangeEnd = startOfDay(addDays(start, days), tz);
  const now = new Date();
  const dayLabels = Array.from({ length: days }, (_, i) => addDays(start, i));

  if (tutors.length === 0) {
    return NextResponse.json({ start, days: dayLabels, timeZone: tz, bufferMin, tutors: [] });
  }

  // Look a day further out either side so a travel buffer around a session
  // just outside the range still shows up.
  const queryStart = new Date(rangeStart.getTime() - DAY_MS);
  const queryEnd = new Date(rangeEnd.getTime() + DAY_MS);
  const tutorIds = tutors.map((t) => t.id);
  const [confirmedSessions, activeHolds] = await Promise.all([
    prisma.session.findMany({
      where: {
        tutorId: { in: tutorIds },
        status: "confirmed",
        startAt: { lt: queryEnd },
        endAt: { gt: queryStart },
      },
      select: { tutorId: true, startAt: true, endAt: true, mode: true },
    }),
    prisma.bookingHold.findMany({
      where: {
        tutorId: { in: tutorIds },
        expiresAt: { gt: now },
        startAt: { lt: queryEnd },
        endAt: { gt: queryStart },
      },
      select: { tutorId: true, startAt: true, endAt: true },
    }),
  ]);

  const toIso = (r: { start: Date; end: Date }) => ({ start: r.start.toISOString(), end: r.end.toISOString() });
  const inRange = (r: { start: Date; end: Date }) => r.start < rangeEnd && r.end > rangeStart;

  const result = tutors.map((tutor) => {
    const sessionsForTutor = confirmedSessions.filter((s) => s.tutorId === tutor.id);
    const holdsForTutor = activeHolds.filter((h) => h.tutorId === tutor.id);

    // Only confirmed sessions carry a mode, so only they get transport
    // buffer padding — a pending hold doesn't justify blocking travel time.
    const busyRanges: BusyRange[] = [
      ...sessionsForTutor.map((s) => ({ start: s.startAt, end: s.endAt, mode: s.mode })),
      ...holdsForTutor.map((h) => ({ start: h.startAt, end: h.endAt })),
    ];

    const { earliestAllowedStart, latestAllowedStart, days: freeDays } = getFreeRanges({
      now,
      rangeStart,
      rangeEnd,
      minBookingNoticeHours: tutor.minBookingNoticeHours,
      maxBookingWindowHours: tutor.maxBookingWindowHours,
      recurringBlocks: tutor.availabilityBlocks,
      exceptions: tutor.availabilityExceptions,
      busyRanges,
      bufferMin,
      timeZone: tutor.timeZone,
      startIncrementMin: CONFIG.START_TIME_INCREMENT_MIN,
    });

    const bufferPadding = computeBufferPadding(
      sessionsForTutor.map((s) => ({ start: s.startAt, end: s.endAt, mode: s.mode })),
      bufferMin
    );

    return {
      tutorId: tutor.id,
      tutorName: tutor.name,
      timeZone: tutor.timeZone,
      color: colorForTutor(tutor.id),
      hourlyRateCents: tutor.hourlyRateCents,
      onlineAvailable: tutor.onlineAvailable,
      inPersonAvailable: tutor.inPersonAvailable,
      earliestAllowedStart: earliestAllowedStart.toISOString(),
      latestAllowedStart: latestAllowedStart.toISOString(),
      free: freeDays.flatMap((d) => d.ranges).map(toIso),
      busy: [
        ...sessionsForTutor.map((s) => ({ start: s.startAt, end: s.endAt, kind: "session" as const })),
        ...holdsForTutor.map((h) => ({ start: h.startAt, end: h.endAt, kind: "hold" as const })),
      ]
        .filter(inRange)
        .map((r) => ({ ...toIso(r), kind: r.kind })),
      buffer: bufferPadding.filter(inRange).map(toIso),
    };
  });

  return NextResponse.json({ start, days: dayLabels, timeZone: tz, bufferMin, tutors: result });
}
