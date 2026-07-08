// VCEL Marketing Engine. funnel_conversion_calculator already has partial coverage (Wave 113 visitor intelligence).
import Decimal from "decimal.js"

// 1. ROI Calculator (Marketing)
export function calculateMarketingRoi(revenueGenerated: number, marketingSpend: number): number {
  if (marketingSpend <= 0) throw new Error("marketingSpend must be positive")
  return round2(new Decimal(revenueGenerated).minus(marketingSpend).div(marketingSpend).mul(100))
}

// 2. CAC Calculator -- Customer Acquisition Cost
export function calculateCac(totalAcquisitionSpend: number, newCustomersAcquired: number): number {
  if (newCustomersAcquired <= 0) throw new Error("newCustomersAcquired must be positive")
  return round2(new Decimal(totalAcquisitionSpend).div(newCustomersAcquired))
}

// 3. ROAS Calculator -- Return on Ad Spend
export function calculateRoas(revenueFromAds: number, adSpend: number): number {
  if (adSpend <= 0) throw new Error("adSpend must be positive")
  return round2(new Decimal(revenueFromAds).div(adSpend))
}

// 4. Attribution Engine -- linear multi-touch attribution across touchpoints in a conversion path
export function attributeConversionLinear(touchpoints: { channel: string }[], conversionValue: number): Record<string, number> {
  if (!touchpoints.length) return {}
  const sharePerTouch = new Decimal(conversionValue).div(touchpoints.length)
  const result: Record<string, number> = {}
  for (const t of touchpoints) result[t.channel] = round2(new Decimal(result[t.channel] ?? 0).plus(sharePerTouch))
  return result
}

// 5. Campaign Scoring Engine -- weighted score across reach/engagement/conversion (0-100 each)
export function calculateCampaignScore(input: { reachScore: number; engagementScore: number; conversionScore: number }, weights = { reach: 0.2, engagement: 0.3, conversion: 0.5 }): number {
  return round2(new Decimal(input.reachScore).mul(weights.reach).plus(new Decimal(input.engagementScore).mul(weights.engagement)).plus(new Decimal(input.conversionScore).mul(weights.conversion)))
}

// 6. Funnel Conversion Calculator -- stage-over-stage conversion rates through a funnel
export function calculateFunnelConversion(stageCounts: { stage: string; count: number }[]): { stage: string; count: number; conversionFromPrevious: number | null }[] {
  return stageCounts.map((s, i) => ({
    stage: s.stage, count: s.count,
    conversionFromPrevious: i === 0 || stageCounts[i - 1].count === 0 ? null : round2(new Decimal(s.count).div(stageCounts[i - 1].count).mul(100)),
  }))
}

function round2(d: Decimal): number { return d.toDecimalPlaces(2).toNumber() }
