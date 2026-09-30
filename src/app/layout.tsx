import "./globals.css";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/auth";
import { CONFIG } from "@/config";

export const metadata = {
  // Pages set just their own part ("My bookings"); the site name is added here.
  title: { default: CONFIG.SITE_NAME, template: `%s · ${CONFIG.SITE_NAME}` },
  description: "Book a tutor online or in person.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  // Optional banner across every page, e.g. for a test deployment.
  const siteNotice = process.env.SITE_NOTICE;

  return (
    <html lang="en">
      <body>
        {siteNotice && <div className="site-notice">{siteNotice}</div>}
        <header className="site-header">
          <a href="/" className="brand">
            Home
          </a>
          <nav>
            {user ? (
              <>
                {user.tutor && <a href={`/dashboard/${user.tutor.id}`}>My schedule</a>}
                {user.isAdmin && <a href="/admin/bookings">Admin</a>}
                <span className="nav-email">{user.email}</span>
                <form method="post" action="/api/auth/logout" className="nav-signout">
                  <button type="submit">Sign out</button>
                </form>
              </>
            ) : (
              <>
                <a href="/my-bookings">My bookings</a>
                <a href="/login">Tutor sign-in</a>
              </>
            )}
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
