// R67 D-30 (Daily Attendance Sheet) -- the batch-write half of this service's
// tests.
//
// WHY THIS IS A SECOND FILE. Lane D3 and lane F-25 each wrote the service's
// first test file, at the same path, from no common ancestor: an add/add
// conflict on the merge with main. Decision D-11's rule of thumb settles it --
// the version already on main is canonical and keeps the shared path, the
// arriving lane keeps its own tests. F-25's file (construction-labour-service
// .test.ts) covers listAttendance's dated query, recordAttendance, listRoster
// and getLabourLanding; this file covers computeDailyCost and
// recordAttendanceBatch, which F-25's does not touch at all. They are two
// files rather than one because each carries its own fake-db evaluator with
// its own helper names -- hand-splicing the two evaluators together would risk
// silently weakening whichever one lost, and nothing is deleted silently.
//
// WHAT THIS EXERCISES AND HOW HONESTLY. This does NOT touch a live DB. It
// runs the real recordAttendanceBatch()/listAttendance() with only
// withTenantContext mocked -- the same convention
// construction-progress-service.test.ts established -- but the fake db below
// does not return canned rows: it EVALUATES the actual drizzle condition tree
// the service builds (eq / and / inArray / gte / lte) against an in-memory
// table, so a service that stopped scoping by orgId, by projectId, by
// attendanceDate or by the roster-id set would start matching rows it should
// not and these tests would fail. The evaluator supports exactly the
// operators this service uses and throws on anything else rather than
// silently treating an unknown predicate as "no constraint" -- an unsupported
// operator must fail loudly, not pass.
/// <reference types="bun-types" />
import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"
import type { SQL } from "drizzle-orm"

const ORG = "org-r67-d30"
const OTHER_ORG = "org-other"
const PROJECT = "project-cedar"
const OTHER_PROJECT = "project-marina"

type Row = Record<string, unknown>

function isSql(node: unknown): node is { queryChunks: unknown[] } {
  return !!node && typeof node === "object" && Array.isArray((node as { queryChunks?: unknown[] }).queryChunks)
}
function isColumn(node: unknown): node is { name: string } {
  return !!node && typeof node === "object" && "columnType" in node && "name" in node
}
function isParam(node: unknown): node is { value: unknown } {
  return !!node && typeof node === "object" && "encoder" in node && "value" in node
}
function isStringChunk(node: unknown): node is { value: string[] } {
  return !!node && typeof node === "object" && !("encoder" in node) && Array.isArray((node as { value?: unknown }).value)
}

// Drizzle renders `eq(col, v)` as an SQL node whose queryChunks are
// [StringChunk(""), Column, StringChunk(" = "), Param, StringChunk("")], and
// `and(a, b)` as [StringChunk("("), SQL[ a, StringChunk(" and "), b ],
// StringChunk(")")]. `inArray(col, values)` is the same leaf shape with the
// operator " in " and a plain Array of Params as the operand. Verified
// empirically against this repo's own drizzle-orm version before this
// evaluator was written.
function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

function evaluateCondition(node: unknown, row: Row): boolean {
  if (node === undefined || node === null) return true
  if (!isSql(node)) throw new Error("fake db: unsupported condition node (not a drizzle SQL chunk)")
  const chunks = node.queryChunks

  const colIndex = chunks.findIndex(isColumn)
  if (colIndex !== -1) {
    const column = chunks[colIndex] as { name: string }
    const opChunk = chunks[colIndex + 1]
    const operand = chunks[colIndex + 2]
    const op = isStringChunk(opChunk) ? String(opChunk.value[0]).trim() : ""
    const actual = row[snakeToCamel(column.name)]

    if (op === "in") {
      if (!Array.isArray(operand)) throw new Error("fake db: 'in' operand was not an array of params")
      return operand.map((p) => (isParam(p) ? p.value : p)).includes(actual)
    }
    const expected = isParam(operand) ? operand.value : operand
    switch (op) {
      case "=": return actual === expected
      case "<>": return actual !== expected
      case ">=": return String(actual) >= String(expected)
      case "<=": return String(actual) <= String(expected)
      case ">": return String(actual) > String(expected)
      case "<": return String(actual) < String(expected)
      default: throw new Error(`fake db: unsupported operator "${op}"`)
    }
  }

  const subConditions = chunks.filter(isSql)
  if (subConditions.length === 0) throw new Error("fake db: condition had neither a column nor sub-conditions")
  const joiners = chunks
    .filter(isStringChunk)
    .map((c) => String(c.value[0]).trim())
    .filter((s) => s === "and" || s === "or")
  const results = subConditions.map((sub) => evaluateCondition(sub, row))
  return joiners.includes("or") ? results.some(Boolean) : results.every(Boolean)
}

