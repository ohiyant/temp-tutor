import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { CONFIG } from "@/config";
import { checkSessionFits, hasOverlap, sessionPriceCents } from "@/lib/booking";
import type { BusyRange } from "@/lib/availability";
import { formatDateTime, isValidTimeZone } from "@/lib/timezone";
import { newManageToken } from "@/lib/manageLinks";
import { DAY_MS as ONE_DAY_MS, HOUR_MS, clientIp, rateLimit } from "@/lib/rateLimit";
import { verifyTurnstile } from "@/lib/turnstile";
import { getHourlyRateCents } from "@/lib/settings";
import { paymentsEnabled } from "@/lib/stripe";
import {
  checkoutExpiresAt,
  createCheckout,
  holdExpiresAt,
  releaseBooking,
  releaseStalePendingBookings,
} from "@/lib/checkout";
import { sendBookingConfirmationEmails } from "@/lib/bookingEmails";
import { toBookingResult } from "@/lib/bookingResult";

/**
 * POST /api/bookings — book one or more sessions for a guest student.
 *
 * Every requested session is re-validated against fresh data inside a
 * transaction that holds a Postgres advisory lock per tutor (and per
 * student email), so two students racing for the same slot can't both win.
 *
 * Spam protection, before any of that: a hidden honeypot field bots fill in,
 * Cloudflare Turnstile (when configured), per-IP and per-email rate limits,
 * a cap on sessions per booking and on a student's upcoming sessions. The
 * student must also agree to the policies.
 *
 * PAYMENT: with Stripe on (STRIPE_SECRET_KEY set), the sessions are saved as
 * `pending_payment` with holds on their times, and the response is a Stripe
 * Checkout URL to send the student to; paying confirms them (see
 * src/lib/checkout.ts). With Stripe off, they're confirmed straight away.
 */

const bodySchema = z.object({
  subjectId: z.string().min(1),
  studentName: z.string().trim().min(1, "Enter your name.").max(200),
  studentEmail: z.string().trim().toLowerCase().email("Enter a valid email."),
  studentPhone: z.string().trim().max(50).optional().nullable(),
  description: z.string().max(CONFIG.DESCRIPTION_MAX_CHARS).default(""),
  /** The student's timezone, so their emails show times as they saw them. */
  timeZone: z.string().refine(isValidTimeZone, "Unknown timezone").default("UTC"),
  sessions: z
    .array(
      z.object({
        tutorId: z.string().min(1),
        startAt: z.string().datetime(),
        durationMin: z.number().int(),
        mode: z.enum(["online", "in_person"]),
        /** In-person sessions: where to meet, chosen by the student. */
        location: z.string().trim().max(200, "Keep the meeting place under 200 characters.").optional(),
      })
    )
    .min(1, "Pick at least one session.")
    .max(CONFIG.MAX_SESSIONS_PER_BOOKING, `You can book up to ${CONFIG.MAX_SESSIONS_PER_BOOKING} sessions at a time.`),
  acceptedPolicies: z.literal(true, { errorMap: () => ({ message: "Please agree to the policies to book." }) }),
  /** Honeypot: a field people never see; anything in it means a bot filled the form. */
  website: z.string().optional(),
  /** From the Cloudflare Turnstile widget, when it's switched on. */
  turnstileToken: z.string().optional(),
});

