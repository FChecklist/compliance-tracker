// R67 F-25 (audit recommendation R-241) -- the first tests this service has
// ever had, written for the dated attendance query it just gained.
//
// THE DEFECT THIS PINS. PROJEXA's Manpower screen fetched a project's ENTIRE
// attendance log on every landing, with no date filter of any kind, for a tab
// that opens closed. listAttendance() now takes `date` (one day) and
// `from`/`to` (an inclusive range), keeping `attendanceDate` as an alias so no
// existing caller or query string breaks.
//
// This does NOT touch a live DB (this directory's standing convention, see
// construction-progress-service.test.ts's own header). It exercises the real
// listAttendance() with only withTenantContext mocked, and the fake db below
// does NOT return canned rows: it PARSES the drizzle condition tree the service
// actually built -- every eq/gte/lte predicate, at any AND depth -- and filters
// the fixture with it. So if the service stopped adding the date predicate, the
// fake would return the other day's rows too and these tests would fail, which
// is exactly the regression they exist to catch.
/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import type { SQL } from "drizzle-orm"

const ORG = "org-r67-f25"
const PROJECT = "project-r67-f25"
const OTHER_PROJECT = "project-other"

type Predicate = { column: string; op: string; value: unknown }

/**
 * Walks a drizzle condition tree and recovers every {column, operator, value}
 * triple it contains. Drizzle renders `eq(col, v)` as queryChunks
 * [StringChunk, Column, StringChunk(" = "), Param, StringChunk] and `and(a, b)`
 * as those sub-trees interleaved with " and " StringChunks -- so remembering
 * the last Column seen, then the StringChunk that followed it, then pairing
 * both with the next Param, recovers eq/gte/lte alike at any depth. A LIST, not
 * a Record: the same column legitimately appears twice in a from/to range.
 */
function extractPredicates(node: unknown, acc: Predicate[] = []): Predicate[] {
  if (!node || typeof node !== "object") return acc
  const chunks = (node as { queryChunks?: unknown[] }).queryChunks
  if (!Array.isArray(chunks)) return acc
  let pendingColumn: string | null = null
  let pendingOp: string | null = null
  for (const chunk of chunks) {
    if (!chunk || typeof chunk !== "object") continue
    if ("columnType" in chunk && "name" in chunk) {
      pendingColumn = (chunk as { name: string }).name
      pendingOp = null
    } else if (Array.isArray((chunk as { value?: unknown }).value)) {
      // A StringChunk. Only the one immediately after a Column is an operator.
      if (pendingColumn && pendingOp === null) {
        pendingOp = ((chunk as { value: string[] }).value.join("") || "").trim()
      }
    } else if ("value" in chunk && "encoder" in chunk) {
      if (pendingColumn && pendingOp) {
        acc.push({ column: pendingColumn, op: pendingOp, value: (chunk as { value: unknown }).value })
      }
      pendingColumn = null
      pendingOp = null
    } else {
      extractPredicates(chunk, acc)
    }
  }
  return acc
}

/** Real drizzle rows come back camelCase; the Column objects carry snake_case. */
function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

function satisfies(row: Record<string, unknown>, where: unknown): boolean {
  return extractPredicates(where).every(({ column, op, value }) => {
    const actual = row[snakeToCamel(column)]
    if (op === "=") return actual === value
    if (op === ">=") return String(actual) >= String(value)
    if (op === "<=") return String(actual) <= String(value)
    // An operator this evaluator does not know must FAIL loudly rather than
    // silently pass every row -- a silently-ignored predicate is exactly the
    // bug shape these tests exist to catch.
    throw new Error(`unhandled predicate operator "${op}" on ${column}`)
  })
}

type AttendanceRow = {
  id: string
  orgId: string
  projectId: string
  rosterId: string
  attendanceDate: string
  status: string
  hoursWorked: string | null
  dailyCost: string
}

// Two days, two workers, plus one row belonging to a DIFFERENT project so the
// project predicate is genuinely exercised rather than assumed.
const attendanceRows: AttendanceRow[] = [
  { id: "a-sep01", orgId: ORG, projectId: PROJECT, rosterId: "r1", attendanceDate: "2026-09-01", status: "present", hoursWorked: "8", dailyCost: "500" },
  { id: "a-sep02-r1", orgId: ORG, projectId: PROJECT, rosterId: "r1", attendanceDate: "2026-09-02", status: "present", hoursWorked: "8", dailyCost: "500" },
  { id: "a-sep02-r2", orgId: ORG, projectId: PROJECT, rosterId: "r2", attendanceDate: "2026-09-02", status: "half_day", hoursWorked: "4", dailyCost: "250" },
  { id: "a-sep03", orgId: ORG, projectId: PROJECT, rosterId: "r1", attendanceDate: "2026-09-03", status: "absent", hoursWorked: null, dailyCost: "0" },
  { id: "a-other", orgId: ORG, projectId: OTHER_PROJECT, rosterId: "r9", attendanceDate: "2026-09-02", status: "present", hoursWorked: "8", dailyCost: "700" },
]

