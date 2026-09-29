"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AddTutorForm } from "../AdminForms";

export interface TutorCardData {
  id: string;
  name: string;
  email: string;
  color: string;
  rate: string;
  modes: string;
  subjects: string[];
  weekly: string[];
  timeZone: string;
  upcoming: number;
}

/**
 * Tutors as a wrapping grid of cards (as many per row as fit), with a
 * "+ New tutor" card first that opens the add form in a dialog.
 */
export default function TutorCards({
  tutors,
  subjects,
}: {
  tutors: TutorCardData[];
  subjects: { id: string; name: string }[];
}) {
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!adding) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setAdding(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [adding]);

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
          <Link key={t.id} href={`/dashboard/${t.id}`} className="tutor-card" style={{ borderTopColor: t.color }}>
            <div className="tutor-card-head">
              <span className="tutor-card-name">{t.name}</span>
              <span className="tutor-card-rate">{t.rate}</span>
            </div>
            <span className="tutor-card-email">{t.email}</span>
            <dl className="tutor-card-facts">
              <dt>Subjects</dt>
              <dd>{t.subjects.length ? t.subjects.join(", ") : <span className="muted">None yet</span>}</dd>
              <dt>Sessions</dt>
              <dd>{t.modes || <span className="muted">None offered</span>}</dd>
              <dt>Hours</dt>
              <dd>{t.weekly.length ? t.weekly.join(" · ") : <span className="muted">Not set, so not bookable</span>}</dd>
              <dt>Timezone</dt>
              <dd>{t.timeZone}</dd>
            </dl>
            <span className="tutor-card-foot">
              {t.upcoming === 0 ? "No upcoming bookings" : `${t.upcoming} upcoming booking${t.upcoming === 1 ? "" : "s"}`}
              <span aria-hidden> →</span>
            </span>
          </Link>
        ))}
      </div>

      {adding && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setAdding(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="New tutor">
            <AddTutorForm subjects={subjects} onClose={() => setAdding(false)} />
          </div>
        </div>
      )}
    </>
  );
}
