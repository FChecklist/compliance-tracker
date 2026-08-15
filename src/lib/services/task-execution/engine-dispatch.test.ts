/// <reference types="bun-types" />
// Real bun:test coverage for dispatchEngine() (previously zero coverage
// anywhere in the repo -- see task-execution-engine.test.ts's own header,
// which explicitly scopes itself to only buildNovelUmrHint() and disclaims
// dispatchEngine/dispatchTool/etc). Covers a representative slice of the
// pure, DB-free calculator branches (GST split, HSN validation, basic
// arithmetic, scientific calculator, time-series/moving-average which
// exercises parseNumberList()'s parsing internally, EMI, gratuity), the
// default "no dispatcher" throw, and the one branch that DOES touch `db`
// (gst_return_validation_engine) via a minimal fake TenantDb-shaped object
// mocking db.query.gstReturnPeriods/gstCanonicalInvoices -- following the
// same mock-shape pattern as monitors/task-completion-monitor.test.ts.
import { describe, test, expect, mock } from "bun:test"
import type { TenantDb } from "../../db/tenant-scoped"
import { dispatchEngine } from "./engine-dispatch"

const ORG_ID = "org-1"
const USER_ID = "user-1"

function fakeDb(overrides: { gstReturnPeriods?: unknown; gstCanonicalInvoices?: unknown[] } = {}): TenantDb {
  return {
    query: {
      gstReturnPeriods: { findFirst: mock(async () => overrides.gstReturnPeriods ?? null) },
      gstCanonicalInvoices: { findMany: mock(async () => overrides.gstCanonicalInvoices ?? []) },
    },
  } as unknown as TenantDb
}

describe("dispatchEngine -- pure calculator branches (no DB)", () => {
  test("basic_arithmetic_engine: add", async () => {
    const result = await dispatchEngine(fakeDb(), ORG_ID, USER_ID, "basic_arithmetic_engine", { a: 2, b: 3, operation: "add" })
    expect(result).toEqual({ result: 5 })
  })

  test("basic_arithmetic_engine: invalid operation throws", async () => {
    await expect(
      dispatchEngine(fakeDb(), ORG_ID, USER_ID, "basic_arithmetic_engine", { a: 2, b: 3, operation: "not_a_real_op" })
    ).rejects.toThrow("Invalid operation")
  })

  test("scientific_calculator_engine: evaluates a real expression", async () => {
    const result = await dispatchEngine(fakeDb(), ORG_ID, USER_ID, "scientific_calculator_engine", { expr: "2 + 3 * 4" }) as { result: number }
    expect(result.result).toBe(14)
  })

  test("gst_split_engine: intra-state splits evenly into CGST+SGST, no IGST", async () => {
    const result = await dispatchEngine(fakeDb(), ORG_ID, USER_ID, "gst_split_engine", {
      taxableAmount: 1000, gstRatePercent: 18, supplierStateCode: "27", buyerStateCode: "27",
    }) as { cgst: number; sgst: number; igst: number; isInterState: boolean }
    expect(result.isInterState).toBe(false)
    expect(result.igst).toBe(0)
    expect(result.cgst).toBe(90)
    expect(result.sgst).toBe(90)
  })

  test("gst_split_engine: inter-state charges IGST only, no CGST/SGST", async () => {
    const result = await dispatchEngine(fakeDb(), ORG_ID, USER_ID, "gst_split_engine", {
      taxableAmount: 1000, gstRatePercent: 18, supplierStateCode: "27", buyerStateCode: "29",
    }) as { cgst: number; sgst: number; igst: number; isInterState: boolean }
    expect(result.isInterState).toBe(true)
    expect(result.cgst).toBe(0)
    expect(result.sgst).toBe(0)
    expect(result.igst).toBe(180)
  })

  test("hsn_validation_engine: accepts a valid 4/6/8-digit HSN code", async () => {
    const result = await dispatchEngine(fakeDb(), ORG_ID, USER_ID, "hsn_validation_engine", { hsn: "1006" }) as { valid: boolean }
    expect(result.valid).toBe(true)
  })

  test("hsn_validation_engine: rejects a malformed HSN code", async () => {
    const result = await dispatchEngine(fakeDb(), ORG_ID, USER_ID, "hsn_validation_engine", { hsn: "abc" }) as { valid: boolean }
    expect(result.valid).toBe(false)
  })

  test("time_series_engine: computes a moving average, exercising parseNumberList's comma-separated parsing", async () => {
    const result = await dispatchEngine(fakeDb(), ORG_ID, USER_ID, "time_series_engine", { values: "1, 2, 3, 4", windowSize: 2 }) as { movingAverage: number[] }
    expect(result.movingAverage).toEqual([1.5, 2.5, 3.5])
  })

  test("time_series_engine: a malformed number in the comma-separated list throws (parseNumberList's own error path)", async () => {
    await expect(
      dispatchEngine(fakeDb(), ORG_ID, USER_ID, "time_series_engine", { values: "1, abc, 3", windowSize: 2 })
    ).rejects.toThrow('"abc" is not a valid number')
  })

  test("emi_calculator: real amortization schedule passes crossVerifyEmi's independent re-derivation", async () => {
    const result = await dispatchEngine(fakeDb(), ORG_ID, USER_ID, "emi_calculator", {
      principal: 100000, annualRatePercent: 10, tenureMonths: 12,
    }) as { schedule: unknown[]; emi: number }
    expect(result.schedule.length).toBe(12)
    expect(result.emi).toBeGreaterThan(0)
  })

  test("gratuity_calculator: real payout passes crossVerifyGratuity's statutory bound check", async () => {
    const result = await dispatchEngine(fakeDb(), ORG_ID, USER_ID, "gratuity_calculator", {
      lastDrawnMonthlySalary: 50000, yearsOfService: 10, isCoveredUnderAct: true,
    }) as { gratuityAmount: number }
    expect(result.gratuityAmount).toBeGreaterThan(0)
  })

  test("an unrecognized engineKey falls through every switch to the default throw", async () => {
    await expect(
      dispatchEngine(fakeDb(), ORG_ID, USER_ID, "totally_made_up_engine_key", {})
    ).rejects.toThrow("No engine dispatcher implemented for totally_made_up_engine_key")
  })
})

