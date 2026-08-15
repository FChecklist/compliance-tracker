/// <reference types="bun-types" />
// GTM certification category 13 (AI testing), OCID-020 -- bounded,
// AI-assisted test-case generation for the real invoice reconciliation flow.
//
// SCOPE NOTE: this repo has no route literally named "invoice reconciliation"
// (checked the live route table under src/app/api first). The nearest real
// equivalent surface is the GST Verification & Reconciliation Engine's
// deterministic purchase-invoice <-> GSTR-2B invoice matcher
// (src/lib/gst/reconciliation-engine.ts, exercised end-to-end by
// POST /api/gst-reconciliation/reconcile -> runReconciliation() in
// src/lib/services/gst-reconciliation-service.ts). It is literally an
// invoice reconciliation engine: it takes two invoice sets and produces
// exact/probable/mismatch/missing_in_2b/missing_in_books matches, which is
// exactly what a user sees on the reconciliation results screen. No prior
// test file existed for this engine (verified via git ls-files) -- this is
// genuinely new coverage, not a duplicate.
//
// Uses this repo's own existing test tooling (bun:test, run via `bun test`,
// wired into CI at .github/workflows/ci.yml:53) -- no new framework added.
import { describe, test, expect } from "bun:test"
import { reconcile, summarizeMatches, type ReconInvoice } from "./reconciliation-engine"

const GSTIN_A = "27ABCDE1234F1Z5"
const GSTIN_B = "07XYZAB6789G1Z1"

function inv(overrides: Partial<ReconInvoice> & { id: string }): ReconInvoice {
  return {
    counterpartyGstin: GSTIN_A,
    invoiceNumber: "INV-001",
    invoiceDate: "2026-07-01",
    totalValue: "118000",
    ...overrides,
  }
}

