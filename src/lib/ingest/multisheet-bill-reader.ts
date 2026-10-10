// PROJEXA-BUILD-002 WP-01 (register rows AW-101 to AW-104): a deterministic reader for a bill-of-quantities workbook that is
// spread over many sheets. No model, no database, no network: it takes the cell text of every sheet (readWorkbookGrid() in
// parser.ts, or a WorkbookDigest) and returns BOQ lines with a reconciliation against the totals the file prints itself.
//
// Why it exists. The single-sheet importer (parseBoqSpreadsheet) reads the first sheet only and needs one header row. A prospect
// workbook exported from a PDF ("Table 1" to "Table 22") has a cover sheet first, a summary, roll-ups per bill, and one sheet
// per bill whose numbering restarts at 1 and whose description runs over several rows. This reader is the fallback for that shape.
//
// What it does, in order:
//   1. Classifies each sheet by its own rows: a BILL sheet has a header row with description, quantity and rate; a SUMMARY sheet
//      has a "total amount" or "cost(aed)" column; a cover has a PROJECT label. A summary is never read as a bill (its quantity
//      and rate columns hold amounts and cost per m2, which read as an AED 250 million line if taken as a bill).
//   2. Tracks the AREA (a row that holds only "<NAME> AREA", for example PLAY AREA) that applies to the sheets after it. Areas
//      become a category prefix ("Play Area - Partition and Lining"): two areas are ONE BOQ, not two.
//   3. Reads each bill sheet: a description that runs over several rows is one line, "CARRIED TO COLLECTION" and total rows are
//      never lines, numbers typed as text ("22,000.00", a stray backtick before a quantity) are read, and every line gets a code
//      "<AREA>-B<bill>-<nn>" that is unique across all sheets. The code has a hyphen and never a dot: createBoq infers a parent
//      line from a dot in an item code.
//   4. A line is PRICED only when its quantity and its rate are both numbers above zero, and its amount is quantity x rate. A row
//      with a quantity and no rate ("-", Excluded, By Main Contractor, Details required) is never turned into a zero-priced
//      line: it goes to `questions` for a person to answer.
//   5. A bill that has a printed total but no readable lines (its lines are unpriced, or pressed into one cell) becomes ONE
//      flagged lump-sum line worth the printed total, so the grand total stays exact and a person can see which bills lack detail.
//   6. Reconciles: each bill against its own "CARRIED TO COLLECTION" and against the summary sheet, each area against the
//      summary, the grand total against the summary, and VAT. It never changes a line to make a number match; a difference is
//      returned in `diffs` and `reconciled` is false.
//
// Not attempted: splitting a cell that holds several lines pressed together (a table body inside the header row). Those bills
// are reported as lump sums (when the file prints a total for them) or as a question.
import type { BoqLineItemInput } from "@/lib/services/construction-boq-service"
import type { WorkbookGrid, GridSheet } from "./types"

// ─── result types ───────────────────────────────────────────────────────────────────────────────────────────────────

export type SourceRef = { sheet: string; row: number }

export type BillLine = {
  itemCode: string
  /** The item number as the sheet prints it ("2.02"); it restarts in every bill, so it is not the code. */
  sourceItem: string | null
  description: string
  unit: string
  quantity: number
  rate: number
  amount: number
  /** "<Area> - <Bill title>", or the bill title alone when the workbook has no area rows. */
  category: string
  area: string | null
  bill: string
  source: SourceRef
}

export type LumpSum = {
  itemCode: string
  area: string | null
  bill: string
  billTitle: string
  description: string
  unit: "LS"
  quantity: 1
  rate: number
  amount: number
  category: string
  flag: "lump_sum_from_total"
  /** Where the amount comes from: the bill's own "CARRIED TO COLLECTION" or the summary sheet. */
  basis: "carried_total" | "summary_total"
  /** Why the bill has no priced lines. */
  reason: "packed_sheet" | "unpriced_items" | "no_detail"
  source: SourceRef
  /** Rows of this bill that were read but not priced; the lump sum stands in for them. */
  notItemised: { source: SourceRef; description: string }[]
}

export type QuestionKind = "no_rate" | "packed_cell" | "packed_sheet" | "bad_quantity" | "lump_sum" | "unknown_bill"

export type BillQuestion = {
  kind: QuestionKind
  area: string | null
  bill: string
  itemCode: string | null
  description: string
  unit: string
  quantity: number | null
  /** What the sheet printed in the rate or amount cell ("By Main Contractor", "Excluded", "-"). */
  detail: string
  source: SourceRef
  question: string
}

export type ReaderWarning = { source: SourceRef; message: string }

export type BillTotal = {
  area: string | null
  bill: string
  title: string
  sheets: string[]
  pricedLines: number
  pricedSum: number
  lumpSum: number
  computed: number
  /** "CARRIED TO COLLECTION" of the bill's sheet(s); null when the sheet prints no amount. */
  carried: number | null
  /** The bill's row on the summary sheet; null when there is none. */
  summary: number | null
  reconciled: boolean
}

export type AreaTotal = {
  area: string | null
  computed: number
  /** The area's row on the main summary sheet. */
  declaredMain: number | null
  /** The area's own grand summary sheet (sub-total or grand total row). */
  declaredSubtotal: number | null
  reconciled: boolean
}

export type Diff = {
  scope: "bill" | "area" | "grand" | "vat" | "summary" | "row"
  ref: string
  expected: number | null
  actual: number | null
  difference: number | null
  message: string
}

