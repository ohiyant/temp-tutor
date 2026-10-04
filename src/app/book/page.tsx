import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import BookingCalendar from "./BookingCalendar";
import { paymentsEnabled } from "@/lib/stripe";

/** Students get the booking calendar; a signed-in tutor is sent to their own schedule instead. */
export default async function BookPage() {
  const user = await getCurrentUser();
  if (user?.tutor) redirect(`/dashboard/${user.tutor.id}`);
  return <BookingCalendar paymentsEnabled={paymentsEnabled()} />;
}
