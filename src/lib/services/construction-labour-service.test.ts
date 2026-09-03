/// <reference types="bun-types" />
// R67 WS-C (C-08) -- THE BATCH ATTENDANCE WRITE.
//
// recordAttendance (above it in the service) writes exactly ONE row, so
// marking a twelve-worker crew present meant twelve round trips, twelve
// transactions on a five-connection pool, and no way to end up with either
// all twelve rows or none of them. recordAttendanceBatch is the fix, and the
// three things worth asserting about it cannot be read off the code:
//
//   1. N rows land in ONE transaction, from ONE insert -- and the loop is
//      INSIDE that transaction, never a transaction per worker (D-06 forbids
//      a nested withTenantContext, and a loop over recordAttendance would be
//      exactly that);
//   2. a second save for the same date is REFUSED with code REPLACE_REQUIRED
//      and the count in the sentence -- never a silent double and never a
//      silent overwrite;
//   3. `replace: true` really replaces: the old rows for those workers on
//      that date are deleted inside the same transaction.
//
// Same pure/DB-touching split as construction-boq-category-service.test.ts:
// only the DB layer is mocked, and the real service code path runs.
import { afterEach, describe, expect, mock, test } from "bun:test"
import * as realTenantScoped from "@/lib/db/tenant-scoped"
import { ATTENDANCE_STATUSES, REPLACE_REQUIRED } from "./construction-labour-service"

const ORG = "org-labour-test"
const PROJECT = "proj-1"
const DATE = "2026-09-03"

type FakeRoster = { id: string; orgId: string; projectId: string; name: string; dailyRate: string }
type FakeAttendance = { id: string; rosterId: string; attendanceDate: string; status: string }

function buildFakeDb(options: { roster: FakeRoster[]; existing?: FakeAttendance[] }) {
  const calls = {
    /** One entry per db.insert(...).values(...) -- so "one insert" is testable. */
    inserts: [] as unknown[][],
    deletes: 0,
    /** How many times a transaction was opened. Must be exactly one. */
    transactions: 0,
  }
  const db = {
    query: {
      constructionLabourRoster: {
        findMany: mock(async () => options.roster),
        findFirst: mock(async () => options.roster[0]),
      },
      constructionAttendance: {
        findMany: mock(async () => options.existing ?? []),
        findFirst: mock(async () => (options.existing ?? [])[0]),
      },
    },
    insert: () => ({
      values: (rows: unknown[]) => ({
        returning: async () => {
          calls.inserts.push(rows as unknown[])
          return (rows as Record<string, unknown>[]).map((r, i) => ({ ...r, id: `att-${i}` }))
        },
      }),
    }),
    delete: () => ({
      where: async () => {
        calls.deletes += 1
        return []
      },
    }),
  }
  return { db, calls }
}

async function withMockedDb<T>(fake: ReturnType<typeof buildFakeDb>, run: () => Promise<T>): Promise<T> {
  await mock.module("@/lib/db/tenant-scoped", () => ({
    ...realTenantScoped,
    withTenantContext: mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => {
      fake.calls.transactions += 1
      return fn(fake.db)
    }),
  }))
  return run()
}

const ROSTER: FakeRoster[] = Array.from({ length: 12 }, (_, i) => ({
  id: `w${i + 1}`,
  orgId: ORG,
  projectId: PROJECT,
  name: `Worker ${i + 1}`,
  dailyRate: "200",
}))

function crew(status: string = "present") {
  return ROSTER.map((r) => ({ rosterId: r.id, status }))
}

describe("ATTENDANCE_STATUSES", () => {
  test("is the closed set the UI's three chips map to", () => {
    expect([...ATTENDANCE_STATUSES]).toEqual(["present", "absent", "half_day"])
  })
})

