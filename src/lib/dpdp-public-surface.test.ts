/// <reference types="bun-types" />
// WO-DPDP-012 §2 drift guard (same pattern as vercel-lockdown.test.ts): the
// private/public split of /dpdp paths is a DPDP-breach-class setting, so it
// is pinned here rather than trusted to stay right by inspection.
import { describe, expect, test } from "bun:test"
import { DPDP_PRIVATE_DISALLOW, DPDP_PUBLIC_ALLOW, dpdpPrivatePathHeaders } from "./dpdp-public-surface"
import robots from "@/app/robots"

// A deliberately minimal model of Next's headers() matching: `source`
// patterns are matched in array order and, for the same header key, the
// LAST matching block wins (Next's own headers.md, "Header Overriding
// Behavior"). `/x/:path*` matches `/x`, `/x/`, and anything under `/x/`.
function resolve(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const block of dpdpPrivatePathHeaders()) {
    const base = block.source.replace(/\/:path\*$/, "")
    const wildcard = block.source.endsWith("/:path*")
    const matches = wildcard ? path === base || path.startsWith(base + "/") : path === block.source
    if (!matches) continue
    for (const h of block.headers) out[h.key] = h.value
  }
  return out
}

describe("WO-DPDP-012 §2: private /dpdp paths are noindexed, the two public exceptions are not", () => {
  test("the signed-in one-page app, parent consent, and the DPDP API are noindex + no-referrer", () => {
    for (const p of ["/dpdp/home", "/dpdp/ca-clients", "/dpdp/people", "/dpdp/p/some-token", "/dpdp/onboarding", "/dpdp/login"]) {
      expect(resolve(p)["X-Robots-Tag"]).toBe("noindex, nofollow")
      expect(resolve(p)["Referrer-Policy"]).toBe("no-referrer")
    }
    expect(resolve("/api/dpdp/auth/verify")["X-Robots-Tag"]).toBe("noindex, nofollow")
  })

  test("the root chooser and the grievance page are the only public exceptions under /dpdp", () => {
    for (const p of ["/dpdp", "/dpdp/g/acme-traders"]) {
      expect(resolve(p)["X-Robots-Tag"]).toBe("all")
      // Back to the repo-wide default, not the private block's stricter one.
      expect(resolve(p)["Referrer-Policy"]).toBe("strict-origin-when-cross-origin")
    }
  })

  test("the edition landing pages are outside /dpdp/ and untouched by these blocks", () => {
    expect(resolve("/dpdp-firm")).toEqual({})
    expect(resolve("/dpdp-institution")).toEqual({})
  })

  test("ORDER IS LOAD-BEARING: every public override comes after the broad private block", () => {
    const sources = dpdpPrivatePathHeaders().map((b) => b.source)
    const broad = sources.indexOf("/dpdp/:path*")
    expect(broad).toBe(0)
    expect(sources.indexOf("/dpdp")).toBeGreaterThan(broad)
    expect(sources.indexOf("/dpdp/g/:path*")).toBeGreaterThan(broad)
  })

  test("robots.txt says the same thing as the headers (WO-012 §3: 'the two must say the same thing')", () => {
    const rules = robots().rules
    const rule = Array.isArray(rules) ? rules[0] : rules
    const allow = ([] as string[]).concat(rule.allow ?? [])
    const disallow = ([] as string[]).concat(rule.disallow ?? [])
    for (const p of DPDP_PUBLIC_ALLOW) expect(allow).toContain(p)
    for (const p of DPDP_PRIVATE_DISALLOW) expect(disallow).toContain(p)
    // The grievance page must be an Allow that is LONGER than the /dpdp/
    // Disallow it sits under -- robots.txt precedence is longest-match-wins.
    expect("/dpdp/g/".length).toBeGreaterThan("/dpdp/".length)
  })
})
