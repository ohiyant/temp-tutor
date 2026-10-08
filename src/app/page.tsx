import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { CONFIG } from "@/config";
import { colorForTutor } from "@/lib/tutorColor";
import TutorAvatar from "@/components/TutorAvatar";
import HeroShine from "./HeroShine";

/**
 * "UCR …" is drawn like the n-choose-k notation ₙCₖ: a big C with a small,
 * lowered U before it and R after it. Any other name is shown as is.
 */
function SiteTitle({ name }: { name: string }) {
  if (!name.startsWith("UCR")) return <>{name}</>;
  return (
    <span aria-hidden="true">
      <span className="choose">
        <sub>U</sub>C<sub>R</sub>
      </span>
      {name.slice(3)}
    </span>
  );
}

/** Welcome page: what the site is, and who the tutors are. */
export default async function HomePage() {
  // Signed-in tutors see a button to their schedule instead of the student buttons.
  const user = await getCurrentUser();

  const tutors = await prisma.tutor.findMany({
    // Only tutors students can actually book (they teach at least one subject).
    where: { subjects: { some: {} } },
    orderBy: { name: "asc" },
    include: { subjects: { include: { subject: true } } },
  });

  return (
    <div className="welcome">
      <HeroShine className="welcome-hero">
        <p className="welcome-eyebrow">{CONFIG.SITE_TAGLINE}</p>
        <h1 aria-label={CONFIG.SITE_NAME}>
          <SiteTitle name={CONFIG.SITE_NAME} />
        </h1>
        <div className="welcome-actions">
          {user?.tutor ? (
            <Link href={`/dashboard/${user.tutor.id}`} className="btn btn-primary btn-large">
              My schedule
            </Link>
          ) : (
            <Link href="/book" className="btn btn-primary btn-large">
              Book a session
            </Link>
          )}
        </div>
      </HeroShine>

      {tutors.length > 0 && (
        <section className="welcome-tutors">
          <h2 className="welcome-section-title">Tutors</h2>
          <div className="welcome-tutor-grid">
            {tutors.map((t) => {
              const firstName = t.name.split(" ")[0];
              const modes = [t.onlineAvailable && "Online", t.inPersonAvailable && "In-person"].filter(Boolean).join(" · ");
              return (
                <article key={t.id} className="welcome-tutor-card">
                  <div className="welcome-tutor-head">
                    <TutorAvatar name={t.name} photo={t.photo} color={colorForTutor(t.id)} size={120} />
                    <h3>{t.name}</h3>
                  </div>
                  {t.bio && <p className="welcome-tutor-bio">{t.bio}</p>}
                  <div className="welcome-tutor-subjects">
                    {t.subjects.map((s) => (
                      <span key={s.subjectId} className="subject-pill">
                        {s.subject.name}
                      </span>
                    ))}
                  </div>
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
    </div>
  );
}
