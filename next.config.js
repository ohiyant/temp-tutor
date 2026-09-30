/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets a production build be checked into a separate folder
  // (NEXT_DIST_DIR=.next-build) while `next dev` is using .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",

  // Tutor sign-in moved from /login to /tutorlogin. Keeps old bookmarks and
  // already-sent sign-in emails (/login/verify?token=...) working.
  async redirects() {
    return [{ source: "/login/:path*", destination: "/tutorlogin/:path*", permanent: true }];
  },
};

module.exports = nextConfig;
