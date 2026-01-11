import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Images from external sources
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
  // Disable ESLint during builds (run separately)
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
