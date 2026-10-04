import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { cancellationRefundPct } from "@/lib/policy";
import { sendCancellationEmails } from "@/lib/sessionEmails";
import { refundSession } from "@/lib/checkout";

const bodySchema = z.object({ token: z.string().min(1) });

/**
 * POST /api/manage/cancel — a student cancels their session with the
 * cancel link from their email. No sign-in: the token is the permission.
 *
 * If they paid online, `refundPct` of the price (from the cancellation
 * policy) goes back to their card.
 */
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Missing link code." }, { status: 400 });

  const session = await prisma.session.findUnique({
    where: { cancellationToken: parsed.data.token },
    include: { tutor: true, subject: true },
  });
  if (!session) return NextResponse.json({ error: "This cancel link isn't valid." }, { status: 404 });

  const now = new Date();
  if (session.startAt <= now) {
    return NextResponse.json({ error: "This session has already started, so it can't be cancelled." }, { status: 409 });
  }

  // Conditional update, so a double click (or an admin at the same moment) can't cancel twice.
  const claimed = await prisma.session.updateMany({
    where: { id: session.id, status: "confirmed" },
    data: { status: "cancelled" },
  });
  if (claimed.count !== 1) {
    return NextResponse.json({ error: `This booking is already ${session.status}.` }, { status: 409 });
  }

  const refundPct = cancellationRefundPct(session.startAt, now);
  let refundedCents: number;
  try {
    refundedCents = await refundSession(session, refundPct);
  } catch (err) {
    // Keep the booking as it was, so they can try again (the refund can't happen twice).
    console.error(`Refund for session ${session.id} failed:`, err);
    await prisma.session.update({ where: { id: session.id }, data: { status: "confirmed" } });
    return NextResponse.json(
      { error: "We couldn't process your refund, so the session wasn't cancelled. Please try again." },
      { status: 502 }
    );
  }
  await sendCancellationEmails(session, "student");

  return NextResponse.json({ ok: true, refundPct, refundedCents });
}
