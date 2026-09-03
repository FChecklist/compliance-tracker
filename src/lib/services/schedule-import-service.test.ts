// R67 lane D22 (item D-48, rec R-123): the programme importer's own tests.
//
// The parse half runs against a REAL CSV buffer through the real
// parseScheduleSpreadsheet() -> parseFile() path, not against hand-built row
// objects: the acceptance criterion is about what a fixture SHEET produces,
// and a header-mapping bug would be invisible if the test skipped the header
// row entirely. The commit half mocks only the DB layer, the same convention
// construction-reports-service.test.ts uses.
/// <reference types="bun-types" />
import { describe, expect, test, mock, afterEach } from "bun:test"
import { getTableName } from "drizzle-orm"
import {
  SCHEDULE_FIELD_ALIASES,
  dateOrderLabel,
  mapRowsToActivities,
  mapScheduleHeaders,
  parseScheduleDate,
  parseScheduleSpreadsheet,
  resolveDateOrder,
} from "./schedule-import-service"

const HEADER = "Activity,Start,Finish,Duration,Predecessor,Weight,BOQ Code"

/**
 * 38 real activities. Sheet row 14 (the 13th data row) finishes before it
 * starts -- the one defect this fixture carries. Rows 5 and 20 are milestones
 * (zero duration). Every predecessor names an activity that is in the file, so
 * nothing is blocking.
 */
function programmeCsv(): string {
  const rows: string[] = []
  for (let i = 0; i < 38; i += 1) {
    const rowNumber = i + 2
    const name = `Activity ${String(i + 1).padStart(2, "0")}`
    const start = `2026-09-${String((i % 28) + 1).padStart(2, "0")}`
    const finish = rowNumber === 14
      ? "2026-09-01" // finishes before its start -- the seeded defect
      : `2026-10-${String((i % 28) + 1).padStart(2, "0")}`
    const duration = rowNumber === 5 || rowNumber === 20 ? 0 : 10
    const predecessor = i === 0 ? "" : `Activity ${String(i).padStart(2, "0")}`
    rows.push([name, start, finish, duration, predecessor, 2.5, `BOQ-${String(i + 1).padStart(3, "0")}`].join(","))
  }
  return [HEADER, ...rows].join("\n")
}

async function parseFixture(csv: string, orgDateFormat?: string | null) {
  return parseScheduleSpreadsheet(Buffer.from(csv, "utf-8"), "Programme-Rev2.csv", "text/csv", { orgDateFormat })
}

describe("parseScheduleSpreadsheet (real CSV, real header mapping)", () => {
  test("a fixture sheet with one Finish-before-Start row returns exactly one warning, and 38 parsed activities", async () => {
    const result = await parseFixture(programmeCsv())
    expect(result.activities).toHaveLength(38)
    expect(result.warnings).toEqual(["Row 14: Finish before Start"])
    expect(result.blockingErrors).toEqual([])
  })

  test("milestones are counted separately from activities", async () => {
    const result = await parseFixture(programmeCsv())
    expect(result.milestoneCount).toBe(2)
  })

  test("the header row is really mapped -- every field the importer understands is found", async () => {
    const result = await parseFixture(programmeCsv())
    expect(result.mapping).toEqual({
      activity: "Activity", startDate: "Start", finishDate: "Finish",
      duration: "Duration", predecessor: "Predecessor", weight: "Weight", boqCode: "BOQ Code",
    })
  })

  test("predecessors are read as names and resolve within the file", async () => {
    const result = await parseFixture(programmeCsv())
    expect(result.activities[0].predecessorNames).toEqual([])
    expect(result.activities[1].predecessorNames).toEqual(["Activity 01"])
  })

  test("an empty sheet says what to fix, and imports nothing", async () => {
    const result = await parseFixture("")
    expect(result.activities).toEqual([])
    expect(result.blockingErrors).toEqual(["No usable rows found - check that the first row holds the column headers"])
  })

  test("a sheet with headers but no data rows gets the same sentence", async () => {
    const result = await parseFixture(HEADER)
    expect(result.blockingErrors).toEqual(["No usable rows found - check that the first row holds the column headers"])
  })

  test("the preview states how it read the dates, so a wrong reading is visible before anything is written", async () => {
    expect((await parseFixture(programmeCsv(), null)).dateInterpretation).toBe("Reading dates as dd/mm/yyyy")
    expect((await parseFixture(programmeCsv(), "MM/dd/yyyy")).dateInterpretation).toBe("Reading dates as mm/dd/yyyy")
  })

  test("a duplicate activity name imports as its own row with a suffix and a warning -- never silently merged", async () => {
    const csv = [HEADER, "Blockwork,2026-09-01,2026-09-10,10,,5,", "Blockwork,2026-09-11,2026-09-20,10,,5,"].join("\n")
    const result = await parseFixture(csv)
    expect(result.activities.map((a) => a.name)).toEqual(["Blockwork", "Blockwork (2)"])
    expect(result.warnings).toEqual(['Row 3: duplicate activity name "Blockwork" imported as "Blockwork (2)"'])
    expect(result.blockingErrors).toEqual([])
  })

  test("a predecessor naming an activity that is not in the file blocks the import", async () => {
    const csv = [HEADER, "Blockwork,2026-09-01,2026-09-10,10,A-07,5,"].join("\n")
    const result = await parseFixture(csv)
    expect(result.blockingErrors).toEqual(["Row 2: predecessor 'A-07' not found"])
  })
})

