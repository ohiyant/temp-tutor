import { getCurrentUser } from "@/lib/auth";
import TutorWorkspace from "@/components/TutorWorkspace";

export default async function HomePage() {
  // A signed-in tutor sees their own schedule instead of the student landing page.
  const user = await getCurrentUser();
  if (user?.tutor) return <TutorWorkspace tutorId={user.tutor.id} user={user} />;

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
