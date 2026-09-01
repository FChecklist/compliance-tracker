import type { MetadataRoute } from "next";

// Wave 113 SEO: one sitemap for the whole public family. App pages behind
// auth are deliberately absent.
//
// Owner mandate task-20260815-033857 (Z.ai black-box audit point P8-CB-09,
// "Sitemap.xml references different domain"): live-verified 2026-08-15,
// https://projexa-ai.com/sitemap.xml listed <loc> entries under
// veridian-ai-os.vercel.app, not the real domain being served/tested.
// projexa-ai.com is the live custom domain this app is actually reached at
// (see [[veridian-projexa-domain-ownership-conflict]] resolution note) --
// pointed at that domain rather than the platform's raw vercel.app URL, so
// crawlers indexing the sitemap land on the same domain real users use.
// This does not touch the separate, still-open brand-NAME inconsistency
// (PROJEXA vs VERIDIAN AI page titles, P8-CB-08) -- domain and brand text
// are independent gaps.
const BASE = "https://projexa-ai.com";

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
