import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { CONFIG } from "@/config";
import { cancellationRefundPct, canReschedule } from "@/lib/policy";
import { reschedulePath } from "@/lib/manageLinks";
import { formatDateTime, isValidTimeZone } from "@/lib/timezone";
import { ManageShell, SessionSummary } from "@/components/ManageSession";
import CancelForm from "./CancelForm";

export const metadata = { title: "Cancel a session" };

/** Public page behind the cancel link in a student's confirmation email. */
export default async function CancelPage({ params }: { params: { token: string } }) {
  const session = await prisma.session.findUnique({
    where: { cancellationToken: params.token },
    include: { tutor: true, subject: true },
  });

  if (!session) {
    return (
      <ManageShell title="Link not found">
        <p>This cancel link isn&apos;t valid. Check you copied the whole link from your email.</p>
      </ManageShell>
    );
  }

  const zone = isValidTimeZone(session.timezone) ? session.timezone : session.tutor.timeZone;
  const when = formatDateTime(session.startAt, zone);
  const now = new Date();

  if (session.status !== "confirmed") {
    return (
      <ManageShell title={`${session.subject.name} with ${session.tutor.name}`}>
        <p>
          {session.status === "cancelled"
            ? `This session (${when}) has already been cancelled.`
            : session.status === "rescheduled"
            ? `This session was moved to another time. Use the links in your most recent email to manage it.`
            : `This session (${when}) can't be cancelled any more.`}
        </p>
        <p>
          <Link href="/book">Book another session →</Link>
        </p>
      </ManageShell>
    );
  }

  if (session.startAt <= now) {
    return (
      <ManageShell title={`${session.subject.name} with ${session.tutor.name}`}>
        <p>This session ({when}) has already started, so it can&apos;t be cancelled.</p>
      </ManageShell>
    );
  }

  const refundPct = cancellationRefundPct(session.startAt, now);
  return (
    <ManageShell title="Cancel your session">
      <SessionSummary
        subject={session.subject.name}
        tutor={session.tutor.name}
        when={when}
        durationMin={session.durationMin}
        mode={session.mode}
      />
      <p className="manage-policy">
        {refundPct > 0
          ? `You're cancelling more than ${CONFIG.CANCEL_NOTICE_THRESHOLD_HOURS} hours ahead, so ${Math.round(
              refundPct * 100
            )}% of the price is refundable.`
          : `You're cancelling ${CONFIG.CANCEL_NOTICE_THRESHOLD_HOURS} hours or less before the session, so it isn't refundable.`}{" "}
        Online payment isn&apos;t set up yet, so you haven&apos;t been charged.
      </p>
      {canReschedule(session.startAt, now) && (
        <p className="muted small">
          Would another time work instead? <Link href={reschedulePath(session.rescheduleToken)}>Reschedule it</Link>.
        </p>
      )}
      <CancelForm token={session.cancellationToken} />
    </ManageShell>
  );
}
