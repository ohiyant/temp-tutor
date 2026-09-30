import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireTutorPage } from "@/lib/auth";
import TabNav from "@/components/TabNav";

/**
 * A tutor's area: tabs over their Schedule, Availability and Rate & subjects
 * pages. Seen by that tutor, or by an admin managing them. Each page checks
 * access itself too.
 */
export default async function TutorLayout(props: { children: ReactNode; params: Promise<{ tutorId: string }> }) {
  const params = await props.params;

  const {
    children
  } = props;

  const user = await requireTutorPage(params.tutorId);
  const tutor = await prisma.tutor.findUnique({ where: { id: params.tutorId }, select: { id: true, name: true } });
  if (!tutor) notFound();

  const isSelf = user.tutor?.id === tutor.id;
  const base = `/dashboard/${tutor.id}`;
  return (
    <div className="container-wide tab-area">
      <div className="tab-area-head">
        <div className="tab-area-title">
          {user.isAdmin && !isSelf && (
            <Link href="/admin/tutors" className="back-link-inline">
              ← All tutors
            </Link>
          )}
          <h1>{isSelf ? "My schedule" : tutor.name}</h1>
        </div>
        <TabNav
          label="Tutor sections"
          tabs={[
            { href: base, label: "Schedule" },
            { href: `${base}/availability`, label: "Availability" },
            { href: `${base}/profile`, label: "Rate & subjects" },
          ]}
        />
      </div>
      {children}
    </div>
  );
}
