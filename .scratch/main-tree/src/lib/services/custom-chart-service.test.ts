// Priority 13 (Self-Serve Ad-Hoc BI / Chart-Builder). Tests the pure
// validation function only -- listCustomCharts()/createCustomChart()/
// runCustomChart() all touch the DB and are deliberately left untested
// here, matching this repo's established pattern (see report-engine-
// service.test.ts's own note).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { validateCustomChartInput, getTableRegistryMetadata, type CreateCustomChartInput } from "./custom-chart-service"

function validInput(overrides: Partial<CreateCustomChartInput> = {}): CreateCustomChartInput {
  return {
    name: "Compliance Items by Status",
    chartType: "bar",
    aggregationConfig: { kind: "aggregation", tableKey: "compliance_items", groupByColumn: "status", aggregation: "count" },
    ...overrides,
  }
}

describe("validateCustomChartInput -- reuses report-engine-service.ts's TABLE_REGISTRY as the only whitelist", () => {
  test("accepts a well-formed count chart", () => {
    expect(validateCustomChartInput(validInput())).toEqual({ valid: true })
  })

  test("rejects a blank name", () => {
    expect(validateCustomChartInput(validInput({ name: "  " })).valid).toBe(false)
  })

  test("rejects an invalid chartType", () => {
    // @ts-expect-error deliberately invalid for the test
    expect(validateCustomChartInput(validInput({ chartType: "scatter" })).valid).toBe(false)
  })

  test("rejects a config that isn't kind:'aggregation'", () => {
    // @ts-expect-error deliberately invalid for the test
    expect(validateCustomChartInput(validInput({ aggregationConfig: { kind: "formula", formulaKey: "x" } })).valid).toBe(false)
  })

  test("rejects an unknown tableKey -- never resolves to an arbitrary table", () => {
    const result = validateCustomChartInput(validInput({ aggregationConfig: { kind: "aggregation", tableKey: "not_a_real_table", aggregation: "count" } }))
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("Unknown dataset")
  })

  test("rejects a groupByColumn that isn't whitelisted for the chosen table", () => {
    const result = validateCustomChartInput(validInput({ aggregationConfig: { kind: "aggregation", tableKey: "compliance_items", groupByColumn: "not_a_real_column", aggregation: "count" } }))
    expect(result.valid).toBe(false)
  })

  test("requires aggregationColumnKey when aggregation is 'sum'", () => {
    const result = validateCustomChartInput(validInput({ aggregationConfig: { kind: "aggregation", tableKey: "erp_sales_invoices", groupByColumn: "status", aggregation: "sum" } }))
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("aggregationColumnKey")
  })

  test("accepts a sum aggregation with a whitelisted aggregationColumnKey", () => {
    expect(validateCustomChartInput(validInput({
      aggregationConfig: { kind: "aggregation", tableKey: "erp_sales_invoices", groupByColumn: "status", aggregation: "sum", aggregationColumnKey: "grandTotal" },
    }))).toEqual({ valid: true })
  })

  test("rejects an aggregationColumnKey that isn't whitelisted for the chosen table", () => {
    const result = validateCustomChartInput(validInput({
      aggregationConfig: { kind: "aggregation", tableKey: "erp_sales_invoices", aggregation: "sum", aggregationColumnKey: "not_a_real_column" },
    }))
    expect(result.valid).toBe(false)
  })

  test("rejects a filterEquals columnKey that isn't whitelisted", () => {
    const result = validateCustomChartInput(validInput({
      aggregationConfig: { kind: "aggregation", tableKey: "compliance_items", aggregation: "count", filterEquals: { columnKey: "not_real", value: "x" } },
    }))
    expect(result.valid).toBe(false)
  })

  test("accepts an avg aggregation with a whitelisted column", () => {
    expect(validateCustomChartInput(validInput({
      aggregationConfig: { kind: "aggregation", tableKey: "risks", groupByColumn: "category", aggregation: "avg", aggregationColumnKey: "impact" },
    }))).toEqual({ valid: true })
  })
})

describe("getTableRegistryMetadata -- safe, string-only view of TABLE_REGISTRY for the client", () => {
  test("includes known dataset keys with their column keys", () => {
    const meta = getTableRegistryMetadata()
    expect(meta.compliance_items).toBeDefined()
    expect(meta.compliance_items.columns).toContain("status")
    expect(meta.compliance_items.columns).toContain("priority")
  })

  test("never leaks a Drizzle table/column object -- every value is plain strings", () => {
    const meta = getTableRegistryMetadata()
    for (const entry of Object.values(meta)) {
      expect(Array.isArray(entry.columns)).toBe(true)
      for (const col of entry.columns) expect(typeof col).toBe("string")
    }
  })
})
