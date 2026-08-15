import type { MetadataRoute } from "next";

// Wave 113 SEO: index the public family, keep the app and APIs out.
//
// Owner mandate task-20260815-033857 (Z.ai black-box audit point P8-CB-09):
// kept in sync with sitemap.ts's own BASE fix -- see that file's comment.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/home", "/settings", "/sales-hq", "/orchestra", "/partner/", "/r/"],
      },
    ],
    sitemap: "https://projexa-ai.com/sitemap.xml",
  };
}
