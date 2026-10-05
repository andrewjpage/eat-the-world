import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets parallel dev servers (one per agent) use separate build folders.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  images: { unoptimized: true },
};

export default nextConfig;
