// Unit tests for backfill-r45-seq7-child-rate-convention.ts's pure
// computation/targeting functions -- the actual DB read/write loop is NOT
// exercised here, matching backfill-platform-assets.test.ts's established
// pattern of testing extracted pure functions rather than a live-DB code
// path (see src/lib/services/task-service.test.ts).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  computeCanonicalChildValues,
  alreadyMatchesCanonicalRate,
  isE2eSmokeNoise,
  selectBackfillTargets,
} from "./backfill-r45-seq7-child-rate-convention"

describe("computeCanonicalChildValues", () => {
  test("F2/F3/F4 against the real 'Sumeet Sample Scope' mismatch (Frame 01, org=projexa_demo_org)", () => {
    // Real live values queried 2026-08-24: root qty=424.8 rate=108, child
    // breakdown=30 -- currently stored WRONG as qty=472/rate=32.4.
    const result = computeCanonicalChildValues(
      { quantity: "472", rate: "32.4", breakdownPercentage: "30" },
      { quantity: "424.8", rate: "108" }
    )
    expect(result.quantity).toBe(424.8)
    expect(result.rate).toBeCloseTo(32.4, 4) // 108 * 0.30 -- happens to already equal the stored (wrong) rate; only quantity was actually off for this row
    expect(result.amount).toBeCloseTo(424.8 * 32.4, 4)
  })

  test("F2/F3/F4 against the real 'R-71 Post-Deploy Retest' mismatch (Frame Sub, org=ve45lczmkodbiq1m20fy48r5)", () => {
    // Real live values: root qty=100 rate=50, child breakdown=40 --
    // currently stored WRONG as qty=0/rate=0.
    const result = computeCanonicalChildValues(
      { quantity: "0", rate: "0", breakdownPercentage: "40" },
      { quantity: "100", rate: "50" }
    )
    expect(result.quantity).toBe(100)
    expect(result.rate).toBe(20)
    expect(result.amount).toBe(2000)
  })

  test("throws on a null breakdownPercentage rather than silently computing garbage", () => {
    expect(() => computeCanonicalChildValues({ quantity: "1", rate: "1", breakdownPercentage: null }, { quantity: "1", rate: "1" })).toThrow()
  })
})

describe("alreadyMatchesCanonicalRate", () => {
  test("true for a row that already satisfies F2/F3", () => {
    expect(alreadyMatchesCanonicalRate({ quantity: "100", rate: "20", breakdownPercentage: "40" }, { quantity: "100", rate: "50" })).toBe(true)
  })
  test("false for the real Frame Sub mismatch (qty=0/rate=0 vs expected 100/20)", () => {
    expect(alreadyMatchesCanonicalRate({ quantity: "0", rate: "0", breakdownPercentage: "40" }, { quantity: "100", rate: "50" })).toBe(false)
  })
  test("false for a quantity-only mismatch even when rate happens to already match (the Sumeet Sample Scope case)", () => {
    expect(alreadyMatchesCanonicalRate({ quantity: "472", rate: "32.4", breakdownPercentage: "30" }, { quantity: "424.8", rate: "108" })).toBe(false)
  })
})

describe("isE2eSmokeNoise", () => {
  test("true for the exact demo-gate-smoke.spec.ts pre-fix payload (qty=1, rate=1)", () => {
    expect(isE2eSmokeNoise({ quantity: "1", rate: "1", breakdownPercentage: "40" })).toBe(true)
  })
  test("false for a genuine mismatch that is not the 1/1 smoke pattern", () => {
    expect(isE2eSmokeNoise({ quantity: "0", rate: "0", breakdownPercentage: "40" })).toBe(false)
    expect(isE2eSmokeNoise({ quantity: "472", rate: "32.4", breakdownPercentage: "30" })).toBe(false)
  })
})

describe("selectBackfillTargets", () => {
  function row(overrides: Partial<{ id: string; parentLineItemId: string | null; quantity: string; rate: string; breakdownPercentage: string | null; orgId: string; boqId: string; description: string }>) {
    return {
      id: overrides.id ?? "row",
      orgId: overrides.orgId ?? "org",
      boqId: overrides.boqId ?? "boq",
      activityId: null,
      itemCode: null,
      description: overrides.description ?? "line item",
      unit: "nos",
      quantity: overrides.quantity ?? "0",
      rate: overrides.rate ?? "0",
      amount: "0",
      createdAt: new Date(),
      materialCost: null,
      labourCost: null,
      equipmentCost: null,
      overheadPercent: null,
      profitPercent: null,
      parentLineItemId: overrides.parentLineItemId ?? null,
      breakdownPercentage: overrides.breakdownPercentage ?? null,
      budgetPercentage: "0",
      vendorId: null,
      vendorAmount: null,
    } as any
  }

  test("skips root rows (no parentLineItemId)", () => {
    const items = [row({ id: "root", quantity: "100", rate: "50" })]
    expect(selectBackfillTargets(items)).toEqual([])
  })

  test("skips a child whose parent row is missing from the set (orphaned ref)", () => {
    const items = [row({ id: "child", parentLineItemId: "missing-root", quantity: "0", rate: "0", breakdownPercentage: "40" })]
    expect(selectBackfillTargets(items)).toEqual([])
  })

  test("skips e2e smoke noise (qty=1/rate=1) even though it's a real mismatch", () => {
    const items = [
      row({ id: "root", quantity: "100", rate: "50" }),
      row({ id: "child", parentLineItemId: "root", quantity: "1", rate: "1", breakdownPercentage: "40" }),
    ]
    expect(selectBackfillTargets(items)).toEqual([])
  })

  test("skips a child that already matches F2/F3", () => {
    const items = [
      row({ id: "root", quantity: "100", rate: "50" }),
      row({ id: "child", parentLineItemId: "root", quantity: "100", rate: "20", breakdownPercentage: "40" }),
    ]
    expect(selectBackfillTargets(items)).toEqual([])
  })

  test("selects a genuine non-smoke mismatch", () => {
    const items = [
      row({ id: "root", quantity: "100", rate: "50" }),
      row({ id: "child", parentLineItemId: "root", quantity: "0", rate: "0", breakdownPercentage: "40" }),
    ]
    const targets = selectBackfillTargets(items)
    expect(targets.map((t) => t.id)).toEqual(["child"])
  })
})
