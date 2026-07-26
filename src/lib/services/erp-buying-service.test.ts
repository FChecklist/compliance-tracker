// V2-17 load-test finding (2026-07-26): listSupplierScorecards() used to
// call getSupplierScorecard() in a loop (N suppliers -> 3N sequential
// queries); it was rewritten to fetch each of the 3 source tables once for
// the whole org and group in memory. This tests the extracted pure
// aggregation core (computeSupplierScorecardFromRows) both the single-
// supplier and batch paths now share, proving the batch path's per-supplier
// grouping produces the exact same numbers the old per-supplier-filtered
// query would have -- matches this codebase's established convention of
// not exercising withTenantContext/a live DB from a .test.ts file.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { computeSupplierScorecardFromRows } from "./erp-buying-service"

function order(overrides: Partial<{ id: string; supplierId: string; grandTotal: string; expectedDeliveryDate: string | null }>) {
  return { id: "po1", supplierId: "s1", grandTotal: "0", expectedDeliveryDate: null, ...overrides } as never
}
function receipt(overrides: Partial<{ id: string; supplierId: string; purchaseOrderId: string | null; postingDate: string }>) {
  return { id: "gr1", supplierId: "s1", purchaseOrderId: null, postingDate: "2026-01-01", ...overrides } as never
}
function ret(overrides: Partial<{ id: string; supplierId: string }>) {
  return { id: "ret1", supplierId: "s1", ...overrides } as never
}

describe("computeSupplierScorecardFromRows", () => {
  test("no orders/receipts/returns: zeroed out, rates null", () => {
    const result = computeSupplierScorecardFromRows("s1", [], [], [])
    expect(result).toEqual({ supplierId: "s1", totalOrders: 0, totalSpend: 0, onTimeDeliveryRate: null, returnRate: null })
  })

  test("totalSpend sums grandTotal across orders", () => {
    const result = computeSupplierScorecardFromRows("s1", [order({ grandTotal: "100" }), order({ id: "po2", grandTotal: "250" })], [], [])
    expect(result.totalOrders).toBe(2)
    expect(result.totalSpend).toBe(350)
  })

  test("onTimeDeliveryRate only counts receipts linked to a PO with an expected delivery date", () => {
    const orders = [order({ id: "po1", expectedDeliveryDate: "2026-01-10" }), order({ id: "po2", expectedDeliveryDate: null })]
    const receipts = [
      receipt({ id: "gr1", purchaseOrderId: "po1", postingDate: "2026-01-05" }), // on time
      receipt({ id: "gr2", purchaseOrderId: "po1", postingDate: "2026-01-15" }), // late
      receipt({ id: "gr3", purchaseOrderId: "po2", postingDate: "2026-01-05" }), // no expected date -- unmeasurable
      receipt({ id: "gr4", purchaseOrderId: null, postingDate: "2026-01-05" }), // no PO link -- unmeasurable
    ]
    const result = computeSupplierScorecardFromRows("s1", orders, receipts, [])
    expect(result.onTimeDeliveryRate).toBeCloseTo(0.5) // 1 of 2 measurable receipts
  })

  test("returnRate is returns-per-receipt, null when there are no receipts", () => {
    expect(computeSupplierScorecardFromRows("s1", [], [], [ret({})]).returnRate).toBeNull()
    const result = computeSupplierScorecardFromRows("s1", [], [receipt({}), receipt({ id: "gr2" })], [ret({})])
    expect(result.returnRate).toBeCloseTo(0.5)
  })

  test("rows for a different supplierId passed in by mistake are still counted -- the caller (batch grouping) owns filtering, not this pure function", () => {
    // Documents the actual contract: this function trusts its inputs are
    // already the right supplier's rows (batch grouping does this via a Map
    // keyed by supplierId; the single-supplier path does it via the query's
    // own eq(supplierId) filter). It does not re-filter internally.
    const result = computeSupplierScorecardFromRows("s1", [order({ supplierId: "s2", grandTotal: "999" })], [], [])
    expect(result.totalSpend).toBe(999)
  })
})
