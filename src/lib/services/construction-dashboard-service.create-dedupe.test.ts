// Sumeet UI audit 2026-10-20 (defect 3): a project create that outlived PROJEXA's wait was retried and stored a second
// identical project. createProject() now returns the ORIGINAL row for the same org + same trimmed, case-insensitive name +
// same creating user within the last 2 minutes. Only withTenantContext is mocked; the fake select() renders the where-clause
// the service built with drizzle's own dialect, so a predicate that drops org/user/name/window fails here.
/// <reference types="bun-types" />
import { describe, expect, test, mock, beforeEach } from "bun:test"
import { PgDialect } from "drizzle-orm/pg-core"

type Row = Record<string, unknown>
let rows: Row[] = []
let inserts = 0
let locks = 0
let lastWhere: { sql: string; params: unknown[] } | null = null
const dialect = new PgDialect()

function matches(row: Row, r: { sql: string; params: unknown[] }): boolean {
  const eqRe = /"projects"\."(\w+)" = \$(\d+)/g
  let m: RegExpExecArray | null
  while ((m = eqRe.exec(r.sql))) {
    const key = m[1].replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
    if (row[key] !== r.params[Number(m[2]) - 1]) return false
  }
  const nameM = /lower\(btrim\([^)]*"projects"\."name"\)\) = \$(\d+)/.exec(r.sql)
  if (nameM && String(row.name).trim().toLowerCase() !== r.params[Number(nameM[1]) - 1]) return false
  if (/interval '2 minutes'/.test(r.sql) && Date.now() - (row.createdAt as Date).getTime() > 2 * 60_000) return false
  return true
}

const fakeDb = {
  execute: async () => { locks++ },
  query: { products: { findFirst: async () => ({ id: "prod-1" }) } },
  select: () => ({
    from: () => ({
      where: (cond: Parameters<typeof dialect.sqlToQuery>[0]) => {
        lastWhere = dialect.sqlToQuery(cond)
        const found = rows.filter((r) => matches(r, lastWhere!))
        const chain = { orderBy: () => chain, limit: async () => found.slice(0, 1) }
        return chain
      },
    }),
  }),
  insert: () => ({
    values: (v: Row) => ({
      returning: async () => {
        inserts++
        const row = { id: `p${inserts}`, createdAt: new Date(), ...v }
        rows.push(row)
        return [row]
      },
    }),
  }),
}

mock.module("@/lib/db/tenant-scoped", () => ({
  withTenantContext: async (_ctx: unknown, fn: (db: unknown) => unknown) => fn(fakeDb),
}))

const { createProject } = await import("./construction-dashboard-service")
const ctx = { orgId: "org-a", userId: "user-1", isRealUser: true }

beforeEach(() => { rows = []; inserts = 0; locks = 0; lastWhere = null })

describe("createProject retry de-duplication", () => {
  test("the same create sent three times stores ONE project and returns the original", async () => {
    const a = await createProject(ctx, { name: "Villa 21" })
    const b = await createProject(ctx, { name: "Villa 21" })
    const c = await createProject(ctx, { name: "Villa 21" })
    expect(inserts).toBe(1)
    expect(b.id).toBe(a.id)
    expect(c.id).toBe(a.id)
  })

  test("the name is compared trimmed and case-insensitively", async () => {
    const a = await createProject(ctx, { name: "Villa 21" })
    const b = await createProject(ctx, { name: "  villa 21 " })
    expect(b.id).toBe(a.id)
    expect(inserts).toBe(1)
  })

  test("a different name, a different org or a different user is a different project", async () => {
    await createProject(ctx, { name: "Villa 21" })
    await createProject(ctx, { name: "Villa 22" })
    await createProject({ ...ctx, orgId: "org-b" }, { name: "Villa 21" })
    await createProject({ ...ctx, userId: "user-2" }, { name: "Villa 21" })
    expect(inserts).toBe(4)
  })

  test("a project older than two minutes does not count", async () => {
    await createProject(ctx, { name: "Villa 21" })
    rows[0].createdAt = new Date(Date.now() - 3 * 60_000)
    await createProject(ctx, { name: "Villa 21" })
    expect(inserts).toBe(2)
  })

  test("a caller that is not a real user row cannot be identified, so nothing is de-duplicated", async () => {
    const api = { orgId: "org-a", userId: "key-1", isRealUser: false }
    await createProject(api, { name: "Villa 21" })
    await createProject(api, { name: "Villa 21" })
    expect(inserts).toBe(2)
  })

  test("the check runs under one advisory lock and its predicate carries org, user, name and window", async () => {
    await createProject(ctx, { name: "Villa 21" })
    expect(locks).toBe(1)
    const { sql, params } = lastWhere!
    expect(sql).toContain('"org_id" = $')
    expect(sql).toContain('"lead_user_id" = $')
    expect(sql).toContain('lower(btrim("compliance"."projects"."name"))')
    expect(sql).toContain("interval '2 minutes'")
    expect(params).toEqual(expect.arrayContaining(["org-a", "user-1", "villa 21"]))
  })

  test("validation still runs before any database work", async () => {
    await expect(createProject(ctx, { name: " " })).rejects.toThrow("name is required")
    expect(locks).toBe(0)
  })
})
