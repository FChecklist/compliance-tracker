import type { ParseResult, ParsedRow, WorkbookGrid, GridSheet, GridRow } from './types'

// Dynamic imports — avoids Edge runtime issues (these routes are Node.js only)
async function getXlsx() {
  const mod = await import('xlsx')
  return mod.default ?? mod
}


const EXCEL_MIMES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
]
const PDF_MIMES = ['application/pdf']
const CSV_MIMES = ['text/csv', 'application/csv', 'text/plain']

export async function parseFile(
  buffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<ParseResult> {
  const ext = fileName.toLowerCase().split('.').pop() ?? ''

  if (ext === 'pdf' || PDF_MIMES.includes(mimeType)) return parsePdf(buffer)
  if (ext === 'csv' || CSV_MIMES.some(m => mimeType.startsWith(m.split('/')[0]) && ext === 'csv')) return parseCsv(buffer)
  if (['xlsx', 'xls', 'xlsm', 'xlsb'].includes(ext) || EXCEL_MIMES.includes(mimeType)) return parseExcel(buffer)

  // Fallback: try Excel, then CSV, then fail
  try { return await parseExcel(buffer) } catch { /* try next */ }
  try { return parseCsv(buffer) } catch { /* fall through */ }
  throw new Error(`Cannot parse file "${fileName}" — supported formats: .xlsx, .xls, .csv, .pdf`)
}

async function parseExcel(buffer: Buffer): Promise<ParseResult> {
  const XLSX = await getXlsx()
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: true,
    cellNF: false,
    cellText: false,
  })

  // Use first sheet
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) throw new Error('Excel file has no sheets')
  const sheet = workbook.Sheets[sheetName]

  const rows = XLSX.utils.sheet_to_json<ParsedRow>(sheet, {
    defval: null,
    raw: false,
    dateNF: 'yyyy-mm-dd',
    blankrows: false,
  })

  if (rows.length === 0) throw new Error('Excel file is empty or has no data rows')

  // Normalise headers — trim whitespace, convert to consistent casing
  const normalisedRows = rows.map(row =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k.trim(), v])
    )
  )

  const headers = Object.keys(normalisedRows[0] ?? {})
  return { fileType: 'xlsx', rows: normalisedRows, headers, totalRows: normalisedRows.length, sheetName }
}

// Limits of readWorkbookGrid: the same sheet and row ceilings the document extraction digest uses
// (WORKBOOK_LIMITS in document-extraction-schema.ts), so a bill workbook that one path reads the other reads too.
const GRID_MAX_SHEETS = 64
const GRID_MAX_ROWS_PER_SHEET = 5000
const GRID_MAX_CELL_CHARS = 4000

// Characters that read as nothing on screen (control characters, zero-width and direction marks, byte-order mark).
// Line breaks and tabs are kept here and handled by cleanGridText.
const GRID_HIDDEN_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠-⁤﻿]/g

function cleanGridText(text: string): string {
  return text
    .replace(GRID_HIDDEN_CHARS, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter((line) => line !== "")
    .join("\n")
    .slice(0, GRID_MAX_CELL_CHARS)
}

function gridCellText(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "number") return Number.isFinite(value) ? String(Number(value.toPrecision(15))) : ""
  if (typeof value === "boolean") return value ? "true" : "false"
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return ""
    const iso = value.toISOString()
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso
  }
  return cleanGridText(String(value))
}

/**
 * Every sheet of a workbook as rows of cell text (the reader parseExcel above has no notion of more than one sheet).
 * Formulas are not evaluated (the value Excel last stored is read), numbers keep 15 significant digits, and a cell's
 * line breaks survive so that a reader can tell a description that runs over several lines from a table body pressed
 * into one cell. Hidden sheets are read too. Nothing here interprets the cells.
 */
export async function readWorkbookGrid(buffer: Buffer): Promise<WorkbookGrid> {
  const XLSX = await getXlsx()
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: true,
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
    sheetStubs: false,
    bookVBA: false,
    // Reads that many rows and sets !fullref when the sheet has more.
    sheetRows: GRID_MAX_ROWS_PER_SHEET,
  })
  const names = workbook.SheetNames
  if (names.length === 0) throw new Error('Excel file has no sheets')
  if (names.length > GRID_MAX_SHEETS) throw new Error(`Excel file has more than ${GRID_MAX_SHEETS} sheets`)

  const sheets: GridSheet[] = names.map((name) => {
    const sheet = workbook.Sheets[name]
    const rows: GridRow[] = []
    if (sheet && sheet['!ref']) {
      if ((sheet as Record<string, unknown>)['!fullref'] !== undefined) {
        throw new Error(`Sheet "${name}" has more than ${GRID_MAX_ROWS_PER_SHEET} rows`)
      }
      const firstRow = XLSX.utils.decode_range(sheet['!ref']).s.r
      const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '', blankrows: true })
      grid.forEach((cells, i) => {
        const texts = cells.map(gridCellText)
        while (texts.length > 0 && texts[texts.length - 1] === '') texts.pop()
        if (texts.length > 0) rows.push({ row: firstRow + i + 1, cells: texts })
      })
    }
    return { name: cleanGridText(name) || 'Sheet', rows }
  })
  return { sheets }
}

function parseCsv(buffer: Buffer): ParseResult {
  // Use xlsx to parse CSV — it handles encoding and BOM correctly
  const text = buffer.toString('utf-8').replace(/^﻿/, '') // strip BOM
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require('xlsx')
  const workbook = XLSX.read(text, { type: 'string', raw: false, dateNF: 'yyyy-mm-dd' })
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false, blankrows: false }) as ParsedRow[]

  if (rows.length === 0) throw new Error('CSV file is empty')

  const normalisedRows = rows.map(row =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k.trim(), v]))
  )

  return { fileType: 'csv', rows: normalisedRows, headers: Object.keys(normalisedRows[0] ?? {}), totalRows: normalisedRows.length }
}

async function parsePdf(buffer: Buffer): Promise<ParseResult> {
  // pdf-parse's current major version exports a `PDFParse` class (constructor
  // + async getText()), not the old default-exported callable function this
  // used to call -- that mismatch meant every PDF ingest threw "pdfParse is
  // not a function" at runtime. See node_modules/pdf-parse/dist/pdf-parse/esm.
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: buffer })
  let data: { text: string; total: number }
  try {
    data = await parser.getText()
  } catch (err) {
    throw new Error(`PDF parsing failed: ${(err as Error).message}. The file may be password-protected or a scanned image.`)
  } finally {
    await parser.destroy()
  }

  if (!data.text.trim()) {
    throw new Error('PDF appears to be a scanned image. Please use a text-based PDF or convert to Excel first.')
  }

  // Return as single row with full text — AI will parse the structure
  return {
    fileType: 'pdf',
    rows: [{ __pdf_text__: data.text }],
    headers: ['__pdf_text__'],
    rawText: data.text,
    totalRows: data.total,
  }
}
