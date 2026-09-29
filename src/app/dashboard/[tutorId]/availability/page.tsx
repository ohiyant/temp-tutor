import { prisma } from "@/lib/prisma";
import { requireTutorPage } from "@/lib/auth";
import { notFound } from "next/navigation";
import AvailabilityManager from "./AvailabilityManager";
import { zoneLabel } from "@/lib/calendarUi";

/** Availability tab: weekly hours, one-off changes and booking rules. */
export default async function AvailabilityPage({ params }: { params: { tutorId: string } }) {
  await requireTutorPage(params.tutorId);

  const tutor = await prisma.tutor.findUnique({ where: { id: params.tutorId } });
  if (!tutor) notFound();

  const [blocks, exceptions] = await Promise.all([
    prisma.availabilityBlock.findMany({
      where: { tutorId: tutor.id },
      orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
    }),
    // Past one-off changes no longer matter, so leave them out.
    prisma.availabilityException.findMany({
      where: { tutorId: tutor.id, date: { gte: new Date(new Date().toISOString().slice(0, 10)) } },
      orderBy: { date: "asc" },
    }),
  ]);

  return (
    <AvailabilityManager
      tutorId={tutor.id}
      initialBlocks={blocks}
      initialExceptions={exceptions}
      initialMinNoticeHours={tutor.minBookingNoticeHours}
      initialMaxWindowHours={tutor.maxBookingWindowHours}
      zoneName={zoneLabel(tutor.timeZone)}
    />
  );
}
