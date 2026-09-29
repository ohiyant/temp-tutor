import type { ReactNode } from "react";

/** Card layout shared by the public cancel and reschedule pages. */
export function ManageShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="container manage-container">
      <div className="card manage-card">
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

export function SessionSummary({
  subject,
  tutor,
  when,
  durationMin,
  mode,
}: {
  subject: string;
  tutor: string;
  when: string;
  durationMin: number;
  mode: "online" | "in_person";
}) {
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
      <dt>Mode</dt>
      <dd>{mode === "online" ? "Online" : "In-person"}</dd>
    </dl>
  );
}
