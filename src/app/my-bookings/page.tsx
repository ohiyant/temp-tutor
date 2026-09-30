import { CONFIG } from "@/config";
import LookupForm from "./LookupForm";

export const metadata = { title: "My bookings" };

/** Students ask for an emailed link to see all their bookings. */
export default async function MyBookingsPage(props: { searchParams: Promise<{ expired?: string }> }) {
  const searchParams = await props.searchParams;
  return (
    <div className="container auth-container">
      <div className="card auth-card">
        <h1>My bookings</h1>
        <p className="auth-sub">
          Enter the email you booked with and we&apos;ll send you a link to see all your sessions, and reschedule or
          cancel upcoming ones. The link works for {CONFIG.BOOKING_LOOKUP_LINK_HOURS} hours.
        </p>
        {searchParams.expired && (
          <p className="error-text">That link has expired or isn&apos;t valid. Request a new one below.</p>
        )}
        <LookupForm />
      </div>
    </div>
  );
}
