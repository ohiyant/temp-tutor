/**
 * Seed script: run with `npm run prisma:seed`
 * Populates the four subjects + two sample tutors with recurring availability,
 * so you have real data to test the availability engine and booking flow against.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SUBJECTS = ["Computer Science", "Mathematics", "SAT/ACT", "Chemistry"];

async function main() {
  console.log("Seeding subjects...");
  const subjects = await Promise.all(
    SUBJECTS.map((name) =>
      prisma.subject.upsert({
        where: { name },
        update: {},
        create: { name },
      })
    )
  );
  const byName = Object.fromEntries(subjects.map((s) => [s.name, s]));

  // One hourly rate for every tutor.
  await prisma.siteSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1, hourlyRateCents: 3000 } });

  console.log("Seeding tutors...");

  const alice = await prisma.tutor.upsert({
    where: { email: "alice.tutor@example.com" },
    update: {},
    create: {
      name: "Alice Chen",
      email: "alice.tutor@example.com",
      phone: "555-0101",
      onlineAvailable: true,
      inPersonAvailable: true,
      minBookingNoticeHours: 24,
      maxBookingWindowHours: 24 * 30,
      subjects: {
        create: [
          { subjectId: byName["Computer Science"].id },
          { subjectId: byName["Mathematics"].id },
        ],
      },
      availabilityBlocks: {
        create: [
          { dayOfWeek: 1, startTime: "15:00", endTime: "19:00" }, // Monday
          { dayOfWeek: 3, startTime: "15:00", endTime: "19:00" }, // Wednesday
          { dayOfWeek: 6, startTime: "10:00", endTime: "14:00" }, // Saturday
        ],
      },
    },
  });

  const brian = await prisma.tutor.upsert({
    where: { email: "brian.tutor@example.com" },
    update: {},
    create: {
      name: "Brian Alvarez",
      email: "brian.tutor@example.com",
      phone: "555-0102",
      onlineAvailable: true,
      inPersonAvailable: false,
      minBookingNoticeHours: 12,
      maxBookingWindowHours: 24 * 14,
      subjects: {
        create: [
          { subjectId: byName["SAT/ACT"].id },
          { subjectId: byName["Chemistry"].id },
        ],
      },
      availabilityBlocks: {
        create: [
          { dayOfWeek: 2, startTime: "16:00", endTime: "20:00" }, // Tuesday
          { dayOfWeek: 4, startTime: "16:00", endTime: "20:00" }, // Thursday
        ],
      },
    },
  });

  console.log(`Seeded tutors: ${alice.name}, ${brian.name}`);
  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
