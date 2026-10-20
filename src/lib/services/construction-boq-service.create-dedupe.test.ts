// Sumeet UI audit 2026-10-20 (defect 3): a BOQ create that outlived PROJEXA's wait was retried and stored a second identical
// BOQ. createBoq() now returns the ORIGINAL when the same org + project + title (trimmed) was created by the same user within
// the last 2 minutes, but ONLY if that BOQ is still a draft, is not a revision, and has exactly as many lines as this request.
// A different line count means the user changed the content, so it is a genuinely new BOQ. Only withTenantContext is mocked;
// the fake select() renders the where-clause the service built, so a predicate that drops a condition fails here.
/// <reference types="bun-types" />
import { describe, expect, test, mock, beforeEach } from "bun:test"
import { PgDialect } from "drizzle-orm/pg-core"
import { getTableName } from "drizzle-orm"

type Row = Record<string, unknown>
let boqs: Row[] = []
let lineCounts: Record<string, number> = {}
let locks = 0
let insertAttempts = 0
let lastBoqWhere: { sql: string; params: unknown[] } | null = null
const dialect = new PgDialect()

function matches(row: Row, r: { sql: string; params: unknown[] }): boolean {
  const eqRe = /"construction_boqs"\."(\w+)" = \$(\d+)/g
  let m: RegExpExecArray | null
  while ((m = eqRe.exec(r.sql))) {
    const key = m[1].replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
    if (row[key] !== r.params[Number(m[2]) - 1]) return false
  }
  if (/"construction_boqs"\."parent_boq_id" is null/.test(r.sql) && row.parentBoqId != null) return false
  if (/interval '2 minutes'/.test(r.sql) && Date.now() - (row.createdAt as Date).getTime() > 2 * 60_000) return false
  return true
}

const fakeDb = {
  execute: async () => { locks++ },
  query: {
    projects: { findFirst: async () => ({ id: "proj-1" }) },
    constructionBoqs: { findFirst: async () => boqs[0] },
    constructionBoqLineItems: { findMany: async () => [] },
  },
  select: (shape?: unknown) => ({
    from: (table: unknown) => ({
      where: (cond: Parameters<typeof dialect.sqlToQuery>[0]) => {
        const rendered = dialect.sqlToQuery(cond)
        if (getTableName(table as never) === "construction_boq_line_items") {
          const id = rendered.params[0] as string
          return Promise.resolve(Array.from({ length: lineCounts[id] ?? 0 }, (_, i) => ({ id: `li${i}` })))
        }
        lastBoqWhere = rendered
        const found = boqs.filter((r) => matches(r, rendered))
        const chain = { orderBy: () => chain, limit: async () => found.slice(0, 1) }
        return chain
      },
    }),
  }),
  insert: () => ({
    values: () => ({
      returning: async () => {
        insertAttempts++
        throw new Error("INSERT_REACHED")
      },
    }),
  }),
}

mock.module("@/lib/db/tenant-scoped", () => ({
  withTenantContext: async (_ctx: unknown, fn: (db: unknown) => unknown) => fn(fakeDb),
}))

const { createBoq } = await import("./construction-boq-service")
const ctx = { orgId: "org-a", userId: "user-1" }
const seed = (over: Row = {}, lines = 0) => {
  const row = { id: `b${boqs.length + 1}`, orgId: "org-a", projectId: "proj-1", title: "Villa BOQ", status: "draft", createdById: "user-1", parentBoqId: null, createdAt: new Date(), ...over }
  boqs.push(row)
  lineCounts[row.id as string] = lines
  return row
}
const line = (n: number) => ({ description: `item ${n}`, unit: "m", quantity: 1, unitRate: 10 })
const input = (lines = 0, over: Record<string, unknown> = {}) => ({ projectId: "proj-1", title: "Villa BOQ", lineItems: Array.from({ length: lines }, (_, i) => line(i)), ...over })

beforeEach(() => { boqs = []; lineCounts = {}; locks = 0; insertAttempts = 0; lastBoqWhere = null })

describe("createBoq retry de-duplication", () => {
  test("a retry of a just-created draft BOQ with the same line count returns the original and inserts nothing", async () => {
    const original = seed({}, 0)
    const result = await createBoq(ctx, input(0))
    expect(result.id).toBe(original.id)
    expect(insertAttempts).toBe(0)
  })

  test("the title is compared trimmed", async () => {
    const original = seed({}, 0)
    const result = await createBoq(ctx, input(0, { title: "  Villa BOQ " }))
    expect(result.id).toBe(original.id)
  })

  test("a different line count is a different BOQ", async () => {
    seed({}, 2)
    await expect(createBoq(ctx, input(0))).rejects.toThrow("INSERT_REACHED")
    expect(insertAttempts).toBe(1)
  })

  test("a BOQ that is no longer a draft is never returned", async () => {
    seed({ status: "approved" }, 0)
    await expect(createBoq(ctx, input(0))).rejects.toThrow("INSERT_REACHED")
  })

  test("a different user, project or title, and a revision, are different BOQs", async () => {
    seed({ createdById: "user-2" }, 0)
    seed({ title: "Other" }, 0)
    seed({ parentBoqId: "b0" }, 0)
    await expect(createBoq(ctx, input(0))).rejects.toThrow("INSERT_REACHED")
  })

  test("a BOQ older than two minutes does not count", async () => {
    seed({ createdAt: new Date(Date.now() - 3 * 60_000) }, 0)
    await expect(createBoq(ctx, input(0))).rejects.toThrow("INSERT_REACHED")
  })

  test("the check runs under one advisory lock and its predicate carries org, project, title, user, draft, no-parent and window", async () => {
    seed({}, 0)
    await createBoq(ctx, input(0))
    expect(locks).toBe(1)
    const { sql, params } = lastBoqWhere!
    for (const col of ["org_id", "project_id", "title", "created_by_id", "status"]) expect(sql).toContain(`"construction_boqs"."${col}" = $`)
    expect(sql).toContain('"construction_boqs"."parent_boq_id" is null')
    expect(sql).toContain("interval '2 minutes'")
    expect(params).toEqual(expect.arrayContaining(["org-a", "proj-1", "Villa BOQ", "user-1", "draft"]))
  })
})
