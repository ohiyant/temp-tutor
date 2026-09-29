import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminApi } from "@/lib/auth";
import { CONFIG } from "@/config";
import { addDays, isValidTimeZone, startOfDay } from "@/lib/timezone";
import { colorForTutor } from "@/lib/tutorColor";
import { getAvailabilityRanges } from "@/lib/availability";

const querySchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "start must be YYYY-MM-DD"),
  // Up to the weeks view's range (the days view asks for far fewer).
  days: z.coerce.number().int().min(1).max(CONFIG.MAX_CALENDAR_WEEKS * 7).default(CONFIG.DEFAULT_CALENDAR_DAYS),
  /** The admin's timezone: `start` and the days are dates in this zone. */
  tz: z.string().refine(isValidTimeZone, "Unknown timezone").default("UTC"),
});

/**
 * GET /api/admin/schedule — every tutor's sessions and availability in a
 * date range, for the admin bookings calendar. Sessions include cancelled
 * ones (the page can hide them), but not "rescheduled" rows, whose
 * replacement is listed instead. Availability is each tutor's weekly hours
 * with one-off changes applied (not reduced by bookings), as instants.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid query" }, { status: 400 });
  }
  const { start, days, tz } = parsed.data;
  const rangeStart = startOfDay(start, tz);
  const rangeEnd = startOfDay(addDays(start, days), tz);

  const [sessions, tutors] = await Promise.all([
    prisma.session.findMany({
      where: {
        status: { in: ["confirmed", "completed", "no_show", "cancelled"] },
        startAt: { lt: rangeEnd },
        endAt: { gt: rangeStart },
      },
      include: { tutor: true, subject: true },
      orderBy: { startAt: "asc" },
    }),
    prisma.tutor.findMany({ include: { availabilityBlocks: true, availabilityExceptions: true } }),
  ]);

  const availability = tutors.flatMap((t) =>
    getAvailabilityRanges({
      rangeStart,
      rangeEnd,
      recurringBlocks: t.availabilityBlocks,
      exceptions: t.availabilityExceptions,
      timeZone: t.timeZone,
    }).flatMap((d) =>
      d.ranges.map((r) => ({
        tutorId: t.id,
        tutorName: t.name,
        color: colorForTutor(t.id),
        start: r.start.toISOString(),
        end: r.end.toISOString(),
      }))
    )
  );

  return NextResponse.json({
    start,
    availability,
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
      tutorId: s.tutorId,
      tutorName: s.tutor.name,
      color: colorForTutor(s.tutorId),
    })),
  });
}
