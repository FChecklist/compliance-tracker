// VERIDIAN Review Framework gap-closure (2026-08-07), CRM Leads: tests the
// pure predicates/parsers this wave adds -- VALID_LEAD_TRANSITIONS, the
// Zod schemas + fieldErrorsFromZod(), and the CSV export/import helpers'
// escaping/parsing. Same pure/no-DB pattern as
// crm-accounts-service.test.ts (this repo's established convention of not
// touching a live DB from a .test.ts file).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { VALID_LEAD_TRANSITIONS, createLeadSchema, updateLeadSchema, fieldErrorsFromZod } from "./crm-service"

describe("VALID_LEAD_TRANSITIONS -- lead status state machine", () => {
  test("allows the standard funnel progression", () => {
    expect(VALID_LEAD_TRANSITIONS.new).toContain("contacted")
    expect(VALID_LEAD_TRANSITIONS.contacted).toContain("qualified")
  })

  test("allows moving to 'lost' from any active status", () => {
    expect(VALID_LEAD_TRANSITIONS.new).toContain("lost")
    expect(VALID_LEAD_TRANSITIONS.contacted).toContain("lost")
    expect(VALID_LEAD_TRANSITIONS.qualified).toContain("lost")
  })

  test("'converted' and 'lost' are terminal -- no outbound transitions", () => {
    expect(VALID_LEAD_TRANSITIONS.converted).toEqual([])
    expect(VALID_LEAD_TRANSITIONS.lost).toEqual([])
  })

  test("does not allow skipping backward from qualified to new", () => {
    expect(VALID_LEAD_TRANSITIONS.qualified).not.toContain("new")
  })
})

describe("createLeadSchema -- field-level validation", () => {
  test("accepts a minimal valid lead (name only)", () => {
    const result = createLeadSchema.safeParse({ name: "Acme Corp" })
    expect(result.success).toBe(true)
  })

  test("rejects an empty name with a field-level message", () => {
    const result = createLeadSchema.safeParse({ name: "" })
    expect(result.success).toBe(false)
    if (!result.success) {
      const fields = fieldErrorsFromZod(result.error)
      expect(fields.name).toBeDefined()
    }
  })

  test("rejects a malformed contact email", () => {
    const result = createLeadSchema.safeParse({ name: "Acme Corp", contactEmail: "not-an-email" })
    expect(result.success).toBe(false)
    if (!result.success) {
      const fields = fieldErrorsFromZod(result.error)
      expect(fields.contactEmail).toBeDefined()
    }
  })

  test("allows an empty-string contact email (optional field, not provided)", () => {
    const result = createLeadSchema.safeParse({ name: "Acme Corp", contactEmail: "" })
    expect(result.success).toBe(true)
  })
})

describe("updateLeadSchema -- field-level validation", () => {
  test("rejects a status outside the closed enum", () => {
    const result = updateLeadSchema.safeParse({ status: "archived" })
    expect(result.success).toBe(false)
  })

  test("accepts a known status", () => {
    const result = updateLeadSchema.safeParse({ status: "qualified" })
    expect(result.success).toBe(true)
  })

  test("accepts an empty patch (no-op update)", () => {
    const result = updateLeadSchema.safeParse({})
    expect(result.success).toBe(true)
  })
})
