import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export default async function HomePage() {
  // A signed-in tutor goes to their own schedule instead of the student landing page.
  const user = await getCurrentUser();
  if (user?.tutor) redirect(`/dashboard/${user.tutor.id}`);

  return (
    <div className="container">
      <h1>Book a Tutor</h1>
      <p>Find a tutor online or in person, matched to your subject, schedule, and duration.</p>
      <p>
        <a href="/book">Start Booking →</a>
      </p>
    </div>
  );
}