const rosterRows = [
  { id: "r1", orgId: ORG, projectId: PROJECT, name: "Ravi", dailyRate: "500", isActive: true },
  { id: "r2", orgId: ORG, projectId: PROJECT, name: "Sunil", dailyRate: "500", isActive: true },
]

let insertedAttendance: Record<string, unknown>[] = []
let existingAttendanceForConflict: AttendanceRow | undefined

const fakeDb = {
  query: {
    constructionAttendance: {
      findMany: async ({ where }: { where: SQL }) => attendanceRows.filter((r) => satisfies(r, where)),
      findFirst: async () => existingAttendanceForConflict,
    },
    constructionLabourRoster: {
      findMany: async ({ where }: { where: SQL }) => rosterRows.filter((r) => satisfies(r, where)),
      findFirst: async ({ where }: { where: SQL }) => rosterRows.find((r) => satisfies(r, where)),
    },
  },
  insert: () => ({
    values: (v: Record<string, unknown>) => ({
      returning: async () => {
        const row = { ...v, id: "new-attendance" }
        insertedAttendance.push(row)
        return [row]
      },
    }),
  }),
  // R67 F-30. The attendance summary is a grouped aggregate, so it goes
  // through db.execute() with raw SQL rather than the query builder. This
  // stands in for Postgres by reading the DAY out of the statement drizzle
  // built and grouping the SAME fixture by status -- so a service that stopped
  // filtering by day, or that mis-mapped a status, still fails here.
  execute: async (statement: unknown) => {
    executedSql.push(sqlText(statement))
    const params = sqlParams(statement)
    const [orgId, projectId, date] = params as [string, string, string]
    const rows = attendanceRows.filter(
      (r) => r.orgId === orgId && r.projectId === projectId && r.attendanceDate === date
    )
    const byStatus = new Map<string, { entries: number; cost: number }>()
    for (const r of rows) {
      const bucket = byStatus.get(r.status) ?? { entries: 0, cost: 0 }
      bucket.entries += 1
      bucket.cost += Number(r.dailyCost)
      byStatus.set(r.status, bucket)
    }
    return [...byStatus].map(([status, b]) => ({ status, entries: b.entries, cost: b.cost }))
  },
}

let executedSql: string[] = []
let transactionCount = 0

/** The literal text drizzle assembled, so the SHAPE of a raw statement can be
 *  asserted. Bound parameters are recovered separately by sqlParams(). */
function sqlText(node: unknown): string {
  if (!node || typeof node !== "object") return ""
  const chunks = (node as { queryChunks?: unknown[] }).queryChunks
  if (!Array.isArray(chunks)) return ""
  let out = ""
  for (const chunk of chunks) {
    if (chunk && typeof chunk === "object") {
      const value = (chunk as { value?: unknown }).value
      if (Array.isArray(value)) out += value.join("")
      else out += sqlText(chunk)
    }
  }
  return out
}

/**
 * The bound parameters, in the order the statement interpolates them.
 *
 * A value interpolated into a raw `sql` template arrives as a PRIMITIVE chunk
 * sitting between StringChunks -- not as a wrapped Param object, which is what
 * the query builder produces. Verified directly against drizzle rather than
 * assumed: a walker that only looked for `{ value, encoder }` found nothing
 * here and silently reported an empty summary.
 */
function sqlParams(node: unknown, acc: unknown[] = []): unknown[] {
  if (!node || typeof node !== "object") return acc
  const chunks = (node as { queryChunks?: unknown[] }).queryChunks
  if (!Array.isArray(chunks)) return acc
  for (const chunk of chunks) {
    if (chunk === null || typeof chunk !== "object") {
      acc.push(chunk)
    } else if ("value" in chunk && "encoder" in chunk && !Array.isArray((chunk as { value: unknown }).value)) {
      acc.push((chunk as { value: unknown }).value)
    } else if (!Array.isArray((chunk as { value?: unknown }).value)) {
      sqlParams(chunk, acc)
    }
  }
  return acc
}

const mockWithTenantContext = mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => {
  transactionCount += 1
  return fn(fakeDb as unknown as never)
})

const realTenantScoped = await import("@/lib/db/tenant-scoped")

