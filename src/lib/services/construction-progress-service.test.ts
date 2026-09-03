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
// R67 B-09 needs a project that genuinely has NO BOQ, to exercise the other
// half of its rule. PROJECT_A cannot be it: R67 D-28 gave PROJECT_A its own BOQ
// (BOQ-A) so LINE-PARENT/LINE-CHILD could exercise the parent-line rule on the
// new PATCH path. Rather than weaken either fixture, the no-BOQ case gets its
// own project.
const PROJECT_NO_BOQ = "project-no-boq"

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
  { id: PROJECT_NO_BOQ, orgId: ORG },
]
const activityRows = [
  { id: "ACT-B", orgId: ORG, projectId: PROJECT_B },
  { id: "ACT-A", orgId: ORG, projectId: PROJECT_A },
  { id: "ACT-NO-BOQ", orgId: ORG, projectId: PROJECT_NO_BOQ },
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
    // R67 integration: the joined description field is F-24's `boqDescription`
    // (already on main and read by PROJEXA's merged list client), not D-28's
    // original `boqLineDescription` -- one name for one column.
    boqItemCode: null, boqDescription: null, boqLineUnit: null,
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

// R67 integration note: lane F1's F-05 fixtures (labelActivityRows,
// labelLineItemRows, findManyCalls) and its own `let progressEntryRows` are
// gone. They stubbed the batched-ORM-read mechanism F-24 replaced with two LEFT
// JOINs, and the second `progressEntryRows` shadowed main's real fixture of the
// same name. The list's joined labels are covered by the F-24 suite below.

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
    constructionWorkProgressEntries: {
      findFirst: async ({ where }: { where: SQL }) => progressEntryRows.find((r) => matches(r, where)),
    },
    constructionBoqs: {
      findFirst: async ({ where }: { where: SQL }) => boqRows.find((r) => matches(r, where)),
    },
    // Merge note (D22 with lane B): createProgressEntry() now finishes by
    // rolling the linked schedule activities up (item D-49), so this fixture
    // has to answer that query too. NO activity in this fixture is linked to a
    // BOQ line -- which is the honest state for lane B's own projects -- so the
    // roll-up short-circuits on its first lookup and changes nothing these
    // B-09 tests assert. The D-49 tests further down exercise the roll-up
    // itself against their own db, whose where-matcher understands the
    // inArray() this one deliberately does not.
    pmsIssueBoqLinks: {
      findMany: async () => [],
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

    // R67 B-09 added `boqLineItemId: "LINE-B"` here. PROJECT_B genuinely has
    // a BOQ (BOQ-B), and the new rule requires a line for a project that has
    // one -- so this call, which is about the ACTIVITY's project membership,
    // now supplies the line that project's own BOQ really holds. Without it
    // the test would be asserting the old, contradictory behaviour.
    const row = await createProgressEntry(
      { orgId: ORG, userId: "user-1" },
      { projectId: PROJECT_B, activityId: "ACT-B", boqLineItemId: "LINE-B", entryDate: "2026-08-28", quantityDone: 5, percentComplete: 50 }
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

// ---------------------------------------------------------------------------
// R67 F-05 (R-075) x F-24 (R-240), reconciled by the integration train.
//
// Both lanes fixed the SAME fault: the Work Progress list used to answer "what
// does the BOQ column say?" with a serial client chain -- entries, then
// GET /api/scope (the whole BOQ list, 1.5-4.4 s), then GET /api/scope/{id} --
// and still rendered a raw id in the cell. F-05 resolved the labels with two
// batched ORM reads inside the transaction; F-24 resolved them with two LEFT
// JOINs in one statement. F-24 is on main, so under decision D-11 it is
// canonical, and F-05's suite below was written against a mechanism that no
// longer exists (three findMany() calls, and the field name
// `boqLineDescription`, which F-24 calls `boqDescription` -- the name PROJEXA's
// merged list client already reads).
//
// Nothing was dropped without checking where it landed:
//   * labels on the row, one read not N per row  -> F-24's suite below
//   * the entry's own fields untouched            -> F-24's suite below
//   * the unit precedence rule                    -> resolveProgressUnit's own
//                                                    tests further down
//   * "a gone reference reports null, never the raw id" -> NOT covered by
//     F-24's fixture, so it is carried over here, rewritten against the join.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// R67 F-24 (audit recommendation R-240) -- the activity and BOQ-line NAMES come
// back with the entries, in ONE statement.
// ---------------------------------------------------------------------------
//
// Before this, PROJEXA's /work-progress screen answered "what does the BOQ
// column say?" with a serial client chain -- entries, then activities, then
// /api/scope, then one /api/scope/{id} per revision -- and still rendered a raw
// id in the cell. The service now LEFT JOINs both, so the names arrive with the
// rows and that whole chain is deleted client-side.
//
// The fake `select()` below is not a canned-row stub: it reads the projection
// the service actually built and resolves each column against the fixture by
// the column's real DB name, so selecting the wrong column (or forgetting one)
// produces an undefined value and fails here rather than passing silently.
const WP_ORG = "org-r67-f24"
const WP_PROJECT = "project-r67-f24"

// One entry, one activity, one BOQ line -- the acceptance fixture.
const wpFixtureRow: Record<string, unknown> = {
  // construction_work_progress_entries
  id: "entry-1",
  org_id: WP_ORG,
  project_id: WP_PROJECT,
  activity_id: "ACT-1",
  boq_line_item_id: "LINE-1",
  entry_date: "2026-09-02",
  quantity_done: "12",
  percent_complete: "40",
  entry_basis: "DELTA",
  remarks: null,
  recorded_by_id: "user-1",
  created_at: new Date("2026-09-02T06:00:00Z"),
  // construction_activities (only `name` is projected from here)
  name: "Excavation",
  // construction_boq_line_items
  item_code: "R60SK",
  description: "R60 skiphop root",
}

let wpSelectCalls = 0
let wpJoinCount = 0
let wpProjection: Record<string, unknown> = {}

function wpColumnName(column: unknown): string | null {
  if (column && typeof column === "object" && typeof (column as { name?: unknown }).name === "string") {
    return (column as { name: string }).name
  }
  return null
}

const wpSelectDb = {
  select(projection: Record<string, unknown>) {
    wpSelectCalls += 1
    wpJoinCount = 0
    wpProjection = projection
    const rows = () => [
      Object.fromEntries(
        Object.entries(projection).map(([field, column]) => {
          const name = wpColumnName(column)
          return [field, name === null ? undefined : wpFixtureRow[name]]
        })
      ),
    ]
    const chain = {
      from: () => chain,
      leftJoin: () => {
        wpJoinCount += 1
        return chain
      },
      where: () => chain,
      orderBy: () => chain,
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(rows()).then(resolve, reject),
    }
    return chain
  },
}

const wpWithTenantContext = mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) =>
  fn(wpSelectDb as unknown as never)
)

describe("listProgressEntries -- R67 F-24: resolved names in the payload, one statement", () => {
  beforeEach(() => {
    wpSelectCalls = 0
    wpJoinCount = 0
    wpProjection = {}
    wpWithTenantContext.mockClear()
  })

  afterEach(async () => {
    mock.restore()
    await restoreRealModules()
  })

  test("rows carry activityName and boqItemCode, and the list is exactly ONE SQL statement", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: wpWithTenantContext }))
    const { listProgressEntries } = await import("./construction-progress-service")

    const rows = await listProgressEntries({ orgId: WP_ORG }, { projectId: WP_PROJECT })

    expect(wpSelectCalls).toBe(1)
    // The two LEFT JOINs that replaced the client's /api/scope fan-out.
    expect(wpJoinCount).toBe(2)
    expect(rows).toHaveLength(1)
    expect(rows[0].activityName).toBe("Excavation")
    expect(rows[0].boqItemCode).toBe("R60SK")
    expect(rows[0].boqDescription).toBe("R60 skiphop root")
  })

  test("the entry's own fields are untouched -- every existing reader (WPR, the daily report, the PDF) keeps working", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: wpWithTenantContext }))
    const { listProgressEntries } = await import("./construction-progress-service")

    const [row] = await listProgressEntries({ orgId: WP_ORG }, { projectId: WP_PROJECT })

    expect(row.id).toBe("entry-1")
    expect(row.projectId).toBe(WP_PROJECT)
    expect(row.activityId).toBe("ACT-1")
    expect(row.boqLineItemId).toBe("LINE-1")
    expect(row.entryDate).toBe("2026-09-02")
    expect(row.quantityDone).toBe("12")
    expect(row.percentComplete).toBe("40")
    expect(row.entryBasis).toBe("DELTA")
    expect(row.recordedById).toBe("user-1")
  })

  test("the payload stays SMALL: three resolved strings, never a BOQ's line items", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: wpWithTenantContext }))
    const { listProgressEntries } = await import("./construction-progress-service")

    await listProgressEntries({ orgId: WP_ORG }, { projectId: WP_PROJECT })

    const joined = Object.keys(wpProjection).filter((k) => ["activityName", "boqItemCode", "boqDescription"].includes(k))
    expect(joined.sort()).toEqual(["activityName", "boqDescription", "boqItemCode"])
    // Nothing priced or quantified from the BOQ crosses the wire -- the
    // recommendation's own "no full BOQ" constraint.
    expect(Object.keys(wpProjection)).not.toContain("rate")
    expect(Object.keys(wpProjection)).not.toContain("amount")
  })

  test("neither projectId nor activityId is still rejected -- the pre-existing guard is unchanged", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: wpWithTenantContext }))
    const { listProgressEntries, ServiceError: SvcError } = await import("./construction-progress-service")

    await expect(listProgressEntries({ orgId: WP_ORG }, {})).rejects.toThrow(SvcError)
    expect(wpSelectCalls).toBe(0)
  })
})


