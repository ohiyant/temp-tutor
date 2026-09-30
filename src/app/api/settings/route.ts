import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth";
import { setHourlyRateCents } from "@/lib/settings";

const patchSchema = z.object({
  hourlyRateCents: z
    .number()
    .int()
    .positive("Enter an hourly rate greater than 0.")
    .max(100_000, "That rate looks too high."),
});

/**
 * PATCH /api/settings — admin changes site-wide settings (the hourly rate).
 * Existing bookings keep the price they were booked at.
 */
export async function PATCH(req: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  await setHourlyRateCents(parsed.data.hourlyRateCents);
  return NextResponse.json({ ok: true });
}
