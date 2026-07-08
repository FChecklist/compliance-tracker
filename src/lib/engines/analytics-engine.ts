// VCEL Analytics Engine -- kpi_calculator already has partial coverage
// (orchestra-analytics-service.ts, AI-usage scoped). Uses simple-statistics
// per project convention instead of hand-rolled stats.
import Decimal from "decimal.js"
import * as ss from "simple-statistics"

// 1. Trend Analysis -- linear regression slope/direction over a time-ordered series
export function analyzeTrend(values: number[]): { slope: number; direction: "increasing" | "decreasing" | "flat" } {
  if (values.length < 2) throw new Error("at least 2 data points are required")
  const points: [number, number][] = values.map((v, i) => [i, v])
  const model = ss.linearRegression(points)
  return { slope: round2(new Decimal(model.m)), direction: model.m > 0.001 ? "increasing" : model.m < -0.001 ? "decreasing" : "flat" }
}

// 2. Variance Analysis (Analytics) -- same shape as costing-engine's analyzeVariance, kept separate since it's a distinct registry entry per the source taxonomy
export function analyzeAnalyticsVariance(actual: number, expected: number): { variance: number; variancePercent: number } {
  const variance = new Decimal(actual).minus(expected)
  return { variance: round2(variance), variancePercent: expected !== 0 ? round2(variance.div(Math.abs(expected)).mul(100)) : 0 }
}

// 3. Benchmark Comparison -- compares a metric against an external benchmark, expressed as % above/below
export function compareToBenchmark(actualValue: number, benchmarkValue: number): { percentDifference: number; performsBetter: boolean } {
  if (benchmarkValue === 0) throw new Error("benchmarkValue cannot be zero")
  const diff = new Decimal(actualValue).minus(benchmarkValue).div(Math.abs(benchmarkValue)).mul(100)
  return { percentDifference: round2(diff), performsBetter: diff.gte(0) }
}

// 4. Forecast Baseline -- naive baseline forecast (last value carried forward) + simple moving-average baseline
export function forecastBaseline(historicalValues: number[], method: "naive" | "moving_average" = "naive", windowSize = 3): number {
  if (!historicalValues.length) throw new Error("historicalValues must not be empty")
  if (method === "naive") return historicalValues[historicalValues.length - 1]
  const window = historicalValues.slice(-windowSize)
  return round2(new Decimal(ss.mean(window)))
}

// 5. Anomaly Detection -- z-score / IQR based, per the registry's own open_source_ref recommendation
export function detectAnomaliesZScore(values: number[], threshold = 2.5): number[] {
  if (values.length < 2) return []
  const mean = ss.mean(values)
  const stdDev = ss.standardDeviation(values)
  if (stdDev === 0) return []
  return values.filter((v) => Math.abs((v - mean) / stdDev) >= threshold)
}
export function detectAnomaliesIqr(values: number[]): number[] {
  if (values.length < 4) return []
  const q1 = ss.quantile(values, 0.25)
  const q3 = ss.quantile(values, 0.75)
  const iqr = q3 - q1
  const lower = q1 - 1.5 * iqr
  const upper = q3 + 1.5 * iqr
  return values.filter((v) => v < lower || v > upper)
}

// 6. Correlation Calculator
export function calculateCorrelation(xValues: number[], yValues: number[]): number {
  if (xValues.length !== yValues.length || xValues.length < 2) throw new Error("xValues and yValues must be equal length and have at least 2 points")
  return round2(new Decimal(ss.sampleCorrelation(xValues, yValues)))
}

function round2(d: Decimal): number { return d.toDecimalPlaces(2).toNumber() }
