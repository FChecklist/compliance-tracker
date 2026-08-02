// Tests the pure buildInvoiceLinesFromTimeEntries() directly -- matches
// this repo's established pattern of not touching withTenantContext/a live
// DB from a .test.ts file (see erp-payment-entries-service.test.ts's
// header). This is the function generateInvoiceFromUnbilledProjectTime()
// delegates to for turning unbilled pms_time_entries rows into real
// erp_sales_invoice_items amounts.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { buildInvoiceLinesFromTimeEntries, ServiceError } from "./pms-invoice-service"

const issuesById = new Map([
  ["issue_1", { id: "issue_1", number: 101, title: "Fix the roof" }],
  ["issue_2", { id: "issue_2", number: 102, title: "Pour foundation" }],
])

describe("buildInvoiceLinesFromTimeEntries", () => {
  test("computes amount = hours x resolved rate per entry", () => {
    const entries = [
      { id: "e1", issueId: "issue_1", userId: "user_1", hours: "5", spentOn: "2026-07-01", comments: null },
      { id: "e2", issueId: "issue_2", userId: "user_1", hours: "2.5", spentOn: "2026-07-02", comments: "site visit" },
    ]
    const rates = [{ userId: "user_1", hourlyRate: "100", validFrom: "2026-01-01" }]

    const lines = buildInvoiceLinesFromTimeEntries(entries, rates, issuesById)

    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ entryId: "e1", hours: 5, rate: 100, amount: 500 })
    expect(lines[0].description).toBe("#101 Fix the roof")
    expect(lines[1]).toMatchObject({ entryId: "e2", hours: 2.5, rate: 100, amount: 250 })
    expect(lines[1].description).toBe("#102 Pour foundation -- site visit")
  })

  test("rounds amount to 2 decimal places", () => {
    const entries = [{ id: "e1", issueId: "issue_1", userId: "user_1", hours: "1.333", spentOn: "2026-07-01", comments: null }]
    const rates = [{ userId: "user_1", hourlyRate: "33.33", validFrom: "2026-01-01" }]
    const lines = buildInvoiceLinesFromTimeEntries(entries, rates, issuesById)
    expect(lines[0].amount).toBe(Math.round(1.333 * 33.33 * 100) / 100)
  })

  test("falls back to the org-default rate when no per-user rate exists", () => {
    const entries = [{ id: "e1", issueId: "issue_1", userId: "user_9", hours: "4", spentOn: "2026-07-01", comments: null }]
    const rates = [{ userId: null, hourlyRate: "60", validFrom: "2026-01-01" }]
    const lines = buildInvoiceLinesFromTimeEntries(entries, rates, issuesById)
    expect(lines[0]).toMatchObject({ rate: 60, amount: 240 })
  })

  test("throws a ServiceError instead of silently billing at 0 when no rate applies", () => {
    const entries = [{ id: "e1", issueId: "issue_1", userId: "user_1", hours: "4", spentOn: "2026-07-01", comments: null }]
    expect(() => buildInvoiceLinesFromTimeEntries(entries, [], issuesById)).toThrow(ServiceError)
  })

  test("falls back to the raw issueId in the description when the issue is missing from the map", () => {
    const entries = [{ id: "e1", issueId: "issue_missing", userId: "user_1", hours: "1", spentOn: "2026-07-01", comments: null }]
    const rates = [{ userId: "user_1", hourlyRate: "10", validFrom: "2026-01-01" }]
    const lines = buildInvoiceLinesFromTimeEntries(entries, rates, issuesById)
    expect(lines[0].description).toBe("issue_missing")
  })
})
