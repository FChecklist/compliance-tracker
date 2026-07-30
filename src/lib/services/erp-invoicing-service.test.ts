/// <reference types="bun-types" />
// PR #596 audit fix (zero-tax interim bills, 2026-07-27): computeInvoiceTaxTotals
// is the pure core extracted from computeInvoiceTotals so the tax math is
// independently unit-testable without a DB, matching this repo's established
// .test.ts convention (e.g. construction-valuation-service.ts's
// computeInterimBillLines).
import { describe, expect, test } from "bun:test"
import { computeInvoiceTaxTotals, computePaymentProposal, dunningBucketForDaysOverdue, suggestedDunningLevel, DUNNING_LEVEL_LABELS, type PaymentProposalBill, type PaymentProposalBankAccount } from "./erp-invoicing-service"

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

// FI-AP-005 (SAP F110 "Payment Proposal List" equivalent, sap_mapping.sqlite
// gap analysis, BUILD_NEW/HIGH): computePaymentProposal is the pure due/
// overdue + vendor-grouping core extracted from paymentProposalList, same
// DB-free unit-test convention as computeInvoiceTaxTotals above.
describe("computePaymentProposal", () => {
  const noBankAccounts = new Map<string, PaymentProposalBankAccount>()

  function bill(overrides: Partial<PaymentProposalBill>): PaymentProposalBill {
    return {
      id: "inv1", invoiceNumber: 1, supplierId: "sup1", supplierName: "Acme Steel",
      postingDate: "2026-07-01", dueDate: "2026-07-01", outstandingAmount: "1000", status: "submitted",
      ...overrides,
    }
  }

  test("an overdue bill is included, flagged isOverdue, with a positive daysOverdue", () => {
    const result = computePaymentProposal(
      [bill({ dueDate: "2026-07-01" })], "2026-07-15", noBankAccounts
    )
    expect(result.lineCount).toBe(1)
    expect(result.suppliers[0].lines[0].isOverdue).toBe(true)
    expect(result.suppliers[0].lines[0].daysOverdue).toBe(14)
  })

  test("a bill due exactly on asOfDate is included but not overdue", () => {
    const result = computePaymentProposal(
      [bill({ dueDate: "2026-07-15" })], "2026-07-15", noBankAccounts
    )
    expect(result.lineCount).toBe(1)
    expect(result.suppliers[0].lines[0].isOverdue).toBe(false)
    expect(result.suppliers[0].lines[0].daysOverdue).toBe(0)
  })

  test("a bill due in the future is excluded -- a payment proposal is not a full future-dated AP register", () => {
    const result = computePaymentProposal(
      [bill({ dueDate: "2026-08-01" })], "2026-07-15", noBankAccounts
    )
    expect(result.lineCount).toBe(0)
    expect(result.suppliers.length).toBe(0)
  })

  test("a bill with zero outstanding balance (already fully paid) is excluded", () => {
    const result = computePaymentProposal(
      [bill({ dueDate: "2026-07-01", outstandingAmount: "0" })], "2026-07-15", noBankAccounts
    )
    expect(result.lineCount).toBe(0)
  })

  test("minAmount filters out smaller bills but keeps larger ones", () => {
    const result = computePaymentProposal(
      [bill({ id: "small", outstandingAmount: "500" }), bill({ id: "large", outstandingAmount: "5000" })],
      "2026-07-15",
      noBankAccounts,
      1000
    )
    expect(result.lineCount).toBe(1)
    expect(result.suppliers[0].lines[0].invoiceId).toBe("large")
  })

  test("multiple bills for the same vendor are grouped with a correct total, and vendors sort by total descending", () => {
    const result = computePaymentProposal(
      [
        bill({ id: "a", supplierId: "sup1", supplierName: "Acme Steel", outstandingAmount: "1000" }),
        bill({ id: "b", supplierId: "sup1", supplierName: "Acme Steel", outstandingAmount: "2000" }),
        bill({ id: "c", supplierId: "sup2", supplierName: "Bright Electricals", outstandingAmount: "500" }),
      ],
      "2026-07-15",
      noBankAccounts
    )
    expect(result.supplierCount).toBe(2)
    expect(result.lineCount).toBe(3)
    expect(result.totalProposedAmount).toBe(3500)
    expect(result.suppliers[0].supplierId).toBe("sup1")
    expect(result.suppliers[0].totalAmount).toBe(3000)
    expect(result.suppliers[0].lines.length).toBe(2)
    expect(result.suppliers[1].supplierId).toBe("sup2")
    expect(result.suppliers[1].totalAmount).toBe(500)
  })

  test("no data yet -- an empty bill list returns an empty, not an error", () => {
    const result = computePaymentProposal([], "2026-07-15", noBankAccounts)
    expect(result.lineCount).toBe(0)
    expect(result.supplierCount).toBe(0)
    expect(result.totalProposedAmount).toBe(0)
    expect(result.suppliers).toEqual([])
  })

  test("a null dueDate falls back to postingDate, matching arAgingReport's identical convention", () => {
    const result = computePaymentProposal(
      [bill({ dueDate: null, postingDate: "2026-07-01" })], "2026-07-15", noBankAccounts
    )
    expect(result.lineCount).toBe(1)
    expect(result.suppliers[0].lines[0].dueDate).toBe("2026-07-01")
    expect(result.suppliers[0].lines[0].daysOverdue).toBe(14)
  })

  test("bank account is attached from the precomputed map, masked -- never the raw account number", () => {
    const bankAccounts = new Map<string, PaymentProposalBankAccount>([
      ["sup1", { bankName: "HDFC Bank", accountNumberMasked: "••••4321", ifscCode: "HDFC0001234" }],
    ])
    const result = computePaymentProposal([bill({})], "2026-07-15", bankAccounts)
    expect(result.suppliers[0].lines[0].bankAccount).toEqual({ bankName: "HDFC Bank", accountNumberMasked: "••••4321", ifscCode: "HDFC0001234" })
  })
})

