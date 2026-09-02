/// <reference types="bun-types" />
// R67 lane D22 (item D-68, rec R-258). The roster importer's pure half: header
// matching, and the three rules the item names -- a blank ID auto-numbers, an
// unknown company is offered rather than invented, and duplicates by name plus
// trade are flagged rather than merged.
//
// No DB and no xlsx here, the same discipline schedule-import-service.test.ts
// and construction-boq-import-service.test.ts follow: parseRosterSpreadsheet()
// is one parseFile() call over these functions, and importRosterEntries() is
// one withTenantContext write, both exercised through the API surface.
import { describe, expect, test } from "bun:test"
import {
  ROSTER_FIELD_ALIASES, applyRosterMappingOverride, formatWorkerCode, mapRosterHeaders, mapRowsToRosterEntries, NO_USABLE_ROWS,
} from "./construction-roster-import-service"

const HEADERS = ["ID", "Name", "Trade", "Company", "Daily Rate"]
const MAPPING = mapRosterHeaders(HEADERS)
const NO_COMPANIES = new Map<string, string>()

function sheet(rows: Record<string, unknown>[]) {
  return mapRowsToRosterEntries(rows, MAPPING, NO_COMPANIES)
}

describe("mapRosterHeaders", () => {
  test("matches the item's own column set", () => {
    expect(MAPPING).toEqual({ employeeCode: "ID", name: "Name", trade: "Trade", company: "Company", dailyRate: "Daily Rate" })
  })

  test("accepts the synonyms a real contractor's sheet uses", () => {
    const mapping = mapRosterHeaders(["Worker Name", "Skill", "Subcontractor", "Wage", "Emp ID"])
    expect(mapping.name).toBe("Worker Name")
    expect(mapping.trade).toBe("Skill")
    expect(mapping.company).toBe("Subcontractor")
    expect(mapping.dailyRate).toBe("Wage")
    expect(mapping.employeeCode).toBe("Emp ID")
  })

  test("never assigns one column to two fields", () => {
    const mapping = mapRosterHeaders(["Code"])
    const assigned = Object.values(mapping)
    expect(new Set(assigned).size).toBe(assigned.length)
  })

  test("every field has at least one alias, so no column is unreachable", () => {
    for (const aliases of Object.values(ROSTER_FIELD_ALIASES)) expect(aliases.length).toBeGreaterThan(0)
  })
})

describe("a blank ID auto-numbers W-0001", () => {
  test("numbers from W-0001 when the sheet codes nobody", () => {
    const { rows } = sheet([
      { Name: "Mohammed Ali", Trade: "Carpenter", "Daily Rate": "180" },
      { Name: "Suresh Kumar", Trade: "Mason", "Daily Rate": "160" },
    ])
    expect(rows.map((r) => r.employeeCode)).toEqual(["W-0001", "W-0002"])
    expect(rows.every((r) => r.employeeCodeGenerated)).toBe(true)
  })

  test("continues PAST the codes the sheet already uses, so it never collides with its own", () => {
    const { rows } = sheet([
      { ID: "W-0007", Name: "Mohammed Ali", Trade: "Carpenter", "Daily Rate": "180" },
      { Name: "Suresh Kumar", Trade: "Mason", "Daily Rate": "160" },
    ])
    expect(rows[0]!.employeeCode).toBe("W-0007")
    expect(rows[0]!.employeeCodeGenerated).toBe(false)
    expect(rows[1]!.employeeCode).toBe("W-0008")
  })

  test("keeps a customer's own non-W code exactly as written", () => {
    const { rows } = sheet([{ ID: "EMP/2026/44", Name: "Ravi", Trade: "Painter", "Daily Rate": "150" }])
    expect(rows[0]!.employeeCode).toBe("EMP/2026/44")
    expect(rows[0]!.employeeCodeGenerated).toBe(false)
  })

  test("formatWorkerCode is the shared shape", () => {
    expect(formatWorkerCode(1)).toBe("W-0001")
    expect(formatWorkerCode(1234)).toBe("W-1234")
    expect(formatWorkerCode(12345)).toBe("W-12345")
  })
})

describe("an unknown company is offered, never invented", () => {
  test("carries the offer in the exact words the item specifies", () => {
    const { rows, unknownCompanies } = sheet([
      { Name: "Ravi", Trade: "Painter", Company: "Al Rashid Contracting", "Daily Rate": "150" },
    ])
    expect(rows[0]!.createVendorOffer).toBe("Create vendor 'Al Rashid Contracting'")
    expect(unknownCompanies).toEqual(["Al Rashid Contracting"])
  })

  test("a company the org already has is not offered again", () => {
    const known = new Map([["al rashid contracting", "sup-1"]])
    const { rows, unknownCompanies } = mapRowsToRosterEntries(
      [{ Name: "Ravi", Trade: "Painter", Company: "Al Rashid Contracting", "Daily Rate": "150" }],
      MAPPING, known
    )
    expect(rows[0]!.createVendorOffer).toBeNull()
    expect(unknownCompanies).toEqual([])
  })

  test("a row with no company at all is neither offered nor an error -- direct labour is normal", () => {
    const { rows } = sheet([{ Name: "Ravi", Trade: "Painter", "Daily Rate": "150" }])
    expect(rows[0]!.createVendorOffer).toBeNull()
    expect(rows[0]!.errors).toEqual([])
  })

  test("the same unknown company across many rows is offered once", () => {
    const { unknownCompanies } = sheet([
      { Name: "A", Trade: "Painter", Company: "Zenith Labour", "Daily Rate": "150" },
      { Name: "B", Trade: "Mason", Company: "Zenith Labour", "Daily Rate": "150" },
    ])
    expect(unknownCompanies).toEqual(["Zenith Labour"])
  })
})

