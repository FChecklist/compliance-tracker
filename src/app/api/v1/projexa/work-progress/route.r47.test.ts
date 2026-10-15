/// <reference types="bun-types" />
// R-47 "Work Progress: Progress above 100% rejected or capped" -- closure test through the real route.
//
// The service-level proof (construction-progress-service.test.ts, assertPercentComplete) never went through the
// HTTP surface PROJEXA calls. This drives the real POST handler (projexa/work-progress/route.ts re-exports
// construction/progress/route.ts) and the real createProgressEntry(); only auth and the database driver are doubled.
// Asserted: a percentage above 100 (or below 0, or NaN) answers 400 with the service's own message AND the store,
// re-read afterwards, holds no entry and no transaction was ever opened; exactly 100 is NOT refused by the range rule
// (it gets as far as the project lookup, which the empty fake answers with 404 "Project not found").
// Run: bun test --isolate src/app/api/v1/projexa/work-progress/route.r47.test.ts
import { describe, test, expect, mock, beforeEach } from "bun:test"
import { NextRequest } from "next/server"
import { actingPersonDouble } from "@/lib/supabase/__test-helpers__/acting-person-double"
import { ROLE_RANK } from "@/lib/supabase/role-rank"

const store = { entries: [] as unknown[], transactions: 0 }

beforeEach(() => {
  store.entries = []
  store.transactions = 0
  mock.module("@/lib/supabase/auth-guard", () => ({
    ...actingPersonDouble(),
    ROLE_RANK,
    requireAuthOrApiKey: mock(async () => ({ response: null, orgId: "org-r47", dbUser: { id: "user-1" }, apiKey: null })),
    requireRoleOrScope: mock(() => null),
    resolveActingUser: mock(async (ctx: { dbUser: unknown }) => ({ user: ctx.dbUser, error: null })),
    readActingUserId: mock(() => null),
    readActingUserEmail: mock(() => null),
  }))
  mock.module("@/lib/db/tenant-scoped", () => ({
    withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => unknown) => {
      store.transactions++
      const db = {
        query: new Proxy({}, { get: () => ({ findFirst: async () => undefined, findMany: async () => [] }) }),
        insert: () => ({ values: (v: unknown) => { store.entries.push(v); return { returning: async () => [v] } } }),
      }
      return fn(db)
    }),
  }))
})

function post(percentComplete: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/projexa/work-progress", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: "p1", activityId: "a1", entryDate: "2026-10-08", quantityDone: 1, percentComplete }),
  })
}

describe("R-47 POST /api/v1/projexa/work-progress: progress above 100 is rejected", () => {
  for (const bad of [100.01, 140, 1000, -1]) {
    test(`percentComplete ${bad} -> 400, nothing persisted, no transaction`, async () => {
      const { POST } = await import("./route")
      const res = await POST(post(bad) as Parameters<typeof POST>[0])
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe("percentComplete must be between 0 and 100")
      expect(store.entries).toEqual([])
      expect(store.transactions).toBe(0)
    })
  }

  test("exactly 100 is not refused by the range rule (reaches the project lookup)", async () => {
    const { POST } = await import("./route")
    const res = await POST(post(100) as Parameters<typeof POST>[0])
    expect(store.transactions).toBe(1)
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe("Project not found")
  })
})
