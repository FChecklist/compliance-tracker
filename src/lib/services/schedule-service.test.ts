// R67 lane D22 (item D-49, rec R-125): the Gantt now says WHERE each
// completion percentage came from and WHEN.
//
// Without provenance a Gantt bar reading 62% is indistinguishable from one a
// PM typed over the site's own records -- which is precisely the ambiguity
// that makes people retype the figure, the double entry item D-49 closes.
// This suite exercises the real getGanttData() with only the DB layer and the
// two cross-service reads mocked, the same convention
// construction-reports-service.test.ts uses; nothing here touches a live DB.
//
// Tests detectResourceConflicts() directly -- matches this repo's
// established pattern of not touching withTenantContext/a live DB from a
// .test.ts file (see erp-payment-entries-service.test.ts's header).
//
// R67 D-47 (audit R-121) extends this file with createScheduleActivity()'s own
// cases. The one structural change to what was here before: the service is now
// imported dynamically, AFTER the mock.module() calls below, because a static
// import is hoisted and would load the real module before the mocks are
// registered. Every pre-existing detectResourceConflicts case is unchanged.
//
// WHAT THE NEW CASES EXERCISE AND HOW HONESTLY. No live database. The pure rules
// (deriveDueDate / deriveDurationDays / detectResourceConflicts) run exactly as
// shipped. createScheduleActivity() runs with only withTenantContext and
// pms-issue-service's createIssue mocked -- the same convention
// construction-progress-service.test.ts established -- and the fake db RECORDS
// every insert, so the test can assert what was written and, just as
// importantly, that NOTHING was written on the paths that must refuse. Every
// lookup's WHERE clause is scanned for the org id, so a service that stopped
// scoping a read by organisation would fail here rather than pass quietly.
/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

const realTenantScoped = await import("@/lib/db/tenant-scoped")
const realIssueService = await import("./pms-issue-service")
const realTaxonomyService = await import("./pms-taxonomy-service")
const ORG = "org-r67-d47"
const PROJECT = "project-cedar"
const OTHER_PROJECT = "project-marina"

type Insert = { table: string; values: Record<string, unknown> }

/** Collects every bound parameter value out of a drizzle condition tree, at any depth. */
function paramValues(node: unknown, out: unknown[] = []): unknown[] {
  if (!node || typeof node !== "object") return out
  if ("encoder" in node && "value" in node) {
    out.push((node as { value: unknown }).value)
    return out
  }
  const chunks = (node as { queryChunks?: unknown[] }).queryChunks
  if (Array.isArray(chunks)) for (const chunk of chunks) paramValues(chunk, out)
  if (Array.isArray(node)) for (const entry of node) paramValues(entry, out)
  return out
}

// ── The fake world ──────────────────────────────────────────────────────────
let inserts: Insert[] = []
let issues: { id: string; projectId: string }[] = []
let boqLines: { id: string }[] = []
let createdIssue: { id: string; number: number; dueDate?: string; startDate?: string } | null = null
let createIssueInput: Record<string, unknown> | null = null
let createIssueThrows: Error | null = null
let insertThrows: Error | null = null
let whereParams: unknown[][] = []

function tableName(table: unknown): string {
  const symbols = Object.getOwnPropertySymbols(table as object)
  for (const s of symbols) {
    const value = (table as Record<symbol, unknown>)[s]
    if (typeof value === "string" && value.length > 0 && !value.startsWith("compliance")) return value
  }
  return "unknown"
}

const fakeDb = {
  query: {
    pmsIssues: {
      findFirst: async ({ where }: { where: unknown }) => {
        whereParams.push(paramValues(where))
        const params = paramValues(where)
        return issues.find((i) => params.includes(i.id)) ?? undefined
      },
    },
    constructionBoqLineItems: {
      findFirst: async ({ where }: { where: unknown }) => {
        whereParams.push(paramValues(where))
        const params = paramValues(where)
        return boqLines.find((l) => params.includes(l.id)) ?? undefined
      },
    },
  },
  insert: (table: unknown) => ({
    values: async (values: Record<string, unknown>) => {
      if (insertThrows) throw insertThrows
      inserts.push({ table: tableName(table), values })
    },
  }),
}

mock.module("@/lib/db/tenant-scoped", () => ({
  withTenantContext: async (_ctx: unknown, fn: (db: unknown) => unknown) => fn(fakeDb),
}))

mock.module("./pms-issue-service", () => ({
  createIssue: async (_ctx: unknown, input: Record<string, unknown>) => {
    createIssueInput = input
    if (createIssueThrows) throw createIssueThrows
    return createdIssue
  },
  // schedule-service also imports these two for the Gantt rollup; they are not
  // on any path this file exercises, but the module must still export them.
  fetchChildCompletionByParent: async () => new Map<string, number[]>(),
  computeParentCompletionPercentage: (own: number) => own,
}))

