import Link from "next/link";
import { notFound } from "next/navigation";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { paymentsEnabled, stripe } from "@/lib/stripe";
import { confirmPaidCheckout } from "@/lib/checkout";
import { toBookingResult } from "@/lib/bookingResult";
import BookingConfirmation from "@/components/BookingConfirmation";

export const metadata = { title: "You're booked" };

/**
 * Where Stripe sends the student after paying (?checkout=cs_...). Confirms
 * the booking here too, in case Stripe's webhook hasn't arrived yet, then
 * shows the same "You're booked!" card as the booking page. The checkout id
 * is only known to whoever paid, so it's the permission to see this.
 */
export default async function BookingConfirmedPage(props: { searchParams: Promise<{ checkout?: string }> }) {
  const { checkout: checkoutId } = await props.searchParams;
  if (!paymentsEnabled() || !checkoutId?.startsWith("cs_")) notFound();

  let checkout: Stripe.Checkout.Session;
  try {
    checkout = await stripe().checkout.sessions.retrieve(checkoutId);
  } catch {
    notFound();
  }
  const bookingRef = checkout.metadata?.bookingRef;
  if (!bookingRef) notFound();

  if (checkout.payment_status !== "paid") {
    return (
      <div className="container">
        <div className="card booking-done">
          <h2>Payment processing</h2>
          <p className="booking-done-sub">
            Your payment hasn&apos;t gone through yet. Once it does, you&apos;ll get a confirmation email at{" "}
            <strong>{checkout.customer_details?.email ?? checkout.customer_email}</strong>.
          </p>
          <Link href="/book" className="btn btn-secondary">
            Back to booking
          </Link>
        </div>
      </div>
    );
  }

  const outcome = await confirmPaidCheckout(checkout);
  const sessions = await prisma.session.findMany({
    where: { bookingRef, status: "confirmed" },
    orderBy: { startAt: "asc" },
    include: { tutor: true, subject: true },
  });

  if (outcome === "refunded" || sessions.length === 0) {
    return (
      <div className="container">
        <div className="card booking-done">
          <h2>{outcome === "refunded" ? "Payment refunded" : "Nothing to show"}</h2>
          <p className="booking-done-sub">
            {outcome === "refunded"
              ? "Your times were released before the payment went through, so nothing was booked and your payment has been refunded in full."
              : "These sessions have since been cancelled or moved. Your current bookings are on the My bookings page."}
          </p>
          <div className="form-row">
            <Link href="/book" className="btn btn-primary">
              Book a session
            </Link>
            <Link href="/my-bookings" className="btn btn-secondary">
              My bookings
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const first = sessions[0];
  const tutors = [...new Map(sessions.map((s) => [s.tutor.id, s.tutor])).values()];
  return (
    <div className="container">
      <BookingConfirmation
        result={toBookingResult(first.subject.name, sessions, tutors)}
        timeZone={first.timezone}
        email={first.studentEmail}
        paid
        actions={
          <Link href="/book" className="btn btn-primary">
            Book more sessions
          </Link>
        }
      />
    </div>
  );
}
