// R67 lane D22 (item D-49, rec R-125): the Gantt now says WHERE each
// completion percentage came from and WHEN.
//
// Without provenance a Gantt bar reading 62% is indistinguishable from one a
// PM typed over the site's own records -- which is precisely the ambiguity
// that makes people retype the figure, the double entry item D-49 closes.
// This suite exercises the real getGanttData() with only the DB layer and the
// two cross-service reads mocked, the same convention
// construction-reports-service.test.ts uses; nothing here touches a live DB.
/// <reference types="bun-types" />
import { describe, expect, test, mock, afterEach } from "bun:test"

const realTenantScoped = await import("@/lib/db/tenant-scoped")
const realIssueService = await import("./pms-issue-service")
const realTaxonomyService = await import("./pms-taxonomy-service")

const ORG_ID = "org-gantt"
const PROJECT_ID = "proj-gantt"

type IssueRow = {
  id: string
  title: string
  startDate: string | null
  dueDate: string | null
  completionPercentage: number
  completionSource: string
  completedFromEntryId: string | null
  milestoneId: string | null
  parentIssueId: string | null
  isArchived: boolean
}

function issue(over: Partial<IssueRow> & Pick<IssueRow, "id" | "title">): IssueRow {
  return {
    startDate: "2026-09-01", dueDate: "2026-09-10", completionPercentage: 0,
    completionSource: "manual", completedFromEntryId: null,
    milestoneId: null, parentIssueId: null, isArchived: false,
    ...over,
  }
}

describe("getGanttData: completion provenance (R67 D-49)", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
    await mock.module("./pms-issue-service", () => realIssueService)
    await mock.module("./pms-taxonomy-service", () => realTaxonomyService)
  })

  async function runGantt(issues: IssueRow[], entries: { id: string; entryDate: string }[] = []) {
    const fakeDb = {
      query: {
        pmsIssues: { findMany: mock(async () => issues) },
        pmsIssueRelations: { findMany: mock(async () => []) },
        constructionWorkProgressEntries: { findMany: mock(async () => entries) },
      },
    }
    await mock.module("@/lib/db/tenant-scoped", () => ({
      ...realTenantScoped,
      withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)),
    }))
    await mock.module("./pms-issue-service", () => ({
      ...realIssueService,
      fetchChildCompletionByParent: mock(async () => new Map<string, number[]>()),
    }))
    await mock.module("./pms-taxonomy-service", () => ({
      ...realTaxonomyService,
      listMilestones: mock(async () => []),
    }))
    const { getGanttData } = await import("./schedule-service")
    return getGanttData({ orgId: ORG_ID }, PROJECT_ID)
  }

  test("a completion derived from site records carries its source AND the date of the entry it came from", async () => {
    const { tasks } = await runGantt(
      [issue({ id: "i1", title: "Blockwork", completionPercentage: 62, completionSource: "site_records", completedFromEntryId: "entry-7" })],
      [{ id: "entry-7", entryDate: "2026-09-01" }]
    )
    expect(tasks[0]).toMatchObject({
      id: "i1", completionPercentage: 62, completionSource: "site_records", lastProgressAt: "2026-09-01",
    })
  })

  test("a manually set completion honestly reads 'manual' with no last-entry date", async () => {
    const { tasks } = await runGantt([issue({ id: "i1", title: "Plaster", completionPercentage: 40 })])
    expect(tasks[0].completionSource).toBe("manual")
    expect(tasks[0].lastProgressAt).toBeNull()
  })

  test("lastProgressAt is the ENTRY's own date, not the issue's updated_at -- an unrelated edit must not move it", async () => {
    const { tasks } = await runGantt(
      [issue({ id: "i1", title: "Blockwork", completionSource: "site_records", completedFromEntryId: "entry-7" })],
      [{ id: "entry-7", entryDate: "2026-08-14" }]
    )
    expect(tasks[0].lastProgressAt).toBe("2026-08-14")
  })

  test("a stale reference to a deleted entry reads null rather than crashing the whole Gantt", async () => {
    const { tasks } = await runGantt(
      [issue({ id: "i1", title: "Blockwork", completionSource: "site_records", completedFromEntryId: "entry-gone" })],
      []
    )
    expect(tasks[0].lastProgressAt).toBeNull()
    expect(tasks[0].completionSource).toBe("site_records")
  })

  test("a project with no issues returns no tasks and never reaches the entry lookup", async () => {
    const { tasks, dependencies } = await runGantt([])
    expect(tasks).toEqual([])
    expect(dependencies).toEqual([])
  })

  test("the pre-existing Gantt fields are untouched -- provenance is additive", async () => {
    const { tasks } = await runGantt([issue({ id: "i1", title: "Blockwork", completionPercentage: 10 })])
    expect(Object.keys(tasks[0]).sort()).toEqual(
      ["completionPercentage", "completionSource", "dueDate", "floatDays", "id", "isCritical", "lastProgressAt", "milestoneId", "parentIssueId", "startDate", "title"].sort()
    )
  })
})
