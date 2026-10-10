import type { MetadataRoute } from "next";
import { DPDP_PRIVATE_DISALLOW, DPDP_PUBLIC_ALLOW } from "@/lib/dpdp-public-surface";

// Wave 113 SEO: index the public family, keep the app and APIs out.
//
// Owner mandate task-20260815-033857 (Z.ai black-box audit point P8-CB-09):
// kept in sync with sitemap.ts's own BASE fix -- see that file's comment.
//
// WO-DPDP-012 §2/§3: the /dpdp split comes from dpdp-public-surface.ts, the
// same source next.config.ts's X-Robots-Tag headers read -- §3 requires
// robots.txt and the crawler-facing headers to "say the same thing", and
// sharing one constant is how that stays true. Everything under /dpdp/ is
// disallowed; the bare root chooser (`/dpdp$`, an exact match) and the
// per-organisation grievance page (`/dpdp/g/`) are the allowed exceptions,
// and robots.txt's longest-match-wins precedence makes `/dpdp/g/` beat
// `/dpdp/` for those pages.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", ...DPDP_PUBLIC_ALLOW],
        disallow: ["/api/", "/home", "/settings", "/sales-hq", "/orchestra", "/partner/", "/r/", ...DPDP_PRIVATE_DISALLOW],
      },
    ],
    sitemap: "https://projexa-ai.com/sitemap.xml",
  };
}
