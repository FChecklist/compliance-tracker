/// <reference types="bun-types" />
// Wave 173 (chain-integration for reports): tests markDeterministic()'s
// handling of the new reportUrl leaf kind -- buildCapabilityTree() itself
// and its DB-touching node builders (incl. buildReportLinkNodes) are
// deliberately left untested here, matching this repo's established
// pattern of not exercising withTenantContext/a live DB from a .test.ts
// file (see task-service.test.ts's own note).
import { describe, expect, test } from "bun:test"
import { markDeterministic, type CapabilityNode } from "./capability-tree-service"

describe("markDeterministic -- report_link leaf kind", () => {
  test("a reportUrl leaf is marked deterministic, same as codeReference/engineKey leaves", () => {
    const nodes: CapabilityNode[] = [{ key: "saved_report::1", label: "My Report", leaf: true, reportUrl: "/reports?report=1" }]
    markDeterministic(nodes)
    expect(nodes[0].deterministic).toBe(true)
  })

  test("a leaf with none of codeReference/engineKey/reportUrl is not deterministic", () => {
    const nodes: CapabilityNode[] = [{ key: "free_text_leaf", label: "Something", leaf: true }]
    markDeterministic(nodes)
    expect(nodes[0].deterministic).toBe(false)
  })

  test("recurses into children of non-leaf nodes, e.g. the Reports branch", () => {
    const nodes: CapabilityNode[] = [{
      key: "reports", label: "Reports", leaf: false,
      children: [{ key: "compliance_reports_analytics", label: "Compliance Reports & Analytics", leaf: true, reportUrl: "/reports" }],
    }]
    markDeterministic(nodes)
    expect(nodes[0].children?.[0].deterministic).toBe(true)
  })
})
