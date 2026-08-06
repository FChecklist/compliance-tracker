/// <reference types="bun-types" />
// Real, DB-free unit tests for the pure logic underneath 3 calculation-track
// engines added to this file (sap_mapping.sqlite/sap_reports,
// engine_track=calculation): FI-GL-007 (Subledger-to-GL Reconciliation,
// BUILD_NEW) and the shared rollUpTree() primitive backing both FI-GL-008
// (G/L Account Group Balances Summary) and erp-accounting-service.ts's
// CO-003 (Cost Center Hierarchy Report), both EXTEND_EXISTING. Matches this
// repo's established pattern of unit-testing only the pure logic directly
// (see erp-invoicing-service.test.ts's identical header note re:
// dunningBucketForDaysOverdue) and leaving the DB-touching aggregation
// around it (subledgerToGlReconciliation/glAccountGroupBalancesSummary/
// glAccountBalanceDisplay themselves) to real manual/integration
// verification against seeded data.
import { describe, expect, test } from "bun:test"
import { computeSubledgerVariance, glControlAccountBalance, rollUpTree, SUBLEDGER_RECONCILIATION_TOLERANCE } from "./erp-financial-report-service"

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

// FI-GL-008/CO-003: rollUpTree is the shared pure recursion both hierarchy
// reports (GL account groups and cost centers) reduce to -- tested here
// once against plain synthetic node ids rather than duplicated per caller.
describe("rollUpTree", () => {
  test("a flat list with no parents (all roots): each node's total equals its own amount", () => {
    const totals = rollUpTree(["a", "b", "c"], () => null, (id) => ({ a: 10, b: 20, c: 30 })[id] ?? 0)
    expect(totals.get("a")).toBe(10)
    expect(totals.get("b")).toBe(20)
    expect(totals.get("c")).toBe(30)
  })

  test("a real 2-level tree: a parent's total includes its own amount plus every child's", () => {
    const parentOf: Record<string, string | null> = { root: null, child1: "root", child2: "root" }
    const own: Record<string, number> = { root: 100, child1: 50, child2: 25 }
    const totals = rollUpTree(["root", "child1", "child2"], (id) => parentOf[id], (id) => own[id] ?? 0)
    expect(totals.get("child1")).toBe(50)
    expect(totals.get("child2")).toBe(25)
    expect(totals.get("root")).toBe(175) // 100 + 50 + 25
  })

  test("a real 3-level tree: a grandparent's total includes every descendant at every depth, matching a firm's real Office/Admin -> Reception -> Front Desk shape", () => {
    const parentOf: Record<string, string | null> = { grandparent: null, parent: "grandparent", child: "parent" }
    const own: Record<string, number> = { grandparent: 5, parent: 10, child: 15 }
    const totals = rollUpTree(["grandparent", "parent", "child"], (id) => parentOf[id], (id) => own[id] ?? 0)
    expect(totals.get("child")).toBe(15)
    expect(totals.get("parent")).toBe(25) // 10 + 15
    expect(totals.get("grandparent")).toBe(30) // 5 + 10 + 15
  })

  test("a node with zero own amount but real descendants still rolls up their totals -- a pure group node (isGroup=true, never itself posted to) is not silently zeroed out", () => {
    const parentOf: Record<string, string | null> = { group: null, leaf1: "group", leaf2: "group" }
    const own: Record<string, number> = { group: 0, leaf1: 40, leaf2: 60 }
    const totals = rollUpTree(["group", "leaf1", "leaf2"], (id) => parentOf[id], (id) => own[id] ?? 0)
    expect(totals.get("group")).toBe(100)
  })

  test("a node with no entry in ownAmountOf's data at all defaults to 0, not NaN/undefined -- an account/cost-center with zero real postings this period", () => {
    const totals = rollUpTree(["untouched"], () => null, () => 0)
    expect(totals.get("untouched")).toBe(0)
  })

  test("negative own amounts (a credit-heavy period) roll up correctly through the tree, not just positive spend", () => {
    const parentOf: Record<string, string | null> = { root: null, child: "root" }
    const own: Record<string, number> = { root: -20, child: 50 }
    const totals = rollUpTree(["root", "child"], (id) => parentOf[id], (id) => own[id] ?? 0)
    expect(totals.get("root")).toBe(30) // -20 + 50
  })
})
