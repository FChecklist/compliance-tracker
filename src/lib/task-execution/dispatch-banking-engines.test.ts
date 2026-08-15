/// <reference types="bun-types" />
// See dispatch-mathematical-engines.test.ts's header for why these dispatch-
// routing tests exist and what they deliberately don't cover.
import { describe, test, expect } from "bun:test"
import { dispatchBankingEngines } from "./dispatch-banking-engines"
import { NOT_HANDLED } from "./dispatch-helpers"

describe("dispatchBankingEngines", () => {
  test("returns NOT_HANDLED for a key outside this category", async () => {
    expect(await dispatchBankingEngines("attendance_calculator", {})).toBe(NOT_HANDLED)
  })

  test("emi_calculator, loan_schedule_generator, and amortization_engine share one handler (fallthrough)", async () => {
    const inputs = { principal: 100000, annualRatePercent: 10, tenureMonths: 12 }
    const [a, b, c] = await Promise.all([
      dispatchBankingEngines("emi_calculator", inputs),
      dispatchBankingEngines("loan_schedule_generator", inputs),
      dispatchBankingEngines("amortization_engine", inputs),
    ])
    expect(a).toEqual(b)
    expect(b).toEqual(c)
  })

  test("banking_interest_calculator rejects a method outside simple/compound_daily", async () => {
    expect(dispatchBankingEngines("banking_interest_calculator", { principal: 1, annualRatePercent: 1, days: 1, method: "exotic" }))
      .rejects.toThrow("method must be simple or compound_daily")
  })

  test("cash_flow_projection rejects a non-array movements", async () => {
    expect(dispatchBankingEngines("cash_flow_projection", { openingBalance: 0, movements: "nope" })).rejects.toThrow("movements must be an array")
  })

  test("outstanding_cheque_engine rejects a non-array cheques", async () => {
    expect(dispatchBankingEngines("outstanding_cheque_engine", { cheques: "nope", asOfDate: "2026-01-01" })).rejects.toThrow("cheques must be an array")
  })
})