// FI-AR-004 (Dunning List): tests the pure bucket/dunning-level-derivation
// functions only -- dunningList()/recordDunningAction() both touch the DB
// (withTenantContext), matching this repo's established pattern of testing
// only the pure logic directly (see report-engine-service.test.ts's own
// header note) and leaving DB-touching functions to real manual/integration
// verification (this wave's PR description records that verification: the
// bucket boundaries below were cross-checked against real seeded
// erp_sales_invoices rows via direct SQL on VERIDIAN-DEV).
describe("dunningBucketForDaysOverdue", () => {
  test("1 day overdue is bucket 1-30", () => {
    expect(dunningBucketForDaysOverdue(1)).toBe("1-30")
  })

  test("30 days overdue is still bucket 1-30 (inclusive upper bound)", () => {
    expect(dunningBucketForDaysOverdue(30)).toBe("1-30")
  })

  test("31 days overdue rolls into bucket 31-60", () => {
    expect(dunningBucketForDaysOverdue(31)).toBe("31-60")
  })

  test("60 days overdue is still bucket 31-60", () => {
    expect(dunningBucketForDaysOverdue(60)).toBe("31-60")
  })

  test("61 days overdue rolls into bucket 61-90", () => {
    expect(dunningBucketForDaysOverdue(61)).toBe("61-90")
  })

  test("90 days overdue is still bucket 61-90", () => {
    expect(dunningBucketForDaysOverdue(90)).toBe("61-90")
  })

  test("91+ days overdue is bucket 90+", () => {
    expect(dunningBucketForDaysOverdue(91)).toBe("90+")
    expect(dunningBucketForDaysOverdue(216)).toBe("90+")
  })
})

describe("suggestedDunningLevel", () => {
  test("bucket 1-30 suggests level 1 (Friendly Reminder)", () => {
    expect(suggestedDunningLevel("1-30")).toBe(1)
  })

  test("bucket 31-60 suggests level 2 (Formal Notice)", () => {
    expect(suggestedDunningLevel("31-60")).toBe(2)
  })

  test("bucket 61-90 suggests level 3 (Final Demand)", () => {
    expect(suggestedDunningLevel("61-90")).toBe(3)
  })

  test("bucket 90+ maxes out at level 3, not a 4th tier", () => {
    expect(suggestedDunningLevel("90+")).toBe(3)
  })
})

describe("DUNNING_LEVEL_LABELS", () => {
  test("covers all 4 defined levels with human-readable labels", () => {
    expect(DUNNING_LEVEL_LABELS[0]).toBe("No reminder sent")
    expect(DUNNING_LEVEL_LABELS[1]).toBe("Friendly Reminder")
    expect(DUNNING_LEVEL_LABELS[2]).toBe("Formal Notice")
    expect(DUNNING_LEVEL_LABELS[3]).toBe("Final Demand")
  })
})
