// VERIDIAN Review Framework Wave B (2026-07-17): tests the pure predicates
// crm-accounts-service.ts exports -- wouldCreateCycle() (parent-account
// hierarchy integrity) and resolveAccountShippingAddress() (the "same as
// billing" convenience) -- rather than exercising the withTenantContext/
// live-DB-backed CRUD functions, matching this repo's established pattern
// of not touching a live DB from a .test.ts file (see
// approval-workflow-service.test.ts's own note on this).
//
// VERIDIAN Review Framework Wave 4 (2026-07-17): added coverage for this
// same wave's business-rule + RBAC additions -- canEditAccount/
// canReassignOrDeleteAccount/canCreateCrmRecord (access control) and
// extractDomain/findDuplicateAccountMatches/validateContactFormat
// (business-rule validation). Same pure/no-DB pattern as above.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  wouldCreateCycle, resolveAccountShippingAddress,
  canEditAccount, canReassignOrDeleteAccount, canCreateCrmRecord,
  extractDomain, findDuplicateAccountMatches, validateContactFormat,
} from "./crm-accounts-service"

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

describe("canEditAccount -- owner-or-manager RBAC gate", () => {
  test("denies a viewer regardless of ownership", () => {
    expect(canEditAccount("viewer", null, "u1").ok).toBe(false)
  })

  test("allows a member who owns the account", () => {
    expect(canEditAccount("member", "u1", "u1").ok).toBe(true)
  })

  test("denies a member who does NOT own the account", () => {
    const result = canEditAccount("member", "u2", "u1")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/owner or a manager/)
  })

  test("allows a member on an unowned (ownerId null) account", () => {
    expect(canEditAccount("member", null, "u1").ok).toBe(true)
  })

  test("allows a manager to edit any account regardless of owner", () => {
    expect(canEditAccount("manager", "someone-else", "u1").ok).toBe(true)
  })

  test("allows senior_professional (same rank as manager) to edit any account", () => {
    expect(canEditAccount("senior_professional", "someone-else", "u1").ok).toBe(true)
  })

  test("allows veridian_admin (highest rank) to edit any account", () => {
    expect(canEditAccount("veridian_admin", "someone-else", "u1").ok).toBe(true)
  })

  test("denies an unrecognized/empty role (rank 0)", () => {
    expect(canEditAccount("", "u1", "u1").ok).toBe(false)
  })
})

describe("canReassignOrDeleteAccount -- manager-rank-only RBAC gate", () => {
  test("denies a member", () => {
    expect(canReassignOrDeleteAccount("member").ok).toBe(false)
  })

  test("denies a viewer", () => {
    expect(canReassignOrDeleteAccount("viewer").ok).toBe(false)
  })

  test("allows a manager", () => {
    expect(canReassignOrDeleteAccount("manager").ok).toBe(true)
  })

  test("allows branch_manager (rank above manager)", () => {
    expect(canReassignOrDeleteAccount("branch_manager").ok).toBe(true)
  })

  test("allows admin", () => {
    expect(canReassignOrDeleteAccount("admin").ok).toBe(true)
  })
})

describe("canCreateCrmRecord -- member-rank-or-above gate for new accounts/contacts", () => {
  test("denies a viewer", () => {
    expect(canCreateCrmRecord("viewer").ok).toBe(false)
  })

  test("allows a member", () => {
    expect(canCreateCrmRecord("member").ok).toBe(true)
  })

  test("allows a manager", () => {
    expect(canCreateCrmRecord("manager").ok).toBe(true)
  })
})

describe("extractDomain -- website normalization for duplicate matching", () => {
  test("strips https:// and www.", () => {
    expect(extractDomain("https://www.Acme.com/contact")).toBe("acme.com")
  })

  test("strips http:// with no www", () => {
    expect(extractDomain("http://acme.com")).toBe("acme.com")
  })

  test("handles a bare domain with no protocol", () => {
    expect(extractDomain("acme.com")).toBe("acme.com")
  })

  test("strips query strings and paths", () => {
    expect(extractDomain("https://acme.com/about?ref=x")).toBe("acme.com")
  })

  test("returns null for blank/missing website", () => {
    expect(extractDomain("")).toBe(null)
    expect(extractDomain(null)).toBe(null)
    expect(extractDomain(undefined)).toBe(null)
  })
})

describe("findDuplicateAccountMatches -- duplicate-account detection", () => {
  const candidates = [
    { id: "a1", name: "Acme Corp", website: "https://acme.com" },
    { id: "a2", name: "Beta Industries", website: null },
    { id: "a3", name: "  acme corp  ", website: null }, // whitespace/casing variant of a1's name
  ]

  test("matches on case/whitespace-insensitive exact name", () => {
    const matches = findDuplicateAccountMatches(candidates, "ACME CORP", null)
    expect(matches.map((m) => m.id).sort()).toEqual(["a1", "a3"])
  })

  test("matches on website domain even when the name differs", () => {
    const matches = findDuplicateAccountMatches(candidates, "Acme Corporation Ltd", "www.acme.com")
    expect(matches.map((m) => m.id)).toEqual(["a1"])
  })

  test("returns empty when neither name nor domain matches", () => {
    expect(findDuplicateAccountMatches(candidates, "Gamma LLC", "gamma.com")).toEqual([])
  })

  test("excludes the record being updated (excludeAccountId) from its own duplicate check", () => {
    const matches = findDuplicateAccountMatches(candidates, "Acme Corp", null, "a1")
    expect(matches.map((m) => m.id)).toEqual(["a3"])
  })

  test("a blank website never matches another blank website", () => {
    const matches = findDuplicateAccountMatches(candidates, "Totally Different Name", null)
    expect(matches).toEqual([])
  })
})

describe("validateContactFormat -- email/phone format validation beyond DB NOT NULL", () => {
  test("allows a valid email + valid Indian phone number", () => {
    expect(() => validateContactFormat({ email: "jane@acme.com", phone: "9876543210" })).not.toThrow()
  })

  test("allows blank/absent email and phone (both optional)", () => {
    expect(() => validateContactFormat({})).not.toThrow()
    expect(() => validateContactFormat({ email: "", phone: "" })).not.toThrow()
  })

  test("rejects a malformed email", () => {
    expect(() => validateContactFormat({ email: "not-an-email" })).toThrow(/valid email/)
  })

  test("rejects a malformed phone number", () => {
    expect(() => validateContactFormat({ phone: "123" })).toThrow(/valid phone/)
  })
})
