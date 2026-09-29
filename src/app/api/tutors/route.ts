import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminApi } from "@/lib/auth";
import { isValidTimeZone } from "@/lib/timezone";
import { CONFIG } from "@/config";

const createSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a name.").max(200),
    email: z.string().trim().toLowerCase().email("Enter a valid email."),
    phone: z.string().trim().max(50).optional().nullable(),
    hourlyRateCents: z.number().int().positive("Enter an hourly rate greater than 0."),
    onlineAvailable: z.boolean(),
    inPersonAvailable: z.boolean(),
    subjectIds: z.array(z.string()).default([]),
    timeZone: z.string().refine(isValidTimeZone, "Unknown timezone").default(CONFIG.DEFAULT_TIMEZONE),
  })
  .refine((d) => d.onlineAvailable || d.inPersonAvailable, {
    message: "Pick online, in-person, or both.",
  });

/** POST /api/tutors — admin creates a tutor. The tutor then signs in with this email. */
export async function POST(req: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { subjectIds, phone, ...fields } = parsed.data;

  const existing = await prisma.tutor.findFirst({ where: { email: { equals: fields.email, mode: "insensitive" } } });
  if (existing) return NextResponse.json({ error: "A tutor with that email already exists." }, { status: 409 });

  const tutor = await prisma.tutor.create({
    data: {
      ...fields,
      phone: phone || null,
      subjects: { create: subjectIds.map((subjectId) => ({ subjectId })) },
    },
  });
  return NextResponse.json(tutor, { status: 201 });
}
