import { parseFile } from "@/lib/ingest/parser"
import { adaptSpreadsheet } from "./spreadsheet-adapter"
import { adaptTallyXml } from "./tally-xml-adapter"
import type { ColumnMapping, MappingConfidence } from "@/lib/gst/column-mapper"
import type { StagedRow } from "@/lib/gst/canonical-types"

export type GstSourceType = "excel_generic" | "csv_generic" | "tally_xml" | "busy" | "zoho_books"

export type AdaptResult = {
  rows: StagedRow[]
  mapping: ColumnMapping | null
  confidence: MappingConfidence | null
  totalRows: number
}

/**
 * Single entry point every import route calls: parses the uploaded file and
 * runs it through the source-appropriate adapter, always returning the same
 * canonical StagedRow[] shape regardless of source. Excel/CSV/Busy/Zoho
 * Books all share the spreadsheet adapter (their headers differ but are
 * covered by column-mapper's alias table); Tally XML gets a dedicated
 * adapter since its schema is fixed tags, not arbitrary spreadsheet headers.
 */
export async function adaptImportFile(
  sourceType: GstSourceType,
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  savedMapping?: ColumnMapping
): Promise<AdaptResult> {
  if (sourceType === "tally_xml") {
    const { rows } = adaptTallyXml(buffer.toString("utf-8"))
    return { rows, mapping: null, confidence: null, totalRows: rows.length }
  }

  const parsed = await parseFile(buffer, fileName, mimeType)
  const { mapping, confidence, rows } = adaptSpreadsheet(parsed, savedMapping)
  return { rows, mapping, confidence, totalRows: parsed.totalRows }
}
