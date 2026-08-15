// task-20260727-101145 (external-AI-facing reporting API gateway):
// server-safe (no "use client") counterpart to report-export.ts's
// generic ExportRow[] convention -- report-export.ts's exportPPTX/
// exportDocx/exportHTML and reports/page.tsx's exportExcel are all
// browser-only (they call document.createElement/URL.createObjectURL to
// trigger a download), so they cannot run inside a Next.js API route.
// These two functions are the pure "build the bytes" half of that exact
// same CSV/XLSX generation report-export.ts and reports/page.tsx already
// use (same xlsx package, same json_to_sheet call) -- just without the
// browser download trigger, so src/app/api/v1/reports/** can return the
// bytes directly in an HTTP response instead.
import * as XLSX from "xlsx"

export type ExportRow = Record<string, string | number>

// OWASP CSV/formula injection: a cell value starting with =, +, -, or @ is
// interpreted as a live formula by Excel/Sheets on open. Since this route is
// designed for external AI agents/resellers to consume report rows containing
// user-controlled free text (vendor names, custom fields, AI-recipe notes),
// every cell gets the standard leading-single-quote mitigation -- it forces
// spreadsheet software to treat the value as text while leaving the original
// characters after it fully intact (recoverable, not corrupted).
const FORMULA_INJECTION_PREFIX = /^[=+\-@]/

function csvEscape(value: string | number): string {
  let s = String(value)
  if (FORMULA_INJECTION_PREFIX.test(s)) {
    s = `'${s}`
  }
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function rowsToCSV(rows: ExportRow[]): string {
  const headers = Object.keys(rows[0] ?? {})
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => csvEscape(row[h] ?? "")).join(",")),
  ]
  return lines.join("\n")
}

export function rowsToXLSXBuffer(rows: ExportRow[], sheetName = "Report"): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  return XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer
}
