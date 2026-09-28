import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const patchSchema = z.object({
  phone: z.string().nullable().optional(),
  hourlyRateCents: z.number().int().positive().optional(),
  onlineAvailable: z.boolean().optional(),
  inPersonAvailable: z.boolean().optional(),
  subjectIds: z.array(z.string()).optional(),
  minBookingNoticeHours: z.number().int().min(0).optional(),
  maxBookingWindowHours: z.number().int().positive().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: { tutorId: string } }) {
  const tutor = await prisma.tutor.findUnique({
    where: { id: params.tutorId },
    include: { subjects: { include: { subject: true } } },
  });
  if (!tutor) return NextResponse.json({ error: "Tutor not found" }, { status: 404 });
  return NextResponse.json(tutor);
}

export async function PATCH(req: NextRequest, { params }: { params: { tutorId: string } }) {
  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { subjectIds, ...tutorFields } = parsed.data;

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
