// Cognitive Architecture: Deterministic-First Principles wave:
// tests classifyBudgetScheduleRisk() -- the pure threshold function that
// replaced an LLM-only riskLevel decision in detectBudgetScheduleRisk().
// Same pure/no-DB pattern as risk-classification.test.ts and
// crm-accounts-service.test.ts's own note on why: a .test.ts file in this
// repo never exercises the withTenantContext/live-DB/LLM-backed functions.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { classifyBudgetScheduleRisk, type BudgetScheduleRiskFactors } from "./construction-ai-service"

function factors(overrides: Partial<BudgetScheduleRiskFactors>): BudgetScheduleRiskFactors {
  return { budget: 100_000, actual: 100_000, variance: 0, delayedTaskCount: 0, totalTaskCount: 10, ...overrides }
}

describe("classifyBudgetScheduleRisk -- Cognitive Architecture: Deterministic-First Principles", () => {
  test("on budget and no delays is low risk", () => {
    expect(classifyBudgetScheduleRisk(factors({}))).toBe("low")
  })

  test("under budget (positive variance) is low risk regardless of magnitude", () => {
    expect(classifyBudgetScheduleRisk(factors({ variance: 50_000 }))).toBe("low")
  })

  test("a small overspend (under 10%) is low risk", () => {
    expect(classifyBudgetScheduleRisk(factors({ actual: 105_000, variance: -5_000 }))).toBe("low")
  })

  test("overspend at or above 10% is medium risk", () => {
    expect(classifyBudgetScheduleRisk(factors({ actual: 110_000, variance: -10_000 }))).toBe("medium")
  })

  test("overspend at or above 20% is high risk", () => {
    expect(classifyBudgetScheduleRisk(factors({ actual: 120_000, variance: -20_000 }))).toBe("high")
  })

  test("a well-over-20% overspend is still just high, not a higher level", () => {
    expect(classifyBudgetScheduleRisk(factors({ actual: 200_000, variance: -100_000 }))).toBe("high")
  })

  test("delayed-task ratio at or above 20% is medium risk even on budget", () => {
    expect(classifyBudgetScheduleRisk(factors({ delayedTaskCount: 2, totalTaskCount: 10 }))).toBe("medium")
  })

  test("delayed-task ratio at or above 40% is high risk even on budget", () => {
    expect(classifyBudgetScheduleRisk(factors({ delayedTaskCount: 4, totalTaskCount: 10 }))).toBe("high")
  })

  test("the more severe of the two independent signals wins", () => {
    // 5% overspend (low on its own) but 50% of tasks delayed (high on its own) -> high
    expect(classifyBudgetScheduleRisk(factors({ actual: 105_000, variance: -5_000, delayedTaskCount: 5, totalTaskCount: 10 }))).toBe("high")
  })

  test("zero budget does not divide by zero or blow up -- treated as no budget signal", () => {
    expect(classifyBudgetScheduleRisk(factors({ budget: 0, actual: 0, variance: 0 }))).toBe("low")
  })

  test("zero total tasks does not divide by zero or blow up -- treated as no schedule signal", () => {
    expect(classifyBudgetScheduleRisk(factors({ delayedTaskCount: 0, totalTaskCount: 0 }))).toBe("low")
  })
})

// R67 D-02 (audit R-004/R-009). budgetVsActual().budget became
// `number | null` -- null when the project has NO budget rows at all, which
// is not a budget of zero. Coercing that null to 0 would have made every
// unbudgeted project look infinitely overspent (variance = -all spend), so
// the overspend ratio is now computed by one named function that returns 0
// when there is nothing to measure against.
describe("overspendRatioOf (R67 D-02: an unset budget is not an overrun)", () => {
  test("no budget set is not risk -- it is unassessable, and scores 0", async () => {
    const { overspendRatioOf } = await import("./construction-ai-service")
    expect(overspendRatioOf(factors({ budget: null, actual: 250_000, variance: null }))).toBe(0)
  })

  test("a project with no budget never classifies as budget risk, however large the spend", async () => {
    expect(classifyBudgetScheduleRisk(factors({ budget: null, actual: 5_000_000, variance: null }))).toBe("low")
  })

  test("a real overspend still produces the real ratio", async () => {
    const { overspendRatioOf } = await import("./construction-ai-service")
    expect(overspendRatioOf(factors({ budget: 100_000, actual: 120_000, variance: -20_000 }))).toBeCloseTo(0.2, 10)
  })

  test("being under budget is 0, not a negative ratio", async () => {
    const { overspendRatioOf } = await import("./construction-ai-service")
    expect(overspendRatioOf(factors({ budget: 100_000, actual: 50_000, variance: 50_000 }))).toBe(0)
  })
})
