// R85 Addendum 3 v4 Phase 1 gates 1-04..1-08 (owner rulings D87/D90/D91,
// claude_log 366/374/375, supersession notice 379). Real, committed,
// re-runnable proofs -- not a one-off script run once and discarded (R74-
// RULING-03's own bar for what counts as evidence).
import { describe, expect, test } from "bun:test"
import {
  compareBoqLinesBySortKey,
  computeBoqLineMoneyView,
  computeContractVariance,
  computeCostCoverage,
  computeGrossNetStack,
  computeProfitAtBothLevels,
  formatMoneyFigureForDisplay,
  NOT_SET,
  resolveEffectiveContractValue,
  rollUpRootLines,
  validateBoqCellEdit,
  type BoqLineForRollup,
} from "./boq-dual-view-service"

describe("computeBoqLineMoneyView -- A4 mathematics, exact, no interpretation", () => {
  test("both sides present: project/contract value, variance and variance% all compute per A4", () => {
    const view = computeBoqLineMoneyView({ qtyProject: 100, rateProject: 45, qtyContract: 100, rateContract: 50 })
    expect(view.projectValue).toBe(4500)
    expect(view.contractValue).toBe(5000)
    expect(view.variance).toBe(500) // contract - project
    expect(view.variancePercent).toBe(10) // 500/5000*100
  })

  test("1-06 NULL PROPAGATION: a line with NULL rate_project yields variance NOT_SET, never a number", () => {
    const view = computeBoqLineMoneyView({ qtyProject: 100, rateProject: null, qtyContract: 100, rateContract: 50 })
    expect(view.projectValue).toBe(NOT_SET)
    expect(view.contractValue).toBe(5000)
    expect(view.variance).toBe(NOT_SET) // NOT 5000, NOT 0 -- propagates
    expect(view.variancePercent).toBe(NOT_SET)
    expect(view.quantityVariance).toBe(NOT_SET)
    expect(view.rateVariance).toBe(NOT_SET)
  })

  test("NULL propagation also holds for every individually-missing input (undefined and empty string too)", () => {
    for (const missing of [null, undefined, ""] as const) {
      expect(computeBoqLineMoneyView({ qtyProject: missing, rateProject: 10, qtyContract: 1, rateContract: 1 }).projectValue).toBe(NOT_SET)
      expect(computeBoqLineMoneyView({ qtyProject: 1, rateProject: missing, qtyContract: 1, rateContract: 1 }).projectValue).toBe(NOT_SET)
      expect(computeBoqLineMoneyView({ qtyProject: 1, rateProject: 1, qtyContract: missing, rateContract: 1 }).contractValue).toBe(NOT_SET)
      expect(computeBoqLineMoneyView({ qtyProject: 1, rateProject: 1, qtyContract: 1, rateContract: missing }).contractValue).toBe(NOT_SET)
    }
  })

  test("X-04: a zero project_value is a REAL zero, not a stand-in for missing -- must NOT propagate as NOT_SET, and must not read as a false 100% profit without the caller seeing the zero", () => {
    // qtyProject=0 is a legitimate entered value (e.g. a line the estimator
    // has explicitly costed at zero), distinct from rateProject being absent.
    const view = computeBoqLineMoneyView({ qtyProject: 0, rateProject: 50, qtyContract: 100, rateContract: 50 })
    expect(view.projectValue).toBe(0) // a real, present zero -- not NOT_SET
    expect(view.contractValue).toBe(5000)
    expect(view.variance).toBe(5000) // 5000 - 0, correctly computed, not suppressed
  })

  test("division by zero: contract_value = 0 -> variance% is NOT_SET, never 0 and never Infinity/NaN", () => {
    const view = computeBoqLineMoneyView({ qtyProject: 10, rateProject: 5, qtyContract: 0, rateContract: 100 })
    expect(view.contractValue).toBe(0)
    expect(view.variance).toBe(-50) // 0 - 50, a real computable variance
    expect(view.variancePercent).toBe(NOT_SET) // but % of zero is undefined, not 0 or Infinity
  })

  test("1-08 variance decomposition, BOTH terms non-zero, and they sum to the total variance (A4 TOTAL = quantity variance + rate variance)", () => {
    // qty billed (100) exceeds qty measured/costed (80) by 20 units at cost rate 45 -> quantity variance = 900
    // rate charged (50) exceeds cost rate (45) by 5 at billed qty 100 -> rate variance = 500
    const view = computeBoqLineMoneyView({ qtyProject: 80, rateProject: 45, qtyContract: 100, rateContract: 50 })
    expect(view.quantityVariance).toBe((100 - 80) * 45) // 900
    expect(view.rateVariance).toBe((50 - 45) * 100) // 500
    expect(view.quantityVariance).not.toBe(0)
    expect(view.rateVariance).not.toBe(0)
    const total = (view.quantityVariance as number) + (view.rateVariance as number)
    expect(total).toBe(view.variance) // the decomposition identity A4 asserts
    expect(view.projectValue).toBe(80 * 45) // 3600
    expect(view.contractValue).toBe(100 * 50) // 5000
    expect(view.variance).toBe(5000 - 3600) // 1400, matches quantityVariance+rateVariance
  })

  test("1-05 FULL PRECISION: no intermediate rounding -- a fixture whose intermediate would round differently if rounded early", () => {
    // 1/3 has no exact binary/decimal representation; rounding qty or rate
    // to 2dp before multiplying would silently change the result versus
    // rounding only the final figure at display time.
    const qtyContract = 1 / 3
    const rateContract = 300
    const view = computeBoqLineMoneyView({ qtyProject: 0, rateProject: 0, qtyContract, rateContract })
    // Full precision: (1/3)*300 = 100 exactly (no rounding drift introduced
    // by this function). If qtyContract had been rounded to 0.33 first,
    // this would come out 99 instead.
    expect(view.contractValue).toBeCloseTo(100, 10)
    expect(view.contractValue).not.toBe(99)
    // Display-only rounding is a SEPARATE step, applied by the caller:
    expect(formatMoneyFigureForDisplay(view.contractValue)).toBe("100.00")
  })

  test("formatMoneyFigureForDisplay renders NOT_SET as the literal text, never 0 or blank (C-5)", () => {
    expect(formatMoneyFigureForDisplay(NOT_SET)).toBe(NOT_SET)
    expect(formatMoneyFigureForDisplay(1234.5)).toBe("1234.50")
  })
})

