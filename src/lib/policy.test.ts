import { describe, expect, it } from "vitest";
import { canReschedule, cancellationRefundPct, rescheduleFeeCents } from "./policy";

const now = new Date("2026-10-01T12:00:00.000Z");
const inHours = (h: number) => new Date(now.getTime() + h * 60 * 60 * 1000);

describe("cancellationRefundPct", () => {
  it("refunds 50% more than 24 hours ahead", () => {
    expect(cancellationRefundPct(inHours(25), now)).toBe(0.5);
  });
  it("refunds nothing at 24 hours or less", () => {
    expect(cancellationRefundPct(inHours(24), now)).toBe(0);
    expect(cancellationRefundPct(inHours(2), now)).toBe(0);
  });
});

describe("canReschedule", () => {
  it("allows moving more than 48 hours ahead only", () => {
    expect(canReschedule(inHours(49), now)).toBe(true);
    expect(canReschedule(inHours(48), now)).toBe(false);
    expect(canReschedule(inHours(-1), now)).toBe(false);
  });
});

describe("rescheduleFeeCents", () => {
  it("is 25% of the price, rounded to the cent", () => {
    expect(rescheduleFeeCents(6000)).toBe(1500);
    expect(rescheduleFeeCents(4999)).toBe(1250);
  });
});
