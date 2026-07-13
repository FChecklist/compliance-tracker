/// <reference types="bun-types" />
// Tests the pure validation function only -- createReportDefinition()/
// executeReportDefinition()/runAggregation() all touch the DB and are
// deliberately left untested here, matching this repo's established
// pattern (see delegation-service.test.ts's own note).
import { describe, expect, test } from "bun:test"
import { validateReportDefinitionInput, type CreateReportDefinitionInput } from "./report-engine-service"

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
