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
/// <reference types="bun-types" />
import { describe, expect, test, mock, afterEach } from "bun:test"
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

const realTenantScoped = await import("@/lib/db/tenant-scoped")

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
