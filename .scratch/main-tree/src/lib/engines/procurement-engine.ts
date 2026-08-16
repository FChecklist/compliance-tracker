// VCEL Procurement Engine.
import Decimal from "decimal.js"

// 1. Purchase Cost Calculator
export function calculatePurchaseCost(unitPrice: number, quantity: number, otherCharges = 0): number {
  return round2(new Decimal(unitPrice).mul(quantity).plus(otherCharges))
}

// 2. Vendor Comparison Engine -- ranks vendors by weighted score across criteria (price/quality/delivery, 0-100 each)
export type VendorScore = { vendorId: string; priceScore: number; qualityScore: number; deliveryScore: number }
export function rankVendors(vendors: VendorScore[], weights = { price: 0.5, quality: 0.3, delivery: 0.2 }): { vendorId: string; totalScore: number }[] {
  return vendors
    .map((v) => ({ vendorId: v.vendorId, totalScore: round2(new Decimal(v.priceScore).mul(weights.price).plus(new Decimal(v.qualityScore).mul(weights.quality)).plus(new Decimal(v.deliveryScore).mul(weights.delivery))) }))
    .sort((a, b) => b.totalScore - a.totalScore)
}

// 3. Bid Evaluation Engine -- lowest technically-qualified bid wins (standard L1 method), disqualifies below minTechnicalScore
export function evaluateBids(bids: { bidderId: string; price: number; technicalScore: number }[], minTechnicalScore: number): { winnerId: string | null; qualifiedBids: typeof bids } {
  const qualified = bids.filter((b) => b.technicalScore >= minTechnicalScore).sort((a, b) => a.price - b.price)
  return { winnerId: qualified[0]?.bidderId ?? null, qualifiedBids: qualified }
}

// 4. Purchase Price Variance Engine -- (standard price - actual price) * quantity
export function calculatePurchasePriceVariance(standardPrice: number, actualPrice: number, quantity: number): { variance: number; favorable: boolean } {
  const variance = new Decimal(standardPrice).minus(actualPrice).mul(quantity)
  return { variance: round2(variance), favorable: variance.gte(0) }
}

// 5. Landed Cost Engine -- purchase cost + freight + insurance + customs duty + other charges, allocated per unit
export function calculateLandedCost(input: { purchaseCost: number; freight: number; insurance?: number; customsDuty?: number; otherCharges?: number; quantity: number }): { totalLandedCost: number; landedCostPerUnit: number } {
  const total = new Decimal(input.purchaseCost).plus(input.freight).plus(input.insurance ?? 0).plus(input.customsDuty ?? 0).plus(input.otherCharges ?? 0)
  if (input.quantity <= 0) throw new Error("quantity must be positive")
  return { totalLandedCost: round2(total), landedCostPerUnit: round2(total.div(input.quantity)) }
}

// 6. Freight Allocation Engine -- allocates a shipment's total freight cost across line items by weight or value
export function allocateFreight(lineItems: { id: string; weight?: number; value?: number }[], totalFreightCost: number, basis: "weight" | "value" = "weight"): Record<string, number> {
  const totalBasis = lineItems.reduce((s, i) => s + (basis === "weight" ? (i.weight ?? 0) : (i.value ?? 0)), 0)
  if (totalBasis <= 0) throw new Error(`total ${basis} must be positive`)
  const result: Record<string, number> = {}
  for (const item of lineItems) {
    const share = (basis === "weight" ? (item.weight ?? 0) : (item.value ?? 0)) / totalBasis
    result[item.id] = round2(new Decimal(totalFreightCost).mul(share))
  }
  return result
}

// 7. MOQ Optimizer -- rounds up an order quantity to the nearest valid MOQ multiple
export function optimizeForMoq(requiredQuantity: number, moq: number, orderMultiple = moq): number {
  if (moq <= 0 || orderMultiple <= 0) throw new Error("moq and orderMultiple must be positive")
  if (requiredQuantity <= moq) return moq
  return moq + Math.ceil((requiredQuantity - moq) / orderMultiple) * orderMultiple
}

function round2(d: Decimal): number { return d.toDecimalPlaces(2).toNumber() }
