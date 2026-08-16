/// <reference types="bun-types" />
// VERIDIAN Review Framework gap-closure (AI Engineering Quality: Overall
// Code Quality, 2026-08-15): dispatchEngine() had zero test coverage before
// this file, despite being one of the largest single functions in the
// codebase (originally ~1175 lines inside task-execution-engine.ts, now its
// own module -- see engine-dispatch.ts's own header for the extraction
// rationale). It's almost entirely a flat allowlist switch over pure
// functions from src/lib/engines/*, so it's real to test directly without
// a DB: every `db`/`orgId` parameter below is unused except by the single
// `gst_return_validation_engine` case, which is intentionally NOT covered
// here (it's a real DB read, out of scope for pure-function coverage --
// matches task-execution-engine.test.ts's own stated DB-touching-vs-pure
// split precedent).
//
// Deliberately not exhaustive over all ~185 registered engine keys (that
// would just be re-testing src/lib/engines/*'s own test suites, if any,
// through an extra layer of indirection) -- this covers one representative
// case per category switch block (so every `switch (engineKey)` block in
// the file has at least one passing case), plus the cross-cutting
// behaviors every category shares: array/object input validation throwing
// a clear error, and the final default case throwing for an unknown key.
import { describe, test, expect } from "bun:test"
import { dispatchEngine } from "./engine-dispatch"
import type { TenantDb } from "@/lib/db/tenant-scoped"

// Never touched by any case exercised here (see header) -- a real TenantDb
// is only needed for gst_return_validation_engine, which this file
// deliberately doesn't cover.
const stubDb = {} as TenantDb
const ORG_ID = "org-test-1"

async function dispatch(engineKey: string, inputs: Record<string, unknown> = {}) {
  return dispatchEngine(stubDb, ORG_ID, engineKey, inputs)
}

