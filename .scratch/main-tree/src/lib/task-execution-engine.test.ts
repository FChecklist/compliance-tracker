/// <reference types="bun-types" />
// Priority 6 (UMR <-> Software Orchestrator integration): unit tests for
// task-execution-engine.ts's one exported pure function, buildNovelUmrHint().
// Everything else in this file is DB/LLM-touching (executeTask() itself,
// dispatchEngine(), executePackageDispatch(), etc.) and stays untested here,
// matching this codebase's established convention (see
// capability-audit-service.test.ts's own stated precedent for the same
// DB-touching-vs-pure split). This is deliberately the first test file for
// task-execution-engine.ts -- it only covers the one new pure decision this
// integration adds, not a retrofit of the rest of the module.
import { describe, test, expect } from "bun:test"
import { buildNovelUmrHint } from "./task-execution-engine"
import type { PlatformAsset } from "./services/asset-query-service"

function makeAsset(overrides: Partial<PlatformAsset> = {}): PlatformAsset {
  return {
    id: "id-1",
    assetId: "AST-000001",
    name: "GST Penalty Calculator",
    assetType: "computation_engine",
    module: "finance",
    department: null,
    ownerId: null,
    status: "active",
    createdBy: null,
    version: "1.0",
    tags: [],
    aiEnabled: false,
    aiCapabilities: [],
    permissions: [],
    parentAssetId: null,
    searchKeywords: null,
    purpose: "Computes GST late-filing penalties",
    dependencies: [],
    sourceTable: "computation_engines",
    sourceId: "eng-1",
    orgId: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as unknown as PlatformAsset
}

describe("buildNovelUmrHint", () => {
  test("returns null for an empty match list", () => {
    expect(buildNovelUmrHint([])).toBeNull()
  })

  test("returns null when every candidate is inactive (draft/archived/deleted)", () => {
    const matches = [makeAsset({ status: "draft" }), makeAsset({ status: "archived" })]
    expect(buildNovelUmrHint(matches)).toBeNull()
  })

  test("builds a hint from the first active candidate, naming its asset id and name", () => {
    const matches = [makeAsset({ status: "draft" }), makeAsset({ status: "active", name: "GST Penalty Calculator", assetId: "AST-000042" })]
    const hint = buildNovelUmrHint(matches)
    expect(hint).not.toBeNull()
    expect(hint).toContain("GST Penalty Calculator")
    expect(hint).toContain("AST-000042")
    expect(hint).toContain("computation_engine")
  })

  test("includes the asset's purpose when present", () => {
    const hint = buildNovelUmrHint([makeAsset({ purpose: "Computes GST late-filing penalties" })])
    expect(hint).toContain("Computes GST late-filing penalties")
  })

  test("omits a purpose clause when purpose is null, without throwing", () => {
    const hint = buildNovelUmrHint([makeAsset({ purpose: null })])
    expect(hint).not.toBeNull()
    expect(() => buildNovelUmrHint([makeAsset({ purpose: null })])).not.toThrow()
  })

  test("is explicit that it's a hint, not a directive -- never tells the planner to stop or skip the plan", () => {
    const hint = buildNovelUmrHint([makeAsset()])!
    expect(hint.toLowerCase()).toContain("hint only")
    expect(hint.toLowerCase()).not.toContain("do not proceed")
  })

  test("picks the first active candidate over a later one (queryByKeywords' own ts_rank ordering)", () => {
    const first = makeAsset({ assetId: "AST-000010", name: "First Match" })
    const second = makeAsset({ assetId: "AST-000020", name: "Second Match" })
    const hint = buildNovelUmrHint([first, second])
    expect(hint).toContain("First Match")
    expect(hint).not.toContain("Second Match")
  })
})
