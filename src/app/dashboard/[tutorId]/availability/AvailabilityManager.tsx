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

export default function AvailabilityManager({
  tutorId,
  initialBlocks,
  initialExceptions,
  initialMinNoticeHours,
  initialMaxWindowHours,
}: {
  tutorId: string;
  initialBlocks: AvailabilityBlock[];
  initialExceptions: AvailabilityExceptionFromServer[];
  initialMinNoticeHours: number;
  initialMaxWindowHours: number;
}) {
  const [blocks, setBlocks] = useState(initialBlocks);
  const [exceptions, setExceptions] = useState<AvailabilityException[]>(
    initialExceptions.map((e) => ({ ...e, date: new Date(e.date).toISOString().slice(0, 10) }))
  );
  const [minNotice, setMinNotice] = useState(initialMinNoticeHours);
  const [maxWindow, setMaxWindow] = useState(initialMaxWindowHours);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {error && <p className="error-text">{error}</p>}

      <div className="card">
        <h2>Booking Notice & Window</h2>
        <div className="form-row">
          <div className="form-field">
            <label>Minimum notice (hours)</label>
            <input type="number" min={0} value={minNotice} onChange={(e) => setMinNotice(Number(e.target.value))} />
          </div>
          <div className="form-field">
            <label>Maximum booking window (hours)</label>
            <input type="number" min={1} value={maxWindow} onChange={(e) => setMaxWindow(Number(e.target.value))} />
          </div>
          <button onClick={saveNoticeWindow} disabled={saving}>
            Save
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Recurring Weekly Availability</h2>
        {blocks.length === 0 && <p>No recurring availability set yet.</p>}
        {blocks.map((b) => (
          <div className="list-row" key={b.id}>
            <span>
              {DAY_NAMES[b.dayOfWeek]}: {b.startTime}–{b.endTime}
            </span>
            <button className="danger" onClick={() => deleteBlock(b.id)}>
              Remove
            </button>
          </div>
        ))}
        <div className="form-row" style={{ marginTop: "1rem" }}>
          <div className="form-field">
            <label>Day</label>
            <select value={newDay} onChange={(e) => setNewDay(Number(e.target.value))}>
              {DAY_NAMES.map((name, i) => (
                <option key={i} value={i}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label>Start</label>
            <input type="time" value={newStart} onChange={(e) => setNewStart(e.target.value)} />
          </div>
          <div className="form-field">
            <label>End</label>
            <input type="time" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} />
          </div>
          <button onClick={addBlock} disabled={saving}>
            Add Block
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Date Exceptions</h2>
        <p style={{ fontSize: "0.85rem", color: "#555" }}>
          Use this to block out a normally-available time (e.g. a day off) or open up extra availability outside your
          usual schedule (e.g. a one-time Sunday session).
        </p>
        {exceptions.length === 0 && <p>No exceptions set yet.</p>}
        {exceptions.map((e) => (
          <div className="list-row" key={e.id}>
            <span>
              {e.date} {e.startTime}–{e.endTime} — {e.isAvailable ? "Extra availability" : "Blackout"}
            </span>
            <button className="danger" onClick={() => deleteException(e.id)}>
              Remove
            </button>
          </div>
        ))}
        <div className="form-row" style={{ marginTop: "1rem" }}>
          <div className="form-field">
            <label>Date</label>
            <input type="date" value={excDate} onChange={(e) => setExcDate(e.target.value)} />
          </div>
          <div className="form-field">
            <label>Start</label>
            <input type="time" value={excStart} onChange={(e) => setExcStart(e.target.value)} />
          </div>
          <div className="form-field">
            <label>End</label>
            <input type="time" value={excEnd} onChange={(e) => setExcEnd(e.target.value)} />
          </div>
          <div className="form-field">
            <label>Type</label>
            <select value={excAvailable ? "extra" : "blackout"} onChange={(e) => setExcAvailable(e.target.value === "extra")}>
              <option value="blackout">Blackout (unavailable)</option>
              <option value="extra">Extra availability</option>
            </select>
          </div>
          <button onClick={addException} disabled={saving}>
            Add Exception
          </button>
        </div>
      </div>
    </div>
  );
}
