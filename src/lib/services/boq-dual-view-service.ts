// R85 Addendum 3 v4 (FINAL, supersedes v3/v2/Addendum 2 -- claude_log 379),
// owner rulings D87 (366) D88 (372) D89 (373) D90 (374) D91 (375).
//
// ★ SINGLE PRODUCER RULE (Part D) ★ -- this file is THE ONE place every
// project/contract/variance figure for a BOQ line is computed. Every screen
// (BOQ grid, financial block, dashboard, analysis) calls these functions;
// no screen computes its own version. This rule exists because the R67
// D-62 bug was one project telling three different money stories on three
// screens -- see this file's own header precedent in construction-dashboard-
// service.ts for the same lesson applied elsewhere.
//
// Nothing here is stored. Per A6: project_value, contract_value, variance,
// variance %, quantity variance and rate variance are ALL derived, never
// columns. The four STORED inputs (qtyProject/rateProject/qtyContract/
// rateContract) live on constructionBoqLineItems (drizzle/0593).
//
// Rules this module exists to enforce (Part A4/A9, Part G prohibitions):
//   X-02 never store a computed field
//   X-03 never round an intermediate -- full precision, round at display only
//   X-04 never treat NULL as 0 -- a zero project_value yields a 100% profit
//        and is a lie, so absence must propagate as NOT_SET, not silently 0
//   X-27 one producer -- do not duplicate this math on a screen or route

/** A money/percentage figure that may be legitimately unavailable. NEVER a
 * literal 0 standing in for "unknown" -- callers must render this exact
 * string as-is (C-5: "NOT_SET renders as the literal text NOT_SET. Never 0,
 * never blank, never a dash that reads as zero."). */
export const NOT_SET = "NOT_SET" as const
export type MoneyFigure = number | typeof NOT_SET

export type BoqLineMoneyInput = {
  // Drizzle's `numeric` column type comes back as a string (postgres.js
  // avoids silent float-precision loss on NUMERIC by not casting it),
  // so every real caller reading this off a DB row passes strings here.
  // null/undefined/"" all mean "not entered yet" -- distinct from 0.
  qtyProject: number | string | null | undefined
  rateProject: number | string | null | undefined
  qtyContract: number | string | null | undefined
  rateContract: number | string | null | undefined
}

export type BoqLineMoneyView = {
  projectValue: MoneyFigure
  contractValue: MoneyFigure
  variance: MoneyFigure
  variancePercent: MoneyFigure
  quantityVariance: MoneyFigure
  rateVariance: MoneyFigure
}

/** Parses a DB numeric-as-string (or number) into a finite number, or null
 * if genuinely absent/unparseable. Never coerces null/undefined/"" to 0 --
 * that coercion is exactly what X-04 forbids further up the call chain. */
