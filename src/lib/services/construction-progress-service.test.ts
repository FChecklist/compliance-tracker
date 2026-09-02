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
]
const lineItemRows = [
  { id: "LINE-B", orgId: ORG, boqId: "BOQ-B", parentLineItemId: null },
]

let insertedRows: Record<string, unknown>[] = []

// R67 F-05 fixtures. listProgressEntries() now resolves each row's display
// labels itself, so the fake needs the three findMany() reads it makes: the
// entries, then ONE batched activity read and ONE batched line-item read.
// Deliberately labelled differently from each other so a row that picked up
// the wrong activity's name, or a BOQ line's unit where the activity's was
// expected, is visible in the assertion rather than plausible.
const labelActivityRows = [
  { id: "ACT-A", orgId: ORG, name: "Blockwork", unit: "sqm" },
  { id: "ACT-B", orgId: ORG, name: "Plastering", unit: "sqm" },
]
const labelLineItemRows = [
  { id: "LINE-A", orgId: ORG, itemCode: "A-102", description: "230mm blockwork to walls", unit: "cum" },
]
let progressEntryRows: Record<string, unknown>[] = []
// Every findMany() the service issues, in order, so a test can prove it made
// three reads and not one-per-row.
let findManyCalls: string[] = []

const fakeDb = {
  query: {
    projects: {
      findFirst: async ({ where }: { where: SQL }) => projectRows.find((r) => matches(r, where)),
    },
    constructionActivities: {
      findFirst: async ({ where }: { where: SQL }) => activityRows.find((r) => matches(r, where)),
      findMany: async () => {
        findManyCalls.push("constructionActivities")
        return labelActivityRows
      },
    },
    constructionBoqLineItems: {
      findFirst: async ({ where }: { where: SQL }) => lineItemRows.find((r) => matches(r, where)),
      findMany: async () => {
        findManyCalls.push("constructionBoqLineItems")
        return labelLineItemRows
      },
    },
    constructionWorkProgressEntries: {
      findMany: async () => {
        findManyCalls.push("constructionWorkProgressEntries")
        return progressEntryRows
      },
    },
    constructionBoqs: {
      findFirst: async ({ where }: { where: SQL }) => boqRows.find((r) => matches(r, where)),
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
}

const realTenantScoped = await import("@/lib/db/tenant-scoped")
async function restoreRealModules(): Promise<void> {
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
}

beforeEach(() => {
  capturedOrgIds = []
  insertedRows = []
  progressEntryRows = []
  findManyCalls = []
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


// R67 F-05 (R-075). The Work Progress list needs a readable activity name and
// BOQ line on every row. It used to get them by fetching GET /api/scope (the
// whole BOQ list, 1.5-4.4 s) and then GET /api/scope/{id} from the BROWSER,
// after the entries had already arrived -- three serial hops per screen, and
// the Analytics tab repeated the whole chain on switch. listProgressEntries()
// now returns those labels itself, from the transaction it already holds.
describe("listProgressEntries -- R67 F-05 joined display labels", () => {
  async function callList() {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mockWithTenantContext }))
    const { listProgressEntries } = await import("./construction-progress-service")
    return listProgressEntries({ orgId: ORG }, { projectId: PROJECT_A })
  }

  test("a BOQ-linked entry carries activityName, boqItemCode, boqLineDescription and the BOQ line's unit", async () => {
    progressEntryRows = [
      { id: "e1", orgId: ORG, projectId: PROJECT_A, activityId: "ACT-A", boqLineItemId: "LINE-A", entryDate: "2026-09-01", quantityDone: "5", percentComplete: "40" },
    ]

    const [entry] = await callList()

    expect(entry.activityName).toBe("Blockwork")
    expect(entry.boqItemCode).toBe("A-102")
    expect(entry.boqLineDescription).toBe("230mm blockwork to walls")
    // the BOQ line's unit wins over the activity's -- it is the unit the
    // quantity was actually measured in
    expect(entry.unit).toBe("cum")
    // the original row is preserved, not replaced by a projection
    expect(entry.id).toBe("e1")
    expect(entry.percentComplete).toBe("40")
  })

  test("a legacy activity-only entry falls back to the activity's unit and reports null BOQ fields", async () => {
    progressEntryRows = [
      { id: "e2", orgId: ORG, projectId: PROJECT_A, activityId: "ACT-B", boqLineItemId: null, entryDate: "2026-09-01", quantityDone: "2", percentComplete: "10" },
    ]

    const [entry] = await callList()

    expect(entry.activityName).toBe("Plastering")
    expect(entry.boqItemCode).toBeNull()
    expect(entry.boqLineDescription).toBeNull()
    expect(entry.unit).toBe("sqm")
  })

  test("a reference that no longer resolves reports null, never the raw id dressed up as a name", async () => {
    progressEntryRows = [
      { id: "e3", orgId: ORG, projectId: PROJECT_A, activityId: "ACT-DELETED", boqLineItemId: "LINE-DELETED", entryDate: "2026-09-01", quantityDone: "1", percentComplete: "5" },
    ]

    const [entry] = await callList()

    expect(entry.activityName).toBeNull()
    expect(entry.boqItemCode).toBeNull()
    expect(entry.boqLineDescription).toBeNull()
    expect(entry.unit).toBeNull()
  })

  test("N entries cost exactly ONE activity read and ONE line-item read, not one per row", async () => {
    progressEntryRows = Array.from({ length: 25 }, (_, i) => ({
      id: `e${i}`, orgId: ORG, projectId: PROJECT_A, activityId: i % 2 ? "ACT-A" : "ACT-B",
      boqLineItemId: "LINE-A", entryDate: "2026-09-01", quantityDone: "1", percentComplete: "1",
    }))

    const rows = await callList()

    expect(rows).toHaveLength(25)
    expect(findManyCalls).toEqual(["constructionWorkProgressEntries", "constructionActivities", "constructionBoqLineItems"])
    // and all of it on ONE tenant transaction
    expect(mockWithTenantContext).toHaveBeenCalledTimes(1)
  })

  test("an empty result set makes no label reads at all", async () => {
    progressEntryRows = []

    const rows = await callList()

    expect(rows).toEqual([])
    expect(findManyCalls).toEqual(["constructionWorkProgressEntries"])
  })
})
