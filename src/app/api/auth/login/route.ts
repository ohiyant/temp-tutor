import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { LOGIN_EMAILS_PER_HOUR, LOGIN_TOKEN_TTL_MIN, adminEmails, isAdminEmail, newToken, normalizeEmail } from "@/lib/auth";

const bodySchema = z.object({ email: z.string().trim().email("Enter a valid email.") });

/**
 * POST /api/auth/login — email a one-time sign-in link.
 *
 * Always answers the same way whether or not the address belongs to a tutor,
 * so the form can't be used to find out who tutors here.
 */
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter a valid email." }, { status: 400 });
  }
  const email = normalizeEmail(parsed.data.email);
  const response: { ok: true; devLink?: string } = { ok: true };

  const tutor = await prisma.tutor.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  if (!tutor && !isAdminEmail(email)) {
    // The response stays the same (so the form can't reveal who tutors here),
    // but say so in the server log, which is where to look when an expected
    // sign-in email never arrives.
    console.info(
      `[auth] sign-in requested for an email that isn't a tutor or in ADMIN_EMAILS (${adminEmails().length} admin email(s) configured); no email sent`
    );
    return NextResponse.json(response);
  }

  const recent = await prisma.loginToken.count({
    where: { email, createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } },
  });
  if (recent >= LOGIN_EMAILS_PER_HOUR) {
    return NextResponse.json({ error: "Too many sign-in emails. Try again in an hour." }, { status: 429 });
  }

  const { token, tokenHash } = newToken();
  await prisma.loginToken.create({
    data: { email, tokenHash, expiresAt: new Date(Date.now() + LOGIN_TOKEN_TTL_MIN * 60 * 1000) },
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  const link = `${appUrl}/login/verify?token=${encodeURIComponent(token)}`;
  await sendEmail(
    email,
    "Your TutorSpot sign-in link",
    [
      `Hi${tutor ? ` ${tutor.name}` : ""},`,
      "",
      `Use this link to sign in to TutorSpot. It works once and expires in ${LOGIN_TOKEN_TTL_MIN} minutes:`,
      "",
      link,
      "",
      "If you didn't ask for this, you can ignore this email.",
    ].join("\n")
  );

  // Development only: hand the link straight back, since test tutors'
  // addresses (example.com) can't receive email.
  if (process.env.NODE_ENV !== "production") response.devLink = link;
  return NextResponse.json(response);
}
