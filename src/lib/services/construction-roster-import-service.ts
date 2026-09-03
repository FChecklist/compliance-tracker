// R67 D-34 (R-091): bulk load of the labour roster from a spreadsheet.
//
// Modelled directly on construction-boq-import-service.ts's parseBoqSpreadsheet
// -- same reuse discipline, same shape, same vocabulary -- rather than a second
// way of reading a file: it goes through src/lib/ingest/parser.ts's parseFile
// (xlsx/xls/csv, already shipped) and a small, roster-specific alias table.
// Parsing stays here, server-side, because PROJEXA must not gain an XLSX
// library; the import SCREEN sends the file and renders what this returns.
//
// The columns are the ones the customer's own roster sheet carries: ID, Name,
// Trade, Company, Daily Rate.
//
// ── MERGE NOTE (integration train, R67 lane D22 item D-68 onto this) ────────
// Lane D22 wrote a SECOND roster importer at this same path, with its own
// route (/v1/projexa/labour/import) and its own PROJEXA screen. Two parsers
// for one sheet is two sets of rules that can disagree about the same file --
// the thing both headers were written to prevent -- so this one is kept whole
// (it is already on main, with its route, its PROJEXA client and their tests)
// and D-68's distinct rules are folded IN below rather than kept beside it:
//   * `skillLevel`, a sixth column the roster table has always had
//     (schema.ts construction_labour_roster.skill_level) and neither importer
//     could fill;
//   * duplicates by name PLUS trade are FLAGGED, never merged -- two carpenters
//     called Mohammed Ali on one site is an ordinary fact, and collapsing them
//     would lose a man's attendance and his pay.
// D-68's blank-ID auto-numbering needed no folding: createRosterEntry() already
// generates the next employee code from the highest one stored, which is why
// the route writes rows sequentially. Two D-68 capabilities are deliberately
// NOT folded in and are named in the PR body rather than dropped quietly: the
// screen-correctable column mapping, and CREATING an unmatched vendor from the
// import screen (this route already reports `unmatchedCompanies`, so the fact
// reaches the user; accepting the offer in one click does not exist yet).
import { parseFile } from "@/lib/ingest/parser"
import { parseAmount } from "@/lib/gst/column-mapper"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type RosterFieldKey = "employeeCode" | "name" | "trade" | "company" | "dailyRate" | "skillLevel"

// Alias order within each field is a PRIORITY order (mapRosterHeaders resolves
// fields in this record's key order and marks each matched header as used), so
// a sheet carrying both "ID" and "Employee ID" resolves the same way twice.
export const ROSTER_FIELD_ALIASES: Record<RosterFieldKey, string[]> = {
  employeeCode: ["id", "worker id", "employee id", "employee code", "code", "emp id", "emp code"],
  name: ["name", "worker name", "employee name", "worker", "labour name"],
  trade: ["trade", "skill", "category", "designation", "work type"],
  company: ["company", "subcontractor", "vendor", "contractor", "supplier"],
  dailyRate: ["daily rate", "rate", "wage", "daily wage", "rate per day", "per day"],
  // R67 D-68, folded in: the roster table has carried skill_level since it was
  // created and no import path could fill it.
  skillLevel: ["skill level", "grade", "level"],
}

export type RosterRowIssue = { row: number; message: string; blocking: boolean }

/** One parsed roster row, ready for createRosterEntry. `company` is the sheet's TEXT -- resolving it to a vendor id is the caller's job, and an unmatched name is not an error. */
export type RosterImportRow = {
  employeeCode: string | null
  name: string
  trade: string | null
  company: string | null
  /** R67 D-68: the sheet's skill grade, when it has that column. */
  skillLevel: string | null
  dailyRate: number
  /** 1-based sheet row, header included -- the first data row is row 2. Same numbering the BOQ importer uses, so the two never disagree about which line a user is looking at. */
  sheetRow: number
  /** True when this row cannot be written and will be skipped. */
  skipped: boolean
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim().replace(/\s+/g, " ")
}

export type RosterColumnMapping = Partial<Record<RosterFieldKey, string>>

export function mapRosterHeaders(headers: string[]): RosterColumnMapping {
  const mapping: RosterColumnMapping = {}
  const used = new Set<string>()
  for (const field of Object.keys(ROSTER_FIELD_ALIASES) as RosterFieldKey[]) {
    let match: string | undefined
    for (const alias of ROSTER_FIELD_ALIASES[field]) {
      match = headers.find((h) => !used.has(h) && normalizeHeader(h) === alias)
      if (match) break
    }
    if (match) { mapping[field] = match; used.add(match) }
  }
  return mapping
}

