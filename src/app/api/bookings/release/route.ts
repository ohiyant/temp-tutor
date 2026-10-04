import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { cancelCheckout, releaseBooking } from "@/lib/checkout";
import { paymentsEnabled } from "@/lib/stripe";

const bodySchema = z.object({
  /** The booking's random reference, from Stripe's "back" link. */
  bookingRef: z.string().min(10).max(100),
  /** The checkout the booking page opened, when it still remembers it. */
  checkoutId: z.string().startsWith("cs_").max(200).optional(),
});

/**
 * POST /api/bookings/release — the student came back from Stripe's page
 * without paying: stop that checkout and free the times it was holding, so
 * they (or anyone) can pick them again right away. Paid bookings are never
 * released.
 */
export async function POST(req: NextRequest) {
  if (!paymentsEnabled()) return NextResponse.json({ ok: true });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const { bookingRef, checkoutId } = parsed.data;
  try {
    if (checkoutId) {
      const released = await cancelCheckout(checkoutId, bookingRef);
      return NextResponse.json({ ok: true, released });
    }
    // Without the checkout id, just free the times. If they somehow pay
    // later anyway, the payment is refunded (see confirmPaidCheckout).
    await releaseBooking(bookingRef);
    return NextResponse.json({ ok: true, released: true });
  } catch (err) {
    console.error("POST /api/bookings/release failed:", err);
    return NextResponse.json({ error: "Couldn't release the booking." }, { status: 500 });
  }
}
