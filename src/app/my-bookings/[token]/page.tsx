import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/auth";
import { canReschedule } from "@/lib/policy";
import { cancelPath, reschedulePath } from "@/lib/manageLinks";
import { formatDateTime, isValidTimeZone } from "@/lib/timezone";
import { ManageShell } from "@/components/ManageSession";

export const metadata = { title: "My bookings" };

const STATUS_LABELS: Record<string, string> = {
  completed: "Completed",
  no_show: "Missed",
  cancelled: "Cancelled",
  confirmed: "Booked",
};

/**
 * Everything booked with one email address, opened from the link emailed by
 * /my-bookings. Upcoming sessions get Reschedule and Cancel.
 */
export default async function MyBookingsListPage(props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  const lookup = await prisma.bookingLookupToken.findUnique({ where: { tokenHash: hashToken(params.token) } });
  if (!lookup || lookup.expiresAt <= new Date()) {
    return (
      <ManageShell title="Link expired">
        <p>This link has expired or isn&apos;t valid.</p>
        <p>
          <Link href="/my-bookings">Get a new link →</Link>
        </p>
      </ManageShell>
    );
  }

  const sessions = await prisma.session.findMany({
    where: {
      studentEmail: { equals: lookup.email, mode: "insensitive" },
      // A rescheduled row's replacement is listed instead.
      status: { in: ["confirmed", "completed", "no_show", "cancelled"] },
    },
    include: { tutor: true, subject: true },
    orderBy: { startAt: "asc" },
  });

  const now = new Date();
  const upcoming = sessions.filter((s) => s.status === "confirmed" && s.endAt > now);
  const past = sessions.filter((s) => !upcoming.includes(s)).reverse(); // most recent first

  const when = (s: (typeof sessions)[number]) =>
    formatDateTime(s.startAt, isValidTimeZone(s.timezone) ? s.timezone : s.tutor.timeZone);

  return (
    <div className="container manage-container">
      <div className="card manage-card">
        <h1>My bookings</h1>
        <p className="muted small">
          Sessions booked with <strong>{lookup.email}</strong>. <Link href="/book">Book another session →</Link>
        </p>

        <h2 className="my-bookings-heading">Upcoming</h2>
        {upcoming.length === 0 && <p className="muted">No upcoming sessions.</p>}
        {upcoming.map((s) => (
          <div key={s.id} className="list-row my-booking-row">
            <span>
              <strong>{when(s)}</strong>
              <span className="muted small">
                {" "}
                · {s.durationMin} min · {s.subject.name} with {s.tutor.name} ·{" "}
                {s.mode === "online" ? "Online" : "In-person"}
              </span>
            </span>
            <span className="my-booking-actions">
              {canReschedule(s.startAt, now) && <Link href={reschedulePath(s.rescheduleToken)}>Reschedule</Link>}
              {s.startAt > now && <Link href={cancelPath(s.cancellationToken)}>Cancel</Link>}
            </span>
          </div>
        ))}

        {past.length > 0 && (
          <>
            <h2 className="my-bookings-heading">Past &amp; cancelled</h2>
            {past.map((s) => (
              <div key={s.id} className="list-row my-booking-row">
                <span>
                  {when(s)}
                  <span className="muted small">
                    {" "}
                    · {s.durationMin} min · {s.subject.name} with {s.tutor.name}
                  </span>
                </span>
                <span className={`booking-status-tag status-${s.status}`}>
                  {s.status === "confirmed" ? "Past" : STATUS_LABELS[s.status] ?? s.status}
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
