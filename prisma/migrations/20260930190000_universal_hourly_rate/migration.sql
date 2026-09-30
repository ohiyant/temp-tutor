-- One hourly rate for every tutor, set by admins.
CREATE TABLE "SiteSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "hourlyRateCents" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteSettings_pkey" PRIMARY KEY ("id")
);

-- Start from the rate most tutors already charge ($30/hr if there are none).
INSERT INTO "SiteSettings" ("id", "hourlyRateCents", "updatedAt")
SELECT 1, COALESCE((SELECT mode() WITHIN GROUP (ORDER BY "hourlyRateCents") FROM "Tutor"), 3000), CURRENT_TIMESTAMP;

-- Tutors no longer have their own rate. Sessions keep the price they were booked at.
ALTER TABLE "Tutor" DROP COLUMN "hourlyRateCents";
