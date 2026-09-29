import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireTutorApi } from "@/lib/auth";
import { getAvailabilityRanges } from "@/lib/availability";
import { addDays, hhmmToMinutes, startOfDay, zonedTimeToUtc } from "@/lib/timezone";
import { CONFIG } from "@/config";

const querySchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "start must be YYYY-MM-DD"),
  days: z.coerce.number().int().min(1).max(CONFIG.MAX_CALENDAR_DAYS).default(CONFIG.DEFAULT_CALENDAR_DAYS),
});

/**
 * GET /api/tutors/[tutorId]/schedule?start=YYYY-MM-DD&days=N
 *
 * The tutor's own week view: their availability (weekly hours with one-off
 * changes applied), blocked-off times, and booked sessions with student
 * details. Only that tutor or an admin can read it.
 *
 * `start` is a date in the TUTOR's timezone (returned as `timeZone`); all
 * ranges are real UTC instants, for the client to lay out in that zone.
 */
export async function GET(req: NextRequest, { params }: { params: { tutorId: string } }) {
  const auth = await requireTutorApi(params.tutorId);
  if (auth instanceof NextResponse) return auth;

  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid query" }, { status: 400 });
  }
  const { start, days } = parsed.data;

  const tutor = await prisma.tutor.findUnique({
    where: { id: params.tutorId },
    include: {
      availabilityBlocks: true,
      // Exception dates are the tutor's local calendar dates, stored as UTC midnight.
      availabilityExceptions: {
        where: {
          date: { gte: new Date(`${start}T00:00:00.000Z`), lt: new Date(`${addDays(start, days)}T00:00:00.000Z`) },
        },
      },
    },
  });
  if (!tutor) return NextResponse.json({ error: "Tutor not found" }, { status: 404 });

  const tz = tutor.timeZone;
  const rangeStart = startOfDay(start, tz);
  const rangeEnd = startOfDay(addDays(start, days), tz);

  const sessions = await prisma.session.findMany({
    where: {
      tutorId: tutor.id,
      status: { in: ["confirmed", "completed"] },
      startAt: { lt: rangeEnd },
      endAt: { gt: rangeStart },
    },
    include: { subject: true },
    orderBy: { startAt: "asc" },
  });

  const available = getAvailabilityRanges({
    rangeStart,
    rangeEnd,
    recurringBlocks: tutor.availabilityBlocks,
    exceptions: tutor.availabilityExceptions,
    timeZone: tz,
  });

  return NextResponse.json({
    start,
    timeZone: tz,
    available: available.flatMap((d) => d.ranges).map((r) => ({ start: r.start.toISOString(), end: r.end.toISOString() })),
    blocked: tutor.availabilityExceptions
      .filter((e) => !e.isAvailable)
      .map((e) => {
        const date = e.date.toISOString().slice(0, 10);
        return {
          start: zonedTimeToUtc(date, hhmmToMinutes(e.startTime), tz).toISOString(),
          end: zonedTimeToUtc(date, hhmmToMinutes(e.endTime), tz).toISOString(),
        };
      }),
    sessions: sessions.map((s) => ({
      id: s.id,
      startAt: s.startAt.toISOString(),
      endAt: s.endAt.toISOString(),
      durationMin: s.durationMin,
      mode: s.mode,
      status: s.status,
      priceCents: s.priceCents,
      subjectName: s.subject.name,
      studentName: s.studentName,
      studentEmail: s.studentEmail,
      studentPhone: s.studentPhone,
      description: s.description,
    })),
  });
}
