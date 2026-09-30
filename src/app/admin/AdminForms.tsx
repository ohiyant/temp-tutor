"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CONFIG } from "@/config";
import TimeZoneSelect from "@/components/TimeZoneSelect";

/** Client-side forms for the admin pages (/admin/tutors, /admin/subjects, /admin/rate). */

export interface SubjectRow {
  id: string;
  name: string;
  tutorCount: number;
  sessionCount: number;
}

/** Returns null on success, otherwise an error message to show. */
async function send(url: string, method: string, body?: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return null;
    const data = await res.json().catch(() => null);
    return data?.error ?? "Something went wrong.";
  } catch {
    return "Couldn't reach the server. Try again.";
  }
}

export function AddTutorForm({
  subjects,
  onClose,
}: {
  subjects: { id: string; name: string }[];
  /** Called after a tutor is added, and by the Cancel button. */
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [online, setOnline] = useState(true);
  const [inPerson, setInPerson] = useState(false);
  const [timeZone, setTimeZone] = useState<string>(CONFIG.DEFAULT_TIMEZONE);
  const [subjectIds, setSubjectIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleSubject(id: string) {
    setSubjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const err = await send("/api/tutors", "POST", {
      name,
      email,
      phone: phone || null,
      onlineAvailable: online,
      inPersonAvailable: inPerson,
      subjectIds: Array.from(subjectIds),
      timeZone,
    });
    setSaving(false);
    if (err) {
      setError(err);
      return;
    }
    router.refresh();
    onClose();
  }

  return (
    <form className="card new-tutor-form" onSubmit={submit}>
      <h2>New tutor</h2>
      <p className="muted small">They sign in with this email. Set their availability from their page afterwards.</p>
      <div className="form-row">
        <div className="form-field">
          <label htmlFor="new-name">Name</label>
          <input id="new-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="new-email">Email</label>
          <input id="new-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="new-phone">Phone (optional)</label>
          <input id="new-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="new-tz">Timezone</label>
          <TimeZoneSelect id="new-tz" value={timeZone} onChange={setTimeZone} />
        </div>
      </div>
      <div className="form-row">
        <label className="checkbox-row">
          <input type="checkbox" checked={online} onChange={(e) => setOnline(e.target.checked)} /> Online
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={inPerson} onChange={(e) => setInPerson(e.target.checked)} /> In-person
        </label>
      </div>
      {subjects.length > 0 && (
        <fieldset className="subject-picks">
          <legend>Subjects</legend>
          {subjects.map((s) => (
            <label key={s.id} className="checkbox-row">
              <input type="checkbox" checked={subjectIds.has(s.id)} onChange={() => toggleSubject(s.id)} /> {s.name}
            </label>
          ))}
        </fieldset>
      )}
      {error && <p className="error-text">{error}</p>}
      <div className="form-row" style={{ marginBottom: 0 }}>
        <button type="submit" disabled={saving}>
          {saving ? "Adding…" : "Add tutor"}
        </button>
        <button type="button" className="secondary" disabled={saving} onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function SubjectsManager({ subjects }: { subjects: SubjectRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const err = await send("/api/subjects", "POST", { name });
    setBusy(false);
    if (err) return setError(err);
    setName("");
    router.refresh();
  }

  async function remove(id: string) {
    setError(null);
    setBusy(true);
    const err = await send(`/api/subjects?id=${encodeURIComponent(id)}`, "DELETE");
    setBusy(false);
    if (err) return setError(err);
    router.refresh();
  }

  return (
    <div className="card">
      {subjects.length === 0 && <p className="muted">No subjects yet. Add one below.</p>}
      {subjects.map((s) => (
        <div key={s.id} className="list-row">
          <span>
            {s.name}{" "}
            <span className="muted small">
              · {s.tutorCount} tutor{s.tutorCount === 1 ? "" : "s"} · {s.sessionCount} booking
              {s.sessionCount === 1 ? "" : "s"}
            </span>
          </span>
          <button
            className="danger"
            disabled={busy || s.sessionCount > 0}
            title={s.sessionCount > 0 ? "Subjects with bookings can't be deleted" : undefined}
            onClick={() => remove(s.id)}
          >
            Delete
          </button>
        </div>
      ))}
      <form className="form-row" onSubmit={add} style={{ marginTop: "1rem", marginBottom: 0 }}>
        <div className="form-field">
          <label htmlFor="new-subject">New subject</label>
          <input id="new-subject" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <button type="submit" disabled={busy}>
          Add subject
        </button>
      </form>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

/** The one hourly rate every tutor charges. */
export function RateForm({ initialHourlyRateCents }: { initialHourlyRateCents: number }) {
  const router = useRouter();
  const [rateDollars, setRateDollars] = useState((initialHourlyRateCents / 100).toFixed(2));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const hourlyRateCents = Math.round(parseFloat(rateDollars) * 100);
    if (!Number.isFinite(hourlyRateCents) || hourlyRateCents <= 0) {
      setError("Enter an hourly rate greater than 0.");
      return;
    }
    setSaving(true);
    const err = await send("/api/settings", "PATCH", { hourlyRateCents });
    setSaving(false);
    if (err) {
      setError(err);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <form className="card panel" onSubmit={submit}>
      <h2>Hourly rate</h2>
      <p className="muted small">
        The same for every tutor. Changing it only affects new bookings; existing ones keep the price they were booked
        at.
      </p>
      <div className="form-row" style={{ alignItems: "flex-end" }}>
        <div className="form-field">
          <label htmlFor="site-rate">Rate ($ per hour)</label>
          <input
            id="site-rate"
            type="number"
            min="1"
            step="0.01"
            required
            value={rateDollars}
            onChange={(e) => {
              setRateDollars(e.target.value);
              setSaved(false);
            }}
            style={{ width: "8rem" }}
          />
        </div>
        <button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {saved && <p className="muted small">Saved.</p>}
    </form>
  );
}
