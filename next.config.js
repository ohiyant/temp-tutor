/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets a production build be checked into a separate folder
  // (NEXT_DIST_DIR=.next-build) while `next dev` is using .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

module.exports = nextConfig;