beforeEach(() => {
  insertedAttendance = []
  existingAttendanceForConflict = undefined
  executedSql = []
  transactionCount = 0
  mockWithTenantContext.mockClear()
})

afterEach(async () => {
  mock.restore()
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
})

async function loadService() {
  await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mockWithTenantContext }))
  return import("./construction-labour-service")
}

describe("listAttendance -- R67 F-25: a dated question gets a dated query", () => {
  test("date '2026-09-02' returns only that day's rows, not the whole log", async () => {
    const { listAttendance } = await loadService()

    const rows = await listAttendance({ orgId: ORG }, { projectId: PROJECT, date: "2026-09-02" })

    expect(rows.map((r) => r.id).sort()).toEqual(["a-sep02-r1", "a-sep02-r2"])
    expect(rows.every((r) => r.attendanceDate === "2026-09-02")).toBe(true)
  })

  test("the day filter is scoped to the project as well -- another project's same-day row is not returned", async () => {
    const { listAttendance } = await loadService()

    const rows = await listAttendance({ orgId: ORG }, { projectId: PROJECT, date: "2026-09-02" })

    expect(rows.map((r) => r.id)).not.toContain("a-other")
  })

  test("attendanceDate is still honoured -- every pre-F-25 caller and ?attendanceDate= query string is unchanged", async () => {
    const { listAttendance } = await loadService()

    const rows = await listAttendance({ orgId: ORG }, { projectId: PROJECT, attendanceDate: "2026-09-01" })

    expect(rows.map((r) => r.id)).toEqual(["a-sep01"])
  })

  test("from/to is an INCLUSIVE range on both ends", async () => {
    const { listAttendance } = await loadService()

    const rows = await listAttendance({ orgId: ORG }, { projectId: PROJECT, from: "2026-09-01", to: "2026-09-02" })

    expect(rows.map((r) => r.id).sort()).toEqual(["a-sep01", "a-sep02-r1", "a-sep02-r2"])
  })

  test("`date` wins over a range when both are supplied -- one day is never widened by a stale from/to", async () => {
    const { listAttendance } = await loadService()

    const rows = await listAttendance({ orgId: ORG }, { projectId: PROJECT, date: "2026-09-03", from: "2026-09-01", to: "2026-09-03" })

    expect(rows.map((r) => r.id)).toEqual(["a-sep03"])
  })

  test("no date filter at all still returns the project's whole log -- the default is unchanged", async () => {
    const { listAttendance } = await loadService()

    const rows = await listAttendance({ orgId: ORG }, { projectId: PROJECT })

    expect(rows).toHaveLength(4)
  })

  test("a rosterId-only read (no project) is still allowed, and is still dated", async () => {
    const { listAttendance } = await loadService()

    const rows = await listAttendance({ orgId: ORG }, { rosterId: "r1", date: "2026-09-02" })

    expect(rows.map((r) => r.id)).toEqual(["a-sep02-r1"])
  })

  test("neither projectId nor rosterId is rejected before a transaction is opened", async () => {
    const { listAttendance, ServiceError } = await loadService()

    await expect(listAttendance({ orgId: ORG }, { date: "2026-09-02" })).rejects.toThrow(ServiceError)
    expect(mockWithTenantContext).not.toHaveBeenCalled()
  })
})

describe("recordAttendance -- dailyCost is derived from the roster's rate at write time", () => {
  test("present costs the full daily rate", async () => {
    const { recordAttendance } = await loadService()

    await recordAttendance({ orgId: ORG }, { projectId: PROJECT, rosterId: "r1", attendanceDate: "2026-09-04", status: "present" })

    expect(insertedAttendance[0].dailyCost).toBe("500")
  })

  test("half_day costs exactly half, and absent costs nothing", async () => {
    const { recordAttendance } = await loadService()

    await recordAttendance({ orgId: ORG }, { projectId: PROJECT, rosterId: "r1", attendanceDate: "2026-09-04", status: "half_day" })
    await recordAttendance({ orgId: ORG }, { projectId: PROJECT, rosterId: "r1", attendanceDate: "2026-09-05", status: "absent" })

    expect(insertedAttendance[0].dailyCost).toBe("250")
    expect(insertedAttendance[1].dailyCost).toBe("0")
  })

  test("an unknown roster is a 404, not a row written against a rate nobody has", async () => {
    const { recordAttendance, ServiceError } = await loadService()

    await expect(
      recordAttendance({ orgId: ORG }, { projectId: PROJECT, rosterId: "ghost", attendanceDate: "2026-09-04" })
    ).rejects.toThrow(ServiceError)
    expect(insertedAttendance).toHaveLength(0)
  })

  test("a second entry for the same worker on the same date is a 409, never a silent duplicate", async () => {
    existingAttendanceForConflict = attendanceRows[1]
    const { recordAttendance, ServiceError } = await loadService()

    await expect(
      recordAttendance({ orgId: ORG }, { projectId: PROJECT, rosterId: "r1", attendanceDate: "2026-09-02" })
    ).rejects.toThrow(ServiceError)
    expect(insertedAttendance).toHaveLength(0)
  })
})

