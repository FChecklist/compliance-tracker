/// <reference types="bun-types" />
// Tests the pure helpers only (pickBestRate/pickActiveContract/
// computeAllocatedCost/computeCallBillableCost) -- the DB-touching
// functions (resolveActiveBillingRate/resolveActiveContract/
// backfillLedgerCosts/rollupCostByDimension) are not unit-tested here,
// matching this codebase's own established pure/DB-touching split (see
// cost-reconciliation-service.test.ts's own header note, and
// platform-billing-service.test.ts).
import { describe, expect, test } from "bun:test"
import {
  pickBestRate,
  pickActiveContract,
  computeAllocatedCost,
  computeCallBillableCost,
  isEffectiveAsOf,
  filterEffectiveAsOf,
  type BillingRateRow,
  type BillingContractRow,
} from "./billing-cost-rollup-service"

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

// ─── Phase 3: effective-window edge-case hardening ───────────────────────
// isEffectiveAsOf/filterEffectiveAsOf used to live only as inline Drizzle
// WHERE-clause fragments inside resolveActiveContract/resolveActiveBillingRate
// -- untestable without a live DB. Extracted to pure functions (Phase 3, see
// billing-cost-rollup-service.ts's own header) specifically so the real
// boundary semantics behind directive §17's "September bills use V1, October
// uses V2, no retroactive bleed" example -- and the analogous contract-expiry
// case -- are actually verified, not just documented.

describe("isEffectiveAsOf -- directive §14/§17 boundary semantics: [effective_from, effective_to)", () => {
  test("asOf exactly at effective_from is effective (inclusive lower bound)", () => {
    const row = rate({ effectiveFrom: new Date("2026-09-01T00:00:00.000Z"), effectiveTo: null, status: "active" })
    expect(isEffectiveAsOf(row, new Date("2026-09-01T00:00:00.000Z"))).toBe(true)
  })

  test("asOf one millisecond before effective_from is NOT effective", () => {
    const row = rate({ effectiveFrom: new Date("2026-09-01T00:00:00.000Z"), effectiveTo: null, status: "active" })
    expect(isEffectiveAsOf(row, new Date("2026-08-31T23:59:59.999Z"))).toBe(false)
  })

  test("asOf exactly at effective_to is NOT effective (exclusive upper bound -- the critical expiry-boundary case)", () => {
    const row = rate({ effectiveFrom: new Date("2026-09-01T00:00:00.000Z"), effectiveTo: new Date("2026-10-01T00:00:00.000Z"), status: "active" })
    expect(isEffectiveAsOf(row, new Date("2026-10-01T00:00:00.000Z"))).toBe(false)
  })

  test("asOf one millisecond before effective_to is still effective", () => {
    const row = rate({ effectiveFrom: new Date("2026-09-01T00:00:00.000Z"), effectiveTo: new Date("2026-10-01T00:00:00.000Z"), status: "active" })
    expect(isEffectiveAsOf(row, new Date("2026-09-30T23:59:59.999Z"))).toBe(true)
  })

  test("null effective_to is open-ended -- effective arbitrarily far in the future", () => {
    const row = rate({ effectiveFrom: new Date("2026-09-01T00:00:00.000Z"), effectiveTo: null, status: "active" })
    expect(isEffectiveAsOf(row, new Date("2099-01-01T00:00:00.000Z"))).toBe(true)
  })

  test.each(["draft", "expired", "revoked"])(
    "status '%s' is never effective even squarely inside its own date window (directive rules 9-11 -- draft/expired/revoked is not owner-approved-live)",
    (status) => {
      const row = rate({ effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: null, status })
      expect(isEffectiveAsOf(row, new Date("2026-09-01T00:00:00.000Z"))).toBe(false)
    }
  )

  test("'approved' and 'active' both count as effective by default", () => {
    const approved = rate({ effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: null, status: "approved" })
    const active = rate({ effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: null, status: "active" })
    expect(isEffectiveAsOf(approved, new Date("2026-09-01T00:00:00.000Z"))).toBe(true)
    expect(isEffectiveAsOf(active, new Date("2026-09-01T00:00:00.000Z"))).toBe(true)
  })

  test("a custom activeStatuses list overrides the default (e.g. treating 'draft' as previewable without touching the real default)", () => {
    const draft = rate({ effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: null, status: "draft" })
    expect(isEffectiveAsOf(draft, new Date("2026-09-01T00:00:00.000Z"))).toBe(false)
    expect(isEffectiveAsOf(draft, new Date("2026-09-01T00:00:00.000Z"), ["draft"])).toBe(true)
  })
})

