import { prisma } from "@/lib/prisma";
import Link from "next/link";

export default async function DashboardHome() {
  const tutors = await prisma.tutor.findMany({ orderBy: { name: "asc" } });

  return (
    <div className="container">
      <h1>Tutor Dashboard</h1>
      <p className="note">
        Temporary: there&apos;s no login yet, so pick a tutor below to manage
        their account. Real authentication (so each tutor can only edit their
        own profile) is a planned follow-up step.
      </p>
      <ul className="tutor-list">
        {tutors.map((t) => (
          <li key={t.id}>
            <Link href={`/dashboard/${t.id}`}>
              {t.name} — {t.email}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
