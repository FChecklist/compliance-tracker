// Owner directive PROJEXA_ERP_END_TO_END_REQUIREMENT_ANALYSIS_GAP_FILL_AND_IMPLEMENTATION:
// tests the pure predecessorIdsOf() edge-normalization the real
// dependency-blocking checks in updateIssue()/addIssueRelation() are built
// on, matching this repo's established pattern of not touching
// withTenantContext/a live DB from a .test.ts file (see
// erp-fixed-assets-service.test.ts's own note on this -- no test-DB harness
// exists in this environment).
/// <reference types="bun-types" />
import { afterEach, describe, expect, mock, test } from "bun:test"
import { predecessorIdsOf, calculateProjectRollupPercentage, computeParentCompletionPercentage } from "./pms-issue-service"

type Relation = { issueId: string; relatedIssueId: string; relationType: "blocks" | "blocked_by" | "duplicates" | "relates_to" }

describe("predecessorIdsOf", () => {
  test("a 'blocks' row where this issue is the related (successor) side yields the blocking issue as predecessor", () => {
    const relations: Relation[] = [{ issueId: "pred-1", relatedIssueId: "succ-1", relationType: "blocks" }]
    expect(predecessorIdsOf(relations, "succ-1")).toEqual(["pred-1"])
  })

  test("a 'blocked_by' row where this issue is the issueId side yields the related issue as predecessor", () => {
    const relations: Relation[] = [{ issueId: "succ-1", relatedIssueId: "pred-1", relationType: "blocked_by" }]
    expect(predecessorIdsOf(relations, "succ-1")).toEqual(["pred-1"])
  })

  test("the same predecessor recorded from both directions (not auto-mirrored) is still found from either row alone", () => {
    const blocksRow: Relation[] = [{ issueId: "pred-1", relatedIssueId: "succ-1", relationType: "blocks" }]
    const blockedByRow: Relation[] = [{ issueId: "succ-1", relatedIssueId: "pred-1", relationType: "blocked_by" }]
    expect(predecessorIdsOf(blocksRow, "succ-1")).toEqual(["pred-1"])
    expect(predecessorIdsOf(blockedByRow, "succ-1")).toEqual(["pred-1"])
  })

  test("a relation naming this issue as the predecessor (not the successor) contributes nothing", () => {
    const relations: Relation[] = [{ issueId: "this-issue", relatedIssueId: "some-other-issue", relationType: "blocks" }]
    expect(predecessorIdsOf(relations, "this-issue")).toEqual([])
  })

  test("'duplicates'/'relates_to' rows carry no predecessor/successor semantics and are ignored", () => {
    const relations: Relation[] = [
      { issueId: "a", relatedIssueId: "this-issue", relationType: "duplicates" },
      { issueId: "this-issue", relatedIssueId: "b", relationType: "relates_to" },
    ]
    expect(predecessorIdsOf(relations, "this-issue")).toEqual([])
  })

  test("no relations at all (the common case) yields no predecessors", () => {
    expect(predecessorIdsOf([], "this-issue")).toEqual([])
  })

  test("multiple real predecessors from a mix of directions are all found", () => {
    const relations: Relation[] = [
      { issueId: "pred-A", relatedIssueId: "this-issue", relationType: "blocks" },
      { issueId: "this-issue", relatedIssueId: "pred-B", relationType: "blocked_by" },
      { issueId: "unrelated-1", relatedIssueId: "unrelated-2", relationType: "blocks" },
    ]
    expect(predecessorIdsOf(relations, "this-issue").sort()).toEqual(["pred-A", "pred-B"])
  })
})

