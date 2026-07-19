/// <reference types="bun-types" />
// DMP-04 gap closure (CONSTITUTION.yaml): tests buildDynamicChainProposalFields()
// directly, the pure function proposeDynamicChain() delegates to for shaping
// the dynamicChains rich-metadata columns (linkedModuleRefs/businessRules/
// permissions/workflowStepsConfig/reportsKpisSlas/classification), rather
// than exercising proposeDynamicChain() end-to-end, matching this repo's
// established pattern of not touching a live DB from a .test.ts file (see
// worker-agent-service.test.ts's own note on this).
import { describe, expect, test } from "bun:test"
import { buildDynamicChainProposalFields } from "./dynamic-chain-directory-service"

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
