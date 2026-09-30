import { requireAdminPage } from "@/lib/auth";
import { getHourlyRateCents } from "@/lib/settings";
import { RateForm } from "../AdminForms";

export const metadata = { title: "Rate · Admin" };

export default async function AdminRatePage() {
  await requireAdminPage();
  return (
    <div className="admin-narrow">
      <RateForm initialHourlyRateCents={await getHourlyRateCents()} />
    </div>
  );
}
