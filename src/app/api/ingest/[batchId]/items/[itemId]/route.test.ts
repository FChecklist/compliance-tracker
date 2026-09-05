/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G3-email-conv): proves the requireRole(dbUser,
// "manager") gate added to PATCH /api/ingest/[batchId]/items/[itemId] --
// see the route's own comment for why "manager" was chosen (matches its
// two already-gated siblings in the same ingest flow: DELETE
// /api/ingest/[batchId] and POST /api/ingest/[batchId]/confirm, both
// requireRole(dbUser, "manager")).
// This route has no separate service layer -- its business logic runs
// inline inside withTenantContext(). The reject case mocks
// @/lib/db/tenant-scoped to fail fast if ever reached (proving the gate
// runs before any DB access); the permit case supplies a minimal fake `db`
// covering every query/update/select this handler makes so the real
// business logic can run to completion and return 200.
import { describe, test, expect, mock } from "bun:test"

const RANK: Record<string, number> = {
  viewer: 1, client_viewer: 1, external_auditor: 1, stage_0: 1,
  member: 2, team_member: 2, senior_professional: 3, manager: 3,
  branch_manager: 4, admin: 5, veridian_admin: 6,
}

function fakeRequireRole(user: { role: string } | null, minimumRole: string) {
  const userRank = RANK[user?.role ?? ""] ?? 0
  const requiredRank = RANK[minimumRole] ?? 99
  if (userRank < requiredRank) {
    return new Response(JSON.stringify({ error: `This action requires ${minimumRole} role or higher` }), { status: 403 }) as any
  }
  return null
}

function dbUser(role: string) {
  return { id: "user-1", role, orgId: "org-1", name: "Test User" } as any
}

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/ingest/batch-1/items/item-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const FAKE_ITEM = {
  id: "item-1", title: "Old title", complianceType: "GST", dueDate: "2026-01-01",
  status: "pending", priority: "medium", departmentId: null, departmentName: null,
  assignedToId: null, description: null, reviewStatus: "pending", extraData: "{}",
}

function fakeDbForPermit() {
  return {
    query: {
      ingestionBatches: { findFirst: async () => ({ status: "pending" }) },
      ingestionItems: { findFirst: async () => ({ ...FAKE_ITEM, reviewStatus: "approved" }) },
      departments: { findFirst: async () => null },
    },
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    select: () => ({ from: () => ({ where: async () => [{ approved: 1, rejected: 0 }] }) }),
  }
}

describe("PATCH /api/ingest/[batchId]/items/[itemId] (access control)", () => {
  test("a role below manager (team_member) is rejected with 403 and the DB is never touched", async () => {
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("team_member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/db/tenant-scoped", () => ({
      withTenantContext: mock(async () => { throw new Error("withTenantContext should not be reached for a below-minimum role") }),
    }))
    const { PATCH } = await import("./route")
    const res = await PATCH(makeRequest({ reviewStatus: "approved" }) as any, { params: Promise.resolve({ batchId: "batch-1", itemId: "item-1" }) })
    expect(res.status).toBe(403)
  })

  test("a manager-rank caller is allowed through and the item is approved", async () => {
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("manager"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/db/tenant-scoped", () => ({
      withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => unknown) => fn(fakeDbForPermit())),
    }))
    const { PATCH } = await import("./route")
    const res = await PATCH(makeRequest({ reviewStatus: "approved" }) as any, { params: Promise.resolve({ batchId: "batch-1", itemId: "item-1" }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.reviewStatus).toBe("approved")
  })
})
