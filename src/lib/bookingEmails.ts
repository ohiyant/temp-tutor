/**
 * The "booking confirmed" emails: one to the student listing every session
 * they booked together, and one to each tutor with their sessions. Sent when
 * a booking is confirmed: straight away when payments are off, or once
 * Stripe reports the payment (see src/lib/checkout.ts).
 */

import { CONFIG } from "@/config";
import { sendEmail } from "@/lib/email";
import { appUrl } from "@/lib/manageLinks";
import { manageLinksText, meetingLinkFallbackLine } from "@/lib/sessionEmails";
import { sessionPlaceLine, tutorContactLine } from "@/lib/sessionPlace";
import { formatDateTime } from "@/lib/timezone";

export interface BookedStudent {
  studentName: string;
  studentEmail: string;
  studentPhone: string | null;
  description: string;
  /** The student's timezone, so their email shows times as they saw them. */
  timezone: string;
}

export interface ConfirmedBooking {
  subjectName: string;
  sessions: {
    tutorId: string;
    startAt: Date;
    durationMin: number;
    mode: "online" | "in_person";
    location: string | null;
    priceCents: number;
    cancellationToken: string;
    rescheduleToken: string;
  }[];
  tutors: {
    id: string;
    name: string;
    email: string;
    timeZone: string;
    inPersonLocation: string | null;
    meetingLink: string | null;
  }[];
}

function modeLabel(mode: "online" | "in_person"): string {
  return mode === "online" ? "Online" : "In-person";
}

export async function sendBookingConfirmationEmails(student: BookedStudent, booking: ConfirmedBooking): Promise<void> {
  const tutorOf = (s: { tutorId: string }) => booking.tutors.find((t) => t.id === s.tutorId)!;
  const bookedTutors = booking.tutors.filter((t) => booking.sessions.some((s) => s.tutorId === t.id));
  // Each person sees times in their own timezone.
  const line = (s: ConfirmedBooking["sessions"][number], timeZone: string) =>
    `- ${formatDateTime(s.startAt, timeZone)} · ${s.durationMin} min · ${modeLabel(s.mode)} · ${tutorOf(s).name} · $${(
      s.priceCents / 100
    ).toFixed(2)}`;

  const studentText = [
    `Hi ${student.studentName},`,
    "",
    `Your ${booking.subjectName} tutoring session${booking.sessions.length === 1 ? " is" : "s are"} booked:`,
    "",
    ...booking.sessions.flatMap((s) => [
      line(s, student.timezone),
      `    ${sessionPlaceLine(s.mode, tutorOf(s), s.location)}`,
      ...manageLinksText(s).map((l) => `    ${l}`),
    ]),
    "",
    // One contact line per tutor in this booking.
    ...bookedTutors.map(tutorContactLine),
    ...(booking.sessions.some((s) => s.mode === "online") ? [meetingLinkFallbackLine()] : []),
    "Have homework, notes or practice problems you'd like to go over? Reply to this email with them before the session so your tutor can take a look.",
    "",
    `Need to change plans? You can reschedule up to ${CONFIG.RESCHEDULE_MIN_NOTICE_HOURS} hours before, or cancel any time before the session.`,
    `See all your bookings any time at ${appUrl()}/my-bookings`,
    "",
    "See you then!",
    CONFIG.SITE_NAME,
  ].join("\n");

  // Replies go to the tutor(s), e.g. a student sending homework ahead of the session.
  const emails = [
    sendEmail(
      student.studentEmail,
      `Booking confirmed: ${booking.subjectName}`,
      studentText,
      bookedTutors.map((t) => t.email)
    ),
  ];

  for (const tutor of bookedTutors) {
    const theirs = booking.sessions.filter((s) => s.tutorId === tutor.id);
    const tutorText = [
      `Hi ${tutor.name},`,
      "",
      `${student.studentName} (${student.studentEmail}${student.studentPhone ? `, ${student.studentPhone}` : ""}) booked ${booking.subjectName}:`,
      "",
      // The tutor needs to know where each in-person session is (the student chose it).
      ...theirs.flatMap((s) => [
        line(s, tutor.timeZone),
        ...(s.mode === "in_person" ? [`    ${sessionPlaceLine(s.mode, tutor, s.location)}`] : []),
      ]),
      ...(student.description ? ["", "What they need help with:", student.description] : []),
    ].join("\n");
    emails.push(
      sendEmail(tutor.email, `New booking: ${booking.subjectName} with ${student.studentName}`, tutorText, student.studentEmail)
    );
  }

  await Promise.all(emails);
}
