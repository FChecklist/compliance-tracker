/// <reference types="bun-types" />
// R67 E-12 (R-136). The report document, asserted on the REAL bytes: what the
// header row of a generated .xlsx actually says, in what order, and what the
// grand-total row carries.
import { describe, expect, test } from "bun:test"
import {
  DESIGNER_TIMESHEET_SCHEMA,
  EMPTY,
  REPORT_EXPORT_SCHEMAS,
  buildExportRows,
  designerTimesheetExportRows,
  reportCsv,
  reportExportSchema,
  reportXlsxBuffer,
  schemaColumnLabels,
  sumColumn,
  workProgressExportRows,
  workProgressExportSchema,
  xlsxRows,
} from "./report-export"

// Two BOQ lines, shaped exactly as boqBudgetVarianceReport projects them.
const LINES = [
  {
    sNo: 1, category: "Civil", code: "1.1", description: "Excavation in ordinary soil",
    quantity: 120, rate: 45, amount: 5400, budget: 4320,
    vendorId: "v-1", vendorName: "Alpha Contracting", vendorAmount: 4500, variance: 180,
  },
  {
    sNo: 2, category: "Paint", code: "2.1", description: "Two coats emulsion, internal",
    quantity: 300, rate: 12, amount: 3600, budget: 2880,
    vendorId: null, vendorName: null, vendorAmount: null, variance: null,
  },
]

describe("the project-status document (R67 E-12)", () => {
  test("ACCEPTANCE: the xlsx export's first row is exactly the schema's column labels", () => {
    const schema = reportExportSchema("project-status")!
    const buffer = reportXlsxBuffer(schema, LINES)
    const rows = xlsxRows(buffer)

    expect(rows[0]).toEqual(["Category", "Code", "Description", "Budget", "Vendor", "Vendor amount"])
    // ...and that IS the schema, not a coincidence of this fixture.
    expect(rows[0]).toEqual(schemaColumnLabels(schema))
  })

  test("the rows under that header are the lines, in schema order, with a grand total last", () => {
    const schema = reportExportSchema("project-status")!
    const rows = xlsxRows(reportXlsxBuffer(schema, LINES))

    expect(rows[1]).toEqual(["Civil", "1.1", "Excavation in ordinary soil", 4320, "Alpha Contracting", 4500])
    // An absent vendor is the en dash, never 0 and never blank -- "not let" and
    // "let for nothing" are different facts about a BOQ line.
    expect(rows[2]).toEqual(["Paint", "2.1", "Two coats emulsion, internal", 2880, EMPTY, EMPTY])
    expect(rows[3]).toEqual(["Grand Total", "", "", 7200, "", 4500])
  })

  test("a total the service already single-rounded is used AS GIVEN, never re-summed from the display figures", () => {
    const schema = reportExportSchema("project-status")!
    // The service's own totalBudget, which rounds once at the end over raw
    // values; re-adding the rounded per-line figures would drift from it.
    const rows = buildExportRows(schema, LINES, { budget: 7199.99, vendorAmount: 4500 })
    expect(rows[rows.length - 1]).toMatchObject({ Budget: 7199.99, "Vendor amount": 4500 })
  })
})

describe("the budget-variance document keeps Sumeet 6.png II(iii)'s columns (R67 E-12)", () => {
  test("its header is the eleven columns the Cost Variance table shows, in the same order", () => {
    const schema = reportExportSchema("budget-variance")!
    expect(xlsxRows(reportXlsxBuffer(schema, LINES))[0]).toEqual([
      "S.No", "Category", "Code", "Description", "Qty", "Rate", "Amt", "Budget", "Vendor", "Vendor Amt", "Variance",
    ])
  })

  test("its grand total carries the words in the S.No column and totals only the money columns", () => {
    const schema = reportExportSchema("budget-variance")!
    const rows = buildExportRows(schema, LINES)
    expect(rows[rows.length - 1]).toEqual({
      "S.No": "Grand Total", Category: "", Code: "", Description: "", Qty: "", Rate: "", Amt: "",
      Budget: 7200, Vendor: "", "Vendor Amt": 4500, Variance: 180,
    })
  })

  test("the CSV is the same document -- same header, same order, same grand total", () => {
    const schema = reportExportSchema("budget-variance")!
    const lines = reportCsv(schema, LINES).split("\n")
    expect(lines[0]).toBe("S.No,Category,Code,Description,Qty,Rate,Amt,Budget,Vendor,Vendor Amt,Variance")
    expect(lines[lines.length - 1]).toBe("Grand Total,,,,,,,7200,,4500,180")
  })
})

