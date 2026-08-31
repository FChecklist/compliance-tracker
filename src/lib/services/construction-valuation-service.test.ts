// Interim/RA billing + retention (Owner directive, PROJEXA_ERP_END_TO_END_
// REQUIREMENT_ANALYSIS_GAP_FILL_AND_IMPLEMENTATION, 2026-07-27): tests the
// pure helpers extracted from construction-valuation-service.ts --
// computeInterimBillLines and applyRetention -- without touching
// withTenantContext/a live DB, matching this repo's established
// .test.ts convention.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { computeInterimBillLines, applyRetention, buildInterimBillInvoiceItems, type BillableLineItem, type InterimBillLine } from "./construction-valuation-service"

describe("applyRetention", () => {
  test("10% retention on a 5000 gross bill", () => {
    expect(applyRetention(5000, 10)).toEqual({ retentionAmount: 500, netPayable: 4500 })
  })

  test("0% retention -- net payable equals gross exactly", () => {
    expect(applyRetention(1234.56, 0)).toEqual({ retentionAmount: 0, netPayable: 1234.56 })
  })

  test("rounds to 2 decimal places", () => {
    expect(applyRetention(100, 33.333)).toEqual({ retentionAmount: 33.33, netPayable: 66.67 })
  })
})

describe("computeInterimBillLines -- first bill on a BoQ (no previous billing)", () => {
  const lineItems: BillableLineItem[] = [
    { id: "li-1", amount: 5000, activityId: "act-1", description: "Excavation" },
    { id: "li-2", amount: 2000, activityId: "act-2", description: "Sub A" },
  ]

  test("cumulativeAmount = lineItem.amount * percentComplete / 100; currentBillAmount = cumulativeAmount when nothing was billed before", () => {
    const percentByActivity = new Map([["act-1", 40], ["act-2", 100]])
    const lines = computeInterimBillLines(lineItems, percentByActivity, new Map())

    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ boqLineItemId: "li-1", cumulativePercentComplete: 40, cumulativeAmount: 2000, previousBilledAmount: 0, currentBillAmount: 2000 })
    expect(lines[1]).toMatchObject({ boqLineItemId: "li-2", cumulativePercentComplete: 100, cumulativeAmount: 2000, previousBilledAmount: 0, currentBillAmount: 2000 })
  })

  test("a line item with no activityId is skipped -- nothing to track progress against", () => {
    const untracked: BillableLineItem = { id: "li-3", amount: 1000, activityId: null, description: "Untracked" }
    const lines = computeInterimBillLines([...lineItems, untracked], new Map([["act-1", 50], ["act-2", 50]]), new Map())
    expect(lines.find((l) => l.boqLineItemId === "li-3")).toBeUndefined()
  })

  test("a line item whose activity has no progress entry yet is skipped", () => {
    const lines = computeInterimBillLines(lineItems, new Map([["act-1", 40]]), new Map())
    expect(lines).toHaveLength(1)
    expect(lines[0].boqLineItemId).toBe("li-1")
  })
})

describe("computeInterimBillLines -- a SECOND interim bill only claims the increment", () => {
  test("30% already billed (1500 of 5000 amount), now at 80% complete -- this bill only claims the delta (2500)", () => {
    const lineItems: BillableLineItem[] = [{ id: "li-1", amount: 5000, activityId: "act-1", description: "Excavation" }]
    const percentByActivity = new Map([["act-1", 80]]) // cumulative 4000
    const previousBilled = new Map([["li-1", 1500]]) // billed on an earlier interim bill (at 30%)

    const [line] = computeInterimBillLines(lineItems, percentByActivity, previousBilled)
    expect(line.cumulativeAmount).toBe(4000)
    expect(line.previousBilledAmount).toBe(1500)
    expect(line.currentBillAmount).toBe(2500)
  })

  test("percentComplete didn't move since the last bill -- currentBillAmount is 0, never negative", () => {
    const lineItems: BillableLineItem[] = [{ id: "li-1", amount: 5000, activityId: "act-1", description: "Excavation" }]
    const percentByActivity = new Map([["act-1", 40]]) // cumulative 2000, exactly what was already billed
    const previousBilled = new Map([["li-1", 2000]])

    const [line] = computeInterimBillLines(lineItems, percentByActivity, previousBilled)
    expect(line.currentBillAmount).toBe(0)
  })

  test("a data correction that LOWERS percentComplete below what was already billed floors currentBillAmount at 0, never goes negative", () => {
    const lineItems: BillableLineItem[] = [{ id: "li-1", amount: 5000, activityId: "act-1", description: "Excavation" }]
    const percentByActivity = new Map([["act-1", 20]]) // cumulative 1000, LESS than the 2000 already billed
    const previousBilled = new Map([["li-1", 2000]])

    const [line] = computeInterimBillLines(lineItems, percentByActivity, previousBilled)
    expect(line.currentBillAmount).toBe(0)
  })
})

describe("end-to-end interim bill math: bill lines -> gross -> retention -> net payable", () => {
  test("two billable line items + 10% retention", () => {
    const lineItems: BillableLineItem[] = [
      { id: "li-1", amount: 5000, activityId: "act-1", description: "Excavation" },
      { id: "li-2", amount: 3000, activityId: "act-2", description: "Foundation" },
    ]
    const lines = computeInterimBillLines(lineItems, new Map([["act-1", 40], ["act-2", 50]]), new Map())
    const gross = lines.reduce((sum, l) => sum + l.currentBillAmount, 0)
    expect(gross).toBe(3500) // 2000 + 1500

    const { retentionAmount, netPayable } = applyRetention(gross, 10)
    expect(retentionAmount).toBe(350)
    expect(netPayable).toBe(3150)
  })
})

// PR #596 audit fix (zero-tax interim bills, 2026-07-27): generateInterimBill
// used to build invoice items with no taxTemplateId and a final negative
// "Retention held" line, so every interim/RA bill posted with $0 GST and
// (once tax was wired in) retention would additionally shrink the taxable
// base. buildInterimBillInvoiceItems is the pure line-item builder that
// replaces that logic -- tested directly here, matching this file's existing
// pure-function convention.
describe("buildInterimBillInvoiceItems -- retention is a holdback, never a taxable-value-reducing invoice line", () => {
  const billableLines: InterimBillLine[] = [
    { boqLineItemId: "li-1", description: "Excavation", cumulativePercentComplete: 40, cumulativeAmount: 2000, previousBilledAmount: 0, currentBillAmount: 2000 },
    { boqLineItemId: "li-2", description: "Foundation", cumulativePercentComplete: 50, cumulativeAmount: 1500, previousBilledAmount: 0, currentBillAmount: 1500 },
  ]

  test("every billable line becomes an invoice item at its full currentBillAmount, carrying the real tax template -- no extra retention line", () => {
    const items = buildInterimBillInvoiceItems(billableLines, "tax-template-gst-18")

    expect(items).toHaveLength(billableLines.length) // no negative "Retention held" line appended
    expect(items.every((i) => i.taxTemplateId === "tax-template-gst-18")).toBe(true) // real tax, not the zero-tax default
    expect(items.every((i) => i.rate > 0)).toBe(true) // never a negative-rate line
    expect(items.reduce((sum, i) => sum + i.rate, 0)).toBe(3500) // full gross (2000 + 1500), unreduced by retention
  })
})