describe("rollUpRootLines -- 1-07 root-lines-only, R-32 fixture, BOTH sides, would double-count if wrong", () => {
  function fixture(): BoqLineForRollup[] {
    // Root line: qty 100 x rate 50 = 5000 (contract), qty 100 x rate 40 = 4000 (project).
    // Three weighted sub-tasks splitting the root 40/35/25%. If sub-tasks
    // were wrongly included in the roll-up, contract total would become
    // 5000 + 2000 + 1750 + 1250 = 10000 (double-counted), matching the
    // exact double-count failure mode R-32/this session's earlier work
    // already documented for the contract side -- this fixture proves the
    // SAME guard holds for the project/cost side too, which no existing
    // fixture in this codebase covered before this file.
    return [
      { parentLineItemId: null, qtyProject: 100, rateProject: 40, qtyContract: 100, rateContract: 50 },
      { parentLineItemId: "root-1", qtyProject: 100, rateProject: 16, qtyContract: 100, rateContract: 20 }, // 40%
      { parentLineItemId: "root-1", qtyProject: 100, rateProject: 14, qtyContract: 100, rateContract: 17.5 }, // 35%
      { parentLineItemId: "root-1", qtyProject: 100, rateProject: 10, qtyContract: 100, rateContract: 12.5 }, // 25%
    ]
  }

  test("contract total is the root line's own 5000, NOT 10000 -- sub-tasks excluded", () => {
    const totals = rollUpRootLines(fixture())
    expect(totals.contractValue).toBe(5000) // NOT 5000+2000+1750+1250=10000
    expect(totals.rootLineCount).toBe(1)
  })

  test("project (cost) total is the root line's own 4000, NOT 8000 -- the same guard on the cost side", () => {
    const totals = rollUpRootLines(fixture())
    expect(totals.projectValue).toBe(4000) // NOT 4000+1600+1400+1000=8000
  })

  test("variance and variance% derive from the correctly-excluded totals, not the double-counted ones", () => {
    const totals = rollUpRootLines(fixture())
    expect(totals.variance).toBe(1000) // 5000-4000, not 10000-8000(=2000)
    expect(totals.variancePercent).toBe(20) // 1000/5000*100
  })

  test("a line with no project-side data at all is excluded from the project sum (not treated as 0) while still counting toward contract", () => {
    const lines: BoqLineForRollup[] = [
      { parentLineItemId: null, qtyProject: null, rateProject: null, qtyContract: 100, rateContract: 50 },
    ]
    const totals = rollUpRootLines(lines)
    expect(totals.projectValue).toBe(NOT_SET) // no root line has any project data -> NOT_SET, not 0
    expect(totals.contractValue).toBe(5000)
  })

  test("empty input: NOT_SET for both sides, zero root lines, not a crash or a false zero", () => {
    const totals = rollUpRootLines([])
    expect(totals.projectValue).toBe(NOT_SET)
    expect(totals.contractValue).toBe(NOT_SET)
    expect(totals.rootLineCount).toBe(0)
  })
})

