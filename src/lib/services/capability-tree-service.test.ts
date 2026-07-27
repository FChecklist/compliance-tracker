/// <reference types="bun-types" />
// Wave 173 (chain-integration for reports): tests markDeterministic()'s
// handling of the new reportUrl leaf kind -- buildCapabilityTree() itself
// and its DB-touching node builders (incl. buildReportLinkNodes) are
// deliberately left untested here, matching this repo's established
// pattern of not exercising withTenantContext/a live DB from a .test.ts
// file (see task-service.test.ts's own note).
import { describe, expect, test } from "bun:test"
import { markDeterministic, GENERIC_ENTITY_ACTIONS, GENERIC_PRODUCT_ACTIONS, type CapabilityNode } from "./capability-tree-service"

// fix-veri-erp-product-chain-bug--shows-pr (2026-07-27): buildProductNodes()
// used to source the "Product" chain-selector branch from `products`/
// `projects` (an unrelated PMS product-line/project grouping), so selecting
// a real ERP Product surfaced Project rows and project-management actions
// (Status update/Log a task/Flag a risk) instead of product-management
// ones. Fixed to source from erpItems and a new GENERIC_PRODUCT_ACTIONS leaf
// set, mirroring how Customer/Vendor already source from
// erpCustomers/erpSuppliers + GENERIC_ENTITY_ACTIONS. buildProductNodes()
// itself stays untested here per this file's own DB-touching convention
// (see header note) -- these tests cover the exported leaf-set constants
// buildProductNodes/buildEntityNodes attach to each item/entity, which is
// exactly the part of the bug (wrong action set) a DB-free test can pin.
describe("GENERIC_PRODUCT_ACTIONS -- Product branch leaf set (regression: no longer Project actions)", () => {
  test("carries product-management actions, not the old project-management leaf set", () => {
    const labels = GENERIC_PRODUCT_ACTIONS.map((a) => a.label)
    expect(labels).toEqual(["Update price/stock", "Create a quotation"])
    expect(labels).not.toContain("Status update")
    expect(labels).not.toContain("Log a task")
    expect(labels).not.toContain("Flag a risk")
  })

  test("no leaf carries a projectId -- confirms these no longer resolve to Project-scoped dispatch", () => {
    for (const action of GENERIC_PRODUCT_ACTIONS) {
      expect(action.projectId).toBeUndefined()
    }
  })

  test("every leaf is a real leaf node (leaf: true), same shape as GENERIC_ENTITY_ACTIONS", () => {
    for (const action of GENERIC_PRODUCT_ACTIONS) {
      expect(action.leaf).toBe(true)
    }
  })

  test("falls through markDeterministic() to the AI-planned path, same as Customer/Vendor's generic actions (no codeReference/engineKey fabricated)", () => {
    const nodes: CapabilityNode[] = [{ key: "product", label: "Product", leaf: false, children: [
      { key: "item1", label: "Some Item", leaf: false, children: [...GENERIC_PRODUCT_ACTIONS] },
    ] }]
    markDeterministic(nodes)
    for (const leaf of nodes[0].children![0].children!) {
      expect(leaf.deterministic).toBe(false)
    }
  })
})

describe("GENERIC_ENTITY_ACTIONS -- Customer/Vendor branch leaf set (regression guard, must stay untouched by the Product fix)", () => {
  test("still exactly Invoice preparation / Send reminder / GST filing", () => {
    expect(GENERIC_ENTITY_ACTIONS.map((a) => a.label)).toEqual(["Invoice preparation", "Send reminder", "GST filing"])
  })

  test("is a distinct array/object identity from GENERIC_PRODUCT_ACTIONS -- the two entity types never share a leaf set", () => {
    expect(GENERIC_ENTITY_ACTIONS).not.toBe(GENERIC_PRODUCT_ACTIONS)
    for (const entityAction of GENERIC_ENTITY_ACTIONS) {
      expect(GENERIC_PRODUCT_ACTIONS.some((p) => p.key === entityAction.key)).toBe(false)
    }
  })
})

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
