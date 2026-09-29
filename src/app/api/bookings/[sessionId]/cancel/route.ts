import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { sendCancellationEmails } from "@/lib/sessionEmails";

const bodySchema = z.object({
  /** Optional note to the student, included in their email. */
  reason: z.string().trim().max(500).optional(),
});

/**
 * POST /api/bookings/[sessionId]/cancel — the session's own tutor, or an
 * admin, cancels a booked session.
 *
 * The session is kept with status `cancelled` (so there's a record), which
 * frees the slot on the booking calendar. Student and tutor are emailed.
 *
 * PAYMENT: no refund is issued yet — payments aren't built. When Stripe is
 * added, refund in full here (the student didn't choose to cancel).
 */
export async function POST(req: NextRequest, { params }: { params: { sessionId: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "The note is too long." }, { status: 400 });

  const existing = await prisma.session.findUnique({
    where: { id: params.sessionId },
    select: { tutorId: true, status: true, startAt: true },
  });
  // Same answer for "doesn't exist" and "not yours", so other tutors' sessions stay private.
  const isOwnTutor = existing && user.tutor?.id === existing.tutorId;
  if (!existing || (!user.isAdmin && !isOwnTutor)) {
    return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  }
  if (existing.startAt <= new Date()) {
    return NextResponse.json({ error: "This session has already started, so it can't be cancelled." }, { status: 409 });
  }

  // Conditional update so two people cancelling at once can't double-email.
  const claimed = await prisma.session.updateMany({
    where: { id: params.sessionId, status: "confirmed" },
    data: { status: "cancelled" },
  });
  if (claimed.count !== 1) {
    return NextResponse.json({ error: `This booking is already ${existing.status}.` }, { status: 409 });
  }

  const session = await prisma.session.findUniqueOrThrow({
    where: { id: params.sessionId },
    include: { tutor: true, subject: true },
  });
  // Someone who is both admin and the session's tutor is cancelling as the tutor.
  await sendCancellationEmails(session, isOwnTutor ? "tutor" : "admin", undefined, parsed.data.reason || undefined);

  return NextResponse.json({ ok: true });
}
