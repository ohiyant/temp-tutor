import { prisma } from "@/lib/prisma";
import { requireAdminPage } from "@/lib/auth";
import { colorForTutor } from "@/lib/tutorColor";
import AdminSchedule from "./AdminSchedule";

export const metadata = { title: "Bookings · Admin · TutorSpot" };

export default async function AdminBookingsPage() {
  await requireAdminPage();
  const tutors = await prisma.tutor.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  return <AdminSchedule tutors={tutors.map((t) => ({ ...t, color: colorForTutor(t.id) }))} />;
}
