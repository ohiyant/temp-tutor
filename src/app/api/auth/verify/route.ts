import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE, SESSION_TTL_DAYS, hashToken, newToken } from "@/lib/auth";

/**
 * POST /api/auth/verify — exchange a one-time link token for a session.
 * Submitted as a plain form from /login/verify, so it answers with redirects.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const token = form?.get("token");
  const fail = () => NextResponse.redirect(new URL("/login?error=link", req.url), 303);
  if (typeof token !== "string" || !token) return fail();

  // Claim the token with a conditional update, so a link can't be used
  // twice even if it's submitted twice at the same moment.
  const now = new Date();
  const loginToken = await prisma.loginToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!loginToken) return fail();
  const claimed = await prisma.loginToken.updateMany({
    where: { id: loginToken.id, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (claimed.count !== 1) return fail();

  const session = newToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.authSession.create({ data: { email: loginToken.email, tokenHash: session.tokenHash, expiresAt } });

  const res = NextResponse.redirect(new URL("/dashboard", req.url), 303);
  res.cookies.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return res;
}
