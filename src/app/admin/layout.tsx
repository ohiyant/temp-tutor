import type { ReactNode } from "react";
import { requireAdminPage } from "@/lib/auth";
import TabNav from "@/components/TabNav";

const TABS = [
  { href: "/admin/bookings", label: "Bookings" },
  { href: "/admin/tutors", label: "Tutors" },
  { href: "/admin/subjects", label: "Subjects" },
];

/** Admin area: a tab bar over the Bookings, Tutors and Subjects pages. Each page checks admin access itself too. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdminPage();
  return (
    <div className="container-wide tab-area">
      <div className="tab-area-head">
        <h1>Admin</h1>
        <TabNav tabs={TABS} label="Admin sections" />
      </div>
      {children}
    </div>
  );
}