describe("Invoice reconciliation engine (GSTR-2B <-> purchase register) -- GTM cat13 AI testing pass, OCID-020", () => {
  test("TC1: identical GSTIN + invoice number + amount -> exact match", () => {
    const purchase = [inv({ id: "p1" })]
    const gstr2b = [inv({ id: "g1" })]
    const matches = reconcile(purchase, gstr2b)
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ purchaseInvoiceId: "p1", gstr2bInvoiceId: "g1", matchType: "exact", confidenceScore: 1, deltaAmount: 0 })
  })

  test("TC2: same GSTIN + invoice number but amount differs beyond ₹1 tolerance -> mismatch with delta", () => {
    const purchase = [inv({ id: "p1", totalValue: "118000" })]
    const gstr2b = [inv({ id: "g1", totalValue: "118500" })]
    const matches = reconcile(purchase, gstr2b)
    expect(matches).toHaveLength(1)
    expect(matches[0].matchType).toBe("mismatch")
    expect(matches[0].deltaAmount).toBeCloseTo(500, 2)
    expect(matches[0].notes).toContain("amount differs")
  })

  test("TC3: amount differs by exactly the ₹1 tolerance boundary -> still exact (not mismatch)", () => {
    const purchase = [inv({ id: "p1", totalValue: "118000" })]
    const gstr2b = [inv({ id: "g1", totalValue: "118001" })]
    const matches = reconcile(purchase, gstr2b)
    expect(matches[0].matchType).toBe("exact")
  })

  test("TC4: same GSTIN + amount, invoice number differs (data-entry variation), date within 3-day window -> probable match", () => {
    const purchase = [inv({ id: "p1", invoiceNumber: "INV/001-A", invoiceDate: "2026-07-01" })]
    const gstr2b = [inv({ id: "g1", invoiceNumber: "INV-001-A-X", invoiceDate: "2026-07-03" })]
    const matches = reconcile(purchase, gstr2b)
    expect(matches).toHaveLength(1)
    expect(matches[0].matchType).toBe("probable")
    expect(matches[0].confidenceScore).toBe(0.7)
    expect(matches[0].notes).toContain("invoice numbers differ")
  })

  test("TC5: invoice number normalization -- leading zeros, case, and punctuation differences still match exact", () => {
    const purchase = [inv({ id: "p1", invoiceNumber: "inv-0001" })]
    const gstr2b = [inv({ id: "g1", invoiceNumber: "INV0001" })]
    const matches = reconcile(purchase, gstr2b)
    expect(matches[0].matchType).toBe("exact")
  })

  test("TC6: purchase invoice with no GSTR-2B counterpart -> missing_in_2b (supplier didn't file / filed late)", () => {
    const purchase = [inv({ id: "p1", invoiceNumber: "INV-999" })]
    const gstr2b: ReconInvoice[] = []
    const matches = reconcile(purchase, gstr2b)
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ purchaseInvoiceId: "p1", gstr2bInvoiceId: null, matchType: "missing_in_2b" })
    expect(matches[0].deltaAmount).toBe(118000)
  })

  test("TC7: GSTR-2B invoice with no purchase-register counterpart -> missing_in_books (possible unrecorded purchase)", () => {
    const purchase: ReconInvoice[] = []
    const gstr2b = [inv({ id: "g1" })]
    const matches = reconcile(purchase, gstr2b)
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ purchaseInvoiceId: null, gstr2bInvoiceId: "g1", matchType: "missing_in_books" })
  })

  test("TC8: duplicate purchase invoices against a single 2B invoice -- each 2B row is consumed at most once", () => {
    const purchase = [inv({ id: "p1" }), inv({ id: "p2" })]
    const gstr2b = [inv({ id: "g1" })]
    const matches = reconcile(purchase, gstr2b)
    expect(matches).toHaveLength(2)
    const exact = matches.filter(m => m.matchType === "exact")
    const unmatched = matches.filter(m => m.matchType === "missing_in_2b")
    expect(exact).toHaveLength(1)
    expect(unmatched).toHaveLength(1)
    // the same 2B row is never referenced by two different matches
    expect(new Set(matches.filter(m => m.gstr2bInvoiceId).map(m => m.gstr2bInvoiceId)).size).toBe(1)
  })

  test("TC9: summarizeMatches aggregates a mixed batch into the counts a user sees on the reconciliation summary screen", () => {
    const purchase = [
      inv({ id: "p1", invoiceNumber: "A1" }),               // exact
      inv({ id: "p2", invoiceNumber: "A2", totalValue: "100" }), // mismatch vs g2 below
      inv({ id: "p3", invoiceNumber: "A3", counterpartyGstin: GSTIN_B }), // missing_in_2b (GSTIN_B has no 2B rows at all)
    ]
    const gstr2b = [
      inv({ id: "g1", invoiceNumber: "A1" }),                // exact match for p1
      inv({ id: "g2", invoiceNumber: "A2", totalValue: "999" }), // mismatch for p2
      inv({ id: "g4", invoiceNumber: "A4", counterpartyGstin: GSTIN_A, totalValue: "1" }), // missing_in_books (amount/GSTIN don't fuzzy-match anything on the purchase side)
    ]
    const matches = reconcile(purchase, gstr2b)
    const summary = summarizeMatches(matches)
    expect(summary).toEqual({ exactMatches: 1, probableMatches: 0, mismatches: 1, missingIn2b: 1, missingInBooks: 1 })
  })

  test("TC10: different counterparty GSTIN blocks a match even with identical invoice number and amount", () => {
    const purchase = [inv({ id: "p1", counterpartyGstin: GSTIN_A })]
    const gstr2b = [inv({ id: "g1", counterpartyGstin: GSTIN_B })]
    const matches = reconcile(purchase, gstr2b)
    expect(matches).toHaveLength(2)
    expect(matches.find(m => m.purchaseInvoiceId === "p1")?.matchType).toBe("missing_in_2b")
    expect(matches.find(m => m.gstr2bInvoiceId === "g1")?.matchType).toBe("missing_in_books")
  })
})