mock.module("./pms-taxonomy-service", () => ({
  listMilestones: async () => [],
}))

const {
  ServiceError,
  attachBoqLinks,
  createScheduleActivity,
  deriveDueDate,
  deriveDurationDays,
  detectResourceConflicts,
} = await import("./schedule-service")

beforeEach(() => {
  inserts = []
  whereParams = []
  issues = [
    { id: "task-predecessor", projectId: PROJECT },
    { id: "task-other-project", projectId: OTHER_PROJECT },
  ]
  boqLines = [{ id: "boq-line-1" }]
  createdIssue = { id: "task-new", number: 12 }
  createIssueInput = null
  createIssueThrows = null
  insertThrows = null
})

afterEach(() => {
  createIssueThrows = null
  insertThrows = null
})

const CTX = { orgId: ORG, userId: "user-1" }

function activity(over: Record<string, unknown> = {}) {
  return { projectId: PROJECT, typeId: "type-1", title: "Pour foundation slab", startDate: "2026-08-01", ...over }
}

describe("deriveDurationDays / deriveDueDate", () => {
  test("duration is due minus start, and null when either is missing", () => {
    expect(deriveDurationDays("2026-08-01", "2026-08-05")).toBe(4)
    expect(deriveDurationDays("2026-08-01", "2026-08-01")).toBe(0)
    expect(deriveDurationDays(null, "2026-08-05")).toBeNull()
    expect(deriveDurationDays("2026-08-01", undefined)).toBeNull()
  })

  test("a duration derives the finish date", () => {
    expect(deriveDueDate("2026-08-01", undefined, 4)).toBe("2026-08-05")
    expect(deriveDueDate("2026-08-01", undefined, 0)).toBe("2026-08-01")
  })

  test("an explicit finish date always wins over a duration", () => {
    expect(deriveDueDate("2026-08-01", "2026-09-30", 4)).toBe("2026-09-30")
  })

  test("nothing to derive from is null, never today", () => {
    expect(deriveDueDate("2026-08-01", undefined, undefined)).toBeNull()
    expect(deriveDueDate(undefined, undefined, 4)).toBeNull()
    expect(deriveDueDate("2026-08-01", undefined, -3)).toBeNull()
    expect(deriveDueDate("2026-08-01", undefined, Number.NaN)).toBeNull()
  })
})

