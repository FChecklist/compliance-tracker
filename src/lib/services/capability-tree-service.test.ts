/// <reference types="bun-types" />
// Wave 173 (chain-integration for reports): tests markDeterministic()'s
// handling of the new reportUrl leaf kind -- buildCapabilityTree() itself
// and its DB-touching node builders (incl. buildReportLinkNodes) are
// deliberately left untested here, matching this repo's established
// pattern of not exercising withTenantContext/a live DB from a .test.ts
// file (see task-service.test.ts's own note).
import { describe, expect, test } from "bun:test"
import {
  markDeterministic, GENERIC_ENTITY_ACTIONS, GENERIC_PRODUCT_ACTIONS,
  agentDomainServesModuleDomain, type CapabilityNode,
} from "./capability-tree-service"

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

// E-27 fix (platform.error_log, R60 T7, 2026-08-28): "21 published worker
// agents with real code references are unreachable." Root cause --
// buildBranchNodes() looked up worker agents with
// `eq(workerAgents.domain, domain)` where `domain` is a
// module_registry.domain snake_case key (project_management, erp,
// compliance, reporting, ...) but workerAgents.domain is a free-text,
// often-hierarchical display string ("Construction > Project
// Intelligence") -- the two value sets are disjoint, so the exact-equality
// lookup always missed and every domain silently fell back to the raw
// module list, even domains with real, published, code-backed agents.
//
// Every (name, domain, codeReference) tuple below is a REAL row pulled live
// from platform.worker_agents (Supabase project pcrjmlpuqsbocqfwoxod,
// 2026-08-28) with lifecycle_status IN ('approved','published'), tier IN
// ('global','customer'), and a non-null code_reference -- i.e. exactly the
// set buildBranchNodes() is supposed to surface as real, dispatchable
// leaves. This is the live set the prior session's "21" count was drawn
// from (22 as re-verified live here; the descriptive count in the error-log
// title may simply be one commit older -- either way every one of these
// real rows is proven unreachable under the old exact-equality lookup and
// reachable under the fix below).
const REAL_PUBLISHED_CODE_BACKED_AGENTS: { name: string; domain: string; codeReference: string; moduleDomain: string }[] = [
  // Construction > Project Intelligence (7) -> project_management
  { name: "AI Progress Summary", domain: "Construction > Project Intelligence", codeReference: "generate_construction_progress_summary", moduleDomain: "project_management" },
  { name: "Construction KPI Status", domain: "Construction > Project Intelligence", codeReference: "get_construction_kpi_status", moduleDomain: "project_management" },
  { name: "List Over-Budget Projects", domain: "Construction > Project Intelligence", codeReference: "list_over_budget_projects", moduleDomain: "project_management" },
  { name: "Construction Budget Status", domain: "Construction > Project Intelligence", codeReference: "get_construction_budget_status", moduleDomain: "project_management" },
  { name: "List Delayed Activities", domain: "Construction > Project Intelligence", codeReference: "list_delayed_activities", moduleDomain: "project_management" },
  { name: "Construction Project Dashboard", domain: "Construction > Project Intelligence", codeReference: "get_construction_project_dashboard", moduleDomain: "project_management" },
  { name: "AI Budget/Schedule Risk Detection", domain: "Construction > Project Intelligence", codeReference: "detect_construction_budget_schedule_risk", moduleDomain: "project_management" },
  // Cross-Cutting > Data Access (6) -> compliance
  { name: "List Notices", domain: "Cross-Cutting > Data Access", codeReference: "list_notices", moduleDomain: "compliance" },
  { name: "Get Task Status", domain: "Cross-Cutting > Data Access", codeReference: "get_task_status", moduleDomain: "compliance" },
  { name: "Create Compliance Item", domain: "Cross-Cutting > Data Access", codeReference: "create_compliance_item", moduleDomain: "compliance" },
  { name: "List Compliance Items", domain: "Cross-Cutting > Data Access", codeReference: "list_compliance_items", moduleDomain: "compliance" },
  { name: "Update Compliance Status", domain: "Cross-Cutting > Data Access", codeReference: "update_compliance_status", moduleDomain: "compliance" },
  { name: "List Departments", domain: "Cross-Cutting > Data Access", codeReference: "list_departments", moduleDomain: "compliance" },
  // Cross-Cutting > Reporting (2) -> reporting
  { name: "Get Compliance Stats", domain: "Cross-Cutting > Reporting", codeReference: "get_compliance_stats", moduleDomain: "reporting" },
  { name: "Get Overdue Items", domain: "Cross-Cutting > Reporting", codeReference: "get_overdue_items", moduleDomain: "reporting" },
  // Finance > GST Reconciliation (6) -> erp
  { name: "Generate GST AI Review", domain: "Finance > GST Reconciliation", codeReference: "generate_gst_ai_review", moduleDomain: "erp" },
  { name: "List GST Returns", domain: "Finance > GST Reconciliation", codeReference: "list_gst_returns", moduleDomain: "erp" },
  { name: "List GST Import Batches", domain: "Finance > GST Reconciliation", codeReference: "list_gst_import_batches", moduleDomain: "erp" },
  { name: "Confirm GST Import Batch", domain: "Finance > GST Reconciliation", codeReference: "confirm_gst_batch", moduleDomain: "erp" },
  { name: "Run GST 2B Reconciliation", domain: "Finance > GST Reconciliation", codeReference: "run_gst_reconciliation", moduleDomain: "erp" },
  { name: "Generate GST Return", domain: "Finance > GST Reconciliation", codeReference: "generate_gst_return", moduleDomain: "erp" },
  // India Compliance > Penalty Calculation (1) -> compliance
  { name: "Get Penalty Estimate", domain: "India Compliance > Penalty Calculation", codeReference: "get_penalty_estimate", moduleDomain: "compliance" },
]