describe("mapScheduleHeaders", () => {
  test("a real Activity/Task column wins over a Description column when both are present", () => {
    expect(mapScheduleHeaders(["Description", "Task", "Start"])).toMatchObject({ activity: "Task", startDate: "Start" })
  })

  test("the documented synonyms all resolve", () => {
    expect(mapScheduleHeaders(["Task Name", "Start Date", "End", "Days", "Pred", "%", "Item Code"])).toEqual({
      activity: "Task Name", startDate: "Start Date", finishDate: "End",
      duration: "Days", predecessor: "Pred", weight: "%", boqCode: "Item Code",
    })
  })

  test("no Activity-like column at all is a blocking error, not a silent empty import", () => {
    const { activities, blockingErrors } = mapRowsToActivities([{ Foo: "bar" }], mapScheduleHeaders(["Foo"]))
    expect(activities).toEqual([])
    expect(blockingErrors).toEqual(["Could not find an Activity column in this spreadsheet"])
  })

  test("every alias list is non-empty -- an unmatched field would silently drop a real column", () => {
    for (const [field, aliases] of Object.entries(SCHEDULE_FIELD_ALIASES)) {
      expect(aliases.length, field).toBeGreaterThan(0)
    }
  })
})

describe("parseScheduleDate", () => {
  test("ISO is read as ISO whatever the org setting says", () => {
    expect(parseScheduleDate("2026-09-01", "mdy")).toBe("2026-09-01")
  })

  test("an ambiguous date follows the org's own reading", () => {
    expect(parseScheduleDate("05/09/2026", "dmy")).toBe("2026-09-05")
    expect(parseScheduleDate("05/09/2026", "mdy")).toBe("2026-05-09")
  })

  test("a component over 12 can only be the day, whatever the setting says", () => {
    expect(parseScheduleDate("25/12/2026", "mdy")).toBe("2026-12-25")
  })

  test("a real Date object (xlsx cellDates) is taken as-is", () => {
    expect(parseScheduleDate(new Date(Date.UTC(2026, 8, 1)), "dmy")).toBe("2026-09-01")
  })

  test("an unusable cell is null, not a crash and not today's date", () => {
    expect(parseScheduleDate("", "dmy")).toBeNull()
    expect(parseScheduleDate("TBD", "dmy")).toBeNull()
    expect(parseScheduleDate("45/13/2026", "dmy")).toBeNull()
  })
})

describe("resolveDateOrder / dateOrderLabel", () => {
  test("unset falls back to day-first -- the real convention in this product's markets", () => {
    expect(resolveDateOrder(null)).toBe("dmy")
    expect(resolveDateOrder(undefined)).toBe("dmy")
  })
  test("the org's own dd-MM-yyyy backfill is honoured", () => {
    expect(resolveDateOrder("dd-MM-yyyy")).toBe("dmy")
  })
  test("a month-first org is honoured too", () => {
    expect(resolveDateOrder("MM/dd/yyyy")).toBe("mdy")
    expect(dateOrderLabel("mdy")).toBe("Reading dates as mm/dd/yyyy")
  })
})

describe("mapRowsToActivities: weight and milestones", () => {
  test("an xlsx percent cell stored as its underlying fraction is read back as a whole-number weight", () => {
    const { activities } = mapRowsToActivities([{ Activity: "A", Weight: "0.3" }], { activity: "Activity", weight: "Weight" })
    expect(activities[0].weight).toBe(30)
  })

  test("a start equal to its finish is a milestone even without a Duration column", () => {
    const { activities } = mapRowsToActivities(
      [{ Activity: "Handover", Start: "2026-09-01", Finish: "2026-09-01" }],
      { activity: "Activity", startDate: "Start", finishDate: "Finish" }
    )
    expect(activities[0].isMilestone).toBe(true)
  })

  test("a blank spacer row is skipped without a warning -- it is not an error, it is just not an activity", () => {
    const { activities, warnings } = mapRowsToActivities(
      [{ Activity: "A" }, { Activity: "  " }, { Activity: "B" }],
      { activity: "Activity" }
    )
    expect(activities.map((a) => a.name)).toEqual(["A", "B"])
    expect(warnings).toEqual([])
  })

  test("row numbers are the numbers a human sees in Excel (header is row 1)", () => {
    const { activities } = mapRowsToActivities([{ Activity: "A" }, { Activity: "B" }], { activity: "Activity" })
    expect(activities.map((a) => a.rowNumber)).toEqual([2, 3])
  })
})