// R67 F-05, carried over: the case F-24's own fixture does not cover.
describe("listProgressEntries -- a reference that no longer resolves", () => {
  beforeEach(() => {
    wpSelectCalls = 0
    wpJoinCount = 0
    wpProjection = {}
    wpWithTenantContext.mockClear()
  })

  afterEach(async () => {
    mock.restore()
    await restoreRealModules()
  })

  test("reports null, never the raw id dressed up as a name", async () => {
    // boq_line_item_id is ON DELETE SET NULL and the joins are LEFT, so a row
    // whose activity or BOQ line is gone must still LIST -- with nulls, which
    // the client renders as an em-dash. A raw id in a name cell is the defect
    // the audit photographed.
    const previous = { name: wpFixtureRow.name, item_code: wpFixtureRow.item_code, description: wpFixtureRow.description }
    wpFixtureRow.name = null
    wpFixtureRow.item_code = null
    wpFixtureRow.description = null
    try {
      await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: wpWithTenantContext }))
      const { listProgressEntries } = await import("./construction-progress-service")

      const [row] = await listProgressEntries({ orgId: WP_ORG }, { projectId: WP_PROJECT })

      expect(row.id).toBe("entry-1")
      expect(row.activityName).toBeNull()
      expect(row.boqItemCode).toBeNull()
      expect(row.boqDescription).toBeNull()
      expect(row.unit).toBeNull()
    } finally {
      Object.assign(wpFixtureRow, previous)
    }
  })
})
// ── R67 B-09: ONE RULE FOR A PROGRESS ENTRY, BOTH PROJECT STATES ──────────
// The fixture already contains exactly the two projects this rule needs:
// PROJECT_B has a BOQ (BOQ-B), PROJECT_A has none. So both branches are
// exercised against the SAME real service function, with the same fake db
// that re-evaluates the real drizzle predicates rather than returning canned
// rows.
describe("createProgressEntry -- R67 B-09: the BOQ-line rule", () => {
  test("a project WITH a BOQ rejects an entry that names no line, with code BOQ_LINE_REQUIRED and missing ['boqLine']", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mockWithTenantContext }))
    const { createProgressEntry, ProgressRuleError } = await import("./construction-progress-service")

    let thrown: unknown = null
    try {
      await createProgressEntry(
        { orgId: ORG, userId: "user-1" },
        { projectId: PROJECT_B, activityId: "ACT-B", entryDate: "2026-08-28", quantityDone: 5, percentComplete: 50 }
      )
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(ProgressRuleError)
    const e = thrown as InstanceType<typeof ProgressRuleError>
    expect(e.code).toBe("BOQ_LINE_REQUIRED")
    expect(e.missing).toEqual(["boqLine"])
    expect(e.status).toBe(400)
    // D-03: the server raises a code, never a sentence a client could print.
    expect(e.message).not.toContain("itemCode")
    // and NOTHING was written
    expect(insertedRows).toHaveLength(0)
  })

  test("a project WITHOUT a BOQ accepts the entry and reports linkedToBoq false", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mockWithTenantContext }))
    const { createProgressEntry } = await import("./construction-progress-service")

    // PROJECT_NO_BOQ, not PROJECT_A: PROJECT_A has held a BOQ since D-28, and
    // this test is about the branch where there is nothing to link to at all.
    const row = await createProgressEntry(
      { orgId: ORG, userId: "user-1" },
      { projectId: PROJECT_NO_BOQ, activityId: "ACT-NO-BOQ", entryDate: "2026-08-28", quantityDone: 5, percentComplete: 50 }
    )

    expect(row.linkedToBoq).toBe(false)
    expect(insertedRows).toHaveLength(1)
    expect(insertedRows[0].boqLineItemId).toBeNull()
  })

  test("a project WITH a BOQ and a real line succeeds and reports linkedToBoq true", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mockWithTenantContext }))
    const { createProgressEntry } = await import("./construction-progress-service")

    const row = await createProgressEntry(
      { orgId: ORG, userId: "user-1" },
      { projectId: PROJECT_B, activityId: "ACT-B", boqLineItemId: "LINE-B", entryDate: "2026-08-28", quantityDone: 5, percentComplete: 50 }
    )

    expect(row.linkedToBoq).toBe(true)
    expect(insertedRows[0].boqLineItemId).toBe("LINE-B")
  })
})

