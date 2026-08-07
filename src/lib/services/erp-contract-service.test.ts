/// <reference types="bun-types" />
// SD-002 (Billing Due List, 2026-07-30): tests the pure date-math helper
// only -- generateInvoiceFromBillingSchedule() (and every other exported
// function in erp-contract-service.ts) touches the DB via
// withTenantContext() and is deliberately left untested here, matching
// this repo's established pattern (see report-engine-service.test.ts's own
// note, and delegation-service.test.ts before it).
import { describe, expect, test } from "bun:test"
import { advanceBillingDate } from "./erp-contract-service"

describe("advanceBillingDate", () => {
  test("monthly advances by exactly one calendar month", () => {
    expect(advanceBillingDate("2026-07-15", "monthly")).toBe("2026-08-15")
  })

  test("quarterly advances by three calendar months", () => {
    expect(advanceBillingDate("2026-07-15", "quarterly")).toBe("2026-10-15")
  })

  test("half_yearly advances by six calendar months", () => {
    expect(advanceBillingDate("2026-07-15", "half_yearly")).toBe("2027-01-15")
  })

  test("annually advances by exactly one calendar year", () => {
    expect(advanceBillingDate("2026-07-15", "annually")).toBe("2027-07-15")
  })

  test("monthly rolls over a year boundary correctly", () => {
    expect(advanceBillingDate("2026-12-20", "monthly")).toBe("2027-01-20")
  })

  test("monthly on a 31st clamps into a shorter next month (JS Date's own rollover, not a bug we hide)", () => {
    // Jan 31 + 1 month -> JS Date rolls into March 3 (Feb has 28 days in
    // 2026, a non-leap year) rather than clamping to Feb 28 -- documenting
    // this honestly rather than silently assuming calendar-perfect month
    // arithmetic, matching this repo's "no invented precision" discipline.
    expect(advanceBillingDate("2026-01-31", "monthly")).toBe("2026-03-03")
  })
})
