// R62 B7 / R48_PROGRESS_ENTRY_NO_PROJECT_MEMBERSHIP_CHECK_01 (High, fixed R53
// 2026-08-26, live in prod since R56 2026-08-27): createProgressEntry() used
// to scope its activity lookup and its BOQ-line-item's-parent-BOQ lookup by
// orgId ONLY -- never by the SUPPLIED input.projectId -- so within a single
// org a caller could post a progress entry naming Project A while its
// activityId/boqLineItemId actually belonged to Project B, and the row would
// be stored (and read back) as Project A's progress. Silent intra-tenant
// misattribution, not a cross-org leak.
//
// This does NOT touch a live DB. It exercises the real createProgressEntry()
// with only withTenantContext mocked (this repo's established pattern, see
// projexa-records-tenant-isolation.test.ts / tenant-isolation.test.ts), but
// the fake db.query.*.findFirst implementations below do NOT just return
// canned rows unconditionally -- they parse the actual drizzle `where`
// clause the service builds (via extractEqPredicates, which walks the real
// eq()/and() SQL chunk tree drizzle-orm produces) and only "find" a row that
// satisfies every equality predicate the service actually asked for. That
// means this test would FAIL to catch a regression if the service stopped
// building those predicates BUT the fake still hard-returned a row -- it
// doesn't; it genuinely re-evaluates whatever predicates the real code
// supplies each run, so removing the project_id predicate from the service
// makes the fake match rows it should not, exactly reproducing the original
// bug's observable behavior (entry accepted instead of 404).
/// <reference types="bun-types" />
import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"
import type { SQL } from "drizzle-orm"

const ORG = "org-r62b7"
const PROJECT_A = "project-a"
const PROJECT_B = "project-b"

// Walks a drizzle eq()/and() SQL condition tree and pulls out every
// {columnName: value} equality predicate it contains, regardless of AND
// nesting depth. Drizzle represents `eq(col, val)` as an SQL node whose
// queryChunks is [StringChunk, Column, StringChunk" = ", Param, StringChunk],
// and `and(a, b, c)` as an SQL node whose queryChunks interleaves those
// sub-SQL nodes with " and " StringChunks -- so a plain recursive walk that
// records "the last Column seen, paired with the next Param seen" inside
// each queryChunks array correctly recovers every eq() pair at any depth.
function extractEqPredicates(node: unknown, acc: Record<string, unknown> = {}): Record<string, unknown> {
  if (!node || typeof node !== "object") return acc
  const chunks = (node as { queryChunks?: unknown[] }).queryChunks
  if (!Array.isArray(chunks)) return acc
  let pendingColumn: string | null = null
  for (const chunk of chunks) {
    if (chunk && typeof chunk === "object") {
      if ("columnType" in chunk && "name" in chunk) {
        pendingColumn = (chunk as { name: string }).name
      } else if ("value" in chunk && "encoder" in chunk) {
        if (pendingColumn) {
          acc[pendingColumn] = (chunk as { value: unknown }).value
          pendingColumn = null
        }
      } else {
        extractEqPredicates(chunk, acc)
      }
    }
  }
  return acc
}

// Real drizzle findFirst() results come back keyed by the JS-side (camelCase)
// field name, e.g. `lineItem.boqId`, even though the `where` clause's Column
// objects carry the DB (snake_case) column name (e.g. "boq_id") -- the
// service reads `lineItem.boqId` directly (line 112 of
// construction-progress-service.ts). So predicates extracted from `where`
// must be translated snake_case -> camelCase before matching against the
// fixture rows below, which are (deliberately) shaped exactly like real
// drizzle rows -- otherwise this fake would silently accept an `undefined`
// predicate value as "no constraint" and mask exactly the kind of
// column-name mismatch a real regression could also produce.
function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

function matches(row: Record<string, unknown>, where: unknown): boolean {
  const predicates = extractEqPredicates(where)
  return Object.entries(predicates).every(([col, val]) => row[snakeToCamel(col)] === val)
}

