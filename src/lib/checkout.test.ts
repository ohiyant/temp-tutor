import { beforeEach, describe, expect, it, vi } from "vitest";

const refundsCreate = vi.fn(async () => ({ id: "re_123" }));
vi.mock("@/lib/stripe", () => ({ stripe: () => ({ refunds: { create: refundsCreate } }) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));

import { checkoutExpiresAt, holdExpiresAt, refundNote, refundSession } from "./checkout";

const now = new Date("2026-10-05T12:00:00Z");
const minutesAfterNow = (d: Date) => (d.getTime() - now.getTime()) / 60_000;

describe("checkout timing", () => {
  it("gives Stripe at least its 30-minute minimum", () => {
    expect(minutesAfterNow(checkoutExpiresAt(now))).toBeGreaterThanOrEqual(30);
  });

  it("holds the times past the checkout's expiry", () => {
    expect(holdExpiresAt(now).getTime()).toBeGreaterThan(checkoutExpiresAt(now).getTime());
  });
});

describe("refundSession", () => {
  beforeEach(() => refundsCreate.mockClear());

  const paid = { id: "s1", priceCents: 5500, stripePaymentIntentId: "pi_123" };

  it("refunds the policy's share, once per session", async () => {
    expect(await refundSession(paid, 0.5)).toBe(2750);
    expect(refundsCreate).toHaveBeenCalledWith(
      { payment_intent: "pi_123", amount: 2750, metadata: { sessionId: "s1" } },
      { idempotencyKey: "refund-s1" }
    );
  });

  it("refunds in full", async () => {
    expect(await refundSession(paid, 1)).toBe(5500);
  });

  it("does nothing for a 0% refund or a session that wasn't paid online", async () => {
    expect(await refundSession(paid, 0)).toBe(0);
    expect(await refundSession({ ...paid, stripePaymentIntentId: null }, 1)).toBe(0);
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it("lets a failed refund through to the caller", async () => {
    refundsCreate.mockRejectedValueOnce(new Error("card_declined"));
    await expect(refundSession(paid, 1)).rejects.toThrow("card_declined");
  });

  it("words the refund for emails", () => {
    expect(refundNote(2750)).toBe("You'll get $27.50 back on your card within 5–10 business days.");
  });
});
