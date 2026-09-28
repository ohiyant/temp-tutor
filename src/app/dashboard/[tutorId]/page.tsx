import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function TutorDashboardPage({
  params,
}: {
  params: { tutorId: string };
}) {
  const tutor = await prisma.tutor.findUnique({
    where: { id: params.tutorId },
    include: { subjects: { include: { subject: true } } },
  });

  if (!tutor) notFound();

  return (
    <div className="container">
      <h1>{tutor.name}</h1>
      <p>
        {tutor.email} · ${(tutor.hourlyRateCents / 100).toFixed(2)}/hr ·{" "}
        {tutor.subjects.map((s) => s.subject.name).join(", ") || "No subjects yet"}
      </p>
      <nav className="dashboard-nav">
        <Link href={`/dashboard/${tutor.id}/availability`}>Manage Availability</Link>
        <Link href={`/dashboard/${tutor.id}/profile`}>Edit Profile</Link>
      </nav>
    </div>
  );
}