// Same rule the BOQ importer uses: parseAmount() degrades genuine garbage
// ("TBD", "N/A", a typo) to 0, which at a call site is indistinguishable from a
// cell that legitimately says 0. Mirrors its cleaning steps before testing the
// result, so every shape parseAmount really accepts ("1,200", "AED 120",
// "(50)") passes and only true garbage is flagged.
function isMalformedNumericCell(raw: string): boolean {
  if (raw === "") return false
  const cleaned = raw
    .replace(/[,₹\s]/g, "")
    .replace(/^[^\d.\-(]+/, "")
    .replace(/^\((.*)\)$/, "-$1")
  return !/^-?\d+(\.\d+)?$/.test(cleaned)
}

/**
 * Pure, no DB/xlsx access -- independently unit-testable.
 *
 * BLOCKING vs NOT is the distinction the import screen renders and counts:
 *  - a row with no name, or with a rate that is missing/garbage/negative,
 *    CANNOT be written and is marked skipped (blocking, per row);
 *  - a row with no trade IS written, but is flagged, because a blank trade is
 *    exactly what makes every trade-wise figure downstream read "Unspecified".
 * A file-level problem (no Name column at all) throws instead, because there is
 * nothing to preview.
 */
export function mapRowsToRosterEntries(
  rows: Record<string, unknown>[],
  mapping: RosterColumnMapping
): { entries: RosterImportRow[]; issues: RosterRowIssue[] } {
  if (!mapping.name) throw new ServiceError("Could not find a Name column in this spreadsheet", 400)
  if (!mapping.dailyRate) throw new ServiceError("Could not find a Daily Rate column in this spreadsheet", 400)

  const entries: RosterImportRow[] = []
  const issues: RosterRowIssue[] = []
  // R67 D-68, folded in: first sheet row seen for each (name, trade) pair.
  const firstSeenAt = new Map<string, number>()

  rows.forEach((row, idx) => {
    const sheetRow = idx + 2
    const cells = readRosterCells(row, mapping)

    // A wholly blank row is padding at the bottom of a real sheet, not an
    // error worth naming.
    if (!cells.name && !cells.rateRaw && !cells.trade && !cells.company && !cells.employeeCode && !cells.skillLevel) return

    const dailyRate = cells.rateRaw === "" ? 0 : parseAmount(row[mapping.dailyRate!])
    const rowIssues = validateRosterRow({ ...cells, dailyRate, sheetRow })

    // R67 D-68, folded in: FLAGGED, never merged. Two carpenters called
    // Mohammed Ali on one site is an ordinary fact; collapsing them would lose
    // a man's attendance and his pay. So this is non-blocking and the row is
    // still written -- it exists to make a real accidental double-paste
    // visible, not to refuse a real pair of namesakes.
    if (cells.name) {
      const key = `${cells.name.toLowerCase()}|${cells.trade.toLowerCase()}`
      const seenAt = firstSeenAt.get(key)
      if (seenAt !== undefined) {
        rowIssues.push({
          row: sheetRow,
          message: `Row ${sheetRow}: same name and trade as row ${seenAt} -- imported as a separate worker, not merged`,
          blocking: false,
        })
      } else {
        firstSeenAt.set(key, sheetRow)
      }
    }

    issues.push(...rowIssues)

    entries.push({
      employeeCode: cells.employeeCode || null,
      name: cells.name,
      trade: cells.trade || null,
      company: cells.company || null,
      skillLevel: cells.skillLevel || null,
      dailyRate,
      sheetRow,
      skipped: rowIssues.some((i) => i.blocking),
    })
  })

  return { entries, issues }
}

type RosterCells = { employeeCode: string; name: string; trade: string; company: string; skillLevel: string; rateRaw: string }

function readRosterCells(row: Record<string, unknown>, mapping: RosterColumnMapping): RosterCells {
  const read = (column: string | undefined) => (column ? String(row[column] ?? "").trim() : "")
  return {
    employeeCode: read(mapping.employeeCode),
    name: read(mapping.name),
    trade: read(mapping.trade),
    company: read(mapping.company),
    skillLevel: read(mapping.skillLevel),
    rateRaw: read(mapping.dailyRate),
  }
}

/**
 * Pure. Everything wrong with one row, in the order a reader would notice it.
 * A BLOCKING issue means the row cannot be written and will be skipped; a
 * non-blocking one means it will be written and is worth saying anyway.
 */
export function validateRosterRow(
  cell: { name: string; rateRaw: string; trade: string; dailyRate: number; sheetRow: number }
): RosterRowIssue[] {
  const { sheetRow } = cell
  const issues: RosterRowIssue[] = []
  if (!cell.name) issues.push({ row: sheetRow, message: `Row ${sheetRow}: no worker name`, blocking: true })

  if (cell.rateRaw === "") {
    issues.push({ row: sheetRow, message: `Row ${sheetRow}: no daily rate`, blocking: true })
  } else if (isMalformedNumericCell(cell.rateRaw)) {
    issues.push({ row: sheetRow, message: `Row ${sheetRow}: Daily Rate is not a number`, blocking: true })
  } else if (cell.dailyRate < 0) {
    issues.push({ row: sheetRow, message: `Row ${sheetRow}: Daily Rate cannot be negative`, blocking: true })
  }

  // Not blocking: the worker still belongs on the roster. Said anyway, because
  // a blank trade is exactly what makes every trade-wise figure downstream read
  // "Unspecified".
  if (!cell.trade) {
    issues.push({ row: sheetRow, message: `Row ${sheetRow}: no trade -- this worker will not appear in any trade-wise total`, blocking: false })
  }
  return issues
}

/** "Import 38 rows (2 skipped)" / "Import 38 rows" -- one wording, so the button and the summary can never disagree. */
export function rosterImportSummary(entries: RosterImportRow[]): { importable: number; skipped: number; label: string } {
  const skipped = entries.filter((e) => e.skipped).length
  const importable = entries.length - skipped
  return {
    importable,
    skipped,
    label: skipped > 0
      ? `Import ${importable} row${importable === 1 ? "" : "s"} (${skipped} skipped)`
      : `Import ${importable} row${importable === 1 ? "" : "s"}`,
  }
}

/** Parses an uploaded roster spreadsheet (xlsx/xls/csv) into rows ready for createRosterEntry. */
export async function parseRosterSpreadsheet(
  buffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<{ entries: RosterImportRow[]; issues: RosterRowIssue[]; mapping: RosterColumnMapping; totalRows: number }> {
  const parsed = await parseFile(buffer, fileName, mimeType)
  const mapping = mapRosterHeaders(parsed.headers)
  const { entries, issues } = mapRowsToRosterEntries(parsed.rows as Record<string, unknown>[], mapping)
  return { entries, issues, mapping, totalRows: parsed.totalRows }
}