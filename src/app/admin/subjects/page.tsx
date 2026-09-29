import { prisma } from "@/lib/prisma";
import { requireAdminPage } from "@/lib/auth";
import { SubjectsManager } from "../AdminForms";

export const metadata = { title: "Subjects · Admin · TutorSpot" };

export default async function AdminSubjectsPage() {
  await requireAdminPage();
  const subjects = await prisma.subject.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { tutors: true, sessions: true } } },
  });
  return (
    <div className="admin-narrow">
      <SubjectsManager
        subjects={subjects.map((s) => ({
          id: s.id,
          name: s.name,
          tutorCount: s._count.tutors,
          sessionCount: s._count.sessions,
        }))}
      />
    </div>
  );
}