// ─── R67 lane D22 (item D-49, rec R-125) ──────────────────────────────────
// The double entry this closes: a site engineer records quantities against a
// BOQ line, and a PM separately retypes a percent on the schedule activity.
// The pure half is tested directly; the real createProgressEntry() path is
// then exercised with its own fake db (deliberately NOT the module-level one
// above, whose where-clause matcher only understands eq() and would silently
// mis-read the inArray() this roll-up uses).
import {
  computeLinkedIssueCompletion, lineProgressFraction, type LinkedBoqLine,
} from "./construction-progress-service"

function linked(over: Partial<LinkedBoqLine> = {}): LinkedBoqLine {
  return { boqLineItemId: "li-1", weight: 1, quantity: 10, quantityToDate: 0, latestPercentComplete: null, ...over }
}

describe("lineProgressFraction", () => {
  test("a real measured quantity wins", () => {
    expect(lineProgressFraction(linked({ quantity: 10, quantityToDate: 5 }))).toBe(0.5)
  })

  test("a reported percent fills in only when nothing has been measured -- the same rule computeEarnedValue uses", () => {
    expect(lineProgressFraction(linked({ quantityToDate: 0, latestPercentComplete: 50 }))).toBe(0.5)
    expect(lineProgressFraction(linked({ quantity: 10, quantityToDate: 8, latestPercentComplete: 20 }))).toBe(0.8)
  })

  test("nothing recorded at all is 0, never a guess", () => {
    expect(lineProgressFraction(linked())).toBe(0)
  })

  test("a zero-quantity line does not divide by zero", () => {
    expect(lineProgressFraction(linked({ quantity: 0, quantityToDate: 5 }))).toBe(0)
  })
})