export type ReaderTotals = {
  byBill: BillTotal[]
  byArea: AreaTotal[]
  grand: { computed: number; declared: number | null; reconciled: boolean }
  /** null when the workbook prints no VAT row. `amount` and `totalIncVat` are what the file prints. */
  vat: { ratePercent: number | null; amount: number | null; totalIncVat: number | null; computedAmount: number | null; reconciled: boolean } | null
  /** How many comparisons were made. reconciled is never true with zero. */
  checks: number
}

export type SheetKind = "cover" | "summary" | "bill" | "other"

export type MultisheetBillResult = {
  projectName: string | null
  sheets: { name: string; kind: SheetKind; area: string | null; bill: string | null }[]
  lines: BillLine[]
  lumpSums: LumpSum[]
  questions: BillQuestion[]
  warnings: ReaderWarning[]
  totals: ReaderTotals
  reconciled: boolean
  diffs: Diff[]
}

// ─── small helpers ──────────────────────────────────────────────────────────────────────────────────────────────────

const TOLERANCE = 0.005

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

const near = (a: number, b: number, tolerance = TOLERANCE): boolean => Math.abs(a - b) <= tolerance

function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() ?? ""
}

/** "ITEM\n1.0\n1.0" and "Item" both give "item"; "Sl. No." gives "slno". */
function headerKey(text: string): string {
  return firstLine(text).toLowerCase().replace(/[^a-z0-9]+/g, "")
}

