import type { MetadataRoute } from "next";

/** Invite-only and private (brief section 8): no crawler is welcome anywhere. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
