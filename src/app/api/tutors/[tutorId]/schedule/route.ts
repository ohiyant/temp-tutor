import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireTutorApi } from "@/lib/auth";
import { getAvailabilityRanges } from "@/lib/availability";
import { addDays, hhmmToMinutes, startOfDay, zonedTimeToUtc } from "@/lib/timezone";
import { CONFIG } from "@/config";

const querySchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "start must be YYYY-MM-DD"),
  // Up to the weeks view's range (the days view asks for far fewer).
  days: z.coerce.number().int().min(1).max(CONFIG.MAX_CALENDAR_WEEKS * 7).default(CONFIG.DEFAULT_CALENDAR_DAYS),
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
 *
 * `blocks` are the pieces the availability is made of, per day, so the
 * calendar can move, resize and remove them: weekly hours ("weekly"),
 * one-day extra hours ("extra") and one-day blocked-off times ("blocked"),
 * as wall-clock minutes after midnight in the tutor's timezone.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ tutorId: string }> }) {
  const params = await props.params;
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
      status: { in: ["confirmed", "completed", "no_show"] },
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

  const blocks = Array.from({ length: days }, (_, i) => addDays(start, i)).flatMap((date) => {
    const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    return [
      ...tutor.availabilityBlocks
        .filter((b) => b.dayOfWeek === weekday)
        .map((b) => ({ kind: "weekly" as const, id: b.id, date, ...wallMinutes(b) })),
      ...tutor.availabilityExceptions
        .filter((e) => e.date.toISOString().slice(0, 10) === date)
        .map((e) => ({ kind: e.isAvailable ? ("extra" as const) : ("blocked" as const), id: e.id, date, ...wallMinutes(e) })),
    ];
  });

  return NextResponse.json({
    start,
    timeZone: tz,
    blocks,
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
      location: s.location,
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

/** "15:00"–"23:59" -> { startMin: 900, endMin: 1440 } ("23:59" is how the end of the day is stored). */
function wallMinutes(b: { startTime: string; endTime: string }): { startMin: number; endMin: number } {
  return { startMin: hhmmToMinutes(b.startTime), endMin: b.endTime === "23:59" ? 24 * 60 : hhmmToMinutes(b.endTime) };
}