describe("validateBoqCellEdit -- Phase 2 2-04 inline validation", () => {
  test("negative quantity is REFUSED", () => {
    const r = validateBoqCellEdit("qty", "-5")
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.refused).toBe(true)
  })

  test("negative rate is WARNED, not refused -- a credit line is legitimate", () => {
    const r = validateBoqCellEdit("rate", "-100")
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.refused).toBe(false)
  })

  test("non-numeric input is REFUSED, for either field", () => {
    expect(validateBoqCellEdit("qty", "abc")).toEqual({ valid: false, refused: true, reason: "Enter a number." })
    expect(validateBoqCellEdit("rate", "12x").valid).toBe(false)
  })

  test("clearing a cell (empty string) is legal -- becomes NOT_SET, not refused", () => {
    expect(validateBoqCellEdit("qty", "")).toEqual({ valid: true })
    expect(validateBoqCellEdit("rate", "   ")).toEqual({ valid: true })
  })

  test("a valid positive number passes for both fields", () => {
    expect(validateBoqCellEdit("qty", "100")).toEqual({ valid: true })
    expect(validateBoqCellEdit("rate", "45.5")).toEqual({ valid: true })
  })
})

describe("compareBoqLinesBySortKey -- Phase 2 2-07, NOT_SET always sorts last regardless of direction", () => {
  type Line = { id: string; parentLineItemId: string | null; qtyProject: number | null; rateProject: number | null; qtyContract: number | null; rateContract: number | null }
  const lines: Line[] = [
    { id: "worst", parentLineItemId: null, qtyProject: 100, rateProject: 90, qtyContract: 100, rateContract: 50 }, // variance -4000
    { id: "unpriced", parentLineItemId: null, qtyProject: null, rateProject: null, qtyContract: 100, rateContract: 50 }, // NOT_SET
    { id: "best", parentLineItemId: null, qtyProject: 100, rateProject: 10, qtyContract: 100, rateContract: 50 }, // variance 4000
  ]

  test("ascending by variance: worst (most negative) first, NOT_SET last", () => {
    const sorted = [...lines].sort(compareBoqLinesBySortKey<Line>("variance", "asc"))
    expect(sorted.map((l) => l.id)).toEqual(["worst", "best", "unpriced"])
  })

  test("descending by variance: best first, NOT_SET STILL last (not first)", () => {
    const sorted = [...lines].sort(compareBoqLinesBySortKey<Line>("variance", "desc"))
    expect(sorted.map((l) => l.id)).toEqual(["best", "worst", "unpriced"])
  })

  test("all-NOT_SET input is stable and does not throw", () => {
    const allUnset: Line[] = [
      { id: "a", parentLineItemId: null, qtyProject: null, rateProject: null, qtyContract: null, rateContract: null },
      { id: "b", parentLineItemId: null, qtyProject: null, rateProject: null, qtyContract: null, rateContract: null },
    ]
    expect(() => [...allUnset].sort(compareBoqLinesBySortKey<Line>("contractValue"))).not.toThrow()
  })
})

