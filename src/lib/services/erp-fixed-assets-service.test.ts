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
import { generateDepreciationSchedule, computeMonthlyDecliningRate, computeAssetGlReconciliation, ServiceError, type AssetCategoryLedgerTotals } from "./erp-fixed-assets-service"
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


// FI-AA-006 (Asset-to-GL Reconciliation, MEDIUM priority): tests the pure
// variance-check core directly, same "no live DB from a .test.ts file"
// convention as the rest of this file. Hand-computed expected values in
// every case (not just re-deriving what the function itself would output),
// per this codebase's own "cross-verify any new logic independently"
// discipline.
describe("computeAssetGlReconciliation", () => {
  function category(overrides: Partial<AssetCategoryLedgerTotals> = {}): AssetCategoryLedgerTotals {
    return {
      categoryId: "cat-1", categoryName: "Office Equipment",
      assetAccountId: "acc-asset-1", accumulatedDepreciationAccountId: "acc-accdep-1",
      subledgerGrossCost: 0, subledgerAccumulatedDepreciation: 0,
      ...overrides,
    }
  }

  test("fully reconciled: sub-ledger totals exactly match GL balances (accumulated depreciation account is credit-natured, sign-flipped for comparison)", () => {
    // Hand computation: gross cost 120,000 was debited to acc-asset-1 at
    // acquisition (raw GL balance = +120,000 debit-credit). 30,000 of
    // depreciation was debited to a Depreciation Expense account and
    // CREDITED to acc-accdep-1 (a contra-asset, credit-natured) -- its raw
    // debit-credit balance is therefore -30,000, which this function must
    // flip to +30,000 before comparing against the sub-ledger's own
    // (always-positive) accumulatedDepreciation total of 30,000.
    const categories = [category({ subledgerGrossCost: 120000, subledgerAccumulatedDepreciation: 30000 })]
    const glBalances = new Map([["acc-asset-1", 120000], ["acc-accdep-1", -30000]])

    const [line] = computeAssetGlReconciliation(categories, glBalances)

    expect(line.status).toBe("reconciled")
    expect(line.subledgerNbv).toBeCloseTo(90000)
    expect(line.glGrossCost).toBeCloseTo(120000)
    expect(line.glAccumulatedDepreciation).toBeCloseTo(30000)
    expect(line.glNbv).toBeCloseTo(90000)
    expect(line.grossCostVariance).toBeCloseTo(0)
    expect(line.accumulatedDepreciationVariance).toBeCloseTo(0)
    expect(line.nbvVariance).toBeCloseTo(0)
  })

  test("real variance: sub-ledger gross cost exceeds the GL by 20,000 -- e.g. an acquisition posted to the sub-ledger's own currentValue but never wired to the GL account", () => {
    // Hand computation: subledger says 500,000 of gross cost / 100,000
    // accumulated depreciation (NBV 400,000). GL asset account only shows
    // 480,000 (a real 20,000 gap); accumulated depreciation matches
    // exactly. Variance = subledger - GL = 500,000 - 480,000 = 20,000 for
    // gross cost, propagating straight through to NBV variance since
    // accumulated depreciation itself is not the source of the gap.
    const categories = [category({
      categoryId: "cat-2", categoryName: "Vehicles",
      assetAccountId: "acc-asset-2", accumulatedDepreciationAccountId: "acc-accdep-2",
      subledgerGrossCost: 500000, subledgerAccumulatedDepreciation: 100000,
    })]
    const glBalances = new Map([["acc-asset-2", 480000], ["acc-accdep-2", -100000]])

    const [line] = computeAssetGlReconciliation(categories, glBalances)

    expect(line.status).toBe("variance")
    expect(line.subledgerNbv).toBeCloseTo(400000)
    expect(line.glNbv).toBeCloseTo(380000)
    expect(line.grossCostVariance).toBeCloseTo(20000)
    expect(line.accumulatedDepreciationVariance).toBeCloseTo(0)
    expect(line.nbvVariance).toBeCloseTo(20000)
  })

  test("category with no GL accounts configured is reported honestly as not_mapped, not forced into a comparison or silently dropped", () => {
    const categories = [category({
      categoryId: "cat-3", categoryName: "IT Assets (unmapped)",
      assetAccountId: null, accumulatedDepreciationAccountId: null,
      subledgerGrossCost: 75000, subledgerAccumulatedDepreciation: 15000,
    })]
    const glBalances = new Map<string, number>()

    const [line] = computeAssetGlReconciliation(categories, glBalances)

    expect(line.status).toBe("not_mapped")
    expect(line.note).toMatch(/no Asset Account/i)
    expect(line.subledgerNbv).toBeCloseTo(60000) // sub-ledger side is still computed and shown
    expect(line.glGrossCost).toBeNull()
    expect(line.glAccumulatedDepreciation).toBeNull()
    expect(line.glNbv).toBeNull()
    expect(line.grossCostVariance).toBeNull()
  })

  test("tolerance: a sub-cent variance within the default 0.01 tolerance is still reconciled, one just outside it is flagged", () => {
    const withinTolerance = category({ subledgerGrossCost: 100000.004, subledgerAccumulatedDepreciation: 0 })
    const outsideTolerance = category({ subledgerGrossCost: 100000.02, subledgerAccumulatedDepreciation: 0 })
    const glBalances = new Map([["acc-asset-1", 100000], ["acc-accdep-1", 0]])

    const [reconciled] = computeAssetGlReconciliation([withinTolerance], glBalances)
    const [flagged] = computeAssetGlReconciliation([outsideTolerance], glBalances)

    expect(reconciled.status).toBe("reconciled")
    expect(flagged.status).toBe("variance")
  })

  test("a custom tolerance widens or narrows what counts as reconciled", () => {
    const categories = [category({ subledgerGrossCost: 100005, subledgerAccumulatedDepreciation: 0 })]
    const glBalances = new Map([["acc-asset-1", 100000], ["acc-accdep-1", 0]])

    const [strict] = computeAssetGlReconciliation(categories, glBalances, 0.01)
    const [lenient] = computeAssetGlReconciliation(categories, glBalances, 10)

    expect(strict.status).toBe("variance")
    expect(lenient.status).toBe("reconciled")
  })

  test("a mapped category with a GL account that has zero postings reconciles at zero on both sides", () => {
    const categories = [category({ subledgerGrossCost: 0, subledgerAccumulatedDepreciation: 0 })]
    const glBalances = new Map<string, number>()

    const [line] = computeAssetGlReconciliation(categories, glBalances)

    expect(line.status).toBe("reconciled")
    expect(line.glGrossCost).toBe(0)
    expect(line.glAccumulatedDepreciation).toBe(0)
    expect(line.nbvVariance).toBe(0)
  })
})
