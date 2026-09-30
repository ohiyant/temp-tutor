/**
 * Sign-in for tutors and admins via emailed magic links.
 *
 * Identity is an email address. It gives access to:
 *   - the Tutor whose email matches (their own dashboard pages + APIs), and/or
 *   - everything, if it's listed in the ADMIN_EMAILS env var (comma-separated).
 *
 * Flow: /login -> POST /api/auth/login emails a one-time link to
 * /login/verify?token=... -> that page POSTs the token to /api/auth/verify,
 * which creates an AuthSession and sets an httpOnly cookie. The extra
 * confirm step stops email link scanners (which GET every link) from
 * burning the token before the person clicks.
 *
 * Tokens are random 32-byte values; only their SHA-256 hashes are stored.
 *
 * Checks live in each page and API route (not in a layout or middleware):
 * layouts don't reliably re-run for every request, and middleware runs on
 * the edge where Prisma isn't available.
 */

import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { NextResponse } from "next/server";
import type { Tutor } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const SESSION_COOKIE = "tutorspot_session";
export const LOGIN_TOKEN_TTL_MIN = 15;
export const SESSION_TTL_DAYS = 30;
/** Max sign-in emails per address per hour, so the form can't be used to spam someone. */
export const LOGIN_EMAILS_PER_HOUR = 5;

export interface CurrentUser {
  email: string;
  isAdmin: boolean;
  tutor: Tutor | null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "").split(",").map(normalizeEmail).filter(Boolean);
}

export function isAdminEmail(email: string): boolean {
  return adminEmails().includes(normalizeEmail(email));
}

export function newToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** The signed-in user for this request, or null. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.authSession.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.authSession.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  const tutor = await prisma.tutor.findFirst({
    where: { email: { equals: session.email, mode: "insensitive" } },
  });
  const isAdmin = isAdminEmail(session.email);
  // A tutor who was removed (and isn't an admin) no longer has access.
  if (!tutor && !isAdmin) return null;
  return { email: session.email, isAdmin, tutor };
}

export function canManageTutor(user: CurrentUser, tutorId: string): boolean {
  return user.isAdmin || user.tutor?.id === tutorId;
}

// ---------- Guards for server-rendered pages ----------

/** Redirects to /login when signed out. */
export async function requireUserPage(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Signed in AND allowed to manage this tutor; otherwise 404 (don't reveal other tutors exist). */
export async function requireTutorPage(tutorId: string): Promise<CurrentUser> {
  const user = await requireUserPage();
  if (!canManageTutor(user, tutorId)) notFound();
  return user;
}

export async function requireAdminPage(): Promise<CurrentUser> {
  const user = await requireUserPage();
  if (!user.isAdmin) notFound();
  return user;
}

// ---------- Guards for API routes ----------
// Return either the user or a ready-made error response:
//   const auth = await requireTutorApi(params.tutorId);
//   if (auth instanceof NextResponse) return auth;

export async function requireTutorApi(tutorId: string): Promise<CurrentUser | NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  if (!canManageTutor(user, tutorId)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  return user;
}

export async function requireAdminApi(): Promise<CurrentUser | NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  if (!user.isAdmin) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  return user;
}
