// Wave 174: tests the pure Excel-row-to-schedule-item mapping
// (mapRowsToScheduleItems) and the progress join (joinScheduleWithProgress)
// -- no withTenantContext/live DB/real xlsx file, matching this repo's
// established pattern (see erp-fixed-assets-service.test.ts).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { mapRowsToScheduleItems, joinScheduleWithProgress } from "./construction-schedule-service"

describe("mapRowsToScheduleItems", () => {
  test("maps loose header casing/spacing onto the typed draft shape", () => {
    const drafts = mapRowsToScheduleItems([
      { "WBS Code": "1.1", "Task Name": "Excavation", "Unit": "cum", "Qty": "500", "Start Date": "2026-08-01", "End Date": "2026-08-10" },
    ])
    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toEqual({
      wbsCode: "1.1", taskName: "Excavation", unit: "cum",
      plannedQuantity: 500, plannedStartDate: "2026-08-01", plannedEndDate: "2026-08-10",
    })
  })

  test("rows with no recognisable task name are dropped, not defaulted to an empty string", () => {
    const drafts = mapRowsToScheduleItems([{ "WBS Code": "1.2", "Qty": "10" }])
    expect(drafts).toHaveLength(0)
  })

  test("accepts alternate common header spellings (activity/description for task, uom for unit)", () => {
    const drafts = mapRowsToScheduleItems([{ "Activity": "Brickwork", "UOM": "sqm" }])
    expect(drafts[0].taskName).toBe("Brickwork")
    expect(drafts[0].unit).toBe("sqm")
  })
})

describe("joinScheduleWithProgress", () => {
  test("links each schedule item to its activity's most recent percentComplete (entries pre-sorted desc by date)", () => {
    const items = [
      { id: "s-1", wbsCode: "1.1", taskName: "Excavation", unit: "cum", plannedQuantity: "500", plannedStartDate: "2026-08-01", plannedEndDate: "2026-08-10", activityId: "act-1" },
      { id: "s-2", wbsCode: "1.2", taskName: "Not yet linked", unit: null, plannedQuantity: null, plannedStartDate: null, plannedEndDate: null, activityId: null },
    ]
    const progressEntriesDescByDate = [
      { activityId: "act-1", percentComplete: 60 }, // most recent (list is pre-sorted desc)
      { activityId: "act-1", percentComplete: 30 }, // older -- must be ignored
    ]

    const rows = joinScheduleWithProgress(items, progressEntriesDescByDate)
    expect(rows.find((r) => r.id === "s-1")!.percentComplete).toBe(60)
    expect(rows.find((r) => r.id === "s-2")!.percentComplete).toBeNull() // no activity link at all
  })

  test("a linked activity with no progress entries yet reports 0%, not null", () => {
    const items = [{ id: "s-1", wbsCode: null, taskName: "Formwork", unit: null, plannedQuantity: null, plannedStartDate: null, plannedEndDate: null, activityId: "act-2" }]
    const rows = joinScheduleWithProgress(items, [])
    expect(rows[0].percentComplete).toBe(0)
  })
})