describe("listRoster", () => {
  test("is scoped to the org AND the project, never the org alone", async () => {
    const { listRoster } = await loadService()

    const rows = await listRoster({ orgId: ORG }, PROJECT)

    expect(rows.map((r) => r.id).sort()).toEqual(["r1", "r2"])
    expect(await listRoster({ orgId: ORG }, OTHER_PROJECT)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// R67 F-30 (audit recommendation R-274) -- the /labour landing in ONE hop.
// ---------------------------------------------------------------------------
//
// The screen wants the roster AND "how did today go". Asking for them one
// after the other is two round trips to VERIDIAN and two transactions on a
// five-connection pool for one landing. getLabourLanding() answers both from
// one transaction, and the summary is a grouped aggregate over ONE DAY, so it
// stays a constant-size answer however long the project runs.
describe("getLabourLanding -- R67 F-30: roster and the day's summary, one transaction", () => {
  test("returns both, and opens exactly ONE tenant transaction to do it", async () => {
    const { getLabourLanding } = await loadService()

    const landing = await getLabourLanding({ orgId: ORG }, PROJECT, { attendanceDate: "2026-09-02" })

    expect(landing.roster.map((r) => r.id).sort()).toEqual(["r1", "r2"])
    expect(landing.attendanceSummary).not.toBeNull()
    expect(transactionCount).toBe(1)
    // One grouped statement for the summary -- not one per status, and not the
    // whole log pulled back to be counted in JS.
    expect(executedSql).toHaveLength(1)
  })

  test("the summary counts that ONE day, by status, with the day's cost", async () => {
    const { getLabourLanding } = await loadService()

    const { attendanceSummary } = await getLabourLanding({ orgId: ORG }, PROJECT, { attendanceDate: "2026-09-02" })

    // 2026-09-02 on THIS project: r1 present (500) + r2 half_day (250).
    expect(attendanceSummary).toEqual({
      date: "2026-09-02",
      recorded: 2,
      present: 1,
      halfDay: 1,
      absent: 0,
      totalCost: 750,
    })
  })

  test("another project's same-day row is not counted -- the summary is project-scoped", async () => {
    const { getLabourLanding } = await loadService()

    const { attendanceSummary } = await getLabourLanding({ orgId: ORG }, PROJECT, { attendanceDate: "2026-09-02" })

    // a-other is the same day, same org, DIFFERENT project, and costs 700.
    expect(attendanceSummary!.totalCost).toBe(750);
    expect(attendanceSummary!.recorded).toBe(2)
  })

  test("a day with nothing recorded returns zeroes, not null -- 'nobody marked attendance' is an answer", async () => {
    const { getLabourLanding } = await loadService()

    const { attendanceSummary } = await getLabourLanding({ orgId: ORG }, PROJECT, { attendanceDate: "2026-12-25" })

    expect(attendanceSummary).toEqual({
      date: "2026-12-25",
      recorded: 0,
      present: 0,
      halfDay: 0,
      absent: 0,
      totalCost: 0,
    })
  })

  test("the statement filters on the day itself, so it can use the (project_id, attendance_date) index", async () => {
    const { getLabourLanding } = await loadService()

    await getLabourLanding({ orgId: ORG }, PROJECT, { attendanceDate: "2026-09-03" })

    const text = executedSql[0].replace(/\s+/g, " ").toLowerCase()
    expect(text).toContain("compliance.construction_attendance")
    expect(text).toContain("attendance_date =")
    expect(text).toContain("group by status")
  })

  test("no date at all means no summary -- and no statement is run for one", async () => {
    const { getLabourLanding } = await loadService()

    const landing = await getLabourLanding({ orgId: ORG }, PROJECT)

    expect(landing.roster).toHaveLength(2)
    expect(landing.attendanceSummary).toBeNull()
    expect(executedSql).toHaveLength(0)
  })

  test("a missing projectId is a 400, never a landing scoped to the whole org", async () => {
    const { getLabourLanding, ServiceError } = await loadService()

    await expect(getLabourLanding({ orgId: ORG }, "")).rejects.toThrow(ServiceError)
  })
})
