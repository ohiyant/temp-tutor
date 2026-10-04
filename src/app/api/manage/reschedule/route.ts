import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { CONFIG } from "@/config";
import { checkSessionFits } from "@/lib/booking";
import { canReschedule } from "@/lib/policy";
import { cancelPath, newManageToken, reschedulePath } from "@/lib/manageLinks";
import { sendRescheduleEmails } from "@/lib/sessionEmails";

const bodySchema = z.object({
  token: z.string().min(1),
  startAt: z.string().datetime(),
});

class RescheduleProblem extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

/**
 * POST /api/manage/reschedule — a student moves their session to a new
 * start time (same tutor, subject, mode and length) with the reschedule link
 * from their email.
 *
 * The old row is kept as `rescheduled` for the record and a new confirmed
 * session is created with fresh cancel/reschedule links. Runs under the
 * same per-tutor and per-student locks as a new booking, so it can't race
 * one into a double booking.
 *
 * Rescheduling is free: the session keeps its price and any payment.
 */
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pick a new time." }, { status: 400 });
  const newStart = new Date(parsed.data.startAt);

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const old = await tx.session.findUnique({
          where: { rescheduleToken: parsed.data.token },
          include: { tutor: { include: { availabilityBlocks: true, availabilityExceptions: true } }, subject: true },
        });
        if (!old) throw new RescheduleProblem("This reschedule link isn't valid.", 404);

        for (const key of [`tutor:${old.tutorId}`, `student:${old.studentEmail.toLowerCase()}`]) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
        }
        // Re-read under the lock: it may have been cancelled or moved meanwhile.
        const current = await tx.session.findUniqueOrThrow({ where: { id: old.id }, select: { status: true } });
        if (current.status !== "confirmed") throw new RescheduleProblem(`This booking is already ${current.status}.`);

        const now = new Date();
        if (!canReschedule(old.startAt, now)) {
          throw new RescheduleProblem(
            `Sessions can only be rescheduled more than ${CONFIG.RESCHEDULE_MIN_NOTICE_HOURS} hours before they start.`
          );
        }
        if (newStart.getTime() === old.startAt.getTime()) throw new RescheduleProblem("That's the time it's already booked for.");

        const newEnd = new Date(newStart.getTime() + old.durationMin * 60 * 1000);
        const DAY_MS = 24 * 60 * 60 * 1000;
        const windowStart = new Date(newStart.getTime() - DAY_MS);
        const windowEnd = new Date(newEnd.getTime() + DAY_MS);

        const [tutorSessions, holds, studentClash] = await Promise.all([
          tx.session.findMany({
            where: {
              tutorId: old.tutorId,
              status: "confirmed",
              id: { not: old.id },
              startAt: { lt: windowEnd },
              endAt: { gt: windowStart },
            },
            select: { startAt: true, endAt: true, mode: true },
          }),
          tx.bookingHold.findMany({
            where: { tutorId: old.tutorId, expiresAt: { gt: now }, startAt: { lt: windowEnd }, endAt: { gt: windowStart } },
            select: { startAt: true, endAt: true },
          }),
          tx.session.findFirst({
            where: {
              studentEmail: { equals: old.studentEmail, mode: "insensitive" },
              status: "confirmed",
              id: { not: old.id },
              startAt: { lt: newEnd },
              endAt: { gt: newStart },
            },
            select: { id: true },
          }),
        ]);
        if (studentClash) throw new RescheduleProblem("You already have another session booked at that time.");

        const problem = checkSessionFits({
          now,
          startAt: newStart,
          durationMin: old.durationMin,
          minBookingNoticeHours: old.tutor.minBookingNoticeHours,
          maxBookingWindowHours: old.tutor.maxBookingWindowHours,
          recurringBlocks: old.tutor.availabilityBlocks,
          exceptions: old.tutor.availabilityExceptions,
          busyRanges: [
            ...tutorSessions.map((s) => ({ start: s.startAt, end: s.endAt, mode: s.mode })),
            ...holds.map((h) => ({ start: h.startAt, end: h.endAt })),
          ],
          bufferMin: CONFIG.IN_PERSON_TRANSPORT_BUFFER_MIN,
          timeZone: old.tutor.timeZone,
        });
        if (problem) throw new RescheduleProblem(problem);

        await tx.session.update({ where: { id: old.id }, data: { status: "rescheduled" } });
        const moved = await tx.session.create({
          data: {
            tutorId: old.tutorId,
            subjectId: old.subjectId,
            studentName: old.studentName,
            studentEmail: old.studentEmail,
            studentPhone: old.studentPhone,
            description: old.description,
            mode: old.mode,
            location: old.location,
            startAt: newStart,
            endAt: newEnd,
            timezone: old.timezone,
            durationMin: old.durationMin,
            priceCents: old.priceCents,
            // Same payment: cancelling the moved session refunds against it.
            stripePaymentIntentId: old.stripePaymentIntentId,
            status: "confirmed",
            cancellationToken: newManageToken(),
            rescheduleToken: newManageToken(),
          },
          include: { tutor: true, subject: true },
        });
        return { oldStartAt: old.startAt, moved };
      },
      { maxWait: 10_000, timeout: 20_000 }
    );

    await sendRescheduleEmails(result.oldStartAt, result.moved);

    return NextResponse.json({
      startAt: result.moved.startAt.toISOString(),
      endAt: result.moved.endAt.toISOString(),
      cancelPath: cancelPath(result.moved.cancellationToken),
      reschedulePath: reschedulePath(result.moved.rescheduleToken),
    });
  } catch (err) {
    if (err instanceof RescheduleProblem) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("POST /api/manage/reschedule failed:", err);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
