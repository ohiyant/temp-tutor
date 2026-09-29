import nodemailer from "nodemailer";
import { Resend } from "resend";

/**
 * Best-effort email sending. A failed email must never fail a booking —
 * the sessions are already saved by the time this runs — so errors are
 * logged and swallowed.
 *
 * Which service sends, in order:
 *   1. Gmail, when GMAIL_USER and GMAIL_APP_PASSWORD are set (an app
 *      password from the Google account's security settings). Free, about
 *      500 emails a day, sent from that Gmail address.
 *   2. Resend, when RESEND_API_KEY is set. Until a domain is verified in
 *      Resend, the default onboarding@resend.dev sender can only deliver to
 *      your own Resend account address; set EMAIL_FROM once it is.
 *   3. Neither: emails are printed to the server console (handy in development).
 */

const gmailUser = process.env.GMAIL_USER?.trim();
const gmailPassword = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, ""); // Google shows it in groups of 4

const gmail =
  gmailUser && gmailPassword
    ? nodemailer.createTransport({ service: "gmail", auth: { user: gmailUser, pass: gmailPassword } })
    : null;
const resend = !gmail && process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// Gmail always sends as the signed-in account, so only the display name is ours to choose there.
const FROM = gmail
  ? `TutorSpot <${gmailUser}>`
  : process.env.EMAIL_FROM ?? "TutorSpot <onboarding@resend.dev>";

export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  try {
    if (gmail) {
      await gmail.sendMail({ from: FROM, to, subject, text });
    } else if (resend) {
      const { error } = await resend.emails.send({ from: FROM, to, subject, text });
      if (error) console.error(`[email] failed to send "${subject}" to ${to}:`, error);
    } else {
      console.log(`[email] (no email service configured, not sent)\nTo: ${to}\nSubject: ${subject}\n\n${text}`);
    }
  } catch (err) {
    console.error(`[email] failed to send "${subject}" to ${to}:`, err);
  }
}
