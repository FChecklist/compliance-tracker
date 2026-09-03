/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  ALLOWED_TEST_LABELS,
  TEST_LABEL_PATTERN_SOURCE,
  extractColumnLabels,
  findLeakedTestLabels,
  formatLeakedTestLabelReport,
  type ScreenDefinitionLabelRow,
} from "./screen-definitions-labels"

// The two real leaked rows this guard exists because of (R66 audit). BOTH are
// GLOBAL (org_id null), and both ids below are the live ones, confirmed
// against pcrjmlpuqsbocqfwoxod by read-only SELECT:
//   a018f269-... = function_id 'schedule.timeline'   "Activity (HARD-STOP TEST)"
//   4b1ff3d4-... = function_id 'dashboard.dashboard' "Active Projects (HARD-STOP TEST)"
// a018f269 is the SCHEDULE row, not the dashboard one -- an earlier draft of
// this lane had them the other way round and nearly renamed the global
// timeline's first column header for every tenant.
const SCHEDULE_ROW_ID = "a018f269-8375-44a5-a9ed-1060bf4d3efc"
const DASHBOARD_ROW_ID = "4b1ff3d4-6877-4a10-89cc-ceb4d6f90ca1"

function scheduleRow(firstLabel: string): ScreenDefinitionLabelRow {
  return {
    id: SCHEDULE_ROW_ID,
    functionId: "schedule.timeline",
    orgId: null,
    columns: [
      { label: firstLabel, field: "title", type: "text", importance: "High" },
      { label: "Start", field: "startDate", type: "date", importance: "High" },
      { label: "Finish", field: "targetDate", type: "date", importance: "High" },
    ],
  }
}

describe("findLeakedTestLabels -- the acceptance case (I-04)", () => {
  test("FAILS on a fixture row whose label is 'Activity (HARD-STOP TEST)'", () => {
    const leaks = findLeakedTestLabels([scheduleRow("Activity (HARD-STOP TEST)")])
    expect(leaks).toEqual([
      {
        id: SCHEDULE_ROW_ID,
        functionId: "schedule.timeline",
        orgId: null,
        columnIndex: 0,
        label: "Activity (HARD-STOP TEST)",
      },
    ])
  })

  test("PASSES when the same label is 'Activity'", () => {
    expect(findLeakedTestLabels([scheduleRow("Activity")])).toEqual([])
  })
})

describe("findLeakedTestLabels -- the rest of the registry", () => {
  test("catches a GLOBAL dashboard KPI row -- the leak-into-every-tenant case", () => {
    const rows: ScreenDefinitionLabelRow[] = [
      {
        id: DASHBOARD_ROW_ID,
        functionId: "dashboard.dashboard",
        orgId: null,
        columns: [{ label: "Active Projects (HARD-STOP TEST)", field: "activeProjects", type: "number" }],
      },
    ]
    const leaks = findLeakedTestLabels(rows)
    expect(leaks.length).toBe(1)
    expect(leaks[0].orgId).toBeNull()
    expect(formatLeakedTestLabelReport(leaks)).toContain("GLOBAL -- leaks into every tenant")
  })

  test("is case-insensitive -- 'test', 'Test' and 'TEST' all trip it", () => {
    for (const spelling of ["Activity (test)", "Activity (Test)", "Activity (TEST)"]) {
      expect(findLeakedTestLabels([scheduleRow(spelling)]).length).toBe(1)
    }
  })

  test("reports every offending column of a multi-column row, with its real index", () => {
    const rows: ScreenDefinitionLabelRow[] = [
      {
        id: "row-multi",
        functionId: "permits.list",
        orgId: "org-1",
        columns: [
          { label: "Permit", field: "name", type: "text" },
          { label: "TEST col", field: "a", type: "text" },
          { label: "End date", field: "expiryDate", type: "date" },
          { label: "another test", field: "b", type: "text" },
        ],
      },
    ]
    expect(findLeakedTestLabels(rows).map((l) => l.columnIndex)).toEqual([1, 3])
  })

  test("a clean registry produces an empty result and a plain 'no debug labels' report", () => {
    const rows: ScreenDefinitionLabelRow[] = [
      scheduleRow("Activity"),
      {
        id: "row-permits",
        functionId: "permits.list",
        orgId: null,
        columns: [
          { label: "Permit", field: "name", type: "text" },
          { label: "End date", field: "expiryDate", type: "date" },
        ],
      },
    ]
    expect(findLeakedTestLabels(rows)).toEqual([])
    expect(formatLeakedTestLabelReport([])).toBe("compliance.screen_definitions: no debug labels found.")
  })

  test("ALLOWED_TEST_LABELS is empty on introduction -- no exception was needed to make this pass", () => {
    expect(ALLOWED_TEST_LABELS.size).toBe(0)
  })
})

describe("extractColumnLabels -- malformed jsonb must not crash the guard", () => {
  test("a non-array columns value yields no labels", () => {
    expect(extractColumnLabels(null)).toEqual([])
    expect(extractColumnLabels({})).toEqual([])
    expect(extractColumnLabels("[]")).toEqual([])
  })

  test("elements that are not objects, or carry a non-string label, are skipped -- surviving elements keep their real index", () => {
    expect(extractColumnLabels([null, "TEST", { label: 42 }, { label: "Activity" }])).toEqual([
      { index: 3, label: "Activity" },
    ])
  })

  test("a row whose columns are malformed contributes nothing rather than throwing", () => {
    const rows: ScreenDefinitionLabelRow[] = [{ id: "r", functionId: "f", orgId: null, columns: "not-an-array" }]
    expect(() => findLeakedTestLabels(rows)).not.toThrow()
    expect(findLeakedTestLabels(rows)).toEqual([])
  })
})

describe("rule drift guard", () => {
  test("the pattern source is the audit's literal /test/i, not a narrowed variant", () => {
    expect(TEST_LABEL_PATTERN_SOURCE).toBe("test")
  })
})