describe("dispatchEngine -- gst_return_validation_engine (the one DB-touching branch)", () => {
  test("missing returnPeriodId throws before ever touching the DB", async () => {
    await expect(
      dispatchEngine(fakeDb(), ORG_ID, USER_ID, "gst_return_validation_engine", {})
    ).rejects.toThrow("Missing returnPeriodId")
  })

  test("a returnPeriodId with no matching row throws 'Return period not found'", async () => {
    const db = fakeDb({ gstReturnPeriods: null })
    await expect(
      dispatchEngine(db, ORG_ID, USER_ID, "gst_return_validation_engine", { returnPeriodId: "rp-1" })
    ).rejects.toThrow("Return period not found")
  })

  test("a real return period + confirmed sales invoices validates successfully", async () => {
    const db = fakeDb({
      gstReturnPeriods: { id: "rp-1", orgId: ORG_ID, gstin: "27ABCDE1234F1Z5", period: "2026-07" },
      gstCanonicalInvoices: [
        { invoiceNumber: "INV-001", taxableValue: "1000", totalValue: "1180", cgstAmount: "90", sgstAmount: "90", igstAmount: "0" },
        { invoiceNumber: "INV-002", taxableValue: "500", totalValue: "590", cgstAmount: "45", sgstAmount: "45", igstAmount: "0" },
      ],
    })
    const result = await dispatchEngine(db, ORG_ID, USER_ID, "gst_return_validation_engine", { returnPeriodId: "rp-1" }) as { valid: boolean; errors: string[] }
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  test("zero confirmed sales invoices for the period fails validation (no line items)", async () => {
    const db = fakeDb({
      gstReturnPeriods: { id: "rp-1", orgId: ORG_ID, gstin: "27ABCDE1234F1Z5", period: "2026-07" },
      gstCanonicalInvoices: [],
    })
    const result = await dispatchEngine(db, ORG_ID, USER_ID, "gst_return_validation_engine", { returnPeriodId: "rp-1" }) as { valid: boolean; errors: string[] }
    expect(result.valid).toBe(false)
    expect(result.errors).toContain("At least one line item is required")
  })
})
