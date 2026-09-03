// R67 E-12 (R-136). ONE report document, described once.
//
// The defect R-136 records is that every report invented its own document: the
// Reports screen rendered whatever JSON came back through a generic key/value
// grid, the Budget Summary route hand-built its own eleven-column row list, and
// the two agreed with each other only by accident. A reader who exported a
// report got a file whose columns, order and labels were a different opinion
// from the table they had just read.
//
// So a report's DOCUMENT is now data, not code: a ReportExportSchema per slug
// naming its title, its columns (key, label, type, align, group), what it groups
// by and which columns carry a total. The export route builds rows from the
// schema, and PROJEXA's ReportDocument renders the same columns in the same
// order under the same labels -- src/lib/report-schema.ts over there mirrors
// this one, and each repo's tests pin the labels, because the two repos cannot
// share a module.
//
// Everything here is PURE. The rows come from the report services; this file
// decides only what a document made of them looks like, which is why the
// acceptance can assert the shape of a real .xlsx without a database.
import * as XLSX from "xlsx"
import { rowsToCSV, rowsToXLSXBuffer, type ExportRow } from "@/lib/report-export-shared"

/**
 * What a column IS, not how wide it is. `money` and `number` are separated
 * because they are not the same fact -- a quantity of 3 is three of something,
 * AED 3 is a price -- and a renderer that cannot tell them apart puts a currency
 * label on a count.
 */
export type ReportColumnType = "text" | "money" | "number" | "percent"

export type ReportExportColumn = {
  /** The key on the source row. */
  key: string
  /** What a reader sees. Never a camelCase key -- that is the defect, not the label. */
  label: string
  type: ReportColumnType
  align: "left" | "right"
  /** The band this column belongs to, where a report has bands (Money / Progress / Activity). */
  group?: string
}

export type ReportExportSchema = {
  slug: string
  /** The document's own title, above the table. */
  title: string
  /** The worksheet name in the .xlsx. */
  sheetName: string
  columns: ReportExportColumn[]
  /** The column whose value starts a new subtotal band, where the document has bands. */
  groupBy?: string
  /** The columns a grand total is computed for. Everything else is left blank on that row. */
  totals?: string[]
  /** Which column carries the words "Grand Total". */
  totalLabelColumn?: string
}

/** The en dash, the same "no figure" token every screen and export in this product uses. */
export const EMPTY = "–"

/**
 * Keyed by the slug the picker, the catalog and the export route all use, so a
 * report cannot be one document in the table and another in the file.
 */
export const REPORT_EXPORT_SCHEMAS: Record<string, ReportExportSchema> = {
  // R67 E-13's Subcontractor / Budget breakup -- Sumeet 6.png II. The Project
  // Status card itself is scalars (contract value, budget, revenue, ...); the
  // TABLE under it is the BOQ's budget line by line, which is the only part of
  // that report a spreadsheet can carry.
  "project-status": {
    slug: "project-status",
    title: "Project Status — Subcontractor / Budget breakup",
    sheetName: "Project Status",
    columns: [
      { key: "category", label: "Category", type: "text", align: "left" },
      { key: "code", label: "Code", type: "text", align: "left" },
      { key: "description", label: "Description", type: "text", align: "left" },
      { key: "budget", label: "Budget", type: "money", align: "right" },
      { key: "vendorName", label: "Vendor", type: "text", align: "left" },
      { key: "vendorAmount", label: "Vendor amount", type: "money", align: "right" },
    ],
    groupBy: "category",
    totals: ["budget", "vendorAmount"],
    totalLabelColumn: "category",
  },
  // R67 E-07 (R-114): Sumeet 6.png II(iii)'s column list, unchanged. It was
  // built inline in the export route; describing it here instead is the whole
  // point of E-12 -- the route now has no opinion of its own about columns, so
  // the file and the Cost Variance table cannot drift apart.
  "budget-variance": {
    slug: "budget-variance",
    title: "Budget Summary",
    sheetName: "Budget Variance",
    columns: [
      { key: "sNo", label: "S.No", type: "number", align: "right" },
      { key: "category", label: "Category", type: "text", align: "left" },
      { key: "code", label: "Code", type: "text", align: "left" },
      { key: "description", label: "Description", type: "text", align: "left" },
      { key: "quantity", label: "Qty", type: "number", align: "right" },
      { key: "rate", label: "Rate", type: "money", align: "right" },
      { key: "amount", label: "Amt", type: "money", align: "right" },
      { key: "budget", label: "Budget", type: "money", align: "right" },
      { key: "vendorName", label: "Vendor", type: "text", align: "left" },
      { key: "vendorAmount", label: "Vendor Amt", type: "money", align: "right" },
      { key: "variance", label: "Variance", type: "money", align: "right" },
    ],
    groupBy: "category",
    totals: ["budget", "vendorAmount", "variance"],
    totalLabelColumn: "sNo",
  },
}