describe("duplicates by name plus trade are flagged, never merged", () => {
  test("both rows survive, and the second says which row it repeats", () => {
    const { rows } = sheet([
      { Name: "Mohammed Ali", Trade: "Carpenter", "Daily Rate": "180" },
      { Name: "Mohammed Ali", Trade: "Carpenter", "Daily Rate": "180" },
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0]!.warnings).toEqual([])
    expect(rows[1]!.warnings[0]).toBe("Row 3: same name and trade as row 2 - imported as a separate worker")
  })

  test("the same name in a DIFFERENT trade is not a duplicate at all", () => {
    const { rows } = sheet([
      { Name: "Mohammed Ali", Trade: "Carpenter", "Daily Rate": "180" },
      { Name: "Mohammed Ali", Trade: "Mason", "Daily Rate": "170" },
    ])
    expect(rows[1]!.warnings).toEqual([])
  })

  test("a duplicate is a warning, not an error -- it still imports", () => {
    const { rows } = sheet([
      { Name: "Mohammed Ali", Trade: "Carpenter", "Daily Rate": "180" },
      { Name: "Mohammed Ali", Trade: "Carpenter", "Daily Rate": "180" },
    ])
    expect(rows[1]!.errors).toEqual([])
  })
})

describe("per-row messages name the row the way the sheet numbers it", () => {
  test("a blank rate reads exactly 'Row 3: Rate is blank'", () => {
    const { rows } = sheet([
      { Name: "Ravi", Trade: "Painter", "Daily Rate": "150" },
      { Name: "Suresh", Trade: "Mason" },
    ])
    expect(rows[1]!.rowNumber).toBe(3)
    expect(rows[1]!.errors).toEqual(["Row 3: Rate is blank"])
  })

  test("a rate that is not a number is caught, not degraded to a worker on zero pay", () => {
    const { rows } = sheet([{ Name: "Ravi", Trade: "Painter", "Daily Rate": "TBD" }])
    expect(rows[0]!.errors).toEqual(['Row 2: Rate "TBD" is not a number'])
  })

  test("a formatted rate is accepted, not flagged", () => {
    const { rows } = sheet([{ Name: "Ravi", Trade: "Painter", "Daily Rate": "AED 1,250" }])
    expect(rows[0]!.errors).toEqual([])
    expect(rows[0]!.dailyRate).toBe(1250)
  })

  test("a negative rate is refused", () => {
    const { rows } = sheet([{ Name: "Ravi", Trade: "Painter", "Daily Rate": "-50" }])
    expect(rows[0]!.errors).toEqual(["Row 2: Rate cannot be negative"])
  })

  test("a row with content but no name is an error; a wholly blank row is just formatting", () => {
    const { rows } = sheet([
      { Name: "Ravi", Trade: "Painter", "Daily Rate": "150" },
      { Name: "", Trade: "", Company: "", "Daily Rate": "" },
      { Trade: "Mason", "Daily Rate": "160" },
    ])
    expect(rows).toHaveLength(2)
    expect(rows[1]!.errors).toContain("Row 4: Name is blank")
  })
})

describe("a sheet that cannot be read at all", () => {
  test("a sheet with no Name column says so instead of importing nothing silently", () => {
    const result = mapRowsToRosterEntries([{ Foo: "bar" }], mapRosterHeaders(["Foo"]), NO_COMPANIES)
    expect(result.rows).toEqual([])
    expect(result.blockingErrors[0]).toContain("No Name column found")
  })

  test("a sheet with headers but no usable rows says so", () => {
    const result = sheet([])
    expect(result.blockingErrors).toEqual([NO_USABLE_ROWS])
  })
})

describe("applyRosterMappingOverride -- the screen's correctable mapping row", () => {
  const headers = ["ID", "Name", "Trade", "Company", "Daily Rate", "Notes"]
  const auto = mapRosterHeaders(headers)

  test("no override leaves the automatic match exactly as it was", () => {
    expect(applyRosterMappingOverride(auto, undefined, headers)).toEqual(auto)
    expect(applyRosterMappingOverride(auto, {}, headers)).toEqual(auto)
  })

  test("re-points a field at another real column in the file", () => {
    const result = applyRosterMappingOverride(auto, { trade: "Notes" }, headers)
    expect(result.trade).toBe("Notes")
    expect(result.name).toBe("Name")
  })

  test("an empty string means 'this field has no column here', and removes it", () => {
    const result = applyRosterMappingOverride(auto, { company: "" }, headers)
    expect("company" in result).toBe(false)
  })

  test("a header the file does not contain is ignored, never trusted", () => {
    const result = applyRosterMappingOverride(auto, { name: "Column That Is Not There" }, headers)
    expect(result.name).toBe("Name")
  })

  test("a non-string value is ignored rather than corrupting the mapping", () => {
    const result = applyRosterMappingOverride(auto, { name: 7, trade: null }, headers)
    expect(result.name).toBe("Name")
    expect(result.trade).toBe("Trade")
  })
})