// ── fixtures ────────────────────────────────────────────────────────────
// ALI and BINA are on PROJECT; CARLOS is on a DIFFERENT project of the same
// org (the intra-tenant misattribution case); DAWOOD belongs to a different
// org entirely.
const ALI = { id: "roster-ali", orgId: ORG, projectId: PROJECT, name: "Ali Hassan", dailyRate: "300", isActive: true }
const BINA = { id: "roster-bina", orgId: ORG, projectId: PROJECT, name: "Bina Rao", dailyRate: "250", isActive: true }
const CARLOS = { id: "roster-carlos", orgId: ORG, projectId: OTHER_PROJECT, name: "Carlos Diaz", dailyRate: "400", isActive: true }
const DAWOOD = { id: "roster-dawood", orgId: OTHER_ORG, projectId: PROJECT, name: "Dawood Khan", dailyRate: "500", isActive: true }

let rosterRows: Row[] = []
let attendanceRows: Row[] = []
let idSeq = 0
let tenantContextCalls = 0

const mockWithTenantContext = mock(async (ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => {
  tenantContextCalls++
  void ctx
  return fn(fakeDb as unknown as never)
})

const fakeDb = {
  query: {
    constructionLabourRoster: {
      findMany: async ({ where }: { where: SQL }) => rosterRows.filter((r) => evaluateCondition(where, r)),
      findFirst: async ({ where }: { where: SQL }) => rosterRows.find((r) => evaluateCondition(where, r)),
    },
    constructionAttendance: {
      findMany: async ({ where }: { where: SQL }) => attendanceRows.filter((r) => evaluateCondition(where, r)),
      findFirst: async ({ where }: { where: SQL }) => attendanceRows.find((r) => evaluateCondition(where, r)),
    },
  },
  insert: () => ({
    values: (value: Row | Row[]) => ({
      returning: async () => {
        const incoming = Array.isArray(value) ? value : [value]
        const created = incoming.map((v) => ({ id: `att-${++idSeq}`, createdAt: new Date("2026-09-02T00:00:00Z"), ...v }))
        attendanceRows.push(...created)
        return created
      },
    }),
  }),
  update: () => ({
    set: (patch: Row) => ({
      where: (where: SQL) => ({
        returning: async () => {
          const hits = attendanceRows.filter((r) => evaluateCondition(where, r))
          for (const hit of hits) Object.assign(hit, patch)
          return hits
        },
      }),
    }),
  }),
}

const realTenantScoped = await import("@/lib/db/tenant-scoped")
const realAutomation = await import("./automation-rule-service")

async function useMocks(): Promise<void> {
  await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mockWithTenantContext }))
  // recordAttendanceBatch fires the Wave 126 absence automation
  // fire-and-forget after the transaction; stub it so a test that marks
  // someone absent does not reach the real rule engine (and a real DB).
  await mock.module("./automation-rule-service", () => ({ evaluateAndRunRules: async () => [] }))
}

beforeEach(() => {
  rosterRows = [{ ...ALI }, { ...BINA }, { ...CARLOS }, { ...DAWOOD }]
  attendanceRows = []
  idSeq = 0
  tenantContextCalls = 0
  mockWithTenantContext.mockClear()
})

afterEach(async () => {
  mock.restore()
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
  await mock.module("./automation-rule-service", () => realAutomation)
})

describe("computeDailyCost -- the one present/half-day/absent money rule", () => {
  test("present is the full daily rate", async () => {
    const { computeDailyCost } = await import("./construction-labour-service")
    expect(computeDailyCost("300", "present")).toBe(300)
  })

  test("half_day is exactly half the daily rate", async () => {
    const { computeDailyCost } = await import("./construction-labour-service")
    expect(computeDailyCost("250", "half_day")).toBe(125)
    expect(computeDailyCost(275, "half_day")).toBe(137.5)
  })

  test("absent is zero -- not the rate, and not null", async () => {
    const { computeDailyCost } = await import("./construction-labour-service")
    expect(computeDailyCost("300", "absent")).toBe(0)
  })

  test("a non-numeric rate degrades to 0 rather than producing NaN in a money column", async () => {
    const { computeDailyCost } = await import("./construction-labour-service")
    expect(computeDailyCost("", "present")).toBe(0)
    expect(computeDailyCost("not-a-rate", "present")).toBe(0)
  })
})

