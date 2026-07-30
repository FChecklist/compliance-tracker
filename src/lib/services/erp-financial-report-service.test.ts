/// <reference types="bun-types" />
// FI-GL-007 (Subledger-to-GL Reconciliation): tests the pure variance/sign-
// convention functions only -- subledgerToGlReconciliation() itself touches
// the DB (withTenantContext + trialBalance), matching this repo's
// established pattern of unit-testing only the pure logic directly (see
// erp-invoicing-service.test.ts's identical header note re:
// dunningBucketForDaysOverdue) and leaving the DB-touching aggregation to
// real manual/integration verification against seeded data on
// VERIDIAN-DEV (recorded in this wave's PR description).
import { describe, expect, test } from "bun:test"
import { computeSubledgerVariance, glControlAccountBalance, SUBLEDGER_RECONCILIATION_TOLERANCE } from "./erp-financial-report-service"

describe("computeSubledgerVariance", () => {
  test("subledger total exactly matches GL balance -> zero variance, reconciled", () => {
    const result = computeSubledgerVariance(50000, 50000)
    expect(result.variance).toBe(0)
    expect(result.isReconciled).toBe(true)
  })

  test("a real mismatch (GL balance higher than subledger total) is flagged, with variance = GL - subledger", () => {
    const result = computeSubledgerVariance(48000, 50000)
    expect(result.variance).toBe(2000)
    expect(result.isReconciled).toBe(false)
  })

  test("a real mismatch the other direction (subledger higher than GL) is also flagged, variance is negative", () => {
    const result = computeSubledgerVariance(52000, 50000)
    expect(result.variance).toBe(-2000)
    expect(result.isReconciled).toBe(false)
  })

  test("a variance within the 0.01 rounding tolerance is still treated as reconciled -- absorbs floating-point noise, not a real imbalance", () => {
    const result = computeSubledgerVariance(50000, 50000.005)
    expect(result.isReconciled).toBe(true)
  })

  test("a variance right at the tolerance boundary (~0.01) is NOT reconciled -- strictly less-than, matching accounting-engine.ts's verifyBalancesNetToZero convention", () => {
    const result = computeSubledgerVariance(50000, 50000.01)
    expect(Math.abs(result.variance)).toBeCloseTo(SUBLEDGER_RECONCILIATION_TOLERANCE, 6)
    expect(result.isReconciled).toBe(false)
  })

  test("both zero (no invoices, no GL postings) is trivially reconciled", () => {
    const result = computeSubledgerVariance(0, 0)
    expect(result.variance).toBe(0)
    expect(result.isReconciled).toBe(true)
  })
})

describe("glControlAccountBalance", () => {
  test("receivable (asset, debit-natured): netBalance passes through unchanged as the owed-to-us figure", () => {
    expect(glControlAccountBalance(75000, "receivable")).toBe(75000)
  })

  test("receivable with a negative netBalance (shouldn't normally happen, but the sign convention must still hold) passes through unchanged", () => {
    expect(glControlAccountBalance(-100, "receivable")).toBe(-100)
  })

  test("payable (liability, credit-natured): a real payable balance is credit > debit, so netBalance is negative -- flipped to a positive owed-to-them figure", () => {
    // 30 in debits, 90000 in credits -> netBalance (debit - credit) = -89970
    expect(glControlAccountBalance(-89970, "payable")).toBe(89970)
  })

  test("payable with netBalance exactly zero flips to plain 0, not -0 (Object.is-safe)", () => {
    expect(Object.is(glControlAccountBalance(0, "payable"), 0)).toBe(true)
  })

  test("receivable and payable flip the identical magnitude in opposite directions, matching balanceSheet()'s own liability sign-flip convention", () => {
    expect(glControlAccountBalance(1234, "receivable")).toBe(1234)
    expect(glControlAccountBalance(-1234, "payable")).toBe(1234)
  })
})