let capturedOrgIds: string[] = []
const mockWithTenantContext = mock(async (ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => {
  capturedOrgIds.push(ctx.orgId)
  return fn(fakeDb as unknown as never)
})

// Fixture data: activity ACT-B and BOQ line item LINE-B both genuinely
// belong to PROJECT_B (and BOQ_B), same org. The project row for PROJECT_A
// exists too (assertProject must pass). This is the exact shape of the
// original bug report: caller sends projectId=PROJECT_A but activityId
// (and/or boqLineItemId) that actually belongs to PROJECT_B.
const projectRows = [
  { id: PROJECT_A, orgId: ORG },
  { id: PROJECT_B, orgId: ORG },
]
const activityRows = [
  { id: "ACT-B", orgId: ORG, projectId: PROJECT_B },
  { id: "ACT-A", orgId: ORG, projectId: PROJECT_A },
]
const boqRows = [
  { id: "BOQ-B", orgId: ORG, projectId: PROJECT_B },
  { id: "BOQ-A", orgId: ORG, projectId: PROJECT_A },
]
// R67 D-28: LINE-PARENT is a real line of PROJECT_A's own BOQ (BOQ-A) that HAS
// a child (LINE-CHILD points at it), so it clears every ownership check and is
// refused ONLY by the parent-line rule -- for the new PATCH path as well as the
// original POST path.
const lineItemRows = [
  { id: "LINE-B", orgId: ORG, boqId: "BOQ-B", parentLineItemId: null },
  { id: "LINE-PARENT", orgId: ORG, boqId: "BOQ-A", parentLineItemId: null },
  { id: "LINE-CHILD", orgId: ORG, boqId: "BOQ-A", parentLineItemId: "LINE-PARENT" },
]

let insertedRows: Record<string, unknown>[] = []
// R67 D-28: every `set()` the service issues on an update, so a test can prove
// BOTH that a rejected edit wrote nothing and that an accepted edit wrote only
// the fields the caller actually sent.
let updatedSets: Record<string, unknown>[] = []

const progressEntryRows: Record<string, unknown>[] = [
  {
    id: "entry-existing", orgId: ORG, projectId: PROJECT_A, activityId: "ACT-A", boqLineItemId: null,
    entryDate: "2026-08-28", quantityDone: "5", percentComplete: "50", entryBasis: "DELTA",
    remarks: null, recordedById: "user-1", createdAt: new Date("2026-08-28T00:00:00Z"),
  },
]

// The enriched (LEFT-JOINed) shape selectEnrichedEntries() returns. Keyed by
// the same entry ids as progressEntryRows so a read-back after an update
// resolves to a real row.
const enrichedRows: Record<string, unknown>[] = [
  {
    ...progressEntryRows[0],
    activityName: "Blockwork", activityUnit: "m2",
    boqItemCode: null, boqLineDescription: null, boqLineUnit: null,
    boqLineQuantity: null, boqLineRate: null, boqLineAmount: null,
  },
]

/** Awaitable AND chainable, because selectEnrichedEntries() awaits `.where(...)` directly for a single row and calls `.orderBy(...)` on it for a list. */
type SelectResult = {
  then: (resolve: (value: Record<string, unknown>[]) => unknown, reject?: (reason: unknown) => unknown) => Promise<unknown>
  orderBy: () => Promise<Record<string, unknown>[]>
}
function selectResult(rows: Record<string, unknown>[]): SelectResult {
  return {
    then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject),
    orderBy: async () => rows,
  }
}

type JoinChain = { leftJoin: () => JoinChain; where: () => SelectResult }
const joinChain: JoinChain = { leftJoin: () => joinChain, where: () => selectResult(enrichedRows) }

const fakeDb = {
  query: {
    projects: {
      findFirst: async ({ where }: { where: SQL }) => projectRows.find((r) => matches(r, where)),
    },
    constructionActivities: {
      findFirst: async ({ where }: { where: SQL }) => activityRows.find((r) => matches(r, where)),
    },
    constructionBoqLineItems: {
      findFirst: async ({ where }: { where: SQL }) => lineItemRows.find((r) => matches(r, where)),
    },
    constructionBoqs: {
      findFirst: async ({ where }: { where: SQL }) => boqRows.find((r) => matches(r, where)),
    },
    constructionWorkProgressEntries: {
      findFirst: async ({ where }: { where: SQL }) => progressEntryRows.find((r) => matches(r, where)),
    },
  },
  insert: () => ({
    values: (v: Record<string, unknown>) => ({
      returning: async () => {
        const row = { ...v, id: "entry-1", percentComplete: String(v.percentComplete ?? "0") }
        insertedRows.push(row)
        return [row]
      },
    }),
  }),
  select: () => ({ from: () => joinChain }),
  update: () => ({
    set: (v: Record<string, unknown>) => ({
      where: async () => {
        updatedSets.push(v)
        return []
      },
    }),
  }),
}

const realTenantScoped = await import("@/lib/db/tenant-scoped")
async function restoreRealModules(): Promise<void> {
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
}

beforeEach(() => {
  capturedOrgIds = []
  insertedRows = []
  updatedSets = []
  mockWithTenantContext.mockClear()
})