describe("computeLinkedIssueCompletion", () => {
  test("one activity delivering one whole line reads that line's own percentage", () => {
    expect(computeLinkedIssueCompletion([linked({ quantityToDate: 5 })])).toBe(50)
  })

  test("two lines, both fully done, is 100 -- never 200", () => {
    expect(computeLinkedIssueCompletion([
      linked({ boqLineItemId: "a", quantityToDate: 10 }),
      linked({ boqLineItemId: "b", quantityToDate: 10 }),
    ])).toBe(100)
  })

  test("one of two lines done is half the activity", () => {
    expect(computeLinkedIssueCompletion([
      linked({ boqLineItemId: "a", quantityToDate: 10 }),
      linked({ boqLineItemId: "b", quantityToDate: 0 }),
    ])).toBe(50)
  })

  test("weights split the activity across the lines it delivers", () => {
    expect(computeLinkedIssueCompletion([
      linked({ boqLineItemId: "a", weight: 3, quantityToDate: 10 }),
      linked({ boqLineItemId: "b", weight: 1, quantityToDate: 0 }),
    ])).toBe(75)
  })

  test("an over-measured line cannot push the activity past 100", () => {
    expect(computeLinkedIssueCompletion([linked({ quantity: 10, quantityToDate: 25 })])).toBe(100)
  })

  test("no links, or no weight, returns null -- it must leave whatever a human set alone, not zero it", () => {
    expect(computeLinkedIssueCompletion([])).toBeNull()
    expect(computeLinkedIssueCompletion([linked({ weight: 0 })])).toBeNull()
  })
})

describe("createProgressEntry rolls the site records up onto the linked schedule activity", () => {
  const ORG_ID = "org-d49"
  const PROJECT_ID = "proj-d49"

  async function record(input: { quantityDone: number; percentComplete: number }, links = [{ id: "lnk-1", orgId: ORG_ID, issueId: "issue-1", boqLineItemId: "LINE-1", weight: "1" }]) {
    const updates: { set: Record<string, unknown> }[] = []
    let lineItemFindFirstCalls = 0
    const withTenantContextCalls: unknown[] = []

    const fakeDb = {
      query: {
        projects: { findFirst: async () => ({ id: PROJECT_ID, orgId: ORG_ID }) },
        constructionActivities: { findFirst: async () => ({ id: "ACT-1", orgId: ORG_ID, projectId: PROJECT_ID }) },
        constructionBoqs: { findFirst: async () => ({ id: "BOQ-1", orgId: ORG_ID, projectId: PROJECT_ID }) },
        constructionBoqLineItems: {
          // Call 1 is the line-item lookup; call 2 is the "does this line have
          // children?" parent guard, which must find none.
          findFirst: async () => {
            lineItemFindFirstCalls += 1
            return lineItemFindFirstCalls === 1 ? { id: "LINE-1", orgId: ORG_ID, boqId: "BOQ-1", parentLineItemId: null } : undefined
          },
          findMany: async () => [{ id: "LINE-1", quantity: "10" }],
        },
        pmsIssueBoqLinks: { findMany: async () => links },
      },
      insert: () => ({
        values: (v: Record<string, unknown>) => ({
          returning: async () => [{ ...v, id: "entry-9", percentComplete: String(v.percentComplete ?? "0") }],
        }),
      }),
      update: () => ({ set: (set: Record<string, unknown>) => ({ where: async () => { updates.push({ set }); } }) }),
      execute: async (query: { queryChunks?: unknown[] }) => {
        const text = JSON.stringify(query?.queryChunks ?? "")
        if (text.includes("percent_complete")) {
          return input.quantityDone > 0 ? [] : [{ boq_line_item_id: "LINE-1", percent_complete: input.percentComplete }]
        }
        return [{ boq_line_item_id: "LINE-1", total_qty: input.quantityDone }]
      },
    }

    await mock.module("@/lib/db/tenant-scoped", () => ({
      ...realTenantScoped,
      withTenantContext: mock(async (ctx: unknown, fn: (db: unknown) => Promise<unknown>) => {
        withTenantContextCalls.push(ctx)
        return fn(fakeDb)
      }),
    }))
    const { createProgressEntry } = await import("./construction-progress-service")
    const row = await createProgressEntry(
      { orgId: ORG_ID, userId: "user-1" },
      { projectId: PROJECT_ID, activityId: "ACT-1", boqLineItemId: "LINE-1", entryDate: "2026-09-01", ...input }
    )
    return { row, updates, withTenantContextCalls }
  }

  test("recording 50% of a linked BOQ line sets the linked issue's completion_percentage to 50 and its completion_source to 'site_records'", async () => {
    const { updates } = await record({ quantityDone: 5, percentComplete: 50 })
    expect(updates).toHaveLength(1)
    expect(updates[0].set).toMatchObject({
      completionPercentage: 50,
      completionSource: "site_records",
      completedFromEntryId: "entry-9",
    })
  })

  test("a percent-only entry (no quantity surveyed yet) is worth the same, not zero", async () => {
    const { updates } = await record({ quantityDone: 0, percentComplete: 50 })
    expect(updates[0].set).toMatchObject({ completionPercentage: 50, completionSource: "site_records" })
  })

  test("the roll-up runs on the CALLER's transaction -- never a nested withTenantContext (programme decision D-06)", async () => {
    const { withTenantContextCalls } = await record({ quantityDone: 5, percentComplete: 50 })
    expect(withTenantContextCalls).toHaveLength(1)
  })

  test("a BOQ line no activity is linked to updates nothing at all, and the entry still saves", async () => {
    const { row, updates } = await record({ quantityDone: 5, percentComplete: 50 }, [])
    expect(updates).toEqual([])
    expect(row).toBeDefined()
  })
})