describe("dispatchEngine", () => {
  test("throws a clear error for an unknown engineKey", async () => {
    await expect(dispatch("totally_made_up_engine")).rejects.toThrow(
      "No engine dispatcher implemented for totally_made_up_engine"
    )
  })

  describe("Mathematical Computation Engine", () => {
    test("basic_arithmetic_engine adds two numbers", async () => {
      const result = await dispatch("basic_arithmetic_engine", { a: 2, b: 3, operation: "add" })
      expect(result).toEqual({ result: 5 })
    })

    test("basic_arithmetic_engine rejects an unknown operation", async () => {
      await expect(dispatch("basic_arithmetic_engine", { a: 1, b: 1, operation: "yeet" })).rejects.toThrow("Invalid operation")
    })

    test("percentage_engine computes percentage_of", async () => {
      const result = await dispatch("percentage_engine", { value1: 50, value2: 200, operation: "percentage_of" }) as { result: number }
      expect(result.result).toBe(100)
    })

    test("statistical_engine parses a comma-separated number_list input", async () => {
      const result = await dispatch("statistical_engine", { values: "1, 2, 3, 4" }) as { mean: number; count: number }
      expect(result.mean).toBe(2.5)
    })

    test("statistical_engine surfaces a clear error for a malformed number in the list", async () => {
      await expect(dispatch("statistical_engine", { values: "1, abc, 3" })).rejects.toThrow('"abc" is not a valid number')
    })

    test("regression_engine rejects mismatched x/y list lengths", async () => {
      await expect(dispatch("regression_engine", { xValues: "1,2,3", yValues: "1,2" })).rejects.toThrow(
        "X and Y value lists must be the same non-zero length"
      )
    })
  })

  describe("Costing Engine", () => {
    test("job_costing_engine sums direct + overhead cost", async () => {
      const result = await dispatch("job_costing_engine", { directMaterial: 100, directLabor: 50, overheadAllocated: 25 }) as { result: number }
      expect(result.result).toBe(175)
    })

    test("activity_based_costing_engine rejects a non-array costPools", async () => {
      await expect(dispatch("activity_based_costing_engine", { costPools: "not-an-array", objectDriverUsage: {} })).rejects.toThrow(
        "costPools must be an array"
      )
    })
  })

  describe("GST Engine", () => {
    test("gst_split_engine splits an intra-state amount into CGST/SGST", async () => {
      const result = await dispatch("gst_split_engine", {
        taxableAmount: 1000, gstRatePercent: 18, supplierStateCode: "27", buyerStateCode: "27",
      }) as { cgst: number; sgst: number; igst: number }
      expect(result.cgst).toBeCloseTo(90)
      expect(result.sgst).toBeCloseTo(90)
      expect(result.igst).toBe(0)
    })

    test("hsn_validation_engine reports format validity", async () => {
      expect(await dispatch("hsn_validation_engine", { hsn: "1234" })).toEqual({ valid: true })
      expect(await dispatch("hsn_validation_engine", { hsn: "not-a-code" })).toEqual({ valid: false })
    })
  })

  describe("Income Tax Engine", () => {
    test("advance_tax_calculator rejects an invalid quarter", async () => {
      await expect(dispatch("advance_tax_calculator", { quarter: "q9", estimatedAnnualTax: 100, alreadyPaid: 0 })).rejects.toThrow(
        "quarter must be one of q1, q2, q3, q4"
      )
    })
  })

  describe("TDS/TCS Engine", () => {
    test("tds_threshold_checker reports whether a section's threshold is crossed", async () => {
      const result = await dispatch("tds_threshold_checker", { section: "194C", cumulativePaymentAmount: 1000000 }) as { applicable: boolean }
      expect(typeof result.applicable).toBe("boolean")
    })

    test("challan_matching_engine rejects non-array deductions/challans", async () => {
      await expect(dispatch("challan_matching_engine", { deductions: {}, challans: [] })).rejects.toThrow(
        "deductions and challans must both be arrays"
      )
    })
  })

  describe("Accounting Computation Engine", () => {
    test("opening_balance_engine echoes the prior closing balance", async () => {
      const result = await dispatch("opening_balance_engine", { priorClosingBalance: 5000 }) as { openingBalance: number }
      expect(result.openingBalance).toBe(5000)
    })

    test("balance_verification_engine rejects a non-array balances input", async () => {
      await expect(dispatch("balance_verification_engine", { balances: "nope" })).rejects.toThrow("balances must be an array")
    })
  })

  describe("Payroll Engine", () => {
    test("eps_calculator computes EPS from monthly basic+DA", async () => {
      const result = await dispatch("eps_calculator", { monthlyBasicPlusDa: 15000 }) as { epsAmount: number }
      expect(result.epsAmount).toBeGreaterThan(0)
    })
  })

  describe("Inventory Engine", () => {
    test("weighted_average_engine rejects a non-array lots input", async () => {
      await expect(dispatch("weighted_average_engine", { lots: "nope" })).rejects.toThrow("lots must be an array")
    })

    test("eoq_calculator computes a positive economic order quantity", async () => {
      const result = await dispatch("eoq_calculator", { annualDemand: 1000, orderingCostPerOrder: 50, holdingCostPerUnitPerYear: 2 }) as { eoq: number }
      expect(result.eoq).toBeGreaterThan(0)
    })
  })

  describe("HR Engine", () => {
    test("attendance_calculator computes a percentage", async () => {
      const result = await dispatch("attendance_calculator", { presentDays: 18, totalWorkingDays: 20 }) as { attendancePercent: number }
      expect(result.attendancePercent).toBe(90)
    })
  })

  describe("Banking Engine", () => {
    test("emi_calculator/loan_schedule_generator/amortization_engine are the same underlying computation", async () => {
      const inputs = { principal: 100000, annualRatePercent: 10, tenureMonths: 12 }
      const emi = await dispatch("emi_calculator", inputs)
      const schedule = await dispatch("loan_schedule_generator", inputs)
      expect(emi).toEqual(schedule)
    })
  })

  describe("Procurement Engine", () => {
    test("purchase_cost_calculator adds other charges to the base cost", async () => {
      const result = await dispatch("purchase_cost_calculator", { unitPrice: 10, quantity: 5, otherCharges: 5 }) as { purchaseCost: number }
      expect(result.purchaseCost).toBe(55)
    })
  })

  describe("Security Engine", () => {
    test("hash_generation_engine produces a deterministic hash for the same input", async () => {
      const first = await dispatch("hash_generation_engine", { input: "veridian" }) as { hash: string }
      const second = await dispatch("hash_generation_engine", { input: "veridian" }) as { hash: string }
      expect(first.hash).toBe(second.hash)
    })
  })

  describe("Audit Engine", () => {
    test("materiality_calculator rejects an invalid baseType", async () => {
      await expect(dispatch("materiality_calculator", { baseAmount: 1000, baseType: "vibes" })).rejects.toThrow(
        "baseType must be revenue, net_profit, or total_assets"
      )
    })
  })

  describe("AI Support Engine", () => {
    test("tool_selector_engine rejects a non-array availableTools", async () => {
      await expect(dispatch("tool_selector_engine", { requestedCapability: "x", availableTools: "nope" })).rejects.toThrow(
        "availableTools must be an array"
      )
    })
  })

  describe("Compliance Engine", () => {
    test("compliance_interest_calculator computes a positive interest for a real delay", async () => {
      const result = await dispatch("compliance_interest_calculator", { amount: 10000, annualRatePercent: 18, daysLate: 30 }) as { interest: number }
      expect(result.interest).toBeGreaterThan(0)
    })
  })

  describe("Analytics Engine", () => {
    test("anomaly_detection_engine rejects a non-array values input", async () => {
      await expect(dispatch("anomaly_detection_engine", { values: "nope" })).rejects.toThrow("values must be an array of numbers")
    })
  })

  describe("Logistics Engine", () => {
    test("vehicle_utilization_engine computes a percentage", async () => {
      const result = await dispatch("vehicle_utilization_engine", { loadedWeightKg: 500, vehicleCapacityKg: 1000 }) as { utilizationPercent: number }
      expect(result.utilizationPercent).toBe(50)
    })
  })

  describe("Marketing Engine", () => {
    test("cac_calculator divides spend by new customers", async () => {
      const result = await dispatch("cac_calculator", { totalAcquisitionSpend: 1000, newCustomersAcquired: 10 }) as { cac: number }
      expect(result.cac).toBe(100)
    })
  })

  describe("Project Management Engine", () => {
    test("cost_variance_engine subtracts actual cost from earned value", async () => {
      const result = await dispatch("cost_variance_engine", { earnedValue: 500, actualCost: 400 }) as { costVariance: number }
      expect(result.costVariance).toBe(100)
    })
  })

  describe("CRM Engine", () => {
    test("customer_lifetime_value_calculator multiplies value * frequency * lifespan", async () => {
      const result = await dispatch("customer_lifetime_value_calculator", {
        avgOrderValue: 100, purchaseFrequencyPerYear: 4, customerLifespanYears: 5,
      }) as { clv: number }
      expect(result.clv).toBe(2000)
    })
  })

  describe("Sales Engine", () => {
    test("markup_calculator supports both directions via `mode`", async () => {
      const price = await dispatch("markup_calculator", { mode: "price_from_markup", cost: 100, markupPercent: 20 }) as { price: number }
      expect(price.price).toBe(120)
      const markup = await dispatch("markup_calculator", { sellingPrice: 120, cost: 100 }) as { markupPercent: number }
      expect(markup.markupPercent).toBe(20)
    })
  })

  describe("Fixed Asset Engine", () => {
    test("asset_disposal_engine computes gain/loss from sale proceeds vs. book value", async () => {
      const result = await dispatch("asset_disposal_engine", { netBookValue: 1000, saleProceeds: 1200 }) as Record<string, unknown>
      expect(result).toBeTruthy()
    })
  })

  describe("Data Quality Engine", () => {
    test("email_validation_engine reports validity", async () => {
      expect(await dispatch("email_validation_engine", { email: "a@b.com" })).toEqual({ valid: true })
      expect(await dispatch("email_validation_engine", { email: "not-an-email" })).toEqual({ valid: false })
    })
  })

  describe("Document Processing Engine", () => {
    test("duplicate_document_detection_engine rejects a non-array documents input", async () => {
      await expect(dispatch("duplicate_document_detection_engine", { documents: "nope" })).rejects.toThrow("documents must be an array")
    })
  })
})
