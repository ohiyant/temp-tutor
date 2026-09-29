import { redirect } from "next/navigation";
import { requireUserPage } from "@/lib/auth";

/** "My dashboard" / "Admin dashboard": admins go to the admin area, tutors to their own schedule. */
export default async function DashboardHome() {
  const user = await requireUserPage();
  redirect(user.isAdmin ? "/admin/bookings" : `/dashboard/${user.tutor!.id}`);
}
