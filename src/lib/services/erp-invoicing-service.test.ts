// PR #596 audit fix (zero-tax interim bills, 2026-07-27): computeInvoiceTaxTotals
// is the pure core extracted from computeInvoiceTotals so the tax math is
// independently unit-testable without a DB, matching this repo's established
// .test.ts convention (e.g. construction-valuation-service.ts's
// computeInterimBillLines).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { computeInvoiceTaxTotals } from "./erp-invoicing-service"

describe("computeInvoiceTaxTotals", () => {
  test("a real tax template's rates produce a real, nonzero tax amount on the line's full value", () => {
    const result = computeInvoiceTaxTotals([
      { quantity: 1, rate: 10000, taxLines: [{ taxAccountId: "cgst", rate: 9 }, { taxAccountId: "sgst", rate: 9 }] },
    ])
    expect(result.subtotal).toBe(10000)
    expect(result.taxAmount).toBe(1800)
    expect(result.grandTotal).toBe(11800)
  })

  test("a line with no tax lines contributes zero tax -- this is the original bug's shape when a line genuinely carries no tax template, not a hidden default", () => {
    const result = computeInvoiceTaxTotals([{ quantity: 1, rate: 10000, taxLines: [] }])
    expect(result.taxAmount).toBe(0)
    expect(result.grandTotal).toBe(10000)
  })

  test("retention is never an invoice line item, so it can't shrink the taxable base: tax on the full gross bill matches what it would be if no retention line ever existed", () => {
    const gross = 3500
    const fullyTaxedNoRetentionLine = computeInvoiceTaxTotals([{ quantity: 1, rate: gross, taxLines: [{ taxAccountId: "gst", rate: 18 }] }])
    expect(fullyTaxedNoRetentionLine.subtotal).toBe(3500)
    expect(fullyTaxedNoRetentionLine.taxAmount).toBe(630)
    expect(fullyTaxedNoRetentionLine.grandTotal).toBe(4130)

    // Contrast: the bug this replaces added a negative "Retention held" line
    // (rate: -350, no tax) alongside the billable lines, which drags the
    // taxable subtotal down to 3150 -- understating both the invoice's
    // reported taxable value and (once a real taxTemplateId is on every
    // line) the GST actually due.
    const oldNegativeRetentionLineApproach = computeInvoiceTaxTotals([
      { quantity: 1, rate: gross, taxLines: [{ taxAccountId: "gst", rate: 18 }] },
      { quantity: 1, rate: -350, taxLines: [] },
    ])
    expect(oldNegativeRetentionLineApproach.subtotal).toBe(3150)
    expect(oldNegativeRetentionLineApproach.subtotal).not.toBe(fullyTaxedNoRetentionLine.subtotal)
  })
})
