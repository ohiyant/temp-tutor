"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import TimeZoneSelect from "@/components/TimeZoneSelect";

interface Subject {
  id: string;
  name: string;
}

export default function ProfileManager({
  tutorId,
  isAdmin,
  initialName,
  initialEmail,
  allSubjects,
  initialSubjectIds,
  initialPhone,
  initialHourlyRateCents,
  initialOnlineAvailable,
  initialInPersonAvailable,
  initialTimeZone,
  extraPanel,
}: {
  tutorId: string;
  /** Admins can also change the tutor's name and sign-in email. */
  isAdmin: boolean;
  initialName: string;
  initialEmail: string;
  allSubjects: Subject[];
  initialSubjectIds: string[];
  initialPhone: string;
  initialHourlyRateCents: number;
  initialOnlineAvailable: boolean;
  initialInPersonAvailable: boolean;
  initialTimeZone: string;
  /** Another panel to lay out in the same grid (the admin's Remove tutor). */
  extraPanel?: ReactNode;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [subjectIds, setSubjectIds] = useState(new Set(initialSubjectIds));
  const [phone, setPhone] = useState(initialPhone);
  const [rateDollars, setRateDollars] = useState((initialHourlyRateCents / 100).toFixed(2));
  const [online, setOnline] = useState(initialOnlineAvailable);
  const [inPerson, setInPerson] = useState(initialInPersonAvailable);
  const [timeZone, setTimeZone] = useState(initialTimeZone);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function toggleSubject(id: string) {
    setSubjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setError(null);

    const rateCents = Math.round(parseFloat(rateDollars) * 100);
    if (Number.isNaN(rateCents) || rateCents <= 0) {
      setError("Enter a valid hourly rate greater than 0.");
      return;
    }
    if (!online && !inPerson) {
      setError("Select at least one of Online or In-person.");
      return;
    }
    if (isAdmin && (!name.trim() || !/^\S+@\S+\.\S+$/.test(email.trim()))) {
      setError("Enter a name and a valid email.");
      return;
    }
    if (subjectIds.size === 0) {
      setError("Select at least one subject.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/tutors/${tutorId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(isAdmin ? { name: name.trim(), email: email.trim() } : {}),
          phone: phone || null,
          timeZone,
          hourlyRateCents: rateCents,
          onlineAvailable: online,
          inPersonAvailable: inPerson,
          subjectIds: Array.from(subjectIds),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save");
      setSavedAt(Date.now());
      router.refresh(); // pick up a new name/email in the page heading
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel-page">
      <div className="panel-grid">
        <section className="card panel">
          <h2>Rate & sessions</h2>
          <div className="form-field" style={{ marginBottom: "0.9rem" }}>
            <label htmlFor="tutor-rate">Hourly rate ($)</label>
            <input
              id="tutor-rate"
              type="number"
              min={0}
              step="0.01"
              value={rateDollars}
              onChange={(e) => setRateDollars(e.target.value)}
              style={{ width: "8rem" }}
            />
          </div>
          <div className="form-field">
            <label>Session types</label>
            <label className="checkbox-row">
              <input type="checkbox" checked={online} onChange={(e) => setOnline(e.target.checked)} /> Online
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={inPerson} onChange={(e) => setInPerson(e.target.checked)} /> In-person
            </label>
          </div>
        </section>

        <section className="card panel">
          <h2>Subjects</h2>
          <p className="muted small">Students see you when they pick one of these.</p>
          <div className="subject-chips">
            {allSubjects.map((s) => (
              <label key={s.id} className={`subject-chip${subjectIds.has(s.id) ? " is-on" : ""}`}>
                <input type="checkbox" checked={subjectIds.has(s.id)} onChange={() => toggleSubject(s.id)} />
                {s.name}
              </label>
            ))}
          </div>
        </section>

        <section className="card panel">
          <h2>Contact & timezone</h2>
          {isAdmin && (
            <>
              <div className="form-field" style={{ marginBottom: "0.6rem" }}>
                <label htmlFor="tutor-name">Name</label>
                <input id="tutor-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="form-field" style={{ marginBottom: "0.6rem" }}>
                <label htmlFor="tutor-email">Sign-in email</label>
                <input id="tutor-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            </>
          )}
          <div className="form-field" style={{ marginBottom: "0.6rem" }}>
            <label htmlFor="tutor-phone">Phone</label>
            <input
              id="tutor-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="555-0100"
            />
          </div>
          <div className="form-field">
            <label htmlFor="tutor-tz">Timezone</label>
            <TimeZoneSelect id="tutor-tz" value={timeZone} onChange={setTimeZone} />
          </div>
          <p className="muted small" style={{ marginBottom: 0 }}>
            Your hours are in this timezone. Changing it keeps the same clock times (still 4pm–8pm) in the new zone;
            existing bookings keep their exact time.
          </p>
        </section>

        {extraPanel}
      </div>

      <div className="panel-save">
        <button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </button>
        {error && <span className="error-text">{error}</span>}
        {savedAt && !error && <span className="success-text">Saved.</span>}
      </div>
    </div>
  );
}
