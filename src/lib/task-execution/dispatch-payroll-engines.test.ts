/// <reference types="bun-types" />
// See dispatch-mathematical-engines.test.ts's header for why these dispatch-
// routing tests exist and what they deliberately don't cover.
import { describe, test, expect } from "bun:test"
import { dispatchPayrollEngines } from "./dispatch-payroll-engines"
import { NOT_HANDLED } from "./dispatch-helpers"

describe("dispatchPayrollEngines", () => {
  test("returns NOT_HANDLED for a key outside this category", async () => {
    expect(await dispatchPayrollEngines("gst_split_engine", {})).toBe(NOT_HANDLED)
  })

  test("gratuity_calculator defaults isCoveredUnderAct to true when omitted", async () => {
    const result = await dispatchPayrollEngines("gratuity_calculator", { lastDrawnMonthlySalary: 50000, yearsOfService: 10 })
    expect(result).toBeTruthy()
  })

  test("incentive_calculator rejects a non-array incentiveSlabs", async () => {
    expect(dispatchPayrollEngines("incentive_calculator", { achievedValue: 1, targetValue: 1, incentiveSlabs: "nope" }))
      .rejects.toThrow("incentiveSlabs must be an array")
  })

  test("salary_revision_calculator rejects a non-object components", async () => {
    expect(dispatchPayrollEngines("salary_revision_calculator", { components: ["nope"], revisionPercent: 10 }))
      .rejects.toThrow("components must be an object of {component: amount}")
    expect(dispatchPayrollEngines("salary_revision_calculator", { components: null, revisionPercent: 10 }))
      .rejects.toThrow("components must be an object of {component: amount}")
  })

  test("salary_revision_calculator accepts a real components object", async () => {
    const result = await dispatchPayrollEngines("salary_revision_calculator", { components: { basic: 30000, hra: 15000 }, revisionPercent: 10 })
    expect(result).toBeTruthy()
  })

  test("eps_calculator and bonus_calculator dispatch to distinct payroll-engine functions", async () => {
    const eps = await dispatchPayrollEngines("eps_calculator", { monthlyBasicPlusDa: 15000 }) as { epsAmount: number }
    const bonus = await dispatchPayrollEngines("bonus_calculator", { annualBasicPlusDa: 100000, bonusPercent: 8.33 }) as { bonusAmount: number }
    expect(typeof eps.epsAmount).toBe("number")
    expect(typeof bonus.bonusAmount).toBe("number")
  })
})
