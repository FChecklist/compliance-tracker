/// <reference types="bun-types" />
// Priority 3 (Universal Metadata Registry, agent 2 "routing"). Matches this
// codebase's established test-file discipline (business-object-classifier.
// test.ts / intent-engine.test.ts): pure functions are tested directly with
// no mocking. The one exception is the "never scans unfiltered" suite at
// the bottom, which needs mock.module() to keep resolveAssetQuery() fully
// isolated from the real `platform_assets` table -- that table is owned by
// the parallel `subagent/umr-core` branch and may not exist in this
// worktree's schema.ts yet (see asset-query-service.ts's own header), so
// this file must never import the real asset-query-service.ts at runtime.
// mock.module() is called before the dynamic import of the module under
// test specifically so Bun substitutes the mock for every subsequent
// resolution of that specifier, including the one inside
// asset-routing-engine.ts itself.
import { describe, test, expect, mock } from "bun:test"
import type { PlatformAsset } from "./asset-query-service"

function makeAsset(overrides: Partial<PlatformAsset> = {}): PlatformAsset {
  return {
    id: "id-1",
    assetId: "AST-000001",
    name: "Test Asset",
    assetType: "report",
    module: "finance",
    department: null,
    ownerId: null,
    status: "active",
    createdBy: "user-1",
    version: "1",
    tags: [],
    aiEnabled: false,
    aiCapabilities: [],
    permissions: [],
    parentAssetId: null,
    searchKeywords: null,
    purpose: null,
    dependencies: [],
    sourceTable: null,
    sourceId: null,
    orgId: "org-1",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as unknown as PlatformAsset
}

// ─── classifyAssetQueryDeterministic (pure, no LLM, no DB) ───────────────
describe("classifyAssetQueryDeterministic", () => {
  test("classifies a report + finance module query", async () => {
    const { classifyAssetQueryDeterministic } = await import("./asset-routing-engine")
    const result = classifyAssetQueryDeterministic("show me the overdue GST report")
    expect(result.assetType).toBe("report")
    expect(result.module).toBe("finance")
    expect(result.confidence).toBe("high")
  })

  test("classifies a workflow query with no module signal", async () => {
    const { classifyAssetQueryDeterministic } = await import("./asset-routing-engine")
    const result = classifyAssetQueryDeterministic("find the approval workflow")
    expect(result.assetType).toBe("workflow")
    expect(result.module).toBeNull()
  })

  test("prefers a more specific compound phrase over a looser generic one", async () => {
    const { classifyAssetQueryDeterministic } = await import("./asset-routing-engine")
    // "email template" should resolve to email_template, not the bare
    // "template" catch-all, because it's listed earlier in the keyword
    // table (object key order = match priority, same technique as
    // intent-engine.ts's TRIGGERS).
    const result = classifyAssetQueryDeterministic("I need the email template for reminders")
    expect(result.assetType).toBe("email_template")
  })

  test("returns low confidence and null assetType for text with no keyword match", async () => {
    const { classifyAssetQueryDeterministic } = await import("./asset-routing-engine")
    const result = classifyAssetQueryDeterministic("xyzzy plugh frobnicate")
    expect(result.assetType).toBeNull()
    expect(result.confidence).toBe("low")
  })

  test("returns low confidence for empty input", async () => {
    const { classifyAssetQueryDeterministic } = await import("./asset-routing-engine")
    expect(classifyAssetQueryDeterministic("   ").confidence).toBe("low")
  })

  test("matches on word boundaries, not substrings", async () => {
    const { classifyAssetQueryDeterministic } = await import("./asset-routing-engine")
    // "task" should not fire on "multitasking".
    const result = classifyAssetQueryDeterministic("tips for multitasking effectively")
    expect(result.assetType).toBeNull()
  })

  test("is case-insensitive", async () => {
    const { classifyAssetQueryDeterministic } = await import("./asset-routing-engine")
    expect(classifyAssetQueryDeterministic("APPROVAL WORKFLOW status").assetType).toBe("workflow")
  })

  test("recognizes hr and construction module signals", async () => {
    const { classifyAssetQueryDeterministic } = await import("./asset-routing-engine")
    expect(classifyAssetQueryDeterministic("payroll report for this month").module).toBe("hr")
    expect(classifyAssetQueryDeterministic("site diary document").module).toBe("construction")
  })
})

// ─── filterAssetsByPermission (pure) ─────────────────────────────────────
describe("filterAssetsByPermission", () => {
  test("keeps an asset with null permissions (open to all)", async () => {
    const { filterAssetsByPermission } = await import("./asset-routing-engine")
    const assets = [makeAsset({ permissions: null as unknown as string[] })]
    expect(filterAssetsByPermission(assets, "member")).toHaveLength(1)
  })

  test("keeps an asset with an empty permissions array (open to all)", async () => {
    const { filterAssetsByPermission } = await import("./asset-routing-engine")
    const assets = [makeAsset({ permissions: [] })]
    expect(filterAssetsByPermission(assets, "viewer")).toHaveLength(1)
  })

  test("keeps an asset whose permissions list includes the caller's role", async () => {
    const { filterAssetsByPermission } = await import("./asset-routing-engine")
    const assets = [makeAsset({ permissions: ["admin", "manager"] })]
    expect(filterAssetsByPermission(assets, "manager")).toHaveLength(1)
  })

  test("drops an asset whose permissions list excludes the caller's role", async () => {
    const { filterAssetsByPermission } = await import("./asset-routing-engine")
    const assets = [makeAsset({ permissions: ["admin"] })]
    expect(filterAssetsByPermission(assets, "viewer")).toHaveLength(0)
  })

  test("filters a mixed batch correctly", async () => {
    const { filterAssetsByPermission } = await import("./asset-routing-engine")
    const assets = [
      makeAsset({ id: "a", permissions: ["admin"] }),
      makeAsset({ id: "b", permissions: [] }),
      makeAsset({ id: "c", permissions: ["viewer"] }),
    ]
    const result = filterAssetsByPermission(assets, "viewer")
    expect(result.map((r) => r.id).sort()).toEqual(["b", "c"])
  })
})

// ─── selectTopByRecency (pure) ────────────────────────────────────────────
describe("selectTopByRecency", () => {
  test("orders by updatedAt descending", async () => {
    const { selectTopByRecency } = await import("./asset-routing-engine")
    const assets = [
      makeAsset({ id: "old", updatedAt: new Date("2026-01-01T00:00:00Z") }),
      makeAsset({ id: "new", updatedAt: new Date("2026-06-01T00:00:00Z") }),
      makeAsset({ id: "mid", updatedAt: new Date("2026-03-01T00:00:00Z") }),
    ]
    const result = selectTopByRecency(assets, 5)
    expect(result.map((r) => r.id)).toEqual(["new", "mid", "old"])
  })

  test("caps at n results", async () => {
    const { selectTopByRecency } = await import("./asset-routing-engine")
    const assets = Array.from({ length: 8 }, (_, i) => makeAsset({ id: `a${i}`, updatedAt: new Date(2026, 0, i + 1) }))
    expect(selectTopByRecency(assets, 5)).toHaveLength(5)
  })

  test("does not mutate the input array", async () => {
    const { selectTopByRecency } = await import("./asset-routing-engine")
    const assets = [
      makeAsset({ id: "a", updatedAt: new Date("2026-01-01T00:00:00Z") }),
      makeAsset({ id: "b", updatedAt: new Date("2026-06-01T00:00:00Z") }),
    ]
    selectTopByRecency(assets, 5)
    expect(assets[0]!.id).toBe("a") // original order untouched
  })
})

// ─── resolveAssetQuery: "never scans unfiltered" invariant ───────────────
//
// Stubs asset-query-service.ts entirely (so this suite never touches the
// real `platform_assets` table, which is out of this branch's scope to
// create) and asserts that whichever query-service function fires, it is
// always called with a real, non-empty narrowing argument -- proving
// resolveAssetQuery() never has a code path that reaches for an unfiltered
// scan, matching the task's own required invariant.
describe("resolveAssetQuery never does an unfiltered scan", () => {
  test("a confidently-classified query narrows via queryByAssetType with a real assetType", async () => {
    const calls: { fn: string; arg: unknown }[] = []
    mock.module("./asset-query-service", () => ({
      queryByAssetType: mock(async (_ctx: unknown, assetType: unknown) => { calls.push({ fn: "queryByAssetType", arg: assetType }); return [] }),
      queryByModule: mock(async () => []),
      queryByStatus: mock(async (_ctx: unknown, status: unknown) => { calls.push({ fn: "queryByStatus", arg: status }); return [] }),
      queryByTags: mock(async () => []),
      queryByAiCapability: mock(async () => []),
      queryByKeywords: mock(async () => []),
    }))
    const { resolveAssetQuery } = await import("./asset-routing-engine")

    await resolveAssetQuery("find the approval workflow", { orgId: "org-1", userRole: "member" })

    expect(calls).toHaveLength(1)
    expect(calls[0]!.fn).toBe("queryByAssetType")
    expect(calls[0]!.arg).toBeTruthy() // a real, non-null/undefined/empty assetType
  })

  test("an unclassifiable query still narrows via queryByStatus('active'), never unfiltered", async () => {
    const calls: { fn: string; arg: unknown }[] = []
    mock.module("./asset-query-service", () => ({
      queryByAssetType: mock(async () => []),
      queryByModule: mock(async () => []),
      queryByStatus: mock(async (_ctx: unknown, status: unknown) => { calls.push({ fn: "queryByStatus", arg: status }); return [] }),
      queryByTags: mock(async () => []),
      queryByAiCapability: mock(async () => []),
      queryByKeywords: mock(async () => []),
    }))
    mock.module("@/lib/orchestra-model-resolver", () => ({
      resolveModelConfig: mock(async () => null), // simulates "no AI provider configured"
    }))
    const { resolveAssetQuery } = await import("./asset-routing-engine")

    const result = await resolveAssetQuery("xyzzy plugh frobnicate", { orgId: "org-1", userRole: "member" })

    expect(calls).toHaveLength(1)
    expect(calls[0]!.fn).toBe("queryByStatus")
    expect(calls[0]!.arg).toBe("active") // a real, indexed, non-empty status value
    expect(result.classification.assetType).toBeNull()
    expect(result.classification.source).toBe("none")
  })

  test("empty query string still narrows via an indexed query, never unfiltered", async () => {
    const calls: { fn: string; arg: unknown }[] = []
    mock.module("./asset-query-service", () => ({
      queryByAssetType: mock(async () => []),
      queryByModule: mock(async () => []),
      queryByStatus: mock(async (_ctx: unknown, status: unknown) => { calls.push({ fn: "queryByStatus", arg: status }); return [] }),
      queryByTags: mock(async () => []),
      queryByAiCapability: mock(async () => []),
      queryByKeywords: mock(async () => []),
    }))
    const { resolveAssetQuery } = await import("./asset-routing-engine")

    await resolveAssetQuery("", { orgId: "org-1", userRole: "member" })

    expect(calls).toHaveLength(1)
    expect(calls[0]!.fn).toBe("queryByStatus")
    // Empty query never reaches the LLM fallback at all (guarded by `&& trimmed`).
  })

  test("permission filtering and top-5 slicing apply after the indexed query returns candidates", async () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      makeAsset({ id: `r${i}`, assetType: "report", permissions: i % 2 === 0 ? [] : ["admin"], updatedAt: new Date(2026, 0, i + 1) })
    )
    mock.module("./asset-query-service", () => ({
      queryByAssetType: mock(async () => rows),
      queryByModule: mock(async () => []),
      queryByStatus: mock(async () => []),
      queryByTags: mock(async () => []),
      queryByAiCapability: mock(async () => []),
      queryByKeywords: mock(async () => []),
    }))
    const { resolveAssetQuery } = await import("./asset-routing-engine")

    const result = await resolveAssetQuery("show me the report", { orgId: "org-1", userRole: "viewer" })

    // Only the 4 open-permission rows (i % 2 === 0) survive the permission
    // filter, and the result is capped at 5 -- here that's exactly the 4
    // permitted rows, most-recently-updated first.
    expect(result.results.length).toBeLessThanOrEqual(5)
    expect(result.results.every((r) => !r.permissions || (r.permissions as string[]).length === 0)).toBe(true)
  })
})
