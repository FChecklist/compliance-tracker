// Task #46 CRM import/export -- matching this repo's established pattern of
// not touching a live DB from a .test.ts file (see
// crm-accounts-service.test.ts's own header, approval-workflow-service.test.ts's
// note on the same convention). validateLeadRow/validateOpportunityRow/
// validateAccountRow/validateContactRow are the pure row-format validators
// that decide what a "successful import batch" row and a "validation
// failure" row actually are -- unit-tested directly here, no DB.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  validateLeadRow, validateOpportunityRow, validateAccountRow, validateContactRow,
  isCrmImportEntity, CRM_IMPORT_ENTITIES,
} from "./crm-import-export-service"

describe("isCrmImportEntity / CRM_IMPORT_ENTITIES", () => {
  test("accepts every real CRM import entity", () => {
    for (const entity of CRM_IMPORT_ENTITIES) expect(isCrmImportEntity(entity)).toBe(true)
  })
  test("rejects an unrelated string", () => {
    expect(isCrmImportEntity("compliance_item")).toBe(false)
  })
})

describe("validateLeadRow -- successful rows", () => {
  test("accepts a minimal row with just a name", () => {
    const result = validateLeadRow({ name: "Acme Corp" })
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.values).toEqual({ name: "Acme Corp", contactEmail: null, contactPhone: null, source: null, status: "new" })
    }
  })

  test("accepts a fully populated row and normalizes status casing", () => {
    const result = validateLeadRow({ name: "Beta LLC", email: "sales@beta.com", phone: "+91 98765 43210", source: "referral", status: "QUALIFIED" })
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.values).toEqual({ name: "Beta LLC", contactEmail: "sales@beta.com", contactPhone: "+91 98765 43210", source: "referral", status: "qualified" })
    }
  })

  test("is case-insensitive and whitespace-tolerant on header names", () => {
    const result = validateLeadRow({ " Name ": "Gamma Inc", " Email ": "x@gamma.com" })
    expect(result.valid).toBe(true)
    if (result.valid) expect(result.values.name).toBe("Gamma Inc")
  })
})

describe("validateLeadRow -- real validation failures", () => {
  test("rejects a row with no name", () => {
    const result = validateLeadRow({ email: "no-name@example.com" })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.error).toBe("name is required")
  })

  test("rejects a malformed email", () => {
    const result = validateLeadRow({ name: "Delta Co", email: "not-an-email" })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.error).toContain("not a valid email address")
  })

  test("rejects a malformed phone number", () => {
    const result = validateLeadRow({ name: "Epsilon Co", phone: "123" })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.error).toContain("not a valid phone number")
  })

  test("rejects a status outside the real crm_leads.status set", () => {
    const result = validateLeadRow({ name: "Zeta Co", status: "interested" })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.error).toContain("not a valid lead status")
  })
})

describe("validateOpportunityRow", () => {
  test("accepts a minimal row and defaults stage to prospecting", () => {
    const result = validateOpportunityRow({ name: "New Deal" })
    expect(result.valid).toBe(true)
    if (result.valid) expect(result.values.stage).toBe("prospecting")
  })
  test("rejects a stage outside the real crm_opportunities.stage set", () => {
    const result = validateOpportunityRow({ name: "New Deal", stage: "closed-won" })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.error).toContain("not a valid stage")
  })
  test("rejects a non-numeric estimatedValue", () => {
    const result = validateOpportunityRow({ name: "New Deal", estimatedValue: "lots" })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.error).toContain("not a valid number")
  })
  test("rejects an unparseable expectedCloseDate", () => {
    const result = validateOpportunityRow({ name: "New Deal", expectedCloseDate: "next Tuesday-ish" })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.error).toContain("not a valid date")
  })
})

describe("validateAccountRow", () => {
  test("accepts a minimal row and defaults lifecycleStage to prospect", () => {
    const result = validateAccountRow({ name: "Acme Corp" })
    expect(result.valid).toBe(true)
    if (result.valid) expect(result.values.lifecycleStage).toBe("prospect")
  })
  test("rejects a lifecycleStage outside the real crm_account_lifecycle_stage enum", () => {
    const result = validateAccountRow({ name: "Acme Corp", lifecycleStage: "vip" })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.error).toContain("not a valid lifecycle stage")
  })
  test("rejects a row with no name", () => {
    const result = validateAccountRow({ industry: "Retail" })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.error).toBe("name is required")
  })
})

describe("validateContactRow", () => {
  test("accepts a row with an accountName reference", () => {
    const result = validateContactRow({ name: "Jane Doe", accountName: "Acme Corp", email: "jane@acme.com" })
    expect(result.valid).toBe(true)
    if (result.valid) expect(result.values.accountRef).toBe("Acme Corp")
  })
  test("rejects a row with no account reference -- crm_contacts.accountId is NOT NULL", () => {
    const result = validateContactRow({ name: "Jane Doe" })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.error).toContain("accountId or accountName is required")
  })
  test("rejects a malformed email", () => {
    const result = validateContactRow({ name: "Jane Doe", accountName: "Acme Corp", email: "nope" })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.error).toContain("not a valid email address")
  })
})
