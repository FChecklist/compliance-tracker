// PROJEXA-BUILD-002 WP-02: the ZOOMIES workbook as an .xlsx file, built from the committed public fixture
// (src/lib/ingest/__fixtures__/zoomies-digest.json: the contractor's block, the notes, the terms and the client's name are not in it).
// The tests of the model route need real bytes, because the route reads a file, not a digest. Every row keeps its real worksheet row
// number, every cell its text (line breaks included), so reading these bytes gives back the fixture's own rows.
import * as XLSX from "xlsx"
import fixtureJson from "@/lib/ingest/__fixtures__/zoomies-digest.json"
import type { WorkbookDigest } from "../document-extraction-schema"

export const zoomiesFixture = fixtureJson as unknown as WorkbookDigest

/** The rows of a digest as a sheet of the given cells, with empty rows where the digest has a gap, so row numbers survive. */
function rowsToAoa(rows: Array<{ row: number; cells: string[] }>): string[][] {
  const last = Math.max(0, ...rows.map((r) => r.row))
  const aoa: string[][] = Array.from({ length: last }, () => [])
  for (const r of rows) aoa[r.row - 1] = r.cells
  return aoa
}

/** An .xlsx workbook of the given sheets (name and digest rows). */
export function workbookFromDigest(digest: WorkbookDigest, extraRows: Record<string, Array<{ row: number; cells: string[] }>> = {}): Buffer {
  const wb = XLSX.utils.book_new()
  for (const sheet of digest.sheets) {
    const rows = [...sheet.rows, ...(extraRows[sheet.name] ?? [])]
    const ws = XLSX.utils.aoa_to_sheet(rowsToAoa(rows))
    XLSX.utils.book_append_sheet(wb, ws, sheet.name)
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer
}

/** The ZOOMIES workbook: 22 sheets, two areas, 53 lines that reconcile to AED 1,596,280 excluding VAT. */
export function zoomiesWorkbook(extraRows: Record<string, Array<{ row: number; cells: string[] }>> = {}): Buffer {
  return workbookFromDigest(zoomiesFixture, extraRows)
}
