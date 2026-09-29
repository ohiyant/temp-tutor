import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminApi, requireTutorApi } from "@/lib/auth";
import { z } from "zod";
import { isValidTimeZone } from "@/lib/timezone";

const patchSchema = z.object({
  // Admin-only: a tutor's email is their sign-in identity.
  name: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  phone: z.string().nullable().optional(),
  hourlyRateCents: z.number().int().positive().optional(),
  onlineAvailable: z.boolean().optional(),
  inPersonAvailable: z.boolean().optional(),
  subjectIds: z.array(z.string()).optional(),
  timeZone: z.string().refine(isValidTimeZone, "Unknown timezone").optional(),
  minBookingNoticeHours: z.number().int().min(0).optional(),
  maxBookingWindowHours: z.number().int().positive().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: { tutorId: string } }) {
  const auth = await requireTutorApi(params.tutorId);
  if (auth instanceof NextResponse) return auth;

  const tutor = await prisma.tutor.findUnique({
    where: { id: params.tutorId },
    include: { subjects: { include: { subject: true } } },
  });
  if (!tutor) return NextResponse.json({ error: "Tutor not found" }, { status: 404 });
  return NextResponse.json(tutor);
}

export async function PATCH(req: NextRequest, { params }: { params: { tutorId: string } }) {
  const auth = await requireTutorApi(params.tutorId);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { subjectIds, ...tutorFields } = parsed.data;
  if ((tutorFields.name !== undefined || tutorFields.email !== undefined) && !auth.isAdmin) {
    return NextResponse.json({ error: "Only an admin can change a tutor's name or email." }, { status: 403 });
  }
  if (tutorFields.email) {
    const clash = await prisma.tutor.findFirst({
      where: { email: { equals: tutorFields.email, mode: "insensitive" }, id: { not: params.tutorId } },
    });
    if (clash) return NextResponse.json({ error: "Another tutor already uses that email." }, { status: 409 });
  }

  const tutor = await prisma.tutor.findUnique({ where: { id: params.tutorId } });
  if (!tutor) return NextResponse.json({ error: "Tutor not found" }, { status: 404 });

  const updated = await prisma.$transaction(async (tx) => {
    if (subjectIds) {
      await tx.tutorSubject.deleteMany({ where: { tutorId: params.tutorId } });
      await tx.tutorSubject.createMany({
        data: subjectIds.map((subjectId) => ({ tutorId: params.tutorId, subjectId })),
      });
    }
    return tx.tutor.update({
      where: { id: params.tutorId },
      data: tutorFields,
      include: { subjects: { include: { subject: true } } },
    });
  });

  return NextResponse.json(updated);
}

/**
 * DELETE /api/tutors/[tutorId] — admin permanently removes a tutor along
 * with ALL of their bookings (past and upcoming), checkout holds,
 * availability, subjects, and sign-in sessions. Cannot be undone.
 *
 * Students with upcoming bookings are not emailed; do that separately
 * before removing a tutor who still has sessions coming up.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { tutorId: string } }) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  const tutor = await prisma.tutor.findUnique({ where: { id: params.tutorId } });
  if (!tutor) return NextResponse.json({ error: "Tutor not found" }, { status: 404 });

  // Sessions and holds don't cascade (so a normal delete can't silently
  // wipe bookings); remove them explicitly. Availability blocks,
  // exceptions and subject links cascade from the tutor row.
  const [sessions, holds] = await prisma.$transaction([
    prisma.session.deleteMany({ where: { tutorId: tutor.id } }),
    prisma.bookingHold.deleteMany({ where: { tutorId: tutor.id } }),
    prisma.authSession.deleteMany({ where: { email: { equals: tutor.email, mode: "insensitive" } } }),
    prisma.loginToken.deleteMany({ where: { email: { equals: tutor.email, mode: "insensitive" } } }),
    prisma.tutor.delete({ where: { id: tutor.id } }),
  ]);

  return NextResponse.json({ ok: true, deletedSessions: sessions.count, deletedHolds: holds.count });
}