function flat(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

/** "#VALUE!" is a cached error a PDF-to-Excel export leaves in description cells; it is not text. */
const ERROR_CELL = /^#(value!|ref!|n\/a|name\?|div\/0!|null!|num!)$/i

function isErrorCell(text: string): boolean {
  return ERROR_CELL.test(text.trim())
}

type ParsedNumber = { value: number; cleaned: boolean }

/**
 * A number typed as text. "22,000.00" and "13.20" are numbers; "` 13.20" (a stray character before the digits) is read as
 * 13.2 with cleaned = true so the reader can say it did so; "-", "Excluded", "By Main Contractor" and a cell that holds
 * several numbers on several lines are not numbers.
 */
export function parseNumberText(text: string): ParsedNumber | null {
  const t = text.trim()
  if (t === "" || t.includes("\n")) return null
  if (/^-?\d+(\.\d+)?$/.test(t)) return { value: Number(t), cleaned: false }
  const stripped = t.replace(/[\s,`'"‘’“”]/g, "")
  if (!/^-?\d+(\.\d+)?$/.test(stripped)) return null
  // Spaces and thousands commas are formatting; any other character that had to go is a stray one.
  return { value: Number(stripped), cleaned: t.replace(/[\s,]/g, "") !== stripped }
}

function titleCase(text: string): string {
  const small = new Set(["and", "of", "the", "for", "in", "to", "on", "at"])
  return flat(text)
    .split(" ")
    .map((word, i) => {
      if (word === "") return word
      // Codes and slashed groups (MEP/IT/AV, GF,MF) stay as they are; so do symbols.
      if (/[/&]/.test(word) || /^[^A-Za-z]+$/.test(word)) return word
      const lower = word.toLowerCase()
      if (i > 0 && small.has(lower)) return lower
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join(" ")
}

function stripParentheses(text: string): string {
  return flat(text.replace(/\([^)]*\)?/g, " "))
}

/** For matching a sheet title with a summary row: letters only, "&" as "and", brackets dropped. */
function titleKey(text: string): string {
  return stripParentheses(text).toLowerCase().replace(/&/g, "and").replace(/[^a-z]+/g, "")
}

// ─── pass 1: sheet classification, areas, summary sheets ────────────────────────────────────────────────────────────

type Columns = { item: number; desc: number; unit: number; qty: number; rate: number; amount: number }

type HeaderInfo = { index: number; cols: Columns; packed: boolean }

type SummaryBill = { title: string; amount: number | null; amountText: string }

type AreaSummary = { bills: Map<string, SummaryBill>; subtotal: number | null; grand: number | null }

type MainSummary = {
  areaRows: Map<string, number>
  grand: number | null
  vatRate: number | null
  vatAmount: number | null
  incVat: number | null
}

type SheetInfo = {
  sheet: GridSheet
  kind: SheetKind
  area: string | null
  header: HeaderInfo | null
  billKey: string | null
  billTitle: string
  titleFromNumber: boolean
}

const HEADER_SCAN_ROWS = 8

function findHeader(sheet: GridSheet): HeaderInfo | null {
  const limit = Math.min(sheet.rows.length, HEADER_SCAN_ROWS)
  for (let index = 0; index < limit; index++) {
    const cells = sheet.rows[index].cells
    const keys = cells.map(headerKey)
    const desc = keys.indexOf("description")
    const qty = keys.findIndex((k) => k === "quantity" || k === "qty")
    const rate = keys.indexOf("rate")
    if (desc < 0 || qty < 0 || rate < 0) continue
    let item = keys.findIndex((k) => k === "item" || k === "slno" || k === "itemno" || k === "sno" || k === "no")
    if (item === desc) item = -1
    const unit = keys.findIndex((k) => k === "unit" || k === "uom")
    const amount = keys.findIndex((k) => k === "amount" || k === "amt" || k === "total")
    // A table body pressed into the header row shows in the description or the quantity header cell ("DESCRIPTION\nFixed glass ...").
    const packed = [desc, qty].some((i) => cells[i].includes("\n"))
    return { index, cols: { item, desc, unit, qty, rate, amount }, packed }
  }
  return null
}

/** A row that holds one cell only, and that cell reads "<NAME> AREA" in capitals, marks the area of the sheets after it. */
function areaMarker(cells: string[]): string | null {
  const filled = cells.filter((c) => c.trim() !== "")
  if (filled.length !== 1) return null
  const text = flat(filled[0])
  if (!/^[A-Z][A-Z &/-]*\bAREA$/.test(text)) return null
  return titleCase(text)
}

function billNumber(text: string): { key: string; title: string } | null {
  const m = /BILL\s*No\.?\s*(\d+[A-Z]?)\s*[-–:.]*\s*(.*)$/i.exec(flat(text))
  if (!m) return null
  return { key: m[1].toUpperCase(), title: flat(m[2]) }
}

function cellAt(cells: string[], index: number): string {
  return index >= 0 && index < cells.length ? cells[index] : ""
}

/** The first cell among the first three that holds words: not a number, not "AED". Used for the label of a summary row. */
function summaryLabel(cells: string[]): string {
  for (let i = 0; i < Math.min(cells.length, 3); i++) {
    const t = flat(cells[i])
    if (t === "" || /^[\d.,\s]+$/.test(t) || /^AED$/i.test(t)) continue
    return t
  }
  return ""
}

function classifySheets(workbook: WorkbookGrid): {
  infos: SheetInfo[]
  areaSummaries: Map<string, AreaSummary>
  main: MainSummary
  projectName: string | null
} {
  const infos: SheetInfo[] = []
  const areaSummaries = new Map<string, AreaSummary>()
  const main: MainSummary = { areaRows: new Map(), grand: null, vatRate: null, vatAmount: null, incVat: null }
  let projectName: string | null = null
  let currentArea: string | null = null

  for (const sheet of workbook.sheets) {
    const header = findHeader(sheet)

    // The area that applies to THIS sheet: the one in force when it starts, unless a marker is its first row (then that one).
    let sheetArea = currentArea
    let sawContent = false
    for (const row of sheet.rows) {
      const marker = areaMarker(row.cells)
      if (marker) {
        currentArea = marker
        if (!sawContent) sheetArea = marker
      } else {
        sawContent = true
      }
    }

    let kind: SheetKind = "other"
    let summaryCol = -1
    if (header) {
      kind = "bill"
    } else {
      for (const row of sheet.rows.slice(0, HEADER_SCAN_ROWS)) {
        const idx = row.cells.findIndex((c) => /^(total amount|cost\s*\(aed\))$/i.test(firstLine(c)))
        if (idx >= 0) {
          kind = "summary"
          summaryCol = idx
          break
        }
      }
      if (kind === "other" && sheet.rows.some((r) => r.cells.length === 1 && /^project$/i.test(r.cells[0].trim()))) kind = "cover"
    }

    let billKey: string | null = null
    let billTitle = ""
    let titleFromNumber = false
    if (kind === "bill" && header) {
      const titleRows = sheet.rows.slice(0, header.index)
      for (const row of titleRows) {
        for (const cell of row.cells) {
          const found = billNumber(cell)
          if (found) {
            billKey = found.key
            billTitle = found.title
            titleFromNumber = true
          }
        }
      }
      if (!billTitle) {
        const last = [...titleRows].reverse().find((r) => r.cells.some((c) => c.trim() !== ""))
        billTitle = last ? flat(last.cells.find((c) => c.trim() !== "") ?? "") : ""
      }
      billTitle = stripParentheses(billTitle)
    }

    if (kind === "cover") {
      const at = sheet.rows.findIndex((r) => r.cells.length === 1 && /^project$/i.test(r.cells[0].trim()))
      const next = sheet.rows[at + 1]
      if (next && next.cells[0]) projectName = flat(next.cells[0])
    }

    if (kind === "summary") readSummary(sheet, summaryCol, sheetArea, areaSummaries, main)

    infos.push({ sheet, kind, area: sheetArea, header, billKey, billTitle, titleFromNumber })
  }
  return { infos, areaSummaries, main, projectName }
}

function readSummary(sheet: GridSheet, amountCol: number, area: string | null, areaSummaries: Map<string, AreaSummary>, main: MainSummary): void {
  const isMain = sheet.rows.slice(0, HEADER_SCAN_ROWS).some((r) => r.cells.some((c) => /^cost\s*\(aed\)$/i.test(firstLine(c))))
  const areaKey = area ?? ""
  const summary: AreaSummary = areaSummaries.get(areaKey) ?? { bills: new Map(), subtotal: null, grand: null }
  for (const row of sheet.rows) {
    const label = summaryLabel(row.cells)
    if (label === "") continue
    const raw = cellAt(row.cells, amountCol)
    const num = parseNumberText(raw)
    const bill = /^BILL\s+(\d+[A-Z]?)\b/i.exec(label)
    if (isMain) {
      if (/^grand total.*incl/i.test(label)) main.incVat = num ? num.value : main.incVat
      else if (/^grand total/i.test(label)) main.grand = num ? num.value : main.grand
      else if (/^vat\b/i.test(label)) {
        const rate = /(\d+(?:\.\d+)?)\s*%/.exec(label)
        main.vatRate = rate ? Number(rate[1]) : main.vatRate
        main.vatAmount = num ? num.value : main.vatAmount
      } else if (/\bAREA$/i.test(label) && num) main.areaRows.set(titleCase(label), num.value)
      continue
    }
    if (bill) {
      // The description is the first words cell after the label.
      const descIndex = row.cells.findIndex((c, i) => i > 0 && flat(c) !== "" && !/^[\d.,\s]+$/.test(flat(c)) && !/^AED$/i.test(flat(c)))
      const title = descIndex >= 0 ? flat(row.cells[descIndex]) : ""
      summary.bills.set(bill[1].toUpperCase(), { title, amount: num ? num.value : null, amountText: flat(raw) })
    } else if (/^sub-?total/i.test(label)) summary.subtotal = num ? num.value : summary.subtotal
    else if (/^grand total/i.test(label)) summary.grand = num ? num.value : summary.grand
  }
  if (!isMain) areaSummaries.set(areaKey, summary)
}

// ─── pass 2: bill sheets ────────────────────────────────────────────────────────────────────────────────────────────

type Pending = {
  itemNo: string | null
  parts: string[]
  unit: string
  qty: string
  rate: string
  amount: string
  itemRow: number
  dataRow: number | null
  section: string | null
}

type BillAcc = {
  area: string | null
  key: string
  title: string
  sheets: string[]
  packedSheet: boolean
  carried: number | null
  seq: number
  lines: BillLine[]
  questions: BillQuestion[]
  firstSource: SourceRef
}

/** What the reader of one bill sheet needs to hand around. */
type SheetContext = {
  sheetName: string
  headerRow: number
  header: HeaderInfo
  area: string | null
  bill: BillAcc
  headings: Map<string, string>
  warnings: ReaderWarning[]
  diffs: Diff[]
}

type RowState = { pending: Pending | null; section: string | null; errorCells: number }

/** One worksheet row cut into the columns of the bill's header. `desc` is empty when the cell holds a cached error. */
type RowCells = { row: number; item: string; desc: string; unit: string; qty: string; rate: string; amount: string; cells: string[] }

const CARRIED = /carried\s+to\s+collection/i
const TOTAL_ROW = /^(sub[\s-]?total|total|grand\s+total)\b/i
const SECTION_LABEL = /^(ground|mezzanine|first|second|third|fourth|basement|roof|podium|terrace)\b[^.:;\d]{0,24}$/i

function areaCode(area: string | null): string {
  if (!area) return ""
  return area.replace(/\bArea\b/i, "").replace(/[^A-Za-z0-9]+/g, "").toUpperCase() || "AREA"
}

function itemCodeFor(area: string | null, bill: string, seq: number | "LS"): string {
  const prefix = area ? `${areaCode(area)}-` : ""
  return `${prefix}B${bill}-${seq === "LS" ? "LS" : String(seq).padStart(2, "0")}`
}

function categoryFor(area: string | null, title: string): string {
  const name = title ? titleCase(title) : "Bill"
  return area ? `${area} - ${name}` : name
}

function describe(p: Pending, heading: string | null): string {
  const all = p.parts.flatMap((t) => t.split("\n").map(flat).filter((l) => l !== ""))
  let text = all.length === 0 ? "" : all.length === 1 ? all[0] : `${all[0]} - ${all.slice(1).join(" ")}`
  if (heading && text && !text.toLowerCase().includes(heading.toLowerCase())) text = `${heading} - ${text}`
  if (p.section && text) text = `${p.section} - ${text}`
  return flat(text)
}

function isNumberedItem(text: string): string | null {
  const first = firstLine(text)
  return /^\d+(\.\d+)*$/.test(first) ? first : null
}

function matchSummaryBill(title: string, summary: AreaSummary): string | null {
  const wanted = titleKey(title)
  if (wanted === "") return null
  for (const [k, v] of summary.bills) {
    const have = titleKey(v.title)
    if (have !== "" && (wanted === have || wanted.includes(have) || have.includes(wanted))) return k
  }
  return null
}

/** The title of the heading a numbered sub-item sits under ("2.01" under a heading "2"); null for a top-level item. */
function headingFor(p: Pending, map: Map<string, string>): string | null {
  if (p.itemNo === null || !p.itemNo.includes(".")) return null
  const [base, fraction] = p.itemNo.split(".")
  if (/^0+$/.test(fraction)) return null
  return map.get(base) ?? null
}

/**
 * The bill's number: printed in the title, else the summary row whose title this sheet's title matches. A number the summary
 * does not list (the sheet says "BILL No.1", the summary says "BILL 1A") is replaced by the row its title matches.
 */
function resolveBillKey(info: SheetInfo, summary: AreaSummary | undefined, headerRow: number, warnings: ReaderWarning[]): string | null {
  let key = info.billKey
  if (summary && (!key || !summary.bills.has(key))) {
    const matched = matchSummaryBill(info.billTitle, summary)
    if (matched && matched !== key) {
      if (key) {
        warnings.push({
          source: { sheet: info.sheet.name, row: headerRow },
          message: `The sheet says Bill ${key} but the summary has no Bill ${key}; read as Bill ${matched} (same title)`,
        })
      }
      key = matched
    }
  }
  return key
}

function billFor(bills: Map<string, BillAcc>, info: SheetInfo, key: string, summary: AreaSummary | undefined, headerRow: number): BillAcc {
  const accKey = `${info.area ?? ""}|${key}`
  let acc = bills.get(accKey)
  if (!acc) {
    acc = {
      area: info.area,
      key,
      title: info.billTitle || summary?.bills.get(key)?.title || "",
      sheets: [],
      packedSheet: false,
      carried: null,
      seq: 0,
      lines: [],
      questions: [],
      firstSource: { sheet: info.sheet.name, row: headerRow },
    }
    bills.set(accKey, acc)
  }
  return acc
}

function addQuestion(ctx: SheetContext, q: Omit<BillQuestion, "area" | "bill">): void {
  ctx.bill.questions.push({ area: ctx.area, bill: ctx.bill.key, ...q })
}

function cutRow(row: number, cells: string[], header: HeaderInfo, state: RowState): RowCells {
  const rawDesc = cellAt(cells, header.cols.desc)
  const error = isErrorCell(rawDesc)
  if (error) state.errorCells++
  return {
    row,
    cells,
    item: cellAt(cells, header.cols.item),
    desc: error ? "" : rawDesc,
    unit: cellAt(cells, header.cols.unit),
    qty: cellAt(cells, header.cols.qty),
    rate: cellAt(cells, header.cols.rate),
    amount: cellAt(cells, header.cols.amount),
  }
}

/** A "CARRIED TO COLLECTION" row, or an unlabelled row that holds only "AED" and the subtotal (a merged label cell is lost in some exports). */
function isCarriedRow(c: RowCells): boolean {
  if (CARRIED.test(c.cells.join(" "))) return true
  return c.item.trim() === "" && c.desc.trim() === "" && c.qty.trim() === "" && c.cells.some((x) => /^AED$/i.test(x.trim()))
}

function recordCarried(c: RowCells, ctx: SheetContext): void {
  const fallback = [...c.cells].reverse().find((x) => parseNumberText(x) !== null || x.trim() === "-") ?? ""
  const text = c.amount.trim() !== "" ? c.amount : fallback
  const num = parseNumberText(text)
  if (num) ctx.bill.carried = round2((ctx.bill.carried ?? 0) + num.value)
  else if (text.trim() === "-") ctx.bill.carried = ctx.bill.carried ?? 0
}

type PendingReading =
  | { kind: "packed" }
  | { kind: "bad_quantity" }
  | { kind: "no_rate"; qty: ParsedNumber }
  | { kind: "priced"; qty: ParsedNumber; rate: ParsedNumber }

/** A line is priced only when quantity and rate are both numbers above zero; several values in one cell are never split. */
function readPending(p: Pending): PendingReading {
  const packed = p.qty.includes("\n") || p.rate.includes("\n") || /\d\s+\d/.test(p.qty) || /\d\s+\d/.test(p.rate)
  if (packed) return { kind: "packed" }
  const qty = parseNumberText(p.qty)
  if (!qty) return { kind: "bad_quantity" }
  const rate = parseNumberText(p.rate)
  if (!rate || rate.value <= 0 || qty.value <= 0) return { kind: "no_rate", qty }
  return { kind: "priced", qty, rate }
}

function emitPending(p: Pending, ctx: SheetContext): void {
  const { bill } = ctx
  const source: SourceRef = { sheet: ctx.sheetName, row: p.dataRow ?? p.itemRow }
  const description = describe(p, headingFor(p, ctx.headings))
  bill.seq++
  const itemCode = itemCodeFor(ctx.area, bill.key, bill.seq)
  const reading = readPending(p)
  const where = `${ctx.sheetName} row ${source.row}`
  const detail = flat([p.rate, p.amount].find((t) => t.trim() !== "" && t.trim() !== "-") ?? p.rate)
  const ask = (kind: QuestionKind, question: string, quantity: number | null) =>
    addQuestion(ctx, { kind, itemCode, description, unit: flat(p.unit), quantity, detail, source, question })

  if (reading.kind === "packed") {
    ask("packed_cell", `${where}: quantity or rate cells hold several values pressed into one cell ("${flat(p.qty)}"). Please give each line's quantity and rate.`, null)
    return
  }
  if (reading.kind === "bad_quantity") {
    ask("bad_quantity", `${where}: the quantity "${flat(p.qty)}" is not a number. What is the quantity?`, null)
    return
  }
  const { qty } = reading
  if (qty.cleaned) ctx.warnings.push({ source, message: `Quantity "${flat(p.qty)}" held a stray character; read as ${qty.value}` })
  if (reading.kind === "no_rate") {
    const said = detail && detail !== "-" ? ` (the sheet says "${detail}")` : ""
    ask("no_rate", `${where}: quantity ${qty.value}${p.unit ? ` ${flat(p.unit)}` : ""} but no rate${said}. What is the price, or is the item left out?`, qty.value)
    return
  }
  const { rate } = reading
  if (rate.cleaned) ctx.warnings.push({ source, message: `Rate "${flat(p.rate)}" held a stray character; read as ${rate.value}` })
  const amount = round2(qty.value * rate.value)
  const printed = parseNumberText(p.amount)
  if (printed && !near(printed.value, amount, 0.01)) {
    ctx.diffs.push({
      scope: "row",
      ref: `${where} (${itemCode})`,
      expected: printed.value,
      actual: amount,
      difference: round2(amount - printed.value),
      message: `${where}: quantity x rate is ${amount} but the sheet prints ${printed.value}`,
    })
  }
  if (flat(p.unit) === "") ctx.warnings.push({ source, message: 'No unit on a priced line; "Item" used' })
  bill.lines.push({
    itemCode,
    sourceItem: p.itemNo,
    description,
    unit: flat(p.unit) || "Item",
    quantity: qty.value,
    rate: rate.value,
    amount,
    category: categoryFor(ctx.area, bill.title),
    area: ctx.area,
    bill: bill.key,
    source,
  })
}

function flushPending(state: RowState, ctx: SheetContext): void {
  const p = state.pending
  state.pending = null
  if (!p) return
  if (p.qty.trim() !== "") {
    emitPending(p, ctx)
    return
  }
  // A heading with no quantity of its own; its title prefixes the numbered sub-items that follow (2.01 under 2).
  const title = p.parts.length > 0 ? flat(p.parts[0].split("\n")[0] ?? "") : ""
  if (p.itemNo !== null && title !== "") ctx.headings.set(p.itemNo.split(".")[0], title)
}

function newPending(c: RowCells, itemNo: string | null, section: string | null): Pending {
  const hasData = c.qty.trim() !== ""
  return {
    itemNo,
    parts: c.desc ? [c.desc] : [],
    unit: c.unit,
    qty: c.qty,
    rate: c.rate,
    amount: c.amount,
    itemRow: c.row,
    dataRow: hasData ? c.row : null,
    section,
  }
}

/** A row with a quantity and no item number: the data row of the heading above it, or (when that line is complete) a new unnumbered line. */
function attachData(c: RowCells, state: RowState, ctx: SheetContext): void {
  const current = state.pending
  if (current && current.qty.trim() === "") {
    if (c.desc) current.parts.push(c.desc)
    current.unit = c.unit
    current.qty = c.qty
    current.rate = c.rate
    current.amount = c.amount
    current.dataRow = c.row
    return
  }
  flushPending(state, ctx)
  state.pending = newPending(c, null, state.section)
}

/** A row with no item number and no quantity: a level heading ("Mezzanine Floor"), a continuation of the description, or a note under the line. */
function continueDescription(c: RowCells, state: RowState, ctx: SheetContext): void {
  if (c.desc.trim() !== "" && isSectionHeading(c)) {
    flushPending(state, ctx)
    state.section = flat(c.desc)
    return
  }
  const current = state.pending
  if (!current) return
  if (c.desc.trim() !== "") current.parts.push(c.desc)
  if (c.rate.trim() !== "" && current.rate.trim() === "") current.rate = c.rate
  if (c.amount.trim() !== "" && current.amount.trim() === "") current.amount = c.amount
}

function isSectionHeading(c: RowCells): boolean {
  const text = flat(c.desc)
  return SECTION_LABEL.test(text) && text.length <= 32 && c.rate.trim() === "" && c.amount.trim() === ""
}

/** Reads one data row. Returns true when the bill's data ends here (its CARRIED TO COLLECTION row). */
function readRow(c: RowCells, state: RowState, ctx: SheetContext): boolean {
  if (isCarriedRow(c)) {
    flushPending(state, ctx)
    recordCarried(c, ctx)
    return true
  }
  if (TOTAL_ROW.test(flat(c.item)) || TOTAL_ROW.test(flat(c.desc))) {
    flushPending(state, ctx)
    return false
  }
  const itemNo = isNumberedItem(c.item)
  if (itemNo !== null || (c.item.trim() !== "" && c.desc.trim() !== "")) {
    flushPending(state, ctx)
    state.pending = newPending(c, itemNo, state.section)
  } else if (c.qty.trim() !== "") {
    attachData(c, state, ctx)
  } else {
    continueDescription(c, state, ctx)
  }
  return false
}

function readSheetRows(ctx: SheetContext, rows: GridSheet["rows"]): void {
  const state: RowState = { pending: null, section: null, errorCells: 0 }
  for (let i = ctx.header.index + 1; i < rows.length; i++) {
    const { row, cells } = rows[i]
    if (areaMarker(cells)) continue
    if (readRow(cutRow(row, cells, ctx.header, state), state, ctx)) break
  }
  flushPending(state, ctx)
  if (state.errorCells > 0) {
    ctx.warnings.push({ source: { sheet: ctx.sheetName, row: ctx.headerRow }, message: `${state.errorCells} cached error cell(s) (#VALUE!) ignored` })
  }
}

function readBills(infos: SheetInfo[], areaSummaries: Map<string, AreaSummary>, warnings: ReaderWarning[], diffs: Diff[]): Map<string, BillAcc> {
  const bills = new Map<string, BillAcc>()
  infos.forEach((info, index) => {
    if (info.kind !== "bill" || !info.header) return
    const { sheet, header } = info
    const summary = areaSummaries.get(info.area ?? "")
    const headerRow = sheet.rows[header.index]?.row ?? 0
    const found = resolveBillKey(info, summary, headerRow, warnings)
    const key = found ?? `X${index + 1}`
    info.billKey = key
    const bill = billFor(bills, info, key, summary, headerRow)
    bill.sheets.push(sheet.name)
    if (header.packed) bill.packedSheet = true
    const ctx: SheetContext = { sheetName: sheet.name, headerRow, header, area: info.area, bill, headings: new Map(), warnings, diffs }
    if (found === null) {
      addQuestion(ctx, {
        kind: "unknown_bill",
        itemCode: null,
        description: info.billTitle,
        unit: "",
        quantity: null,
        detail: "",
        source: { sheet: sheet.name, row: headerRow },
        question: `Sheet "${sheet.name}" carries no bill number and its title matches no summary row. Which bill is it?`,
      })
    }
    readSheetRows(ctx, sheet.rows)
  })
  return bills
}

// ─── lump sums ──────────────────────────────────────────────────────────────────────────────────────────────────────

function buildLumpSums(bills: Map<string, BillAcc>, areaSummaries: Map<string, AreaSummary>): LumpSum[] {
  const lumps: LumpSum[] = []
  for (const bill of bills.values()) {
    if (bill.lines.length > 0) continue
    const summary = areaSummaries.get(bill.area ?? "")?.bills.get(bill.key)
    const carried = bill.carried !== null && bill.carried > 0 ? bill.carried : null
    const fromSummary = summary && summary.amount !== null && summary.amount > 0 ? summary.amount : null
    const amount = carried ?? fromSummary
    if (amount === null) {
      // Content pressed into one cell and no printed total to stand in for it: nothing was read, so say so.
      if (bill.packedSheet) {
        bill.questions.push({
          kind: "packed_sheet",
          area: bill.area,
          bill: bill.key,
          itemCode: null,
          description: bill.title,
          unit: "",
          quantity: null,
          detail: "",
          source: bill.firstSource,
          question: `Bill ${bill.key} (${titleCase(bill.title)}${bill.area ? `, ${bill.area}` : ""}) has its lines pressed into one cell and no printed total, so nothing was read from it. Please send it with the lines in separate rows.`,
        })
      }
      continue
    }
    const unread = bill.questions.filter((q) => q.kind === "no_rate" || q.kind === "packed_cell" || q.kind === "bad_quantity")
    const reason: LumpSum["reason"] = bill.packedSheet ? "packed_sheet" : unread.length > 0 ? "unpriced_items" : "no_detail"
    const title = bill.title || summary?.title || `Bill ${bill.key}`
    const source = unread[0]?.source ?? bill.firstSource
    const lump: LumpSum = {
      itemCode: itemCodeFor(bill.area, bill.key, "LS"),
      area: bill.area,
      bill: bill.key,
      billTitle: title,
      description: `${titleCase(title)} (lump sum from the bill total; the lines are not priced in the file)`,
      unit: "LS",
      quantity: 1,
      rate: amount,
      amount,
      category: categoryFor(bill.area, title),
      flag: "lump_sum_from_total",
      basis: carried !== null ? "carried_total" : "summary_total",
      reason,
      source,
      notItemised: unread.map((q) => ({ source: q.source, description: q.description })),
    }
    lumps.push(lump)
    // The unpriced rows are now covered by the lump sum; one question stands for all of them.
    bill.questions = bill.questions.filter((q) => !unread.includes(q))
    bill.questions.push({
      kind: "lump_sum",
      area: bill.area,
      bill: bill.key,
      itemCode: lump.itemCode,
      description: lump.description,
      unit: "LS",
      quantity: 1,
      detail: String(amount),
      source,
      question: `Bill ${bill.key} (${titleCase(title)}${bill.area ? `, ${bill.area}` : ""}) has a printed total of ${amount} but its lines are ${
        reason === "packed_sheet" ? "pressed into one cell" : "not priced"
      }${unread.length > 0 ? ` (${unread.length} row(s))` : ""}. It is taken as one lump-sum line. Please confirm, or send a version with the lines priced.`,
    })
  }
  return lumps
}

// ─── reconciliation ─────────────────────────────────────────────────────────────────────────────────────────────────

type Reconciliation = { totals: ReaderTotals; diffs: Diff[]; reconciled: boolean }

function reconcile(bills: BillAcc[], lumps: LumpSum[], areaSummaries: Map<string, AreaSummary>, main: MainSummary, rowDiffs: Diff[]): Reconciliation {
  const out: Diff[] = [...rowDiffs]
  let checks = 0
  const compare = (scope: Diff["scope"], ref: string, expected: number, actual: number, label: string): boolean => {
    checks++
    if (near(expected, actual)) return true
    out.push({ scope, ref, expected, actual, difference: round2(actual - expected), message: `${label}: the file prints ${expected}, the lines add up to ${actual}` })
    return false
  }

  const byBill: BillTotal[] = bills.map((bill) => {
    const lump = lumps.find((l) => l.area === bill.area && l.bill === bill.key)
    const pricedSum = round2(bill.lines.reduce((s, l) => s + l.amount, 0))
    const lumpSum = lump ? lump.amount : 0
    const computed = round2(pricedSum + lumpSum)
    const summary = areaSummaries.get(bill.area ?? "")?.bills.get(bill.key)
    const summaryAmount = summary ? (summary.amount ?? 0) : null
    const label = `Bill ${bill.key}${bill.area ? ` (${bill.area})` : ""}`
    let ok = true
    if (bill.carried !== null) ok = compare("bill", `${label} carried to collection`, bill.carried, computed, `${label} against its "carried to collection"`) && ok
    if (summaryAmount !== null) ok = compare("bill", `${label} summary`, summaryAmount, computed, `${label} against the summary sheet`) && ok
    return {
      area: bill.area,
      bill: bill.key,
      title: bill.title,
      sheets: bill.sheets,
      pricedLines: bill.lines.length,
      pricedSum,
      lumpSum,
      computed,
      carried: bill.carried,
      summary: summaryAmount,
      reconciled: ok,
    }
  })

  // A bill the summary prices but no sheet was read for.
  for (const [areaKey, summary] of areaSummaries) {
    for (const [key, row] of summary.bills) {
      if (row.amount !== null && row.amount > 0 && !bills.some((b) => (b.area ?? "") === areaKey && b.key === key)) {
        checks++
        out.push({
          scope: "summary",
          ref: `Bill ${key}${areaKey ? ` (${areaKey})` : ""}`,
          expected: row.amount,
          actual: 0,
          difference: round2(-row.amount),
          message: `The summary prices Bill ${key} at ${row.amount} but no sheet for it was read`,
        })
      }
    }
  }

  const areaKeys = [...new Set(byBill.map((b) => b.area ?? ""))]
  const byArea: AreaTotal[] = areaKeys.map((areaKey) => {
    const area = areaKey === "" ? null : areaKey
    const computed = round2(byBill.filter((b) => (b.area ?? "") === areaKey).reduce((s, b) => s + b.computed, 0))
    const declaredMain = area !== null ? (main.areaRows.get(area) ?? null) : null
    const s = areaSummaries.get(areaKey)
    const declaredSubtotal = s ? (s.subtotal ?? s.grand) : null
    let ok = true
    if (declaredMain !== null) ok = compare("area", `${area} main summary`, declaredMain, computed, `${area} against the main summary`) && ok
    if (declaredSubtotal !== null) ok = compare("area", `${area ?? "workbook"} grand summary`, declaredSubtotal, computed, `${area ?? "The workbook"} against its grand summary sheet`) && ok
    return { area, computed, declaredMain, declaredSubtotal, reconciled: ok }
  })

  const grandComputed = round2(byArea.reduce((s, a) => s + a.computed, 0))
  let grandOk = true
  if (main.grand !== null) grandOk = compare("grand", "grand total", main.grand, grandComputed, "The grand total") && grandOk
  // The summary's own area rows must add up to its own grand total, or the file contradicts itself.
  if (main.grand !== null && main.areaRows.size > 0) {
    const rows = round2([...main.areaRows.values()].reduce((s, v) => s + v, 0))
    checks++
    if (!near(rows, main.grand)) {
      out.push({ scope: "summary", ref: "summary sheet", expected: main.grand, actual: rows, difference: round2(rows - main.grand), message: `The summary sheet's area rows add up to ${rows} but its grand total says ${main.grand}` })
      grandOk = false
    }
  }

  let vat: ReaderTotals["vat"] = null
  if (main.vatAmount !== null || main.vatRate !== null || main.incVat !== null) {
    const base = main.grand ?? grandComputed
    const computedAmount = main.vatRate !== null ? round2((base * main.vatRate) / 100) : null
    let ok = true
    if (computedAmount !== null && main.vatAmount !== null) ok = compare("vat", "vat amount", main.vatAmount, computedAmount, `VAT at ${main.vatRate}%`) && ok
    if (main.incVat !== null && main.vatAmount !== null) ok = compare("vat", "total including vat", main.incVat, round2(base + main.vatAmount), "The total including VAT") && ok
    vat = { ratePercent: main.vatRate, amount: main.vatAmount, totalIncVat: main.incVat, computedAmount, reconciled: ok }
  }

  const totals: ReaderTotals = { byBill, byArea, grand: { computed: grandComputed, declared: main.grand, reconciled: grandOk }, vat, checks }
  return { totals, diffs: out, reconciled: out.length === 0 && checks > 0 }
}

// ─── entry points ───────────────────────────────────────────────────────────────────────────────────────────────────

/** True when at least one sheet has a bill header (description, quantity and rate). The route uses it to decide whether the reader applies. */
export function hasBillSheets(workbook: WorkbookGrid): boolean {
  return workbook.sheets.some((s) => findHeader(s) !== null)
}

/** Reads every sheet of the workbook. Pure: the same grid always gives the same result. */
export function readMultisheetBills(workbook: WorkbookGrid): MultisheetBillResult {
  const warnings: ReaderWarning[] = []
  const rowDiffs: Diff[] = []
  const { infos, areaSummaries, main, projectName } = classifySheets(workbook)
  const bills = readBills(infos, areaSummaries, warnings, rowDiffs)
  const billList = [...bills.values()]
  const lumpSums = buildLumpSums(bills, areaSummaries)
  const recon = reconcile(billList, lumpSums, areaSummaries, main, rowDiffs)

  return {
    projectName,
    sheets: infos.map((i) => ({ name: i.sheet.name, kind: i.kind, area: i.kind === "bill" || i.kind === "summary" ? i.area : null, bill: i.billKey })),
    lines: billList.flatMap((b) => b.lines),
    lumpSums,
    questions: billList.flatMap((b) => b.questions),
    warnings,
    totals: recon.totals,
    reconciled: recon.reconciled,
    diffs: recon.diffs,
  }
}

/** The lines and the lump sums as BOQ line items, ready for createBoq. Questions are not lines and are not included. */
export function toBoqLineItems(result: MultisheetBillResult): BoqLineItemInput[] {
  const lines: BoqLineItemInput[] = result.lines.map((l) => ({
    itemCode: l.itemCode,
    description: l.description,
    unit: l.unit,
    quantity: l.quantity,
    rate: l.rate,
    category: l.category,
  }))
  const lumps: BoqLineItemInput[] = result.lumpSums.map((l) => ({
    itemCode: l.itemCode,
    description: l.description,
    unit: l.unit,
    quantity: l.quantity,
    rate: l.rate,
    category: l.category,
  }))
  return [...lines, ...lumps]
}
