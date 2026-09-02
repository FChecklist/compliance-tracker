// R67 lane D22 (item D-68, rec R-258) -- LABOUR ROSTER EXCEL IMPORT.
//
// The third of the three imports a construction org actually has: a BOQ, a
// programme, and the crew list. The first two now exist (construction-boq-
// import-service.ts, schedule-import-service.ts); this is the one that was
// still typed in one worker at a time through /labour/new, on projects that
// carry a hundred.
//
// ALL PARSING STAYS HERE, in compliance-tracker. PROJEXA must not gain an XLSX
// library (programme rule; see repo_map.md section C) -- the browser uploads
// the file as FormData and the server answers with parsed rows. Parsing itself
// reuses src/lib/ingest/parser.ts's parseFile(), whose xlsx import is dynamic,
// exactly as the two shipped importers do. Nothing about xlsx is re-invented.
//
// THE THREE RULES THE ITEM NAMES, all in the pure half so they are provable
// without a database:
//   * a blank ID auto-numbers W-0001, W-0002, ... continuing past whatever the
//     sheet itself already used, so a half-coded sheet does not collide;
//   * an unknown company is NOT invented -- the row carries an offer,
//     "Create vendor 'Al Rashid Contracting'", which the screen shows and a
//     human accepts;
//   * duplicates by name PLUS trade are flagged, never merged. Two carpenters
//     called Mohammed Ali on one site is an ordinary fact, and silently
//     collapsing them would lose a man's attendance and his pay.
import { parseFile } from "@/lib/ingest/parser"
import { parseAmount, isMalformedNumericCell } from "@/lib/gst/column-mapper"
import { constructionLabourRoster, erpSuppliers, projects } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type RosterFieldKey = "employeeCode" | "name" | "trade" | "company" | "dailyRate" | "skillLevel"

/** Alias order within a field is a PRIORITY order, not a membership list -- the same rule the BOQ and schedule importers document. */
export const ROSTER_FIELD_ALIASES: Record<RosterFieldKey, string[]> = {
  employeeCode: ["id", "employee id", "employee code", "worker id", "code", "emp id"],
  name: ["name", "worker name", "employee name", "labour name", "worker"],
  trade: ["trade", "skill", "category", "designation", "role"],
  company: ["company", "vendor", "subcontractor", "contractor", "supplier", "agency"],
  dailyRate: ["daily rate", "rate", "wage", "daily wage", "rate per day", "per day"],
  skillLevel: ["skill level", "grade", "level"],
}

export const NO_USABLE_ROWS = "No usable rows found - check that the first row holds the column headers"

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim().replace(/\s+/g, " ")
}

export type RosterColumnMapping = Partial<Record<RosterFieldKey, string>>

export function mapRosterHeaders(headers: string[]): RosterColumnMapping {
  const mapping: RosterColumnMapping = {}
  const used = new Set<string>()
  for (const field of Object.keys(ROSTER_FIELD_ALIASES) as RosterFieldKey[]) {
    for (const alias of ROSTER_FIELD_ALIASES[field]) {
      const match = headers.find((h) => !used.has(h) && normalizeHeader(h) === alias)
      if (match) {
        mapping[field] = match
        used.add(match)
        break
      }
    }
  }
  return mapping
}

export type ParsedRosterRow = {
  rowNumber: number
  employeeCode: string
  /** true when this code was generated here rather than read from the sheet. */
  employeeCodeGenerated: boolean
  name: string
  trade: string | null
  skillLevel: string | null
  company: string | null
  dailyRate: number
  /** Rose messages for this row, in the "Row 3: Rate is blank" shape the item specifies. */
  errors: string[]
  /** Clay messages: imported, but not exactly as the sheet said. */
  warnings: string[]
  /** Present when the company named is not one this org knows: "Create vendor 'X'". */
  createVendorOffer: string | null
}

export type RosterParseResult = {
  rows: ParsedRosterRow[]
  mapping: RosterColumnMapping
  /** Every header actually present in the file, so the screen's mapping row can offer them. */
  headers: string[]
  totalRows: number
  blockingErrors: string[]
  /** Company names on the sheet that this org has no vendor for. */
  unknownCompanies: string[]
}

/**
 * Pure: the caller's corrections applied over the automatic header match.
 *
 * An empty string is a real instruction meaning "this field has no column in
 * this file" -- distinct from an absent key, which means "leave the automatic
 * match alone". A header the file does not contain is ignored rather than
 * trusted: the screen offers only real headers, so anything else came from a
 * stale or hand-edited request.
 */
export function applyRosterMappingOverride(
  auto: RosterColumnMapping,
  override: Record<string, unknown> | undefined,
  headers: string[]
): RosterColumnMapping {
  if (!override) return auto
  const result: RosterColumnMapping = { ...auto }
  for (const field of Object.keys(ROSTER_FIELD_ALIASES) as RosterFieldKey[]) {
    if (!(field in override)) continue
    const value = override[field]
    if (typeof value !== "string") continue
    const header = value.trim()
    if (!header) delete result[field]
    else if (headers.includes(header)) result[field] = header
  }
  return result
}

