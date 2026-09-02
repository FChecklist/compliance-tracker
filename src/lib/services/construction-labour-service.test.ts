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
}

const mockWithTenantContext = mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) =>
  fn(fakeDb as unknown as never)
)

const realTenantScoped = await import("@/lib/db/tenant-scoped")

beforeEach(() => {
  insertedAttendance = []
  existingAttendanceForConflict = undefined
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
