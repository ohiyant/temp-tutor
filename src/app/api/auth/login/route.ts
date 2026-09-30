import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { LOGIN_EMAILS_PER_HOUR, LOGIN_TOKEN_TTL_MIN, isAdminEmail, newToken, normalizeEmail } from "@/lib/auth";
import { CONFIG } from "@/config";
import { appUrl } from "@/lib/manageLinks";
import { HOUR_MS, clientIp, rateLimit } from "@/lib/rateLimit";

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

  if (!(await rateLimit(`signin:ip:${clientIp(req)}`, CONFIG.SIGN_IN_EMAILS_PER_IP_PER_HOUR, HOUR_MS))) {
    return NextResponse.json({ error: "Too many sign-in requests. Try again in an hour." }, { status: 429 });
  }

  const tutor = await prisma.tutor.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  if (!tutor && !isAdminEmail(email)) return NextResponse.json(response);

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

  const link = `${appUrl()}/tutorlogin/verify?token=${encodeURIComponent(token)}`;
  await sendEmail(
    email,
    `Your ${CONFIG.SITE_NAME} sign-in link`,
    [
      `Hi${tutor ? ` ${tutor.name}` : ""},`,
      "",
      `Use this link to sign in to ${CONFIG.SITE_NAME}. It works once and expires in ${LOGIN_TOKEN_TTL_MIN} minutes:`,
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
