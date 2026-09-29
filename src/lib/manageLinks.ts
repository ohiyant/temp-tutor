import { randomBytes } from "crypto";

/**
 * Cancel/reschedule links. Each session carries two random tokens; whoever
 * holds the emailed link can manage that one session, no sign-in needed.
 */

/** 32 random bytes, URL-safe. Unguessable, unlike the schema's cuid() default. */
export function newManageToken(): string {
  return randomBytes(32).toString("base64url");
}

export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function cancelPath(token: string): string {
  return `/cancel/${encodeURIComponent(token)}`;
}

export function reschedulePath(token: string): string {
  return `/reschedule/${encodeURIComponent(token)}`;
}
