/// <reference types="bun-types" />
// See dispatch-mathematical-engines.test.ts's header for why these dispatch-
// routing tests exist and what they deliberately don't cover.
import { describe, test, expect } from "bun:test"
import { dispatchTdsEngines } from "./dispatch-tds-engines"
import { NOT_HANDLED } from "./dispatch-helpers"

describe("dispatchTdsEngines", () => {
  test("returns NOT_HANDLED for a key outside this category", async () => {
    expect(await dispatchTdsEngines("income_tax_calculator", {})).toBe(NOT_HANDLED)
  })

  test("tds_interest_engine rejects a delayType other than late_deduction/late_deposit", async () => {
    expect(dispatchTdsEngines("tds_interest_engine", { tdsAmount: 100, monthsDelayed: 1, delayType: "whenever" }))
      .rejects.toThrow("delayType must be late_deduction or late_deposit")
  })

  test("tds_interest_engine accepts a valid delayType", async () => {
    const result = await dispatchTdsEngines("tds_interest_engine", { tdsAmount: 100, monthsDelayed: 1, delayType: "late_deduction" }) as { interest: number }
    expect(typeof result.interest).toBe("number")
  })

  test("challan_matching_engine rejects non-array deductions/challans", async () => {
    expect(dispatchTdsEngines("challan_matching_engine", { deductions: "nope", challans: [] }))
      .rejects.toThrow("deductions and challans must both be arrays")
  })

  test("tds_section_validation_engine defaults hasPan to true when omitted", async () => {
    const result = await dispatchTdsEngines("tds_section_validation_engine", { section: "194C", paymentAmount: 50000, cumulativePaymentAmount: 50000 })
    expect(result).toBeTruthy()
  })

  test("pan_validation_engine crosses into data-quality-engine.ts and returns a valid flag", async () => {
    expect(await dispatchTdsEngines("pan_validation_engine", { pan: "ABCDE1234F" })).toEqual({ valid: true })
    expect(await dispatchTdsEngines("pan_validation_engine", { pan: "not-a-pan" })).toEqual({ valid: false })
  })
})
