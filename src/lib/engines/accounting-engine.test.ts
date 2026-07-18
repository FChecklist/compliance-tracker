/// <reference types="bun-types" />
// AI Architecture / Explainability & Transparency gap-closure (2026-07-18):
// no test file existed for this engine before -- scoped to the new
// verifyBalancesNetToZeroExplained() variant this wave adds, not a full
// backfill of every existing engine function's coverage.
import { describe, expect, test } from "bun:test"
import { verifyBalancesNetToZero, verifyBalancesNetToZeroExplained } from "./accounting-engine"

describe("verifyBalancesNetToZeroExplained", () => {
  test("matches the plain function's own values under `.value`", () => {
    const balances = [{ accountId: "a1", debit: 100, credit: 0 }, { accountId: "a2", debit: 0, credit: 100 }]
    const explained = verifyBalancesNetToZeroExplained(balances)
    expect(explained.value).toEqual(verifyBalancesNetToZero(balances))
  })

  test("explains a balanced trial balance", () => {
    const result = verifyBalancesNetToZeroExplained([{ accountId: "a1", debit: 50, credit: 0 }, { accountId: "a2", debit: 0, credit: 50 }])
    expect(result.value.balanced).toBe(true)
    expect(result.explanation).toContain("net to zero")
  })

  test("explains an out-of-balance trial balance", () => {
    const result = verifyBalancesNetToZeroExplained([{ accountId: "a1", debit: 100, credit: 0 }, { accountId: "a2", debit: 0, credit: 40 }])
    expect(result.value.balanced).toBe(false)
    expect(result.explanation).toContain("do NOT net to zero")
  })

  test("provides a per-account step-by-step trace", () => {
    const result = verifyBalancesNetToZeroExplained([{ accountId: "acc-1", debit: 100, credit: 0 }])
    expect(result.steps?.some((s) => s.label.includes("acc-1"))).toBe(true)
    expect(result.steps?.some((s) => s.label === "Total Debit")).toBe(true)
  })

  test("includes an assumption about the rounding tolerance", () => {
    const result = verifyBalancesNetToZeroExplained([])
    expect(result.assumptions?.[0]).toContain("0.01")
  })
})
