/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { validateClassifications, validatePeriodicity, REPORT_CATEGORY_VALUES } from "./report-taxonomy"

describe("REPORT_CATEGORY_VALUES", () => {
  test("has exactly the 7 categories the Owner specified (6 named + external_ingested for #7)", () => {
    expect(REPORT_CATEGORY_VALUES).toHaveLength(7)
    expect(REPORT_CATEGORY_VALUES).toContain("software_report")
    expect(REPORT_CATEGORY_VALUES).toContain("ai_new_report_promoted")
    expect(REPORT_CATEGORY_VALUES).toContain("ai_new_analysis_promoted")
    expect(REPORT_CATEGORY_VALUES).toContain("external_ingested")
  })
})

describe("validateClassifications", () => {
  test("accepts a non-empty string array", () => {
    expect(validateClassifications(["executive", "financial"])).toEqual({ valid: true, classifications: ["executive", "financial"] })
  })

  test("rejects an empty array", () => {
    expect(validateClassifications([]).valid).toBe(false)
  })

  test("rejects a non-array", () => {
    expect(validateClassifications("executive").valid).toBe(false)
  })

  test("rejects an array of only blank strings", () => {
    expect(validateClassifications(["  ", ""]).valid).toBe(false)
  })

  test("trims and filters blank entries, keeping real ones", () => {
    const result = validateClassifications([" sales ", "", "revenue"])
    expect(result.valid).toBe(true)
    if (result.valid) expect(result.classifications).toEqual(["sales", "revenue"])
  })
})

describe("validatePeriodicity", () => {
  test("accepts 'daily' with no config", () => {
    expect(validatePeriodicity("daily", undefined)).toEqual({ valid: true })
  })

  test("accepts 'hourly' with no config", () => {
    expect(validatePeriodicity("hourly", undefined)).toEqual({ valid: true })
  })

  test("rejects an unknown base value", () => {
    expect(validatePeriodicity("sometimes", undefined).valid).toBe(false)
  })

  test("requires dayOfWeek for weekly/biweekly/fortnightly", () => {
    expect(validatePeriodicity("weekly", undefined).valid).toBe(false)
    expect(validatePeriodicity("weekly", { dayOfWeek: 3 }).valid).toBe(true)
    expect(validatePeriodicity("biweekly", { dayOfWeek: 9 }).valid).toBe(false) // out of 0-6 range
  })

  test("requires dayOfMonth for monthly-family cadences", () => {
    for (const base of ["monthly", "bimonthly", "quarterly", "half_yearly", "yearly", "biyearly"]) {
      expect(validatePeriodicity(base, undefined).valid).toBe(false)
      expect(validatePeriodicity(base, { dayOfMonth: 15 }).valid).toBe(true)
    }
  })

  test("requires startDate and endDate for custom_range", () => {
    expect(validatePeriodicity("custom_range", undefined).valid).toBe(false)
    expect(validatePeriodicity("custom_range", { startDate: "2026-01-01" }).valid).toBe(false)
    expect(validatePeriodicity("custom_range", { startDate: "2026-01-01", endDate: "2026-01-31" }).valid).toBe(true)
  })

  test("year_to_date/immediate/on_demand need no config", () => {
    expect(validatePeriodicity("year_to_date", undefined).valid).toBe(true)
    expect(validatePeriodicity("immediate", undefined).valid).toBe(true)
    expect(validatePeriodicity("on_demand", undefined).valid).toBe(true)
  })
})
