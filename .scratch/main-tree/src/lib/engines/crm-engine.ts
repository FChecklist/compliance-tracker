// VCEL CRM Engine. lead_score_calculator already has partial coverage in crm-service.ts.
import Decimal from "decimal.js"

// 1. Customer Lifetime Value Calculator -- standard formula: avg order value * purchase frequency * customer lifespan
export function calculateCustomerLifetimeValue(avgOrderValue: number, purchaseFrequencyPerYear: number, customerLifespanYears: number): number {
  return round2(new Decimal(avgOrderValue).mul(purchaseFrequencyPerYear).mul(customerLifespanYears))
}

// 2. Churn Probability Calculator -- heuristic score from recency/engagement decline (0-1), not an ML model
export function calculateChurnProbability(daysSinceLastActivity: number, engagementDeclinePercent: number): number {
  const recencyFactor = Math.min(1, daysSinceLastActivity / 180)
  const declineFactor = Math.min(1, Math.max(0, engagementDeclinePercent) / 100)
  return round2(new Decimal(recencyFactor).mul(0.6).plus(new Decimal(declineFactor).mul(0.4)))
}

// 3. RFM Scoring Engine -- classic Recency/Frequency/Monetary quintile scoring (1-5 each)
export function calculateRfmScore(customers: { id: string; recencyDays: number; frequency: number; monetary: number }[]): Record<string, { r: number; f: number; m: number; rfmScore: string }> {
  const quintile = (values: number[], value: number, inverse = false): number => {
    const sorted = [...values].sort((a, b) => a - b)
    const rank = sorted.filter((v) => v <= value).length / sorted.length
    const score = Math.max(1, Math.min(5, Math.ceil(rank * 5)))
    return inverse ? 6 - score : score
  }
  const recencies = customers.map((c) => c.recencyDays)
  const frequencies = customers.map((c) => c.frequency)
  const monetaries = customers.map((c) => c.monetary)
  const result: Record<string, { r: number; f: number; m: number; rfmScore: string }> = {}
  for (const c of customers) {
    const r = quintile(recencies, c.recencyDays, true) // lower recency days = better = higher score
    const f = quintile(frequencies, c.frequency)
    const m = quintile(monetaries, c.monetary)
    result[c.id] = { r, f, m, rfmScore: `${r}${f}${m}` }
  }
  return result
}

// 4. Opportunity Score Calculator -- weighted score across deal-qualification factors (0-100 each)
export function calculateOpportunityScore(factors: { budget: number; authority: number; need: number; timeline: number }): number {
  return round2(new Decimal(factors.budget).plus(factors.authority).plus(factors.need).plus(factors.timeline).div(4))
}

// 5. Customer Health Score -- weighted blend of usage, support tickets (inverse), and payment timeliness (0-100 each input)
export function calculateCustomerHealthScore(input: { usageScore: number; supportScore: number; paymentScore: number }, weights = { usage: 0.5, support: 0.2, payment: 0.3 }): number {
  return round2(new Decimal(input.usageScore).mul(weights.usage).plus(new Decimal(input.supportScore).mul(weights.support)).plus(new Decimal(input.paymentScore).mul(weights.payment)))
}

function round2(d: Decimal): number { return d.toDecimalPlaces(2).toNumber() }
