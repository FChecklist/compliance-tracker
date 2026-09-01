/// <reference types="bun-types" />
// Tests the pure pricing-math function only -- everything else in this file
// touches the DB (organisations/platformBillingPlans/platformBillingInvoices
// via db.query.*, org-license-service.ts, token-usage-service.ts) and is
// deliberately left untested here, matching this repo's established
// pattern (see report-domain-enablement-service.test.ts's own note).
import { describe, expect, test } from "bun:test"
import { computeInvoiceLineItems, type BillingPlan } from "./platform-billing-service"

function plan(overrides: Partial<BillingPlan> = {}): BillingPlan {
  return {
    id: "plan_1",
    planKey: "professional",
    name: "Professional",
    baseFeeMonthlyUsd: "2499",
    perSeatMonthlyUsd: "0",
    includedAiCostUsd: "50",
    overageMultiplier: "1.30",
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as BillingPlan
}

describe("computeInvoiceLineItems", () => {
  test("base fee + seat fee only, usage under the included allowance -- no overage charged", () => {
    const result = computeInvoiceLineItems(plan({ perSeatMonthlyUsd: "10" }), 5, 30)
    expect(result.baseFeeUsd).toBe(2499)
    expect(result.seatFeeUsd).toBe(50)
    expect(result.overageAiCostUsd).toBe(0)
    expect(result.overageChargeUsd).toBe(0)
    expect(result.totalUsd).toBe(2549)
  })

  test("usage beyond the included allowance is marked up by overageMultiplier", () => {
    const result = computeInvoiceLineItems(plan(), 0, 100)
    expect(result.overageAiCostUsd).toBe(50) // 100 - 50 included
    expect(result.overageChargeUsd).toBeCloseTo(65, 5) // 50 * 1.30
    expect(result.totalUsd).toBeCloseTo(2499 + 65, 5)
  })

  test("zero-fee plan (Starter) with zero usage -- everything zero", () => {
    const result = computeInvoiceLineItems(plan({ planKey: "free", baseFeeMonthlyUsd: "0", includedAiCostUsd: "5" }), 3, 0)
    expect(result.totalUsd).toBe(0)
    expect(result.overageAiCostUsd).toBe(0)
  })

  test("usage never produces a negative overage even with zero AI cost", () => {
    const result = computeInvoiceLineItems(plan(), 1, 0)
    expect(result.overageAiCostUsd).toBe(0)
    expect(result.overageChargeUsd).toBe(0)
  })
})
