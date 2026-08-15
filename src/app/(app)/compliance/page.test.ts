/// <reference types="bun-types" />
// Regression test for GAP-COMPLIANCE-PAGINATION-REVERT, a real bug found via
// OCID-050's independent live re-verification (UMR-20260805-002929-5560,
// UMR-20260804-234032-146e, UMR-20260802-165606-4413): clicking to page 2+
// on /compliance correctly loaded that page's data, then within ~2-3.5s an
// unprompted request for page=1 fired and the UI silently reverted -- 100%
// reproducible via real Playwright clicks across 3 independent trials
// against live projexa-ai.com. `page` was a plain `useState(1)`, so any
// transient re-render/remount silently fell back to that hardcoded initial
// value; the `?page=N` URL param was also inert (pure client state).
//
// Fix: derive `page` from the URL via useSearchParams and write it back via
// router.replace() -- the URL becomes the real source of truth, immune to a
// component-local state reset, and the page number becomes a real,
// shareable/back-button-safe URL param. This file tests the two pure
// derivation functions the component delegates to (parsePageParam/
// buildPageUrl), matching this repo's own established pattern of testing
// the pure function a component wraps rather than the component itself
// (see HomeThreadSlot.test.ts's own precedent) -- no live DB, no browser.
import { describe, test, expect } from "bun:test"
import { parsePageParam, buildPageUrl } from "./page"

describe("parsePageParam", () => {
  test("defaults to 1 when there is no page param", () => {
    expect(parsePageParam(new URLSearchParams())).toBe(1)
  })
  test("reads a real numeric page param", () => {
    expect(parsePageParam(new URLSearchParams("page=3"))).toBe(3)
  })
  test("clamps a non-positive page param back to 1 (never a broken/negative page)", () => {
    expect(parsePageParam(new URLSearchParams("page=0"))).toBe(1)
    expect(parsePageParam(new URLSearchParams("page=-5"))).toBe(1)
  })
  test("clamps a non-numeric page param back to 1", () => {
    expect(parsePageParam(new URLSearchParams("page=not-a-number"))).toBe(1)
  })
})

describe("buildPageUrl", () => {
  test("page 1 omits the ?page param entirely (clean URL for the default view)", () => {
    expect(buildPageUrl("/compliance", new URLSearchParams(), 1)).toBe("/compliance")
  })
  test("page 2+ sets a real ?page= URL param -- the exact fix for the pagination-revert gap", () => {
    expect(buildPageUrl("/compliance", new URLSearchParams(), 2)).toBe("/compliance?page=2")
  })
  test("navigating back to page 1 removes the param again, not page=1", () => {
    expect(buildPageUrl("/compliance", new URLSearchParams("page=3"), 1)).toBe("/compliance")
  })
  test("preserves other real query params (search/status/dept/type filters) untouched", () => {
    const url = buildPageUrl("/compliance", new URLSearchParams("status=overdue&search=gst"), 4)
    const params = new URLSearchParams(url.split("?")[1])
    expect(params.get("page")).toBe("4")
    expect(params.get("status")).toBe("overdue")
    expect(params.get("search")).toBe("gst")
  })
})
