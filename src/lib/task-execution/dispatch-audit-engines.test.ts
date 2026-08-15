/// <reference types="bun-types" />
// See dispatch-mathematical-engines.test.ts's header for why these dispatch-
// routing tests exist and what they deliberately don't cover.
import { describe, test, expect } from "bun:test"
import { dispatchAuditEngines } from "./dispatch-audit-engines"
import { NOT_HANDLED } from "./dispatch-helpers"

describe("dispatchAuditEngines", () => {
  test("returns NOT_HANDLED for a key outside this category", async () => {
    expect(await dispatchAuditEngines("purchase_cost_calculator", {})).toBe(NOT_HANDLED)
  })

  test("materiality_calculator rejects a baseType outside revenue/net_profit/total_assets", async () => {
    expect(dispatchAuditEngines("materiality_calculator", { baseAmount: 100, baseType: "ebitda" }))
      .rejects.toThrow("baseType must be revenue, net_profit, or total_assets")
  })

  test("materiality_calculator accepts a valid baseType", async () => {
    const result = await dispatchAuditEngines("materiality_calculator", { baseAmount: 1000000, baseType: "revenue" }) as { materiality: number }
    expect(typeof result.materiality).toBe("number")
  })

  test("risk_scoring_engine, duplicate_invoice_detector, duplicate_payment_detector, benford_analysis_engine, and exception_detection_engine each reject a non-array input", async () => {
    expect(dispatchAuditEngines("risk_scoring_engine", { factors: "nope" })).rejects.toThrow("factors must be an array")
    expect(dispatchAuditEngines("duplicate_invoice_detector", { invoices: "nope" })).rejects.toThrow("invoices must be an array")
    expect(dispatchAuditEngines("duplicate_payment_detector", { payments: "nope" })).rejects.toThrow("payments must be an array")
    expect(dispatchAuditEngines("benford_analysis_engine", { values: "nope" })).rejects.toThrow("values must be an array of numbers")
    expect(dispatchAuditEngines("exception_detection_engine", { values: "nope" })).rejects.toThrow("values must be an array of numbers")
  })

  test("journal_risk_analyzer reads isManual through the truthy() helper (only flagged when also near period close)", async () => {
    const manual = await dispatchAuditEngines("journal_risk_analyzer", { amount: 101, postedAt: "2026-01-01T00:00:00Z", isManual: "yes", periodEndDate: "2026-01-02" })
    const notManual = await dispatchAuditEngines("journal_risk_analyzer", { amount: 101, postedAt: "2026-01-01T00:00:00Z", isManual: "no", periodEndDate: "2026-01-02" })
    expect(manual).not.toEqual(notManual)
  })
})
