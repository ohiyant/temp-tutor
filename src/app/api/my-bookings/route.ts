import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { newToken, normalizeEmail } from "@/lib/auth";
import { appUrl } from "@/lib/manageLinks";
import { CONFIG } from "@/config";

const LOOKUP_EMAILS_PER_HOUR = 5;

const bodySchema = z.object({ email: z.string().trim().email("Enter a valid email.") });

/**
 * POST /api/my-bookings — email a student a link to see all their bookings.
 *
 * Answers the same way whether or not the address has bookings, so the form
 * can't be used to find out who booked here. Only addresses that do have
 * bookings are emailed, so it can't be used to spam strangers either.
 */
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter a valid email." }, { status: 400 });
  }
  const email = normalizeEmail(parsed.data.email);
  const response: { ok: true; devLink?: string } = { ok: true };

  const hasBookings = await prisma.session.findFirst({
    where: { studentEmail: { equals: email, mode: "insensitive" }, status: { not: "rescheduled" } },
    select: { id: true },
  });
  if (!hasBookings) return NextResponse.json(response);

  const recent = await prisma.bookingLookupToken.count({
    where: { email, createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } },
  });
  if (recent >= LOOKUP_EMAILS_PER_HOUR) {
    return NextResponse.json({ error: "Too many requests. Try again in an hour." }, { status: 429 });
  }

  const { token, tokenHash } = newToken();
  await prisma.bookingLookupToken.create({
    data: { email, tokenHash, expiresAt: new Date(Date.now() + CONFIG.BOOKING_LOOKUP_LINK_HOURS * 60 * 60 * 1000) },
  });

  const link = `${appUrl()}/my-bookings/${token}`;
  await sendEmail(
    email,
    `Your ${CONFIG.SITE_NAME} bookings`,
    [
      "Hi,",
      "",
      `Here's a link to see all your ${CONFIG.SITE_NAME} sessions, and reschedule or cancel upcoming ones. It works for ${CONFIG.BOOKING_LOOKUP_LINK_HOURS} hours:`,
      "",
      link,
      "",
      "If you didn't ask for this, you can ignore this email.",
    ].join("\n")
  );

  // Development only: hand the link straight back, since test addresses can't receive email.
  if (process.env.NODE_ENV !== "production") response.devLink = link;
  return NextResponse.json(response);
}
