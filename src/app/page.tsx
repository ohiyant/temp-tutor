import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { CONFIG } from "@/config";
import { colorForTutor } from "@/lib/tutorColor";
import TutorAvatar from "@/components/TutorAvatar";
import HeroShine from "./HeroShine";

/** Welcome page: what the site is, and who the tutors are. */
export default async function HomePage() {
  // A signed-in tutor goes to their own schedule instead of the student landing page.
  const user = await getCurrentUser();
  if (user?.tutor) redirect(`/dashboard/${user.tutor.id}`);

  const tutors = await prisma.tutor.findMany({
    // Only tutors students can actually book (they teach at least one subject).
    where: { subjects: { some: {} } },
    orderBy: { name: "asc" },
    include: { subjects: { include: { subject: true } } },
  });

  return (
    <div className="welcome">
      <HeroShine className="welcome-hero">
        <p className="welcome-eyebrow">One-on-one tutoring</p>
        <h1>{CONFIG.SITE_NAME}</h1>
        <p className="welcome-tagline">{CONFIG.SITE_TAGLINE}</p>
        <div className="welcome-actions">
          <Link href="/book" className="btn btn-primary btn-large">
            Book a session
          </Link>
          <Link href="/my-bookings" className="btn btn-secondary btn-large">
            My bookings
          </Link>
        </div>
      </HeroShine>

      {tutors.length > 0 && (
        <section className="welcome-tutors">
          <h2 className="welcome-section-title">Meet the tutors</h2>
          <div className="welcome-tutor-grid">
            {tutors.map((t) => {
              const firstName = t.name.split(" ")[0];
              const modes = [t.onlineAvailable && "Online", t.inPersonAvailable && "In-person"].filter(Boolean).join(" · ");
              return (
                <article key={t.id} className="welcome-tutor-card">
                  <div className="welcome-tutor-head">
                    <TutorAvatar name={t.name} photo={t.photo} color={colorForTutor(t.id)} size={64} />
                    <div>
                      <h3>{t.name}</h3>
                      {t.school && <p className="welcome-tutor-school">{t.school}</p>}
                    </div>
                  </div>
                  <div className="welcome-tutor-subjects">
                    {t.subjects.map((s) => (
                      <span key={s.subjectId} className="subject-pill">
                        {s.subject.name}
                      </span>
                    ))}
                  </div>
                  {t.bio && <p className="welcome-tutor-bio">{t.bio}</p>}
                  <div className="welcome-tutor-foot">
                    <span className="muted small">{modes}</span>
                    <Link
                      href={`/book?subject=${encodeURIComponent(t.subjects[0].subjectId)}&tutor=${encodeURIComponent(t.id)}`}
                      className="btn btn-primary btn-small"
                    >
                      Book with {firstName}
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <footer className="welcome-footer">
        <span>Tutoring here?</span>
        <Link href="/login" className="btn btn-secondary btn-small">
          Tutor sign-in
        </Link>
      </footer>
    </div>
  );
}
