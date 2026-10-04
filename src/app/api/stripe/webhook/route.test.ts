import { beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";

const confirmPaidCheckout = vi.fn(async () => "confirmed");
const releaseBooking = vi.fn(async () => {});
vi.mock("@/lib/checkout", () => ({ confirmPaidCheckout, releaseBooking }));

const SECRET = "whsec_test_secret";
process.env.STRIPE_SECRET_KEY = "sk_test_51AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
process.env.STRIPE_WEBHOOK_SECRET = SECRET;

const { POST } = await import("./route");

function stripeRequest(event: object, secret = SECRET) {
  const payload = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  return new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": signature },
    body: payload,
  }) as never;
}

const checkout = { id: "cs_test_1", object: "checkout.session", metadata: { bookingRef: "ref123" } };

describe("POST /api/stripe/webhook", () => {
  beforeEach(() => {
    confirmPaidCheckout.mockClear();
    releaseBooking.mockClear();
  });

  it("confirms the booking when a checkout is paid", async () => {
    const res = await POST(stripeRequest({ id: "evt_1", type: "checkout.session.completed", data: { object: checkout } }));
    expect(res.status).toBe(200);
    expect(confirmPaidCheckout).toHaveBeenCalledWith(checkout);
  });

  it("frees the held times when a checkout expires", async () => {
    const res = await POST(stripeRequest({ id: "evt_2", type: "checkout.session.expired", data: { object: checkout } }));
    expect(res.status).toBe(200);
    expect(releaseBooking).toHaveBeenCalledWith("ref123");
  });

  it("rejects events that weren't signed by Stripe", async () => {
    const res = await POST(
      stripeRequest({ id: "evt_3", type: "checkout.session.completed", data: { object: checkout } }, "whsec_wrong")
    );
    expect(res.status).toBe(400);
    expect(confirmPaidCheckout).not.toHaveBeenCalled();
  });

  it("asks Stripe to retry when handling fails", async () => {
    confirmPaidCheckout.mockRejectedValueOnce(new Error("db down"));
    const res = await POST(stripeRequest({ id: "evt_4", type: "checkout.session.completed", data: { object: checkout } }));
    expect(res.status).toBe(500);
  });
});
