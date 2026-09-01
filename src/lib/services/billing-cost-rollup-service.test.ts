/// <reference types="bun-types" />
// Tests the pure helpers only (pickBestRate/pickActiveContract/
// computeAllocatedCost/computeCallBillableCost) -- the DB-touching
// functions (resolveActiveBillingRate/resolveActiveContract/
// backfillLedgerCosts/rollupCostByDimension) are not unit-tested here,
// matching this codebase's own established pure/DB-touching split (see
// cost-reconciliation-service.test.ts's own header note, and
// platform-billing-service.test.ts).
import { describe, expect, test } from "bun:test"
import { pickBestRate, pickActiveContract, computeAllocatedCost, computeCallBillableCost, type BillingRateRow, type BillingContractRow } from "./billing-cost-rollup-service"

function rate(overrides: Partial<BillingRateRow> = {}): BillingRateRow {
  return {
    id: "rate_1",
    productId: "product_1",
    orgId: null,
    contractId: null,
    formula: "formula_2",
    rateVersion: 1,
    baseRate: null,
    includedUsers: null,
    additionalUserRate: null,
    baseUserRate: "400",
    inputTokenRate: "8",
    outputTokenRate: "25",
    softwareTokenRate: null,
    tokenMultiplier: "1.2",
    effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
    effectiveTo: null,
    status: "active",
    approvedBy: null,
    approvedAt: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  } as BillingRateRow
}

function contract(overrides: Partial<BillingContractRow> = {}): BillingContractRow {
  return {
    id: "contract_1",
    orgId: "org_1",
    productId: "product_1",
    formula: "formula_2",
    contractName: "Test Contract",
    status: "active",
    effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
    effectiveTo: null,
    approvedBy: null,
    approvedAt: null,
    notes: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  } as BillingContractRow
}

describe("pickBestRate -- directive §14 priority (collapsed to org-specific > standard) + §17 versioning", () => {
  test("no candidates -> null (never fabricates a rate)", () => {
    expect(pickBestRate([], "org_1")).toBeNull()
    expect(pickBestRate([], null)).toBeNull()
  })

  test("only a standard (org_id=null) row exists -> returned for any org", () => {
    const standard = rate({ id: "standard", orgId: null })
    expect(pickBestRate([standard], "org_1")).toEqual(standard)
    expect(pickBestRate([standard], null)).toEqual(standard)
  })

  test("an org-specific row takes priority over the standard row for that org (directive §14)", () => {
    const standard = rate({ id: "standard", orgId: null, rateVersion: 5 })
    const custom = rate({ id: "custom", orgId: "org_1", rateVersion: 1 })
    // Even though the standard row has a HIGHER version, org-specific still
    // wins -- priority level beats version within a lower level.
    expect(pickBestRate([standard, custom], "org_1")).toEqual(custom)
  })

  test("an org-specific row for a DIFFERENT org never leaks into this org's resolution", () => {
    const otherOrgRate = rate({ id: "other_org", orgId: "org_2", rateVersion: 9 })
    const standard = rate({ id: "standard", orgId: null, rateVersion: 1 })
    expect(pickBestRate([otherOrgRate, standard], "org_1")).toEqual(standard)
  })

  test("within the same priority level, the highest rate_version wins (directive rule 21 -- rates are versioned, never overwritten)", () => {
    const v1 = rate({ id: "v1", orgId: null, rateVersion: 1 })
    const v2 = rate({ id: "v2", orgId: null, rateVersion: 2 })
    const v3 = rate({ id: "v3", orgId: null, rateVersion: 3 })
    expect(pickBestRate([v1, v3, v2], null)).toEqual(v3)
  })

  test("requesting with orgId=null only ever considers standard rows, even if org-specific rows are present in the candidate list", () => {
    const custom = rate({ id: "custom", orgId: "org_1", rateVersion: 9 })
    const standard = rate({ id: "standard", orgId: null, rateVersion: 1 })
    expect(pickBestRate([custom, standard], null)).toEqual(standard)
  })
})

describe("pickBestRate -- Phase 2: contract-backed priority (directive §14 level 1 vs level 2)", () => {
  test("a contract-linked org rate wins over a bare org-specific rate with a HIGHER version (level beats version, same discipline as org-vs-standard)", () => {
    const bare = rate({ id: "bare", orgId: "org_1", contractId: null, rateVersion: 5 })
    const contractLinked = rate({ id: "contract_linked", orgId: "org_1", contractId: "contract_1", rateVersion: 1 })
    expect(pickBestRate([bare, contractLinked], "org_1", "contract_1")).toEqual(contractLinked)
  })

  test("no activeContractId (the Phase 1 default) preserves the exact old 2-level behavior -- highest-version org-specific row wins", () => {
    const v1 = rate({ id: "v1", orgId: "org_1", contractId: "contract_1", rateVersion: 1 })
    const v2 = rate({ id: "v2", orgId: "org_1", contractId: null, rateVersion: 2 })
    expect(pickBestRate([v1, v2], "org_1")).toEqual(v2)
    expect(pickBestRate([v1, v2], "org_1", null)).toEqual(v2)
  })

  test("an activeContractId that matches no candidate row falls back to the highest-version org-specific rate, not null", () => {
    const bare = rate({ id: "bare", orgId: "org_1", contractId: null, rateVersion: 3 })
    expect(pickBestRate([bare], "org_1", "some_other_contract")).toEqual(bare)
  })

  test("a rate linked to a DIFFERENT org's contract never wins this org's resolution even if the contract id happens to match", () => {
    // Defensive: contractId matching alone is not sufficient without the
    // row also being in this org's pool -- the org filter runs first.
    const otherOrgContractRate = rate({ id: "other_org", orgId: "org_2", contractId: "contract_1", rateVersion: 9 })
    const thisOrgStandard = rate({ id: "standard", orgId: null, rateVersion: 1 })
    expect(pickBestRate([otherOrgContractRate, thisOrgStandard], "org_1", "contract_1")).toEqual(thisOrgStandard)
  })

  test("within contract-linked rows, the highest rate_version still wins (rule 21 versioning applies at every priority level)", () => {
    const v1 = rate({ id: "v1", orgId: "org_1", contractId: "contract_1", rateVersion: 1 })
    const v2 = rate({ id: "v2", orgId: "org_1", contractId: "contract_1", rateVersion: 2 })
    expect(pickBestRate([v1, v2], "org_1", "contract_1")).toEqual(v2)
  })
})