// Task #47 (PM feature-parity gap analysis): generalizes construction-
// dashboard-service.ts's getProjectDashboard() "average of latest logged
// percentComplete" rollup pattern to pms_issues.completionPercentage.
describe("calculateProjectRollupPercentage", () => {
  test("no issues at all rolls up to 0", () => {
    expect(calculateProjectRollupPercentage([])).toBe(0)
  })

  test("averages completionPercentage across all non-archived issues", () => {
    const issues = [
      { completionPercentage: 100, isArchived: false },
      { completionPercentage: 50, isArchived: false },
      { completionPercentage: 0, isArchived: false },
    ]
    // (100 + 50 + 0) / 3 = 50
    expect(calculateProjectRollupPercentage(issues)).toBe(50)
  })

  test("archived issues are excluded from both the sum and the denominator", () => {
    const issues = [
      { completionPercentage: 100, isArchived: false },
      { completionPercentage: 0, isArchived: true }, // would drag the average down to 50 if wrongly included
    ]
    expect(calculateProjectRollupPercentage(issues)).toBe(100)
  })

  test("only archived issues rolls up to 0, not NaN/division-by-zero", () => {
    const issues = [
      { completionPercentage: 80, isArchived: true },
      { completionPercentage: 40, isArchived: true },
    ]
    expect(calculateProjectRollupPercentage(issues)).toBe(0)
  })

  test("rounds a non-integer average to the nearest whole percent", () => {
    const issues = [
      { completionPercentage: 100, isArchived: false },
      { completionPercentage: 100, isArchived: false },
      { completionPercentage: 0, isArchived: false },
    ]
    // 200 / 3 = 66.66... -> rounds to 67
    expect(calculateProjectRollupPercentage(issues)).toBe(67)
  })

  test("a single fully-complete issue rolls up to 100", () => {
    expect(calculateProjectRollupPercentage([{ completionPercentage: 100, isArchived: false }])).toBe(100)
  })
})

