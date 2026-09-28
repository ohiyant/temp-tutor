import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import ProfileManager from "./ProfileManager";

export default async function ProfilePage({
  params,
}: {
  params: { tutorId: string };
}) {
  const tutor = await prisma.tutor.findUnique({
    where: { id: params.tutorId },
    include: { subjects: true },
  });
  if (!tutor) notFound();

  const allSubjects = await prisma.subject.findMany({ orderBy: { name: "asc" } });

  return (
    <div className="container">
      <h1>{tutor.name} — Profile</h1>
      <ProfileManager
        tutorId={tutor.id}
        allSubjects={allSubjects}
        initialSubjectIds={tutor.subjects.map((s) => s.subjectId)}
        initialPhone={tutor.phone ?? ""}
        initialHourlyRateCents={tutor.hourlyRateCents}
        initialOnlineAvailable={tutor.onlineAvailable}
        initialInPersonAvailable={tutor.inPersonAvailable}
      />
    </div>
  );
}
