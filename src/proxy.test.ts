import { describe, expect, test } from "bun:test"

// WO-DPDP-002 Section 5 (blast-radius): dpdp/api/dpdp must never reach
// proxy()'s Supabase Auth SSR call -- that's the whole point of excluding
// them from the matcher. Next.js compiles the `matcher` config into its own
// path-matching logic; this test exercises the same negative-lookahead
// regex directly so a future edit to that string can't silently readd
// dpdp/api/dpdp to the paths proxy() runs on without a test failing.
import { config, resolveProjexaRewriteTarget } from "./proxy"

const [pattern] = config.matcher
const matcher = new RegExp(`^${pattern}$`)

describe("proxy matcher", () => {
  test.each([
    "/dpdp",
    "/dpdp/home",
    "/dpdp/g/kapoor-exports",
    "/dpdp/p/some-token",
    "/api/dpdp/organisations",
    "/api/dpdp/auth/magic-link",
  ])("excludes %s (dpdp has its own, separate auth plane)", (path) => {
    expect(matcher.test(path)).toBe(false)
  })

  test.each(["/_next/static/chunk.js", "/_next/image", "/favicon.ico", "/logo.svg", "/photo.png"])(
    "still excludes pre-existing static path %s",
    (path) => {
      expect(matcher.test(path)).toBe(false)
    },
  )

  test.each(["/home", "/login", "/api/settings/api-keys", "/api/v1/projexa/reports/project-status"])(
    "still includes real app/API path %s",
    (path) => {
      expect(matcher.test(path)).toBe(true)
    },
  )
})

// PROJEXA server-merge Phase 1: 7 route segments (dashboard/documents/hr/
// knowledge-base/reports/settings/recruitment) mean a different thing on
// PROJEXA's own host than on compliance-tracker's own -- resolveProjexaRewriteTarget
// is the pure decision of which host+path combination gets the /px/<name>
// shadow page instead of compliance-tracker's native one.
describe("resolveProjexaRewriteTarget", () => {
  test.each(["projexa-ai.com", "www.projexa-ai.com", "PROJEXA-AI.COM"])(
    "on the PROJEXA host (%s), a colliding segment rewrites to /px/<name>",
    (host) => {
      expect(resolveProjexaRewriteTarget(host, "/dashboard")).toBe("/px/dashboard");
      expect(resolveProjexaRewriteTarget(host, "/reports")).toBe("/px/reports");
    },
  )

  test("a nested path under a colliding segment is rewritten whole, not just the top segment", () => {
    expect(resolveProjexaRewriteTarget("projexa-ai.com", "/dashboard/project")).toBe("/px/dashboard/project");
  });

  test("the port in a Host header is ignored (matches localhost:3000-style dev hosts the same way)", () => {
    expect(resolveProjexaRewriteTarget("projexa-ai.com:443", "/hr")).toBe("/px/hr");
  });

  test.each(["projects", "budgets", "home", "login"])(
    "a PROJEXA-only or non-colliding segment (%s) is never rewritten, even on the PROJEXA host",
    (segment) => {
      expect(resolveProjexaRewriteTarget("projexa-ai.com", `/${segment}`)).toBeNull();
    },
  )

  test.each(["veridian-compliance-ai.vercel.app", "localhost", "some-other-host.com"])(
    "on any non-PROJEXA host (%s), a colliding segment renders compliance-tracker's own page unchanged",
    (host) => {
      expect(resolveProjexaRewriteTarget(host, "/dashboard")).toBeNull();
    },
  )

  test("an empty/missing Host header never rewrites", () => {
    expect(resolveProjexaRewriteTarget("", "/dashboard")).toBeNull();
  });
})
