// R67 D-34 (R-091): the roster spreadsheet parser. Pure -- mapRowsToRosterEntries
// takes already-parsed rows, so these are real assertions about the rules,
// not about xlsx.
//
// The distinction that matters, and that the import screen renders: a row that
// CANNOT be written is skipped and named (blocking, per row); a row with no
// trade IS written but flagged, because a blank trade is exactly what makes
// every trade-wise figure downstream read "Unspecified". A file with no Name
// column at all throws, because there is nothing to preview.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  mapRosterHeaders,
  mapRowsToRosterEntries,
  rosterImportSummary,
  ServiceError,
} from "./construction-roster-import-service"

const HEADERS = ["ID", "Name", "Trade", "Company", "Daily Rate"]
const MAPPING = mapRosterHeaders(HEADERS)

function rows(...values: Record<string, unknown>[]) {
  return values
}

describe("mapRosterHeaders", () => {
  test("maps the customer's own column names", () => {
    expect(MAPPING).toEqual({ employeeCode: "ID", name: "Name", trade: "Trade", company: "Company", dailyRate: "Daily Rate" })
  })

  test("matches on meaning, not on exact spelling or case", () => {
    expect(mapRosterHeaders(["Employee ID", "Worker Name", "Skill", "Subcontractor", "Rate per day"]))
      .toEqual({ employeeCode: "Employee ID", name: "Worker Name", trade: "Skill", company: "Subcontractor", dailyRate: "Rate per day" })
  })

  test("a sheet with only Name and Rate still maps -- the rest are genuinely optional", () => {
    expect(mapRosterHeaders(["Name", "Rate"])).toEqual({ name: "Name", dailyRate: "Rate" })
  })
})

describe("mapRowsToRosterEntries", () => {
  test("parses a clean sheet", () => {
    const { entries, issues } = mapRowsToRosterEntries(
      rows(
        { ID: "EMP-001", Name: "Ali", Trade: "Mason", Company: "Skyline Labour", "Daily Rate": "120" },
        { ID: "", Name: "Bilal", Trade: "Electrician", Company: "", "Daily Rate": "1,300" }
      ),
      MAPPING
    )
    expect(issues).toEqual([])
    // R67 D-68 folded in by the integration merge: every row now carries
    // skillLevel, null when the sheet has no such column. Asserted here rather
    // than loosened away, so the shape stays exact.
    expect(entries).toEqual([
      { employeeCode: "EMP-001", name: "Ali", trade: "Mason", company: "Skyline Labour", skillLevel: null, dailyRate: 120, sheetRow: 2, skipped: false },
      { employeeCode: null, name: "Bilal", trade: "Electrician", company: null, skillLevel: null, dailyRate: 1300, sheetRow: 3, skipped: false },
    ])
  })

  test("row numbers are 1-based over the SHEET, header included -- the first data row is row 2", () => {
    const { issues } = mapRowsToRosterEntries(rows({ Name: "", Trade: "Mason", "Daily Rate": "120" }), MAPPING)
    expect(issues[0].message).toBe("Row 2: no worker name")
  })

  test("a row with no name is skipped and named, not imported blank", () => {
    const { entries, issues } = mapRowsToRosterEntries(rows({ ID: "X", Name: "  ", Trade: "Mason", "Daily Rate": "120" }), MAPPING)
    expect(entries[0].skipped).toBe(true)
    expect(issues).toContainEqual({ row: 2, message: "Row 2: no worker name", blocking: true })
  })

  test("a missing daily rate is skipped -- a worker with no rate silently costs nothing", () => {
    const { entries, issues } = mapRowsToRosterEntries(rows({ Name: "Ali", Trade: "Mason", "Daily Rate": "" }), MAPPING)
    expect(entries[0].skipped).toBe(true)
    expect(issues).toContainEqual({ row: 2, message: "Row 2: no daily rate", blocking: true })
  })

  test("a garbage daily rate is caught rather than silently imported as 0", () => {
    const { entries, issues } = mapRowsToRosterEntries(rows({ Name: "Ali", Trade: "Mason", "Daily Rate": "TBD" }), MAPPING)
    expect(entries[0].skipped).toBe(true)
    expect(issues).toContainEqual({ row: 2, message: "Row 2: Daily Rate is not a number", blocking: true })
  })

  test("a negative daily rate is refused", () => {
    const { entries, issues } = mapRowsToRosterEntries(rows({ Name: "Ali", Trade: "Mason", "Daily Rate": "-40" }), MAPPING)
    expect(entries[0].skipped).toBe(true)
    expect(issues).toContainEqual({ row: 2, message: "Row 2: Daily Rate cannot be negative", blocking: true })
  })

  test("a rate written as 'AED 120' or '(50)' is a real number, not garbage", () => {
    const { entries, issues } = mapRowsToRosterEntries(
      rows({ Name: "Ali", Trade: "Mason", "Daily Rate": "AED 120" }),
      MAPPING
    )
    expect(entries[0].dailyRate).toBe(120)
    expect(issues).toEqual([])
  })

  test("a missing trade is flagged but NOT skipped -- the worker still belongs on the roster", () => {
    const { entries, issues } = mapRowsToRosterEntries(rows({ Name: "Ali", Trade: "", "Daily Rate": "120" }), MAPPING)
    expect(entries[0].skipped).toBe(false)
    expect(entries[0].trade).toBeNull()
    expect(issues).toContainEqual({
      row: 2,
      message: "Row 2: no trade -- this worker will not appear in any trade-wise total",
      blocking: false,
    })
  })

  test("a wholly blank row is padding, not an error worth naming", () => {
    const { entries, issues } = mapRowsToRosterEntries(rows({ ID: "", Name: "", Trade: "", Company: "", "Daily Rate": "" }), MAPPING)
    expect(entries).toEqual([])
    expect(issues).toEqual([])
  })

  test("a sheet with no Name column at all throws -- there is nothing to preview", () => {
    expect(() => mapRowsToRosterEntries(rows({ Trade: "Mason", "Daily Rate": "120" }), { trade: "Trade", dailyRate: "Daily Rate" }))
      .toThrow(ServiceError)
  })

  test("a sheet with no Daily Rate column at all throws", () => {
    expect(() => mapRowsToRosterEntries(rows({ Name: "Ali" }), { name: "Name" })).toThrow(ServiceError)
  })
})

