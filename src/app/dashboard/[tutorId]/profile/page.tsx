import { getHourlyRateCents } from "@/lib/settings";
import { prisma } from "@/lib/prisma";
import { requireTutorPage } from "@/lib/auth";
import { notFound } from "next/navigation";
import ProfileManager from "./ProfileManager";
import { colorForTutor } from "@/lib/tutorColor";

/** Profile tab: public profile, session types, subjects, contact and timezone. */
export default async function ProfilePage(
  props: {
    params: Promise<{ tutorId: string }>;
  }
) {
  const params = await props.params;
  const user = await requireTutorPage(params.tutorId);

  const tutor = await prisma.tutor.findUnique({
    where: { id: params.tutorId },
    include: { subjects: true },
  });
  if (!tutor) notFound();

  const allSubjects = await prisma.subject.findMany({ orderBy: { name: "asc" } });

  return (
    <ProfileManager
      tutorId={tutor.id}
      isAdmin={user.isAdmin}
      initialName={tutor.name}
      initialEmail={tutor.email}
      allSubjects={allSubjects}
      initialSubjectIds={tutor.subjects.map((s) => s.subjectId)}
      initialPhone={tutor.phone ?? ""}
      hourlyRateCents={await getHourlyRateCents()}
      initialOnlineAvailable={tutor.onlineAvailable}
      initialInPersonAvailable={tutor.inPersonAvailable}
      initialTimeZone={tutor.timeZone}
      initialPhoto={tutor.photo}
      initialSchool={tutor.school ?? ""}
      initialBio={tutor.bio ?? ""}
      initialInPersonLocation={tutor.inPersonLocation ?? ""}
      initialMeetingLink={tutor.meetingLink ?? ""}
      color={colorForTutor(tutor.id)}
    />
  );
}
