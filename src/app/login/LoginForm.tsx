"use client";

import { useState } from "react";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSending(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "Couldn't send the link. Try again.");
        return;
      }
      setSentTo(email.trim());
      setDevLink(body?.devLink ?? null);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  if (sentTo) {
    return (
      <div className="auth-sent">
        <p>
          If <strong>{sentTo}</strong> belongs to a TutorSpot tutor, a sign-in link is on its way. It expires in 15
          minutes.
        </p>
        {devLink && (
          <p className="auth-dev">
            Development only: <a href={devLink}>open the sign-in link</a>
          </p>
        )}
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setSentTo(null);
            setDevLink(null);
          }}
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="auth-form">
      <div className="form-field">
        <label htmlFor="login-email">Email</label>
        <input
          id="login-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      {error && <p className="error-text">{error}</p>}
      <button type="submit" disabled={sending}>
        {sending ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
