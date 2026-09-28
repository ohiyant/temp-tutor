import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Tutoring Platform",
  description: "Book a tutor online or in person.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <a href="/" className="brand">
            TutorSpot
          </a>
          <nav>
            <a href="/dashboard">Tutor Dashboard</a>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
