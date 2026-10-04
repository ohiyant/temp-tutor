-- Stripe Checkout: sessions booked together share a bookingRef, and the
-- temporary slot holds are keyed by it (one checkout can cover several sessions).

-- Holds only last minutes; any left over are stale.
DELETE FROM "BookingHold";

DROP INDEX "BookingHold_stripeCheckoutSessionId_key";

ALTER TABLE "Session" ADD COLUMN     "bookingRef" TEXT;

ALTER TABLE "BookingHold" DROP COLUMN "stripeCheckoutSessionId",
ADD COLUMN     "bookingRef" TEXT NOT NULL;

CREATE INDEX "Session_bookingRef_idx" ON "Session"("bookingRef");

CREATE INDEX "BookingHold_bookingRef_idx" ON "BookingHold"("bookingRef");
