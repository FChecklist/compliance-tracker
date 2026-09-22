// WO-DPDP-012 §0/§2: the ONE place that says which /dpdp paths are public
// (findable, citable) and which are private (never indexed, never
// crawled). Both next.config.ts's headers() (the X-Robots-Tag header) and
// src/app/robots.ts read from here so the two can never drift apart --
// §3's own rule is that robots.txt and the crawler-facing settings "must
// say the same thing".
//
// Default is PRIVATE. WO-012 §0 is an explicit allowlist of public pages,
// not a blocklist -- anything under /dpdp not named here is treated as
// carrying personal data or a sign-in token until proven otherwise (§0's
// own words: getting this wrong "is a DPDP breach by a DPDP product").
// The two deliberate public exceptions under /dpdp/* are the bare root
// chooser (a marketing page, no personal data) and the per-organisation
// grievance page /dpdp/g/<slug>, both listed as public in §0.

/** robots.txt Allow lines. "$" is the robots.txt end-of-URL anchor: `/dpdp$` allows exactly the root chooser, not everything under it. */
export const DPDP_PUBLIC_ALLOW = ["/dpdp$", "/dpdp/g/", "/dpdp-firm", "/dpdp-institution"] as const

/** robots.txt Disallow lines. Everything under /dpdp/ and the whole DPDP API. */
export const DPDP_PRIVATE_DISALLOW = ["/dpdp/", "/api/dpdp/"] as const

const NOINDEX = { key: "X-Robots-Tag", value: "noindex, nofollow" }
const INDEX_ALL = { key: "X-Robots-Tag", value: "all" }
// The repo-wide default set in next.config.ts's global block -- restored on
// the public overrides so they end up exactly as they were before this file
// existed, rather than inheriting the private block's stricter policy.
const DEFAULT_REFERRER = { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }

/**
 * Header blocks for next.config.ts's headers(). ORDER IS LOAD-BEARING: Next
 * applies "if two headers match the same path and set the same header key,
 * the last header key will override the first" (its own bundled
 * headers.md), so the public overrides MUST come after the broad private
 * block -- a test pins this. `/dpdp/:path*` matches the bare `/dpdp` too
 * under path-to-regexp's optional-repeat semantics, which is exactly why
 * the root chooser needs its own explicit override rather than relying on
 * the broad pattern not reaching it.
 */
export function dpdpPrivatePathHeaders() {
  return [
    {
      source: "/dpdp/:path*",
      headers: [NOINDEX, { key: "Referrer-Policy", value: "no-referrer" }],
    },
    { source: "/api/dpdp/:path*", headers: [NOINDEX] },
    { source: "/dpdp", headers: [INDEX_ALL, DEFAULT_REFERRER] },
    { source: "/dpdp/g/:path*", headers: [INDEX_ALL, DEFAULT_REFERRER] },
  ]
}
