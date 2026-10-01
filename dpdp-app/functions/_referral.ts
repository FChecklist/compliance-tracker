// Referral carry-through for the static public pages (WO-DPDP-016 follow-up).
//
// The share button hands out https://veridian-aios.com/?ref=<CODE> (PUBLIC_SITE
// + the partner's code). The public pages are script-free by rule
// (scripts/check-public-surface.mjs, check-two-doors.mjs), and every link on
// them to the next step -- /dpdp-firm/, /dpdp-institution/, /app/?edition=...
// -- carries no ?ref=, while only the /app/ bundle reads it (src/lib/landing.ts
// readLanding). So a visitor who clicked through lost the code and
// dpdp_create_my_org recorded no referral. functions/_middleware.ts fixes that
// at the edge: only when a valid ?ref= is on a request for a public page, it
// adds the same ?ref= to that page's internal links. Nothing is added to the
// static files and nothing runs in the browser.
//
// This module is PURE (no Cloudflare globals) so src/lib/referral-carry.test.ts
// can exercise every decision under `bun test`.

/** Same shape landing.ts and ShareVeridian.tsx accept; dpdp_create_my_org is the one source of truth for whether a code is real. */
export const REF_RE = /^[A-Za-z0-9]{4,16}$/

/**
 * Every page that may carry the code forward: the five public pages from
 * src/lib/public-surface.mjs plus the static legal pages in public/. A path
 * not listed here (the private prefixes, /ai/, /original/, assets) is never
 * touched. src/lib/referral-carry.test.ts pins this against PUBLIC_PAGES.
 */
export const CARRY_PAGES: readonly string[] = [
  "/", "/dpdp-firm/", "/dpdp-institution/", "/about/", "/proof/",
  "/pricing/", "/contact/", "/privacy/", "/terms/", "/refund/", "/shipping/", "/disclaimer/",
]

/** The one non-public destination a ref is carried into: the signed-in app, where landing.ts captures it. */
const APP_PATH = "/app/"

/** The code in a request URL, or null when absent or not shaped like a code. */
export function refFromUrl(url: URL): string | null {
  const v = url.searchParams.get("ref")
  return v && REF_RE.test(v) ? v : null
}

/** Is this a request the rewrite applies to: a GET for one of the carry pages, carrying a valid ref? */
export function shouldRewrite(method: string, url: URL): string | null {
  if (method !== "GET") return null
  if (!CARRY_PAGES.includes(url.pathname)) return null
  return refFromUrl(url)
}

/**
 * The href with ?ref=<code> added, or null to leave it alone. Only same-site
 * absolute-path links (/x, never //host, never https://, never #frag) to a
 * carry page or to /app/ are changed; an existing ?ref= is never overwritten;
 * the #fragment stays last.
 */
export function carryRef(href: string, code: string): string | null {
  if (!REF_RE.test(code)) return null
  if (!href.startsWith("/") || href.startsWith("//") || href.includes("\\")) return null
  const hashAt = href.indexOf("#")
  const beforeHash = hashAt === -1 ? href : href.slice(0, hashAt)
  const hash = hashAt === -1 ? "" : href.slice(hashAt)
  const qAt = beforeHash.indexOf("?")
  const path = qAt === -1 ? beforeHash : beforeHash.slice(0, qAt)
  const query = qAt === -1 ? "" : beforeHash.slice(qAt + 1)
  if (path !== APP_PATH && !CARRY_PAGES.includes(path)) return null
  const params = new URLSearchParams(query)
  if (params.has("ref")) return null
  params.set("ref", code)
  return `${path}?${params.toString()}${hash}`
}
