// Wave B (VERIDIAN Review Framework remediation, Fixed Assets wiring):
// tests the pure depreciation math (generateDepreciationSchedule /
// computeMonthlyDecliningRate) directly, and the real role-rank gate the
// disposal route (src/app/api/erp/fixed-assets/[id]/disposals/route.ts)
// enforces via hasRole() -- matching this repo's established pattern of
// not touching withTenantContext/a live DB from a .test.ts file (see
// agent-review-service.test.ts / approval-workflow-service.test.ts's own
// notes on this).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { generateDepreciationSchedule, computeMonthlyDecliningRate, ServiceError } from "./erp-fixed-assets-service"
import { hasRole, ROLE_RANK, type UserRole } from "@/lib/supabase/auth-guard"

function sum(entries: { depreciationAmount: number }[]) {
  return Math.round(entries.reduce((s, e) => s + e.depreciationAmount, 0) * 100) / 100
}

describe("generateDepreciationSchedule -- straight-line", () => {
  test("purchase on the 1st needs no true-up period -- exactly usefulLifeMonths periods, sums to depreciable base", () => {
    const entries = generateDepreciationSchedule({
      method: "straight_line", purchaseCost: 120000, salvageValue: 0, usefulLifeMonths: 12, purchaseDate: "2026-01-01",
    })
    expect(entries.length).toBe(12)
    expect(sum(entries)).toBeCloseTo(120000)
    expect(entries[0].depreciationAmount).toBeCloseTo(10000)
    expect(entries[entries.length - 1].accumulatedDepreciationAfter).toBeCloseTo(120000)
  })

  test("mid-period addition: purchase on the 15th prorates period 1 and adds a true-up period, still summing to exactly the depreciable base", () => {
    const entries = generateDepreciationSchedule({
      method: "straight_line", purchaseCost: 60000, salvageValue: 0, usefulLifeMonths: 6, purchaseDate: "2026-03-15",
    })
    const monthlyAmount = 10000
    // March has 31 days; days remaining from (and including) the 15th = 17 -> proration factor 17/31
    expect(entries[0].depreciationAmount).toBeCloseTo(Math.round(monthlyAmount * (17 / 31) * 100) / 100)
    expect(entries[0].depreciationAmount).toBeLessThan(monthlyAmount)
    // a true-up period beyond the nominal 6 months absorbs the shortfall
    expect(entries.length).toBe(7)
    expect(sum(entries)).toBeCloseTo(60000)
    expect(entries[entries.length - 1].accumulatedDepreciationAfter).toBeCloseTo(60000)
  })

  test("respects a non-zero salvage value -- never depreciates below it", () => {
    const entries = generateDepreciationSchedule({
      method: "straight_line", purchaseCost: 100000, salvageValue: 10000, usefulLifeMonths: 10, purchaseDate: "2026-01-01",
    })
    expect(sum(entries)).toBeCloseTo(90000)
    expect(entries[entries.length - 1].accumulatedDepreciationAfter).toBeCloseTo(90000)
  })

  test("fully-depreciated-at-acquisition edge case: salvageValue >= purchaseCost returns an empty schedule, not an error", () => {
    const entries = generateDepreciationSchedule({
      method: "straight_line", purchaseCost: 50000, salvageValue: 50000, usefulLifeMonths: 12, purchaseDate: "2026-01-01",
    })
    expect(entries).toEqual([])
  })

  test("rejects a non-positive usefulLifeMonths rather than silently producing garbage", () => {
    expect(() => generateDepreciationSchedule({
      method: "straight_line", purchaseCost: 10000, salvageValue: 0, usefulLifeMonths: 0, purchaseDate: "2026-01-01",
    })).toThrow(ServiceError)
  })
})

