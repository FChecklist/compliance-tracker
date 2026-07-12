// Priority 3 UMR (tree4-unified/50-completion-plan/08-priority3-umr-tracker.yaml,
// agent 1/umr-core). Tests the pure decision functions
// validateRegisterAssetInput() and resolveOrgFilterMode() directly --
// registerAsset()/listAssetsByType()/etc. delegate to these but also touch
// a live DB, so exercising them end-to-end would break this repo's
// established pattern of not touching a live DB from a .test.ts file (see
// task-service.test.ts, approval-workflow-service.test.ts).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { validateRegisterAssetInput, resolveOrgFilterMode, sortByCreatedAtDesc, type RegisterAssetInput } from "./asset-registry-service"

function validInput(overrides: Partial<RegisterAssetInput> = {}): RegisterAssetInput {
  return {
    name: "GST Split Engine",
    assetType: "computation_engine",
    sourceTable: "computation_engines",
    sourceId: "ce_123",
    ...overrides,
  }
}

describe("validateRegisterAssetInput -- required-field gate for the UMR compiler-at-build-time hook", () => {
  test("a fully-formed input passes", () => {
    expect(validateRegisterAssetInput(validInput())).toEqual({ valid: true })
  })

  test("rejects a blank name", () => {
    const result = validateRegisterAssetInput(validInput({ name: "" }))
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("name")
  })

  test("rejects a whitespace-only name", () => {
    const result = validateRegisterAssetInput(validInput({ name: "   " }))
    expect(result.valid).toBe(false)
  })

  test("rejects a missing assetType", () => {
    // @ts-expect-error deliberately omitting a required field to exercise the guard
    const result = validateRegisterAssetInput(validInput({ assetType: undefined }))
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("assetType")
  })

  test("rejects a blank sourceTable -- platform_assets is a metadata index, it must always point at a real owning table", () => {
    const result = validateRegisterAssetInput(validInput({ sourceTable: "" }))
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("sourceTable")
  })

  test("rejects a blank sourceId", () => {
    const result = validateRegisterAssetInput(validInput({ sourceId: "  " }))
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("sourceId")
  })

  test("optional fields (module, orgId, tags, etc.) being absent does not fail validation", () => {
    expect(validateRegisterAssetInput(validInput())).toEqual({ valid: true })
  })
})

describe("resolveOrgFilterMode -- distinguishes 'no org filter' from 'platform-tier only' from 'this org'", () => {
  test("undefined orgId means no filter at all (list across every org)", () => {
    expect(resolveOrgFilterMode(undefined)).toEqual({ mode: "none" })
  })

  test("explicit null orgId means platform-tier assets only -- not the same as 'no filter'", () => {
    expect(resolveOrgFilterMode(null)).toEqual({ mode: "platform-only" })
  })

  test("a real orgId string scopes to that org", () => {
    expect(resolveOrgFilterMode("org_abc")).toEqual({ mode: "org", orgId: "org_abc" })
  })

  test("null and undefined resolve to genuinely different modes (the eq(col, null) SQL trap this guards against)", () => {
    expect(resolveOrgFilterMode(null)).not.toEqual(resolveOrgFilterMode(undefined))
  })
})

describe("sortByCreatedAtDesc -- newest-first ordering used by the list* helpers", () => {
  test("orders newest first", () => {
    const rows = [
      { id: "a", createdAt: new Date("2026-01-01") },
      { id: "b", createdAt: new Date("2026-06-01") },
      { id: "c", createdAt: new Date("2026-03-01") },
    ]
    expect(sortByCreatedAtDesc(rows).map((r) => r.id)).toEqual(["b", "c", "a"])
  })

  test("does not mutate the input array", () => {
    const rows = [{ id: "a", createdAt: new Date("2026-01-01") }, { id: "b", createdAt: new Date("2026-06-01") }]
    const original = [...rows]
    sortByCreatedAtDesc(rows)
    expect(rows).toEqual(original)
  })

  test("empty array in, empty array out", () => {
    expect(sortByCreatedAtDesc([])).toEqual([])
  })
})