// Task #47 gap fix: pms_issues.parentIssueId already supported real subtask
// nesting and completionPercentage already existed as a column, but nothing
// ever read parentIssueId back to roll a parent's completion up from its
// children -- see the fuller design-decision comment on
// computeParentCompletionPercentage() itself in pms-issue-service.ts.
describe("computeParentCompletionPercentage", () => {
  test("a leaf issue (0 children) keeps its own manually-set percentage untouched", () => {
    expect(computeParentCompletionPercentage(42, [])).toBe(42)
  })

  test("a parent with several children at varying completion is the correct average, rounded", () => {
    // (10 + 50 + 90) / 3 = 50 exactly
    expect(computeParentCompletionPercentage(0, [10, 50, 90])).toBe(50)
    // (0 + 100) / 2 = 50 exactly -- own (manually-set) value is ignored once children exist
    expect(computeParentCompletionPercentage(75, [0, 100])).toBe(50)
    // (33 + 67) / 2 = 50 exactly, but (10 + 20 + 25) / 3 = 18.33... rounds to 18
    expect(computeParentCompletionPercentage(0, [10, 20, 25])).toBe(18)
  })

  test("a single child's own percentage becomes the parent's percentage exactly", () => {
    expect(computeParentCompletionPercentage(0, [37])).toBe(37)
  })

  test("all children at 0% or all at 100% average to the same extreme, not the parent's own stale value", () => {
    expect(computeParentCompletionPercentage(100, [0, 0, 0])).toBe(0)
    expect(computeParentCompletionPercentage(0, [100, 100])).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// R67 F-33 (audit recommendation R-278) -- POST a schedule task under 1 s.
//
// The one thing worth asserting about a latency fix is that the WORK is still
// done: a create that is fast because it stopped writing the rows it used to
// write is not a fix. So these tests count the round trips AND check every
// side effect the old path had -- the assignee rows, the project rollup, the
// atomically-claimed number, and the exact row the caller gets back.
//
// Same "never touch a live DB from a .test.ts" convention as the rest of this
// file: withTenantContext is replaced by a fake transaction whose db records
// every operation the service performs, in order.
// ---------------------------------------------------------------------------

const F33_ORG = "org-f33"
const F33_PROJECT = "project-f33"
const F33_USER = "user-f33"
const F33_TYPE = "type-task"
const F33_STATUS_BACKLOG = "status-backlog"

type F33Op = { op: string; table: string; payload?: unknown }

let f33Ops: F33Op[] = []
let f33TransactionCount = 0
/** [] means "no such project in this org" -- the 404 path. */
let f33ClaimResult: Array<{ issueSequence: number }> = [{ issueSequence: 7 }]
let f33ExistingStatuses: Array<{ id: string; isDefault: boolean; position: number }> = []
/** What the project already holds, for the rollup average. */
let f33ProjectIssues: Array<{ completionPercentage: number; isArchived: boolean }> = []

function f33InsertedIssue(values: Record<string, unknown>) {
  // Stands in for Postgres applying the column defaults on INSERT ... RETURNING.
  return {
    id: "issue-created",
    assigneeId: null,
    position: "0",
    isArchived: false,
    completionPercentage: 0,
    assignedById: null,
    createdAt: new Date("2026-09-03T00:00:00Z"),
    updatedAt: new Date("2026-09-03T00:00:00Z"),
    ...values,
  }
}

function f33Db(tableName: (t: unknown) => string) {
  const record = (op: string, table: string, payload?: unknown) => {
    f33Ops.push({ op, table, payload })
  }
  return {
    update(table: unknown) {
      const name = tableName(table)
      return {
        set(values: Record<string, unknown>) {
          return {
            where() {
              return {
                returning() {
                  record("update.returning", name, values)
                  return Promise.resolve(f33ClaimResult)
                },
                // Awaited directly (no .returning()) -- the rollup write.
                then<R1, R2>(onOk?: ((v: unknown) => R1 | PromiseLike<R1>) | null, onErr?: ((e: unknown) => R2 | PromiseLike<R2>) | null) {
                  record("update", name, values)
                  return Promise.resolve(undefined).then(onOk, onErr)
                },
              }
            },
          }
        },
      }
    },
    insert(table: unknown) {
      const name = tableName(table)
      return {
        values(values: Record<string, unknown> | Array<Record<string, unknown>>) {
          return {
            returning() {
              record("insert.returning", name, values)
              return Promise.resolve([f33InsertedIssue(values as Record<string, unknown>)])
            },
            then<R1, R2>(onOk?: ((v: unknown) => R1 | PromiseLike<R1>) | null, onErr?: ((e: unknown) => R2 | PromiseLike<R2>) | null) {
              record("insert", name, values)
              return Promise.resolve(undefined).then(onOk, onErr)
            },
          }
        },
      }
    },
    delete(table: unknown) {
      const name = tableName(table)
      return {
        where() {
          record("delete", name)
          return Promise.resolve(undefined)
        },
      }
    },
    query: {
      pmsIssues: {
        findMany: async () => {
          record("select", "pms_issues")
          return f33ProjectIssues
        },
      },
      pmsIssueStatuses: {
        findMany: async () => {
          record("select", "pms_issue_statuses")
          return f33ExistingStatuses
        },
      },
      projects: {
        findFirst: async () => {
          // Nothing should reach this any more -- the claim statement IS the
          // existence check. Recorded so a test can prove it did not run.
          record("select", "projects")
          return { id: F33_PROJECT, orgId: F33_ORG }
        },
      },
    },
  }
}

const f33RealTenantScoped = await import("@/lib/db/tenant-scoped")
const { getTableName } = await import("drizzle-orm")

async function f33Setup() {
  const { resetScheduleLookupCache } = await import("./schedule-lookup-cache")
  resetScheduleLookupCache()
  f33Ops = []
  f33TransactionCount = 0
  f33ClaimResult = [{ issueSequence: 7 }]
  f33ExistingStatuses = [
    { id: F33_STATUS_BACKLOG, isDefault: true, position: 0 },
    { id: "status-todo", isDefault: false, position: 1 },
  ]
  f33ProjectIssues = [
    { completionPercentage: 100, isArchived: false },
    { completionPercentage: 0, isArchived: false },
  ]
  await mock.module("@/lib/db/tenant-scoped", () => ({
    ...f33RealTenantScoped,
    withTenantContext: async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => {
      f33TransactionCount += 1
      return fn(f33Db((t) => getTableName(t as Parameters<typeof getTableName>[0])))
    },
  }))
  return import("./pms-issue-service")
}

function f33Input(
  overrides: Partial<{ projectId: string; typeId: string; title: string; assigneeIds: string[]; labelIds: string[]; statusId: string }> = {}
) {
  return { projectId: F33_PROJECT, typeId: F33_TYPE, title: "Pour raft slab", ...overrides }
}

const f33Ctx = { orgId: F33_ORG, userId: F33_USER }

describe("createIssue -- R67 F-33: the same write, four round trips instead of eleven", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => f33RealTenantScoped)
  })

  test("the project's existence and its next number are ONE statement -- the separate projects.findFirst is gone", async () => {
    const { createIssue } = await f33Setup()
    await createIssue(f33Ctx, f33Input())

    expect(f33TransactionCount).toBe(1)
    expect(f33Ops[0]).toMatchObject({ op: "update.returning", table: "projects" })
    expect(f33Ops.some((o) => o.op === "select" && o.table === "projects")).toBe(false)
  })

  test("the number written on the issue is the one the claim statement returned, not a re-read", async () => {
    const { createIssue } = await f33Setup()
    f33ClaimResult = [{ issueSequence: 42 }]
    const row = await createIssue(f33Ctx, f33Input())
    expect(row.number).toBe(42)
  })

  test("a project that is not in this org is a 404, and no issue row is inserted", async () => {
    const { createIssue, ServiceError: SE } = await f33Setup()
    f33ClaimResult = []
    await expect(createIssue(f33Ctx, f33Input())).rejects.toBeInstanceOf(SE)
    expect(f33Ops.some((o) => o.table === "pms_issues" && o.op.startsWith("insert"))).toBe(false)
  })

  test("a warm create is four round trips: claim, insert, rollup read, rollup write -- no status read, no re-read of the issue", async () => {
    const { createIssue } = await f33Setup()
    await createIssue(f33Ctx, f33Input()) // cold: also reads the statuses once
    f33Ops = []

    await createIssue(f33Ctx, f33Input({ title: "Second task" }))

    expect(f33Ops.map((o) => `${o.op} ${o.table}`)).toEqual([
      "update.returning projects",
      "insert.returning pms_issues",
      "select pms_issues",
      "update projects",
    ])
  })

  test("the project's default status is read once and then served from the 60 s cache", async () => {
    const { createIssue } = await f33Setup()
    await createIssue(f33Ctx, f33Input())
    await createIssue(f33Ctx, f33Input({ title: "Second task" }))
    expect(f33Ops.filter((o) => o.table === "pms_issue_statuses")).toHaveLength(1)
  })

  test("the resolved status really is the project's default one, not simply its first row", async () => {
    const { createIssue } = await f33Setup()
    f33ExistingStatuses = [
      { id: "status-todo", isDefault: false, position: 0 },
      { id: F33_STATUS_BACKLOG, isDefault: true, position: 1 },
    ]
    const row = await createIssue(f33Ctx, f33Input())
    expect(row.statusId).toBe(F33_STATUS_BACKLOG)
  })

  test("a caller-supplied statusId is honoured and costs no lookup at all", async () => {
    const { createIssue } = await f33Setup()
    const row = await createIssue(f33Ctx, f33Input({ statusId: "status-chosen" }))
    expect(row.statusId).toBe("status-chosen")
    expect(f33Ops.some((o) => o.table === "pms_issue_statuses")).toBe(false)
  })

  test("the assignee rows are still written, in the same transaction, and the primary-assignee cache still mirrors the first of them", async () => {
    const { createIssue } = await f33Setup()
    const row = await createIssue(f33Ctx, f33Input({ assigneeIds: ["user-a", "user-b"] }))

    expect(f33Ops.filter((o) => o.table === "pms_issue_assignees").map((o) => o.op)).toEqual(["delete", "insert"])
    const inserted = f33Ops.find((o) => o.table === "pms_issue_assignees" && o.op === "insert")!.payload
    expect(inserted).toEqual([
      { issueId: "issue-created", userId: "user-a" },
      { issueId: "issue-created", userId: "user-b" },
    ])
    expect(row.assigneeId).toBe("user-a")
    expect(row.assigneeIds).toEqual(["user-a", "user-b"])
  })

  test("the label rows are still written when labels are supplied", async () => {
    const { createIssue } = await f33Setup()
    const row = await createIssue(f33Ctx, f33Input({ labelIds: ["label-1"] }))
    expect(f33Ops.filter((o) => o.table === "pms_issue_labels").map((o) => o.op)).toEqual(["delete", "insert"])
    expect(row.labelIds).toEqual(["label-1"])
  })

  test("the project rollup is still recomputed and persisted, with the shared rule's own answer", async () => {
    const { createIssue, calculateProjectRollupPercentage: rollup } = await f33Setup()
    await createIssue(f33Ctx, f33Input())

    const rollupWrite = f33Ops.filter((o) => o.op === "update" && o.table === "projects").at(-1)!
    const written = (rollupWrite.payload as { rollupPercentage: number }).rollupPercentage
    expect(written).toBe(rollup(f33ProjectIssues))
    expect(written).toBe(50)
  })

  test("the returned row is what a later GET would show -- built from what the create already knows, not re-read", async () => {
    const { createIssue } = await f33Setup()
    const row = await createIssue(f33Ctx, f33Input())

    // A brand-new issue can have no children, so the parent rollup is its own
    // percentage -- the same rule getIssueRow() applies.
    expect(row.completionPercentage).toBe(0)
    expect(row.assigneeIds).toEqual([])
    expect(row.labelIds).toEqual([])
    expect(row.assigneeId).toBeNull()
    expect(row.title).toBe("Pour raft slab")
    expect(row.orgId).toBe(F33_ORG)
    expect(row.projectId).toBe(F33_PROJECT)
    expect(row.createdById).toBe(F33_USER)
    // The only pms_issues SELECT is the rollup's -- the issue itself is never
    // read back after being inserted.
    expect(f33Ops.filter((o) => o.table === "pms_issues" && o.op === "select")).toHaveLength(1)
  })

  test("a blank title is refused before any statement runs -- an abandoned create never burns a task number", async () => {
    const { createIssue, ServiceError: SE } = await f33Setup()
    await expect(createIssue(f33Ctx, f33Input({ title: "   " }))).rejects.toBeInstanceOf(SE)
    expect(f33Ops).toHaveLength(0)
  })

  test("DEBUG_LATENCY=1 records one line per create naming every stage of it", async () => {
    const { createIssue } = await f33Setup()
    const originalDebug = process.env.DEBUG_LATENCY
    const printed: string[] = []
    const originalLog = console.log
    process.env.DEBUG_LATENCY = "1"
    console.log = (line: string) => printed.push(line)
    try {
      await createIssue(f33Ctx, f33Input())
    } finally {
      console.log = originalLog
      if (originalDebug === undefined) delete process.env.DEBUG_LATENCY
      else process.env.DEBUG_LATENCY = originalDebug
    }

    const line = printed.map((l) => JSON.parse(l)).find((l) => l.t === "query-timing" && l.scope === "createIssue")
    expect(line).toBeDefined()
    expect(line.projectId).toBe(F33_PROJECT)
    expect(line.queries.map((q: { label: string }) => q.label)).toEqual([
      "project.claimNumber", "status.resolveDefault", "issue.insert", "issue.assignees", "issue.labels", "project.rollup",
    ])
  })
})
