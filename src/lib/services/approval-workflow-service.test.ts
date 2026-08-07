// tree4-unified/50-completion-plan area 3 "Guardrails", PLAN-16 re-scoped
// item (a): tests isSelfApproval() directly -- the pure predicate
// decideApprovalStep() delegates to -- rather than exercising
// decideApprovalStep()/POST /api/approval-workflows/steps/[id]/decide
// end-to-end, matching this repo's established pattern of not touching
// withTenantContext/a live DB from a .test.ts file (see task-service.test.ts
// and handover-protocol.test.ts's own notes on this).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { isSelfApproval, detectCriticalActionCategory, enforceFourEyesFloor } from "./approval-workflow-service"

describe("isSelfApproval -- Authority/Delegation guardrail beyond role-rank", () => {
  test("flags the same user approving their own submitted instance", () => {
    expect(isSelfApproval("user_1", "user_1")).toBe(true)
  })

  test("does not flag a different approver", () => {
    expect(isSelfApproval("user_1", "user_2")).toBe(false)
  })

  test("does not flag when the instance has no recorded creator (legacy/seeded rows)", () => {
    expect(isSelfApproval(null, "user_2")).toBe(false)
  })
})

// Checks & Balances / Four-Eyes cross-wire: high-impact-action-detector.ts's
// 9 categories flooring requiredApprovals to 2 for named critical actions.
describe("detectCriticalActionCategory", () => {
  test("detects a payment step by name", () => {
    expect(detectCriticalActionCategory("erp_expense_reimbursement", "Release payment")).toBe("payment")
  })

  test("detects a delete/disposal entityType even with a generic step name", () => {
    expect(detectCriticalActionCategory("erp_asset_disposal", "Final review")).toBe("delete")
  })

  test("detects a compliance submission step", () => {
    expect(detectCriticalActionCategory("gst_filing", "Submit compliance filing")).toBe("compliance_submission")
  })

  test("returns null for a step with no high-impact category", () => {
    expect(detectCriticalActionCategory("erp_sales_order", "Manager sign-off")).toBeNull()
  })
})

describe("enforceFourEyesFloor", () => {
  test("floors a single-approver critical-category step to 2", () => {
    expect(enforceFourEyesFloor("erp_journal_entry", "Payment approval", 1)).toBe(2)
  })

  test("does not lower a step that already requires more than 2", () => {
    expect(enforceFourEyesFloor("erp_journal_entry", "Payment approval", 3)).toBe(3)
  })

  test("leaves a non-critical step's requiredApprovals untouched", () => {
    expect(enforceFourEyesFloor("erp_sales_order", "Manager sign-off", 1)).toBe(1)
  })
})
