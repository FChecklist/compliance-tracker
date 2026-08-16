// VCEL Inventory Engine -- standard costing/planning/classification formulas.
import Decimal from "decimal.js"

export type StockLot = { quantity: number; unitCost: number; receivedDate?: string; expiryDate?: string }
export type ConsumptionResult = { costOfGoodsSold: number; remainingLots: StockLot[] }

// 1. FIFO Engine -- consume oldest lots first
export function consumeFifo(lots: StockLot[], quantityToConsume: number): ConsumptionResult {
  const sorted = [...lots].sort((a, b) => (a.receivedDate ?? "").localeCompare(b.receivedDate ?? ""))
  return consumeInOrder(sorted, quantityToConsume)
}

// 2. FEFO Engine -- consume earliest-expiring lots first (perishables convention)
export function consumeFefo(lots: StockLot[], quantityToConsume: number): ConsumptionResult {
  const sorted = [...lots].sort((a, b) => (a.expiryDate ?? "").localeCompare(b.expiryDate ?? ""))
  return consumeInOrder(sorted, quantityToConsume)
}

function consumeInOrder(sortedLots: StockLot[], quantityToConsume: number): ConsumptionResult {
  let remaining = new Decimal(quantityToConsume)
  let cogs = new Decimal(0)
  const remainingLots: StockLot[] = []
  for (const lot of sortedLots) {
    if (remaining.lte(0)) { remainingLots.push(lot); continue }
    const take = Decimal.min(remaining, lot.quantity)
    cogs = cogs.plus(take.mul(lot.unitCost))
    remaining = remaining.minus(take)
    const leftoverQty = new Decimal(lot.quantity).minus(take)
    if (leftoverQty.gt(0)) remainingLots.push({ ...lot, quantity: leftoverQty.toNumber() })
  }
  if (remaining.gt(0)) throw new Error("insufficient stock to consume requested quantity")
  return { costOfGoodsSold: round2(cogs), remainingLots }
}

// 3. Weighted Average Engine
export function weightedAverageCost(lots: StockLot[]): number {
  const totalQty = lots.reduce((s, l) => s.plus(l.quantity), new Decimal(0))
  if (totalQty.lte(0)) throw new Error("total quantity must be positive")
  const totalValue = lots.reduce((s, l) => s.plus(new Decimal(l.quantity).mul(l.unitCost)), new Decimal(0))
  return round2(totalValue.div(totalQty))
}

// 4. Standard Cost Engine -- variance between actual and a pre-set standard cost
export function standardCostVariance(actualCost: number, standardCost: number, quantity: number): { totalVariance: number; favorable: boolean } {
  const variance = new Decimal(standardCost).minus(actualCost).mul(quantity)
  return { totalVariance: round2(variance), favorable: variance.gte(0) }
}

// 5. Moving Average Engine -- recompute average cost after each new receipt
export function movingAverageAfterReceipt(currentQty: number, currentAvgCost: number, receiptQty: number, receiptCost: number): number {
  const totalQty = new Decimal(currentQty).plus(receiptQty)
  if (totalQty.lte(0)) throw new Error("resulting quantity must be positive")
  const totalValue = new Decimal(currentQty).mul(currentAvgCost).plus(new Decimal(receiptQty).mul(receiptCost))
  return round2(totalValue.div(totalQty))
}

// 6. Stock Valuation Engine -- values a stock position under FIFO/weighted-average
export function valueStock(lots: StockLot[], method: "fifo" | "weighted_average" = "weighted_average"): number {
  if (method === "weighted_average") {
    const totalQty = lots.reduce((s, l) => s.plus(l.quantity), new Decimal(0))
    return round2(totalQty.mul(weightedAverageCost(lots)))
  }
  return round2(lots.reduce((s, l) => s.plus(new Decimal(l.quantity).mul(l.unitCost)), new Decimal(0)))
}

// 7. Inventory Aging Engine -- buckets stock quantity by days-held
export function ageInventory(lots: (StockLot & { receivedDate: string })[], asOfDate: string, buckets = [30, 60, 90]): Record<string, number> {
  const result: Record<string, number> = {}
  const bucketLabels = [...buckets.map((b) => `0-${b}`), `${buckets[buckets.length - 1]}+`]
  for (const label of bucketLabels) result[label] = 0
  for (const lot of lots) {
    const days = daysBetween(lot.receivedDate, asOfDate)
    const bucketIdx = buckets.findIndex((b) => days <= b)
    const label = bucketIdx === -1 ? bucketLabels[bucketLabels.length - 1] : bucketLabels[bucketIdx]
    result[label] = new Decimal(result[label]).plus(lot.quantity).toNumber()
  }
  return result
}
function daysBetween(from: string, to: string): number {
  return Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 86400000)
}

