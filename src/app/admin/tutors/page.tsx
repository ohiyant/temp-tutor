import { prisma } from "@/lib/prisma";
import { requireAdminPage } from "@/lib/auth";
import { colorForTutor } from "@/lib/tutorColor";
import { timeZoneOptionLabel } from "@/lib/timezone";
import TutorCards from "./TutorCards";

export const metadata = { title: "Tutors · Admin · TutorSpot" };

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "15:00" -> "3pm", "15:30" -> "3:30pm" */
function shortTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "am" : "pm";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${String(m).padStart(2, "0")}${suffix}`;
}

export default async function AdminTutorsPage() {
  await requireAdminPage();
  const now = new Date();
  const [tutors, subjects] = await Promise.all([
    prisma.tutor.findMany({
      orderBy: { name: "asc" },
      include: {
        subjects: { include: { subject: true } },
        availabilityBlocks: { orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }] },
        _count: { select: { sessions: { where: { status: "confirmed", endAt: { gt: now } } } } },
      },
    }),
    prisma.subject.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <TutorCards
      subjects={subjects}
      tutors={tutors.map((t) => ({
        id: t.id,
        name: t.name,
        email: t.email,
        color: colorForTutor(t.id),
        rate: `$${(t.hourlyRateCents / 100).toFixed(2)}/hr`,
        modes: [t.onlineAvailable && "Online", t.inPersonAvailable && "In-person"].filter(Boolean).join(" & "),
        subjects: t.subjects.map((s) => s.subject.name),
        weekly: t.availabilityBlocks.map(
          (b) => `${DAY_NAMES[b.dayOfWeek]} ${shortTime(b.startTime)}–${shortTime(b.endTime)}`
        ),
        timeZone: timeZoneOptionLabel(t.timeZone, now),
        upcoming: t._count.sessions,
      }))}
    />
  );
}
