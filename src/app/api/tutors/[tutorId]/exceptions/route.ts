import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

const createSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format"),
    startTime: z.string().regex(timeRegex, "Use HH:mm format"),
    endTime: z.string().regex(timeRegex, "Use HH:mm format"),
    isAvailable: z.boolean(),
  })
  .refine((data) => data.startTime < data.endTime, {
    message: "Start time must be before end time",
    path: ["endTime"],
  });

export async function POST(req: NextRequest, { params }: { params: { tutorId: string } }) {
  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const exception = await prisma.availabilityException.create({
    data: {
      tutorId: params.tutorId,
      date: new Date(`${parsed.data.date}T00:00:00Z`),
      startTime: parsed.data.startTime,
      endTime: parsed.data.endTime,
      isAvailable: parsed.data.isAvailable,
    },
  });

  return NextResponse.json(exception, { status: 201 });
}

export async function DELETE(req: NextRequest, { params }: { params: { tutorId: string } }) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await prisma.availabilityException.deleteMany({ where: { id, tutorId: params.tutorId } });
  return NextResponse.json({ ok: true });
}