// ─── R67 lane D22 (review finding on D-49 + D-77) ─────────────────────────
// DELETING an entry has to roll the activity back down. createProgressEntry
// and updateProgressEntry both call rollUpLinkedIssueCompletion; delete did
// not, so removing the only entry on a line left the schedule asserting a
// percentage derived from a row that no longer exists, plus a
// completed_from_entry_id pointing at it (a column with no DB-level FK, so
// nothing else would catch it either).
//
// Fake db again rather than the module-level eq()-only matcher, for the same
// reason the block above gives: the roll-up reads use inArray() and raw
// db.execute() aggregates that matcher cannot represent. The aggregate fakes
// below return NOTHING for the line -- which is exactly what Postgres returns
// once the last entry on it is gone -- so the 0 this asserts is computed by
// the real lineProgressFraction/computeLinkedIssueCompletion, not stubbed.
describe("deleteProgressEntry rolls the linked schedule activity back down", () => {
  const ORG_ID = "org-d49-del"

  async function remove(over: { boqLineItemId?: string | null } = {}) {
    const updates: { set: Record<string, unknown> }[] = []
    const deletes: unknown[] = []
    const withTenantContextCalls: unknown[] = []
    const boqLineItemId = over.boqLineItemId === undefined ? "LINE-1" : over.boqLineItemId

    const fakeDb = {
      query: {
        constructionWorkProgressEntries: {
          findFirst: async () => ({ id: "entry-9", orgId: ORG_ID, projectId: "proj-1", activityId: "ACT-1", boqLineItemId }),
        },
        pmsIssueBoqLinks: {
          findMany: async () => [{ id: "lnk-1", orgId: ORG_ID, issueId: "issue-1", boqLineItemId: "LINE-1", weight: "1" }],
        },
        constructionBoqLineItems: { findMany: async () => [{ id: "LINE-1", quantity: "10" }] },
      },
      delete: () => ({ where: async (w: unknown) => { deletes.push(w) } }),
      update: () => ({ set: (set: Record<string, unknown>) => ({ where: async () => { updates.push({ set }) } }) }),
      // The row is gone, so both aggregates come back empty for the line.
      execute: async () => [],
    }

    await mock.module("@/lib/db/tenant-scoped", () => ({
      ...realTenantScoped,
      withTenantContext: mock(async (ctx: unknown, fn: (db: unknown) => Promise<unknown>) => {
        withTenantContextCalls.push(ctx)
        return fn(fakeDb)
      }),
    }))
    const { deleteProgressEntry } = await import("./construction-progress-service")
    const result = await deleteProgressEntry({ orgId: ORG_ID }, "entry-9")
    return { result, updates, deletes, withTenantContextCalls }
  }

  test("deleting the only entry recorded against a linked line leaves the activity reading 0, not the percentage the deleted row produced", async () => {
    const { updates } = await remove()
    expect(updates).toHaveLength(1)
    expect(updates[0].set).toMatchObject({ completionPercentage: 0, completionSource: "site_records" })
  })

  test("completed_from_entry_id is cleared -- it must not point at a row that no longer exists", async () => {
    const { updates } = await remove()
    expect(updates[0].set.completedFromEntryId).toBeNull()
  })

  test("the roll-back runs on the SAME transaction as the delete (programme decision D-06)", async () => {
    const { withTenantContextCalls, deletes } = await remove()
    expect(withTenantContextCalls).toHaveLength(1)
    expect(deletes).toHaveLength(1)
  })

  test("an entry recorded against no BOQ line touches no activity at all", async () => {
    const { updates, result } = await remove({ boqLineItemId: null })
    expect(updates).toEqual([])
    expect(result).toMatchObject({ deleted: true, id: "entry-9" })
  })
})

