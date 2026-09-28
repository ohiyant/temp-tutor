import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import AvailabilityManager from "./AvailabilityManager";

export default async function AvailabilityPage({
  params,
}: {
  params: { tutorId: string };
}) {
  const tutor = await prisma.tutor.findUnique({ where: { id: params.tutorId } });
  if (!tutor) notFound();

  const blocks = await prisma.availabilityBlock.findMany({
    where: { tutorId: tutor.id },
    orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
  });

  const exceptions = await prisma.availabilityException.findMany({
    where: { tutorId: tutor.id },
    orderBy: { date: "asc" },
  });

  return (
    <div className="container">
      <h1>{tutor.name} — Availability</h1>
      <AvailabilityManager
        tutorId={tutor.id}
        initialBlocks={blocks}
        initialExceptions={exceptions}
        initialMinNoticeHours={tutor.minBookingNoticeHours}
        initialMaxWindowHours={tutor.maxBookingWindowHours}
      />
    </div>
  );
}
