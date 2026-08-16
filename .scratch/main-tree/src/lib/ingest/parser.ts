import type { ParseResult, ParsedRow } from './types'

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