// ─── R67 lane D22 (item D-49): the activity's side of the link ────────────
// Provenance ("where did this 62% come from") and the explicit manual
// override. Own fake db again, for the same reason as the block above: these
// read paths use inArray() and column projections the module-level eq()-only
// matcher cannot represent.
describe("getActivityCompletionProvenance", () => {
  const ORG_ID = "org-prov"

  async function runProvenance(over: {
    issue?: Record<string, unknown>
    links?: Record<string, unknown>[]
    lineItems?: Record<string, unknown>[]
    boqs?: Record<string, unknown>[]
    currentCodes?: { itemCode: string | null }[]
    entry?: { entryDate: string } | undefined
  } = {}) {
    const issue = { id: "issue-1", orgId: ORG_ID, projectId: "proj-1", completionPercentage: 62, completionSource: "site_records", completedFromEntryId: "entry-7", ...over.issue }
    const links = over.links ?? [{ id: "lnk-1", orgId: ORG_ID, issueId: "issue-1", boqLineItemId: "LINE-1", weight: "1" }]
    const lineItems = over.lineItems ?? [{ id: "LINE-1", boqId: "BOQ-1", itemCode: "R60SK-A", description: "R60 skiphop sub", unit: "m2", quantity: "10" }]
    const boqs = over.boqs ?? [{ id: "BOQ-1", version: 1, status: "approved", createdAt: new Date("2026-08-01") }]
    const currentCodes = over.currentCodes ?? [{ itemCode: "R60SK-A" }]

    const fakeDb = {
      query: {
        pmsIssues: { findFirst: async () => issue },
        pmsIssueBoqLinks: { findMany: async () => links },
        constructionWorkProgressEntries: { findFirst: async () => ("entry" in over ? over.entry : { entryDate: "2026-09-01" }) },
        constructionBoqLineItems: {
          // Two different reads: the linked lines (no `columns`) and the
          // current revision's code list (projected to itemCode only).
          findMany: async (args: { columns?: Record<string, boolean> }) => (args?.columns ? currentCodes : lineItems),
        },
        constructionBoqs: { findMany: async () => boqs },
      },
    }
    await mock.module("@/lib/db/tenant-scoped", () => ({
      ...realTenantScoped,
      withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)),
    }))
    const { getActivityCompletionProvenance } = await import("./construction-progress-service")
    return getActivityCompletionProvenance({ orgId: ORG_ID }, "issue-1")
  }

  test("a site-derived completion carries its source and the date of the entry it came from", async () => {
    const result = await runProvenance()
    expect(result).toMatchObject({ completionPercentage: 62, completionSource: "site_records", lastProgressAt: "2026-09-01" })
    expect(result.links[0]).toMatchObject({ code: "R60SK-A", description: "R60 skiphop sub", unit: "m2", quantity: 10, weight: 1 })
  })

  test("a manual completion has no last-entry date to print", async () => {
    const result = await runProvenance({ issue: { completionSource: "manual", completedFromEntryId: null }, entry: undefined })
    expect(result.lastProgressAt).toBeNull()
  })

  test("a link into a SUPERSEDED revision whose code still exists is re-matched, not broken", async () => {
    const result = await runProvenance({
      boqs: [
        { id: "BOQ-2", version: 2, status: "approved", createdAt: new Date("2026-09-01") },
        { id: "BOQ-1", version: 1, status: "superseded", createdAt: new Date("2026-08-01") },
      ],
      currentCodes: [{ itemCode: "R60SK-A" }],
    })
    expect(result.links[0]).toMatchObject({ supersededButMatched: true, scopeRemoved: false, linkedBoqVersion: 1, currentBoqVersion: 2 })
  })

  test("a negative variation that removed the code marks the activity's scope removed, never a silent zero", async () => {
    const result = await runProvenance({
      boqs: [
        { id: "BOQ-2", version: 2, status: "approved", createdAt: new Date("2026-09-01") },
        { id: "BOQ-1", version: 1, status: "superseded", createdAt: new Date("2026-08-01") },
      ],
      currentCodes: [{ itemCode: "SOMETHING-ELSE" }],
    })
    expect(result.links[0]).toMatchObject({ scopeRemoved: true, supersededButMatched: false })
    expect(result.completionPercentage).toBe(62) // untouched
  })

  test("an activity with no BOQ links returns an empty list, not an error", async () => {
    const result = await runProvenance({ links: [] })
    expect(result.links).toEqual([])
    expect(result.completionSource).toBe("site_records")
  })

  test("a link whose line item row is gone says so rather than rendering an empty cell", async () => {
    const result = await runProvenance({ lineItems: [] })
    expect(result.links[0]).toMatchObject({ code: null, description: "This BOQ line no longer exists" })
  })
})

const realAudit = await import("@/lib/audit")