/** Pure: W-0001 style. Exported so the screen and the tests use the same shape as the writer. */
export function formatWorkerCode(n: number): string {
  return `W-${String(n).padStart(4, "0")}`
}

function cell(row: Record<string, unknown>, header: string | undefined): string {
  if (!header) return ""
  const value = row[header]
  return value === null || value === undefined ? "" : String(value).trim()
}

/**
 * Pure: turns spreadsheet rows into roster rows, applying the item's three
 * rules. `knownCompanies` is the org's existing vendor names, lower-cased --
 * passed in rather than queried so this stays a pure function.
 */
export function mapRowsToRosterEntries(
  rows: Record<string, unknown>[],
  mapping: RosterColumnMapping,
  knownCompanies: Map<string, string>
): { rows: ParsedRosterRow[]; blockingErrors: string[]; unknownCompanies: string[] } {
  if (!mapping.name) {
    return { rows: [], blockingErrors: ["No Name column found - a roster needs one column of worker names"], unknownCompanies: [] }
  }

  // Auto-numbering continues PAST whatever the sheet already used, so a sheet
  // that codes half its rows W-0001..W-0010 and leaves the rest blank does not
  // generate a code that collides with one of its own.
  const usedCodes = new Set<string>()
  let highest = 0
  for (const raw of rows) {
    const code = cell(raw, mapping.employeeCode)
    if (!code) continue
    usedCodes.add(code.toLowerCase())
    const match = /^W-(\d+)$/i.exec(code)
    if (match) highest = Math.max(highest, Number.parseInt(match[1]!, 10))
  }

  const seen = new Map<string, number>()
  const unknownCompanies = new Set<string>()
  const parsed: ParsedRosterRow[] = []

  rows.forEach((raw, index) => {
    // +2: the header is row 1, so the first data row is row 2 -- the number the
    // person looking at the sheet in Excel can actually find.
    const rowNumber = index + 2
    const name = cell(raw, mapping.name)
    // A wholly blank line in the middle of a sheet is not an error, it is
    // formatting. Only a row with SOME content and no name is a problem.
    const hasAnyContent = (Object.keys(mapping) as RosterFieldKey[]).some((f) => cell(raw, mapping[f]))
    if (!name && !hasAnyContent) return

    const errors: string[] = []
    const warnings: string[] = []
    if (!name) errors.push(`Row ${rowNumber}: Name is blank`)

    // parseAmount() degrades genuine garbage to 0, which is indistinguishable
    // from a real "0" -- isMalformedNumericCell() is the same guard the BOQ
    // importer uses (R-71/TC-51) so "TBD" in a rate column is caught rather
    // than becoming a worker on a zero daily rate.
    const rateRaw = cell(raw, mapping.dailyRate)
    const rateMalformed = isMalformedNumericCell(rateRaw)
    const dailyRate = rateMalformed ? 0 : parseAmount(rateRaw)
    if (!rateRaw) errors.push(`Row ${rowNumber}: Rate is blank`)
    else if (rateMalformed) errors.push(`Row ${rowNumber}: Rate "${rateRaw}" is not a number`)
    else if (dailyRate < 0) errors.push(`Row ${rowNumber}: Rate cannot be negative`)

    let employeeCode = cell(raw, mapping.employeeCode)
    let employeeCodeGenerated = false
    if (!employeeCode) {
      do {
        highest += 1
        employeeCode = formatWorkerCode(highest)
      } while (usedCodes.has(employeeCode.toLowerCase()))
      usedCodes.add(employeeCode.toLowerCase())
      employeeCodeGenerated = true
    }

    const trade = cell(raw, mapping.trade) || null
    const company = cell(raw, mapping.company) || null
    let createVendorOffer: string | null = null
    if (company && !knownCompanies.has(company.toLowerCase())) {
      createVendorOffer = `Create vendor '${company}'`
      unknownCompanies.add(company)
    }

    // Flagged, NEVER merged: two carpenters with the same name on one site is
    // an ordinary fact, and collapsing them would lose a man's attendance.
    const dupeKey = `${name.toLowerCase()}|${(trade ?? "").toLowerCase()}`
    const firstSeenAt = seen.get(dupeKey)
    if (name) {
      if (firstSeenAt !== undefined) {
        warnings.push(`Row ${rowNumber}: same name and trade as row ${firstSeenAt} - imported as a separate worker`)
      } else {
        seen.set(dupeKey, rowNumber)
      }
    }

    parsed.push({
      rowNumber, employeeCode, employeeCodeGenerated, name,
      trade, skillLevel: cell(raw, mapping.skillLevel) || null, company,
      dailyRate,
      errors, warnings, createVendorOffer,
    })
  })

  const blockingErrors = parsed.length === 0 ? [NO_USABLE_ROWS] : []
  return { rows: parsed, blockingErrors, unknownCompanies: [...unknownCompanies] }
}