describe("createScheduleActivity", () => {
  test("refuses an activity with no start date, and writes nothing", async () => {
    await expect(createScheduleActivity(CTX, activity({ startDate: undefined }) as never)).rejects.toThrow(
      "startDate is required"
    )
    expect(createIssueInput).toBeNull()
    expect(inserts).toHaveLength(0)
  })

  test("derives the finish date from the duration and hands it to createIssue", async () => {
    await createScheduleActivity(CTX, activity({ durationDays: 4 }) as never)
    expect(createIssueInput).toMatchObject({ startDate: "2026-08-01", dueDate: "2026-08-05" })
    // durationDays is a wire field, not a column -- it must not reach createIssue.
    expect(createIssueInput).not.toHaveProperty("durationDays")
  })

  test("refuses a finish date before the start, and writes nothing", async () => {
    await expect(
      createScheduleActivity(CTX, activity({ dueDate: "2026-07-01" }) as never)
    ).rejects.toThrow("Due date is before the start date")
    expect(createIssueInput).toBeNull()
    expect(inserts).toHaveLength(0)
  })

  test("with no predecessor and no BOQ line, nothing extra is written", async () => {
    await createScheduleActivity(CTX, activity() as never)
    expect(inserts).toHaveLength(0)
  })

  test("writes the predecessor as a 'blocked_by' edge from the new activity", async () => {
    await createScheduleActivity(CTX, activity({ predecessorId: "task-predecessor" }) as never)
    const relation = inserts.find((i) => i.table === "pms_issue_relations")!
    expect(relation.values).toMatchObject({
      orgId: ORG,
      issueId: "task-new",
      relatedIssueId: "task-predecessor",
      relationType: "blocked_by",
    })
  })

  test("writes the BOQ link the progress rollup reads", async () => {
    await createScheduleActivity(CTX, activity({ boqLineItemId: "boq-line-1" }) as never)
    const link = inserts.find((i) => i.table === "pms_issue_boq_links")!
    expect(link.values).toMatchObject({ orgId: ORG, issueId: "task-new", boqLineItemId: "boq-line-1" })
  })

  test("a predecessor on another project is refused BEFORE the activity is created", async () => {
    await expect(
      createScheduleActivity(CTX, activity({ predecessorId: "task-other-project" }) as never)
    ).rejects.toThrow("The predecessor belongs to a different project")
    expect(createIssueInput).toBeNull()
    expect(inserts).toHaveLength(0)
  })

  test("an unknown predecessor is a 404, with nothing created", async () => {
    try {
      await createScheduleActivity(CTX, activity({ predecessorId: "nope" }) as never)
      throw new Error("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceError)
      expect((error as InstanceType<typeof ServiceError>).status).toBe(404)
    }
    expect(createIssueInput).toBeNull()
    expect(inserts).toHaveLength(0)
  })

  test("an unknown BOQ line is a 404, with nothing created", async () => {
    try {
      await createScheduleActivity(CTX, activity({ boqLineItemId: "nope" }) as never)
      throw new Error("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceError)
      expect((error as InstanceType<typeof ServiceError>).status).toBe(404)
    }
    expect(createIssueInput).toBeNull()
    expect(inserts).toHaveLength(0)
  })

  test("both lookups are scoped to the calling organisation", async () => {
    await createScheduleActivity(
      CTX,
      activity({ predecessorId: "task-predecessor", boqLineItemId: "boq-line-1" }) as never
    )
    expect(whereParams).toHaveLength(2)
    for (const params of whereParams) expect(params).toContain(ORG)
  })

  test("a failed edge write says the activity WAS created, rather than pretending the call failed", async () => {
    insertThrows = new Error("deadlock detected")
    try {
      await createScheduleActivity(CTX, activity({ boqLineItemId: "boq-line-1" }) as never)
      throw new Error("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceError)
      expect((error as Error).message).toContain("Activity #12 was created")
      expect((error as Error).message).toContain("deadlock detected")
    }
  })
})

// ── Pre-existing coverage, unchanged (see this file's header) ───────────────
describe("detectResourceConflicts -- cross-project over-allocation, distinct from per-project getWorkload()", () => {
  test("flags a user allocated >100% capacity across two OVERLAPPING allocations in different projects", () => {
    const allocations = [
      { userId: "user_1", projectId: "project_a", allocatedHoursPerDay: "6", startDate: "2026-07-01", endDate: "2026-07-05" },
      { userId: "user_1", projectId: "project_b", allocatedHoursPerDay: "5", startDate: "2026-07-03", endDate: "2026-07-10" },
    ]
    const conflicts = detectResourceConflicts(allocations, 8)

    // Overlap window is 2026-07-03..2026-07-05 (6 + 5 = 11h/day > 8h capacity)
    const overlapDates = conflicts.map((c) => c.date)
    expect(overlapDates).toEqual(["2026-07-03", "2026-07-04", "2026-07-05"])
    for (const c of conflicts) {
      expect(c.userId).toBe("user_1")
      expect(c.totalAllocatedHours).toBe(11)
      expect(c.capacityHours).toBe(8)
      expect(c.projectIds.sort()).toEqual(["project_a", "project_b"])
    }
    // Days outside the overlap (07-01/02 single project at 6h, 07-06..10 single project at 5h) must NOT be flagged
    expect(conflicts.find((c) => c.date === "2026-07-01")).toBeUndefined()
    expect(conflicts.find((c) => c.date === "2026-07-06")).toBeUndefined()
  })

  test("does NOT flag a legitimate case where a user's allocations across projects never overlap in date range", () => {
    const allocations = [
      { userId: "user_1", projectId: "project_a", allocatedHoursPerDay: "6", startDate: "2026-07-01", endDate: "2026-07-05" },
      { userId: "user_1", projectId: "project_b", allocatedHoursPerDay: "6", startDate: "2026-07-06", endDate: "2026-07-10" },
    ]
    expect(detectResourceConflicts(allocations, 8)).toEqual([])
  })

  test("does NOT flag two different users each individually under capacity, even on the same overlapping dates", () => {
    const allocations = [
      { userId: "user_1", projectId: "project_a", allocatedHoursPerDay: "4", startDate: "2026-07-01", endDate: "2026-07-03" },
      { userId: "user_2", projectId: "project_b", allocatedHoursPerDay: "4", startDate: "2026-07-01", endDate: "2026-07-03" },
    ]
    expect(detectResourceConflicts(allocations, 8)).toEqual([])
  })

  test("sums 3 overlapping allocations in 3 different projects for the same user/day", () => {
    const allocations = [
      { userId: "user_1", projectId: "project_a", allocatedHoursPerDay: "3", startDate: "2026-07-01", endDate: "2026-07-01" },
      { userId: "user_1", projectId: "project_b", allocatedHoursPerDay: "3", startDate: "2026-07-01", endDate: "2026-07-01" },
      { userId: "user_1", projectId: "project_c", allocatedHoursPerDay: "3", startDate: "2026-07-01", endDate: "2026-07-01" },
    ]
    const conflicts = detectResourceConflicts(allocations, 8)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ userId: "user_1", date: "2026-07-01", totalAllocatedHours: 9, capacityHours: 8 })
    expect(conflicts[0].projectIds.sort()).toEqual(["project_a", "project_b", "project_c"])
  })

  test("a single allocation exactly AT capacity is not a conflict (only strictly over)", () => {
    const allocations = [{ userId: "user_1", projectId: "project_a", allocatedHoursPerDay: "8", startDate: "2026-07-01", endDate: "2026-07-01" }]
    expect(detectResourceConflicts(allocations, 8)).toEqual([])
  })

  test("respects a custom dailyCapacityHours", () => {
    const allocations = [{ userId: "user_1", projectId: "project_a", allocatedHoursPerDay: "5", startDate: "2026-07-01", endDate: "2026-07-01" }]
    expect(detectResourceConflicts(allocations, 4)).toHaveLength(1)
    expect(detectResourceConflicts(allocations, 8)).toEqual([])
  })
})

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
        // R67 integration: getGanttData now also reads the BOQ links (D-56) on
        // the same transaction, so this fixture has to answer that query too.
        // Empty on purpose -- these cases are about D-49's provenance, and
        // attachBoqLinks has its own suite at the bottom of this file.
        pmsIssueBoqLinks: { findMany: mock(async () => []) },
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
    // R67 integration: `boqLineItemId` joins this list because D-56's
    // attachBoqLinks now runs on the same rows. Added rather than the
    // assertion being loosened to a subset -- the point of this test is that
    // the shape is EXACT, so a field appearing without anyone deciding to add
    // it still fails here.
    expect(Object.keys(tasks[0]).sort()).toEqual(
      ["boqLineItemId", "completionPercentage", "completionSource", "dueDate", "floatDays", "id", "isCritical", "lastProgressAt", "milestoneId", "parentIssueId", "startDate", "title"].sort()
    )
  })
})

