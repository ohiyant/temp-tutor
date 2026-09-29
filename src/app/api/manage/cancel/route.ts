import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { cancellationRefundPct } from "@/lib/policy";
import { sendCancellationEmails } from "@/lib/sessionEmails";

const bodySchema = z.object({ token: z.string().min(1) });

/**
 * POST /api/manage/cancel — a student cancels their session with the
 * cancel link from their email. No sign-in: the token is the permission.
 *
 * PAYMENT: nothing is refunded yet, since nothing was charged. When Stripe
 * is added, refund `refundPct` of the price here.
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
  await sendCancellationEmails(session, "student");

  return NextResponse.json({ ok: true, refundPct });
}
