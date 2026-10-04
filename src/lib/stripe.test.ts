import { afterEach, describe, expect, it } from "vitest";
import { paymentsEnabled } from "./stripe";

describe("paymentsEnabled", () => {
  const original = process.env.STRIPE_SECRET_KEY;
  afterEach(() => {
    process.env.STRIPE_SECRET_KEY = original;
  });

  it("stays off for a missing key or the .env.example placeholder", () => {
    delete process.env.STRIPE_SECRET_KEY;
    expect(paymentsEnabled()).toBe(false);
    process.env.STRIPE_SECRET_KEY = "sk_test_...";
    expect(paymentsEnabled()).toBe(false);
  });

  it("turns on for a real-looking key", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_51AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
    expect(paymentsEnabled()).toBe(true);
  });
});
