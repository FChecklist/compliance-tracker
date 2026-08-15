/// <reference types="bun-types" />
// See dispatch-mathematical-engines.test.ts's header for why these dispatch-
// routing tests exist and what they deliberately don't cover.
import { describe, test, expect } from "bun:test"
import { dispatchIncomeTaxEngines } from "./dispatch-income-tax-engines"
import { NOT_HANDLED } from "./dispatch-helpers"

describe("dispatchIncomeTaxEngines", () => {
  test("returns NOT_HANDLED for a key outside this category", async () => {
    expect(await dispatchIncomeTaxEngines("tcs_calculator", {})).toBe(NOT_HANDLED)
  })

  test("income_tax_calculator dispatches and returns a slab-based breakdown", async () => {
    const result = await dispatchIncomeTaxEngines("income_tax_calculator", { taxableIncome: 1200000 }) as Record<string, unknown>
    expect(result).toBeTruthy()
    expect(typeof result).toBe("object")
  })

  test("advance_tax_calculator rejects a quarter outside q1..q4", async () => {
    expect(dispatchIncomeTaxEngines("advance_tax_calculator", { estimatedAnnualTax: 100, quarter: "q5", alreadyPaid: 0 }))
      .rejects.toThrow("quarter must be one of q1, q2, q3, q4")
  })

  test("advance_tax_calculator accepts a valid quarter", async () => {
    const result = await dispatchIncomeTaxEngines("advance_tax_calculator", { estimatedAnnualTax: 10000, quarter: "q1", alreadyPaid: 0 }) as { installmentDue: number }
    expect(typeof result.installmentDue).toBe("number")
  })

  test("income_tax_interest_calculator rejects a section outside 234A/234B/234C", async () => {
    expect(dispatchIncomeTaxEngines("income_tax_interest_calculator", { unpaidAmount: 100, monthsDelayed: 1, section: "234Z" }))
      .rejects.toThrow("section must be one of 234A, 234B, 234C")
  })

  test("income_tax_interest_calculator defaults to section 234B when omitted", async () => {
    const result = await dispatchIncomeTaxEngines("income_tax_interest_calculator", { unpaidAmount: 100, monthsDelayed: 1 }) as { interest: number }
    expect(typeof result.interest).toBe("number")
  })

  test("capital_gains_calculator rejects an assetType outside equity/other", async () => {
    expect(dispatchIncomeTaxEngines("capital_gains_calculator", { saleValue: 100, costOfAcquisition: 50, assetType: "crypto" }))
      .rejects.toThrow("assetType must be equity or other")
  })

  test("capital_gains_calculator accepts an omitted assetType (optional)", async () => {
    const result = await dispatchIncomeTaxEngines("capital_gains_calculator", { saleValue: 100, costOfAcquisition: 50, isLongTerm: "yes" })
    expect(result).toBeTruthy()
  })
})
