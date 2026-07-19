/// <reference types="bun-types" />
// DMP-04 gap closure (CONSTITUTION.yaml): tests buildDynamicChainProposalFields()
// directly, the pure function proposeDynamicChain() delegates to for shaping
// the dynamicChains rich-metadata columns (linkedModuleRefs/businessRules/
// permissions/workflowStepsConfig/reportsKpisSlas/classification), rather
// than exercising proposeDynamicChain() end-to-end, matching this repo's
// established pattern of not touching a live DB from a .test.ts file (see
// worker-agent-service.test.ts's own note on this).
//
// DMP-06 gap closure (CONSTITUTION.yaml, "Dynamic Chain Master Directory"):
// same reasoning applies to selectDuplicateChainMatch() (the duplicate-
// detection decision proposeDynamicChain() now makes BEFORE ever hitting the
// DB) and buildChainModuleEdges() (the dynamic_chain->module graph-edge
// builder) -- both are pure and DB-free, extracted the same way
// buildDynamicChainProposalFields() already was.
import { describe, expect, test } from "bun:test"
import { buildDynamicChainProposalFields, selectDuplicateChainMatch, buildChainModuleEdges } from "./dynamic-chain-directory-service"
import type { CapabilityMatch } from "./capability-registry-service"

describe("buildDynamicChainProposalFields -- DMP-04 Dynamic Chain bundle scaffolding", () => {
  test("shapes a full LLM-drafted proposal into the real dynamicChains column shapes", () => {
    const fields = buildDynamicChainProposalFields({
      moduleRef: "gst-reconciliation",
      domain: "Finance > GST Reconciliation",
      businessRules: ["Never auto-file a return without human sign-off"],
      permissions: ["admin"],
      workflowSteps: ["Fetch canonical invoices", "Reconcile against GSTR-2B", "Flag mismatches"],
      kpis: [{ label: "Reconciliation accuracy", target: "99%" }],
      fallbackPermissionRole: "admin",
    })

    expect(fields.linkedModuleRefs).toEqual(["gst-reconciliation"])
    expect(fields.businessRules).toEqual({ rules: ["Never auto-file a return without human sign-off"] })
    expect(fields.permissions).toEqual({ requiredRoles: ["admin"] })
    expect(fields.workflowStepsConfig).toEqual({ steps: ["Fetch canonical invoices", "Reconcile against GSTR-2B", "Flag mismatches"] })
    expect(fields.reportsKpisSlas).toEqual({ kpis: [{ label: "Reconciliation accuracy", target: "99%" }] })
    expect(fields.classification).toEqual({ domain: "Finance > GST Reconciliation" })
  })

  test("never ships a chain with zero permission gate -- falls back to the tier-derived role when the LLM omitted permissions", () => {
    const fields = buildDynamicChainProposalFields({
      domain: "Construction > Site Safety",
      fallbackPermissionRole: "user",
    })
    expect(fields.permissions).toEqual({ requiredRoles: ["user"] })
  })

  test("null-shapes every optional sub-object the LLM left empty, rather than persisting an empty array/object", () => {
    const fields = buildDynamicChainProposalFields({ fallbackPermissionRole: "admin" })
    expect(fields.linkedModuleRefs).toEqual([])
    expect(fields.businessRules).toBeNull()
    expect(fields.workflowStepsConfig).toBeNull()
    expect(fields.reportsKpisSlas).toBeNull()
    expect(fields.classification).toEqual({ domain: null })
    // permissions is the one field that's never null -- see the fallback test above
    expect(fields.permissions).toEqual({ requiredRoles: ["admin"] })
  })

  test("trims whitespace and drops blank entries from every string list, and drops a KPI with no real label", () => {
    const fields = buildDynamicChainProposalFields({
      moduleRef: "  finance  ",
      businessRules: [" Rule A ", "", "  "],
      permissions: ["admin", " ", ""],
      workflowSteps: [" Step 1 ", ""],
      kpis: [{ label: "  ", target: "x" }, { label: "Real KPI", target: "10" }],
      fallbackPermissionRole: "user",
    })

    expect(fields.linkedModuleRefs).toEqual(["finance"])
    expect(fields.businessRules).toEqual({ rules: ["Rule A"] })
    expect(fields.permissions).toEqual({ requiredRoles: ["admin"] })
    expect(fields.workflowStepsConfig).toEqual({ steps: ["Step 1"] })
    expect(fields.reportsKpisSlas).toEqual({ kpis: [{ label: "Real KPI", target: "10" }] })
  })
})

function makeMatch(overrides: Partial<CapabilityMatch> = {}): CapabilityMatch {
  return { entityType: "dynamic_chain", entityId: "chain_1", score: 0.5, content: "GST Reconciliation", ...overrides }
}

describe("selectDuplicateChainMatch -- DMP-06 duplicate-detection gate", () => {
  test("returns the top candidate when its score clears the duplicate threshold", () => {
    const match = makeMatch({ score: 0.97 })
    expect(selectDuplicateChainMatch([match])).toEqual(match)
  })

  test("returns null when the top candidate is below the duplicate threshold", () => {
    const match = makeMatch({ score: 0.6 })
    expect(selectDuplicateChainMatch([match])).toBeNull()
  })

  test("returns null when there are no candidates at all", () => {
    expect(selectDuplicateChainMatch([])).toBeNull()
  })

  test("is inclusive at exactly the threshold boundary", () => {
    const match = makeMatch({ score: 0.92 })
    expect(selectDuplicateChainMatch([match])).toEqual(match)
  })

  test("only ever considers the top-ranked candidate, never a lower-ranked one", () => {
    const top = makeMatch({ entityId: "chain_low", score: 0.4 })
    const second = makeMatch({ entityId: "chain_high", score: 0.99 })
    expect(selectDuplicateChainMatch([top, second])).toBeNull()
  })

  test("respects a custom threshold override", () => {
    const match = makeMatch({ score: 0.8 })
    expect(selectDuplicateChainMatch([match], 0.75)).toEqual(match)
    expect(selectDuplicateChainMatch([match], 0.85)).toBeNull()
  })
})

describe("buildChainModuleEdges -- DMP-06 dynamic_chain->module graph edges", () => {
  test("builds one edge per module ref", () => {
    const edges = buildChainModuleEdges("org_1", "chain_1", ["gst-reconciliation", "payroll"])
    expect(edges).toEqual([
      { orgId: "org_1", sourceType: "dynamic_chain", sourceId: "chain_1", targetType: "module", targetId: "gst-reconciliation", relationshipType: "requires_module" },
      { orgId: "org_1", sourceType: "dynamic_chain", sourceId: "chain_1", targetType: "module", targetId: "payroll", relationshipType: "requires_module" },
    ])
  })

  test("returns an empty array for an empty module ref list", () => {
    expect(buildChainModuleEdges("org_1", "chain_1", [])).toEqual([])
  })

  test("drops blank/whitespace-only refs and dedupes repeats", () => {
    const edges = buildChainModuleEdges("org_1", "chain_1", ["finance", "  ", "finance", "", "finance "])
    expect(edges).toEqual([
      { orgId: "org_1", sourceType: "dynamic_chain", sourceId: "chain_1", targetType: "module", targetId: "finance", relationshipType: "requires_module" },
    ])
  })
})
