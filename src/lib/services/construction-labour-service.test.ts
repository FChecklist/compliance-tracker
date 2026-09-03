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

// ---------------------------------------------------------------------------
// R67 D-34 (R-085/R-091) -- MERGED IN BY THE INTEGRATION TRAIN.
//
// Lane D-34 and lane F-25 both wrote this file from scratch (it had none
// before either), so this was an add/add conflict, not a textual one. Both
// halves are kept in full: F-25's dated-query and landing tests are above,
// D-34's roster-write tests are below. The fixtures are namespaced `d34*`
// rather than merged, because the two halves fake DIFFERENT things -- F-25's
// fake PARSES the drizzle condition tree, D-34's stands in for the
// employee-code counter row that drizzle/0529_r67_i02 defines -- and folding
// them into one fake would have weakened both.
//
// THE FAULT D-34 PINS: the roster is where every trade-wise number in this
// product comes from, and it was the least defended write in it. employee_code
// was blank on most rows (the form marked it optional and nothing generated
// one), so workers landed on the list with an ID cell reading an em-dash;
// trade was free text, so the same job arrived as "Mason", "mason" and "MASON"
// and split every trade-wise total; and a daily rate that was not a number was
// stringified straight into a numeric column.
// ---------------------------------------------------------------------------
import {
  formatEmployeeCode,
  mergeTrades,
  SEED_TRADES,
  EMPLOYEE_CODE_PREFIX,
} from "./construction-labour-service"

const D34_ORG = "org-d34"
const D34_PROJECT = "project-d34"

let d34InsertedRows: Record<string, unknown>[] = []
// Stands in for the counter ROW, not for a max() query: null until the first
// claim, which seeds it (as 0529 does) from the highest generated code already
// stored and then increments. `d34ExecuteCalls` proves the service claims the
// number with ONE statement rather than reading and writing.
let d34CounterLastNumber: number | null = null
let d34ExecuteCalls = 0

const d34ProjectRows = [{ id: D34_PROJECT, orgId: D34_ORG }]

const d34FakeDb = {
  query: {
    projects: {
      findFirst: async () => d34ProjectRows[0],
    },
  },
  execute: async () => {
    d34ExecuteCalls += 1
    if (d34CounterLastNumber === null) {
      d34CounterLastNumber = d34InsertedRows.reduce((max, row) => {
        const match = String(row.employeeCode ?? "").match(/^W-(\d+)$/)
        return match ? Math.max(max, Number.parseInt(match[1], 10)) : max
      }, 0)
    }
    d34CounterLastNumber += 1
    return [{ last_number: d34CounterLastNumber }]
  },
  insert: () => ({
    values: (v: Record<string, unknown>) => ({
      returning: async () => {
        const row = { ...v, id: `roster-${d34InsertedRows.length + 1}` }
        d34InsertedRows.push(row)
        return [row]
      },
    }),
  }),
}

const d34WithTenantContext = mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) =>
  fn(d34FakeDb as unknown as never)
)

async function loadD34Service() {
  await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: d34WithTenantContext }))
  return import("./construction-labour-service")
}