describe("setActivityCompletionManually", () => {
  const ORG_ID = "org-manual"

  afterEach(async () => {
    await mock.module("@/lib/audit", () => realAudit)
  })

  async function runOverride(input: { completionPercentage: number; note: string }, audit?: Parameters<typeof import("./construction-progress-service").setActivityCompletionManually>[3]) {
    const updates: Record<string, unknown>[] = []
    const audited: Record<string, unknown>[] = []
    const fakeDb = {
      query: { pmsIssues: { findFirst: async () => ({ id: "issue-1", orgId: ORG_ID, completionPercentage: 62, completionSource: "site_records" }) } },
      update: () => ({
        set: (set: Record<string, unknown>) => ({
          where: () => ({ returning: async () => { updates.push(set); return [{ id: "issue-1", ...set }] } }),
        }),
      }),
    }
    await mock.module("@/lib/db/tenant-scoped", () => ({
      ...realTenantScoped,
      withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)),
    }))
    await mock.module("@/lib/audit", () => ({
      ...realAudit,
      logActivity: mock(async (params: Record<string, unknown>) => { audited.push(params) }),
    }))
    const { setActivityCompletionManually } = await import("./construction-progress-service")
    const row = await setActivityCompletionManually({ orgId: ORG_ID, userId: "user-1" }, "issue-1", input, audit)
    return { row, updates, audited }
  }

  test("an override records completion_source 'manual' and drops the derived entry reference", async () => {
    const { updates } = await runOverride({ completionPercentage: 80, note: "Client walkdown agreed 80%" })
    expect(updates[0]).toMatchObject({ completionPercentage: 80, completionSource: "manual", completedFromEntryId: null })
  })

  test("the note is REQUIRED -- an override without a reason is refused, not stored", async () => {
    await expect(runOverride({ completionPercentage: 80, note: "   " })).rejects.toThrow("A note is required when you set the percentage manually")
  })

  test("a percentage outside 0-100 is refused", async () => {
    await expect(runOverride({ completionPercentage: 140, note: "why" })).rejects.toThrow("completionPercentage must be between 0 and 100")
  })

  test("the reason is written to the audit trail with what it replaced, so the decision is reconstructable", async () => {
    const { audited } = await runOverride(
      { completionPercentage: 80, note: "Client walkdown agreed 80%" },
      { dbUser: { id: "user-1", name: "Arjun Mehta", role: "admin" } as never }
    )
    expect(audited).toHaveLength(1)
    expect(audited[0]).toMatchObject({ action: "pms_issue.completion_manual_override", entityType: "pms_issue", entityId: "issue-1" })
    expect(String(audited[0].details)).toBe("Set to 80% manually (was 62%, source site_records). Reason: Client walkdown agreed 80%")
  })

  test("an API-key caller is recorded too -- an override always says who made it", async () => {
    const { audited } = await runOverride(
      { completionPercentage: 80, note: "why" },
      { apiKey: { id: "key-1", name: "PROJEXA" } }
    )
    expect(audited).toHaveLength(1)
    expect(audited[0].apiKey).toEqual({ id: "key-1", name: "PROJEXA" })
  })
})

