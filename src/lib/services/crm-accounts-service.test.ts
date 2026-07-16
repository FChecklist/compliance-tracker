// VERIDIAN Review Framework Wave B (2026-07-17): tests the pure predicates
// crm-accounts-service.ts exports -- wouldCreateCycle() (parent-account
// hierarchy integrity) and resolveAccountShippingAddress() (the "same as
// billing" convenience) -- rather than exercising the withTenantContext/
// live-DB-backed CRUD functions, matching this repo's established pattern
// of not touching a live DB from a .test.ts file (see
// approval-workflow-service.test.ts's own note on this).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { wouldCreateCycle, resolveAccountShippingAddress } from "./crm-accounts-service"

describe("wouldCreateCycle -- crm_accounts parent-account hierarchy integrity", () => {
  const accounts = [
    { id: "a1", parentAccountId: null },
    { id: "a2", parentAccountId: "a1" },
    { id: "a3", parentAccountId: "a2" },
    { id: "a4", parentAccountId: null },
  ]

  test("allows attaching a brand-new top-level account as a child", () => {
    expect(wouldCreateCycle(accounts, "a4", "a1")).toBe(false)
  })

  test("allows re-parenting to null (detaching from hierarchy)", () => {
    expect(wouldCreateCycle(accounts, "a2", null)).toBe(false)
  })

  test("rejects an account becoming its own direct parent", () => {
    expect(wouldCreateCycle(accounts, "a1", "a1")).toBe(true)
  })

  test("rejects an account becoming its own grandchild's parent (transitive cycle)", () => {
    // a1 -> a2 -> a3 already exists; setting a1's parent to a3 would close the loop.
    expect(wouldCreateCycle(accounts, "a1", "a3")).toBe(true)
  })

  test("rejects a direct child becoming its own parent's parent", () => {
    // a2's parent is a1; setting a1's parent to a2 would create a 2-node cycle.
    expect(wouldCreateCycle(accounts, "a1", "a2")).toBe(true)
  })

  test("allows a legitimate unrelated re-parent", () => {
    expect(wouldCreateCycle(accounts, "a4", "a3")).toBe(false)
  })
})

describe("resolveAccountShippingAddress -- 'same as billing' convenience", () => {
  const base = {
    billingLine1: "221B Baker Street", billingLine2: null, billingCity: "Mumbai",
    billingState: "MH", billingPostalCode: "400001", billingCountry: "India",
    shippingLine1: "Warehouse 4", shippingLine2: null, shippingCity: "Pune",
    shippingState: "MH", shippingPostalCode: "411001", shippingCountry: "India",
  }

  test("mirrors the billing address when shippingSameAsBilling is true", () => {
    const result = resolveAccountShippingAddress({ ...base, shippingSameAsBilling: true })
    expect(result.line1).toBe("221B Baker Street")
    expect(result.city).toBe("Mumbai")
    expect(result.postalCode).toBe("400001")
  })

  test("uses the account's own shipping fields when shippingSameAsBilling is false", () => {
    const result = resolveAccountShippingAddress({ ...base, shippingSameAsBilling: false })
    expect(result.line1).toBe("Warehouse 4")
    expect(result.city).toBe("Pune")
    expect(result.postalCode).toBe("411001")
  })
})