describe("R67 D-34 -- the roster write", () => {
  beforeEach(() => {
    d34InsertedRows = []
    d34CounterLastNumber = null
    d34ExecuteCalls = 0
    d34WithTenantContext.mockClear()
  })

  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
  })

  describe("employee-code generation (pure)", () => {
    test("formats a sequence as a zero-padded W- code", () => {
      expect(formatEmployeeCode(1)).toBe("W-0001")
      expect(formatEmployeeCode(42)).toBe("W-0042")
    })

    test("a sequence past four digits gets longer rather than wrapping", () => {
      expect(formatEmployeeCode(12345)).toBe("W-12345")
    })
  })

  describe("createRosterEntry -- R67 D-34 auto ID", () => {
    test("a create with no employeeCode returns one matching /^W-\\d{4}$/, and a second call returns the next number", async () => {
      const { createRosterEntry } = await loadD34Service()

      const first = await createRosterEntry({ orgId: D34_ORG }, { projectId: D34_PROJECT, name: "Ali", dailyRate: 120 })
      expect(first.employeeCode).toMatch(/^W-\d{4}$/)

      const second = await createRosterEntry({ orgId: D34_ORG }, { projectId: D34_PROJECT, name: "Bilal", dailyRate: 130 })
      expect(second.employeeCode).toMatch(/^W-\d{4}$/)

      const firstNumber = Number.parseInt(first.employeeCode!.slice(EMPLOYEE_CODE_PREFIX.length), 10)
      const secondNumber = Number.parseInt(second.employeeCode!.slice(EMPLOYEE_CODE_PREFIX.length), 10)
      expect(secondNumber).toBe(firstNumber + 1)
    })

    test("no worker can land on the list with a blank ID any more", async () => {
      const { createRosterEntry } = await loadD34Service()

      await createRosterEntry({ orgId: D34_ORG }, { projectId: D34_PROJECT, name: "Ali", dailyRate: 120 })
      expect(d34InsertedRows[0].employeeCode).toBeTruthy()
    })

    test("a caller's OWN employee code is stored verbatim -- this generates, it never overrides", async () => {
      const { createRosterEntry } = await loadD34Service()

      const row = await createRosterEntry({ orgId: D34_ORG }, { projectId: D34_PROJECT, name: "Ali", employeeCode: "EMP-001", dailyRate: 120 })
      expect(row.employeeCode).toBe("EMP-001")
    })

    test("a whitespace-only employee code counts as blank and is generated, not stored as spaces", async () => {
      const { createRosterEntry } = await loadD34Service()

      const row = await createRosterEntry({ orgId: D34_ORG }, { projectId: D34_PROJECT, name: "Ali", employeeCode: "   ", dailyRate: 120 })
      expect(row.employeeCode).toMatch(/^W-\d{4}$/)
    })

    // The reason the read-then-write max(employee_code) this function used to
    // do is gone: lane I's drizzle/0529_r67_i02 put a partial UNIQUE index on
    // (org_id, employee_code), so two creates that read the same max would make
    // the second INSERT raise a unique violation. The number is claimed with
    // ONE statement against the counter table instead.
    test("the number is claimed with a SINGLE statement -- never a read followed by a write", async () => {
      const { createRosterEntry } = await loadD34Service()

      await createRosterEntry({ orgId: D34_ORG }, { projectId: D34_PROJECT, name: "Ali", dailyRate: 120 })
      expect(d34ExecuteCalls).toBe(1)
    })

    test("a caller's own code costs no counter number at all -- the sequence is not burned by a verbatim code", async () => {
      const { createRosterEntry } = await loadD34Service()

      await createRosterEntry({ orgId: D34_ORG }, { projectId: D34_PROJECT, name: "Ali", employeeCode: "EMP-001", dailyRate: 120 })
      expect(d34ExecuteCalls).toBe(0)

      const generated = await createRosterEntry({ orgId: D34_ORG }, { projectId: D34_PROJECT, name: "Bilal", dailyRate: 130 })
      expect(generated.employeeCode).toBe("W-0001")
    })

    test("the counter is seeded from the highest generated code already on the roster, so it cannot collide with one", async () => {
      const { createRosterEntry } = await loadD34Service()

      await createRosterEntry({ orgId: D34_ORG }, { projectId: D34_PROJECT, name: "Legacy", employeeCode: "W-0007", dailyRate: 100 })
      const next = await createRosterEntry({ orgId: D34_ORG }, { projectId: D34_PROJECT, name: "Ali", dailyRate: 120 })
      expect(next.employeeCode).toBe("W-0008")
    })
  })

  describe("createRosterEntry -- rate validation", () => {
    test("a non-numeric daily rate is refused BY NAME, and nothing is written", async () => {
      const { createRosterEntry } = await loadD34Service()

      await expect(
        createRosterEntry({ orgId: D34_ORG }, { projectId: D34_PROJECT, name: "Ali", dailyRate: Number.NaN })
      ).rejects.toThrow("dailyRate must be a number of 0 or more")
      expect(d34InsertedRows).toHaveLength(0)
    })

    test("a negative daily rate is refused -- it would corrupt every trade-wise cost downstream", async () => {
      const { createRosterEntry } = await loadD34Service()

      await expect(
        createRosterEntry({ orgId: D34_ORG }, { projectId: D34_PROJECT, name: "Ali", dailyRate: -5 })
      ).rejects.toThrow("dailyRate must be a number of 0 or more")
      expect(d34InsertedRows).toHaveLength(0)
    })

    test("a rate of exactly 0 is legitimate and still writes", async () => {
      const { createRosterEntry } = await loadD34Service()

      const row = await createRosterEntry({ orgId: D34_ORG }, { projectId: D34_PROJECT, name: "Ali", dailyRate: 0 })
      expect(row.dailyRate).toBe("0")
    })

    test("an empty name is still refused before anything else happens", async () => {
      const { createRosterEntry } = await loadD34Service()

      await expect(createRosterEntry({ orgId: D34_ORG }, { projectId: D34_PROJECT, name: "   ", dailyRate: 120 })).rejects.toThrow("name is required")
      expect(d34InsertedRows).toHaveLength(0)
    })
  })

  describe("mergeTrades", () => {
    test("a brand-new org still gets a vocabulary", () => {
      expect(mergeTrades([])).toEqual([...SEED_TRADES])
    })

    test("a trade the org has actually used is kept, appended after the seeds", () => {
      expect(mergeTrades(["Tiler"])).toEqual([...SEED_TRADES, "Tiler"])
    })

    test("a case variant of a seed is NOT offered twice -- that is exactly what split the totals", () => {
      expect(mergeTrades(["mason", "MASON", "Mason"])).toEqual([...SEED_TRADES])
    })

    test("blank and null trades are dropped from the picklist rather than offered as an empty option", () => {
      expect(mergeTrades([null, undefined, "", "  "])).toEqual([...SEED_TRADES])
    })

    test("extra trades come back in a stable alphabetical order", () => {
      expect(mergeTrades(["Welder", "Tiler", "Rigger"])).toEqual([...SEED_TRADES, "Rigger", "Tiler", "Welder"])
    })
  })
})

