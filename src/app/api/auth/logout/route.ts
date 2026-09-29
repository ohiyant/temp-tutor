import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE, hashToken } from "@/lib/auth";

/** POST /api/auth/logout — end this browser's session. Submitted as a plain form. */
export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) await prisma.authSession.deleteMany({ where: { tokenHash: hashToken(token) } });

  const res = NextResponse.redirect(new URL("/login?signedOut=1", req.url), 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
