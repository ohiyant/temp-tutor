import Link from "next/link";
import { CONFIG } from "@/config";

export const metadata = { title: "Policies" };

const LAST_UPDATED = "October 1, 2026";

/**
 * Cancellation and rescheduling rules, in plain language.
 * Numbers come from src/config.ts, so the page always matches how the site
 * actually behaves. Students agree to this page when they book.
 */
export default function PoliciesPage() {
  const pct = (share: number) => `${Math.round(share * 100)}%`;

  return (
    <div className="container policies">
      <h1>Policies</h1>
      <p className="muted small">Last updated {LAST_UPDATED}. By booking a session you agree to these policies.</p>

      <nav className="policies-toc" aria-label="On this page">
        <a href="#cancellations">Cancellations</a>
        <a href="#rescheduling">Rescheduling</a>
        <a href="#missed">Missed sessions</a>
      </nav>

      <section id="cancellations">
        <h2>Cancellations and refunds</h2>
        <ul>
          <li>
            Cancel with the <strong>Cancel</strong> link in your confirmation email, or from{" "}
            <Link href="/my-bookings">My bookings</Link>.
          </li>
          <li>
            Cancel any time before your session and you get <strong>{pct(CONFIG.CANCEL_REFUND_PCT)}</strong> of what
            you paid back, to your card within 5–10 business days.
          </li>
          <li>
            If your tutor or we cancel a session, you get a <strong>full refund</strong>, and we&apos;ll email you.
          </li>
        </ul>
      </section>

      <section id="rescheduling">
        <h2>Rescheduling</h2>
        <ul>
          <li>
            Rescheduling is <strong>free</strong> up to {CONFIG.RESCHEDULE_MIN_NOTICE_HOURS} hours before your session.
            Use the <strong>Reschedule</strong> link in your email, or <Link href="/my-bookings">My bookings</Link>.
          </li>
          <li>
            Within {CONFIG.RESCHEDULE_MIN_NOTICE_HOURS} hours, sessions can&apos;t be moved, but you can still cancel
            (see above).
          </li>
          <li>A rescheduled session keeps the same tutor, subject and length.</li>
        </ul>
      </section>

      <section id="missed">
        <h2>Missed sessions</h2>
        <ul>
          <li>
            If you don&apos;t show up and didn&apos;t cancel, the session counts as used and isn&apos;t refunded.
          </li>
          <li>
            If your tutor doesn&apos;t show up, you get a full refund, and you&apos;re welcome to book again.
          </li>
        </ul>
      </section>
    </div>
  );
}