describe("filterEffectiveAsOf -- composition over a candidate list", () => {
  test("empty input -> empty output", () => {
    expect(filterEffectiveAsOf([], new Date("2026-09-01T00:00:00.000Z"))).toEqual([])
  })

  test("filters out wrong-status and out-of-window rows, keeps only real matches", () => {
    const asOf = new Date("2026-09-15T00:00:00.000Z")
    const keep1 = rate({ id: "keep1", effectiveFrom: new Date("2026-09-01T00:00:00.000Z"), effectiveTo: null, status: "active" })
    const wrongStatus = rate({ id: "draft", effectiveFrom: new Date("2026-09-01T00:00:00.000Z"), effectiveTo: null, status: "draft" })
    const notYetEffective = rate({ id: "future", effectiveFrom: new Date("2026-10-01T00:00:00.000Z"), effectiveTo: null, status: "active" })
    const alreadyExpired = rate({ id: "expired", effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: new Date("2026-09-01T00:00:00.000Z"), status: "active" })
    const keep2 = rate({ id: "keep2", effectiveFrom: new Date("2026-08-01T00:00:00.000Z"), effectiveTo: new Date("2026-12-01T00:00:00.000Z"), status: "approved" })

    const result = filterEffectiveAsOf([keep1, wrongStatus, notYetEffective, alreadyExpired, keep2], asOf)
    expect(result.map((r) => r.id).sort()).toEqual(["keep1", "keep2"])
  })
})

describe("Mid-period rate-version change -- directive §17's own worked example, generalized (Sept uses V1, Oct uses V2, no retroactive bleed)", () => {
  const v1 = rate({
    id: "v1",
    orgId: null,
    rateVersion: 1,
    inputTokenRate: "10",
    outputTokenRate: "30",
    baseUserRate: "500",
    effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
    effectiveTo: new Date("2026-10-01T00:00:00.000Z"),
    status: "active",
  })
  const v2 = rate({
    id: "v2",
    orgId: null,
    rateVersion: 2,
    inputTokenRate: "8",
    outputTokenRate: "25",
    baseUserRate: "450",
    effectiveFrom: new Date("2026-10-01T00:00:00.000Z"),
    effectiveTo: null,
    status: "active",
  })
  const candidates = [v1, v2]

  test("mid-September resolves to V1", () => {
    const effective = filterEffectiveAsOf(candidates, new Date("2026-09-15T00:00:00.000Z"))
    expect(pickBestRate(effective, null)).toEqual(v1)
  })

  test("the exact instant V2 starts (2026-10-01T00:00:00.000Z) resolves to V2, not V1 -- V1's effective_to is exclusive", () => {
    const effective = filterEffectiveAsOf(candidates, new Date("2026-10-01T00:00:00.000Z"))
    expect(pickBestRate(effective, null)).toEqual(v2)
  })

  test("one millisecond before V2 starts still resolves to V1 -- no early bleed", () => {
    const effective = filterEffectiveAsOf(candidates, new Date("2026-09-30T23:59:59.999Z"))
    expect(pickBestRate(effective, null)).toEqual(v1)
  })

  test("well into October resolves to V2", () => {
    const effective = filterEffectiveAsOf(candidates, new Date("2026-10-15T00:00:00.000Z"))
    expect(pickBestRate(effective, null)).toEqual(v2)
  })

  test("REGRESSION GUARD: a not-yet-effective higher-version rate must not win by version priority alone -- filtering by effective window must run BEFORE pickBestRate's version tie-break, not after", () => {
    // If someone ever "optimized" resolveActiveBillingRate by calling
    // pickBestRate on the RAW candidate list (skipping filterEffectiveAsOf
    // first), this test fails: pickBestRate alone always prefers the
    // highest rate_version, which would incorrectly select V2 during
    // September even though V2 isn't effective yet.
    const wrongOrder = pickBestRate(candidates, null) // no date filter at all
    expect(wrongOrder).toEqual(v2) // proves pickBestRate alone is version-blind to dates
    const rightOrder = pickBestRate(filterEffectiveAsOf(candidates, new Date("2026-09-15T00:00:00.000Z")), null)
    expect(rightOrder).toEqual(v1) // the real resolver's actual composition gets it right
  })
})

describe("Multiple concurrent effective rates -- no DB constraint prevents overlapping effective windows for the same (org, product, formula)", () => {
  test("two ACTIVE rates with overlapping windows both pass the date filter; highest rate_version wins (rule 21)", () => {
    const asOf = new Date("2026-09-15T00:00:00.000Z")
    const older = rate({ id: "older", orgId: "org_1", rateVersion: 3, effectiveFrom: new Date("2026-08-01T00:00:00.000Z"), effectiveTo: null, status: "active" })
    const overlappingNewer = rate({ id: "newer", orgId: "org_1", rateVersion: 4, effectiveFrom: new Date("2026-09-01T00:00:00.000Z"), effectiveTo: null, status: "active" })
    const effective = filterEffectiveAsOf([older, overlappingNewer], asOf)
    expect(effective).toHaveLength(2) // both genuinely pass the date/status filter at once
    expect(pickBestRate(effective, "org_1")).toEqual(overlappingNewer)
  })

  test("three-way overlap resolves deterministically to the single highest version", () => {
    const asOf = new Date("2026-09-15T00:00:00.000Z")
    const rows = [
      rate({ id: "r1", orgId: "org_1", rateVersion: 1, effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: null, status: "active" }),
      rate({ id: "r2", orgId: "org_1", rateVersion: 5, effectiveFrom: new Date("2026-06-01T00:00:00.000Z"), effectiveTo: null, status: "approved" }),
      rate({ id: "r3", orgId: "org_1", rateVersion: 3, effectiveFrom: new Date("2026-08-01T00:00:00.000Z"), effectiveTo: null, status: "active" }),
    ]
    const effective = filterEffectiveAsOf(rows, asOf)
    expect(effective).toHaveLength(3)
    expect(pickBestRate(effective, "org_1")?.id).toBe("r2")
  })
})

