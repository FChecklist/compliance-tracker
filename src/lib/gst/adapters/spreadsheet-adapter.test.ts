// E43_PARSEAMOUNT_SILENT_ZERO_GST_IMPORT_PATH. Before this fix,
// mapRowToDraft()/adaptSpreadsheet() called parseAmount() directly on every
// mapped amount/quantity/rate cell with no upstream check -- a malformed
// cell ("not-a-number", a stray typo) silently became a real $0 taxable
// value / tax amount in the staged row, with no warning anywhere (AR-05
// violation). Pure functions, no DB/xlsx access -- independently
// unit-testable, same discipline construction-boq-import-service.test.ts
// already uses for the sibling BOQ import path.
/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test"
import { mapRowToDraft, adaptSpreadsheet } from "./spreadsheet-adapter"
import type { ColumnMapping } from "@/lib/gst/column-mapper"
import type { ParseResult } from "@/lib/ingest/types"

const FULL_MAPPING: ColumnMapping = {
  counterpartyGstin: "GSTIN", counterpartyName: "Party Name", invoiceNumber: "Invoice No", invoiceDate: "Invoice Date",
  taxableValue: "Taxable Value", cgstAmount: "CGST", sgstAmount: "SGST", igstAmount: "IGST", cessAmount: "Cess",
  totalValue: "Total", quantity: "Qty", rate: "Rate", gstRatePercent: "GST Rate",
}

function row(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    GSTIN: "27ABCDE1234F1Z5", "Party Name": "Acme Traders", "Invoice No": "INV-001", "Invoice Date": "2026-07-01",
    "Taxable Value": "10000", CGST: "900", SGST: "900", IGST: "0", Cess: "0", Total: "11800", Qty: "10", Rate: "1000", "GST Rate": "18",
    ...overrides,
  }
}

describe("mapRowToDraft -- E-43 malformed amount cells are flagged, not silently zeroed", () => {
  test("a genuinely-numeric row produces zero warnings", () => {
    const { draft, warnings } = mapRowToDraft(row({}), FULL_MAPPING)
    expect(warnings).toHaveLength(0)
    expect(draft.taxableValue).toBe(10000)
    expect(draft.totalValue).toBe(11800)
  })

  test("a malformed Taxable Value cell is flagged in warnings AND still parses to 0 (unchanged numeric behaviour)", () => {
    const { draft, warnings } = mapRowToDraft(row({ "Taxable Value": "not-a-number" }), FULL_MAPPING)
    expect(draft.taxableValue).toBe(0)
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings.some(w => w.includes("Taxable value") && w.includes("not-a-number"))).toBe(true)
  })

  test("a malformed CGST cell is flagged by name, distinct from other fields", () => {
    const { warnings } = mapRowToDraft(row({ CGST: "TBD" }), FULL_MAPPING)
    expect(warnings.some(w => w.includes("CGST amount") && w.includes("TBD"))).toBe(true)
  })

  test("a malformed item Rate cell is flagged", () => {
    const { draft, warnings } = mapRowToDraft(row({ Rate: "N/A" }), FULL_MAPPING)
    expect(draft.items[0].rate).toBe(0)
    expect(warnings.some(w => w.includes("Rate") && w.includes("N/A"))).toBe(true)
  })

  test("a percent-formatted GST rate cell ('18%') is NOT flagged -- parseAmount parses it correctly", () => {
    const { draft, warnings } = mapRowToDraft(row({ "GST Rate": "18%" }), FULL_MAPPING)
    expect(draft.items[0].gstRatePercent).toBe(18)
    expect(warnings).toHaveLength(0)
  })

  test("a blank cell is not flagged -- distinct from garbage text", () => {
    const { draft, warnings } = mapRowToDraft(row({ Cess: "" }), FULL_MAPPING)
    expect(draft.cessAmount).toBe(0)
    expect(warnings).toHaveLength(0)
  })

  test("a real numeric xlsx cell (typeof number) is never flagged", () => {
    const { warnings } = mapRowToDraft(row({ "Taxable Value": 10000 }), FULL_MAPPING)
    expect(warnings).toHaveLength(0)
  })
})

describe("adaptSpreadsheet -- per-row warnings surface on the staged row, keyed by sourceRow", () => {
  test("only the row with the malformed cell carries a warning", () => {
    const parsed: ParseResult = {
      fileType: "csv",
      headers: ["GSTIN", "Party Name", "Invoice No", "Invoice Date", "Taxable Value", "CGST", "SGST", "IGST", "Cess", "Total", "Qty", "Rate", "GST Rate"],
      rows: [row({}), row({ "Invoice No": "INV-002", "Taxable Value": "garbage-value" })],
      totalRows: 2,
    }
    const { rows } = adaptSpreadsheet(parsed, FULL_MAPPING)
    expect(rows).toHaveLength(2)
    expect(rows[0].warnings).toHaveLength(0)
    expect(rows[1].warnings.length).toBeGreaterThan(0)
    expect(rows[1].mappedData.taxableValue).toBe(0)
    expect(rows[1].sourceRow).toBe(2)
  })
})