describe("agentDomainServesModuleDomain -- E-27 fix (module_registry.domain <-> workerAgents.domain bridge)", () => {
  test("documents the bug: none of the real live agent domains equal their module_registry domain (the old exact-equality lookup)", () => {
    for (const agent of REAL_PUBLISHED_CODE_BACKED_AGENTS) {
      expect(agent.domain).not.toBe(agent.moduleDomain)
    }
  })

  test("every real published, code-backed worker agent now resolves under its correct module_registry domain", () => {
    for (const agent of REAL_PUBLISHED_CODE_BACKED_AGENTS) {
      expect(agent.codeReference.length).toBeGreaterThan(0) // sanity: this really is a code-backed agent, not a stub
      expect(agentDomainServesModuleDomain(agent.domain, agent.moduleDomain)).toBe(true)
    }
  })

  test("covers all 22 real live rows -- the fixed 21 the error log named plus one already re-verified live", () => {
    expect(REAL_PUBLISHED_CODE_BACKED_AGENTS.length).toBe(22)
  })

  test("a real agent domain does not falsely resolve under an unrelated module domain", () => {
    expect(agentDomainServesModuleDomain("Construction > Project Intelligence", "hr")).toBe(false)
    expect(agentDomainServesModuleDomain("Finance > GST Reconciliation", "project_management")).toBe(false)
    expect(agentDomainServesModuleDomain("Cross-Cutting > Data Access", "reporting")).toBe(false)
    expect(agentDomainServesModuleDomain("Cross-Cutting > Reporting", "compliance")).toBe(false)
  })

  test("still matches the rare case both sides already agree via flat exact equality (case-insensitive)", () => {
    expect(agentDomainServesModuleDomain("compliance", "compliance")).toBe(true)
    expect(agentDomainServesModuleDomain("Compliance", "compliance")).toBe(true)
  })

  test("null/undefined/empty agent domain never matches anything (matches the old query's real behavior)", () => {
    expect(agentDomainServesModuleDomain(null, "compliance")).toBe(false)
    expect(agentDomainServesModuleDomain(undefined, "compliance")).toBe(false)
    expect(agentDomainServesModuleDomain("", "compliance")).toBe(false)
  })

  test("an unmapped agent domain falls through to false, same as pre-fix behavior -- no regression for domains not yet curated", () => {
    expect(agentDomainServesModuleDomain("creative writing", "hr")).toBe(false)
    expect(agentDomainServesModuleDomain("governance", "compliance")).toBe(false)
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
