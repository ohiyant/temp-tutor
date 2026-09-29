import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type { CurrentUser } from "@/lib/auth";
import TutorSchedule from "@/components/TutorSchedule";
import { zoneLabel } from "@/lib/calendarUi";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "15:00" -> "3pm", "15:30" -> "3:30pm" */
function shortTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "am" : "pm";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${String(m).padStart(2, "0")}${suffix}`;
}

/**
 * A tutor's home: their week calendar plus what they can change. Shown to a
 * signed-in tutor in place of the student booking pages, and to admins on
 * /dashboard/[tutorId]. Callers must already have checked access.
 */
export default async function TutorWorkspace({ tutorId, user }: { tutorId: string; user: CurrentUser }) {
  const tutor = await prisma.tutor.findUnique({
    where: { id: tutorId },
    include: {
      subjects: { include: { subject: true } },
      availabilityBlocks: { orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }] },
    },
  });
  if (!tutor) notFound();

  const isSelf = user.tutor?.id === tutor.id;
  const modes = [tutor.onlineAvailable && "Online", tutor.inPersonAvailable && "In-person"].filter(Boolean).join(" & ");
  const weekly = tutor.availabilityBlocks.map(
    (b) => `${DAY_NAMES[b.dayOfWeek]} ${shortTime(b.startTime)}–${shortTime(b.endTime)}`
  );

  return (
    <div className="container-wide tutor-workspace">
      {user.isAdmin && !isSelf && (
        <p className="back-link">
          <Link href="/admin/tutors">← All tutors</Link>
        </p>
      )}
      <h1>{isSelf ? "Your schedule" : `${tutor.name}'s schedule`}</h1>

      <div className="workspace-cards">
        <div className="workspace-card">
          <div className="workspace-card-head">
            <h2>Weekly availability</h2>
            <Link href={`/dashboard/${tutor.id}/availability`}>Edit availability</Link>
          </div>
          <p>{weekly.length ? weekly.join(" · ") : "No weekly hours set yet, so students can't book you."}</p>
          <p className="muted small">
            Times in {zoneLabel(tutor.timeZone)}. Bookings need {tutor.minBookingNoticeHours}h notice, up to {Math.round(tutor.maxBookingWindowHours / 24)}{" "}
            days ahead. Block off or add one-off times from the same page.
          </p>
        </div>
        <div className="workspace-card">
          <div className="workspace-card-head">
            <h2>Rate & subjects</h2>
            <Link href={`/dashboard/${tutor.id}/profile`}>Edit profile</Link>
          </div>
          <p>
            <strong>${(tutor.hourlyRateCents / 100).toFixed(2)}/hr</strong> · {modes || "No session types"}
          </p>
          <p>{tutor.subjects.map((s) => s.subject.name).join(", ") || "No subjects yet"}</p>
        </div>
      </div>

      {/* Only the tutor themselves or an admin can see this page, and both may cancel. */}
      <TutorSchedule tutorId={tutor.id} timeZone={tutor.timeZone} canCancel />
    </div>
  );
}
