/// <reference types="bun-types" />
// PR #596 audit fix (zero-tax interim bills, 2026-07-27): computeInvoiceTaxTotals
// is the pure core extracted from computeInvoiceTotals so the tax math is
// independently unit-testable without a DB, matching this repo's established
// .test.ts convention (e.g. construction-valuation-service.ts's
// computeInterimBillLines).
import { describe, expect, test } from "bun:test"
import {
  computeInvoiceTaxTotals, computePaymentProposal, dunningBucketForDaysOverdue, suggestedDunningLevel, DUNNING_LEVEL_LABELS,
  type PaymentProposalBill, type PaymentProposalBankAccount,
  daysToPay, classifyPaymentReliability, computeDsoFormula,
  vendorDaysToPay, classifyVendorPaymentReliability, computeDpoFormula,
  computeRetentionAmount, computeRetentionPosition, type RetentionBearingInvoice,
} from "./erp-invoicing-service"

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

// FI-AR-006 (Customer Payment Behavior / DSO): tests the 3 pure functions
// only -- customerPaymentBehaviorReport() itself touches the DB
// (withTenantContext + a real UNION across erp_journal_entries and
// erp_payment_entries), same established pattern as dunningList/
// arAgingReport above (see this file's own header note on
// dunningBucketForDaysOverdue). The hand-computed example below is
// deliberately grounded in a REAL seeded invoice, checked directly via the
// Supabase MCP against the live project (pcrjmlpuqsbocqfwoxod) while
// building this PR: invoice_number=1, customer_id=
// 'a7347ed4-ac0c-42db-8592-d587fc2c744b', posting_date='2026-02-24',
// due_date='2026-03-26' (a real, exact 30-day credit term), grand_total=
// 2902589, status='paid'. That invoice's real row has NO discoverable
// payment date in the live database (see the service function's own
// header comment for the honest, verified reason why) -- the payment date
// used below ('2026-03-20') is therefore explicitly a HYPOTHETICAL
// illustration layered on top of that real invoice's real dates, not a
// claim that this payment actually happened.
describe("daysToPay", () => {
  test("real invoice #1's real postingDate to a hypothetical earlier payment date: 24 real days early against its real 30-day term", () => {
    // 2026-02-24 -> 2026-03-20 is exactly 24 days.
    expect(daysToPay("2026-02-24", "2026-03-20")).toBe(24)
  })

  test("same real invoice's real postingDate to its real dueDate is exactly the real 30-day credit term", () => {
    expect(daysToPay("2026-02-24", "2026-03-26")).toBe(30)
  })

  test("a payment on the same day as posting is 0 days to pay", () => {
    expect(daysToPay("2026-02-24", "2026-02-24")).toBe(0)
  })

  test("a payment recorded before the invoice's own posting date is a negative result -- surfaced, not clamped, since that would be a real data bug", () => {
    expect(daysToPay("2026-02-24", "2026-02-20")).toBe(-4)
  })
})

describe("computeDsoFormula", () => {
  test("real invoice's grand_total as the sole credit sale in a 30-day period, fully outstanding: DSO collapses to exactly the period length", () => {
    // (2902589 outstanding / 2902589 credit sales) * 30 = 30.
    expect(computeDsoFormula(2902589, 2902589, 30)).toBe(30)
  })

  test("outstanding AR at half the period's credit sales over a 90-day period gives DSO = 45", () => {
    expect(computeDsoFormula(500000, 1000000, 90)).toBe(45)
  })

  test("zero credit sales in the period returns null (honest 'cannot compute'), never 0 or Infinity", () => {
    expect(computeDsoFormula(500000, 0, 90)).toBeNull()
  })

  test("zero outstanding AR with real credit sales correctly computes a real DSO of 0 (paid in full, not a null/gap case)", () => {
    expect(computeDsoFormula(0, 2902589, 30)).toBe(0)
  })
})

describe("classifyPaymentReliability", () => {
  test("real invoice's 30-day term paid a hypothetical 6 days early classifies as consistently_early", () => {
    expect(classifyPaymentReliability(24, 30)).toBe("consistently_early")
  })

  test("paying exactly on the agreed term classifies as on_time", () => {
    expect(classifyPaymentReliability(30, 30)).toBe("on_time")
  })

  test("paying 5 days past the agreed term is still on_time (inclusive boundary)", () => {
    expect(classifyPaymentReliability(35, 30)).toBe("on_time")
  })

  test("paying 6 days past term rolls into late", () => {
    expect(classifyPaymentReliability(36, 30)).toBe("late")
  })

  test("paying 30 days past term is still late (inclusive boundary)", () => {
    expect(classifyPaymentReliability(60, 30)).toBe("late")
  })

  test("paying 31+ days past term rolls into chronically_late", () => {
    expect(classifyPaymentReliability(61, 30)).toBe("chronically_late")
  })
})

