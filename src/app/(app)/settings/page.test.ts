/// <reference types="bun-types" />
// Regression test for GAP-SETTINGS-SUBSCRIPTION-TAB-NOT-RENDERING, a real bug
// found via OCID-050's independent live re-verification (UMR-20260805-015906-be9f,
// UMR-20260805-002929-5560, UMR-20260802-165606-4413): live-confirmed (real
// Playwright, 3/3 trials) that `/api/me` intermittently returns a real HTTP
// 200 with every field null right after login -- a transient server-side
// session-resolution race, not a permanent auth failure -- and the settings
// page took that at face value with no retry, permanently rendering an empty
// Profile section and never showing the Subscription Plan tab's real content
// (gated on the same null-derived `isAdmin`).
//
// Tests the extracted pure retry helper directly (matching this repo's own
// established "test the pure function, not the component" pattern -- see
// HomeThreadSlot.test.ts, compliance/page.test.ts) with a mocked global
// fetch, no live DB, no browser.
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test"
import { fetchMeWithSessionRetry } from "./page"

const REAL_ME = { id: "user-1", name: "Real User", email: "real@example.internal", role: "admin", orgId: "org-1" }
const NULL_ME = { id: null, name: null, email: null, role: null, orgId: null }

describe("fetchMeWithSessionRetry", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("returns immediately on a real first response (no unnecessary retry)", async () => {
    const fetchMock = mock(async () => new Response(JSON.stringify(REAL_ME)))
    globalThis.fetch = fetchMock as any
    const result = await fetchMeWithSessionRetry(3, 1)
    expect(result).toEqual(REAL_ME)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test("REGRESSION: retries past a transient null-session response and returns the real data once it resolves", async () => {
    let calls = 0
    const fetchMock = mock(async () => {
      calls++
      return new Response(JSON.stringify(calls < 2 ? NULL_ME : REAL_ME))
    })
    globalThis.fetch = fetchMock as any
    const result = await fetchMeWithSessionRetry(3, 1)
    expect(result).toEqual(REAL_ME)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test("returns null (not a fabricated user) after genuinely exhausting all retries", async () => {
    const fetchMock = mock(async () => new Response(JSON.stringify(NULL_ME)))
    globalThis.fetch = fetchMock as any
    const result = await fetchMeWithSessionRetry(3, 1)
    expect(result).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
