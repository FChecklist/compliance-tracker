/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { isValidReportName, runReportPayload } from "./report-run-dispatch"

describe("report-run-dispatch", () => {
  test("knows the registry's report names and nothing else", () => {
    expect(isValidReportName("manpower-cost")).toBe(true)
    expect(isValidReportName("trial-balance")).toBe(false)
  })

  test("the week-based reports refuse a missing weekStart before touching the database", async () => {
    await expect(runReportPayload("org-1", "weekly-project", new URLSearchParams(), "p1")).rejects.toThrow("weekStart query param is required for the weekly-project report")
    await expect(runReportPayload("org-1", "certified-payroll", new URLSearchParams(), "p1")).rejects.toThrow("weekStart query param is required for the certified-payroll report")
  })
})
