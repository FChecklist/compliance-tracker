import { describe, expect, test } from "bun:test"
import { COMPLIANCE_TOOL_CODES, dispatchComplianceTool } from "./compliance-tools"
import { GST_TOOL_CODES, dispatchGstTool } from "./gst-tools"
import { CONSTRUCTION_TOOL_CODES, dispatchConstructionTool } from "./construction-tools"

// VERIDIAN Review Framework gap-closure (AI Engineering Quality / Code
// Structure & Modularity): task-execution-engine.ts's dispatchTool() was
// split into these three domain modules (see their own file headers) --
// this test only checks the routing contract (the CODES sets are
// disjoint and cover the same code references the original single
// if-chain handled, and each dispatcher throws the same "No dispatcher
// implemented" shape for an unrecognized code) rather than re-testing
// business logic already covered by the existing route/service tests
// each domain's handlers delegate into.

describe("task-execution tool-dispatch split", () => {
  test("the three domain CODES sets are mutually disjoint", () => {
    const all = [...COMPLIANCE_TOOL_CODES, ...GST_TOOL_CODES, ...CONSTRUCTION_TOOL_CODES]
    expect(new Set(all).size).toBe(all.length)
  })

  test("COMPLIANCE_TOOL_CODES covers the original compliance-domain code references", () => {
    expect([...COMPLIANCE_TOOL_CODES].sort()).toEqual([
      "create_compliance_item",
      "get_compliance_stats",
      "get_overdue_items",
      "get_penalty_estimate",
      "get_task_status",
      "list_compliance_items",
      "list_departments",
      "list_notices",
      "update_compliance_status",
    ].sort())
  })

  test("GST_TOOL_CODES covers the original GST-reconciliation code references", () => {
    expect([...GST_TOOL_CODES].sort()).toEqual([
      "confirm_gst_batch",
      "generate_gst_ai_review",
      "generate_gst_return",
      "list_gst_import_batches",
      "list_gst_returns",
      "run_gst_reconciliation",
    ].sort())
  })

  test("CONSTRUCTION_TOOL_CODES covers the original construction-intelligence code references", () => {
    expect([...CONSTRUCTION_TOOL_CODES].sort()).toEqual([
      "detect_construction_budget_schedule_risk",
      "generate_construction_progress_summary",
      "get_construction_budget_status",
      "get_construction_kpi_status",
      "get_construction_project_dashboard",
      "list_delayed_activities",
      "list_over_budget_projects",
    ].sort())
  })

  test("dispatchComplianceTool throws the standard 'no dispatcher' error for an unrecognized code", async () => {
    await expect(
      dispatchComplianceTool({} as never, "org1", "user1", "not_a_real_code")
    ).rejects.toThrow("No dispatcher implemented for not_a_real_code")
  })

  test("dispatchGstTool throws the standard 'no dispatcher' error for an unrecognized code", async () => {
    await expect(
      dispatchGstTool({} as never, "org1", "user1", "not_a_real_code")
    ).rejects.toThrow("No dispatcher implemented for not_a_real_code")
  })

  test("dispatchConstructionTool throws the standard 'no dispatcher' error for an unrecognized code", async () => {
    await expect(
      dispatchConstructionTool("org1", "user1", "not_a_real_code")
    ).rejects.toThrow("No dispatcher implemented for not_a_real_code")
  })
})
