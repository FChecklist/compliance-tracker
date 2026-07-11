// tree4-unified/50-completion-plan area 3 "Guardrails", PLAN-16 re-scoped
// item (a): tests isSelfApproval() directly -- the pure predicate
// decideApprovalStep() delegates to -- rather than exercising
// decideApprovalStep()/POST /api/approval-workflows/steps/[id]/decide
// end-to-end, matching this repo's established pattern of not touching
// withTenantContext/a live DB from a .test.ts file (see task-service.test.ts
// and handover-protocol.test.ts's own notes on this).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { isSelfApproval } from "./approval-workflow-service"

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