afterEach(async () => {
  mock.restore()
  await restoreRealModules()
})

describe("createProgressEntry -- R48_PROGRESS_ENTRY_NO_PROJECT_MEMBERSHIP_CHECK_01", () => {
  test("activityId belonging to a DIFFERENT project than the supplied projectId is rejected (404), not silently accepted", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mockWithTenantContext }))
    const { createProgressEntry, ServiceError } = await import("./construction-progress-service")

    // PROJECT_A is a real project in this org; ACT-B is a real activity in
    // this org but belongs to PROJECT_B, not PROJECT_A. Pre-fix, the
    // activity lookup was scoped by orgId only, so it would still resolve
    // ACT-B and the entry would be written attributed to PROJECT_A.
    await expect(
      createProgressEntry(
        { orgId: ORG, userId: "user-1" },
        { projectId: PROJECT_A, activityId: "ACT-B", entryDate: "2026-08-28", quantityDone: 5, percentComplete: 50 }
      )
    ).rejects.toThrow(ServiceError)

    expect(insertedRows).toHaveLength(0)
  })

  test("activityId belonging to the SAME supplied project succeeds -- the fix does not break the legitimate same-project case", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mockWithTenantContext }))
    const { createProgressEntry } = await import("./construction-progress-service")

    const row = await createProgressEntry(
      { orgId: ORG, userId: "user-1" },
      { projectId: PROJECT_B, activityId: "ACT-B", entryDate: "2026-08-28", quantityDone: 5, percentComplete: 50 }
    )

    expect(row).toBeDefined()
    expect(insertedRows).toHaveLength(1)
    expect(insertedRows[0].projectId).toBe(PROJECT_B)
    expect(insertedRows[0].activityId).toBe("ACT-B")
    expect(capturedOrgIds.every((id) => id === ORG)).toBe(true)
  })

  test("boqLineItemId belonging to a DIFFERENT project's BOQ than the supplied projectId is rejected (404), even though the activity itself is valid for that project", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mockWithTenantContext }))
    const { createProgressEntry, ServiceError } = await import("./construction-progress-service")

    // ACT-A genuinely belongs to PROJECT_A (passes the activity check), but
    // LINE-B's parent BOQ (BOQ-B) belongs to PROJECT_B. Pre-fix, the BOQ
    // lookup was scoped by orgId only, so it would still resolve BOQ-B and
    // silently accept a line item from the wrong project.
    await expect(
      createProgressEntry(
        { orgId: ORG, userId: "user-1" },
        { projectId: PROJECT_A, activityId: "ACT-A", boqLineItemId: "LINE-B", entryDate: "2026-08-28", quantityDone: 5, percentComplete: 50 }
      )
    ).rejects.toThrow(ServiceError)

    expect(insertedRows).toHaveLength(0)
  })
})

// R67 D-28 (R-069/R-071). Work Progress was create-only: no read of one entry,
// no correction, no delete route. The two rules that matter when an edit
// becomes possible are that it must run the SAME validation the create path
// runs -- the item's own words -- and that a rejected edit must write nothing.
// Both are asserted here against the real service with only withTenantContext
// mocked, the same harness the tests above use.
describe("R67 D-28 -- pure rules shared by create and update", () => {
  test("normaliseEntryBasis defaults to DELTA, accepts SNAPSHOT, and refuses anything else", async () => {
    const { normaliseEntryBasis, ServiceError } = await import("./construction-progress-service")
    expect(normaliseEntryBasis(undefined)).toBe("DELTA")
    expect(normaliseEntryBasis(null)).toBe("DELTA")
    expect(normaliseEntryBasis("SNAPSHOT")).toBe("SNAPSHOT")
    expect(() => normaliseEntryBasis("CUMULATIVE")).toThrow(ServiceError)
  })

  test("assertPercentComplete accepts 0 and 100 and refuses outside, NaN included", async () => {
    const { assertPercentComplete, PERCENT_COMPLETE_RANGE_MESSAGE } = await import("./construction-progress-service")
    expect(() => assertPercentComplete(0)).not.toThrow()
    expect(() => assertPercentComplete(100)).not.toThrow()
    expect(() => assertPercentComplete(100.01)).toThrow(PERCENT_COMPLETE_RANGE_MESSAGE)
    expect(() => assertPercentComplete(-1)).toThrow(PERCENT_COMPLETE_RANGE_MESSAGE)
    expect(() => assertPercentComplete(Number.NaN)).toThrow(PERCENT_COMPLETE_RANGE_MESSAGE)
  })

  test("resolveProgressUnit prefers the BOQ line's unit and falls back to the activity's", async () => {
    const { resolveProgressUnit } = await import("./construction-progress-service")
    expect(resolveProgressUnit({ boqLineUnit: "m2", activityUnit: "nos" })).toBe("m2")
    expect(resolveProgressUnit({ boqLineUnit: null, activityUnit: "nos" })).toBe("nos")
    expect(resolveProgressUnit({ boqLineUnit: null, activityUnit: null })).toBeNull()
  })
})