// ─── R67 lane D22 (item D-64, rec R-230) x R67 F-24 (already on main) ─────
// The Work Progress list printed a 25-character cuid in its "BOQ line" column
// because nothing joined the entry to the line it names.
//
// MERGE NOTE (integration train, lane D22 onto main). Lane D22 closed this with
// a pure attachBoqLines() over a SECOND ORM read; F-24 closed it with a LEFT
// JOIN in the SAME statement. The join is the version kept -- see this
// service's own header for why -- so attachBoqLines() no longer exists. These
// are lane D22's own six assertions, unchanged in what they claim and re-aimed
// at the mechanism that survived: nothing D22 proved about this column has
// stopped being proved, and the list is still the thing under test.
describe("R67 D-64 x F-24 -- the BOQ line column carries words, never an id", () => {
  const D64_ORG = "org-d64"
  const D64_PROJECT = "project-d64"

  /** One LEFT-JOINed row exactly as the service's projection produces it. */
  function joined(over: Record<string, unknown>): Record<string, unknown> {
    return {
      id: "e1", orgId: D64_ORG, projectId: D64_PROJECT, activityId: "act-1",
      boqLineItemId: "li-1", entryDate: "2026-09-01", quantityDone: "40",
      percentComplete: "33", entryBasis: "DELTA", remarks: null,
      recordedById: "user-1", createdAt: new Date("2026-09-01T00:00:00Z"),
      activityName: "Blockwork", activityUnit: "nos",
      boqItemCode: "R60SK-A", boqDescription: "R60 skiphop sub",
      boqLineBoqId: "boq-1", boqLineUnit: "m3",
      ...over,
    }
  }

  async function listWith(rows: Record<string, unknown>[]) {
    const chain: Record<string, unknown> = {}
    chain.leftJoin = () => chain
    chain.where = () => ({
      then: (resolve: (v: Record<string, unknown>[]) => unknown) => Promise.resolve(rows).then(resolve),
      orderBy: async () => rows,
    })
    await mock.module("@/lib/db/tenant-scoped", () => ({
      withTenantContext: async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) =>
        fn({ select: () => ({ from: () => chain }) }),
    }))
    const { listProgressEntries } = await import("./construction-progress-service")
    return listProgressEntries({ orgId: D64_ORG }, { projectId: D64_PROJECT })
  }

  test("every entry with a linked line carries a non-empty code and description", async () => {
    const result = await listWith([joined({ id: "e1", quantityDone: "40" }), joined({ id: "e2", quantityDone: "5" })])
    expect(result).toHaveLength(2)
    for (const entry of result) {
      expect(entry.boqItemCode).toBeTruthy()
      expect((entry.boqDescription ?? "").length).toBeGreaterThan(0)
    }
  })

  test("carries the line's own unit, the link target, and the ENTRY's own quantity", async () => {
    const [entry] = await listWith([joined({})])
    // The line's unit wins over the activity's -- resolveProgressUnit's rule.
    expect(entry!.unit).toBe("m3")
    // boqLineItemId + boqLineBoqId are what "/scope/{boqId}#line-{lineId}" is
    // built from: naming the line is only half of R-230, the cell has to be a
    // way in to it.
    expect(entry!.boqLineItemId).toBe("li-1")
    expect(entry!.boqLineBoqId).toBe("boq-1")
    // The entry's own quantity, not the line's contracted total -- one row, one
    // fact. The list deliberately does not carry the line's quantity at all.
    expect(entry!.quantityDone).toBe("40")
  })

  test("a line with no item code still carries its description -- the screen shows words, never an id", async () => {
    const [entry] = await listWith([joined({ boqItemCode: null, boqDescription: "Blockwork to core walls" })])
    expect(entry!.boqItemCode).toBeNull()
    expect(entry!.boqDescription).toBe("Blockwork to core walls")
  })

  test("an entry recorded against no BOQ line is null, never the string 'null' and never an id", async () => {
    // boq_line_item_id is nullable and an activity-only entry is legitimate, so
    // the LEFT JOIN yields nulls for every line column and the unit falls back
    // to the activity's own.
    const [entry] = await listWith([joined({
      boqLineItemId: null, boqItemCode: null, boqDescription: null, boqLineBoqId: null, boqLineUnit: null,
    })])
    expect(entry!.boqLineItemId).toBeNull()
    expect(entry!.boqItemCode).toBeNull()
    expect(entry!.boqDescription).toBeNull()
    expect(entry!.boqLineBoqId).toBeNull()
    expect(entry!.unit).toBe("nos")
  })

  test("an entry whose line was deleted degrades to nulls rather than inventing one", async () => {
    // The FK is ON DELETE SET NULL and the join is LEFT, so a deleted line
    // leaves the row listed with nothing to say about it -- it must never
    // vanish from the list and must never render as its id.
    const [entry] = await listWith([joined({
      boqLineItemId: null, boqItemCode: null, boqDescription: null, boqLineBoqId: null, boqLineUnit: null,
    })])
    expect(entry).toBeDefined()
    expect(entry!.boqDescription).toBeNull()
  })

  test("leaves every original field on the entry untouched", async () => {
    const [entry] = await listWith([joined({})])
    expect(entry!.id).toBe("e1")
    expect(entry!.quantityDone).toBe("40")
    expect(entry!.entryBasis).toBe("DELTA")
    // The two join inputs are consumed by resolveProgressUnit() and stripped,
    // so no caller has to know the precedence rule.
    expect((entry as unknown as Record<string, unknown>).boqLineUnit).toBeUndefined()
    expect((entry as unknown as Record<string, unknown>).activityUnit).toBeUndefined()
  })
})

// ─── R67 lane D22 (item D-77, rec R-289) ──────────────────────────────────
// Correcting an entry. Every rule below is refused BEFORE withTenantContext is
// entered, so these assertions run with no database and no mock at all -- which
// is exactly the point: a bad percentage must never reach a transaction.
import { updateProgressEntry } from "./construction-progress-service"

describe("updateProgressEntry validation", () => {
  const ctx = { orgId: "org-d77" }

  test("refuses a percentage outside 0-100 before opening a transaction", async () => {
    await expect(updateProgressEntry(ctx, "entry-1", { percentComplete: 101 })).rejects.toThrow(
      "percentComplete must be between 0 and 100"
    )
    await expect(updateProgressEntry(ctx, "entry-1", { percentComplete: -1 })).rejects.toThrow(
      "percentComplete must be between 0 and 100"
    )
  })

  test("accepts the two real bases and refuses anything else", async () => {
    await expect(
      updateProgressEntry(ctx, "entry-1", { entryBasis: "CUMULATIVE" as unknown as "DELTA" })
    ).rejects.toThrow("entryBasis must be DELTA or SNAPSHOT")
  })

  test("refuses blanking the entry date -- an undated site record is not a record", async () => {
    await expect(updateProgressEntry(ctx, "entry-1", { entryDate: "" })).rejects.toThrow("entryDate is required")
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
