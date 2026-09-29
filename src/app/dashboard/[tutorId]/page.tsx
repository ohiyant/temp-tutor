import { requireTutorPage } from "@/lib/auth";
import TutorWorkspace from "@/components/TutorWorkspace";

export default async function TutorDashboardPage({
  params,
}: {
  params: { tutorId: string };
}) {
  const user = await requireTutorPage(params.tutorId);
  return <TutorWorkspace tutorId={params.tutorId} user={user} />;
}