describe("rosterImportSummary", () => {
  test("names the skipped rows in the primary action, so the count is never a surprise", () => {
    const { entries } = mapRowsToRosterEntries(
      rows(
        { Name: "Ali", Trade: "Mason", "Daily Rate": "120" },
        { Name: "", Trade: "Mason", "Daily Rate": "120" },
        { Name: "Bilal", Trade: "Mason", "Daily Rate": "TBD" }
      ),
      MAPPING
    )
    expect(rosterImportSummary(entries)).toEqual({ importable: 1, skipped: 2, label: "Import 1 row (2 skipped)" })
  })

  test("a clean file does not mention skipping at all", () => {
    const { entries } = mapRowsToRosterEntries(
      rows(
        { Name: "Ali", Trade: "Mason", "Daily Rate": "120" },
        { Name: "Bilal", Trade: "Mason", "Daily Rate": "130" }
      ),
      MAPPING
    )
    expect(rosterImportSummary(entries).label).toBe("Import 2 rows")
  })

  test("an empty file reports zero rather than pretending it can import", () => {
    expect(rosterImportSummary([])).toEqual({ importable: 0, skipped: 0, label: "Import 0 rows" })
  })
})

// ── R67 lane D22 (item D-68, rec R-258), FOLDED IN by the integration merge ──
// Lane D22 wrote a second roster importer with its own tests. Its parser is
// gone (see the service header: one sheet, one set of rules), so these are the
// two D-68 rules that WERE folded into this parser, re-aimed at it. Nothing
// D-68 proved about these two rules has stopped being proved.
//
// Its other assertions are not orphaned either: blank-ID auto-numbering is
// createRosterEntry's job and is tested in construction-labour-service.test.ts,
// and the two capabilities that were not folded in (the screen-correctable
// mapping row, and creating an unmatched vendor from the import screen) had
// their tests removed with the code they tested, which the PR body names.
describe("R67 D-68 folded in -- skill level, and duplicates flagged not merged", () => {
  test("a Skill Level column is mapped, and 'Skill' still means trade", () => {
    const mapping = mapRosterHeaders(["Name", "Skill", "Skill Level", "Daily Rate"])
    expect(mapping.trade).toBe("Skill")
    expect(mapping.skillLevel).toBe("Skill Level")
  })

  test("the sheet's skill grade reaches the row -- the roster column existed and nothing could fill it", () => {
    const mapping = mapRosterHeaders(["Name", "Trade", "Grade", "Daily Rate"])
    const { entries } = mapRowsToRosterEntries(
      rows({ Name: "Mohammed Ali", Trade: "Carpenter", Grade: "Skilled", "Daily Rate": "180" }),
      mapping
    )
    expect(entries[0]!.skillLevel).toBe("Skilled")
  })

  test("a sheet with no skill-level column leaves it null, never an empty string", () => {
    const { entries } = mapRowsToRosterEntries(
      rows({ Name: "Mohammed Ali", Trade: "Carpenter", "Daily Rate": "180" }),
      MAPPING
    )
    expect(entries[0]!.skillLevel).toBeNull()
  })

  test("both rows of a name+trade duplicate survive, and the second says which row it repeats", () => {
    const { entries, issues } = mapRowsToRosterEntries(
      rows(
        { Name: "Mohammed Ali", Trade: "Carpenter", "Daily Rate": "180" },
        { Name: "Mohammed Ali", Trade: "Carpenter", "Daily Rate": "180" }
      ),
      MAPPING
    )
    expect(entries).toHaveLength(2)
    expect(issues.filter((i) => i.row === 3 && i.message.includes("same name and trade"))).toHaveLength(1)
    expect(issues.find((i) => i.message.includes("same name and trade"))!.message)
      .toBe("Row 3: same name and trade as row 2 -- imported as a separate worker, not merged")
  })

  test("the same name in a DIFFERENT trade is not a duplicate at all", () => {
    const { issues } = mapRowsToRosterEntries(
      rows(
        { Name: "Mohammed Ali", Trade: "Carpenter", "Daily Rate": "180" },
        { Name: "Mohammed Ali", Trade: "Mason", "Daily Rate": "170" }
      ),
      MAPPING
    )
    expect(issues.filter((i) => i.message.includes("same name and trade"))).toHaveLength(0)
  })

  test("a duplicate is a warning, not a reason to skip -- both workers still import", () => {
    const { entries, issues } = mapRowsToRosterEntries(
      rows(
        { Name: "Mohammed Ali", Trade: "Carpenter", "Daily Rate": "180" },
        { Name: "Mohammed Ali", Trade: "Carpenter", "Daily Rate": "180" }
      ),
      MAPPING
    )
    expect(entries.every((e) => !e.skipped)).toBe(true)
    expect(issues.find((i) => i.message.includes("same name and trade"))!.blocking).toBe(false)
    expect(rosterImportSummary(entries).importable).toBe(2)
  })
})
