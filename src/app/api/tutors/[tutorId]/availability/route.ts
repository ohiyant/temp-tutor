import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTutorApi } from "@/lib/auth";
import { z } from "zod";

const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

const createSchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    startTime: z.string().regex(timeRegex, "Use HH:mm format"),
    endTime: z.string().regex(timeRegex, "Use HH:mm format"),
  })
  .refine((data) => data.startTime < data.endTime, {
    message: "Start time must be before end time",
    path: ["endTime"],
  });

export async function POST(req: NextRequest, props: { params: Promise<{ tutorId: string }> }) {
  const params = await props.params;
  const auth = await requireTutorApi(params.tutorId);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const block = await prisma.availabilityBlock.create({
    data: { tutorId: params.tutorId, ...parsed.data },
  });

  return NextResponse.json(block, { status: 201 });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ tutorId: string }> }) {
  const params = await props.params;
  const auth = await requireTutorApi(params.tutorId);
  if (auth instanceof NextResponse) return auth;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await prisma.availabilityBlock.deleteMany({ where: { id, tutorId: params.tutorId } });
  return NextResponse.json({ ok: true });
}

/** PATCH /api/tutors/[tutorId]/availability?id=... — move or resize a weekly block (from the schedule calendar). */
export async function PATCH(req: NextRequest, props: { params: Promise<{ tutorId: string }> }) {
  const params = await props.params;
  const auth = await requireTutorApi(params.tutorId);
  if (auth instanceof NextResponse) return auth;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const updated = await prisma.availabilityBlock.updateMany({
    where: { id, tutorId: params.tutorId },
    data: parsed.data,
  });
  if (updated.count === 0) return NextResponse.json({ error: "Those hours no longer exist." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
