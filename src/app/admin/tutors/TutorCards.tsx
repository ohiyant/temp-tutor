"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AddTutorForm } from "../AdminForms";
import RemoveTutorDialog from "./RemoveTutorDialog";

export interface TutorCardData {
  id: string;
  name: string;
  email: string;
  color: string;
  modes: string;
  subjects: string[];
  weekly: string[];
  timeZone: string;
  upcoming: number;
  /** All their bookings, past and upcoming (removing the tutor deletes them). */
  totalBookings: number;
  /** False for the signed-in admin's own card. */
  removable: boolean;
}

/**
 * Tutors as a wrapping grid of cards (as many per row as fit), with a
 * "+ New tutor" card first that opens the add form in a dialog. Each card
 * links to the tutor's page and has a Remove button that opens a confirm dialog.
 */
export default function TutorCards({
  tutors,
  subjects,
}: {
  tutors: TutorCardData[];
  subjects: { id: string; name: string }[];
}) {
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<TutorCardData | null>(null);
  const dialogOpen = adding || removing !== null;

  function closeDialogs() {
    setAdding(false);
    setRemoving(null);
  }

  useEffect(() => {
    if (!dialogOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeDialogs();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialogOpen]);

  return (
    <>
      <div className="tutor-card-grid">
        <button type="button" className="tutor-card new-tutor-card" onClick={() => setAdding(true)}>
          <span className="new-tutor-plus" aria-hidden>
            +
          </span>
          <span>New tutor</span>
        </button>

        {tutors.map((t) => (
          <div key={t.id} className="tutor-card" style={{ borderTopColor: t.color }}>
            <Link href={`/dashboard/${t.id}`} className="tutor-card-main">
              <div className="tutor-card-head">
                <span className="tutor-card-name">{t.name}</span>
              </div>
              <span className="tutor-card-email">{t.email}</span>
              <dl className="tutor-card-facts">
                <dt>Subjects</dt>
                <dd>{t.subjects.length ? t.subjects.join(", ") : <span className="muted">None yet</span>}</dd>
                <dt>Sessions</dt>
                <dd>{t.modes || <span className="muted">None offered</span>}</dd>
                <dt>Hours</dt>
                <dd>
                  {t.weekly.length ? t.weekly.join(" · ") : <span className="muted">Not set, so not bookable</span>}
                </dd>
                <dt>Timezone</dt>
                <dd>{t.timeZone}</dd>
              </dl>
              <span className="tutor-card-foot">
                {t.upcoming === 0
                  ? "No upcoming bookings"
                  : `${t.upcoming} upcoming booking${t.upcoming === 1 ? "" : "s"}`}
                <span aria-hidden> →</span>
              </span>
            </Link>
            {t.removable && (
              <button type="button" className="tutor-card-remove" onClick={() => setRemoving(t)}>
                Remove tutor…
              </button>
            )}
          </div>
        ))}
      </div>

      {dialogOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeDialogs()}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={removing ? `Remove ${removing.name}` : "New tutor"}
          >
            {removing ? (
              <RemoveTutorDialog
                tutorId={removing.id}
                tutorName={removing.name}
                totalBookings={removing.totalBookings}
                upcomingBookings={removing.upcoming}
                onClose={closeDialogs}
              />
            ) : (
              <AddTutorForm subjects={subjects} onClose={closeDialogs} />
            )}
          </div>
        </div>
      )}
    </>
  );
}
