// VCEL Compliance Engine -- remaining engines (due_date_calculator and
// compliance_calendar_engine are already implemented as core product features).
import Decimal from "decimal.js"

// 1. Interest Calculator (Compliance) -- generic simple-interest late-payment calculator, reusable across module types (rate/basis supplied by caller since it varies per statute)
export function calculateComplianceInterest(amount: number, annualRatePercent: number, daysLate: number): number {
  return round2(new Decimal(amount).mul(annualRatePercent).div(100).mul(Math.max(0, daysLate)).div(365))
}

// 2. Filing Eligibility Engine -- checks a set of named preconditions before allowing a filing
export function checkFilingEligibility(preconditions: { name: string; met: boolean }[]): { eligible: boolean; unmetConditions: string[] } {
  const unmet = preconditions.filter((p) => !p.met).map((p) => p.name)
  return { eligible: unmet.length === 0, unmetConditions: unmet }
}

// 3. Document Completeness Checker -- compares required document list against what's on file
export function checkDocumentCompleteness(requiredDocuments: string[], filedDocuments: string[]): { complete: boolean; missingDocuments: string[] } {
  const filedSet = new Set(filedDocuments)
  const missing = requiredDocuments.filter((d) => !filedSet.has(d))
  return { complete: missing.length === 0, missingDocuments: missing }
}

// 4. Compliance Risk Scoring -- weighted sum across risk dimensions (overdue items, past penalties, filing history), same pattern as audit-engine's calculateRiskScore
export function calculateComplianceRiskScore(input: { overdueItemsCount: number; pastPenaltiesCount: number; totalItemsCount: number }): number {
  if (input.totalItemsCount <= 0) return 0
  const overdueRatio = input.overdueItemsCount / input.totalItemsCount
  const penaltyWeight = Math.min(input.pastPenaltiesCount * 5, 40)
  return round2(new Decimal(overdueRatio).mul(60).plus(penaltyWeight))
}

function round2(d: Decimal): number { return d.toDecimalPlaces(2).toNumber() }
