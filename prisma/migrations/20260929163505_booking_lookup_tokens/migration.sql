-- CreateTable
CREATE TABLE "BookingLookupToken" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingLookupToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BookingLookupToken_tokenHash_key" ON "BookingLookupToken"("tokenHash");

-- CreateIndex
CREATE INDEX "BookingLookupToken_email_createdAt_idx" ON "BookingLookupToken"("email", "createdAt");