/** Reads the uploaded file and returns the preview. No writes, no transaction. */
export async function parseRosterSpreadsheet(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  knownCompanies: Map<string, string>,
  mappingOverride?: Record<string, unknown>
): Promise<RosterParseResult> {
  let parsed
  try {
    parsed = await parseFile(buffer, fileName, mimeType)
  } catch {
    // parseFile throws on an empty sheet; a sheet whose rows are all blank is
    // the same situation to the person holding it, and needs the same sentence.
    return { rows: [], mapping: {}, headers: [], totalRows: 0, blockingErrors: [NO_USABLE_ROWS], unknownCompanies: [] }
  }
  const mapping = applyRosterMappingOverride(mapRosterHeaders(parsed.headers), mappingOverride, parsed.headers)
  const { rows, blockingErrors, unknownCompanies } = mapRowsToRosterEntries(parsed.rows as Record<string, unknown>[], mapping, knownCompanies)
  return { rows, mapping, headers: parsed.headers, totalRows: parsed.totalRows, blockingErrors, unknownCompanies }
}

/** The org's vendor names, lower-cased name -> id, for the unknown-company check. */
export async function loadKnownCompanies(orgId: string): Promise<Map<string, string>> {
  return withTenantContext({ orgId }, async (db) => {
    const suppliers = await db.query.erpSuppliers.findMany({
      where: and(eq(erpSuppliers.orgId, orgId), eq(erpSuppliers.isActive, true)),
      columns: { id: true, supplierName: true },
    })
    return new Map(suppliers.map((s) => [s.supplierName.trim().toLowerCase(), s.id]))
  })
}

export type RosterImportResult = {
  projectId: string
  createdRosterIds: string[]
  skippedRows: number
  createdVendorNames: string[]
}

/**
 * Commits a parsed roster.
 *
 * ONE TRANSACTION for the whole import, never a nested one (programme decision
 * D-06): a half-imported crew list is worse than none, and createRosterEntry()
 * opens its own withTenantContext per call, which would be one transaction per
 * worker on a five-connection pool.
 *
 * `createVendors` is opt-in and explicit -- the offer on a row is an offer, and
 * an import that silently created vendor master records would be a
 * side effect nobody asked for. Rows carrying errors are rejected outright
 * unless the caller passes skipRowsWithErrors, which is the screen's own
 * "Skip rows with errors" toggle.
 */
export async function importRosterEntries(
  ctx: { orgId: string },
  input: {
    projectId: string
    rows: ParsedRosterRow[]
    skipRowsWithErrors?: boolean
    createVendors?: boolean
  }
): Promise<RosterImportResult> {
  if (!input.projectId) throw new ServiceError("projectId is required", 400)

  const usable = input.skipRowsWithErrors ? input.rows.filter((r) => r.errors.length === 0) : input.rows
  const stillBroken = usable.filter((r) => r.errors.length > 0)
  if (stillBroken.length > 0) {
    throw new ServiceError(
      `${stillBroken.length} row(s) cannot be imported - fix them in the file, or choose "Skip rows with errors". Nothing was saved.`,
      400
    )
  }
  if (usable.length === 0) throw new ServiceError(NO_USABLE_ROWS, 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, input.projectId), eq(projects.orgId, ctx.orgId)) })
    if (!project) throw new ServiceError("Project not found", 404)

    const suppliers = await db.query.erpSuppliers.findMany({
      where: eq(erpSuppliers.orgId, ctx.orgId),
      columns: { id: true, supplierName: true },
    })
    const vendorIdByName = new Map(suppliers.map((s) => [s.supplierName.trim().toLowerCase(), s.id]))
    const createdVendorNames: string[] = []

    if (input.createVendors) {
      const missing = [...new Set(
        usable.map((r) => r.company?.trim()).filter((c): c is string => !!c && !vendorIdByName.has(c.toLowerCase()))
      )]
      for (const name of missing) {
        const [vendor] = await db.insert(erpSuppliers).values({ orgId: ctx.orgId, supplierName: name, supplierType: "subcontractor" }).returning()
        vendorIdByName.set(name.toLowerCase(), vendor!.id)
        createdVendorNames.push(name)
      }
    }

    const createdRosterIds: string[] = []
    for (const row of usable) {
      // A company we were not asked to create stays UNLINKED rather than being
      // silently attached to a similarly-named vendor -- the worker is still
      // imported, which is what the sheet was for.
      const vendorId = row.company ? vendorIdByName.get(row.company.trim().toLowerCase()) ?? null : null
      const [created] = await db.insert(constructionLabourRoster).values({
        orgId: ctx.orgId, projectId: input.projectId, name: row.name,
        employeeCode: row.employeeCode || null, trade: row.trade, skillLevel: row.skillLevel,
        vendorId, dailyRate: String(row.dailyRate),
      }).returning({ id: constructionLabourRoster.id })
      createdRosterIds.push(created!.id)
    }

    return {
      projectId: input.projectId,
      createdRosterIds,
      skippedRows: input.rows.length - usable.length,
      createdVendorNames,
    }
  })
}
