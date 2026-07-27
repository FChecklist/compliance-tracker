/// <reference types="bun-types" />
// task-20260727-101145: pure unit tests for the server-safe CSV/XLSX
// builders src/app/api/v1/reports/definitions/[id]/run/route.ts's
// ?format=csv|xlsx uses to turn a report_definitions execution result's
// `rows` (ReportDefinitionResult.rows is already Record<string, string |
// number>[] -- the exact ExportRow shape, no conversion needed) into a
// downloadable file, without needing report-export.ts's browser-only
// (document/Blob) download trigger.
import { describe, test, expect } from "bun:test"
import * as XLSX from "xlsx"
import { rowsToCSV, rowsToXLSXBuffer, type ExportRow } from "./report-export-shared"

const ROWS: ExportRow[] = [
  { Department: "Legal", "Open Items": 3, Status: "On Track" },
  { Department: "Finance", "Open Items": 12, Status: "At Risk" },
]

describe("rowsToCSV", () => {
  test("produces a header row plus one row per input, comma-joined", () => {
    const csv = rowsToCSV(ROWS)
    const lines = csv.split("\n")
    expect(lines[0]).toBe("Department,Open Items,Status")
    expect(lines[1]).toBe("Legal,3,On Track")
    expect(lines[2]).toBe("Finance,12,At Risk")
  })

  test("quotes and escapes a value containing a comma, quote, or newline", () => {
    // Checked as one full string, not split on "\n" -- the second row's
    // value legitimately contains a literal newline inside its quotes
    // (valid per RFC 4180), so splitting the whole CSV on "\n" would cut
    // that quoted field in half.
    const csv = rowsToCSV([{ Note: 'Contains, a comma and a "quote"' }, { Note: "Multi\nline" }])
    expect(csv).toBe('Note\n"Contains, a comma and a ""quote"""\n"Multi\nline"')
  })

  test("returns just an empty header line for zero rows", () => {
    expect(rowsToCSV([])).toBe("")
  })
})

describe("rowsToXLSXBuffer", () => {
  test("produces a real, re-readable XLSX workbook with the same data", () => {
    const buffer = rowsToXLSXBuffer(ROWS)
    expect(Buffer.isBuffer(buffer)).toBe(true)
    expect(buffer.length).toBeGreaterThan(0)

    const wb = XLSX.read(buffer, { type: "buffer" })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const roundTripped = XLSX.utils.sheet_to_json(sheet)
    expect(roundTripped).toEqual(ROWS)
  })

  test("uses the given sheet name", () => {
    const buffer = rowsToXLSXBuffer(ROWS, "Q3 Compliance Report")
    const wb = XLSX.read(buffer, { type: "buffer" })
    expect(wb.SheetNames[0]).toBe("Q3 Compliance Report")
  })
})
