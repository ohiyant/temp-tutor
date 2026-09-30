/**
 * Emails about an existing session (cancelled, rescheduled). Each person
 * sees times in their own timezone: the student's is saved on the session,
 * the tutor's on the tutor.
 */

import { sendEmail } from "@/lib/email";
import { appUrl, cancelPath, reschedulePath } from "@/lib/manageLinks";
import { formatDateTime, isValidTimeZone } from "@/lib/timezone";
import { CONFIG } from "../config";
import { sessionPlaceLine, tutorContactLine } from "@/lib/sessionPlace";

export interface SessionForEmail {
  startAt: Date;
  durationMin: number;
  studentName: string;
  studentEmail: string;
  timezone: string;
  mode: "online" | "in_person";
  location: string | null;
  cancellationToken: string;
  rescheduleToken: string;
  tutor: {
    name: string;
    email: string;
    timeZone: string;
    inPersonLocation: string | null;
    meetingLink: string | null;
  };
  subject: { name: string };
}

function studentZone(s: SessionForEmail): string {
  return isValidTimeZone(s.timezone) ? s.timezone : s.tutor.timeZone;
}

/** The two self-service links, for the bottom of a student email. */
export function manageLinksText(s: { cancellationToken: string; rescheduleToken: string }): string[] {
  return [
    `Reschedule: ${appUrl()}${reschedulePath(s.rescheduleToken)}`,
    `Cancel: ${appUrl()}${cancelPath(s.cancellationToken)}`,
  ];
}

export async function sendCancellationEmails(
  s: SessionForEmail,
  cancelledBy: "admin" | "student" | "tutor",
  refundNote?: string,
  /** A note from the tutor or admin to the student. */
  reason?: string
): Promise<void> {
  const studentWhen = formatDateTime(s.startAt, studentZone(s));
  const tutorWhen = formatDateTime(s.startAt, s.tutor.timeZone);
  const byWhom = { admin: " by an admin", student: " by the student", tutor: "" }[cancelledBy];

  const studentLead =
    cancelledBy === "student"
      ? `You cancelled your ${s.subject.name} session with ${s.tutor.name} on ${studentWhen} (${s.durationMin} min).`
      : cancelledBy === "tutor"
      ? `${s.tutor.name} had to cancel your ${s.subject.name} session on ${studentWhen} (${s.durationMin} min).`
      : `Your ${s.subject.name} session with ${s.tutor.name} on ${studentWhen} (${s.durationMin} min) has been cancelled.`;

  await Promise.all([
    sendEmail(
      s.studentEmail,
      `Cancelled: ${s.subject.name} on ${studentWhen}`,
      [
        `Hi ${s.studentName},`,
        "",
        studentLead,
        ...(reason ? ["", `Message from ${cancelledBy === "tutor" ? s.tutor.name : CONFIG.SITE_NAME}:`, reason] : []),
        ...(refundNote ? ["", refundNote] : []),
        "",
        cancelledBy === "student"
          ? "You're welcome to book again any time."
          : "Sorry for the inconvenience. You're welcome to book another time.",
        tutorContactLine(s.tutor),
        "",
        CONFIG.SITE_NAME,
      ].join("\n"),
      s.tutor.email
    ),
    sendEmail(
      s.tutor.email,
      `Cancelled: ${s.subject.name} with ${s.studentName}`,
      [
        `Hi ${s.tutor.name},`,
        "",
        cancelledBy === "tutor"
          ? `You cancelled the ${s.subject.name} session with ${s.studentName} on ${tutorWhen} (${s.durationMin} min). They've been emailed.`
          : `The ${s.subject.name} session with ${s.studentName} on ${tutorWhen} (${s.durationMin} min) has been cancelled${byWhom}.`,
        ...(reason && cancelledBy === "admin" ? ["", "Note sent to the student:", reason] : []),
      ].join("\n"),
      s.studentEmail
    ),
  ]);
}

export async function sendRescheduleEmails(oldStartAt: Date, s: SessionForEmail): Promise<void> {
  const zone = studentZone(s);
  await Promise.all([
    sendEmail(
      s.studentEmail,
      `Rescheduled: ${s.subject.name} is now ${formatDateTime(s.startAt, zone)}`,
      [
        `Hi ${s.studentName},`,
        "",
        `Your ${s.subject.name} session with ${s.tutor.name} has moved:`,
        "",
        `  From: ${formatDateTime(oldStartAt, zone)}`,
        `  To:   ${formatDateTime(s.startAt, zone)} (${s.durationMin} min)`,
        `  ${sessionPlaceLine(s.mode, s.tutor, s.location)}`,
        "",
        tutorContactLine(s.tutor),
        "",
        "Need to change it again?",
        ...manageLinksText(s),
        "",
        CONFIG.SITE_NAME,
      ].join("\n"),
      s.tutor.email
    ),
    sendEmail(
      s.tutor.email,
      `Rescheduled: ${s.subject.name} with ${s.studentName}`,
      [
        `Hi ${s.tutor.name},`,
        "",
        `${s.studentName} moved their ${s.subject.name} session:`,
        "",
        `  From: ${formatDateTime(oldStartAt, s.tutor.timeZone)}`,
        `  To:   ${formatDateTime(s.startAt, s.tutor.timeZone)} (${s.durationMin} min)`,
      ].join("\n"),
      s.studentEmail
    ),
  ]);
}
