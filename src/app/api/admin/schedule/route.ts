import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminApi } from "@/lib/auth";
import { CONFIG } from "@/config";
import { addDays, isValidTimeZone, startOfDay } from "@/lib/timezone";
import { colorForTutor } from "@/lib/tutorColor";

const querySchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "start must be YYYY-MM-DD"),
  days: z.coerce.number().int().min(1).max(CONFIG.MAX_CALENDAR_DAYS).default(CONFIG.DEFAULT_CALENDAR_DAYS),
  /** The admin's timezone: `start` and the days are dates in this zone. */
  tz: z.string().refine(isValidTimeZone, "Unknown timezone").default("UTC"),
});

/**
 * GET /api/admin/schedule — every tutor's sessions in a date range, for the
 * admin bookings calendar. Includes cancelled ones (the page can hide
 * them), but not "rescheduled" rows, whose replacement is listed instead.
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

  const sessions = await prisma.session.findMany({
    where: {
      status: { in: ["confirmed", "completed", "cancelled"] },
      startAt: { lt: rangeEnd },
      endAt: { gt: rangeStart },
    },
    include: { tutor: true, subject: true },
    orderBy: { startAt: "asc" },
  });

  return NextResponse.json({
    start,
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