describe("recordAttendanceBatch -- R67 D-30 acceptance", () => {
  test("saving the same sheet twice leaves exactly 2 rows (upsert, not 4), and half_day costs half the roster rate", async () => {
    await useMocks()
    const { recordAttendanceBatch } = await import("./construction-labour-service")

    const rows = [
      { rosterId: ALI.id, status: "present" as const },
      { rosterId: BINA.id, status: "half_day" as const },
    ]

    const first = await recordAttendanceBatch({ orgId: ORG }, { projectId: PROJECT, attendanceDate: "2026-09-02", rows })
    const second = await recordAttendanceBatch({ orgId: ORG }, { projectId: PROJECT, attendanceDate: "2026-09-02", rows })

    expect(attendanceRows).toHaveLength(2)
    expect(first.createdCount).toBe(2)
    expect(second.createdCount).toBe(0)
    expect(second.updatedCount).toBe(2)

    const bina = attendanceRows.find((r) => r.rosterId === BINA.id)!
    expect(Number(bina.dailyCost)).toBe(Number(BINA.dailyRate) * 0.5)
    const ali = attendanceRows.find((r) => r.rosterId === ALI.id)!
    expect(Number(ali.dailyCost)).toBe(Number(ALI.dailyRate))
  })

  test("re-saving with a corrected status rewrites the row's status AND its cost instead of appending a second row", async () => {
    await useMocks()
    const { recordAttendanceBatch } = await import("./construction-labour-service")

    await recordAttendanceBatch({ orgId: ORG }, {
      projectId: PROJECT, attendanceDate: "2026-09-02",
      rows: [{ rosterId: ALI.id, status: "present" }],
    })
    await recordAttendanceBatch({ orgId: ORG }, {
      projectId: PROJECT, attendanceDate: "2026-09-02",
      rows: [{ rosterId: ALI.id, status: "absent" }],
    })

    expect(attendanceRows).toHaveLength(1)
    expect(attendanceRows[0].status).toBe("absent")
    expect(Number(attendanceRows[0].dailyCost)).toBe(0)
  })

  test("a second date does not collide with the first -- the key is (roster, date), not roster alone", async () => {
    await useMocks()
    const { recordAttendanceBatch } = await import("./construction-labour-service")

    await recordAttendanceBatch({ orgId: ORG }, { projectId: PROJECT, attendanceDate: "2026-09-02", rows: [{ rosterId: ALI.id, status: "present" }] })
    await recordAttendanceBatch({ orgId: ORG }, { projectId: PROJECT, attendanceDate: "2026-09-03", rows: [{ rosterId: ALI.id, status: "present" }] })

    expect(attendanceRows).toHaveLength(2)
    expect(attendanceRows.map((r) => r.attendanceDate).sort()).toEqual(["2026-09-02", "2026-09-03"])
  })

  test("the whole sheet is ONE transaction, however many rows it carries", async () => {
    await useMocks()
    const { recordAttendanceBatch } = await import("./construction-labour-service")

    await recordAttendanceBatch({ orgId: ORG }, {
      projectId: PROJECT, attendanceDate: "2026-09-02",
      rows: [{ rosterId: ALI.id, status: "present" }, { rosterId: BINA.id, status: "absent" }],
    })

    expect(tenantContextCalls).toBe(1)
  })

  test("the footer total is the sum of the saved rows' costs", async () => {
    await useMocks()
    const { recordAttendanceBatch } = await import("./construction-labour-service")

    const result = await recordAttendanceBatch({ orgId: ORG }, {
      projectId: PROJECT, attendanceDate: "2026-09-02",
      rows: [{ rosterId: ALI.id, status: "present" }, { rosterId: BINA.id, status: "half_day" }],
    })

    expect(result.savedCount).toBe(2)
    expect(result.totalCost).toBe(300 + 125)
    expect(result.attendanceDate).toBe("2026-09-02")
  })

  test("hoursWorked is stored when given and left null when omitted -- an unmarked hours cell is not zero", async () => {
    await useMocks()
    const { recordAttendanceBatch } = await import("./construction-labour-service")

    await recordAttendanceBatch({ orgId: ORG }, {
      projectId: PROJECT, attendanceDate: "2026-09-02",
      rows: [{ rosterId: ALI.id, status: "present", hoursWorked: 7.5 }, { rosterId: BINA.id, status: "present" }],
    })

    expect(attendanceRows.find((r) => r.rosterId === ALI.id)!.hoursWorked).toBe("7.5")
    expect(attendanceRows.find((r) => r.rosterId === BINA.id)!.hoursWorked).toBeNull()
  })
})

