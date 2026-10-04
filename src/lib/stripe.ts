import Stripe from "stripe";

/**
 * Stripe, for taking payment at booking. Payments are on when
 * STRIPE_SECRET_KEY is set; without it, bookings are confirmed straight away
 * with nothing charged (handy in development, and how the site ran before
 * payments).
 */
export function paymentsEnabled(): boolean {
  return realKey(process.env.STRIPE_SECRET_KEY);
}

/** A real secret (or restricted) key, not empty or the "sk_test_..." placeholder from .env.example. */
function realKey(key: string | undefined): key is string {
  return /^(sk|rk)_(test|live)_[A-Za-z0-9]{20,}$/.test(key?.trim() ?? "");
}

let client: Stripe | null = null;

/** Created on first use, so builds and pages that don't pay work without a key. */
export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!realKey(key)) throw new Error("STRIPE_SECRET_KEY is not set to a real Stripe key.");
  client ??= new Stripe(key.trim());
  return client;
}
