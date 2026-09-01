/// <reference types="bun-types" />
// R45 gap fix (found 2026-08-24, incidentally while UAT-testing R-C12/R45
// seq8): POST /api/settings/api-keys threw when `scopes` was sent as a JSON
// array instead of the documented comma-separated string, because the
// original code called `.split(",")` directly on whatever `scopes` was --
// Array.prototype has no `.split`, so an array payload fell into the generic
// catch block and returned a 500 instead of a proper 400. This file proves
// the normalization fix: string/array/omitted all route to a clean
// 201-or-400, never a 500, and the persisted `scopes` value is identical
// regardless of which shape the caller sent. @/lib/supabase/auth-guard,
// @/lib/db, @/lib/db/tenant-scoped and @/lib/api-keys are all mocked (same
// convention as route.test.ts.branding) so this exercises only the route's
// own input-normalization logic, not a live DB.
//
// CI-break fix (2026-09-01, R66 #1550 gap-closure follow-up): #1550 added a
// `requireRole` import to route.ts (admin-role gate for this route), but this
// mock.module("@/lib/supabase/auth-guard", ...) factory was never updated to
// provide it -- Bun's static-import-binding check on the mocked module then
// failed every test in this file with "Export named 'requireRole' not found
// in module ... auth-guard.ts", since a mock.module factory fully replaces
// the module's exports rather than merging with the real ones. This is NOT a
// circular-import problem: auth-guard.ts's real (unmocked) circular import
// with org-join-code-service.ts (see that file's own header comment) was
// independently verified to still resolve cleanly -- ROLE_RANK/UserRole are
// only ever read inside function bodies on both sides, never at module top
// level, so hoisting order never matters there. requireRole is stubbed as
// always-passing here (this file's job is proving scopes-normalization, not
// re-testing the role gate -- see access-control gate coverage precedent in
// branding/route.test.ts if that's ever needed for this route).
import { describe, test, expect, mock } from "bun:test"

function dbUser() {
  return { id: "user-1", orgId: "org-1" } as any
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/settings/api-keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function mockModules() {
  const insertedValues: any[] = []
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuth: mock(async () => ({ response: null, dbUser: dbUser(), orgId: "org-1" })),
    requireRole: mock(() => null),
  }))
  mock.module("@/lib/api-keys", () => ({
    generateApiKey: mock(() => "vk_faketestkey1234567890"),
    hashSHA256: mock(async () => "fake-hash"),
  }))
  mock.module("@/lib/db", () => ({ apiKeys: {} }))
  mock.module("@/lib/db/tenant-scoped", () => ({
    withTenantContext: mock(async (_ctx: unknown, fn: (db: any) => any) =>
      fn({
        insert: () => ({
          values: (v: any) => {
            insertedValues.push(v)
            return {
              returning: async () => [
                {
                  id: "key-1",
                  name: v.name,
                  keyPrefix: v.keyPrefix,
                  scopes: v.scopes,
                  isActive: v.isActive,
                  createdAt: new Date("2026-08-24T00:00:00.000Z"),
                },
              ],
            }
          },
        }),
      })
    ),
  }))
  return insertedValues
}

describe("POST /api/settings/api-keys (scopes normalization)", () => {
  test("array scopes: does NOT 500, persists the same value a comma-string would", async () => {
    mockModules()
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ name: "Array Key", scopes: ["read", "write"] }) as any)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.scopes).toBe("read,write")
  })

  test("comma-separated string scopes still works exactly as before (regression guard)", async () => {
    mockModules()
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ name: "String Key", scopes: "read,write" }) as any)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.scopes).toBe("read,write")
  })

  test("omitted scopes defaults to read (unchanged behavior)", async () => {
    mockModules()
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ name: "Default Key" }) as any)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.scopes).toBe("read")
  })

  test("array containing only invalid scope names returns 400, not 500", async () => {
    mockModules()
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ name: "Bad Array Key", scopes: ["nonsense"] }) as any)
    expect(res.status).toBe(400)
  })

  test("empty array returns 400 (no valid scopes), not 500", async () => {
    mockModules()
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ name: "Empty Array Key", scopes: [] }) as any)
    expect(res.status).toBe(400)
  })

  test("a completely malformed scopes shape (number) returns 400, not 500", async () => {
    mockModules()
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ name: "Weird Key", scopes: 42 }) as any)
    expect(res.status).toBe(400)
  })

  test("read:reports is still accepted, string or array", async () => {
    mockModules()
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ name: "Reports Key", scopes: ["read:reports"] }) as any)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.scopes).toBe("read:reports")
  })
})