describe("pickActiveContract -- directive §14 level-1 tie-break for simultaneously-effective contracts", () => {
  test("no candidates -> null (never fabricates a contract)", () => {
    expect(pickActiveContract([])).toBeNull()
  })

  test("a single candidate is returned as-is", () => {
    const only = contract({ id: "only" })
    expect(pickActiveContract([only])).toEqual(only)
  })

  test("the most recently approved contract wins when two are simultaneously effective", () => {
    const older = contract({ id: "older", approvedAt: new Date("2026-08-01T00:00:00.000Z") })
    const newer = contract({ id: "newer", approvedAt: new Date("2026-09-01T00:00:00.000Z") })
    expect(pickActiveContract([older, newer])).toEqual(newer)
  })

  test("falls back to the latest effective_from when approvedAt is null on both (never crashes on a null comparison key)", () => {
    const earlier = contract({ id: "earlier", approvedAt: null, effectiveFrom: new Date("2026-08-01T00:00:00.000Z") })
    const later = contract({ id: "later", approvedAt: null, effectiveFrom: new Date("2026-09-01T00:00:00.000Z") })
    expect(pickActiveContract([earlier, later])).toEqual(later)
  })
})

describe("computeAllocatedCost -- VERIDIAN's own internal cost attribution (no rate card needed)", () => {
  test("sums input_cost + output_cost when both are real", () => {
    expect(computeAllocatedCost({ inputCost: "0.01", outputCost: "0.02", cacheCost: null })).toBeCloseTo(0.03, 10)
  })

  test("includes cache_cost when present", () => {
    expect(computeAllocatedCost({ inputCost: "0.01", outputCost: "0.02", cacheCost: "0.005" })).toBeCloseTo(0.035, 10)
  })

  test("null when every cost component is null (unrecognized model, per drizzle/0524's own disclosed gap) -- never fabricates a 0", () => {
    expect(computeAllocatedCost({ inputCost: null, outputCost: null, cacheCost: null })).toBeNull()
  })

  test("treats a single populated component as the real total when siblings are null (not double-null-guarded into null)", () => {
    expect(computeAllocatedCost({ inputCost: "0.01", outputCost: null, cacheCost: null })).toBeCloseTo(0.01, 10)
  })
})

describe("computeCallBillableCost -- Formula 2's token component for one AI call (directive §6-10)", () => {
  test("matches the directive's own §13/§22 worked ratio when scaled to a single call's tokens", () => {
    // Directive's worked example is an org-period total (1M/200k raw
    // tokens); this proves the SAME per-1000-token rate convention holds
    // at single-call granularity by checking a round number.
    const result = computeCallBillableCost(
      { promptTokens: 1000, completionTokens: 0 },
      { inputTokenRate: "8", outputTokenRate: "25", tokenMultiplier: "1.2" }
    )
    // 1000 raw * 1.2 multiplier = 1200 billable -> 1200/1000 * 8 = 9.6
    expect(result.billableInputTokens).toBe(1200)
    expect(result.billableCost).toBeCloseTo(9.6, 10)
  })

  test("input + output combine additively", () => {
    const result = computeCallBillableCost(
      { promptTokens: 1000, completionTokens: 1000 },
      { inputTokenRate: "8", outputTokenRate: "25", tokenMultiplier: "1.2" }
    )
    const expectedInput = (1000 * 1.2 / 1000) * 8
    const expectedOutput = (1000 * 1.2 / 1000) * 25
    expect(result.billableCost).toBeCloseTo(expectedInput + expectedOutput, 10)
  })

  test("zero tokens -> zero cost, not null/NaN", () => {
    const result = computeCallBillableCost(
      { promptTokens: 0, completionTokens: 0 },
      { inputTokenRate: "8", outputTokenRate: "25", tokenMultiplier: "1.2" }
    )
    expect(result.billableCost).toBe(0)
    expect(Number.isNaN(result.billableCost)).toBe(false)
  })

  test("a null rate field (e.g. output_token_rate never set on a Formula-1-only rate row) is treated as 0, not NaN", () => {
    const result = computeCallBillableCost(
      { promptTokens: 1000, completionTokens: 1000 },
      { inputTokenRate: "8", outputTokenRate: null, tokenMultiplier: "1.2" }
    )
    expect(Number.isNaN(result.billableCost)).toBe(false)
    expect(result.billableCost).toBeCloseTo((1000 * 1.2 / 1000) * 8, 10)
  })

  test("respects a customer-negotiated multiplier different from the directive's default 1.2", () => {
    const default1_2 = computeCallBillableCost({ promptTokens: 10_000, completionTokens: 0 }, { inputTokenRate: "8", outputTokenRate: "25", tokenMultiplier: "1.2" })
    const custom1_5 = computeCallBillableCost({ promptTokens: 10_000, completionTokens: 0 }, { inputTokenRate: "8", outputTokenRate: "25", tokenMultiplier: "1.5" })
    expect(custom1_5.billableCost).toBeGreaterThan(default1_2.billableCost)
  })
})
