// VCEL Mathematical Computation Engine (category 1, all 13 engines).
// Deterministic math -- wraps mathjs/simple-statistics rather than
// hand-rolling matrix/regression/optimization code, per project convention.
import Decimal from "decimal.js"
import * as math from "mathjs"
import * as ss from "simple-statistics"
import solver from "javascript-lp-solver"

// 1. Basic Arithmetic Engine -- precision-safe (float-unsafe ops avoided)
export function add(a: number, b: number) { return new Decimal(a).plus(b).toNumber() }
export function subtract(a: number, b: number) { return new Decimal(a).minus(b).toNumber() }
export function multiply(a: number, b: number) { return new Decimal(a).mul(b).toNumber() }
export function divide(a: number, b: number) {
  if (b === 0) throw new Error("division by zero")
  return new Decimal(a).div(b).toNumber()
}

// 2. Scientific Calculator Engine
export function evaluateExpression(expr: string): number {
  const result = math.evaluate(expr)
  if (typeof result !== "number") throw new Error("expression did not evaluate to a number")
  return result
}

// 3. Financial Mathematics Engine -- present/future value, compound interest
export function presentValue(futureValue: number, rate: number, periods: number): number {
  return new Decimal(futureValue).div(new Decimal(1).plus(rate).pow(periods)).toNumber()
}
export function futureValue(presentValueAmt: number, rate: number, periods: number): number {
  return new Decimal(presentValueAmt).mul(new Decimal(1).plus(rate).pow(periods)).toNumber()
}
export function compoundInterest(principal: number, annualRate: number, timesCompoundedPerYear: number, years: number): number {
  const amount = new Decimal(principal).mul(
    new Decimal(1).plus(new Decimal(annualRate).div(timesCompoundedPerYear)).pow(timesCompoundedPerYear * years)
  )
  return amount.minus(principal).toDecimalPlaces(2).toNumber()
}

// 4. Percentage Engine
export function percentageOf(value: number, percent: number) { return new Decimal(value).mul(percent).div(100).toNumber() }
export function percentageChange(oldValue: number, newValue: number) {
  if (oldValue === 0) throw new Error("oldValue cannot be zero")
  return new Decimal(newValue).minus(oldValue).div(Math.abs(oldValue)).mul(100).toNumber()
}

// 5. Ratio Engine
export function simplifyRatio(a: number, b: number): [number, number] {
  const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y))
  const divisor = gcd(Math.abs(a), Math.abs(b)) || 1
  return [a / divisor, b / divisor]
}

// 6. Fraction Engine
export function addFractions(n1: number, d1: number, n2: number, d2: number): [number, number] {
  const num = n1 * d2 + n2 * d1
  const den = d1 * d2
  return simplifyRatio(num, den)
}

// 7. Statistical Engine
export type StatisticalSummary = { mean: number; median: number; mode: number; stdDev: number; variance: number; min: number; max: number }
export function statisticalSummary(values: number[]): StatisticalSummary {
  if (!values.length) throw new Error("values must not be empty")
  return {
    mean: ss.mean(values), median: ss.median(values), mode: ss.mode(values),
    stdDev: ss.standardDeviation(values), variance: ss.variance(values),
    min: ss.min(values), max: ss.max(values),
  }
}

// 8. Matrix Computation Engine
export function multiplyMatrices(a: number[][], b: number[][]): number[][] {
  return math.multiply(a, b) as number[][]
}
export function invertMatrix(a: number[][]): number[][] {
  return math.inv(a) as number[][]
}

// 9. Linear Algebra Engine
export function determinant(a: number[][]): number { return math.det(a) }
export function solveLinearSystem(a: number[][], b: number[]): number[] {
  return (math.lusolve(a, b) as number[][]).map((row) => row[0])
}

// 10. Probability Engine
export function combinations(n: number, k: number): number { return math.combinations(n, k) }
export function permutations(n: number, k: number): number { return math.permutations(n, k) }
export function normalCdf(x: number, mean = 0, stdDev = 1): number { return ss.cumulativeStdNormalProbability((x - mean) / stdDev) }

// 11. Regression Engine
export function linearRegression(points: [number, number][]): { slope: number; intercept: number; predict: (x: number) => number } {
  const model = ss.linearRegression(points)
  const predict = ss.linearRegressionLine(model)
  return { slope: model.m, intercept: model.b, predict }
}

// 12. Optimization Engine -- linear programming via javascript-lp-solver
export type LpModel = {
  optimize: string; opType: "max" | "min"
  constraints: Record<string, { max?: number; min?: number; equal?: number }>
  variables: Record<string, Record<string, number>>
}
export function solveLinearProgram(model: LpModel) {
  return solver.Solve(model)
}

// 13. Time Series Engine -- simple moving average, a standard deterministic baseline
export function movingAverage(values: number[], windowSize: number): number[] {
  if (windowSize <= 0 || windowSize > values.length) throw new Error("invalid windowSize")
  const result: number[] = []
  for (let i = 0; i <= values.length - windowSize; i++) {
    result.push(ss.mean(values.slice(i, i + windowSize)))
  }
  return result
}
