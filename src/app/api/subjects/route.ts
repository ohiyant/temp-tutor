import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminApi } from "@/lib/auth";

export async function GET() {
  const subjects = await prisma.subject.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json(subjects);
}

const createSchema = z.object({ name: z.string().trim().min(1, "Enter a subject name.").max(100) });

/** POST /api/subjects — admin adds a subject. */
export async function POST(req: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const existing = await prisma.subject.findFirst({
    where: { name: { equals: parsed.data.name, mode: "insensitive" } },
  });
  if (existing) return NextResponse.json({ error: "That subject already exists." }, { status: 409 });

  const subject = await prisma.subject.create({ data: { name: parsed.data.name } });
  return NextResponse.json(subject, { status: 201 });
}

/** DELETE /api/subjects?id=... — admin removes a subject that has never been booked. */
export async function DELETE(req: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const booked = await prisma.session.count({ where: { subjectId: id } });
  if (booked > 0) {
    return NextResponse.json(
      { error: "This subject has bookings, so it can't be deleted." },
      { status: 409 }
    );
  }
  await prisma.subject.deleteMany({ where: { id } });
  return NextResponse.json({ ok: true });
}
