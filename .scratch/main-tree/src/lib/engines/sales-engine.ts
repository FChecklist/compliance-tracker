// VCEL Sales Engine (product-selling; distinct from Wave 109's external-
// partner sales-engine-service.ts). discount_calculator/sales_commission_engine
// already have partial coverage in erp-selling-service.ts/sales-engine-service.ts.
import Decimal from "decimal.js"

// 1. Margin Calculator -- profit margin as % of selling price
export function calculateMargin(sellingPrice: number, cost: number): number {
  if (sellingPrice <= 0) throw new Error("sellingPrice must be positive")
  return round2(new Decimal(sellingPrice).minus(cost).div(sellingPrice).mul(100))
}

// 2. Markup Calculator -- markup as % of cost
export function calculateMarkup(sellingPrice: number, cost: number): number {
  if (cost <= 0) throw new Error("cost must be positive")
  return round2(new Decimal(sellingPrice).minus(cost).div(cost).mul(100))
}
export function priceFromMarkup(cost: number, markupPercent: number): number {
  return round2(new Decimal(cost).mul(new Decimal(1).plus(new Decimal(markupPercent).div(100))))
}

// 3. Incentive Calculator (Sales) -- tiered target-achievement incentive, same slab pattern as payroll incentive
export function calculateSalesIncentive(achievedSales: number, targetSales: number, slabs: { minAchievementPercent: number; incentivePercentOfSales: number }[]): number {
  if (targetSales <= 0) throw new Error("targetSales must be positive")
  const achievementPercent = new Decimal(achievedSales).div(targetSales).mul(100).toNumber()
  const slab = [...slabs].sort((a, b) => b.minAchievementPercent - a.minAchievementPercent).find((s) => achievementPercent >= s.minAchievementPercent)
  if (!slab) return 0
  return round2(new Decimal(achievedSales).mul(slab.incentivePercentOfSales).div(100))
}

// 4. Pricing Engine -- cost-plus pricing with a target margin (solves for price given desired margin %, not markup %)
export function priceForTargetMargin(cost: number, targetMarginPercent: number): number {
  if (targetMarginPercent >= 100) throw new Error("targetMarginPercent must be less than 100")
  return round2(new Decimal(cost).div(new Decimal(1).minus(new Decimal(targetMarginPercent).div(100))))
}

// 5. Quote Optimizer -- suggests the highest discount that still clears a minimum acceptable margin
export function optimizeQuoteDiscount(cost: number, listPrice: number, minAcceptableMarginPercent: number): number {
  const minPrice = priceForTargetMargin(cost, minAcceptableMarginPercent)
  if (listPrice <= minPrice) return 0
  return round2(new Decimal(listPrice).minus(minPrice).div(listPrice).mul(100))
}

// 6. Sales Forecast Engine -- simple linear trend projection over historical periods
export function forecastSales(historicalValues: number[], periodsAhead: number): number[] {
  const n = historicalValues.length
  if (n < 2) throw new Error("at least 2 historical periods are required")
  const xs = historicalValues.map((_, i) => i)
  const meanX = xs.reduce((a, b) => a + b, 0) / n
  const meanY = historicalValues.reduce((a, b) => a + b, 0) / n
  const slope = xs.reduce((s, x, i) => s + (x - meanX) * (historicalValues[i] - meanY), 0) / xs.reduce((s, x) => s + (x - meanX) ** 2, 0)
  const intercept = meanY - slope * meanX
  return Array.from({ length: periodsAhead }, (_, i) => round2(new Decimal(slope * (n + i) + intercept)))
}

// 7. Pipeline Probability Engine -- stage-weighted expected value (standard CRM/sales convention)
const STAGE_PROBABILITY: Record<string, number> = { prospecting: 10, qualification: 25, proposal: 50, negotiation: 75, closed_won: 100, closed_lost: 0 }
export function calculatePipelineExpectedValue(deals: { stage: string; amount: number }[]): number {
  return round2(deals.reduce((s, d) => s.plus(new Decimal(d.amount).mul(STAGE_PROBABILITY[d.stage] ?? 0).div(100)), new Decimal(0)))
}

function round2(d: Decimal): number { return d.toDecimalPlaces(2).toNumber() }