/** Thrown inside the transaction for anything the student can fix by picking again. */
class BookingConflict extends Error {}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid booking" }, { status: 400 });
  }
  const input = parsed.data;
  const ip = clientIp(req);

  if (input.website) {
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 400 });
  }
  if (!(await verifyTurnstile(input.turnstileToken, ip))) {
    return NextResponse.json({ error: "Please complete the \"I'm human\" check and try again." }, { status: 400 });
  }
  if (!(await rateLimit(`book:ip:${ip}`, CONFIG.BOOKINGS_PER_IP_PER_HOUR, HOUR_MS))) {
    return NextResponse.json({ error: "Too many bookings from here. Please try again in an hour." }, { status: 429 });
  }
  if (!(await rateLimit(`book:email:${input.studentEmail}`, CONFIG.BOOKINGS_PER_EMAIL_PER_DAY, ONE_DAY_MS))) {
    return NextResponse.json(
      { error: "Too many bookings for this email today. Please try again tomorrow." },
      { status: 429 }
    );
  }

  if (input.sessions.some((s) => s.mode === "in_person" && !s.location)) {
    return NextResponse.json({ error: "Enter where you'd like to meet for each in-person session." }, { status: 400 });
  }

  // One rate for every tutor, read once; each session saves its own price.
  const hourlyRateCents = await getHourlyRateCents();
  const takePayment = paymentsEnabled();
  // Ties together the sessions paid for in one checkout.
  const bookingRef = takePayment ? newManageToken() : null;
  const startedAt = new Date();
  if (takePayment) await releaseStalePendingBookings(startedAt);

  const requested = input.sessions
    .map((s) => {
      const start = new Date(s.startAt);
      return { ...s, start, end: new Date(start.getTime() + s.durationMin * 60 * 1000) };
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  if (hasOverlap(requested)) {
    return NextResponse.json({ error: "Two of your selected sessions overlap." }, { status: 400 });
  }

  try {
    const created = await prisma.$transaction(
      async (tx) => {
        const tutorIds = [...new Set(requested.map((s) => s.tutorId))].sort();
        // Sorted lock order so concurrent requests can't deadlock each other.
        for (const key of [...tutorIds.map((id) => `tutor:${id}`), `student:${input.studentEmail}`]) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
        }

        const subject = await tx.subject.findUnique({ where: { id: input.subjectId } });
        if (!subject) throw new BookingConflict("That subject no longer exists.");

        const tutors = await tx.tutor.findMany({
          where: { id: { in: tutorIds } },
          include: { availabilityBlocks: true, availabilityExceptions: true, subjects: true },
        });
        const tutorById = new Map(tutors.map((t) => [t.id, t]));

        const windowStart = new Date(requested[0].start.getTime() - DAY_MS);
        const windowEnd = new Date(Math.max(...requested.map((s) => s.end.getTime())) + DAY_MS);
        const now = new Date();

        const upcomingForStudent = await tx.session.count({
          where: {
            studentEmail: { equals: input.studentEmail, mode: "insensitive" },
            status: "confirmed",
            endAt: { gt: now },
          },
        });
        if (upcomingForStudent + requested.length > CONFIG.MAX_UPCOMING_SESSIONS_PER_STUDENT) {
          throw new BookingConflict(
            `You can have up to ${CONFIG.MAX_UPCOMING_SESSIONS_PER_STUDENT} upcoming sessions at once` +
              (upcomingForStudent ? ` (you have ${upcomingForStudent}).` : ".")
          );
        }

        const [existingSessions, activeHolds, studentSessions] = await Promise.all([
          tx.session.findMany({
            where: { tutorId: { in: tutorIds }, status: "confirmed", startAt: { lt: windowEnd }, endAt: { gt: windowStart } },
            select: { tutorId: true, startAt: true, endAt: true, mode: true },
          }),
          tx.bookingHold.findMany({
            where: { tutorId: { in: tutorIds }, expiresAt: { gt: now }, startAt: { lt: windowEnd }, endAt: { gt: windowStart } },
            select: { tutorId: true, startAt: true, endAt: true },
          }),
          tx.session.findMany({
            where: {
              studentEmail: { equals: input.studentEmail, mode: "insensitive" },
              status: "confirmed",
              startAt: { lt: windowEnd },
              endAt: { gt: windowStart },
            },
            select: { startAt: true, endAt: true },
          }),
        ]);

        for (const s of requested) {
          if (studentSessions.some((o) => o.startAt < s.end && s.start < o.endAt)) {
            throw new BookingConflict(
              `You already have a session booked at ${formatDateTime(s.start, input.timeZone)}.`
            );
          }
        }

        // Validate in time order, treating sessions accepted earlier in this
        // same request as busy, so e.g. two back-to-back in-person sessions
        // with one tutor still get their travel buffer.
        const accepted: (typeof requested[number] & { tutorName: string; priceCents: number })[] = [];
        for (const s of requested) {
          const tutor = tutorById.get(s.tutorId);
          if (!tutor) throw new BookingConflict("One of the selected tutors no longer exists.");
          if (!tutor.subjects.some((ts) => ts.subjectId === input.subjectId)) {
            throw new BookingConflict(`${tutor.name} doesn't teach ${subject.name}.`);
          }
          if (s.mode === "online" ? !tutor.onlineAvailable : !tutor.inPersonAvailable) {
            throw new BookingConflict(
              `${tutor.name} doesn't offer ${s.mode === "online" ? "online" : "in-person"} sessions.`
            );
          }

          const busyRanges: BusyRange[] = [
            ...existingSessions
              .filter((e) => e.tutorId === tutor.id)
              .map((e) => ({ start: e.startAt, end: e.endAt, mode: e.mode })),
            ...activeHolds.filter((h) => h.tutorId === tutor.id).map((h) => ({ start: h.startAt, end: h.endAt })),
            ...accepted.filter((a) => a.tutorId === tutor.id).map((a) => ({ start: a.start, end: a.end, mode: a.mode })),
          ];

          const problem = checkSessionFits({
            now,
            startAt: s.start,
            durationMin: s.durationMin,
            minBookingNoticeHours: tutor.minBookingNoticeHours,
            maxBookingWindowHours: tutor.maxBookingWindowHours,
            recurringBlocks: tutor.availabilityBlocks,
            exceptions: tutor.availabilityExceptions,
            busyRanges,
            bufferMin: CONFIG.IN_PERSON_TRANSPORT_BUFFER_MIN,
            timeZone: tutor.timeZone,
          });
          if (problem) {
            throw new BookingConflict(`${tutor.name}, ${formatDateTime(s.start, input.timeZone)}: ${problem}`);
          }

          accepted.push({ ...s, tutorName: tutor.name, priceCents: sessionPriceCents(hourlyRateCents, s.durationMin) });
        }

        const sessions = [];
        for (const a of accepted) {
          const session = await tx.session.create({
            data: {
              tutorId: a.tutorId,
              subjectId: input.subjectId,
              studentName: input.studentName,
              studentEmail: input.studentEmail,
              studentPhone: input.studentPhone || null,
              description: input.description,
              mode: a.mode,
              location: a.mode === "in_person" ? a.location ?? null : null,
              startAt: a.start,
              endAt: a.end,
              timezone: input.timeZone, // the student's, for their emails
              durationMin: a.durationMin,
              priceCents: a.priceCents,
              // Paid bookings wait for Stripe; without payments they're booked now.
              status: takePayment ? "pending_payment" : "confirmed",
              bookingRef,
              policiesAcceptedAt: now,
              cancellationToken: newManageToken(),
              rescheduleToken: newManageToken(),
            },
            select: {
              id: true,
              tutorId: true,
              startAt: true,
              endAt: true,
              durationMin: true,
              mode: true,
              priceCents: true,
              cancellationToken: true,
              location: true,
              rescheduleToken: true,
            },
          });
          sessions.push({ ...session, tutorName: a.tutorName });
        }
        if (bookingRef) {
          // Nobody else can take these times while the student pays.
          await tx.bookingHold.createMany({
            data: accepted.map((a) => ({
              tutorId: a.tutorId,
              startAt: a.start,
              endAt: a.end,
              expiresAt: holdExpiresAt(startedAt),
              bookingRef,
            })),
          });
        }
        return { subjectName: subject.name, sessions, tutors };
      },
      { maxWait: 10_000, timeout: 20_000 }
    );

    if (bookingRef) {
      try {
        const checkout = await createCheckout({
          bookingRef,
          studentEmail: input.studentEmail,
          subjectName: created.subjectName,
          timeZone: input.timeZone,
          expiresAt: checkoutExpiresAt(startedAt),
          sessions: created.sessions,
        });
        return NextResponse.json({ checkoutUrl: checkout.url, checkoutId: checkout.id, bookingRef }, { status: 201 });
      } catch (err) {
        console.error("Starting Stripe Checkout failed:", err);
        await releaseBooking(bookingRef);
        return NextResponse.json({ error: "Couldn't open the payment page. Please try again." }, { status: 502 });
      }
    }

    await sendBookingConfirmationEmails(
      {
        studentName: input.studentName,
        studentEmail: input.studentEmail,
        studentPhone: input.studentPhone || null,
        description: input.description,
        timezone: input.timeZone,
      },
      created
    );

    return NextResponse.json(toBookingResult(created.subjectName, created.sessions, created.tutors), { status: 201 });
  } catch (err) {
    if (err instanceof BookingConflict) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("POST /api/bookings failed:", err);
    return NextResponse.json({ error: "Something went wrong saving your booking. Please try again." }, { status: 500 });
  }
}
