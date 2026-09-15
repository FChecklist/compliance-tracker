/// <reference types="bun-types" />
// GAP-UI07 remaining half (2026-09-14): registering a webhook (which hands
// the caller a real signing secret over the wire) previously left no audit
// trail -- an admin's own webhook registration was invisible on the org's
// /audit page. logActivity() is now called inside the same withTenantContext
// transaction as the insert (see route.ts), so a create and its audit row
// either both commit or both roll back together.
//
// Same mocking convention as api-keys/route.test.ts: @/lib/supabase/auth-guard
// and @/lib/db/tenant-scoped are mocked; @/lib/db is left real (schema-only,
// no eager DB connection -- see db/index.ts's own header comment) so
// webhooks/auditLogs identity can be compared directly, and so @/lib/audit's
// own transitive imports (session-limit-service.ts -> "@/lib/db") resolve
// without needing to be re-mocked here too.
import { describe, test, expect, mock } from "bun:test"
import { webhooks, auditLogs } from "@/lib/db"

function dbUser() {
  return { id: "user-1", orgId: "org-1" } as any
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/settings/webhooks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function mockModules() {
  const insertCalls: { table: unknown; values: any }[] = []
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuth: mock(async () => ({ response: null, dbUser: dbUser(), orgId: "org-1" })),
    requireRole: mock(() => null),
  }))
  mock.module("@/lib/db/tenant-scoped", () => ({
    withTenantContext: mock(async (_ctx: unknown, fn: (db: any) => any) =>
      fn({
        insert: (table: unknown) => ({
          values: (v: any) => {
            insertCalls.push({ table, values: v })
            return {
              returning: async () => [
                {
                  id: "webhook-1",
                  name: v.name,
                  url: v.url,
                  secret: v.secret,
                  events: v.events,
                  isActive: v.isActive,
                  createdAt: new Date("2026-09-14T00:00:00.000Z"),
                },
              ],
            }
          },
        }),
      })
    ),
  }))
  return insertCalls
}

describe("POST /api/settings/webhooks (validation, regression guard)", () => {
  test("valid payload creates a webhook", async () => {
    mockModules()
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ name: "My Hook", url: "https://example.com/hook", events: ["item.created"] }) as any)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.name).toBe("My Hook")
    expect(body.events).toBe("item.created")
  })

  test("non-https URL returns 400, not 500", async () => {
    mockModules()
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ name: "My Hook", url: "http://example.com/hook", events: ["item.created"] }) as any)
    expect(res.status).toBe(400)
  })

  test("no valid event types returns 400", async () => {
    mockModules()
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ name: "My Hook", url: "https://example.com/hook", events: ["not.a.real.event"] }) as any)
    expect(res.status).toBe(400)
  })
})

describe("POST /api/settings/webhooks (audit log)", () => {
  test("writes an auditLogs row (entityType Webhook) in the same tx as the webhook insert", async () => {
    const insertCalls = mockModules()
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ name: "Audited Hook", url: "https://example.com/hook", events: ["item.created"] }) as any)
    expect(res.status).toBe(201)

    const auditInsert = insertCalls.find((c) => c.table === auditLogs)
    expect(auditInsert).toBeDefined()
    expect(auditInsert!.values.action).toBe("create")
    expect(auditInsert!.values.entityType).toBe("Webhook")
    expect(auditInsert!.values.entityId).toBe("webhook-1")
    expect(auditInsert!.values.orgId).toBe("org-1")
    expect(auditInsert!.values.userId).toBe("user-1")

    const webhookInsert = insertCalls.find((c) => c.table === webhooks)
    expect(webhookInsert).toBeDefined()
  })
})