describe("updateProgressEntry -- R67 D-28", () => {
  // A patch naming no field used to reach db.update().set({}), where
  // drizzle's mapUpdateSet filters every undefined and throws a plain
  // Error("No values to set") -- not a ServiceError, so the route's generic
  // catch answered 500 for what is plainly a 400. PATCH {} is a request a real
  // Bearer-key integration will send.
  test("an EMPTY patch is a 400 by name, not a 500, and nothing is written", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mockWithTenantContext }))
    const { updateProgressEntry, ServiceError } = await import("./construction-progress-service")

    let thrown: unknown
    try {
      await updateProgressEntry({ orgId: ORG }, "entry-existing", {})
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(ServiceError)
    expect((thrown as Error).message).toBe("No fields to update")
    expect((thrown as { status: number }).status).toBe(400)
    expect(updatedSets).toHaveLength(0)
  })

  test("a percent outside 0-100 is refused with the same message create uses, and NOTHING is written", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mockWithTenantContext }))
    const { updateProgressEntry, PERCENT_COMPLETE_RANGE_MESSAGE } = await import("./construction-progress-service")

    await expect(
      updateProgressEntry({ orgId: ORG }, "entry-existing", { percentComplete: 140 })
    ).rejects.toThrow(PERCENT_COMPLETE_RANGE_MESSAGE)

    expect(updatedSets).toHaveLength(0)
  })

  test("re-pointing an entry at a PARENT BOQ line is refused with the create path's verbatim message", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mockWithTenantContext }))
    const { updateProgressEntry, PARENT_LINE_PROGRESS_MESSAGE } = await import("./construction-progress-service")

    // LINE-PARENT belongs to BOQ-A, which belongs to PROJECT_A -- the entry's
    // own project -- so it passes every ownership check and is refused ONLY by
    // the parent-line rule, which is the rule under test.
    await expect(
      updateProgressEntry({ orgId: ORG }, "entry-existing", { boqLineItemId: "LINE-PARENT" })
    ).rejects.toThrow(PARENT_LINE_PROGRESS_MESSAGE)

    expect(updatedSets).toHaveLength(0)
  })

  test("a BOQ line from ANOTHER project is refused 404, even though it exists in this org", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mockWithTenantContext }))
    const { updateProgressEntry } = await import("./construction-progress-service")

    // LINE-B is real and in this org, but its BOQ belongs to PROJECT_B while
    // the entry belongs to PROJECT_A. An edit must never move an entry across
    // that boundary.
    await expect(
      updateProgressEntry({ orgId: ORG }, "entry-existing", { boqLineItemId: "LINE-B" })
    ).rejects.toThrow("BOQ line item not found")

    expect(updatedSets).toHaveLength(0)
  })

  test("an accepted edit writes only the fields the caller sent, and reads back the enriched row", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mockWithTenantContext }))
    const { updateProgressEntry } = await import("./construction-progress-service")

    const row = await updateProgressEntry({ orgId: ORG }, "entry-existing", { quantityDone: 5 })

    expect(updatedSets).toHaveLength(1)
    expect(updatedSets[0].quantityDone).toBe("5")
    // Everything the caller did not send is `undefined`, which drizzle omits
    // from the UPDATE -- an absent field must never be read as "clear it".
    expect(updatedSets[0].percentComplete).toBeUndefined()
    expect(updatedSets[0].activityId).toBeUndefined()
    expect(updatedSets[0].boqLineItemId).toBeUndefined()
    expect(updatedSets[0].remarks).toBeUndefined()
    // The read-back is the SAME enriched shape the list returns -- names
    // resolved, unit derived -- so the object page never re-resolves them.
    expect(row.activityName).toBe("Blockwork")
    expect(row.unit).toBe("m2")
  })

  test("an unknown entry id is a 404, not a silent no-op", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mockWithTenantContext }))
    const { updateProgressEntry } = await import("./construction-progress-service")

    await expect(
      updateProgressEntry({ orgId: ORG }, "entry-does-not-exist", { quantityDone: 1 })
    ).rejects.toThrow("Progress entry not found")
    expect(updatedSets).toHaveLength(0)
  })
})
