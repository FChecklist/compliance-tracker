/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { hasTrialBalanceFooterRows } from "./erp-reports-guards"

describe("hasTrialBalanceFooterRows", () => {
  test("false when report hasn't loaded yet (null)", () => {
    expect(hasTrialBalanceFooterRows(null)).toBe(false)
  })

  test("false for a 403 error body with no accounts field -- GAP-ERP-REPORTS-CLIENT-CRASH-ON-403 repro: this exact shape used to throw with the old `report && report.accounts.length > 0` guard", () => {
    expect(hasTrialBalanceFooterRows({ error: "ERP module not enabled" } as unknown as { accounts?: unknown[] })).toBe(false)
  })

  test("false when accounts is an empty array", () => {
    expect(hasTrialBalanceFooterRows({ accounts: [] })).toBe(false)
  })

  test("true when accounts has rows", () => {
    expect(hasTrialBalanceFooterRows({ accounts: [{ accountId: "1" }] })).toBe(true)
  })
})
