-- CreateEnum
CREATE TYPE "SessionMode" AS ENUM ('online', 'in_person');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('pending_payment', 'confirmed', 'cancelled', 'rescheduled', 'completed');

-- CreateTable
CREATE TABLE "Tutor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "hourlyRateCents" INTEGER NOT NULL,
    "onlineAvailable" BOOLEAN NOT NULL DEFAULT true,
    "inPersonAvailable" BOOLEAN NOT NULL DEFAULT false,
    "minBookingNoticeHours" INTEGER NOT NULL DEFAULT 24,
    "maxBookingWindowHours" INTEGER NOT NULL DEFAULT 720,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tutor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subject" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Subject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TutorSubject" (
    "tutorId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,

    CONSTRAINT "TutorSubject_pkey" PRIMARY KEY ("tutorId","subjectId")
);

-- CreateTable
CREATE TABLE "AvailabilityBlock" (
    "id" TEXT NOT NULL,
    "tutorId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,

    CONSTRAINT "AvailabilityBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityException" (
    "id" TEXT NOT NULL,
    "tutorId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "isAvailable" BOOLEAN NOT NULL,

    CONSTRAINT "AvailabilityException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tutorId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "studentName" TEXT NOT NULL,
    "studentEmail" TEXT NOT NULL,
    "studentPhone" TEXT,
    "description" VARCHAR(1000) NOT NULL,
    "mode" "SessionMode" NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'pending_payment',
    "stripePaymentIntentId" TEXT,
    "cancellationToken" TEXT NOT NULL,
    "rescheduleToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingHold" (
    "id" TEXT NOT NULL,
    "tutorId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "stripeCheckoutSessionId" TEXT NOT NULL,

    CONSTRAINT "BookingHold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tutor_email_key" ON "Tutor"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Subject_name_key" ON "Subject"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Session_cancellationToken_key" ON "Session"("cancellationToken");

-- CreateIndex
CREATE UNIQUE INDEX "Session_rescheduleToken_key" ON "Session"("rescheduleToken");

-- CreateIndex
CREATE INDEX "Session_tutorId_startAt_endAt_idx" ON "Session"("tutorId", "startAt", "endAt");

-- CreateIndex
CREATE INDEX "Session_studentEmail_startAt_endAt_idx" ON "Session"("studentEmail", "startAt", "endAt");

-- CreateIndex
CREATE UNIQUE INDEX "BookingHold_stripeCheckoutSessionId_key" ON "BookingHold"("stripeCheckoutSessionId");

-- CreateIndex
CREATE INDEX "BookingHold_tutorId_startAt_endAt_idx" ON "BookingHold"("tutorId", "startAt", "endAt");

-- AddForeignKey
ALTER TABLE "TutorSubject" ADD CONSTRAINT "TutorSubject_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "Tutor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TutorSubject" ADD CONSTRAINT "TutorSubject_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityBlock" ADD CONSTRAINT "AvailabilityBlock_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "Tutor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityException" ADD CONSTRAINT "AvailabilityException_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "Tutor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "Tutor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingHold" ADD CONSTRAINT "BookingHold_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "Tutor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
