// VCEL Fixed Asset Engine (computation_engines: straight_line_depreciation_engine,
// wdv_depreciation_engine). Standard SLM/WDV depreciation schedules -- deterministic.
import Decimal from "decimal.js"

export type DepreciationInput = { cost: number; salvageValue: number; usefulLifeYears: number }
export type DepreciationRow = { year: number; openingValue: number; depreciation: number; closingValue: number }

export function straightLineDepreciation(input: DepreciationInput): DepreciationRow[] {
  const { cost, salvageValue, usefulLifeYears } = input
  if (cost <= 0) throw new Error("cost must be positive")
  if (salvageValue < 0 || salvageValue >= cost) throw new Error("salvageValue must be non-negative and less than cost")
  if (usefulLifeYears <= 0 || !Number.isInteger(usefulLifeYears)) throw new Error("usefulLifeYears must be a positive integer")

  const depreciable = new Decimal(cost).minus(salvageValue)
  const annualDep = depreciable.div(usefulLifeYears)

  const rows: DepreciationRow[] = []
  let opening = new Decimal(cost)
  for (let year = 1; year <= usefulLifeYears; year++) {
    const dep = year === usefulLifeYears ? opening.minus(salvageValue) : annualDep
    const closing = opening.minus(dep)
    rows.push({ year, openingValue: round2(opening), depreciation: round2(dep), closingValue: round2(closing) })
    opening = closing
  }
  return rows
}

// WDV: depreciation rate derived from cost/salvage/life via the standard
// formula rate = 1 - (salvage/cost)^(1/life), same convention Income Tax
// Act WDV schedules use when a rate isn't separately prescribed.
export function writtenDownValueDepreciation(input: DepreciationInput & { rate?: number }): DepreciationRow[] {
  const { cost, salvageValue, usefulLifeYears } = input
  if (cost <= 0) throw new Error("cost must be positive")
  if (salvageValue < 0 || salvageValue >= cost) throw new Error("salvageValue must be non-negative and less than cost")
  if (usefulLifeYears <= 0 || !Number.isInteger(usefulLifeYears)) throw new Error("usefulLifeYears must be a positive integer")

  const rate = input.rate ?? (1 - Math.pow(salvageValue / cost, 1 / usefulLifeYears))

  const rows: DepreciationRow[] = []
  let opening = new Decimal(cost)
  for (let year = 1; year <= usefulLifeYears; year++) {
    let dep = opening.mul(rate)
    if (year === usefulLifeYears || opening.minus(dep).lt(salvageValue)) dep = opening.minus(salvageValue)
    const closing = opening.minus(dep)
    rows.push({ year, openingValue: round2(opening), depreciation: round2(dep), closingValue: round2(closing) })
    opening = closing
  }
  return rows
}

function round2(d: Decimal): number {
  return d.toDecimalPlaces(2).toNumber()
}

// Useful Life Calculator -- estimates remaining useful life from age and originally assigned life
export function calculateRemainingUsefulLife(originalUsefulLifeYears: number, ageInYears: number): number {
  return Math.max(0, originalUsefulLifeYears - ageInYears)
}

// Asset Transfer Engine -- carries net book value across a location/department transfer (no cost/depreciation impact, just a record)
export function transferAsset(netBookValue: number, fromLocation: string, toLocation: string): { netBookValue: number; fromLocation: string; toLocation: string } {
  return { netBookValue, fromLocation, toLocation }
}

// Asset Disposal Engine -- profit/loss on disposal = sale proceeds - net book value
export function calculateDisposalGainLoss(netBookValue: number, saleProceeds: number): { gainOrLoss: number; isGain: boolean } {
  const diff = new Decimal(saleProceeds).minus(netBookValue)
  return { gainOrLoss: round2(diff), isGain: diff.gte(0) }
}

// Capitalization Engine -- determines whether an expense should be capitalized (added to asset cost) vs expensed, per a materiality threshold
export function shouldCapitalize(expenseAmount: number, capitalizationThreshold: number, extendsUsefulLife: boolean): boolean {
  return extendsUsefulLife && expenseAmount >= capitalizationThreshold
}

// Revaluation Engine -- restates an asset to fair value, tracking the revaluation surplus/deficit
export function revalueAsset(currentNetBookValue: number, fairValue: number): { revaluationSurplus: number; newCarryingValue: number } {
  const diff = new Decimal(fairValue).minus(currentNetBookValue)
  return { revaluationSurplus: round2(diff), newCarryingValue: round2(new Decimal(fairValue)) }
}

// Impairment Engine -- Ind AS 36 style: impairment loss = carrying value - recoverable amount (only if carrying > recoverable)
export function calculateImpairmentLoss(carryingValue: number, recoverableAmount: number): { impairmentLoss: number; impaired: boolean } {
  const loss = new Decimal(carryingValue).minus(recoverableAmount)
  return { impairmentLoss: loss.gt(0) ? round2(loss) : 0, impaired: loss.gt(0) }
}