describe("computeCostCoverage -- Phase 2 2-08, partial cost sheets must say PARTIAL, never complete", () => {
  test("half the contract value has a cost rate entered -> 50% coverage", () => {
    const lines: BoqLineForRollup[] = [
      { parentLineItemId: null, qtyProject: 10, rateProject: 5, qtyContract: 10, rateContract: 10 }, // priced, 100
      { parentLineItemId: null, qtyProject: null, rateProject: null, qtyContract: 10, rateContract: 10 }, // unpriced, 100
    ]
    const coverage = computeCostCoverage(lines)
    expect(coverage.totalContractValue).toBe(200)
    expect(coverage.coveredContractValue).toBe(100)
    expect(coverage.coverageRatio).toBe(50)
  })

  test("zero contract value entered anywhere -> coverage is NOT_SET, not divide-by-zero", () => {
    const coverage = computeCostCoverage([])
    expect(coverage.totalContractValue).toBe(NOT_SET)
    expect(coverage.coverageRatio).toBe(NOT_SET)
  })

  test("every line fully priced -> 100% coverage exactly, not 99.999... from float drift", () => {
    const lines: BoqLineForRollup[] = [
      { parentLineItemId: null, qtyProject: 3, rateProject: 1, qtyContract: 3, rateContract: 1 },
    ]
    expect(computeCostCoverage(lines).coverageRatio).toBe(100)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// PHASE 4 (gates 4-01..4-09) -- gross/net stack, profit at both levels,
// contract variance, effective contract value (override resolution).
// ─────────────────────────────────────────────────────────────────────────

describe("computeGrossNetStack -- 4-01/4-02/4-03, verified against Part C's own worked example", () => {
  // Part C's exact worked numbers: gross=850,000, VAT 5% -> net of VAT
  // 809,524, retention 5% -> net receivable 769,048. Used verbatim as the
  // fixture so this test can only pass if the formula matches the spec's
  // own example, not just "a plausible-looking VAT calculation".
  test("4-03: matches Part C's worked example exactly (full precision, not the rounded display figures)", () => {
    const stack = computeGrossNetStack(850000, 5, 5)
    expect(stack.gross).toBe(850000)
    expect(stack.netOfVat).toBeCloseTo(809523.8095238095, 6)
    expect(stack.vatAmount).toBeCloseTo(40476.19047619048, 6)
    expect(stack.retentionAmount).toBeCloseTo(40476.19047619048, 6)
    expect(stack.netReceivable).toBeCloseTo(769047.619047619, 6)
    // The spec's own display rounds each to the nearest whole AED:
    expect(Math.round(stack.netOfVat as number)).toBe(809524)
    expect(Math.round(stack.vatAmount as number)).toBe(40476)
    expect(Math.round(stack.retentionAmount as number)).toBe(40476)
    expect(Math.round(stack.netReceivable as number)).toBe(769048)
  })

  test("a naive 'VAT added on top of gross' formula would be WRONG here -- explicitly disproven", () => {
    const stack = computeGrossNetStack(850000, 5, 5)
    // The wrong formula (vatAmount = gross * rate/100) gives 42,500 / netOfVat 807,500.
    expect(stack.vatAmount).not.toBeCloseTo(42500, 0)
    expect(stack.netOfVat).not.toBeCloseTo(807500, 0)
  })

  test("4-01/4-02: VAT rate 0 -> netOfVat equals gross exactly, vatAmount 0 (not NOT_SET -- a real, entered zero rate)", () => {
    const stack = computeGrossNetStack(100000, 0, 5)
    expect(stack.netOfVat).toBe(100000)
    expect(stack.vatAmount).toBe(0)
    expect(stack.retentionAmount).toBeCloseTo(5000, 6)
    expect(stack.netReceivable).toBeCloseTo(95000, 6)
  })

  test("contractValue NOT_SET -> every figure NOT_SET, including gross", () => {
    const stack = computeGrossNetStack(NOT_SET, 5, 5)
    expect(stack).toEqual({ gross: NOT_SET, vatAmount: NOT_SET, netOfVat: NOT_SET, retentionAmount: NOT_SET, netReceivable: NOT_SET })
  })

  test("missing/unparseable vatRatePercent -> gross survives, everything downstream is NOT_SET (never a silent 0)", () => {
    for (const missing of [null, undefined, "", "abc"] as const) {
      const stack = computeGrossNetStack(500000, missing, 5)
      expect(stack.gross).toBe(500000)
      expect(stack.vatAmount).toBe(NOT_SET)
      expect(stack.netOfVat).toBe(NOT_SET)
      expect(stack.retentionAmount).toBe(NOT_SET)
      expect(stack.netReceivable).toBe(NOT_SET)
    }
  })

  test("missing retentionPercent leaves VAT figures intact but retention/net-receivable NOT_SET", () => {
    const stack = computeGrossNetStack(500000, 5, null)
    expect(stack.netOfVat).not.toBe(NOT_SET)
    expect(stack.retentionAmount).toBe(NOT_SET)
    expect(stack.netReceivable).toBe(NOT_SET)
  })

  test("division by zero: vatRatePercent = -100 (the one value making the divisor 0) -> NOT_SET, never Infinity", () => {
    const stack = computeGrossNetStack(500000, -100, 5)
    expect(stack.netOfVat).toBe(NOT_SET)
    expect(stack.vatAmount).toBe(NOT_SET)
    expect(Number.isFinite(stack.netOfVat)).toBe(false)
  })
})

describe("computeProfitAtBothLevels -- 4-04, C-3: BOTH levels always computed and labelled distinctly", () => {
  test("matches Part C's worked example: profit on gross 240,000/28.2%, profit on net receivable 159,048/20.7%", () => {
    const stack = computeGrossNetStack(850000, 5, 5)
    const profit = computeProfitAtBothLevels(stack, 610000)
    expect(profit.profitOnGross).toBe(240000)
    expect(profit.profitOnGrossPercent).toBeCloseTo(28.235294117647058, 6)
    expect(Math.round((profit.profitOnGrossPercent as number) * 10) / 10).toBe(28.2)
    expect(profit.profitOnNetReceivable).toBeCloseTo(159047.619047619, 6)
    expect(Math.round(profit.profitOnNetReceivable as number)).toBe(159048)
    expect(profit.profitOnNetReceivablePercent).toBeCloseTo(20.681114551083578, 6)
    expect(Math.round((profit.profitOnNetReceivablePercent as number) * 10) / 10).toBe(20.7)
    // Both levels are genuinely DIFFERENT numbers -- proves this isn't one
    // figure duplicated under two labels.
    expect(profit.profitOnGross).not.toBe(profit.profitOnNetReceivable)
    expect(profit.profitOnGrossPercent).not.toBe(profit.profitOnNetReceivablePercent)
  })

  test("a LOSS (project value exceeds gross) is still a real, computed negative number, never suppressed", () => {
    const stack = computeGrossNetStack(100000, 5, 5)
    const profit = computeProfitAtBothLevels(stack, 200000)
    expect(profit.profitOnGross).toBeLessThan(0)
    expect(profit.profitOnNetReceivable).toBeLessThan(0)
  })

  test("projectValue NOT_SET -> both profit figures NOT_SET, never treated as a 0-cost 100% profit (X-04)", () => {
    const stack = computeGrossNetStack(500000, 5, 5)
    const profit = computeProfitAtBothLevels(stack, NOT_SET)
    expect(profit.profitOnGross).toBe(NOT_SET)
    expect(profit.profitOnGrossPercent).toBe(NOT_SET)
    expect(profit.profitOnNetReceivable).toBe(NOT_SET)
    expect(profit.profitOnNetReceivablePercent).toBe(NOT_SET)
  })

  test("division by zero: gross/netReceivable of 0 -> percent NOT_SET, never Infinity/NaN", () => {
    const stack = computeGrossNetStack(0, 5, 5)
    const profit = computeProfitAtBothLevels(stack, 0)
    expect(profit.profitOnGross).toBe(0) // a real, computed zero (0 - 0)
    expect(profit.profitOnGrossPercent).toBe(NOT_SET) // but %-of-zero is undefined
    expect(profit.profitOnNetReceivablePercent).toBe(NOT_SET)
  })
})

describe("computeContractVariance -- A4's CONTRACT VARIANCE, a simple NOT_SET-aware delta", () => {
  test("contract value increased via an approved variation -> a positive delta", () => {
    expect(computeContractVariance(850000, 900000)).toBe(50000)
  })

  test("contract value decreased -> a real negative delta, not suppressed", () => {
    expect(computeContractVariance(900000, 850000)).toBe(-50000)
  })

  test("either side NOT_SET (e.g. no baseline confirmed yet) -> NOT_SET, never 0", () => {
    expect(computeContractVariance(NOT_SET, 900000)).toBe(NOT_SET)
    expect(computeContractVariance(850000, NOT_SET)).toBe(NOT_SET)
    expect(computeContractVariance(NOT_SET, NOT_SET)).toBe(NOT_SET)
  })

  test("no change at all is a real, computed zero, not NOT_SET", () => {
    expect(computeContractVariance(850000, 850000)).toBe(0)
  })
})

describe("resolveEffectiveContractValue -- 4-07/X-12: override NEVER overwrites the computed total, both retained", () => {
  test("no override set -> source is 'computed', value is the computed total, no override block", () => {
    const result = resolveEffectiveContractValue(850000, null)
    expect(result).toEqual({ value: 850000, source: "computed", computedTotal: 850000 })
  })

  test("4-07 CORE PROOF: computed=X, override=Y -- BOTH are retrievable from the one return value, override clearly marked as override, X is never silently replaced", () => {
    const computed = 850000
    const override = 900000
    const result = resolveEffectiveContractValue(computed, {
      value: override,
      actorId: "user-1",
      at: "2026-09-12T10:00:00Z",
      reason: "Client agreed a higher lump sum verbally, formalised by email",
      evidenceArtefactRef: "artefact://emails/msg-123",
    })
    // The figure IN FORCE is the override...
    expect(result.value).toBe(override)
    expect(result.source).toBe("override")
    // ...but the computed BOQ total is STILL retained and readable, unchanged:
    expect(result.computedTotal).toBe(computed)
    expect(result.computedTotal).not.toBe(result.value)
    // and the override is clearly marked, not merged silently into `value`:
    expect(result.override).toEqual({
      value: override,
      actorId: "user-1",
      at: "2026-09-12T10:00:00Z",
      reason: "Client agreed a higher lump sum verbally, formalised by email",
      evidenceArtefactRef: "artefact://emails/msg-123",
    })
  })

  test("override present even when LOWER than the computed total -- still 'in force', computed total still retained", () => {
    const result = resolveEffectiveContractValue(900000, {
      value: 850000, actorId: "user-1", at: "2026-09-12", reason: "negotiated down", evidenceArtefactRef: "artefact://po/PO-99",
    })
    expect(result.value).toBe(850000)
    expect(result.computedTotal).toBe(900000)
    expect(result.source).toBe("override")
  })

  test("override with a null/unparseable value is treated as no override at all -- falls back to computed", () => {
    const result = resolveEffectiveContractValue(850000, {
      value: null, actorId: "user-1", at: "2026-09-12", reason: "x", evidenceArtefactRef: "y",
    })
    expect(result.source).toBe("computed")
    expect(result.value).toBe(850000)
  })

  test("computedTotal itself NOT_SET (no root lines yet) but an override IS set -- override still resolves, computedTotal stays NOT_SET (not coerced to 0)", () => {
    const result = resolveEffectiveContractValue(NOT_SET, {
      value: 500000, actorId: "user-1", at: "2026-09-12", reason: "x", evidenceArtefactRef: "y",
    })
    expect(result.value).toBe(500000)
    expect(result.source).toBe("override")
    expect(result.computedTotal).toBe(NOT_SET)
  })
})
