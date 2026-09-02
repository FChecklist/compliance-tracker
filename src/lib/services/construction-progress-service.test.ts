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

// ─── R67 lane D22 (item D-64, rec R-230) ──────────────────────────────────
// The Work Progress list printed a 25-character cuid in its "BOQ line" column
// because nothing joined the entry to the line it names. attachBoqLines() is
// that join's pure half; the item's acceptance is that every returned entry
// carries a non-empty code and description, which is what these assert.
import { attachBoqLines } from "./construction-progress-service"

type EntryFixture = { id: string; boqLineItemId: string | null; quantityDone: string }

const LINES = [
  { id: "li-1", boqId: "boq-1", itemCode: "R60SK-A", description: "R60 skiphop sub", unit: "m3", quantity: "120" },
  { id: "li-2", boqId: "boq-1", itemCode: null, description: "Blockwork to core walls", unit: "m2", quantity: "80" },
]

describe("attachBoqLines", () => {
  test("every entry with a linked line carries a non-empty code and description", () => {
    const entries: EntryFixture[] = [
      { id: "e1", boqLineItemId: "li-1", quantityDone: "40" },
      { id: "e2", boqLineItemId: "li-1", quantityDone: "5" },
    ]
    const result = attachBoqLines(entries, LINES)
    expect(result).toHaveLength(2)
    for (const entry of result) {
      expect(entry.boqLine).not.toBeNull()
      expect(entry.boqLine!.code).toBeTruthy()
      expect(entry.boqLine!.description.length).toBeGreaterThan(0)
    }
  })

  test("carries the line's own unit and contracted quantity, and the ENTRY's own quantity", () => {
    const [entry] = attachBoqLines([{ id: "e1", boqLineItemId: "li-1", quantityDone: "40" }], LINES)
    expect(entry!.boqLine).toEqual({
      boqLineId: "li-1", code: "R60SK-A", description: "R60 skiphop sub",
      unit: "m3", qtyTotal: 120, qtyDone: 40, boqId: "boq-1",
    })
  })

  test("a line with no item code still carries its description -- the screen shows words, never an id", () => {
    const [entry] = attachBoqLines([{ id: "e1", boqLineItemId: "li-2", quantityDone: "10" }], LINES)
    expect(entry!.boqLine!.code).toBeNull()
    expect(entry!.boqLine!.description).toBe("Blockwork to core walls")
  })

  test("an entry recorded against no BOQ line is null, never the string 'null' and never an id", () => {
    const [entry] = attachBoqLines([{ id: "e1", boqLineItemId: null, quantityDone: "3" }], LINES)
    expect(entry!.boqLine).toBeNull()
  })

  test("an entry whose line is not in the loaded set degrades to null rather than inventing one", () => {
    const [entry] = attachBoqLines([{ id: "e1", boqLineItemId: "li-gone", quantityDone: "3" }], LINES)
    expect(entry!.boqLine).toBeNull()
  })

  test("leaves every original field on the entry untouched", () => {
    const [entry] = attachBoqLines([{ id: "e1", boqLineItemId: "li-1", quantityDone: "40" }], LINES)
    expect(entry!.id).toBe("e1")
    expect(entry!.quantityDone).toBe("40")
  })
})
