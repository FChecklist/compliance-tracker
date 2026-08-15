/// <reference types="bun-types" />
// UMR-20260802-165606-4413 (amends parent UMR-20260802-104058-25ba):
// GET /api/departments had no test coverage before this file. Real
// end-user certification testing found this route returning a genuine
// HTTP 500 for a fresh self-signup org, which then crashed the Compliance
// Register (`/compliance`) and Pendency View (`/compliance?status=overdue`)
// client-side because the frontend treated the error-shape response as an
// array (see `src/app/(app)/compliance/page.tsx`'s fix in this same PR).
//
// Root cause (confirmed by direct reproduction against the real DB with
// RLS enforced, for both the real fresh self-signup org from
// ai-os/PROJEXA_AI_COM_E2E_CERTIFICATION_REDO_2026-08-02.md and an older
// seeded org): `departments`/`users` have two FK relation pairs
// (`head`/`headOfDept` and the department-membership pair), and only one
// pair had `relationName` set. Drizzle's relational query builder throws
// "There are multiple relations between 'users' and 'departments'. Please
// specify relation name" once `with: { users: ... }` is used, regardless
// of org data or RLS context -- this was never RLS/tenant-context-specific.
// That relation-ambiguity regression itself is covered by
// `src/lib/db/schema.relations.test.ts` (fast, no live DB). This file
// covers the route's own wiring: auth-guard enforcement and honest error
// handling when the underlying query throws for any reason, following this
// repo's established convention (see settings/branding/route.test.ts,
// v1/tasks/[id]/status/route.test.ts) of mocking @/lib/supabase/auth-guard
// and the DB-access layer rather than touching a live DB from a .test.ts
// file.
import { describe, test, expect, mock } from "bun:test"

function makeRequest(): Request {
  return new Request("http://localhost/api/departments", { method: "GET" })
}

describe("GET /api/departments", () => {
  test("unauthenticated caller gets the auth-guard's own response verbatim, DB never queried", async () => {
    const withTenantContext = mock(async () => {
      throw new Error("withTenantContext should not be called when auth fails")
    })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({
        response: new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 }),
        orgId: null,
        dbUser: null,
      })),
      requireRole: () => null,
    }))
    mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext }))

    const { GET } = await import("./route")
    const res = await GET(makeRequest() as any)
    expect(res.status).toBe(401)
    expect(withTenantContext).not.toHaveBeenCalled()
  })

  test("authenticated caller with no resolvable org gets an empty array, not a crash-prone shape", async () => {
    const withTenantContext = mock(async () => {
      throw new Error("withTenantContext should not be called with no orgId")
    })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, orgId: null, dbUser: null })),
      requireRole: () => null,
    }))
    mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext }))

    const { GET } = await import("./route")
    const res = await GET(makeRequest() as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.departments)).toBe(true)
    expect(body.departments).toEqual([])
  })

  test("a real query failure (e.g. the relation-ambiguity regression this bug was) returns a real 500 with an error shape, never an array pretending to be departments", async () => {
    const withTenantContext = mock(async () => {
      throw new Error(
        "There are multiple relations between \"users\" and \"departments\". Please specify relation name"
      )
    })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, orgId: "org-1", dbUser: { id: "user-1", role: "admin" } })),
      requireRole: () => null,
    }))
    mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext }))

    const { GET } = await import("./route")
    const res = await GET(makeRequest() as any)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ error: "Failed to fetch departments" })
    expect(Array.isArray(body)).toBe(false)
    expect(Array.isArray((body as any).departments)).toBe(false)
  })

  test("success path shapes each department from its relations (head/complianceItems/users), matching what the frontend expects", async () => {
    const now = new Date("2026-08-02T00:00:00.000Z")
    const withTenantContext = mock(async (_ctx: unknown, fn: (db: unknown) => unknown) =>
      fn({
        query: {
          departments: {
            findMany: async () => [
              {
                id: "dept-1",
                name: "Finance",
                description: null,
                createdAt: now,
                updatedAt: now,
                head: { name: "Finance Manager" },
                complianceItems: [{ id: "ci-1", status: "completed" }, { id: "ci-2", status: "pending" }],
                users: [{ id: "user-1" }, { id: "user-2" }],
              },
            ],
          },
        },
      })
    )
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, orgId: "org-1", dbUser: { id: "user-1", role: "admin" } })),
      requireRole: () => null,
    }))
    mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext }))

    const { GET } = await import("./route")
    const res = await GET(makeRequest() as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.departments).toEqual([
      {
        id: "dept-1",
        name: "Finance",
        description: null,
        complianceCount: 2,
        memberCount: 2,
        headName: "Finance Manager",
        completedCount: 1,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    ])
  })
})