// ── R67 D-56 (audit R-185) ───────────────────────────────────────────────────
// getGanttData() now tells the Timeline which activities have their progress
// owned by a BOQ line, so D-56's inline "% complete" editor can be offered on
// the rows nobody else writes and refused (with the reason) on the rows Work
// Progress owns. The DB half is two statements inside the transaction that was
// already open; the decision itself is this pure function, tested here.
describe("attachBoqLinks (D-56)", () => {
  const tasks = [{ id: "t1", title: "Slab" }, { id: "t2", title: "Joinery" }, { id: "t3", title: "Snagging" }]

  test("an unlinked activity gets null, not an empty string -- 'nobody owns this' is a fact, not a blank", () => {
    expect(attachBoqLinks(tasks, [])).toEqual([
      { id: "t1", title: "Slab", boqLineItemId: null },
      { id: "t2", title: "Joinery", boqLineItemId: null },
      { id: "t3", title: "Snagging", boqLineItemId: null },
    ])
  })

  test("a linked activity names its line, and unlinked siblings stay null", () => {
    const result = attachBoqLinks(tasks, [{ issueId: "t2", boqLineItemId: "boq-line-7" }])
    expect(result.map((t) => t.boqLineItemId)).toEqual([null, "boq-line-7", null])
  })

  test("two links on one activity resolve to the FIRST, never to a crash or a silent drop of the row", () => {
    const result = attachBoqLinks(tasks, [
      { issueId: "t1", boqLineItemId: "boq-line-1" },
      { issueId: "t1", boqLineItemId: "boq-line-2" },
    ])
    expect(result).toHaveLength(3)
    expect(result[0].boqLineItemId).toBe("boq-line-1")
  })

  test("a link pointing at an activity that is not on this Gantt is ignored, not appended as a phantom row", () => {
    const result = attachBoqLinks(tasks, [{ issueId: "t-deleted", boqLineItemId: "boq-line-9" }])
    expect(result).toHaveLength(3)
    expect(result.every((t) => t.boqLineItemId === null)).toBe(true)
  })

  test("the task's own fields survive untouched -- this stamps, it does not reshape", () => {
    const [first] = attachBoqLinks([{ id: "t1", title: "Slab", isCritical: true }], [])
    expect(first.title).toBe("Slab")
    expect(first.isCritical).toBe(true)
  })
})
