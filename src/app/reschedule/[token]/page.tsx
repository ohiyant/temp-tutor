import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { CONFIG } from "@/config";
import { canReschedule, rescheduleFeeCents } from "@/lib/policy";
import { cancelPath } from "@/lib/manageLinks";
import { formatDateTime, isValidTimeZone } from "@/lib/timezone";
import { ManageShell, SessionSummary } from "@/components/ManageSession";
import RescheduleForm from "./RescheduleForm";

export const metadata = { title: "Reschedule a session · TutorSpot" };

/** Public page behind the reschedule link in a student's confirmation email. */
export default async function ReschedulePage({ params }: { params: { token: string } }) {
  const session = await prisma.session.findUnique({
    where: { rescheduleToken: params.token },
    include: { tutor: true, subject: true },
  });

  if (!session) {
    return (
      <ManageShell title="Link not found">
        <p>This reschedule link isn&apos;t valid. Check you copied the whole link from your email.</p>
      </ManageShell>
    );
  }

  const zone = isValidTimeZone(session.timezone) ? session.timezone : session.tutor.timeZone;
  const when = formatDateTime(session.startAt, zone);
  const title = `${session.subject.name} with ${session.tutor.name}`;

  if (session.status !== "confirmed") {
    return (
      <ManageShell title={title}>
        <p>
          {session.status === "cancelled"
            ? `This session (${when}) was cancelled, so it can't be rescheduled.`
            : session.status === "rescheduled"
            ? "This session was already moved. Use the links in your most recent email to change it again."
            : `This session (${when}) can't be rescheduled.`}
        </p>
        <p>
          <Link href="/book">Book a new session →</Link>
        </p>
      </ManageShell>
    );
  }

  if (!canReschedule(session.startAt, new Date())) {
    return (
      <ManageShell title={title}>
        <p>
          Your session is {when}. Sessions can only be rescheduled more than {CONFIG.RESCHEDULE_MIN_NOTICE_HOURS} hours
          before they start, so it&apos;s too late to move this one.
        </p>
        {session.startAt > new Date() && (
          <p>
            You can still <Link href={cancelPath(session.cancellationToken)}>cancel it</Link>.
          </p>
        )}
      </ManageShell>
    );
  }

  const fee = (rescheduleFeeCents(session.priceCents) / 100).toFixed(2);
  return (
    <ManageShell title="Reschedule your session">
      <SessionSummary
        subject={session.subject.name}
        tutor={session.tutor.name}
        when={when}
        durationMin={session.durationMin}
        mode={session.mode}
      />
      <p className="manage-policy">
        Pick a new time with {session.tutor.name} below. Rescheduling has a {Math.round(CONFIG.RESCHEDULE_FEE_PCT * 100)}%
        fee (${fee}), but online payment isn&apos;t set up yet, so you won&apos;t be charged.
      </p>
      <RescheduleForm
        token={session.rescheduleToken}
        initialTimeZone={zone}
        durationMin={session.durationMin}
        currentStartAt={session.startAt.toISOString()}
      />
      <p className="muted small" style={{ marginTop: "1.25rem", marginBottom: 0 }}>
        Can&apos;t make any time? <Link href={cancelPath(session.cancellationToken)}>Cancel instead</Link>.
      </p>
    </ManageShell>
  );
}
