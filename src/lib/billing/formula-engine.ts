// R65 Part E -- Billing Engine, Formula 1 + Formula 2 pure calculators.
// See memory: veridian_r65_part_e_billing_engine_directive_2026-09-01 for
// the full 33-section directive this implements, and
// veridian_r65_part_e_phase0_architecture_report_2026-09-01 for why PR
// #635's cost-plus-margin engine (src/lib/billing/ai-usage-billing.ts,
// closed/not merged) is NOT reusable here: these are two different
// commercial models (owner-set rate card vs cost-plus-margin), not the
// same model with different constants. This module implements ONLY the
// directive's actual formulas -- no margin, no owner-cost computation
// anywhere in this file.
//
// Deliberately DB-free (same "pure calculation module" pattern PR #635
// used, per the Phase 0 report's own recommendation to keep as a pattern
// even though its algorithm wasn't reusable) -- every function here is a
// plain, synchronous, side-effect-free transform so it can be unit-tested
// without a database and reused unchanged by both the cost-rollup service
// (billing-cost-rollup-service.ts, per-call token pricing) and, later, a
// real invoice-generation path (Phase 6, not built yet).
//
// SCOPE OF THIS FILE: gross formula calculation only (directive §4-10).
// The commercial-customization pipeline (discounts/credits/waivers/min-max/
// taxes, directive §11-25) is explicitly Phase 5 and NOT implemented here
// -- see this file's own tests for how the directive's worked examples
// (§21-22) are verified against gross-formula output plus a bare inline
// discount multiplication in the test itself, not a production discount
// engine.

/** Formula 1 (directive §4-5): Gross = Base Monthly Charge + (MAX(0, ActiveUsers - IncludedUsers) x AdditionalUserRate). */
export type Formula1Input = {
  baseRate: number
  includedUsers: number
  additionalUserRate: number
  activeUsers: number
}

export type Formula1Result = {
  baseCharge: number
  additionalUsers: number
  additionalUserCharge: number
  gross: number
}

export function computeFormula1Gross(input: Formula1Input): Formula1Result {
  const additionalUsers = Math.max(0, input.activeUsers - input.includedUsers)
  const additionalUserCharge = additionalUsers * input.additionalUserRate
  const gross = input.baseRate + additionalUserCharge
  return {
    baseCharge: input.baseRate,
    additionalUsers,
    additionalUserCharge,
    gross,
  }
}

/**
 * Formula 2 (directive §6-10): Gross = (ActiveUsers x BaseUserRate) +
 * (BillableInputTokens x InputRate) + (BillableOutputTokens x OutputRate) +
 * (BillableSoftwareTokens x SoftwareRate), where BillableXTokens = RawXTokens
 * x TokenMultiplier. Token rates are expressed PER 1,000 BILLABLE TOKENS,
 * verified against the directive's own worked arithmetic (§13/§22: 1M raw
 * input tokens x 1.2 multiplier = 1,200,000 billable, at Rs.8/1k tokens =
 * Rs.9,600 -- matches exactly).
 *
 * Raw usage is a required input and is NEVER mutated by this function
 * (directive §24-25, "usage stored independently from price") -- the
 * caller is responsible for persisting rawInputTokens/rawOutputTokens/
 * rawSoftwareTokens unchanged regardless of what this function returns.
 *
 * rawSoftwareTokens/softwareTokenRate default to 0: directive §9's
 * software-token billing has no real data source yet (token_usage_ledger
 * tracks AI prompt/completion tokens only, no deterministic-software-work
 * counter) -- see billing-cost-rollup-service.ts's header for the disclosed
 * gap. The parameter exists so this function is spec-complete and testable
 * against §13's full worked example even though no real caller populates
 * it today.
 */
export type Formula2Input = {
  activeUsers: number
  baseUserRate: number
  rawInputTokens: number
  rawOutputTokens: number
  rawSoftwareTokens?: number
  inputTokenRate: number
  outputTokenRate: number
  softwareTokenRate?: number
  tokenMultiplier: number
}

export type Formula2Result = {
  baseUserCharge: number
  billableInputTokens: number
  billableOutputTokens: number
  billableSoftwareTokens: number
  inputCharge: number
  outputCharge: number
  softwareCharge: number
  gross: number
}

export function computeFormula2Gross(input: Formula2Input): Formula2Result {
  const rawSoftwareTokens = input.rawSoftwareTokens ?? 0
  const softwareTokenRate = input.softwareTokenRate ?? 0

  const billableInputTokens = input.rawInputTokens * input.tokenMultiplier
  const billableOutputTokens = input.rawOutputTokens * input.tokenMultiplier
  const billableSoftwareTokens = rawSoftwareTokens * input.tokenMultiplier

  const baseUserCharge = input.activeUsers * input.baseUserRate
  const inputCharge = (billableInputTokens / 1000) * input.inputTokenRate
  const outputCharge = (billableOutputTokens / 1000) * input.outputTokenRate
  const softwareCharge = (billableSoftwareTokens / 1000) * softwareTokenRate

  return {
    baseUserCharge,
    billableInputTokens,
    billableOutputTokens,
    billableSoftwareTokens,
    inputCharge,
    outputCharge,
    softwareCharge,
    gross: baseUserCharge + inputCharge + outputCharge + softwareCharge,
  }
}
