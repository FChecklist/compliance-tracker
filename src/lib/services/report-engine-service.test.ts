/// <reference types="bun-types" />
// Tests the pure validation/domain-derivation functions only --
// createReportDefinition()/executeReportDefinition()/runAggregation() all
// touch the DB and are deliberately left untested here, matching this
// repo's established pattern (see delegation-service.test.ts's own note).
import { describe, expect, test } from "bun:test"
import { validateReportDefinitionInput, deriveReportDomainFromClassifications, type CreateReportDefinitionInput } from "./report-engine-service"

const BASE: CreateReportDefinitionInput = {
  name: "Test Report",
  description: "A test report definition",
  category: "software_report",
  classifications: ["project"],
  executionType: "deterministic_aggregation",
  executionConfig: { kind: "aggregation", tableKey: "compliance_items", aggregation: "count" },
}

describe("validateReportDefinitionInput", () => {
  test("accepts a well-formed built definition", () => {
    expect(validateReportDefinitionInput(BASE)).toEqual({ valid: true })
  })

  test("rejects an empty name", () => {
    expect(validateReportDefinitionInput({ ...BASE, name: "  " }).valid).toBe(false)
  })

  test("rejects an empty description", () => {
    expect(validateReportDefinitionInput({ ...BASE, description: "" }).valid).toBe(false)
  })

  test("rejects an invalid category", () => {
    // @ts-expect-error deliberately invalid for the test
    expect(validateReportDefinitionInput({ ...BASE, category: "not_a_real_category" }).valid).toBe(false)
  })

  test("rejects an empty classifications array", () => {
    expect(validateReportDefinitionInput({ ...BASE, classifications: [] }).valid).toBe(false)
  })

  test("rejects an invalid executionType", () => {
    // @ts-expect-error deliberately invalid for the test
    expect(validateReportDefinitionInput({ ...BASE, executionType: "magic" }).valid).toBe(false)
  })

  test("requires dataGapNote when status is not 'built'", () => {
    expect(validateReportDefinitionInput({ ...BASE, status: "data_gap" }).valid).toBe(false)
    expect(validateReportDefinitionInput({ ...BASE, status: "data_gap", dataGapNote: "missing table X" }).valid).toBe(true)
  })

  test("validates periodicity shape when periodicity is set", () => {
    expect(validateReportDefinitionInput({ ...BASE, periodicity: "weekly" }).valid).toBe(false) // missing dayOfWeek
    expect(validateReportDefinitionInput({ ...BASE, periodicity: "weekly", periodicityConfig: { dayOfWeek: 1 } }).valid).toBe(true)
  })
})

// Priority 12 (OPEN-07 point 8 follow-on): report_definitions rows have no
// literal `domain` column -- executeReportDefinition()'s branch-enablement
// gate and getFullReportCatalog()'s merge both resolve domain through this
// one function, so its branching is worth locking down directly.
describe("deriveReportDomainFromClassifications", () => {
  test("compliance takes priority when present", () => {
    expect(deriveReportDomainFromClassifications(["compliance", "financial"])).toBe("compliance")
  })

  test("financial or revenue (without compliance) maps to ERP", () => {
    expect(deriveReportDomainFromClassifications(["financial"])).toBe("ERP")
    expect(deriveReportDomainFromClassifications(["revenue"])).toBe("ERP")
  })

  test("construction or project (without compliance/financial/revenue) maps to construction", () => {
    expect(deriveReportDomainFromClassifications(["construction"])).toBe("construction")
    expect(deriveReportDomainFromClassifications(["project"])).toBe("construction")
  })

  test("anything else falls through to custom", () => {
    expect(deriveReportDomainFromClassifications(["sales"])).toBe("custom")
    expect(deriveReportDomainFromClassifications([])).toBe("custom")
  })
})
