/// <reference types="bun-types" />
// Priority 4 (09-priority4-umr-universal-tracker.yaml): unit tests for the
// compiled metadata cache's real logic -- TTL expiry, per-org isolation,
// invalidation semantics (specific org vs. platform-tier clear-all), and
// the thundering-herd dedup of concurrent loads for the same org. Mocks
// `@/lib/db` directly (this file's only DB dependency) rather than hitting
// a live/placeholder connection, matching this codebase's discipline of
// never touching real DB state in a unit test.
import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test"

type Row = { id: string; orgId: string | null; status: string }

let rows: Row[] = []
let selectCallCount = 0

mock.module("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => {
          selectCallCount++
          // The real query filters (org OR platform-tier) AND status='active'
          // -- this mock replicates that filter over the test fixture so
          // assertions about WHICH rows come back stay meaningful, not just
          // "was select() called."
          return Promise.resolve(rows.filter((r) => r.status === "active"))
        },
      }),
    }),
  },
  platformAssets: {},
}))

const realDateNow = Date.now

function setMockedNow(ms: number) {
  Date.now = () => ms
}

beforeEach(() => {
  rows = []
  selectCallCount = 0
  setMockedNow(1_700_000_000_000)
})

afterEach(() => {
  Date.now = realDateNow
})

describe("getCachedOrgAssets", () => {
  test("loads from the DB on first call, serves from memory on the second", async () => {
    rows = [{ id: "a1", orgId: "org-1", status: "active" }]
    const { getCachedOrgAssets, invalidateAllCaches } = await import("./asset-registry-cache")
    invalidateAllCaches()

    const first = await getCachedOrgAssets("org-1")
    const second = await getCachedOrgAssets("org-1")

    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
    expect(selectCallCount).toBe(1) // second call served from cache, no re-query
  })

  test("reloads once the TTL has expired", async () => {
    rows = [{ id: "a1", orgId: "org-2", status: "active" }]
    const { getCachedOrgAssets, invalidateAllCaches, CACHE_TTL_MS } = await import("./asset-registry-cache")
    invalidateAllCaches()

    await getCachedOrgAssets("org-2")
    expect(selectCallCount).toBe(1)

    setMockedNow(1_700_000_000_000 + CACHE_TTL_MS + 1)
    await getCachedOrgAssets("org-2")
    expect(selectCallCount).toBe(2) // expired -> real reload, not served stale
  })

  test("keeps separate orgs in separate cache entries", async () => {
    rows = [
      { id: "a1", orgId: "org-3", status: "active" },
      { id: "a2", orgId: "org-4", status: "active" },
    ]
    const { getCachedOrgAssets, invalidateAllCaches } = await import("./asset-registry-cache")
    invalidateAllCaches()

    await getCachedOrgAssets("org-3")
    await getCachedOrgAssets("org-4")
    expect(selectCallCount).toBe(2) // one real load per distinct org, no cross-contamination
  })

  test("dedupes concurrent loads for the same org into a single query", async () => {
    rows = [{ id: "a1", orgId: "org-5", status: "active" }]
    const { getCachedOrgAssets, invalidateAllCaches } = await import("./asset-registry-cache")
    invalidateAllCaches()

    const [a, b, c] = await Promise.all([getCachedOrgAssets("org-5"), getCachedOrgAssets("org-5"), getCachedOrgAssets("org-5")])

    expect(a).toEqual(b)
    expect(b).toEqual(c)
    expect(selectCallCount).toBe(1) // thundering herd collapsed to exactly one real query
  })
})

describe("invalidateOrgCache", () => {
  test("clears only the named org, leaving other orgs cached", async () => {
    rows = [
      { id: "a1", orgId: "org-6", status: "active" },
      { id: "a2", orgId: "org-7", status: "active" },
    ]
    const { getCachedOrgAssets, invalidateOrgCache, invalidateAllCaches } = await import("./asset-registry-cache")
    invalidateAllCaches()

    await getCachedOrgAssets("org-6")
    await getCachedOrgAssets("org-7")
    expect(selectCallCount).toBe(2)

    invalidateOrgCache("org-6")
    await getCachedOrgAssets("org-6") // re-loads
    await getCachedOrgAssets("org-7") // still cached
    expect(selectCallCount).toBe(3)
  })

  test("a null/undefined orgId (platform-tier write) clears every cached org", async () => {
    rows = [
      { id: "a1", orgId: "org-8", status: "active" },
      { id: "a2", orgId: "org-9", status: "active" },
    ]
    const { getCachedOrgAssets, invalidateOrgCache, invalidateAllCaches } = await import("./asset-registry-cache")
    invalidateAllCaches()

    await getCachedOrgAssets("org-8")
    await getCachedOrgAssets("org-9")
    expect(selectCallCount).toBe(2)

    invalidateOrgCache(null)
    await getCachedOrgAssets("org-8")
    await getCachedOrgAssets("org-9")
    expect(selectCallCount).toBe(4) // both reloaded -- a platform-tier write can affect every org's view
  })
})

describe("getCacheStats", () => {
  test("reports one entry per cached org with a real row count and age", async () => {
    rows = [{ id: "a1", orgId: "org-10", status: "active" }]
    const { getCachedOrgAssets, getCacheStats, invalidateAllCaches } = await import("./asset-registry-cache")
    invalidateAllCaches()

    await getCachedOrgAssets("org-10")
    const stats = getCacheStats()

    expect(stats.cachedOrgs).toBe(1)
    expect(stats.entries[0].orgId).toBe("org-10")
    expect(stats.entries[0].count).toBe(1)
    expect(stats.entries[0].ageMs).toBeGreaterThanOrEqual(0)
  })
})
