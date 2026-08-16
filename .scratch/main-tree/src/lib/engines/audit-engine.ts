// VCEL Audit Engine. audit_sampling_engine (finance:sox-testing skill) and
// compliance_scoring_engine already have partial coverage elsewhere.
import Decimal from "decimal.js"
import * as ss from "simple-statistics"

// 1. Materiality Calculator -- standard audit convention: 0.5-1% of revenue or 5-10% of net profit, whichever base is provided
export function calculateMateriality(baseAmount: number, baseType: "revenue" | "net_profit" | "total_assets"): number {
  const percent = baseType === "revenue" ? 0.75 : baseType === "net_profit" ? 7.5 : 1
  return round2(new Decimal(baseAmount).mul(percent).div(100))
}

// 2. Risk Scoring Engine -- weighted sum of 0-100 risk factor scores
export function calculateRiskScore(factors: { name: string; score: number; weight: number }[]): number {
  const totalWeight = factors.reduce((s, f) => s + f.weight, 0)
  if (totalWeight <= 0) throw new Error("total weight must be positive")
  return round2(factors.reduce((s, f) => s.plus(new Decimal(f.score).mul(f.weight)), new Decimal(0)).div(totalWeight))
}

// 3. Duplicate Invoice Detector -- exact-match heuristic (vendor + invoice number + amount)
export function detectDuplicateInvoices(invoices: { id: string; vendorId: string; invoiceNumber: string; amount: number }[]): string[][] {
  const groups = new Map<string, string[]>()
  for (const inv of invoices) {
    const key = `${inv.vendorId}|${inv.invoiceNumber}|${inv.amount}`
    groups.set(key, [...(groups.get(key) ?? []), inv.id])
  }
  return Array.from(groups.values()).filter((ids) => ids.length > 1)
}

// 4. Duplicate Payment Detector -- exact-match on payee + amount + date
export function detectDuplicatePayments(payments: { id: string; payeeId: string; amount: number; date: string }[]): string[][] {
  const groups = new Map<string, string[]>()
  for (const p of payments) {
    const key = `${p.payeeId}|${p.amount}|${p.date}`
    groups.set(key, [...(groups.get(key) ?? []), p.id])
  }
  return Array.from(groups.values()).filter((ids) => ids.length > 1)
}

// 5. Journal Risk Analyzer -- flags journal entries matching common red-flag heuristics (round amounts, weekend/after-hours posting, manual entries near period close)
export function analyzeJournalRisk(entry: { amount: number; postedAt: string; isManual: boolean; periodEndDate: string }): { riskFlags: string[]; riskScore: number } {
  const flags: string[] = []
  if (entry.amount % 1000 === 0 && entry.amount !== 0) flags.push("round_amount")
  const postedDay = new Date(entry.postedAt).getDay()
  if (postedDay === 0 || postedDay === 6) flags.push("weekend_posting")
  const daysToClose = Math.abs((new Date(entry.periodEndDate).getTime() - new Date(entry.postedAt).getTime()) / 86400000)
  if (entry.isManual && daysToClose <= 3) flags.push("manual_entry_near_close")
  return { riskFlags: flags, riskScore: flags.length * 25 }
}

// 6. Benford Analysis Engine -- compares leading-digit distribution of a dataset to Benford's Law expectation
const BENFORD_EXPECTED: Record<number, number> = { 1: 30.1, 2: 17.6, 3: 12.5, 4: 9.7, 5: 7.9, 6: 6.7, 7: 5.8, 8: 5.1, 9: 4.6 }
export function benfordAnalysis(values: number[]): { observedDistribution: Record<number, number>; expectedDistribution: Record<number, number>; chiSquare: number } {
  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 }
  const positive = values.filter((v) => v > 0)
  for (const v of positive) {
    const leadDigit = Number(String(Math.abs(v)).replace(".", "").replace(/^0+/, "")[0])
    if (leadDigit >= 1 && leadDigit <= 9) counts[leadDigit]++
  }
  const n = positive.length || 1
  const observed: Record<number, number> = {}
  let chiSquare = 0
  for (let d = 1; d <= 9; d++) {
    observed[d] = round2(new Decimal(counts[d]).div(n).mul(100))
    const expectedCount = (BENFORD_EXPECTED[d] / 100) * n
    if (expectedCount > 0) chiSquare += ((counts[d] - expectedCount) ** 2) / expectedCount
  }
  return { observedDistribution: observed, expectedDistribution: BENFORD_EXPECTED, chiSquare: round2(new Decimal(chiSquare)) }
}

// 7. Exception Detection Engine -- z-score based outlier detection (generic, not accounting-specific)
export function detectExceptions(values: number[], zScoreThreshold = 2.5): number[] {
  if (values.length < 2) return []
  const mean = ss.mean(values)
  const stdDev = ss.standardDeviation(values)
  if (stdDev === 0) return []
  return values.filter((v) => Math.abs((v - mean) / stdDev) >= zScoreThreshold)
}

function round2(d: Decimal): number { return d.toDecimalPlaces(2).toNumber() }