// ---------------------------------------------------------------------------
// R67 F-06 (R-088/R-094) and F-13 (R-193/R-217) -- lane F1's half of this
// service, kept in full beside lane F2's F-25 suite above.
//
// Both lanes independently gave listAttendance() a [from, to] window. F-25's
// filter shape is the one on main and is canonical (decision D-11); F-06's
// contribution that survives is normaliseAttendanceRange(), which rejects a
// malformed or inverted bound with a 400 BEFORE a pool connection is taken.
// Nothing here was weakened for the merge -- the only edit is that the fixtures
// below now travel through the merged filter shape.
// ---------------------------------------------------------------------------
// R67 F-06 (R-088/R-094) -- sibling test for construction-labour-service.ts.
//
// What this file exists to prove: the attendance log is now WINDOWABLE, and
// the window is validated before a connection is taken from the 5-slot
// app_runtime pool. `attendance_date` is a Postgres DATE compared against text
// bounds, so an unvalidated malformed bound would not raise an error -- it
// would match nothing and be rendered as "this worker was never on site".
// A confidently empty log is worse than a 400.
//
// Follows this repo's convention for service tests: the pure validator is
// exercised directly, and the one DB-touching path is exercised for real with
// only @/lib/db/tenant-scoped mocked (same "capture the real module, restore
// it in afterEach" shape as construction-reports-service.test.ts and
// tenant-isolation.test.ts, so mock.module() cannot leak into other test files
// sharing this bun process).
import { normaliseAttendanceRange, ServiceError } from "./construction-labour-service"

describe("normaliseAttendanceRange", () => {
  test("no bounds at all is the unbounded case -- both undefined, never an error", () => {
    expect(normaliseAttendanceRange({})).toEqual({ from: undefined, to: undefined })
  })

  test("a real 30-day window passes through unchanged", () => {
    expect(normaliseAttendanceRange({ from: "2026-08-03", to: "2026-09-02" })).toEqual({
      from: "2026-08-03",
      to: "2026-09-02",
    })
  })

  test("one-sided windows are legitimate -- 'everything since' and 'everything up to'", () => {
    expect(normaliseAttendanceRange({ from: "2026-08-03" })).toEqual({ from: "2026-08-03", to: undefined })
    expect(normaliseAttendanceRange({ to: "2026-09-02" })).toEqual({ from: undefined, to: "2026-09-02" })
  })

  test("an empty or whitespace bound means 'no bound', not a bound of ''", () => {
    expect(normaliseAttendanceRange({ from: "", to: "   " })).toEqual({ from: undefined, to: undefined })
  })

  test("a malformed date is a 400, not a silently empty result set", () => {
    expect(() => normaliseAttendanceRange({ from: "03-08-2026" })).toThrow(ServiceError)
    expect(() => normaliseAttendanceRange({ from: "2026-8-3" })).toThrow(/YYYY-MM-DD/)
    expect(() => normaliseAttendanceRange({ to: "yesterday" })).toThrow(/YYYY-MM-DD/)
  })

  test("an inverted window is a 400 -- it can only ever return nothing", () => {
    expect(() => normaliseAttendanceRange({ from: "2026-09-02", to: "2026-08-03" })).toThrow(
      /from must not be later than to/
    )
  })

  test("a single-day window (from === to) is valid, not inverted", () => {
    expect(normaliseAttendanceRange({ from: "2026-09-02", to: "2026-09-02" })).toEqual({
      from: "2026-09-02",
      to: "2026-09-02",
    })
  })
})

// realTenantScoped is already captured above, at the top of lane F2's suite.