describe("Contract expiry boundary conditions -- combined filterEffectiveAsOf -> pickActiveContract -> pickBestRate pipeline", () => {
  const orgRate = rate({ id: "org_bare_rate", orgId: "org_1", contractId: null, rateVersion: 2 })
  const contractRate = rate({ id: "org_contract_rate", orgId: "org_1", contractId: "contract_1", rateVersion: 1 })
  const allRates = [orgRate, contractRate]

  function resolveForAsOf(contracts: BillingContractRow[], asOf: Date) {
    const effectiveContracts = filterEffectiveAsOf(contracts, asOf)
    const activeContract = pickActiveContract(effectiveContracts)
    return pickBestRate(allRates, "org_1", activeContract?.id ?? null)
  }

  test("one millisecond before expiry, the contract-backed rate still wins even though it has a LOWER version than the bare org rate", () => {
    const expiringContract = contract({ id: "contract_1", effectiveFrom: new Date("2026-09-01T00:00:00.000Z"), effectiveTo: new Date("2026-12-01T00:00:00.000Z"), status: "active" })
    const result = resolveForAsOf([expiringContract], new Date("2026-11-30T23:59:59.999Z"))
    expect(result).toEqual(contractRate)
  })

  test("at the exact expiry instant, the contract no longer applies and resolution falls back to the bare org-specific rate (directive §17-style no-retroactive-bleed, applied to contracts)", () => {
    const expiringContract = contract({ id: "contract_1", effectiveFrom: new Date("2026-09-01T00:00:00.000Z"), effectiveTo: new Date("2026-12-01T00:00:00.000Z"), status: "active" })
    const result = resolveForAsOf([expiringContract], new Date("2026-12-01T00:00:00.000Z"))
    expect(result).toEqual(orgRate)
  })

  test("a contract still in 'draft' status never applies even squarely inside its date window -- resolution falls back to the bare org rate", () => {
    const draftContract = contract({ id: "contract_1", effectiveFrom: new Date("2026-09-01T00:00:00.000Z"), effectiveTo: null, status: "draft" })
    const result = resolveForAsOf([draftContract], new Date("2026-09-15T00:00:00.000Z"))
    expect(result).toEqual(orgRate)
  })

  test("a 'terminated' contract never applies even before its own effective_to (owner can terminate early -- status beats date window)", () => {
    const terminatedContract = contract({ id: "contract_1", effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: new Date("2026-12-31T00:00:00.000Z"), status: "terminated" })
    const result = resolveForAsOf([terminatedContract], new Date("2026-06-01T00:00:00.000Z"))
    expect(result).toEqual(orgRate)
  })

  test("two simultaneously-effective contracts: the most-recently-approved one's id is what wins the rate tie-break (directive §14 level-1 tie-break, exercised through the full pipeline)", () => {
    const olderApproval = contract({ id: "contract_1", approvedAt: new Date("2026-08-01T00:00:00.000Z"), effectiveFrom: new Date("2026-08-01T00:00:00.000Z"), effectiveTo: null, status: "active" })
    const newerApproval = contract({ id: "contract_2", approvedAt: new Date("2026-09-01T00:00:00.000Z"), effectiveFrom: new Date("2026-08-15T00:00:00.000Z"), effectiveTo: null, status: "active" })
    // A rate linked to the NEWER contract should win over one linked to the older contract.
    const rateForNewerContract = rate({ id: "rate_for_contract_2", orgId: "org_1", contractId: "contract_2", rateVersion: 1 })
    const rateForOlderContract = rate({ id: "rate_for_contract_1", orgId: "org_1", contractId: "contract_1", rateVersion: 9 }) // higher version, still must lose

    const effectiveContracts = filterEffectiveAsOf([olderApproval, newerApproval], new Date("2026-09-15T00:00:00.000Z"))
    const activeContract = pickActiveContract(effectiveContracts)
    expect(activeContract?.id).toBe("contract_2")

    const result = pickBestRate([rateForOlderContract, rateForNewerContract], "org_1", activeContract?.id ?? null)
    expect(result).toEqual(rateForNewerContract)
  })
})
