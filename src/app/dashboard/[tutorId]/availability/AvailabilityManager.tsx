"use client";

import { useState } from "react";

interface AvailabilityBlock {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

// Shape as it arrives from the server component: Next.js preserves Date
// objects as real Date instances across the server/client boundary, it does
// NOT stringify them automatically.
interface AvailabilityExceptionFromServer {
  id: string;
  date: Date;
  startTime: string;
  endTime: string;
  isAvailable: boolean;
}

// Shape we actually work with in this component's state (date as a plain
// YYYY-MM-DD string, which is what the UI and the API both expect).
interface AvailabilityException {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  isAvailable: boolean;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "15:00" -> "3pm", "15:30" -> "3:30pm" */
function prettyTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "am" : "pm";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${String(m).padStart(2, "0")}${suffix}`;
}

/** "2026-10-05" -> "Mon, Oct 5" */
function prettyDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00.000Z`)
  );
}

export default function AvailabilityManager({
  tutorId,
  initialBlocks,
  initialExceptions,
  initialMinNoticeHours,
  initialMaxWindowHours,
  zoneName,
}: {
  tutorId: string;
  initialBlocks: AvailabilityBlock[];
  initialExceptions: AvailabilityExceptionFromServer[];
  initialMinNoticeHours: number;
  initialMaxWindowHours: number;
  /** e.g. "Central Time (CDT)" — the zone all these times are in. */
  zoneName: string;
}) {
  const [blocks, setBlocks] = useState(initialBlocks);
  const [exceptions, setExceptions] = useState<AvailabilityException[]>(
    initialExceptions.map((e) => ({ ...e, date: new Date(e.date).toISOString().slice(0, 10) }))
  );
  const [minNotice, setMinNotice] = useState(initialMinNoticeHours);
  const [maxWindow, setMaxWindow] = useState(initialMaxWindowHours);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rulesSaved, setRulesSaved] = useState(false);

  // --- Recurring block form state ---
  const [newDay, setNewDay] = useState(1);
  const [newStart, setNewStart] = useState("15:00");
  const [newEnd, setNewEnd] = useState("18:00");

  async function addBlock() {
    setError(null);
    if (newStart >= newEnd) {
      setError("Start time must be before end time.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/tutors/${tutorId}/availability`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dayOfWeek: newDay, startTime: newStart, endTime: newEnd }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to add block");
      const created = await res.json();
      setBlocks((prev) =>
        [...prev, created].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteBlock(id: string) {
    setBlocks((prev) => prev.filter((b) => b.id !== id)); // optimistic
    const res = await fetch(`/api/tutors/${tutorId}/availability?id=${id}`, { method: "DELETE" });
    if (!res.ok) setError("Failed to delete — refresh and try again.");
  }

  // --- Exception form state ---
  const [excDate, setExcDate] = useState("");
  const [excStart, setExcStart] = useState("09:00");
  const [excEnd, setExcEnd] = useState("12:00");
  const [excAvailable, setExcAvailable] = useState(false); // default: blackout

  async function addException() {
    setError(null);
    if (!excDate) {
      setError("Pick a date for the exception.");
      return;
    }
    if (excStart >= excEnd) {
      setError("Start time must be before end time.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/tutors/${tutorId}/exceptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: excDate, startTime: excStart, endTime: excEnd, isAvailable: excAvailable }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to add exception");
      const created = await res.json();
      setExceptions((prev) =>
        [...prev, { ...created, date: created.date.slice(0, 10) }].sort((a, b) => a.date.localeCompare(b.date))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteException(id: string) {
    setExceptions((prev) => prev.filter((e) => e.id !== id));
    const res = await fetch(`/api/tutors/${tutorId}/exceptions?id=${id}`, { method: "DELETE" });
    if (!res.ok) setError("Failed to delete — refresh and try again.");
  }

  // --- Notice / window settings ---
  async function saveNoticeWindow() {
    setError(null);
    setRulesSaved(false);
    setSaving(true);
    try {
      const res = await fetch(`/api/tutors/${tutorId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          minBookingNoticeHours: minNotice,
          maxBookingWindowHours: maxWindow,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save");
      setRulesSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel-page">
      {error && <p className="error-text">{error}</p>}
      <div className="panel-grid">
        <section className="card panel">
          <h2>Weekly hours</h2>
          <p className="muted small">The times you&apos;re available every week, in {zoneName}.</p>
          <div className="panel-list">
            {blocks.length === 0 && <p className="muted">No weekly hours yet, so students can&apos;t book you.</p>}
            {blocks.map((b) => (
              <div className="list-row" key={b.id}>
                <span>
                  <strong>{DAY_NAMES[b.dayOfWeek]}</strong> {prettyTime(b.startTime)}–{prettyTime(b.endTime)}
                </span>
                <button className="danger" onClick={() => deleteBlock(b.id)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
          <div className="form-row panel-add">
            <div className="form-field">
              <label htmlFor="block-day">Day</label>
              <select id="block-day" value={newDay} onChange={(e) => setNewDay(Number(e.target.value))}>
                {DAY_NAMES.map((name, i) => (
                  <option key={i} value={i}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="block-start">From</label>
              <input id="block-start" type="time" value={newStart} onChange={(e) => setNewStart(e.target.value)} />
            </div>
            <div className="form-field">
              <label htmlFor="block-end">To</label>
              <input id="block-end" type="time" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} />
            </div>
            <button onClick={addBlock} disabled={saving}>
              Add
            </button>
          </div>
        </section>

        <section className="card panel">
          <h2>One-off changes</h2>
          <p className="muted small">Block off a normally free time (a day off), or open extra time on one date.</p>
          <div className="panel-list">
            {exceptions.length === 0 && <p className="muted">None yet.</p>}
            {exceptions.map((e) => (
              <div className="list-row" key={e.id}>
                <span>
                  <strong>{prettyDate(e.date)}</strong> {prettyTime(e.startTime)}–{prettyTime(e.endTime)}{" "}
                  <span className={`exception-tag ${e.isAvailable ? "extra" : "blocked"}`}>
                    {e.isAvailable ? "Extra time" : "Blocked off"}
                  </span>
                </span>
                <button className="danger" onClick={() => deleteException(e.id)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
          <div className="form-row panel-add">
            <div className="form-field">
              <label htmlFor="exc-date">Date</label>
              <input id="exc-date" type="date" value={excDate} onChange={(e) => setExcDate(e.target.value)} />
            </div>
            <div className="form-field">
              <label htmlFor="exc-start">From</label>
              <input id="exc-start" type="time" value={excStart} onChange={(e) => setExcStart(e.target.value)} />
            </div>
            <div className="form-field">
              <label htmlFor="exc-end">To</label>
              <input id="exc-end" type="time" value={excEnd} onChange={(e) => setExcEnd(e.target.value)} />
            </div>
            <div className="form-field">
              <label htmlFor="exc-type">Type</label>
              <select
                id="exc-type"
                value={excAvailable ? "extra" : "blackout"}
                onChange={(e) => setExcAvailable(e.target.value === "extra")}
              >
                <option value="blackout">Blocked off</option>
                <option value="extra">Extra time</option>
              </select>
            </div>
            <button onClick={addException} disabled={saving}>
              Add
            </button>
          </div>
        </section>

        <section className="card panel">
          <h2>Booking rules</h2>
          <p className="muted small">How soon and how far ahead students can book you.</p>
          <div className="form-row">
            <div className="form-field">
              <label htmlFor="min-notice">Minimum notice (hours)</label>
              <input
                id="min-notice"
                type="number"
                min={0}
                value={minNotice}
                onChange={(e) => setMinNotice(Number(e.target.value))}
                style={{ width: "7rem" }}
              />
            </div>
            <div className="form-field">
              <label htmlFor="max-window">Book up to (days ahead)</label>
              <input
                id="max-window"
                type="number"
                min={1}
                value={Math.round(maxWindow / 24)}
                onChange={(e) => setMaxWindow(Math.max(1, Number(e.target.value)) * 24)}
                style={{ width: "7rem" }}
              />
            </div>
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <button onClick={saveNoticeWindow} disabled={saving}>
              Save
            </button>
            {rulesSaved && <span className="success-text">Saved.</span>}
          </div>
        </section>
      </div>
    </div>
  );
}
