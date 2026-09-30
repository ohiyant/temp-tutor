import "./globals.css";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import { getCurrentUser } from "@/lib/auth";
import { CONFIG } from "@/config";

export const metadata = {
  // Pages set just their own part ("My bookings"); the site name is added here.
  title: { default: CONFIG.SITE_NAME, template: `%s · ${CONFIG.SITE_NAME}` },
  description: "Book a tutor online or in person.",
};

// Self-hosted by Next.js at build time (no request to Google from visitors).
const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-sans" });

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  // Optional banner across every page, e.g. for a test deployment.
  const siteNotice = process.env.SITE_NOTICE;

  return (
    <html lang="en" className={inter.variable}>
      <body>
        {siteNotice && <div className="site-notice">{siteNotice}</div>}
        <header className="site-header">
          <a href="/" className="brand">
            Home
          </a>
          <nav>
            {user ? (
              <>
                {user.tutor && (
                  <a href={`/dashboard/${user.tutor.id}`} className="btn btn-ghost btn-small">
                    My schedule
                  </a>
                )}
                {user.isAdmin && (
                  <a href="/admin/bookings" className="btn btn-ghost btn-small">
                    Admin
                  </a>
                )}
                <span className="nav-email">{user.email}</span>
                <form method="post" action="/api/auth/logout" className="nav-signout">
                  <button type="submit" className="btn btn-secondary btn-small">
                    Sign out
                  </button>
                </form>
              </>
            ) : (
              <>
                <a href="/my-bookings" className="btn btn-ghost btn-small">
                  My bookings
                </a>
              </>
            )}
          </nav>
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          <span>{CONFIG.SITE_NAME}</span>
          <a href="/policies">Policies</a>
          <a href="/my-bookings">My bookings</a>
          <a href="/tutorlogin">Tutor sign-in</a>
        </footer>
      </body>
    </html>
  );
}