/**
 * R67 E-18 (R-178) / E-20 (R-208). THE WORK PROGRESS REPORT AS A DOCUMENT.
 *
 * The WPR already had a PDF (generateWorkProgressReportPdf, shipped #1314) and
 * a browser-built CSV, and no XLSX at all -- R-178's own words are that PROJEXA
 * "must not gain an XLSX library", so the bytes have to be built here. Rather
 * than a third opinion about the WPR's columns, it is described here like every
 * other report, from the SAME computed rows the PDF is drawn from.
 *
 * The third column is Total or Balance depending on the reader's toggle, so the
 * schema is a function of the mode -- the label in the file must say which of
 * the two the numbers under it are.
 */
export function workProgressExportSchema(mode: "total" | "balance" = "total"): ReportExportSchema {
  const third = mode === "balance" ? "Balance" : "Total"
  return {
    slug: "work-progress",
    title: "Work Progress Report",
    sheetName: "Work Progress",
    columns: [
      { key: "sNo", label: "S.No", type: "number", align: "right" },
      { key: "category", label: "Category", type: "text", align: "left" },
      { key: "code", label: "Code", type: "text", align: "left" },
      { key: "description", label: "Description", type: "text", align: "left" },
      { key: "poQty", label: "PO Qty", type: "number", align: "right" },
      { key: "unit", label: "Unit", type: "text", align: "left" },
      { key: "rate", label: "Rate", type: "money", align: "right" },
      { key: "amount", label: "Amt", type: "money", align: "right" },
      { key: "percentPrevious", label: "% Previous", type: "percent", align: "right", group: "Percent" },
      { key: "percentCurrent", label: "% Current", type: "percent", align: "right", group: "Percent" },
      { key: "percentThird", label: `% ${third}`, type: "percent", align: "right", group: "Percent" },
      { key: "qtyPrevious", label: "Qty Previous", type: "number", align: "right", group: "Quantity" },
      { key: "qtyCurrent", label: "Qty Current", type: "number", align: "right", group: "Quantity" },
      { key: "qtyThird", label: `Qty ${third}`, type: "number", align: "right", group: "Quantity" },
      { key: "amtPrevious", label: "Amt Previous", type: "money", align: "right", group: "Amount" },
      { key: "amtCurrent", label: "Amt Current", type: "money", align: "right", group: "Amount" },
      { key: "amtThird", label: `Amt ${third}`, type: "money", align: "right", group: "Amount" },
    ],
    groupBy: "category",
    totals: ["amount", "amtPrevious", "amtCurrent", "amtThird"],
    totalLabelColumn: "sNo",
  }
}

/** The shape workProgressExportRows reads -- structurally the pdf module's ComputedRow. */
export type WorkProgressExportSource = {
  code: string
  description: string
  categoryName: string
  isChild: boolean
  poQty: number
  unit: string
  rate: number
  contractAmt: number
  prevQty: number; currentQty: number; thirdQty: number
  prevAmt: number; currentAmt: number; thirdAmt: number
  prevPct: number; currentPct: number; thirdPct: number
}

/**
 * The rows AND the grand total, computed by the SAME rule the screen's own
 * grand-total row uses (WorkProgressReportClient#computeGrandTotal): the "Amt"
 * column totals PARENT lines only, because a weighted sub-task's amount is
 * derived from its parent and counting both would print a total the table does
 * not add up to; the three Amount-band columns total every row, because every
 * row's recorded progress is its own. Returning the totals here rather than
 * letting buildExportRows re-sum is what keeps the file and the screen equal.
 */
