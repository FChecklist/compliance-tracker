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
import { resolveDelegatedAuthority } from "./delegation-service"
import { ROLE_RANK } from "@/lib/supabase/auth-guard"

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

// V2-11 delegation-expiry-enforcement-audit: decideApprovalStep() is a real
// (non-listing) authorization checkpoint -- when a decider's role rank is
// insufficient, it now falls back to isDelegated() (scopeType
// 'approval_type', scopeId = the instance's entityType) before rejecting.
// isDelegated() itself touches the DB and isn't tested here (matches this
// file's own established pattern above), but the exact decision logic it
// composes -- resolveDelegatedAuthority() -- is pure and exercised here
// with the same rank-insufficient premise decideApprovalStep only reaches
// this branch under, proving an EXPIRED delegation does NOT rescue a
// rank-insufficient decider.
describe("decideApprovalStep's delegation fallback (via resolveDelegatedAuthority)", () => {
  const NOW = new Date("2026-07-26T12:00:00Z")
  const PAST = new Date("2026-07-01T00:00:00Z")
  const FUTURE = new Date("2026-08-01T00:00:00Z")

  test("a rank-insufficient decider stays rejected when their only delegation is expired", () => {
    const userRank = ROLE_RANK["member" as keyof typeof ROLE_RANK]
    const requiredRank = ROLE_RANK["manager" as keyof typeof ROLE_RANK]
    expect(userRank).toBeLessThan(requiredRank)

    const expiredDelegation = { revokedAt: null, expiresAt: PAST, delegateUserId: "user_2", delegateRoleKey: null }
    const delegated = resolveDelegatedAuthority([expiredDelegation], "user_2", ["member"], NOW)
    expect(delegated).toBe(false)
  })

  test("a rank-insufficient decider is granted authority by an active, non-expired delegation", () => {
    const userRank = ROLE_RANK["member" as keyof typeof ROLE_RANK]
    const requiredRank = ROLE_RANK["manager" as keyof typeof ROLE_RANK]
    expect(userRank).toBeLessThan(requiredRank)

    const activeDelegation = { revokedAt: null, expiresAt: FUTURE, delegateUserId: "user_2", delegateRoleKey: null }
    const delegated = resolveDelegatedAuthority([activeDelegation], "user_2", ["member"], NOW)
    expect(delegated).toBe(true)
  })

  test("a revoked delegation does not grant authority even before its expiresAt", () => {
    const revokedDelegation = { revokedAt: PAST, expiresAt: FUTURE, delegateUserId: "user_2", delegateRoleKey: null }
    expect(resolveDelegatedAuthority([revokedDelegation], "user_2", ["member"], NOW)).toBe(false)
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
