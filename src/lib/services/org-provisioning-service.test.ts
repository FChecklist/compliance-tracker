/// <reference types="bun-types" />
// AI Cost Governance & FinOps gap-closure (2026-07-18): unit coverage for
// defaultMonthlyCostCapUsdForPlan(), the pure tier->default-cap decision
// provisionOrganisation() applies at org-creation time so free/trial orgs
// are no longer created with AI spend uncapped by default. Does not exercise
// provisionOrganisation() itself (a real DB write, no .test.ts precedent for
// that in this file's sibling services -- see cost-guard.test.ts's own note
// on this codebase's established DB-free-unit-test-for-the-pure-core
// convention).
import { describe, test, expect } from "bun:test"
import { defaultMonthlyCostCapUsdForPlan } from "./org-provisioning-service"

describe("defaultMonthlyCostCapUsdForPlan", () => {
  test("free plan gets a non-null default cap", () => {
    expect(defaultMonthlyCostCapUsdForPlan("free")).toBe(20)
  })

  test("a non-free plan is left unenforced (null) -- admin/paid tiers opt in explicitly", () => {
    expect(defaultMonthlyCostCapUsdForPlan("pro")).toBeNull()
    expect(defaultMonthlyCostCapUsdForPlan("enterprise")).toBeNull()
  })
})
