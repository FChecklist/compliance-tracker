/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G7 final): proves the requireRole(dbUser, "admin") gate
// added to POST /api/settings/webhooks/[id]/redeliver -- see the route's own
// comment for why "admin" was chosen (matches every sibling handler in this
// module: GET/POST ../route.ts, PATCH/DELETE ../[id]/route.ts, all "admin"
// per R66 gap-closure).
// @/lib/db/tenant-scoped and @/lib/webhook-deliver are mocked (@/lib/db's own
// schema-table imports are left real and unmocked, same convention as
// departments/route.test.ts -- lazy connection, safe to import without a
// live DB) so this exercises only the route's own role gate, never a live DB.
import { describe, test, expect, mock } from "bun:test"
import { ROLE_RANK } from "@/lib/supabase/role-rank"

function dbUser(role: string) {
  return { id: "user-1", role, orgId: "org-1" } as any
}

function fakeRequireRole(user: any, minimumRole: string) {
  const userRank = ROLE_RANK[user?.role as keyof typeof ROLE_RANK] ?? 0
  const requiredRank = ROLE_RANK[minimumRole as keyof typeof ROLE_RANK] ?? 99
  if (userRank < requiredRank) {
    return new Response(JSON.stringify({ error: `This action requires ${minimumRole} role or higher` }), { status: 403 }) as any
  }
  return null
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/settings/webhooks/webhook-1/redeliver", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function mockNonAuthModules(redeliverImpl: () => Promise<any>) {
  mock.module("@/lib/webhook-deliver", () => ({
    redeliverWebhookDelivery: mock(redeliverImpl),
  }))
  mock.module("@/lib/db/tenant-scoped", () => ({
    withTenantContext: mock(async (_ctx: unknown, fn: (db: any) => any) =>
      fn({
        query: {
          webhooks: { findFirst: async () => ({ id: "webhook-1", url: "https://example.com/hook", secret: "whsec_x" }) },
          webhookDeliveries: { findFirst: async () => ({ id: "delivery-1", webhookId: "webhook-1", eventType: "item.created" }) },
        },
      })
    ),
  }))
}

describe("POST /api/settings/webhooks/[id]/redeliver (access control)", () => {
  test("a role below admin (manager) is rejected with 403 and redeliverWebhookDelivery is never called", async () => {
    const redeliverWebhookDelivery = mock(async () => { throw new Error("redeliverWebhookDelivery should not be called for a below-role caller") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("manager"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mockNonAuthModules(redeliverWebhookDelivery)

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ deliveryId: "delivery-1" }) as any, { params: Promise.resolve({ id: "webhook-1" }) })
    expect(res.status).toBe(403)
    expect(redeliverWebhookDelivery).not.toHaveBeenCalled()
    mock.restore()
  })

  test("an admin-rank caller passes the role gate and the delivery is replayed", async () => {
    const redeliverWebhookDelivery = mock(async () => ({
      id: "delivery-2", eventType: "item.created", statusCode: 200, success: true, attempt: 1,
      redeliveryOfId: "delivery-1", createdAt: new Date("2026-09-05T00:00:00.000Z"),
    }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("admin"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mockNonAuthModules(redeliverWebhookDelivery)

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ deliveryId: "delivery-1" }) as any, { params: Promise.resolve({ id: "webhook-1" }) })
    expect(res.status).toBe(200)
    expect(redeliverWebhookDelivery).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})
