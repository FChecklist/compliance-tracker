/// <reference types="bun-types" />
// R67 E-04 (R-079) -- "where is my Work Progress Report?" had three answers,
// and this file held the third one.
//
// The catalog's construction entries are STATIC rows built in code (verified
// against the live database on 2026-09-03: `SELECT id, status FROM
// compliance.report_definitions WHERE name ILIKE '%work progress%'` returns
// zero rows, so there is no report_definitions status to migrate). That means
// the sentence a PROJEXA user reads on the Full Catalog card is decided right
// here, and these tests pin it: the Work Progress entry must name its real
// destination, and every OTHER construction entry must keep the honest
// "API only, no dedicated UI page yet" note, because inventing a UI for a
// report that has none is the same defect facing the other way.
//
// REPORT_CATALOG is a plain in-memory array with no DB access, so it is tested
// directly -- the same DB-free convention the sibling service tests follow.
import { describe, expect, test } from "bun:test"
import { REPORT_CATALOG } from "./report-catalog-service"

const construction = REPORT_CATALOG.filter((e) => e.domain === "construction")
const workProgress = construction.find((e) => e.id === "construction-work-progress")

describe("REPORT_CATALOG: the Work Progress Report names its one real destination (R67 E-04 / D-02)", () => {
  test("the entry still exists and is still a construction report", () => {
    expect(workProgress).toBeDefined()
    expect(workProgress!.name).toBe("Work Progress Report")
  })

  test("its route is the PROJEXA screen that actually renders it, not the raw API path", () => {
    expect(workProgress!.route).toBe("/work-progress?tab=report")
  })

  test("it is marked directly navigable -- a user CAN go straight there and get the report", () => {
    expect(workProgress!.directlyNavigable).toBe(true)
  })

  test("the route note no longer claims no UI renders it, and says where it runs", () => {
    expect(workProgress!.routeNote).not.toContain("No dedicated UI page renders it yet")
    expect(workProgress!.routeNote).toContain("Work Progress > Report")
  })

  test("its output formats list the exports that really exist on that screen", () => {
    expect(workProgress!.outputFormats).toContain("PDF")
    expect(workProgress!.outputFormats).toContain("CSV")
  })

  test("the API endpoint is still advertised for API callers -- D-02 retires it from the UI, not from the product", () => {
    expect(workProgress!.routeNote).toContain("/api/construction/reports/work-progress")
  })
})

// R67 E-16 (R-150): the same correction, for the second construction report
// that now has a real PROJEXA screen. designerTimesheetReport has computed four
// Budget-vs-Actual breakdowns since PR #597 and no screen showed any of them;
// Design Studio > Cost Analysis does, so the catalog says so.
const designerTimesheet = construction.find((e) => e.id === "construction-designer-timesheet")

describe("REPORT_CATALOG: the Designer Timesheet Report names the Cost Analysis screen (R67 E-16)", () => {
  test("its route is the PROJEXA screen that renders it -- the TAB, not a path that does not exist", () => {
    expect(designerTimesheet!.route).toBe("/design-studio?tab=cost-analysis")
  })

  test("it is marked directly navigable", () => {
    expect(designerTimesheet!.directlyNavigable).toBe(true)
  })

  test("the note names the screen and the four breakdowns, and stops claiming no UI renders it", () => {
    expect(designerTimesheet!.routeNote).not.toContain("No dedicated UI page renders it yet")
    expect(designerTimesheet!.routeNote).toContain("Design Studio > Cost Analysis")
    expect(designerTimesheet!.routeNote).toContain("by designer status")
  })

  test("the API endpoint stays advertised, with the period it now accepts", () => {
    expect(designerTimesheet!.routeNote).toContain("/api/construction/reports/designer-timesheet")
    expect(designerTimesheet!.routeNote).toContain("from&to")
  })

  test("its output formats list the exports that really exist on that screen", () => {
    expect(designerTimesheet!.outputFormats).toContain("PDF")
    expect(designerTimesheet!.outputFormats).toContain("XLSX")
  })
})

describe("REPORT_CATALOG: every other construction entry stays honest about having no UI yet", () => {
  const others = construction.filter(
    (e) => e.id !== "construction-work-progress" && e.id !== "construction-designer-timesheet"
  )

  test("the construction domain is still fully catalogued (the map did not drop entries)", () => {
    expect(construction).toHaveLength(18)
  })

  test("none of them claims to be directly navigable", () => {
    expect(others.filter((e) => e.directlyNavigable).map((e) => e.id)).toEqual([])
  })

  test("Site Picture in particular keeps the API-only note -- it has no PROJEXA view yet", () => {
    const sitePicture = others.find((e) => e.id === "construction-site-picture")!
    expect(sitePicture.route).toBe("/api/construction/reports/site-picture")
    expect(sitePicture.routeNote).toContain("No dedicated UI page renders it yet")
  })

  test("catalog ids stay unique -- a duplicate would render two cards for one report", () => {
    const ids = REPORT_CATALOG.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
