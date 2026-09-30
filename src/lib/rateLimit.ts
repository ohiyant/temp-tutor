import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Simple rate limiting backed by the database (so it holds across all of
 * Vercel's serverless instances, which share no memory).
 *
 * Each allowed action records a row under `key`; an action is refused once
 * `limit` rows exist for that key within the window. Not perfectly atomic
 * (two requests at the same instant can both slip in), which is fine for
 * stopping spam and floods.
 */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  const since = new Date(Date.now() - windowMs);
  const recent = await prisma.rateLimitHit.count({ where: { key, createdAt: { gt: since } } });
  if (recent >= limit) return false;
  await prisma.rateLimitHit.create({ data: { key } });

  // Now and then, clear out rows too old to matter to any limit.
  if (Math.random() < 0.05) {
    await prisma.rateLimitHit
      .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) } } })
      .catch(() => {});
  }
  return true;
}

/** The visitor's IP address (Vercel puts it first in x-forwarded-for). */
export function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
