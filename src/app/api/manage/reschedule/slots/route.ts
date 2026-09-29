import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { CONFIG } from "@/config";
import { getAvailableSlots } from "@/lib/availability";
import { addDays, isValidTimeZone, startOfDay } from "@/lib/timezone";

const querySchema = z.object({
  token: z.string().min(1),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z.coerce.number().int().min(1).max(CONFIG.MAX_CALENDAR_DAYS).default(CONFIG.DEFAULT_CALENDAR_DAYS),
  /** The viewer's timezone: `start` and the days are dates in this zone. */
  tz: z.string().refine(isValidTimeZone).default("UTC"),
});

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * GET /api/manage/reschedule/slots — open start times the session could
 * move to: same tutor and length, every RESCHEDULE_SLOT_INCREMENT_MIN,
 * leaving out the session's own current slot and the student's other
 * sessions. The reschedule API re-checks whichever one they pick.
 */
export async function GET(req: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { token, start, days, tz } = parsed.data;

  const session = await prisma.session.findUnique({
    where: { rescheduleToken: token },
    include: { tutor: { include: { availabilityBlocks: true, availabilityExceptions: true } } },
  });
  if (!session || session.status !== "confirmed") {
    return NextResponse.json({ error: "This reschedule link isn't valid any more." }, { status: 404 });
  }

  const rangeStart = startOfDay(start, tz);
  const rangeEnd = startOfDay(addDays(start, days), tz);
  const queryStart = new Date(rangeStart.getTime() - DAY_MS);
  const queryEnd = new Date(rangeEnd.getTime() + DAY_MS);
  const now = new Date();

  const [tutorSessions, holds, studentSessions] = await Promise.all([
    prisma.session.findMany({
      where: {
        tutorId: session.tutorId,
        status: "confirmed",
        id: { not: session.id },
        startAt: { lt: queryEnd },
        endAt: { gt: queryStart },
      },
      select: { startAt: true, endAt: true, mode: true },
    }),
    prisma.bookingHold.findMany({
      where: { tutorId: session.tutorId, expiresAt: { gt: now }, startAt: { lt: queryEnd }, endAt: { gt: queryStart } },
      select: { startAt: true, endAt: true },
    }),
    prisma.session.findMany({
      where: {
        studentEmail: { equals: session.studentEmail, mode: "insensitive" },
        status: "confirmed",
        id: { not: session.id },
        startAt: { lt: queryEnd },
        endAt: { gt: queryStart },
      },
      select: { startAt: true, endAt: true },
    }),
  ]);

  const slots = getAvailableSlots({
    now,
    rangeStart,
    rangeEnd,
    durationMin: session.durationMin,
    startIncrementMin: CONFIG.RESCHEDULE_SLOT_INCREMENT_MIN,
    minBookingNoticeHours: session.tutor.minBookingNoticeHours,
    maxBookingWindowHours: session.tutor.maxBookingWindowHours,
    recurringBlocks: session.tutor.availabilityBlocks,
    exceptions: session.tutor.availabilityExceptions,
    busyRanges: [
      ...tutorSessions.map((s) => ({ start: s.startAt, end: s.endAt, mode: s.mode })),
      ...holds.map((h) => ({ start: h.startAt, end: h.endAt })),
      // The student can't be in two sessions at once either.
      ...studentSessions.map((s) => ({ start: s.startAt, end: s.endAt })),
    ],
    bufferMin: CONFIG.IN_PERSON_TRANSPORT_BUFFER_MIN,
    timeZone: session.tutor.timeZone,
  });

  return NextResponse.json({
    slots: slots.filter((d) => d.getTime() !== session.startAt.getTime()).map((d) => d.toISOString()),
  });
}
