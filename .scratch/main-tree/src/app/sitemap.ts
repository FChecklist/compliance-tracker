import type { MetadataRoute } from "next";

// Wave 113 SEO: one sitemap for the whole public family. App pages behind
// auth are deliberately absent.
const BASE = "https://veridian-ai-os.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${BASE}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/office`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${BASE}/the-firm`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${BASE}/veri-fm-cs`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${BASE}/forge`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${BASE}/signup`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${BASE}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${BASE}/data-policy`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];
}
