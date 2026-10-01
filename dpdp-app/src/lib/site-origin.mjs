// The two origins this one static bundle is served from. Its own tiny,
// dependency-free module on purpose: src/lib/api.ts (the /app/ browser
// bundle) needs only SITE_ORIGIN, and importing it from public-surface.mjs
// pulled in facts.mjs's Node-only fileURLToPath/readFileSync/join into the
// browser bundle -- a WO-DPDP-013 Part 2 regression that crashed every /app/
// page load with "(0 , Te.fileURLToPath) is not a function" (facts.mjs's
// top-level APP_DIR computation, externalized by Vite for the browser and then
// actually called at runtime).

// The signed-in app's host (WO-DPDP-012 §0). The Monday email's links, the
// magic-link redirect (Supabase Auth Site URL) and the AI work link
// (https://app.veridian-aios.com/ai/<token>) all live here, so this constant
// must NOT move: src/lib/api.ts builds AI-link URLs from it.
export const SITE_ORIGIN = "https://app.veridian-aios.com"

// The host the PUBLIC pages are indexed under (SEO, 2026-10-01): the
// canonical, og:url, sitemap, robots Sitemap line, JSON-LD @id/url, llms.txt,
// facts.json and for-ai.md all say this origin. The same Cloudflare Pages
// project answers on both hosts with identical files; the public pages on
// SITE_ORIGIN stay reachable but canonicalise here. No trailing slash.
export const PUBLIC_ORIGIN = "https://veridian-aios.com"
