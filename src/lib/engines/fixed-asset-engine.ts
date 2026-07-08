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
