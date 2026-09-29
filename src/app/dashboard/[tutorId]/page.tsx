import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireTutorPage } from "@/lib/auth";
import { colorForTutor } from "@/lib/tutorColor";
import TutorSchedule from "@/components/TutorSchedule";

/** Schedule tab: the tutor's week calendar. */
export default async function TutorSchedulePage({ params }: { params: { tutorId: string } }) {
  await requireTutorPage(params.tutorId);
  const tutor = await prisma.tutor.findUnique({ where: { id: params.tutorId }, select: { id: true, timeZone: true } });
  if (!tutor) notFound();

  // Only the tutor themselves or an admin can see this page, and both may cancel.
  return <TutorSchedule tutorId={tutor.id} timeZone={tutor.timeZone} color={colorForTutor(tutor.id)} canCancel />;
}
