import { prisma } from "@/lib/prisma";
import { requireTutorPage } from "@/lib/auth";
import { notFound } from "next/navigation";
import AvailabilityManager from "./AvailabilityManager";
import Link from "next/link";
import { zoneLabel } from "@/lib/calendarUi";

export default async function AvailabilityPage({
  params,
}: {
  params: { tutorId: string };
}) {
  await requireTutorPage(params.tutorId);

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
      <p className="back-link">
        <Link href={`/dashboard/${tutor.id}`}>← Back to schedule</Link>
      </p>
      <h1>{tutor.name} — Availability</h1>
      <p className="muted small">
        All times on this page are in {zoneLabel(tutor.timeZone)}. You can change your timezone on your{" "}
        <Link href={`/dashboard/${tutor.id}/profile`}>profile</Link>.
      </p>
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