export function workProgressExportRows(
  source: WorkProgressExportSource[],
  mode: "total" | "balance" = "total"
): { rows: Record<string, unknown>[]; totals: Record<string, number | null> } {
  const rows = source.map((r, i) => ({
    sNo: i + 1,
    category: r.categoryName,
    code: r.code || null,
    description: r.description,
    poQty: r.poQty,
    unit: r.unit,
    rate: r.rate,
    amount: r.contractAmt,
    // WPR-06: a child line's percentages are blank, on screen and in the file.
    percentPrevious: r.isChild ? null : r.prevPct,
    percentCurrent: r.isChild ? null : r.currentPct,
    percentThird: r.isChild ? null : r.thirdPct,
    qtyPrevious: r.prevQty,
    qtyCurrent: r.currentQty,
    qtyThird: r.thirdQty,
    amtPrevious: r.prevAmt,
    amtCurrent: r.currentAmt,
    amtThird: r.thirdAmt,
  }))
  const round = (n: number) => Math.round(n * 100) / 100
  return {
    rows,
    totals: {
      amount: round(source.filter((r) => !r.isChild).reduce((s, r) => s + r.contractAmt, 0)),
      amtPrevious: round(source.reduce((s, r) => s + r.prevAmt, 0)),
      amtCurrent: round(source.reduce((s, r) => s + r.currentAmt, 0)),
      amtThird: round(source.reduce((s, r) => s + r.thirdAmt, 0)),
    },
  }
}

/**
 * R67 E-16 (R-150). THE DESIGN STUDIO COST ANALYSIS AS A DOCUMENT.
 *
 * designerTimesheetReport returns FOUR breakdowns of the same approved hours --
 * by category, by designer, by project and by designer status. A spreadsheet is
 * one grid, so they are one table with a Section column and a band per cut,
 * which is exactly how the screen stacks them.
 *
 * THERE IS DELIBERATELY NO GRAND TOTAL. The four cuts are overlapping views of
 * the SAME money: adding a designer's actual to a category's actual to a
 * project's actual counts the same hour three times. A total row there would be
 * a number that is not a fact, and this product's own rule is that a printed
 * total must tie. The per-section subtotals the reader needs are the report's
 * own overallBudget/overallActual, which the screen prints above the table.
 */
export const DESIGNER_TIMESHEET_SECTIONS = [
  { key: "category", label: "By Category" },
  { key: "designer", label: "By Designer" },
  { key: "project", label: "By Project" },
  { key: "status", label: "Designer Status" },
] as const

export const DESIGNER_TIMESHEET_SCHEMA: ReportExportSchema = {
  slug: "designer-timesheet",
  title: "Design Studio — Cost Analysis",
  sheetName: "Cost Analysis",
  columns: [
    { key: "section", label: "Section", type: "text", align: "left" },
    { key: "item", label: "Item", type: "text", align: "left" },
    { key: "budget", label: "Budget", type: "money", align: "right" },
    { key: "actual", label: "Actual", type: "money", align: "right" },
    { key: "variance", label: "Variance", type: "money", align: "right" },
    { key: "hours", label: "Hours", type: "number", align: "right" },
  ],
  groupBy: "section",
}

/** The shape designerTimesheetExportRows reads -- structurally DesignerTimesheetReport. */
export type DesignerTimesheetExportSource = {
  projectScoped: {
    byUser: { userId: string; userName: string; totalHours: number }[]
    byCategory: { category: string; hours: number; actual: number; budget: number | null }[]
    byDesignerStatus: { status: string; budget: number; actual: number; variance: number }[]
  }
  orgWide: {
    byDesigner: { userId: string; userName: string; hours: number; budget: number; actual: number; variance: number }[]
    byProject: { projectId: string; projectName: string; budget: number; actual: number; variance: number }[]
  }
}

/**
 * The four cuts, flattened in the order the screen stacks them. Variance is
 * ACTUAL minus BUDGET, positive meaning over -- the same sign convention the
 * Budget-vs-Actual view uses, so a reader moving between them never has to
 * re-learn which way is bad. A row with no budget carries null, not zero: the
 * by-category cut genuinely has no budget dimension in the source (budget line
 * items carry a designer, never a category), and a zero there would read as
 * "budgeted nothing and spent it all".
 */
export function designerTimesheetExportRows(source: DesignerTimesheetExportSource): Record<string, unknown>[] {
  const hoursHere = new Map(source.projectScoped.byUser.map((u) => [u.userId, u.totalHours]))
  const variance = (actual: number, budget: number | null) =>
    budget === null ? null : Math.round((actual - budget) * 100) / 100
  return [
    ...source.projectScoped.byCategory.map((c) => ({
      section: "By Category", item: c.category,
      budget: c.budget, actual: c.actual, variance: variance(c.actual, c.budget), hours: c.hours,
    })),
    ...source.orgWide.byDesigner.map((d) => ({
      section: "By Designer", item: d.userName,
      budget: d.budget, actual: d.actual, variance: variance(d.actual, d.budget),
      hours: hoursHere.get(d.userId) ?? d.hours,
    })),
    ...source.orgWide.byProject.map((p) => ({
      section: "By Project", item: p.projectName,
      budget: p.budget, actual: p.actual, variance: variance(p.actual, p.budget), hours: null,
    })),
    ...source.projectScoped.byDesignerStatus.map((s) => ({
      section: "Designer Status",
      item: s.status === "active" ? "Active designers" : "Inactive designers",
      budget: s.budget, actual: s.actual, variance: variance(s.actual, s.budget), hours: null,
    })),
  ]
}