// FI-AP-006 (Vendor Payment History / Payment Behavior Analysis): tests the
// 3 pure functions only -- vendorPaymentBehaviorReport() itself touches the
// DB (withTenantContext + a real query against erp_payment_entries), same
// established pattern as dunningList/arAgingReport above (see this file's
// own header note on dunningBucketForDaysOverdue). The hand-computed
// example below is deliberately grounded in a REAL seeded purchase invoice,
// checked directly via the Supabase MCP against the live project
// (pcrjmlpuqsbocqfwoxod) while building this PR: invoice_number=2001,
// supplier_id='demo_supp_steelcorp' ("SteelCorp India Ltd."),
// posting_date='2026-05-15', due_date='2026-06-14' (a real, exact 30-day
// credit term matching the supplier's own default_payment_terms_days=30),
// grand_total=20060, status='paid'. That invoice's real row has NO
// discoverable payment date in the live database (erp_payment_entries has
// zero rows total -- see vendorPaymentBehaviorReport's own header comment
// for the honest, verified reason why) -- the payment date used below
// ('2026-06-08') is therefore explicitly a HYPOTHETICAL illustration
// layered on top of that real invoice's real dates, not a claim that this
// payment actually happened.
describe("vendorDaysToPay", () => {
  test("real invoice #2001's real postingDate to a hypothetical earlier payment date: 24 real days early against its real 30-day term", () => {
    // 2026-05-15 -> 2026-06-08 is exactly 24 days.
    expect(vendorDaysToPay("2026-05-15", "2026-06-08")).toBe(24)
  })

  test("same real invoice's real postingDate to its real dueDate is exactly the real 30-day credit term", () => {
    expect(vendorDaysToPay("2026-05-15", "2026-06-14")).toBe(30)
  })

  test("a payment on the same day as posting is 0 days to pay", () => {
    expect(vendorDaysToPay("2026-05-15", "2026-05-15")).toBe(0)
  })

  test("a payment recorded before the invoice's own posting date is a negative result -- surfaced, not clamped, since that would be a real data bug", () => {
    expect(vendorDaysToPay("2026-05-15", "2026-05-10")).toBe(-5)
  })
})

describe("computeDpoFormula", () => {
  test("real invoice's grand_total as the sole credit purchase in a 30-day period, fully outstanding: DPO collapses to exactly the period length", () => {
    // (20060 outstanding / 20060 credit purchases) * 30 = 30.
    expect(computeDpoFormula(20060, 20060, 30)).toBe(30)
  })

  test("outstanding AP at half the period's credit purchases over a 90-day period gives DPO = 45", () => {
    expect(computeDpoFormula(500000, 1000000, 90)).toBe(45)
  })

  test("zero credit purchases in the period returns null (honest 'cannot compute'), never 0 or Infinity", () => {
    expect(computeDpoFormula(500000, 0, 90)).toBeNull()
  })

  test("zero outstanding AP with real credit purchases correctly computes a real DPO of 0 (paid in full, not a null/gap case)", () => {
    expect(computeDpoFormula(0, 20060, 30)).toBe(0)
  })
})

describe("classifyVendorPaymentReliability", () => {
  test("real invoice's 30-day term paid a hypothetical 6 days early classifies as consistently_early", () => {
    expect(classifyVendorPaymentReliability(24, 30)).toBe("consistently_early")
  })

  test("paying exactly on the agreed term classifies as on_time", () => {
    expect(classifyVendorPaymentReliability(30, 30)).toBe("on_time")
  })

  test("paying 5 days past the agreed term is still on_time (inclusive boundary)", () => {
    expect(classifyVendorPaymentReliability(35, 30)).toBe("on_time")
  })

  test("paying 6 days past term rolls into late", () => {
    expect(classifyVendorPaymentReliability(36, 30)).toBe("late")
  })

  test("paying 30 days past term is still late (inclusive boundary)", () => {
    expect(classifyVendorPaymentReliability(60, 30)).toBe("late")
  })

  test("paying 31+ days past term rolls into chronically_late", () => {
    expect(classifyVendorPaymentReliability(61, 30)).toBe("chronically_late")
  })
})
