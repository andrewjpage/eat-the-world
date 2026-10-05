import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets parallel dev servers (one per agent) use separate build folders.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  images: { unoptimized: true },
  // The recap card embeds a flag SVG and its fonts, read from disk at request time.
  outputFileTracingIncludes: {
    "/api/visits/[id]/recap": [
      "./node_modules/flag-icons/flags/4x3/*.svg",
      // "*" stands for the literal "[id]" folder, which a glob would read as a character class.
      "./src/app/api/visits/*/recap/fonts/*.ttf",
    ],
  },
};

export default nextConfig;
