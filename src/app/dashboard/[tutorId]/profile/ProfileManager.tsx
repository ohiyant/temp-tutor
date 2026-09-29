"use client";

import { useState } from "react";
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
    <div className="card">
      {error && <p className="error-text">{error}</p>}
      {savedAt && !error && <p style={{ color: "#16a34a", fontSize: "0.9rem" }}>Saved.</p>}

      {isAdmin && (
        <div className="form-row">
          <div className="form-field">
            <label htmlFor="tutor-name">Name</label>
            <input id="tutor-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="form-field">
            <label htmlFor="tutor-email">Sign-in email</label>
            <input id="tutor-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>
      )}

      <div className="form-field" style={{ marginBottom: "1rem" }}>
        <label>Subjects taught</label>
        {allSubjects.map((s) => (
          <div className="checkbox-row" key={s.id}>
            <input
              type="checkbox"
              id={`subject-${s.id}`}
              checked={subjectIds.has(s.id)}
              onChange={() => toggleSubject(s.id)}
            />
            <label htmlFor={`subject-${s.id}`}>{s.name}</label>
          </div>
        ))}
      </div>

      <div className="form-field" style={{ marginBottom: "1rem" }}>
        <label>Availability mode</label>
        <div className="checkbox-row">
          <input type="checkbox" id="online" checked={online} onChange={(e) => setOnline(e.target.checked)} />
          <label htmlFor="online">Online</label>
        </div>
        <div className="checkbox-row">
          <input type="checkbox" id="inPerson" checked={inPerson} onChange={(e) => setInPerson(e.target.checked)} />
          <label htmlFor="inPerson">In-person</label>
        </div>
      </div>

      <div className="form-row">
        <div className="form-field">
          <label>Hourly rate ($)</label>
          <input type="number" min={0} step="0.01" value={rateDollars} onChange={(e) => setRateDollars(e.target.value)} />
        </div>
        <div className="form-field">
          <label>Phone</label>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="555-0100" />
        </div>
        <div className="form-field">
          <label htmlFor="tutor-tz">Timezone</label>
          <TimeZoneSelect id="tutor-tz" value={timeZone} onChange={setTimeZone} />
        </div>
      </div>
      <p className="muted small" style={{ marginTop: "-0.5rem" }}>
        Weekly hours and one-off times are in this timezone. Changing it keeps the same clock times (e.g. still
        4pm–8pm) in the new zone; existing bookings keep their exact time.
      </p>

      <button onClick={save} disabled={saving}>
        {saving ? "Saving..." : "Save Profile"}
      </button>
    </div>
  );
}
