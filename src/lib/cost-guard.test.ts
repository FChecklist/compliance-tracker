/// <reference types="bun-types" />
// AI Cost Governance & FinOps gap-closure (2026-07-18): unit coverage for
// classifyCostBreach(), the pure decision core checkCostCeilingBreaches()
// delegates to -- same "extract the pure predicate, test it without a DB"
// convention as task-service.test.ts's isTaskOverdue coverage. The DB-driven
// half (checkCostCeilingBreaches itself, getCostStatus, canIncurCost) is
// deliberately not exercised here, matching this codebase's own established
// posture for cron-entry-point functions (checkTicketSlaBreaches/
// checkTaskOverdue have no direct tests either -- only their pure cores do).
import { describe, test, expect } from "bun:test"
import { classifyCostBreach } from "./cost-guard"

describe("classifyCostBreach", () => {
  test("over limit takes priority over near limit (both true)", () => {
    expect(classifyCostBreach({ isOverLimit: true, isNearLimit: true })).toBe("over")
  })

  test("near limit only", () => {
    expect(classifyCostBreach({ isOverLimit: false, isNearLimit: true })).toBe("near")
  })

  test("neither -- no breach", () => {
    expect(classifyCostBreach({ isOverLimit: false, isNearLimit: false })).toBe("none")
  })
})
