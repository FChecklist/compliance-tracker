// Sumeet UI audit 2026-10-19, R-C08 / defect 9: a create that outlived PROJEXA's
// 8-10 s wait was retried by the user and produced three identical Materials rows.
// createMaterial() now returns the ORIGINAL row for the same org + project + name
// + spec + unit created within the last 2 minutes instead of inserting again.
//
// Only withTenantContext is mocked. The fake db keeps real rows, and the fake
// select() RENDERS the where-clause the service built with drizzle's own dialect,
// so a service that dropped org/project/name/spec/unit/window from the predicate
// fails here rather than passing on a canned answer.
/// <reference types="bun-types" />
import { describe, expect, test, mock, beforeEach } from "bun:test"
import { PgDialect } from "drizzle-orm/pg-core"

type Row = Record<string, unknown>
let rows: Row[] = []
let inserts = 0
let locks = 0
let lastWhere: { sql: string; params: unknown[] } | null = null

const dialect = new PgDialect()

// A row "matches" if every equality the rendered predicate asks for (col = $n)
// holds, and (when the window clause is present) the row is younger than 2 min.
function matches(row: Row, rendered: { sql: string; params: unknown[] }): boolean {
  const eqRe = /"construction_materials"\."(\w+)" = \$(\d+)/g
  let m: RegExpExecArray | null
  while ((m = eqRe.exec(rendered.sql))) {
    const key = m[1].replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
    if (row[key] !== rendered.params[Number(m[2]) - 1]) return false
  }
  if (/"spec" is null/.test(rendered.sql) && row.spec !== null) return false
  if (/interval '2 minutes'/.test(rendered.sql)) {
    if (Date.now() - (row.createdAt as Date).getTime() > 2 * 60_000) return false
  }
  return true
}

const fakeDb = {
  execute: async () => { locks++ },
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
        const row = { id: `m${inserts}`, createdAt: new Date(), isActive: true, ...v }
        rows.push(row)
        return [row]
      },
    }),
  }),
}

mock.module("@/lib/db/tenant-scoped", () => ({
  withTenantContext: async (_ctx: unknown, fn: (db: unknown) => unknown) => fn(fakeDb),
}))

const { createMaterial } = await import("./construction-materials-service")

const ORG = "org-a"
const base = { projectId: "proj-1", name: "Cement", spec: "OPC 53", unit: "bag", unitCost: 28.5 }

beforeEach(() => { rows = []; inserts = 0; locks = 0; lastWhere = null })

describe("createMaterial retry de-duplication", () => {
  test("the same create sent three times stores ONE row and returns the original each time", async () => {
    const first = await createMaterial({ orgId: ORG }, base)
    const second = await createMaterial({ orgId: ORG }, base)
    const third = await createMaterial({ orgId: ORG }, base)
    expect(inserts).toBe(1)
    expect(rows).toHaveLength(1)
    expect(second.id).toBe(first.id)
    expect(third.id).toBe(first.id)
  })

  test("the insert and the check run under one advisory lock so an in-flight first attempt is not raced", async () => {
    await createMaterial({ orgId: ORG }, base)
    expect(locks).toBe(1)
  })

  test("a different name, spec, unit or project is a different material", async () => {
    await createMaterial({ orgId: ORG }, base)
    await createMaterial({ orgId: ORG }, { ...base, name: "Steel" })
    await createMaterial({ orgId: ORG }, { ...base, spec: "PPC" })
    await createMaterial({ orgId: ORG }, { ...base, unit: "kg" })
    await createMaterial({ orgId: ORG }, { ...base, projectId: "proj-2" })
    expect(inserts).toBe(5)
  })

  test("another org's identical material is never returned", async () => {
    await createMaterial({ orgId: ORG }, base)
    const other = await createMaterial({ orgId: "org-b" }, base)
    expect(inserts).toBe(2)
    expect(other.orgId).toBe("org-b")
  })

  test("a material with no spec de-duplicates on 'no spec', not on any spec", async () => {
    const { spec: _spec, ...noSpec } = base
    const a = await createMaterial({ orgId: ORG }, noSpec)
    const b = await createMaterial({ orgId: ORG }, noSpec)
    expect(b.id).toBe(a.id)
    await createMaterial({ orgId: ORG }, base)
    expect(inserts).toBe(2)
  })

  test("a row older than two minutes does not count, so a deliberate later duplicate still works", async () => {
    await createMaterial({ orgId: ORG }, base)
    rows[0].createdAt = new Date(Date.now() - 3 * 60_000)
    await createMaterial({ orgId: ORG }, base)
    expect(inserts).toBe(2)
  })

  test("the predicate is scoped by org, project, name and unit and carries the 2-minute window", async () => {
    await createMaterial({ orgId: ORG }, base)
    const { sql, params } = lastWhere!
    expect(sql).toContain('"org_id" = $')
    expect(sql).toContain('"project_id" = $')
    expect(sql).toContain('"name" = $')
    expect(sql).toContain('"unit" = $')
    expect(sql).toContain("interval '2 minutes'")
    expect(params).toEqual(expect.arrayContaining([ORG, "proj-1", "Cement", "OPC 53", "bag"]))
  })

  test("validation still runs before any database work", async () => {
    await expect(createMaterial({ orgId: ORG }, { ...base, name: "  " })).rejects.toThrow("name is required")
    expect(locks).toBe(0)
  })
})
