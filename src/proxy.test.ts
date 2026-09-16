import { describe, expect, test } from "bun:test"

// WO-DPDP-002 Section 5 (blast-radius): dpdp/api/dpdp must never reach
// proxy()'s Supabase Auth SSR call -- that's the whole point of excluding
// them from the matcher. Next.js compiles the `matcher` config into its own
// path-matching logic; this test exercises the same negative-lookahead
// regex directly so a future edit to that string can't silently readd
// dpdp/api/dpdp to the paths proxy() runs on without a test failing.
import { config } from "./proxy"

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
