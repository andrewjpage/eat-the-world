import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets parallel dev servers (one per agent) use separate build folders.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  images: { unoptimized: true },
  poweredByHeader: false,
  // A private friends' game: never indexed (HTML, JSON, PNG and .ics alike), never framed.
  // strict-origin-when-cross-origin still sends the origin as the Referer the OSM tile policy needs.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Permissions-Policy", value: "geolocation=(self), camera=(self), microphone=()" },
        ],
      },
    ];
  },
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
