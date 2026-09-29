-- AlterTable
ALTER TABLE "Tutor" ADD COLUMN     "timeZone" TEXT NOT NULL DEFAULT 'America/Chicago';

-- Until now, stored times were Chicago wall-clock times written as if they
-- were UTC (e.g. a 5pm session was stored as 17:00 UTC). Convert them to the
-- real UTC instants of those Chicago times, so a 5pm session stays 5pm.
UPDATE "Session" SET
  "startAt" = ("startAt" AT TIME ZONE 'America/Chicago') AT TIME ZONE 'UTC',
  "endAt"   = ("endAt"   AT TIME ZONE 'America/Chicago') AT TIME ZONE 'UTC';

-- (expiresAt was always a real instant, so it stays as is.)
UPDATE "BookingHold" SET
  "startAt" = ("startAt" AT TIME ZONE 'America/Chicago') AT TIME ZONE 'UTC',
  "endAt"   = ("endAt"   AT TIME ZONE 'America/Chicago') AT TIME ZONE 'UTC';

-- Students who booked so far saw Chicago times.
UPDATE "Session" SET "timezone" = 'America/Chicago' WHERE "timezone" = 'UTC';