function toFinite(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * A4's mathematics, exactly, no interpretation. Computed at full precision;
 * this function NEVER rounds -- rounding is a display-layer concern (A4
 * "ROUNDING: compute at FULL PRECISION. Round ONLY at display. NEVER store a
 * rounded intermediate.").
 */
export function computeBoqLineMoneyView(input: BoqLineMoneyInput): BoqLineMoneyView {
  const qtyProject = toFinite(input.qtyProject)
  const rateProject = toFinite(input.rateProject)
  const qtyContract = toFinite(input.qtyContract)
  const rateContract = toFinite(input.rateContract)

  const projectValue: MoneyFigure =
    qtyProject === null || rateProject === null ? NOT_SET : qtyProject * rateProject
  const contractValue: MoneyFigure =
    qtyContract === null || rateContract === null ? NOT_SET : qtyContract * rateContract

  // NULL PROPAGATION (A4): either side NOT_SET -> variance is NOT_SET.
  const variance: MoneyFigure =
    projectValue === NOT_SET || contractValue === NOT_SET ? NOT_SET : contractValue - projectValue

  // DIVISION BY ZERO (A4): contract_value = 0 or unavailable -> NOT_SET,
  // never 0 and never Infinity/-Infinity/NaN.
  const variancePercent: MoneyFigure =
    variance === NOT_SET || contractValue === NOT_SET || contractValue === 0
      ? NOT_SET
      : (variance / contractValue) * 100

  // Decomposition (A4): QUANTITY VARIANCE = (qty_contract - qty_project) * rate_project
  //                     RATE VARIANCE     = (rate_contract - rate_project) * qty_contract
  // Both need all four raw inputs present, independent of whether project/
  // contractValue themselves resolved (they always will together, but this
  // is written independently so a future change to one side's formula can't
  // silently break the other's NULL handling).
  const quantityVariance: MoneyFigure =
    qtyContract === null || qtyProject === null || rateProject === null
      ? NOT_SET
      : (qtyContract - qtyProject) * rateProject
  const rateVariance: MoneyFigure =
    rateContract === null || rateProject === null || qtyContract === null
      ? NOT_SET
      : (rateContract - rateProject) * qtyContract

  return { projectValue, contractValue, variance, variancePercent, quantityVariance, rateVariance }
}

export type BoqLineForRollup = {
  parentLineItemId: string | null
} & BoqLineMoneyInput

export type BoqRollupTotals = {
  projectValue: MoneyFigure
  contractValue: MoneyFigure
  variance: MoneyFigure
  variancePercent: MoneyFigure
  /** Number of root lines actually included -- lets a caller distinguish
   * "0 because every root line is NOT_SET" from "0 because there are no
   * root lines at all", which read very differently to a user. */
  rootLineCount: number
}

/**
 * Root-lines-only roll-up (A7, R-32 unchanged): weighted sub-tasks
 * (parentLineItemId set) are EXCLUDED from both totals -- a sub-task must
 * never double-count into either project or contract value. Applies to
 * BOTH sides identically (the same fixture that would double-count a
 * contract total if wrong applies equally to the project-cost total).
 *
 * A line whose own project/contract value is NOT_SET is excluded from that
 * particular sum (not treated as 0) so a handful of unpriced lines don't
 * silently understate the total -- callers combine this with the cost-
 * coverage indicator (Phase 2 2-08) to show PARTIAL rather than a
 * confidently-wrong number.
 */
export function rollUpRootLines(lines: BoqLineForRollup[]): BoqRollupTotals {
  const rootLines = lines.filter((l) => l.parentLineItemId === null)
  let projectSum = 0
  let projectAny = false
  let contractSum = 0
  let contractAny = false

  for (const line of rootLines) {
    const view = computeBoqLineMoneyView(line)
    if (view.projectValue !== NOT_SET) {
      projectSum += view.projectValue
      projectAny = true
    }
    if (view.contractValue !== NOT_SET) {
      contractSum += view.contractValue
      contractAny = true
    }
  }

  const projectValue: MoneyFigure = projectAny ? projectSum : NOT_SET
  const contractValue: MoneyFigure = contractAny ? contractSum : NOT_SET
  const variance: MoneyFigure =
    projectValue === NOT_SET || contractValue === NOT_SET ? NOT_SET : contractValue - projectValue
  const variancePercent: MoneyFigure =
    variance === NOT_SET || contractValue === NOT_SET || contractValue === 0
      ? NOT_SET
      : (variance / contractValue) * 100

  return { projectValue, contractValue, variance, variancePercent, rootLineCount: rootLines.length }
}

/**
 * COST COVERAGE (Phase 2, 2-08): what fraction of root-line contract value
 * has a project-side rate entered at all. A 300-line BOQ with every cost
 * blank is a wall; this lets a screen say "profit is PARTIAL, priced on
 * 12% of contract value" instead of presenting a confident-looking number
 * built on almost no cost data.
 */
export function computeCostCoverage(lines: BoqLineForRollup[]): {
  coveredContractValue: number
  totalContractValue: MoneyFigure
  coverageRatio: MoneyFigure
} {
  const rootLines = lines.filter((l) => l.parentLineItemId === null)
  let coveredContractValue = 0
  let totalContractValue = 0
  let anyContract = false

  for (const line of rootLines) {
    const view = computeBoqLineMoneyView(line)
    if (view.contractValue !== NOT_SET) {
      totalContractValue += view.contractValue
      anyContract = true
      if (view.projectValue !== NOT_SET) coveredContractValue += view.contractValue
    }
  }

  const total: MoneyFigure = anyContract ? totalContractValue : NOT_SET
  const coverageRatio: MoneyFigure =
    total === NOT_SET || total === 0 ? NOT_SET : (coveredContractValue / total) * 100

  return { coveredContractValue, totalContractValue: total, coverageRatio }
}

export type BoqCellValidation = { valid: true } | { valid: false; refused: boolean; reason: string }

/**
 * Phase 2, 2-04 inline validation for a single qty/rate cell edit.
 * - negative quantity: REFUSED (a negative quantity has no real meaning here)
 * - negative rate: WARNED, not refused -- a credit line is legitimate
 * - non-numeric: REFUSED
 * `refused: false` on an invalid result means "let the value through with a
 * visible warning"; `refused: true` means the edit must not be accepted.
 */
export function validateBoqCellEdit(field: "qty" | "rate", raw: string): BoqCellValidation {
  const trimmed = raw.trim()
  if (trimmed === "") return { valid: true } // clearing a cell is legal -- becomes NOT_SET
  const n = Number(trimmed)
  if (!Number.isFinite(n)) return { valid: false, refused: true, reason: "Enter a number." }
  if (n < 0) {
    if (field === "qty") return { valid: false, refused: true, reason: "Quantity cannot be negative." }
    // field === "rate": a credit/rebate line is a legitimate real-world case.
    return { valid: false, refused: false, reason: "Negative rate -- confirm this is intended (e.g. a credit line)." }
  }
  return { valid: true }
}

export type BoqLineSortKey = "variance" | "variancePercent" | "contractValue" | "quantityVariance"

/**
 * Phase 2, 2-07: sort comparator for the grid's "what is killing the job"
 * views. NOT_SET always sorts LAST regardless of direction -- an unpriced
 * line is neither the best nor the worst performer, it is simply unknown,
 * and burying known-bad lines under a pile of NOT_SET rows would defeat the
 * entire purpose of the sort (2-07: "the sorted list is what the user acts
 * on").
 */
export function compareBoqLinesBySortKey<T extends { parentLineItemId: string | null } & BoqLineMoneyInput>(
  key: BoqLineSortKey,
  direction: "asc" | "desc" = "asc",
) {
  return (a: T, b: T): number => {
    const va = computeBoqLineMoneyView(a)[key]
    const vb = computeBoqLineMoneyView(b)[key]
    if (va === NOT_SET && vb === NOT_SET) return 0
    if (va === NOT_SET) return 1 // NOT_SET always last
    if (vb === NOT_SET) return -1
    return direction === "asc" ? va - vb : vb - va
  }
}

/**
 * Rounds a MoneyFigure for DISPLAY ONLY (X-03: never round an intermediate,
 * never store a rounded value). `decimals` defaults to 2 for currency; pass
 * a different value for a percentage if the caller wants more precision on
 * screen. NOT_SET passes through unchanged -- rendering it is the caller's
 * job (C-5), this function never turns it into a number.
 */
export function formatMoneyFigureForDisplay(figure: MoneyFigure, decimals = 2): string {
  if (figure === NOT_SET) return NOT_SET
  return figure.toFixed(decimals)
}

// ─────────────────────────────────────────────────────────────────────────
// PHASE 4 (E3, gates 4-01..4-09; owner rulings D87 claude_log 366, D88 372,
// D91 375) -- gross/net stack, profit at both levels, contract variance and
// the manual contract override. Additive to this file, per X-27/the single-
// producer rule: these are the SAME kind of derived money figure as
// computeBoqLineMoneyView's outputs above, so they belong in the one module
// every screen already calls, not a parallel computation somewhere else.
// Nothing below is stored (4-05) -- see drizzle/0594's own header for the
// two real columns this phase DID add (vatRatePercent/retentionPercent, the
// two INPUT rates -- never the derived gross/net/profit figures themselves).
// ─────────────────────────────────────────────────────────────────────────

export type GrossNetStack = {
  gross: MoneyFigure
  vatAmount: MoneyFigure
  netOfVat: MoneyFigure
  retentionAmount: MoneyFigure
  netReceivable: MoneyFigure
}

/**
 * E3's gross/net stack:
 *   GROSS CONTRACT VALUE
 *   less VAT       -> NET OF VAT
 *   less RETENTION -> NET RECEIVABLE
 *
 * VAT IS EXTRACTED FROM A VAT-INCLUSIVE GROSS FIGURE, NOT ADDED ON TOP --
 * verified against Part C's own worked numeric example, not assumed:
 * gross=850,000, vatRatePercent=5 -> netOfVat=809,524, i.e.
 * netOfVat = gross / (1 + vatRate/100), vatAmount = gross - netOfVat. A
 * naive "vatAmount = gross * rate/100" gives 42,500 / netOfVat 807,500 --
 * DOES NOT match the spec's own example, and was the first (wrong) version
 * of this function until checked against Part C's numbers directly. RETENTION
 * is then a plain percentage of netOfVat (not a second inclusive
 * extraction) -- the same worked example's retentionAmount=40,476 equals
 * netOfVat*5% exactly, and netReceivable=769,048 = netOfVat - that amount.
 *
 * Full NOT_SET propagation, same rules as computeBoqLineMoneyView above:
 * a missing contractValue or a missing/unparseable rate makes every
 * downstream figure NOT_SET, never a silent 0 (X-04). `gross` is the one
 * figure that survives a missing rate -- it is contractValue itself,
 * unchanged -- so a caller can still show the top line while the rest of
 * the stack waits on a real rate. A vatRatePercent of exactly -100 (the
 * only value making the (1 + rate/100) divisor zero) is treated as
 * division-by-zero -> NOT_SET, never Infinity/NaN.
 */
export function computeGrossNetStack(
  contractValue: MoneyFigure,
  vatRatePercent: number | string | null | undefined,
  retentionPercent: number | string | null | undefined
): GrossNetStack {
  const gross = contractValue
  if (contractValue === NOT_SET) {
    return { gross: NOT_SET, vatAmount: NOT_SET, netOfVat: NOT_SET, retentionAmount: NOT_SET, netReceivable: NOT_SET }
  }

  const vatRate = toFinite(vatRatePercent)
  const vatDivisor = vatRate === null ? null : 1 + vatRate / 100
  const netOfVat: MoneyFigure = vatDivisor === null || vatDivisor === 0 ? NOT_SET : contractValue / vatDivisor
  const vatAmount: MoneyFigure = netOfVat === NOT_SET ? NOT_SET : contractValue - netOfVat

  const retentionRate = toFinite(retentionPercent)
  const retentionAmount: MoneyFigure =
    netOfVat === NOT_SET || retentionRate === null ? NOT_SET : netOfVat * (retentionRate / 100)
  const netReceivable: MoneyFigure =
    netOfVat === NOT_SET || retentionAmount === NOT_SET ? NOT_SET : netOfVat - retentionAmount

  return { gross, vatAmount, netOfVat, retentionAmount, netReceivable }
}

export type ProfitAtBothLevels = {
  profitOnGross: MoneyFigure
  profitOnGrossPercent: MoneyFigure
  profitOnNetReceivable: MoneyFigure
  profitOnNetReceivablePercent: MoneyFigure
}

/**
 * C-3/4-04: profit computed and LABELLED at BOTH gross and net-receivable
 * levels -- the user chooses nothing, both are always shown (C-8, X-30: no
 * toggle between them). Division-by-zero and NULL propagation follow the
 * exact same rules as computeBoqLineMoneyView's variancePercent above: a
 * zero or NOT_SET denominator yields NOT_SET, never 0 or Infinity.
 */
export function computeProfitAtBothLevels(stack: GrossNetStack, projectValue: MoneyFigure): ProfitAtBothLevels {
  const profitOnGross: MoneyFigure =
    stack.gross === NOT_SET || projectValue === NOT_SET ? NOT_SET : stack.gross - projectValue
  const profitOnGrossPercent: MoneyFigure =
    profitOnGross === NOT_SET || stack.gross === NOT_SET || stack.gross === 0
      ? NOT_SET
      : (profitOnGross / stack.gross) * 100

  const profitOnNetReceivable: MoneyFigure =
    stack.netReceivable === NOT_SET || projectValue === NOT_SET ? NOT_SET : stack.netReceivable - projectValue
  const profitOnNetReceivablePercent: MoneyFigure =
    profitOnNetReceivable === NOT_SET || stack.netReceivable === NOT_SET || stack.netReceivable === 0
      ? NOT_SET
      : (profitOnNetReceivable / stack.netReceivable) * 100

  return { profitOnGross, profitOnGrossPercent, profitOnNetReceivable, profitOnNetReceivablePercent }
}

/**
 * A4's CONTRACT VARIANCE = contract_value now - contract_value at first
 * confirmation. A simple, NOT_SET-aware delta -- deliberately takes two
 * caller-supplied figures rather than reading a baseline row itself, so
 * this function has no dependency on Phase 3's boq_baseline table (a
 * separate, in-flight, not-yet-merged piece of this same spec -- see this
 * file's own PR/ACTIVE-CLAIMS entry). Whoever wires Phase 3's baseline
 * table to this figure passes its snapshot value as the first argument.
 */
export function computeContractVariance(
  contractValueAtFirstConfirmation: MoneyFigure,
  contractValueNow: MoneyFigure
): MoneyFigure {
  if (contractValueAtFirstConfirmation === NOT_SET || contractValueNow === NOT_SET) return NOT_SET
  return contractValueNow - contractValueAtFirstConfirmation
}

export type ContractValueOverrideDetails = {
  value: number
  actorId: string
  at: Date | string
  reason: string
  evidenceArtefactRef: string
}

export type EffectiveContractValue = {
  /** The figure actually in force -- the override's value when one is set, otherwise computedTotal. */
  value: MoneyFigure
  source: "computed" | "override"
  /** ALWAYS the rolled-up BOQ total, regardless of `source` -- 4-07/X-12: an
   * override NEVER overwrites this, and this field is how a caller (and this
   * function's own test) proves both figures are still retrievable even
   * when an override is in force. */
  computedTotal: MoneyFigure
  /** Present only when `source === "override"`. */
  override?: ContractValueOverrideDetails
}

/**
 * 4-07/X-12: "a separate column with actor, timestamp, reason AND a cited
 * evidence artefact. It NEVER overwrites the computed BOQ total -- both are
 * retained and which is in force is shown." This is that decision, made in
 * exactly one place (X-27): the override is "in force" whenever one has a
 * real numeric value set, full stop -- it does not matter whether it is
 * larger or smaller than computedTotal, or whether computedTotal is itself
 * NOT_SET. `computedTotal` is echoed back unchanged either way, so a caller
 * (or a test) can always see both figures from this one return value.
 */
export function resolveEffectiveContractValue(
  computedTotal: MoneyFigure,
  override:
    | { value: number | string | null | undefined; actorId: string; at: Date | string; reason: string; evidenceArtefactRef: string }
    | null
    | undefined
): EffectiveContractValue {
  const overrideValue = override ? toFinite(override.value) : null
  if (override === null || override === undefined || overrideValue === null) {
    return { value: computedTotal, source: "computed", computedTotal }
  }
  return {
    value: overrideValue,
    source: "override",
    computedTotal,
    override: {
      value: overrideValue,
      actorId: override.actorId,
      at: override.at,
      reason: override.reason,
      evidenceArtefactRef: override.evidenceArtefactRef,
    },
  }
}