export function reportExportSchema(slug: string): ReportExportSchema | null {
  if (slug === "work-progress") return workProgressExportSchema()
  if (slug === "designer-timesheet") return DESIGNER_TIMESHEET_SCHEMA
  return REPORT_EXPORT_SCHEMAS[slug] ?? null
}

/** The header row, in order. The one list the screen and the file both answer to. */
export function schemaColumnLabels(schema: ReportExportSchema): string[] {
  return schema.columns.map((c) => c.label)
}

function cell(value: unknown): string | number {
  if (value === null || value === undefined || value === "") return EMPTY
  if (typeof value === "number") return Number.isFinite(value) ? value : EMPTY
  return String(value)
}

/**
 * Every column present on every row, in schema order, keyed by LABEL -- which
 * is what makes rowsToXLSXBuffer/rowsToCSV emit exactly `schemaColumnLabels()`
 * as their header, in that order, however sparse the data is. A row missing a
 * key gets the en dash rather than being dropped from the header.
 */
export function buildExportRows(
  schema: ReportExportSchema,
  rows: Record<string, unknown>[],
  totals?: Record<string, number | null>
): ExportRow[] {
  const out: ExportRow[] = rows.map((row) => {
    const mapped: ExportRow = {}
    for (const column of schema.columns) mapped[column.label] = cell(row[column.key])
    return mapped
  })

  if (!schema.totals || schema.totals.length === 0) return out

  // The grand total is a ROW, not a caption: a QS re-adds a column by hand and
  // expects the file to show them the same sum the screen did.
  const totalRow: ExportRow = {}
  for (const column of schema.columns) {
    if (column.key === schema.totalLabelColumn) {
      totalRow[column.label] = "Grand Total"
    } else if (schema.totals.includes(column.key)) {
      const value = totals ? totals[column.key] : sumColumn(rows, column.key)
      totalRow[column.label] = value === null || value === undefined ? EMPTY : value
    } else {
      totalRow[column.label] = ""
    }
  }
  out.push(totalRow)
  return out
}

/**
 * Sums one column over the rows AS GIVEN. Callers that already hold a
 * single-rounded total from the service pass it in instead -- the reports round
 * once at the end over raw values, and re-summing the rounded display figures
 * here would reintroduce exactly the drift R48's gap-closure removed.
 */
export function sumColumn(rows: Record<string, unknown>[], key: string): number | null {
  let seen = false
  let sum = 0
  for (const row of rows) {
    const v = row[key]
    if (typeof v === "number" && Number.isFinite(v)) {
      seen = true
      sum += v
    }
  }
  return seen ? Math.round(sum * 100) / 100 : null
}

/**
 * The document as a .xlsx. Goes through report-export-shared's
 * rowsToXLSXBuffer, which carries the OWASP formula-injection guard -- BOQ
 * descriptions, categories and vendor names are user-typed free text and are
 * exactly the fields that guard exists for.
 */
export function reportXlsxBuffer(
  schema: ReportExportSchema,
  rows: Record<string, unknown>[],
  totals?: Record<string, number | null>
): Buffer {
  return rowsToXLSXBuffer(buildExportRows(schema, rows, totals), schema.sheetName)
}

/** The same document as CSV, from the same rows, so the two files agree. */
export function reportCsv(
  schema: ReportExportSchema,
  rows: Record<string, unknown>[],
  totals?: Record<string, number | null>
): string {
  return rowsToCSV(buildExportRows(schema, rows, totals))
}

/**
 * Reads a generated workbook back to its raw cell grid. Exported so the
 * acceptance can assert what a real .xlsx actually contains rather than what
 * the row builder claims it will -- the header row is produced by
 * XLSX.utils.json_to_sheet, not by this file, so asserting on the buffer is the
 * only honest check.
 */
export function xlsxRows(buffer: Buffer): unknown[][] {
  const wb = XLSX.read(buffer, { type: "buffer" })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" })
}
