import { randomBytes } from "crypto";

/**
 * Cancel/reschedule links. Each session carries two random tokens; whoever
 * holds the emailed link can manage that one session, no sign-in needed.
 */

/** 32 random bytes, URL-safe. Unguessable, unlike the schema's cuid() default. */
export function newManageToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * The site's public address, for links in emails. In order:
 *   1. NEXT_PUBLIC_APP_URL, if set (e.g. a custom domain).
 *   2. On Vercel, the project's production domain, which Vercel provides
 *      automatically and keeps up to date when the domain changes.
 *   3. Local development.
 */
export function appUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const vercelDomain = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelDomain) return `https://${vercelDomain}`;
  return "http://localhost:3000";
}

export function cancelPath(token: string): string {
  return `/cancel/${encodeURIComponent(token)}`;
}

export function reschedulePath(token: string): string {
  return `/reschedule/${encodeURIComponent(token)}`;
}