describe("generateDepreciationSchedule -- declining balance (written_down_value)", () => {
  test("depreciation amounts strictly decrease period over period (geometric decay)", () => {
    const entries = generateDepreciationSchedule({
      method: "written_down_value", purchaseCost: 100000, salvageValue: 10000, usefulLifeMonths: 12, purchaseDate: "2026-01-01",
    })
    expect(entries.length).toBeGreaterThan(1)
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].depreciationAmount).toBeLessThanOrEqual(entries[i - 1].depreciationAmount)
    }
  })

  test("never depreciates below the salvage value -- converges to exactly (cost - salvage), never overshoots", () => {
    const entries = generateDepreciationSchedule({
      method: "written_down_value", purchaseCost: 100000, salvageValue: 10000, usefulLifeMonths: 12, purchaseDate: "2026-01-01",
    })
    expect(sum(entries)).toBeCloseTo(90000)
    expect(entries[entries.length - 1].accumulatedDepreciationAfter).toBeCloseTo(90000)
    for (const e of entries) expect(e.accumulatedDepreciationAfter).toBeLessThanOrEqual(90000 + 0.01)
  })

  test("zero salvage value falls back to the double-declining-balance heuristic rather than a degenerate 100% rate", () => {
    const rate = computeMonthlyDecliningRate(120000, 0, 24)
    expect(rate).toBeCloseTo(2 / 24)
  })

  test("mid-period addition also prorates period 1 for declining balance", () => {
    const full = generateDepreciationSchedule({ method: "written_down_value", purchaseCost: 50000, salvageValue: 5000, usefulLifeMonths: 12, purchaseDate: "2026-06-01" })
    const midPeriod = generateDepreciationSchedule({ method: "written_down_value", purchaseCost: 50000, salvageValue: 5000, usefulLifeMonths: 12, purchaseDate: "2026-06-16" })
    expect(midPeriod[0].depreciationAmount).toBeLessThan(full[0].depreciationAmount)
  })

  test("fully-depreciated-at-acquisition edge case applies identically to declining balance", () => {
    const entries = generateDepreciationSchedule({ method: "written_down_value", purchaseCost: 20000, salvageValue: 20000, usefulLifeMonths: 12, purchaseDate: "2026-01-01" })
    expect(entries).toEqual([])
  })
})

describe("computeMonthlyDecliningRate", () => {
  test("standard geometric formula when salvageValue > 0", () => {
    const rate = computeMonthlyDecliningRate(100000, 10000, 12)
    // rate = 1 - (10000/100000)^(1/12)
    expect(rate).toBeCloseTo(1 - Math.pow(0.1, 1 / 12), 6)
  })

  test("rejects a non-positive usefulLifeMonths", () => {
    expect(() => computeMonthlyDecliningRate(1000, 100, 0)).toThrow(ServiceError)
  })

  test("rejects a non-positive cost", () => {
    expect(() => computeMonthlyDecliningRate(0, 100, 12)).toThrow(ServiceError)
  })
})

// The disposal route (src/app/api/erp/fixed-assets/[id]/disposals/route.ts)
// gates POST via requirePermissionForUser(dbUser, "erp.fixed_assets.dispose")
// (permission-service.ts, VERIDIAN Review Framework remediation wave) --
// which resolves to hasRole(dbUser, "manager") underneath, the exact same
// convention as src/app/api/documents/[id]/dispose/route.ts's own disposal
// gate and unchanged from this route's original inline
// requireRole(dbUser, "manager") call. This exercises the REAL
// hasRole()/ROLE_RANK the route's gate ultimately calls (imported
// directly, not reimplemented), confirming every role in the live enum
// lands on the correct side of the manager-or-above line. See
// permission-service.test.ts for tests of the requirePermissionForUser()/
// ERP_ACTION_ROLES layer itself.
describe("disposal approval gate -- hasRole(dbUser, 'manager') as used by the disposals route", () => {
  const rolesBelowManager: UserRole[] = ["viewer", "client_viewer", "external_auditor", "member", "team_member"]
  const rolesManagerOrAbove: UserRole[] = ["manager", "senior_professional", "branch_manager", "admin", "veridian_admin"]

  test("every role below manager rank is refused", () => {
    for (const role of rolesBelowManager) {
      expect(hasRole({ role } as unknown as Parameters<typeof hasRole>[0], "manager")).toBe(false)
    }
  })

  test("every role at manager rank or above is allowed", () => {
    for (const role of rolesManagerOrAbove) {
      expect(hasRole({ role } as unknown as Parameters<typeof hasRole>[0], "manager")).toBe(true)
    }
  })

  test("a null dbUser (e.g. an API-key-only actor) is never allowed to initiate a disposal", () => {
    expect(hasRole(null, "manager")).toBe(false)
  })

  test("ROLE_RANK itself has not silently dropped a role this gate depends on", () => {
    for (const role of [...rolesBelowManager, ...rolesManagerOrAbove]) {
      expect(typeof ROLE_RANK[role]).toBe("number")
    }
  })
})
