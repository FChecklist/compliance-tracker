// VERIDIAN Review Framework gap-closure ("Calculation Cross-Verification"):
// for the financially material calculators the review named -- GST,
// payroll, EMI -- a single computation path being internally self-consistent
// isn't the same as it being independently confirmed correct. GST already
// has this discipline (gst/validation-engine.ts's checkTaxCalculation()
// recomputes the expected split via splitGst() and compares it against the
// entered/booked amount) -- not duplicated here. This file adds the same
// discipline to the two domains that didn't have it: payroll (gratuity, the
// largest and most statutorily strict single payroll payout) and banking
// (EMI/loan amortization).
//
// Deliberately invariant-based, not "call the same formula twice": each
// check recomputes a property the primary calculation MUST satisfy via a
// different route than the one that produced the result (summing the
// amortization schedule instead of re-deriving the closed-form EMI;
// checking the gratuity/salary ratio against the statute's own mathematical
// bound instead of re-running the same 15/26 formula) -- so a future bug in
// the primary formula's arithmetic doesn't automatically pass its own check.
import Decimal from "decimal.js"
import type { EmiInput, EmiResult } from "@/lib/engines/banking-engine"
import type { GratuityInput, GratuityResult } from "@/lib/engines/payroll-engine"

export class CalculationVerificationError extends Error {}

export type CrossVerificationResult = { verified: true } | { verified: false; reason: string }

// Currency-unit rounding tolerance, same convention as gst/validation-engine.ts's AMOUNT_TOLERANCE.
const TOLERANCE = 1

/**
 * Independently re-derives principal/interest/EMI totals from the
 * amortization SCHEDULE itself (summation), rather than re-running the
 * closed-form EMI formula that produced it -- catches a schedule-building
 * bug the closed-form formula alone would never surface.
 */
export function crossVerifyEmi(input: EmiInput, result: EmiResult): CrossVerificationResult {
  if (result.schedule.length !== input.tenureMonths) {
    return { verified: false, reason: `Schedule has ${result.schedule.length} rows, expected ${input.tenureMonths} (one per month).` }
  }

  const summedPrincipal = result.schedule.reduce((sum, row) => sum.plus(row.principalPaid), new Decimal(0))
  if (summedPrincipal.minus(input.principal).abs().greaterThan(TOLERANCE)) {
    return { verified: false, reason: `Schedule's total principal paid (${summedPrincipal.toFixed(2)}) doesn't match the loan principal (${input.principal}).` }
  }

  const summedInterest = result.schedule.reduce((sum, row) => sum.plus(row.interestPaid), new Decimal(0))
  if (summedInterest.minus(result.totalInterest).abs().greaterThan(TOLERANCE)) {
    return { verified: false, reason: `Schedule's total interest (${summedInterest.toFixed(2)}) doesn't match the reported total interest (${result.totalInterest}).` }
  }

  const finalBalance = result.schedule[result.schedule.length - 1]?.balance ?? -1
  if (Math.abs(finalBalance) > TOLERANCE) {
    return { verified: false, reason: `Final schedule balance (${finalBalance}) is not zero -- the loan isn't fully amortized by the last installment.` }
  }

  // Rounding on every individual EMI row can compound across a long tenure -- tolerance scales with row count.
  const summedEmiTotal = result.schedule.reduce((sum, row) => sum.plus(row.emi), new Decimal(0))
  if (summedEmiTotal.minus(result.totalPayment).abs().greaterThan(TOLERANCE * input.tenureMonths)) {
    return { verified: false, reason: `Sum of monthly EMIs (${summedEmiTotal.toFixed(2)}) doesn't reconcile with the reported total payment (${result.totalPayment}).` }
  }

  return { verified: true }
}

/**
 * Sanity-bound check (there's no schedule to re-sum for a single-payout
 * calculation): the Payment of Gratuity Act formula is 15/26 (or 15/30) of
 * monthly salary per year of service -- for either divisor, the payout can
 * never exceed ONE month's salary per year of service. If a future change
 * to calculateGratuity() ever broke that bound (wrong divisor, a stray *12,
 * multiplication instead of division), this independent bound check catches
 * it even though it reuses none of the calculator's own formula code.
 */
export function crossVerifyGratuity(input: GratuityInput, result: GratuityResult): CrossVerificationResult {
  if (result.gratuityAmount < 0) {
    return { verified: false, reason: "Computed gratuity is negative." }
  }
  if (result.statutoryCapApplied) return { verified: true } // capped -- the ratio bound below no longer applies once the statutory ceiling wins

  const maxPlausible = new Decimal(input.lastDrawnMonthlySalary).mul(result.roundedYearsOfService)
  if (new Decimal(result.gratuityAmount).greaterThan(maxPlausible.plus(TOLERANCE))) {
    return { verified: false, reason: `Computed gratuity (Rs ${result.gratuityAmount}) exceeds one month's salary per year of service (Rs ${maxPlausible.toFixed(2)} max) -- the 15/26 or 15/30 formula should never reach that ratio.` }
  }
  return { verified: true }
}

export function assertCalculationVerified(result: CrossVerificationResult, context: string): void {
  if (!result.verified) {
    throw new CalculationVerificationError(`${context}: cross-verification failed -- ${result.reason} Not returned, as it may be inaccurate.`)
  }
}
