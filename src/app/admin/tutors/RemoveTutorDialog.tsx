"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Admin-only confirmation, opened from a tutor card: permanently deletes a tutor and all their bookings. */
export default function RemoveTutorDialog({
  tutorId,
  tutorName,
  totalBookings,
  upcomingBookings,
  onClose,
}: {
  tutorId: string;
  tutorName: string;
  totalBookings: number;
  upcomingBookings: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/tutors/${tutorId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? "Couldn't remove this tutor. Try again.");
        setDeleting(false);
        return;
      }
      onClose();
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Try again.");
      setDeleting(false);
    }
  }

  return (
    <section className="card panel danger-zone">
      <h2>Remove {tutorName}?</h2>
      <p className="small">
        Permanently deletes {tutorName}, their availability, and{" "}
        <strong>
          all {totalBookings} of their booking{totalBookings === 1 ? "" : "s"}
        </strong>
        , past and upcoming. They can no longer sign in. This can&apos;t be undone.
      </p>
      {upcomingBookings > 0 && (
        <p className="danger-warning">
          {upcomingBookings} upcoming session{upcomingBookings === 1 ? " is" : "s are"} still booked. Those students
          won&apos;t be emailed, so contact them first.
        </p>
      )}
      <div className="danger-confirm">
        <div className="form-field">
          <label htmlFor="confirm-name">
            Type <strong>{tutorName}</strong> to confirm
          </label>
          <input
            id="confirm-name"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoFocus
          />
        </div>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <button className="danger" disabled={typed.trim() !== tutorName || deleting} onClick={remove}>
            {deleting ? "Removing…" : "Permanently remove"}
          </button>
          <button className="secondary" disabled={deleting} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
      {error && <p className="error-text">{error}</p>}
    </section>
  );
}