describe("listAttendance: validates the window before opening a transaction", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
  })

  test("a malformed `from` rejects with a 400 and never opens a tenant transaction", async () => {
    const withTenantContext = mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) =>
      fn({ query: { constructionAttendance: { findMany: async () => [] } } })
    )
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext }))

    const { listAttendance } = await import("./construction-labour-service")
    await expect(
      listAttendance({ orgId: "org-1" }, { projectId: "p1", from: "not-a-date" })
    ).rejects.toThrow(/YYYY-MM-DD/)

    // The whole point: a 5-connection pool is never asked for a slot to run a
    // query that could not have matched anything.
    expect(withTenantContext.mock.calls.length).toBe(0)
  })

  test("a valid window reaches the query layer exactly once", async () => {
    const findMany = mock(async () => [{ id: "a1", attendanceDate: "2026-08-20" }])
    const withTenantContext = mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) =>
      fn({ query: { constructionAttendance: { findMany } } })
    )
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext }))

    const { listAttendance } = await import("./construction-labour-service")
    const rows = await listAttendance({ orgId: "org-1" }, { projectId: "p1", from: "2026-08-03", to: "2026-09-02" })

    expect(rows).toEqual([{ id: "a1", attendanceDate: "2026-08-20" }])
    expect(withTenantContext.mock.calls.length).toBe(1)
    expect(findMany.mock.calls.length).toBe(1)
  })

  test("neither projectId nor rosterId is still a 400 -- unchanged by the window work", async () => {
    const withTenantContext = mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => fn({}))
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext }))

    const { listAttendance } = await import("./construction-labour-service")
    await expect(listAttendance({ orgId: "org-1" }, {})).rejects.toThrow(/projectId or rosterId is required/)
    expect(withTenantContext.mock.calls.length).toBe(0)
  })
})

// R67 F-13 (R-193/R-217) -- listRoster returns each worker's vendor NAME.
//
// THE FAULT. Every consumer that wanted to show "who this worker belongs to"
// had to fetch the org's whole vendor master separately and join it itself.
// PROJEXA's Work Progress Report did exactly that as one of its six VERIDIAN
// calls, purely to turn a handful of vendorIds into names.
//
// The three ways the fix could be silently wrong, each pinned below: reading
// the vendor master once per ROW (the N+1 this repo keeps removing), reading it
// at all when nobody is subcontracted, and rendering a deleted vendor's raw id
// as if it were a name.
describe("listRoster: vendor names, batched", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
  })

  async function loadWith(roster: unknown[], vendors: unknown[]) {
    const vendorFindMany = mock(async () => vendors)
    const withTenantContext = mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) =>
      fn({
        query: {
          constructionLabourRoster: { findMany: async () => roster },
          erpSuppliers: { findMany: vendorFindMany },
        },
      })
    )
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext }))
    const { listRoster } = await import("./construction-labour-service")
    const rows = await listRoster({ orgId: "org-1" }, "p1")
    return { rows, vendorFindMany, withTenantContext }
  }

  test("every row carries its vendor's name, from ONE vendor read for the whole list", async () => {
    const { rows, vendorFindMany, withTenantContext } = await loadWith(
      [
        { id: "r1", name: "Ramesh", vendorId: "v1" },
        { id: "r2", name: "Suresh", vendorId: "v1" },
        { id: "r3", name: "Imran", vendorId: "v2" },
      ],
      [
        { id: "v1", supplierName: "ABC Contractors" },
        { id: "v2", supplierName: "XYZ Electricals" },
      ]
    )

    expect(rows.map((r) => r.vendorName)).toEqual(["ABC Contractors", "ABC Contractors", "XYZ Electricals"])
    // One read for three rows and two vendors -- never one per row.
    expect(vendorFindMany.mock.calls.length).toBe(1)
    // And all of it inside the transaction listRoster already opens.
    expect(withTenantContext.mock.calls.length).toBe(1)
  })

  test("direct labour reports a null vendor name, and costs no vendor read at all", async () => {
    const { rows, vendorFindMany } = await loadWith(
      [{ id: "r1", name: "Ramesh", vendorId: null }],
      []
    )

    expect(rows[0].vendorName).toBeNull()
    expect(vendorFindMany.mock.calls.length).toBe(0)
  })

  test("a deleted vendor reports null, NEVER the raw id -- the caller decides how to say 'unknown'", async () => {
    const { rows } = await loadWith([{ id: "r1", name: "Ramesh", vendorId: "v-gone" }], [])

    expect(rows[0].vendorName).toBeNull()
    expect(rows[0].vendorId).toBe("v-gone")
  })

  test("the existing row fields are untouched -- this is additive", async () => {
    const { rows } = await loadWith(
      [{ id: "r1", name: "Ramesh", trade: "Mason", dailyRate: "800", vendorId: "v1" }],
      [{ id: "v1", supplierName: "ABC Contractors" }]
    )

    expect(rows[0]).toEqual({ id: "r1", name: "Ramesh", trade: "Mason", dailyRate: "800", vendorId: "v1", vendorName: "ABC Contractors" })
  })
})
