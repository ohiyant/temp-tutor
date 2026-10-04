import { cancelPath, reschedulePath } from "@/lib/manageLinks";
import { sessionPlace, type SessionPlace, type TutorPlaceInfo } from "@/lib/sessionPlace";

/** What the "You're booked!" screen shows: the booking page's done step and the page after paying. */
export interface BookingResult {
  subjectName: string;
  totalCents: number;
  sessions: {
    id: string;
    tutorName: string;
    startAt: string;
    endAt: string;
    durationMin: number;
    mode: "online" | "in_person";
    priceCents: number;
    cancelPath: string;
    reschedulePath: string;
    place: SessionPlace;
    tutorEmail: string;
  }[];
}

export function toBookingResult(
  subjectName: string,
  sessions: {
    id: string;
    tutorId: string;
    startAt: Date;
    endAt: Date;
    durationMin: number;
    mode: "online" | "in_person";
    priceCents: number;
    location: string | null;
    cancellationToken: string;
    rescheduleToken: string;
  }[],
  tutors: (TutorPlaceInfo & { id: string; name: string; email: string })[]
): BookingResult {
  return {
    subjectName,
    totalCents: sessions.reduce((sum, s) => sum + s.priceCents, 0),
    sessions: sessions.map((s) => {
      const tutor = tutors.find((t) => t.id === s.tutorId)!;
      return {
        id: s.id,
        tutorName: tutor.name,
        startAt: s.startAt.toISOString(),
        endAt: s.endAt.toISOString(),
        durationMin: s.durationMin,
        mode: s.mode,
        priceCents: s.priceCents,
        cancelPath: cancelPath(s.cancellationToken),
        reschedulePath: reschedulePath(s.rescheduleToken),
        place: sessionPlace(s.mode, tutor, s.location),
        tutorEmail: tutor.email,
      };
    }),
  };
}
