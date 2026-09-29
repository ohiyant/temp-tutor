import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

const bodySchema = z.object({
  /** "confirmed" undoes a mark, back to not-yet-marked. */
  outcome: z.enum(["completed", "no_show", "confirmed"]),
});

/**
 * POST /api/bookings/[sessionId]/outcome — the session's tutor, or an admin,
 * marks a session that has started as completed or a no-show (or undoes it).
 */
export async function POST(req: NextRequest, { params }: { params: { sessionId: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pick completed or no-show." }, { status: 400 });

  const session = await prisma.session.findUnique({
    where: { id: params.sessionId },
    select: { tutorId: true, status: true, startAt: true },
  });
  // Same answer for "doesn't exist" and "not yours", so other tutors' sessions stay private.
  if (!session || (!user.isAdmin && user.tutor?.id !== session.tutorId)) {
    return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  }
  if (!["confirmed", "completed", "no_show"].includes(session.status)) {
    return NextResponse.json({ error: `This booking is ${session.status}, so it can't be marked.` }, { status: 409 });
  }
  if (session.startAt > new Date()) {
    return NextResponse.json({ error: "You can mark a session once it has started." }, { status: 409 });
  }

  await prisma.session.update({ where: { id: params.sessionId }, data: { status: parsed.data.outcome } });
  return NextResponse.json({ ok: true, status: parsed.data.outcome });
}
