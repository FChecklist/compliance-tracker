import type { MetadataRoute } from "next";

// Wave 113 SEO: index the public family, keep the app and APIs out.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/home", "/settings", "/sales-hq", "/orchestra", "/partner/", "/r/"],
      },
    ],
    sitemap: "https://veridian-ai-os.vercel.app/sitemap.xml",
  };
}