describe("recordAttendanceBatch -- refusals, nothing written", () => {
  test("a worker who belongs to a DIFFERENT project of the same org is rejected 404, and no row is written for anyone in the sheet", async () => {
    await useMocks()
    const { recordAttendanceBatch, ServiceError } = await import("./construction-labour-service")

    await expect(recordAttendanceBatch({ orgId: ORG }, {
      projectId: PROJECT, attendanceDate: "2026-09-02",
      rows: [{ rosterId: ALI.id, status: "present" }, { rosterId: CARLOS.id, status: "present" }],
    })).rejects.toThrow(ServiceError)

    expect(attendanceRows).toHaveLength(0)
  })

  test("a worker belonging to another ORG is rejected -- the roster lookup is org-scoped, not id-only", async () => {
    await useMocks()
    const { recordAttendanceBatch, ServiceError } = await import("./construction-labour-service")

    await expect(recordAttendanceBatch({ orgId: ORG }, {
      projectId: PROJECT, attendanceDate: "2026-09-02",
      rows: [{ rosterId: DAWOOD.id, status: "present" }],
    })).rejects.toThrow(ServiceError)

    expect(attendanceRows).toHaveLength(0)
  })

  test("the same worker twice in one sheet is rejected rather than racing two writes for one cell", async () => {
    await useMocks()
    const { recordAttendanceBatch, ServiceError } = await import("./construction-labour-service")

    await expect(recordAttendanceBatch({ orgId: ORG }, {
      projectId: PROJECT, attendanceDate: "2026-09-02",
      rows: [{ rosterId: ALI.id, status: "present" }, { rosterId: ALI.id, status: "absent" }],
    })).rejects.toThrow(ServiceError)

    expect(attendanceRows).toHaveLength(0)
  })

  test("an empty sheet, a missing date and an unknown status are each refused with a 400", async () => {
    await useMocks()
    const { recordAttendanceBatch, ServiceError } = await import("./construction-labour-service")

    await expect(recordAttendanceBatch({ orgId: ORG }, { projectId: PROJECT, attendanceDate: "2026-09-02", rows: [] }))
      .rejects.toThrow(ServiceError)
    await expect(recordAttendanceBatch({ orgId: ORG }, { projectId: PROJECT, attendanceDate: "", rows: [{ rosterId: ALI.id, status: "present" }] }))
      .rejects.toThrow(ServiceError)
    await expect(recordAttendanceBatch({ orgId: ORG }, {
      projectId: PROJECT, attendanceDate: "2026-09-02",
      rows: [{ rosterId: ALI.id, status: "sick" as unknown as "present" }],
    })).rejects.toThrow(ServiceError)

    expect(attendanceRows).toHaveLength(0)
    expect(tenantContextCalls).toBe(0)
  })
})

describe("listAttendance -- R67 D-30/D-33 from/to window", () => {
  test("from/to filter in SQL and are inclusive at both ends", async () => {
    await useMocks()
    const { recordAttendanceBatch, listAttendance } = await import("./construction-labour-service")

    for (const date of ["2026-08-31", "2026-09-01", "2026-09-15", "2026-09-30", "2026-10-01"]) {
      await recordAttendanceBatch({ orgId: ORG }, { projectId: PROJECT, attendanceDate: date, rows: [{ rosterId: ALI.id, status: "present" }] })
    }

    const september = await listAttendance({ orgId: ORG }, { rosterId: ALI.id, from: "2026-09-01", to: "2026-09-30" })
    expect(september.map((r) => (r as unknown as Row).attendanceDate).sort())
      .toEqual(["2026-09-01", "2026-09-15", "2026-09-30"])
  })

  test("a query with neither projectId nor rosterId is refused rather than returning the whole org", async () => {
    await useMocks()
    const { listAttendance, ServiceError } = await import("./construction-labour-service")
    await expect(listAttendance({ orgId: ORG }, {})).rejects.toThrow(ServiceError)
  })
})
