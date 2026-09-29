import { getCurrentUser } from "@/lib/auth";
import TutorWorkspace from "@/components/TutorWorkspace";
import BookingCalendar from "./BookingCalendar";

/** Students get the booking calendar; a signed-in tutor gets their own schedule instead. */
export default async function BookPage() {
  const user = await getCurrentUser();
  if (user?.tutor) return <TutorWorkspace tutorId={user.tutor.id} user={user} />;
  return <BookingCalendar />;
}
