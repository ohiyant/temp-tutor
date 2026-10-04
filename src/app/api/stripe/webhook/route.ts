import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { confirmPaidCheckout, releaseBooking } from "@/lib/checkout";

/**
 * POST /api/stripe/webhook — Stripe tells us when a checkout is paid or
 * expires. Set this URL up in the Stripe dashboard (Developers → Webhooks)
 * with the events below, and put its signing secret in STRIPE_WEBHOOK_SECRET.
 *
 *   checkout.session.completed / async_payment_succeeded → confirm + email
 *   checkout.session.expired → free the held times
 */
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[stripe webhook] STRIPE_WEBHOOK_SECRET is not set.");
    return NextResponse.json({ error: "Webhook not configured." }, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    // The signature covers the exact raw body, so read it as text.
    event = stripe().webhooks.constructEvent(await req.text(), req.headers.get("stripe-signature") ?? "", secret);
  } catch (err) {
    console.error("[stripe webhook] bad signature:", err);
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await confirmPaidCheckout(event.data.object);
        break;
      case "checkout.session.expired": {
        const bookingRef = event.data.object.metadata?.bookingRef;
        if (bookingRef) await releaseBooking(bookingRef);
        break;
      }
    }
  } catch (err) {
    // A 500 makes Stripe retry later; confirming twice is harmless.
    console.error(`[stripe webhook] handling ${event.type} failed:`, err);
    return NextResponse.json({ error: "Handler failed." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
