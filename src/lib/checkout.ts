/**
 * Paying for a booking with Stripe Checkout.
 *
 *   1. POST /api/bookings saves the sessions as `pending_payment`, sharing a
 *      random bookingRef, and puts a BookingHold on each time so nobody else
 *      can take it. Then createCheckout() sends the student to Stripe.
 *   2. When they pay, Stripe calls our webhook (and sends them back to
 *      /book/confirmed); both run confirmPaidCheckout(), which confirms the
 *      sessions and sends the confirmation emails, once.
 *   3. If they back out (or the checkout expires after CHECKOUT_HOLD_MINUTES),
 *      releaseBooking() deletes the pending sessions and holds.
 *
 * Cancelling a paid session refunds part or all of it with refundSession().
 */

import type Stripe from "stripe";
import { CONFIG } from "@/config";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { appUrl } from "@/lib/manageLinks";
import { formatDateTime } from "@/lib/timezone";
import { sendBookingConfirmationEmails } from "@/lib/bookingEmails";

const MINUTE_MS = 60 * 1000;

/**
 * When a new checkout stops taking payment. Stripe needs at least 30 minutes;
 * the extra minute covers the time between now and Stripe creating it.
 */
export function checkoutExpiresAt(now: Date): Date {
  return new Date(now.getTime() + (Math.max(CONFIG.CHECKOUT_HOLD_MINUTES, 30) + 1) * MINUTE_MS);
}

/** Slots stay held a little past the checkout's expiry, so a last-second payment never finds them taken. */
export function holdExpiresAt(now: Date): Date {
  return new Date(checkoutExpiresAt(now).getTime() + 5 * MINUTE_MS);
}

/** Starts a Stripe Checkout for a pending booking. */
export async function createCheckout(args: {
  bookingRef: string;
  studentEmail: string;
  subjectName: string;
  /** The student's timezone, for the times shown on Stripe's page. */
  timeZone: string;
  expiresAt: Date;
  sessions: { tutorName: string; startAt: Date; durationMin: number; priceCents: number }[];
}): Promise<{ id: string; url: string }> {
  const checkout = await stripe().checkout.sessions.create(
    {
      mode: "payment",
      // Cards only (plus Apple Pay, Google Pay and Stripe's saved-card Link).
      // Payments that take days to clear, like bank transfers, would outlast
      // the hold, and pay-later plans don't suit a $50 lesson.
      allowed_payment_method_types: ["card", "link"],
      customer_email: args.studentEmail,
      client_reference_id: args.bookingRef,
      metadata: { bookingRef: args.bookingRef },
      payment_intent_data: { metadata: { bookingRef: args.bookingRef } },
      line_items: args.sessions.map((s) => ({
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: s.priceCents,
          product_data: {
            name: `${args.subjectName} with ${s.tutorName}`,
            description: `${formatDateTime(s.startAt, args.timeZone)} · ${s.durationMin} min`,
          },
        },
      })),
      expires_at: Math.floor(args.expiresAt.getTime() / 1000),
      success_url: `${appUrl()}/book/confirmed?checkout={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl()}/book?checkout=cancelled&ref=${encodeURIComponent(args.bookingRef)}`,
    },
    // A retried request can't open a second checkout for the same booking.
    { idempotencyKey: `checkout-${args.bookingRef}` }
  );
  if (!checkout.url) throw new Error(`Stripe returned no URL for checkout ${checkout.id}`);
  return { id: checkout.id, url: checkout.url };
}

function bookingRefOf(checkout: Stripe.Checkout.Session): string | null {
  return checkout.metadata?.bookingRef ?? checkout.client_reference_id ?? null;
}

/**
 * A checkout was paid: confirm its sessions and send the confirmation
 * emails. Safe to call more than once (the webhook and the thank-you page
 * both do); only the first call confirms and emails.
 */
