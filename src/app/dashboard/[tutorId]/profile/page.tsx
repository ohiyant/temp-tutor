import { prisma } from "@/lib/prisma";
import { requireTutorPage } from "@/lib/auth";
import { notFound } from "next/navigation";
import ProfileManager from "./ProfileManager";
import RemoveTutor from "./RemoveTutor";

/** Rate & subjects tab: rate, session types, subjects, contact and timezone. */
export default async function ProfilePage({
  params,
}: {
  params: { tutorId: string };
}) {
  const user = await requireTutorPage(params.tutorId);

  const tutor = await prisma.tutor.findUnique({
    where: { id: params.tutorId },
    include: { subjects: true },
  });
  if (!tutor) notFound();

  const allSubjects = await prisma.subject.findMany({ orderBy: { name: "asc" } });

  const [totalBookings, upcomingBookings] = user.isAdmin
    ? await Promise.all([
        prisma.session.count({ where: { tutorId: tutor.id } }),
        prisma.session.count({ where: { tutorId: tutor.id, status: "confirmed", startAt: { gt: new Date() } } }),
      ])
    : [0, 0];

  return (
    <ProfileManager
      tutorId={tutor.id}
      isAdmin={user.isAdmin}
      initialName={tutor.name}
      initialEmail={tutor.email}
      allSubjects={allSubjects}
      initialSubjectIds={tutor.subjects.map((s) => s.subjectId)}
      initialPhone={tutor.phone ?? ""}
      initialHourlyRateCents={tutor.hourlyRateCents}
      initialOnlineAvailable={tutor.onlineAvailable}
      initialInPersonAvailable={tutor.inPersonAvailable}
      initialTimeZone={tutor.timeZone}
      extraPanel={
        user.isAdmin ? (
          <RemoveTutor
            tutorId={tutor.id}
            tutorName={tutor.name}
            totalBookings={totalBookings}
            upcomingBookings={upcomingBookings}
          />
        ) : undefined
      }
    />
  );
}
