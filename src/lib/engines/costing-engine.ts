// VCEL Costing Engine. Manufacturing-flavored costing methods (BOM/routing-
// driven) are explicitly out of scope per prior gap analyses -- these cover
// the non-manufacturing costing methods (job/contract/service costing,
// allocation, variance) applicable to a services/trading business.
import Decimal from "decimal.js"

// 1. Job Costing -- sums direct material + labor + allocated overhead for one job
export function calculateJobCost(directMaterial: number, directLabor: number, overheadAllocated: number): number {
  return round2(new Decimal(directMaterial).plus(directLabor).plus(overheadAllocated))
}

// 2. Standard Costing -- variance decomposition (price variance + quantity variance)
export function standardCostingVariance(input: { standardPrice: number; actualPrice: number; standardQuantity: number; actualQuantity: number }): { priceVariance: number; quantityVariance: number; totalVariance: number } {
  const priceVariance = new Decimal(input.standardPrice).minus(input.actualPrice).mul(input.actualQuantity)
  const quantityVariance = new Decimal(input.standardQuantity).minus(input.actualQuantity).mul(input.standardPrice)
  return { priceVariance: round2(priceVariance), quantityVariance: round2(quantityVariance), totalVariance: round2(priceVariance.plus(quantityVariance)) }
}

// 3. Marginal Costing -- contribution margin & break-even, standard CVP analysis
export function marginalCostingAnalysis(input: { sellingPricePerUnit: number; variableCostPerUnit: number; fixedCosts: number }): { contributionPerUnit: number; contributionMarginRatio: number; breakEvenUnits: number; breakEvenSales: number } {
  const contribution = new Decimal(input.sellingPricePerUnit).minus(input.variableCostPerUnit)
  if (contribution.lte(0)) throw new Error("selling price must exceed variable cost per unit")
  const ratio = contribution.div(input.sellingPricePerUnit).mul(100)
  const beUnits = new Decimal(input.fixedCosts).div(contribution)
  return {
    contributionPerUnit: round2(contribution), contributionMarginRatio: round2(ratio),
    breakEvenUnits: Math.ceil(beUnits.toNumber()), breakEvenSales: round2(beUnits.mul(input.sellingPricePerUnit)),
  }
}

// 4. Activity Based Costing -- allocates overhead pools to cost objects via cost drivers
export function allocateActivityBasedCost(costPools: { activity: string; totalCost: number; totalDriverUnits: number }[], objectDriverUsage: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {}
  for (const pool of costPools) {
    if (pool.totalDriverUnits <= 0) continue
    const rate = new Decimal(pool.totalCost).div(pool.totalDriverUnits)
    const usage = objectDriverUsage[pool.activity] ?? 0
    result[pool.activity] = round2(rate.mul(usage))
  }
  return result
}

// 5. Batch Costing -- total batch cost divided across units in the batch
export function calculateBatchCost(totalBatchCost: number, unitsInBatch: number): number {
  if (unitsInBatch <= 0) throw new Error("unitsInBatch must be positive")
  return round2(new Decimal(totalBatchCost).div(unitsInBatch))
}

// 6. Service Costing -- direct + indirect cost per service unit (e.g. per hour, per ticket)
export function calculateServiceCost(directCost: number, indirectCostAllocated: number, serviceUnits: number): number {
  if (serviceUnits <= 0) throw new Error("serviceUnits must be positive")
  return round2(new Decimal(directCost).plus(indirectCostAllocated).div(serviceUnits))
}

// 7. Cost Allocation Engine -- allocates a shared cost pool across departments/cost centers by a chosen basis
export function allocateCostPool(pool: number, allocationBasis: { id: string; basisValue: number }[]): Record<string, number> {
  const total = allocationBasis.reduce((s, a) => s + a.basisValue, 0)
  if (total <= 0) throw new Error("total allocation basis must be positive")
  const result: Record<string, number> = {}
  for (const a of allocationBasis) result[a.id] = round2(new Decimal(pool).mul(a.basisValue).div(total))
  return result
}

// 8. Variance Analysis Engine -- generic actual-vs-budget variance with % and favorability
export function analyzeVariance(actual: number, budget: number, higherIsFavorable = true): { variance: number; variancePercent: number; favorable: boolean } {
  const variance = new Decimal(actual).minus(budget)
  const variancePercent = budget !== 0 ? round2(variance.div(Math.abs(budget)).mul(100)) : 0
  return { variance: round2(variance), variancePercent, favorable: higherIsFavorable ? variance.gte(0) : variance.lte(0) }
}

function round2(d: Decimal): number { return d.toDecimalPlaces(2).toNumber() }
