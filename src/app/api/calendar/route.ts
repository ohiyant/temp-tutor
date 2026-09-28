import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getFreeRanges, computeBufferPadding, type BusyRange, type TimeRange } from "@/lib/availability";
import { CONFIG } from "@/config";
import { z } from "zod";

const querySchema = z.object({
  subjectId: z.string().min(1),
  mode: z.enum(["online", "in_person", "both"]),
  tutorId: z.string().min(1).optional(),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "start must be YYYY-MM-DD"),
  days: z.coerce.number().int().min(1).max(CONFIG.MAX_CALENDAR_DAYS).default(CONFIG.DEFAULT_CALENDAR_DAYS),
  bufferMin: z.coerce.number().int().min(0).default(CONFIG.IN_PERSON_TRANSPORT_BUFFER_MIN),
});

// Small fixed palette, deterministically assigned per tutor so colors stay
// stable across requests without persisting anything.
const PALETTE = [
  "#2563eb", "#dc2626", "#059669", "#d97706",
  "#7c3aed", "#db2777", "#0891b2", "#65a30d",
];
function colorForTutor(tutorId: string): string {
  let hash = 0;
  for (let i = 0; i < tutorId.length; i++) hash = (hash * 31 + tutorId.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

function isoDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Group ranges by the UTC calendar date of their start. Buffer/busy pieces
 *  in this app are always short and same-day in practice, so this simple
 *  grouping is fine (documented simplification, same spirit as the engine's
 *  own UTC-wall-clock assumption). */
function groupByDate<T extends TimeRange>(ranges: T[]): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const r of ranges) {
    const key = isoDateOnly(r.start);
    (out[key] ??= []).push(r);
  }
  return out;
}

export async function GET(req: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid query" }, { status: 400 });
  }
  const { subjectId, mode, tutorId, start, days, bufferMin } = parsed.data;

  try {
    return await buildCalendarResponse({ subjectId, mode, tutorId, start, days, bufferMin });
  } catch (err) {
    // Surface the real cause instead of a bare 500 HTML error page — this
    // is what the client's error message shows, which is worth it during
    // development (a common culprit: DATABASE_URL not set / migrations not
    // run / seed data missing). Consider redacting `message` in production.
    console.error("GET /api/calendar failed:", err);
    const message = err instanceof Error ? err.message : "Unexpected server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function buildCalendarResponse(parsed: {
  subjectId: string;
  mode: "online" | "in_person" | "both";
  tutorId?: string;
  start: string;
  days: number;
  bufferMin: number;
}) {
  const { subjectId, mode, tutorId, start, days, bufferMin } = parsed;

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

  const rangeStart = new Date(`${start}T00:00:00.000Z`);
  const rangeEnd = new Date(rangeStart.getTime() + days * 24 * 60 * 60 * 1000);
  const now = new Date();
  const dayLabels: string[] = [];
  for (let i = 0; i < days; i++) {
    dayLabels.push(isoDateOnly(new Date(rangeStart.getTime() + i * 24 * 60 * 60 * 1000)));
  }

  if (tutors.length === 0) {
    return NextResponse.json({ start, days: dayLabels, bufferMin, tutors: [] });
  }

  const tutorIds = tutors.map((t) => t.id);
  const [confirmedSessions, activeHolds] = await Promise.all([
    prisma.session.findMany({
      where: {
        tutorId: { in: tutorIds },
        status: "confirmed",
        startAt: { lt: rangeEnd },
        endAt: { gt: rangeStart },
      },
      select: { tutorId: true, startAt: true, endAt: true, mode: true, subjectId: true },
    }),
    prisma.bookingHold.findMany({
      where: {
        tutorId: { in: tutorIds },
        expiresAt: { gt: now },
        startAt: { lt: rangeEnd },
        endAt: { gt: rangeStart },
      },
      select: { tutorId: true, startAt: true, endAt: true },
    }),
  ]);

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
    });

    const bufferPadding = computeBufferPadding(
      sessionsForTutor.map((s) => ({ start: s.startAt, end: s.endAt, mode: s.mode })),
      bufferMin
    );
    const busyByDate = groupByDate([
      ...sessionsForTutor.map((s) => ({ start: s.startAt, end: s.endAt, kind: "session" as const })),
      ...holdsForTutor.map((h) => ({ start: h.startAt, end: h.endAt, kind: "hold" as const })),
    ]);
    const bufferByDate = groupByDate(bufferPadding);
    const freeByDate = Object.fromEntries(freeDays.map((d) => [d.date, d.ranges]));

    return {
      tutorId: tutor.id,
      tutorName: tutor.name,
      color: colorForTutor(tutor.id),
      hourlyRateCents: tutor.hourlyRateCents,
      onlineAvailable: tutor.onlineAvailable,
      inPersonAvailable: tutor.inPersonAvailable,
      earliestAllowedStart: earliestAllowedStart.toISOString(),
      latestAllowedStart: latestAllowedStart.toISOString(),
      days: dayLabels.map((date) => ({
        date,
        free: (freeByDate[date] ?? []).map((r) => ({ start: r.start.toISOString(), end: r.end.toISOString() })),
        busy: (busyByDate[date] ?? []).map((r) => ({
          start: r.start.toISOString(),
          end: r.end.toISOString(),
          kind: r.kind,
        })),
        buffer: (bufferByDate[date] ?? []).map((r) => ({ start: r.start.toISOString(), end: r.end.toISOString() })),
      })),
    };
  });

  return NextResponse.json({ start, days: dayLabels, bufferMin, tutors: result });
}