// 8. EOQ Calculator -- classic Wilson formula: sqrt(2*D*S/H)
export function calculateEoq(annualDemand: number, orderingCostPerOrder: number, holdingCostPerUnitPerYear: number): number {
  if (holdingCostPerUnitPerYear <= 0) throw new Error("holdingCostPerUnitPerYear must be positive")
  return Math.sqrt((2 * annualDemand * orderingCostPerOrder) / holdingCostPerUnitPerYear)
}

// 9. Reorder Level Calculator -- lead-time demand + safety stock
export function calculateReorderLevel(avgDailyUsage: number, leadTimeDays: number, safetyStock: number): number {
  return round2(new Decimal(avgDailyUsage).mul(leadTimeDays).plus(safetyStock))
}

// 10. Safety Stock Calculator -- (max daily usage * max lead time) - (avg daily usage * avg lead time)
export function calculateSafetyStock(maxDailyUsage: number, maxLeadTimeDays: number, avgDailyUsage: number, avgLeadTimeDays: number): number {
  return round2(Decimal.max(0, new Decimal(maxDailyUsage).mul(maxLeadTimeDays).minus(new Decimal(avgDailyUsage).mul(avgLeadTimeDays))))
}

// 11. ABC Analysis Engine -- classic 80/15/5 cumulative-value classification
export function abcAnalysis(items: { id: string; annualUsageValue: number }[]): Record<string, "A" | "B" | "C"> {
  const sorted = [...items].sort((a, b) => b.annualUsageValue - a.annualUsageValue)
  const total = sorted.reduce((s, i) => s + i.annualUsageValue, 0)
  const result: Record<string, "A" | "B" | "C"> = {}
  let cumulative = 0
  for (const item of sorted) {
    cumulative += item.annualUsageValue
    const cumulativePercent = total > 0 ? (cumulative / total) * 100 : 0
    result[item.id] = cumulativePercent <= 80 ? "A" : cumulativePercent <= 95 ? "B" : "C"
  }
  return result
}

// 12. XYZ Analysis Engine -- classifies by demand-variability (coefficient of variation)
export function xyzAnalysis(items: { id: string; demandHistory: number[] }[]): Record<string, "X" | "Y" | "Z"> {
  const result: Record<string, "X" | "Y" | "Z"> = {}
  for (const item of items) {
    const mean = item.demandHistory.reduce((a, b) => a + b, 0) / item.demandHistory.length
    if (mean === 0) { result[item.id] = "Z"; continue }
    const variance = item.demandHistory.reduce((s, v) => s + (v - mean) ** 2, 0) / item.demandHistory.length
    const cv = (Math.sqrt(variance) / mean) * 100
    result[item.id] = cv <= 20 ? "X" : cv <= 50 ? "Y" : "Z"
  }
  return result
}

// 13. Slow Moving Inventory Engine -- flags items with no/low movement in a lookback window
export function findSlowMovingItems(items: { id: string; quantityOnHand: number; quantityConsumedInWindow: number }[], thresholdTurnoverRatio = 0.1): string[] {
  return items.filter((i) => i.quantityOnHand > 0 && i.quantityConsumedInWindow / i.quantityOnHand < thresholdTurnoverRatio).map((i) => i.id)
}

// 14. Dead Stock Engine -- zero movement over the lookback window
export function findDeadStock(items: { id: string; quantityOnHand: number; quantityConsumedInWindow: number }[]): string[] {
  return items.filter((i) => i.quantityOnHand > 0 && i.quantityConsumedInWindow === 0).map((i) => i.id)
}

// 15. Cycle Counting Engine -- suggests count frequency by ABC class (A most frequent)
export function suggestCycleCountSchedule(abcClass: "A" | "B" | "C"): { countsPerYear: number } {
  return { countsPerYear: abcClass === "A" ? 12 : abcClass === "B" ? 4 : 1 }
}

function round2(d: Decimal): number { return d.toDecimalPlaces(2).toNumber() }