export async function confirmPaidCheckout(
  checkout: Stripe.Checkout.Session
): Promise<"confirmed" | "already_confirmed" | "unpaid" | "refunded"> {
  const bookingRef = bookingRefOf(checkout);
  if (!bookingRef || checkout.payment_status !== "paid") return "unpaid";
  const paymentIntentId =
    typeof checkout.payment_intent === "string" ? checkout.payment_intent : checkout.payment_intent?.id ?? null;

  const confirmedCount = await prisma.$transaction(async (tx) => {
    const updated = await tx.session.updateMany({
      where: { bookingRef, status: "pending_payment" },
      data: { status: "confirmed", stripePaymentIntentId: paymentIntentId },
    });
    await tx.bookingHold.deleteMany({ where: { bookingRef } });
    return updated.count;
  });

  if (confirmedCount === 0) {
    if ((await prisma.session.count({ where: { bookingRef } })) > 0) return "already_confirmed";
    // Paid, but the booking was already released (the student came back
    // from Stripe's page, then paid in another tab). Nothing to confirm, so
    // give the money back.
    if (paymentIntentId) {
      await stripe().refunds.create(
        { payment_intent: paymentIntentId, metadata: { bookingRef, reason: "booking_released" } },
        { idempotencyKey: `refund-released-${bookingRef}` }
      );
    }
    console.error(`[checkout] ${checkout.id} was paid after booking ${bookingRef} was released; refunded in full.`);
    return "refunded";
  }

  const sessions = await prisma.session.findMany({
    where: { bookingRef, status: "confirmed" },
    orderBy: { startAt: "asc" },
    include: { tutor: true, subject: true },
  });
  const first = sessions[0];
  await sendBookingConfirmationEmails(first, {
    subjectName: first.subject.name,
    sessions,
    tutors: [...new Map(sessions.map((s) => [s.tutor.id, s.tutor])).values()],
  });
  return "confirmed";
}

/** The student didn't pay: free the held times. Paid sessions are never touched. */
export async function releaseBooking(bookingRef: string): Promise<void> {
  await prisma.$transaction([
    prisma.session.deleteMany({ where: { bookingRef, status: "pending_payment" } }),
    prisma.bookingHold.deleteMany({ where: { bookingRef } }),
  ]);
}

/**
 * Stops an unpaid checkout so it can't be paid any more, then releases the
 * booking. Returns false (and releases nothing) if it was already paid.
 */
export async function cancelCheckout(checkoutId: string, bookingRef: string): Promise<boolean> {
  const checkout = await stripe().checkout.sessions.retrieve(checkoutId);
  if (bookingRefOf(checkout) !== bookingRef) return false;
  if (checkout.status === "complete") return false;
  if (checkout.status === "open") await stripe().checkout.sessions.expire(checkoutId);
  await releaseBooking(bookingRef);
  return true;
}

/** Deletes pending bookings left behind long after their checkout expired (e.g. a missed webhook). */
export async function releaseStalePendingBookings(now: Date): Promise<void> {
  // Anything created longer ago than a hold lasts (plus slack) can no longer be paid.
  const holdMs = holdExpiresAt(now).getTime() - now.getTime();
  const cutoff = new Date(now.getTime() - holdMs - 30 * MINUTE_MS);
  await prisma.$transaction([
    prisma.session.deleteMany({ where: { status: "pending_payment", createdAt: { lt: cutoff } } }),
    prisma.bookingHold.deleteMany({ where: { expiresAt: { lt: now } } }),
  ]);
}

/**
 * Refunds `pct` (0–1) of a paid session's price. Returns the cents refunded:
 * 0 when there's nothing to refund (not paid online, or a 0% refund).
 * Throws if Stripe refuses, so the caller can keep the session as it was.
 */
export async function refundSession(
  session: { id: string; priceCents: number; stripePaymentIntentId: string | null },
  pct: number
): Promise<number> {
  const amount = Math.round(session.priceCents * pct);
  if (!session.stripePaymentIntentId || amount <= 0) return 0;
  await stripe().refunds.create(
    { payment_intent: session.stripePaymentIntentId, amount, metadata: { sessionId: session.id } },
    // One refund per session, however many times cancel is clicked.
    { idempotencyKey: `refund-${session.id}` }
  );
  return amount;
}

/** "You'll get $27.50 back on your card within 5–10 business days." */
export function refundNote(cents: number): string {
  return `You'll get $${(cents / 100).toFixed(2)} back on your card within 5–10 business days.`;
}
