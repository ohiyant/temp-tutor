/**
 * Where a session happens, worded the same way on every page and email.
 * Online sessions use the tutor's meeting link; in-person sessions use the
 * place the student chose when booking (falling back to the tutor's usual
 * spot for older bookings). If neither is known, the tutor will follow up.
 */

export interface TutorPlaceInfo {
  inPersonLocation: string | null;
  meetingLink: string | null;
}

export interface SessionPlace {
  label: string;
  text: string;
  /** Set when `text` is a link to open. */
  href?: string;
}

export function sessionPlace(
  mode: "online" | "in_person",
  tutor: TutorPlaceInfo,
  /** The session's own meeting place, chosen by the student. */
  location?: string | null
): SessionPlace {
  if (mode === "online") {
    return tutor.meetingLink
      ? { label: "Join online", text: tutor.meetingLink, href: tutor.meetingLink }
      : { label: "Online", text: "Your tutor will send you the meeting link." };
  }
  const where = location?.trim() || tutor.inPersonLocation;
  return where
    ? { label: "Where", text: where }
    : { label: "In person", text: "Your tutor will confirm where to meet." };
}

/** "Join online: https://…" — for plain-text emails. */
export function sessionPlaceLine(
  mode: "online" | "in_person",
  tutor: TutorPlaceInfo,
  location?: string | null
): string {
  const place = sessionPlace(mode, tutor, location);
  return `${place.label}: ${place.text}`;
}

/** "Questions? Contact Alex at alex@…" */
export function tutorContactLine(tutor: { name: string; email: string }): string {
  return `Questions? Contact ${tutor.name} at ${tutor.email}.`;
}
