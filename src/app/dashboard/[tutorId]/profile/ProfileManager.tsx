"use client";

import { useState } from "react";

interface Subject {
  id: string;
  name: string;
}

export default function ProfileManager({
  tutorId,
  allSubjects,
  initialSubjectIds,
  initialPhone,
  initialHourlyRateCents,
  initialOnlineAvailable,
  initialInPersonAvailable,
}: {
  tutorId: string;
  allSubjects: Subject[];
  initialSubjectIds: string[];
  initialPhone: string;
  initialHourlyRateCents: number;
  initialOnlineAvailable: boolean;
  initialInPersonAvailable: boolean;
}) {
  const [subjectIds, setSubjectIds] = useState(new Set(initialSubjectIds));
  const [phone, setPhone] = useState(initialPhone);
  const [rateDollars, setRateDollars] = useState((initialHourlyRateCents / 100).toFixed(2));
  const [online, setOnline] = useState(initialOnlineAvailable);
  const [inPerson, setInPerson] = useState(initialInPersonAvailable);
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
          phone: phone || null,
          hourlyRateCents: rateCents,
          onlineAvailable: online,
          inPersonAvailable: inPerson,
          subjectIds: Array.from(subjectIds),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save");
      setSavedAt(Date.now());
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
      </div>

      <button onClick={save} disabled={saving}>
        {saving ? "Saving..." : "Save Profile"}
      </button>
    </div>
  );
}
