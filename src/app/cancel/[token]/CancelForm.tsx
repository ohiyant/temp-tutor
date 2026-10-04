"use client";

import { useState } from "react";

export default function CancelForm({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [refundedCents, setRefundedCents] = useState(0);

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/manage/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "Couldn't cancel. Try again.");
        return;
      }
      setRefundedCents(body?.refundedCents ?? 0);
      setDone(true);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="manage-done">
        <p>
          <strong>Your session is cancelled.</strong> We&apos;ve let your tutor know.
          {refundedCents > 0 &&
            ` $${(refundedCents / 100).toFixed(2)} is on its way back to your card (5–10 business days).`}
        </p>
        <p>
          <a href="/book">Book another session →</a>
        </p>
      </div>
    );
  }

  return (
    <>
      {error && <p className="error-text">{error}</p>}
      <div className="form-row" style={{ marginBottom: 0 }}>
        <button className="danger manage-danger" onClick={cancel} disabled={busy}>
          {busy ? "Cancelling…" : "Cancel session"}
        </button>
        <a className="manage-keep" href="/">
          Keep it
        </a>
      </div>
    </>
  );
}