const realTenantScoped = await import("@/lib/db/tenant-scoped")

describe("importScheduleActivities: one transaction, real dependency and BOQ wiring", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
  })

  async function runImport(activities: Parameters<typeof import("./schedule-import-service").importScheduleActivities>[1]["activities"]) {
    const insertedRows: Record<string, unknown[]> = {}
    let withTenantContextCalls = 0

    const fakeDb = {
      query: {
        projects: { findFirst: mock(async () => ({ id: "proj-1", orgId: "org-1" })) },
        pmsIssueStatuses: { findMany: mock(async () => [{ id: "status-1", isDefault: true }]) },
        pmsIssueTypes: { findMany: mock(async () => [{ id: "type-1", isDefault: true }]) },
        constructionBoqs: { findMany: mock(async () => [{ id: "boq-1", status: "approved", version: 1 }]) },
        constructionBoqLineItems: { findMany: mock(async () => [{ id: "li-1", itemCode: "BOQ-001" }]) },
      },
      update: () => ({ set: () => ({ where: () => ({ returning: async () => [{ issueSequence: activities.length }] }) }) }),
      insert: (table: Parameters<typeof getTableName>[0]) => ({
        values: (rows: unknown[]) => {
          const name = getTableName(table)
          insertedRows[name] = [...(insertedRows[name] ?? []), ...(Array.isArray(rows) ? rows : [rows])]
          const result = Promise.resolve(undefined) as Promise<unknown> & { returning: () => Promise<unknown[]> }
          result.returning = async () =>
            (Array.isArray(rows) ? rows : [rows]).map((row, i) => ({ ...(row as object), id: `issue-${i + 1}` }))
          return result
        },
      }),
    }

    await mock.module("@/lib/db/tenant-scoped", () => ({
      ...realTenantScoped,
      withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => {
        withTenantContextCalls += 1
        return fn(fakeDb)
      }),
    }))
    const { importScheduleActivities } = await import("./schedule-import-service")
    const result = await importScheduleActivities({ orgId: "org-1", userId: "user-1" }, { projectId: "proj-1", activities })
    return { result, insertedRows, withTenantContextCalls }
  }

  const ACTIVITIES = [
    { rowNumber: 2, name: "Blockwork", startDate: "2026-09-01", finishDate: "2026-09-10", durationDays: 10, predecessorNames: [], weight: 5, boqCode: "BOQ-001", isMilestone: false },
    { rowNumber: 3, name: "Plaster", startDate: "2026-09-11", finishDate: "2026-09-20", durationDays: 10, predecessorNames: ["Blockwork"], weight: 5, boqCode: "BOQ-404", isMilestone: false },
  ]

  test("the whole import runs in ONE transaction, never one per activity", async () => {
    const { withTenantContextCalls, result } = await runImport(ACTIVITIES)
    expect(withTenantContextCalls).toBe(1)
    expect(result.createdIssueIds).toHaveLength(2)
  })

  test("a predecessor becomes a real 'blocks' edge stored from the predecessor's side", async () => {
    const { insertedRows, result } = await runImport(ACTIVITIES)
    expect(result.dependencyCount).toBe(1)
    expect(insertedRows["pms_issue_relations"]).toEqual([
      { orgId: "org-1", issueId: "issue-1", relatedIssueId: "issue-2", relationType: "blocks", lagDays: 0 },
    ])
  })

  test("a BOQ code that matches the project's BOQ becomes a link; one that does not is reported, not invented", async () => {
    const { insertedRows, result } = await runImport(ACTIVITIES)
    expect(result.boqLinkCount).toBe(1)
    expect(insertedRows["pms_issue_boq_links"]).toEqual([
      { orgId: "org-1", issueId: "issue-1", boqLineItemId: "li-1", weight: "1" },
    ])
    expect(result.unmatchedBoqCodes).toEqual(["BOQ-404"])
  })

  test("issue numbers come from one atomic sequence claim, contiguous across the batch", async () => {
    const { insertedRows } = await runImport(ACTIVITIES)
    expect((insertedRows["pms_issues"] as { number: number }[]).map((r) => r.number)).toEqual([1, 2])
  })

  test("importing nothing is refused rather than silently succeeding", async () => {
    await expect(runImport([])).rejects.toThrow("No usable rows found - check that the first row holds the column headers")
  })
})
