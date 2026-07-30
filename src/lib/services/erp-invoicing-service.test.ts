// PR #596 audit fix (zero-tax interim bills, 2026-07-27): computeInvoiceTaxTotals
// is the pure core extracted from computeInvoiceTotals so the tax math is
// independently unit-testable without a DB, matching this repo's established
// .test.ts convention (e.g. construction-valuation-service.ts's
// computeInterimBillLines).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { computeInvoiceTaxTotals, computeRetentionAmount, computeRetentionPosition, type RetentionBearingInvoice } from "./erp-invoicing-service"

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

// FI-AP-007 (Subcontractor Retention Summary, sap_mapping.sqlite gap
// analysis, BUILD_NEW/HIGH, 2026-07-30): computeRetentionAmount/
// computeRetentionPosition are the pure cores extracted so retention math
// is independently unit-testable without a DB, same convention as this
// file's computeInvoiceTaxTotals above.
describe("computeRetentionAmount", () => {
  test("10% retention on a 5000 gross bill", () => {
    expect(computeRetentionAmount(5000, 10)).toBe(500)
  })

  test("0% retention -- amount is exactly zero", () => {
    expect(computeRetentionAmount(1234.56, 0)).toBe(0)
  })

  test("rounds to 2 decimal places on an amount that would otherwise repeat", () => {
    expect(computeRetentionAmount(100, 33.333)).toBe(33.33)
  })
})

describe("computeRetentionPosition", () => {
  const bill = (overrides: Partial<RetentionBearingInvoice> & Pick<RetentionBearingInvoice, "id" | "supplierId">): RetentionBearingInvoice => ({
    invoiceNumber: 1, supplierName: "ACME Interiors", postingDate: "2026-07-01", grandTotal: 10000, status: "submitted",
    retentionPercent: 10, retentionAmount: 1000, retentionReleasedAmount: 0,
    ...overrides,
  })

  test("a single subcontractor with one bill, nothing released yet -- fully held", () => {
    const result = computeRetentionPosition([bill({ id: "inv-1", supplierId: "sup-1" })])
    expect(result.subcontractorCount).toBe(1)
    expect(result.billCount).toBe(1)
    expect(result.totalRetentionWithheld).toBe(1000)
    expect(result.totalRetentionReleased).toBe(0)
    expect(result.totalRetentionHeld).toBe(1000)
    expect(result.subcontractors[0].bills[0].retentionHeld).toBe(1000)
  })

  test("partial release on one bill reduces retentionHeld but not retentionAmount", () => {
    const result = computeRetentionPosition([
      bill({ id: "inv-1", supplierId: "sup-1", retentionAmount: 1000, retentionReleasedAmount: 400 }),
    ])
    expect(result.subcontractors[0].bills[0].retentionAmount).toBe(1000)
    expect(result.subcontractors[0].bills[0].retentionReleased).toBe(400)
    expect(result.subcontractors[0].bills[0].retentionHeld).toBe(600)
    expect(result.totalRetentionHeld).toBe(600)
  })

  test("two bills for the same subcontractor are grouped and totalled together", () => {
    const result = computeRetentionPosition([
      bill({ id: "inv-1", supplierId: "sup-1", retentionAmount: 1000, retentionReleasedAmount: 0 }),
      bill({ id: "inv-2", supplierId: "sup-1", retentionAmount: 500, retentionReleasedAmount: 500 }),
    ])
    expect(result.subcontractorCount).toBe(1)
    expect(result.billCount).toBe(2)
    expect(result.subcontractors[0].totalRetentionAmount).toBe(1500)
    expect(result.subcontractors[0].totalRetentionReleased).toBe(500)
    expect(result.subcontractors[0].totalRetentionHeld).toBe(1000)
  })

  test("bills across two different subcontractors are kept as separate groups, sorted by retention still held descending", () => {
    const result = computeRetentionPosition([
      bill({ id: "inv-1", supplierId: "sup-small", supplierName: "Small Co", retentionAmount: 200, retentionReleasedAmount: 0 }),
      bill({ id: "inv-2", supplierId: "sup-big", supplierName: "Big Co", retentionAmount: 5000, retentionReleasedAmount: 0 }),
    ])
    expect(result.subcontractorCount).toBe(2)
    expect(result.subcontractors[0].supplierId).toBe("sup-big")
    expect(result.subcontractors[1].supplierId).toBe("sup-small")
  })

  test("an invoice with zero retentionAmount (never had retention applied) is excluded entirely -- not every purchase invoice is retention-bearing", () => {
    const result = computeRetentionPosition([
      bill({ id: "inv-1", supplierId: "sup-1", retentionAmount: 0, retentionReleasedAmount: 0 }),
    ])
    expect(result.subcontractorCount).toBe(0)
    expect(result.billCount).toBe(0)
    expect(result.totalRetentionWithheld).toBe(0)
  })

  test("fully released retention still appears (retentionHeld = 0) rather than being silently dropped -- the summary should show the full history", () => {
    const result = computeRetentionPosition([
      bill({ id: "inv-1", supplierId: "sup-1", retentionAmount: 1000, retentionReleasedAmount: 1000 }),
    ])
    expect(result.billCount).toBe(1)
    expect(result.subcontractors[0].bills[0].retentionHeld).toBe(0)
    expect(result.totalRetentionHeld).toBe(0)
  })
})
