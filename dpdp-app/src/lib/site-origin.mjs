// The origins this one static bundle is served from (three hostnames). Its own tiny,
// dependency-free module on purpose: src/lib/api.ts (the /app/ browser
// bundle) needs only SITE_ORIGIN, and importing it from public-surface.mjs
// pulled in facts.mjs's Node-only fileURLToPath/readFileSync/join into the
// browser bundle -- a WO-DPDP-013 Part 2 regression that crashed every /app/
// page load with "(0 , Te.fileURLToPath) is not a function" (facts.mjs's
// top-level APP_DIR computation, externalized by Vite for the browser and then
// actually called at runtime).

// The signed-in app's host (WO-DPDP-012 §0). The Monday email's links, the
// magic-link redirect (Supabase Auth Site URL) and the AI work link
// (https://dpdp.veridian-aios.com/ai/<token>) all live here, so this constant
// must NOT move: src/lib/api.ts builds AI-link URLs from it.
// Owner decision 2026-10-01: the app moved from app. to dpdp.veridian-aios.com.
export const SITE_ORIGIN = "https://dpdp.veridian-aios.com"

// The PREVIOUS app host. It keeps serving the very same files (same Cloudflare
// Pages project, same _headers/_redirects) because links in emails already
// sent, in AI work links and on copy pages point at it: /ai/<token>, /act/,
// /copy/, /p/, /unsubscribe/ and /app/ must all keep working there. Nothing NEW
// is built from it; it exists so the "no public surface names the app host"
// guards can refuse both hosts, and so the smoke test can probe it.
export const LEGACY_APP_ORIGIN = "https://app.veridian-aios.com"

// The host the PUBLIC pages are indexed under (SEO, 2026-10-01): the
// canonical, og:url, sitemap, robots Sitemap line, JSON-LD @id/url and
// llms*.txt all say this origin. The same Cloudflare Pages project answers on
// all three hosts with identical files; the public pages on SITE_ORIGIN (and
// on LEGACY_APP_ORIGIN) stay reachable but canonicalise here. No trailing slash.
export const PUBLIC_ORIGIN = "https://veridian-aios.com"
