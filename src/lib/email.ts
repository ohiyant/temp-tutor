import { Resend } from "resend";

/**
 * Best-effort email sending. A failed email must never fail a booking —
 * the sessions are already saved by the time this runs — so errors are
 * logged and swallowed. With no RESEND_API_KEY set, emails are printed to
 * the server console instead, which is handy in development.
 *
 * Note: until a domain is verified in Resend, the default
 * onboarding@resend.dev sender can only deliver to your own Resend account
 * address. Set EMAIL_FROM once a domain is verified.
 */

const FROM = process.env.EMAIL_FROM ?? "TutorSpot <onboarding@resend.dev>";
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  if (!resend) {
    console.log(`[email] (RESEND_API_KEY not set, not sent)\nTo: ${to}\nSubject: ${subject}\n\n${text}`);
    return;
  }
  try {
    const { error } = await resend.emails.send({ from: FROM, to, subject, text });
    if (error) console.error(`[email] failed to send "${subject}" to ${to}:`, error);
  } catch (err) {
    console.error(`[email] failed to send "${subject}" to ${to}:`, err);
  }
}