describe("recordAttendanceBatch", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
  })

  test("writes N rows in ONE transaction, from ONE insert", async () => {
    const fake = buildFakeDb({ roster: ROSTER })
    await withMockedDb(fake, async () => {
      const { recordAttendanceBatch } = await import("./construction-labour-service")
      const result = await recordAttendanceBatch(
        { orgId: ORG },
        { projectId: PROJECT, attendanceDate: DATE, entries: crew() }
      )
      expect(result.written).toBe(12)
      expect(result.present).toBe(12)
      expect(result.absent).toBe(0)
      // ONE transaction for the whole crew, not one per worker -- which is
      // also what keeps this off the nested-withTenantContext path D-06
      // forbids.
      expect(fake.calls.transactions).toBe(1)
      expect(fake.calls.inserts.length).toBe(1)
      expect(fake.calls.inserts[0].length).toBe(12)
    })
  })

  test("dailyCost follows the status: full, half, nothing", async () => {
    const fake = buildFakeDb({ roster: ROSTER.slice(0, 3) })
    await withMockedDb(fake, async () => {
      const { recordAttendanceBatch } = await import("./construction-labour-service")
      await recordAttendanceBatch(
        { orgId: ORG },
        {
          projectId: PROJECT,
          attendanceDate: DATE,
          entries: [
            { rosterId: "w1", status: "present" },
            { rosterId: "w2", status: "half_day" },
            { rosterId: "w3", status: "absent" },
          ],
        }
      )
      const written = fake.calls.inserts[0] as Record<string, unknown>[]
      expect(written.map((r) => r.dailyCost)).toEqual(["200", "100", "0"])
    })
  })

  test("a second save for the same date is refused with REPLACE_REQUIRED, naming the count", async () => {
    const fake = buildFakeDb({
      roster: ROSTER,
      existing: [
        { id: "a1", rosterId: "w1", attendanceDate: DATE, status: "present" },
        { id: "a2", rosterId: "w2", attendanceDate: DATE, status: "present" },
      ],
    })
    await withMockedDb(fake, async () => {
      const { recordAttendanceBatch, ServiceError } = await import("./construction-labour-service")
      let thrown: unknown
      try {
        await recordAttendanceBatch({ orgId: ORG }, { projectId: PROJECT, attendanceDate: DATE, entries: crew() })
      } catch (err) {
        thrown = err
      }
      expect(thrown).toBeInstanceOf(ServiceError)
      expect((thrown as { code?: string }).code).toBe(REPLACE_REQUIRED)
      expect((thrown as { status: number }).status).toBe(409)
      expect((thrown as Error).message).toBe(
        `Attendance for ${DATE} is already saved for 2 of these workers`
      )
      // THE REFUSAL WROTE NOTHING. A 409 that had already inserted half the
      // crew would be worse than the duplicate it was refusing.
      expect(fake.calls.inserts).toEqual([])
      expect(fake.calls.deletes).toBe(0)
    })
  })

  test("replace:true deletes the day's existing rows and re-writes, in the same transaction", async () => {
    const fake = buildFakeDb({
      roster: ROSTER,
      existing: [{ id: "a1", rosterId: "w1", attendanceDate: DATE, status: "present" }],
    })
    await withMockedDb(fake, async () => {
      const { recordAttendanceBatch } = await import("./construction-labour-service")
      const result = await recordAttendanceBatch(
        { orgId: ORG },
        { projectId: PROJECT, attendanceDate: DATE, entries: crew("absent"), replace: true }
      )
      expect(result.replaced).toBe(true)
      expect(result.absent).toBe(12)
      expect(fake.calls.deletes).toBe(1)
      expect(fake.calls.inserts.length).toBe(1)
      expect(fake.calls.transactions).toBe(1)
    })
  })

  test("a worker who is not on this project's roster stops the whole batch", async () => {
    const fake = buildFakeDb({ roster: ROSTER.slice(0, 10) })
    await withMockedDb(fake, async () => {
      const { recordAttendanceBatch } = await import("./construction-labour-service")
      let thrown: unknown
      try {
        await recordAttendanceBatch({ orgId: ORG }, { projectId: PROJECT, attendanceDate: DATE, entries: crew() })
      } catch (err) {
        thrown = err
      }
      expect((thrown as Error).message).toBe("2 of these workers are not on this project's roster")
      expect((thrown as { status: number }).status).toBe(404)
      expect(fake.calls.inserts).toEqual([])
    })
  })

  test("the bad-input refusals happen before any transaction is opened", async () => {
    const fake = buildFakeDb({ roster: ROSTER })
    await withMockedDb(fake, async () => {
      const { recordAttendanceBatch } = await import("./construction-labour-service")
      const cases: [Parameters<typeof recordAttendanceBatch>[1], string][] = [
        [{ projectId: "", attendanceDate: DATE, entries: crew() }, "projectId is required"],
        [{ projectId: PROJECT, attendanceDate: "", entries: crew() }, "attendanceDate is required"],
        [{ projectId: PROJECT, attendanceDate: DATE, entries: [] }, "entries is required"],
        [
          { projectId: PROJECT, attendanceDate: DATE, entries: [{ rosterId: "" }] },
          "every entry needs a rosterId",
        ],
        [
          {
            projectId: PROJECT,
            attendanceDate: DATE,
            entries: [{ rosterId: "w1" }, { rosterId: "w1" }],
          },
          "the same worker appears twice in this batch",
        ],
        [
          { projectId: PROJECT, attendanceDate: DATE, entries: [{ rosterId: "w1", status: "maybe" }] },
          "status must be one of present, absent, half_day",
        ],
      ]
      for (const [input, message] of cases) {
        let thrown: unknown
        try {
          await recordAttendanceBatch({ orgId: ORG }, input)
        } catch (err) {
          thrown = err
        }
        expect((thrown as Error).message).toBe(message)
      }
      expect(fake.calls.transactions).toBe(0)
      expect(fake.calls.inserts).toEqual([])
    })
  })
})
