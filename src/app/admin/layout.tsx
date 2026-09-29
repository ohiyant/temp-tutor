import type { ReactNode } from "react";
import { requireAdminPage } from "@/lib/auth";
import AdminTabs from "./AdminTabs";

/** Admin area: a tab bar over the Bookings, Tutors and Subjects pages. Each page checks admin access itself too. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdminPage();
  return (
    <div className="container-wide admin-area">
      <div className="admin-head">
        <h1>Admin</h1>
        <AdminTabs />
      </div>
      {children}
    </div>
  );
}
