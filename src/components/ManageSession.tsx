import type { ReactNode } from "react";
import { sessionPlace, type TutorPlaceInfo } from "@/lib/sessionPlace";

/** "Join online: <link>" / "Where: <place>", plus how to reach the tutor. */
export function SessionPlaceInfo({
  mode,
  tutor,
  location,
}: {
  mode: "online" | "in_person";
  tutor: TutorPlaceInfo & { name: string; email: string };
  /** The session's meeting place, chosen by the student. */
  location?: string | null;
}) {
  const place = sessionPlace(mode, tutor, location);
  return (
    <span className="session-place small">
      {place.label}:{" "}
      {place.href ? (
        <a href={place.href} target="_blank" rel="noopener noreferrer">
          {place.text}
        </a>
      ) : (
        place.text
      )}
      <span className="session-contact">
        Questions? Email {tutor.name} at <a href={`mailto:${tutor.email}`}>{tutor.email}</a>
      </span>
    </span>
  );
}

/** Card layout shared by the public cancel and reschedule pages. */
export function ManageShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="container manage-container">
      <div className="card manage-card">
        <h1>{title}</h1>
        {children}
      </div>
      <p className="manage-policies-link">
        <a href="/policies">Cancellation and rescheduling policies</a>
      </p>
    </div>
  );
}

export function SessionSummary({
  subject,
  tutor,
  tutorInfo,
  location,
  when,
  durationMin,
  mode,
}: {
  subject: string;
  tutor: string;
  /** For where the session happens and how to contact the tutor. */
  tutorInfo: TutorPlaceInfo & { name: string; email: string };
  /** The session's meeting place, chosen by the student. */
  location?: string | null;
  when: string;
  durationMin: number;
  mode: "online" | "in_person";
}) {
  const place = sessionPlace(mode, tutorInfo, location);
  return (
    <dl className="details-list manage-summary">
      <dt>Session</dt>
      <dd>
        {subject} with {tutor}
      </dd>
      <dt>When</dt>
      <dd>
        {when} ({durationMin} min)
      </dd>
      <dt>{place.label}</dt>
      <dd>
        {place.href ? (
          <a href={place.href} target="_blank" rel="noopener noreferrer">
            {place.text}
          </a>
        ) : (
          place.text
        )}
      </dd>
      <dt>Questions?</dt>
      <dd>
        Email {tutorInfo.name} at <a href={`mailto:${tutorInfo.email}`}>{tutorInfo.email}</a>
      </dd>
    </dl>
  );
}