describe("the rules the documents share (R67 E-12)", () => {
  test("no column label is a camelCase key -- that defect is what the schema exists to close", () => {
    for (const schema of Object.values(REPORT_EXPORT_SCHEMAS)) {
      for (const column of schema.columns) {
        expect(column.label).not.toMatch(/^[a-z]+[A-Z]/)
        expect(column.label.length).toBeGreaterThan(0)
      }
    }
  })

  test("every totalled column really exists on the schema, so a total can never be orphaned", () => {
    for (const schema of Object.values(REPORT_EXPORT_SCHEMAS)) {
      const keys = new Set(schema.columns.map((c) => c.key))
      for (const key of schema.totals ?? []) expect(keys.has(key)).toBe(true)
      if (schema.totalLabelColumn) expect(keys.has(schema.totalLabelColumn)).toBe(true)
    }
  })

  test("a row missing a schema key still fills the column, so the header can never shift under the data", () => {
    const schema = reportExportSchema("project-status")!
    const rows = xlsxRows(reportXlsxBuffer(schema, [{ code: "9.9" }]))
    expect(rows[0]).toEqual(schemaColumnLabels(schema))
    expect(rows[1]).toEqual([EMPTY, "9.9", EMPTY, EMPTY, EMPTY, EMPTY])
  })

  test("a column with no figure anywhere totals to null, not to zero", () => {
    expect(sumColumn([{ vendorAmount: null }, { vendorAmount: null }], "vendorAmount")).toBeNull()
    expect(sumColumn([{ vendorAmount: 1.005 }, { vendorAmount: 2.005 }], "vendorAmount")).toBe(3.01)
  })

  test("an unknown slug has no schema, and says so rather than inventing one", () => {
    expect(reportExportSchema("not-a-report")).toBeNull()
  })
})

// R67 E-18 (R-178) / E-20 (R-208). The Work Progress Report's own document --
// the one the XLSX relay builds, described in the same file the Cost Variance
// and Project Status documents are described in.
describe("workProgressExportSchema / workProgressExportRows (R67 E-18 / E-20)", () => {
  // Two lines: a parent worth 1000 and its weighted sub-task worth 400. The
  // sub-task's amount is DERIVED from the parent, which is why the screen's own
  // grand total counts parents only.
  const SOURCE = [
    {
      code: "1.1", description: "Excavation", categoryName: "Civil", isChild: false,
      poQty: 100, unit: "m3", rate: 10, contractAmt: 1000,
      prevQty: 20, currentQty: 30, thirdQty: 50,
      prevAmt: 200, currentAmt: 300, thirdAmt: 500,
      prevPct: 20, currentPct: 30, thirdPct: 50,
    },
    {
      code: "1.1.a", description: "Hand excavation", categoryName: "Civil", isChild: true,
      poQty: 40, unit: "m3", rate: 10, contractAmt: 400,
      prevQty: 10, currentQty: 5, thirdQty: 15,
      prevAmt: 100, currentAmt: 50, thirdAmt: 150,
      prevPct: 25, currentPct: 12.5, thirdPct: 37.5,
    },
  ]

  test("the header of a real .xlsx is the schema's labels, in order, with PO Qty where the screen puts it", () => {
    const schema = workProgressExportSchema("total")
    const { rows, totals } = workProgressExportRows(SOURCE, "total")
    const grid = xlsxRows(reportXlsxBuffer(schema, rows, totals))
    expect(grid[0]).toEqual([
      "S.No", "Category", "Code", "Description", "PO Qty", "Unit", "Rate", "Amt",
      "% Previous", "% Current", "% Total",
      "Qty Previous", "Qty Current", "Qty Total",
      "Amt Previous", "Amt Current", "Amt Total",
    ])
    // PO Qty (index 4) sits between Description and Unit, exactly as on screen.
    expect(grid[1][4]).toBe(100)
    expect(grid[1][5]).toBe("m3")
  })

  test("the third column says which of Total and Balance the numbers under it are", () => {
    expect(schemaColumnLabels(workProgressExportSchema("balance"))).toContain("Amt Balance")
    expect(schemaColumnLabels(workProgressExportSchema("balance"))).toContain("% Balance")
    expect(schemaColumnLabels(workProgressExportSchema("total"))).toContain("Amt Total")
  })

  test("a child line's percentages are blank in the file, exactly as WPR-06 blanks them on screen", () => {
    const { rows } = workProgressExportRows(SOURCE, "total")
    expect(rows[1].percentPrevious).toBeNull()
    expect(rows[1].percentThird).toBeNull()
    // Its quantities and amounts are real and are NOT blanked -- only the
    // percentages are a parent-only figure.
    expect(rows[1].qtyThird).toBe(15)
  })

  test("the grand total counts parent lines only for Amt, and every row for the Amount band -- the screen's own rule", () => {
    const { totals } = workProgressExportRows(SOURCE, "total")
    expect(totals.amount).toBe(1000) // 1000 only: the 400 sub-task is derived from it
    expect(totals.amtPrevious).toBe(300) // 200 + 100, every row
    expect(totals.amtCurrent).toBe(350)
    expect(totals.amtThird).toBe(650)
  })

  test("the grand-total row lands in the file under the right labels", () => {
    const schema = workProgressExportSchema("total")
    const { rows, totals } = workProgressExportRows(SOURCE, "total")
    const grid = xlsxRows(reportXlsxBuffer(schema, rows, totals))
    const last = grid[grid.length - 1] as unknown[]
    expect(last[0]).toBe("Grand Total")
    expect(last[7]).toBe(1000)
    expect(last[16]).toBe(650)
  })

  test("the work-progress slug resolves to a schema, so the export route has no opinion of its own", () => {
    expect(reportExportSchema("work-progress")?.slug).toBe("work-progress")
    expect(reportCsv(workProgressExportSchema("total"), [], {}).split("\n")[0]).toContain("PO Qty")
  })
})

