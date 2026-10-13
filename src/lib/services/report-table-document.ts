// Sumeet R-C15 (PDF + share) / R-C11 (every report as a downloadable document), 2026-10-13.
// Every project report already answers as a table ({ columns, rows, totals?, currency, note? }, buildReportTable). Only three had a document schema, so the
// Export menu offered PDF and XLSX for 3 of 24 reports and a browser-built CSV for the rest. This turns ANY report's table into the same
// ReportExportSchema the three hand-described reports use, so PDF / XLSX / CSV come from the rows the screen showed and cannot disagree with them.
import type { ReportTable } from "@/lib/services/construction-reports-service"
import { EMPTY, type ReportExportColumn, type ReportExportSchema } from "@/lib/services/report-export"

/** "manpower-daily-summary" -> "Manpower Daily Summary". */
export function reportTitleFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

const FORMULA_START = /^[=+\-@]/

/**
 * A cell that starts with = + - @ is a live formula to Excel/Sheets; worker names, vendor names and descriptions are typed by users.
 * Numbers are left alone (a negative variance is a number, not text). Applied to the XLSX path only: the CSV writer already guards.
 */
function guardCell(v: unknown): unknown {
  return typeof v === "string" && FORMULA_START.test(v) ? `'${v}` : v
}

export function schemaFromTable(slug: string, table: Pick<ReportTable, "columns" | "totals">): ReportExportSchema {
  const columns: ReportExportColumn[] = table.columns.map((c) => ({
    key: c.key,
    label: c.label,
    type: c.unit === "currency" ? "money" : c.unit === "percent" ? "percent" : c.unit === "number" ? "number" : "text",
    align: c.align,
  }))
  const totalKeys = Object.keys(table.totals ?? {}).filter((k) => columns.some((c) => c.key === k))
  const labelColumn = columns.find((c) => !totalKeys.includes(c.key))?.key
  const title = reportTitleFromSlug(slug)
  return {
    slug,
    title,
    sheetName: title.replace(/[\/?*[\]:]/g, " ").slice(0, 31) || "Report",
    columns,
    ...(totalKeys.length > 0 && labelColumn ? { totals: totalKeys, totalLabelColumn: labelColumn } : {}),
  }
}

/** Rows for the XLSX: text cells guarded against formula injection. */
export function xlsxSafeRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, guardCell(v)])))
}

export { EMPTY }