// R67 E-16 (R-150). The Design Studio document: four cuts of the same approved
// hours, one grid, and deliberately NO grand total.
describe("designerTimesheetExportRows / DESIGNER_TIMESHEET_SCHEMA (R67 E-16)", () => {
  const SOURCE = {
    projectScoped: {
      byUser: [{ userId: "u1", userName: "Alice", totalHours: 12 }],
      byCategory: [
        { category: "Design Development", hours: 20, actual: 1000, budget: null },
        { category: "Concept", hours: 5, actual: 250, budget: null },
      ],
      byDesignerStatus: [
        { status: "active", budget: 1000, actual: 1250, variance: 250 },
        { status: "inactive", budget: 0, actual: 0, variance: 0 },
      ],
    },
    orgWide: {
      byDesigner: [{ userId: "u1", userName: "Alice", hours: 25, budget: 1000, actual: 1250, variance: 250 }],
      byProject: [{ projectId: "p1", projectName: "Cedar Heights Villa", budget: 1000, actual: 1250, variance: 250 }],
    },
  }

  test("the header of a real .xlsx is the schema's labels, in order", () => {
    const grid = xlsxRows(reportXlsxBuffer(DESIGNER_TIMESHEET_SCHEMA, designerTimesheetExportRows(SOURCE)))
    expect(grid[0]).toEqual(["Section", "Item", "Budget", "Actual", "Variance", "Hours"])
  })

  test("every one of the four sections is present, in the order the screen stacks them", () => {
    const sections = designerTimesheetExportRows(SOURCE).map((r) => r.section)
    expect([...new Set(sections)]).toEqual(["By Category", "By Designer", "By Project", "Designer Status"])
  })

  test("a category row has NO budget -- null, never 0, because the source has no per-category budget", () => {
    const category = designerTimesheetExportRows(SOURCE).find((r) => r.section === "By Category")!
    expect(category.budget).toBeNull()
    expect(category.variance).toBeNull()
    // ...and the file prints the en dash for it, not a zero.
    const grid = xlsxRows(reportXlsxBuffer(DESIGNER_TIMESHEET_SCHEMA, designerTimesheetExportRows(SOURCE)))
    expect(grid[1][2]).toBe(EMPTY)
  })

  test("variance is actual minus budget, positive meaning OVER -- the same sign as the Budget vs Actual view", () => {
    const designer = designerTimesheetExportRows(SOURCE).find((r) => r.section === "By Designer")!
    expect(designer.variance).toBe(250)
  })

  test("a designer's Hours are the hours logged on THIS project, not their org-wide total", () => {
    const designer = designerTimesheetExportRows(SOURCE).find((r) => r.section === "By Designer")!
    // byDesigner.hours is 25 org-wide; byUser says 12 were logged here.
    expect(designer.hours).toBe(12)
  })

  test("there is NO grand-total row: the four cuts are overlapping views of the same hours", () => {
    // Adding a designer's actual to a category's actual to a project's actual
    // counts the same hour three times, so a total there would not be a fact.
    expect(DESIGNER_TIMESHEET_SCHEMA.totals).toBeUndefined()
    const rows = designerTimesheetExportRows(SOURCE)
    const grid = xlsxRows(reportXlsxBuffer(DESIGNER_TIMESHEET_SCHEMA, rows))
    expect(grid).toHaveLength(rows.length + 1) // header + rows, no total row
    expect(grid[grid.length - 1][0]).not.toBe("Grand Total")
  })

  test("the slug resolves to the schema, so the export route has no opinion of its own", () => {
    expect(reportExportSchema("designer-timesheet")).toBe(DESIGNER_TIMESHEET_SCHEMA)
  })
})
