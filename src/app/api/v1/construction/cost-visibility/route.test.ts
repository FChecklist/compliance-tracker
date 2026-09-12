/// <reference types="bun-types" />
// R85 Addendum 3 v4 Phase 6 -- VISIBILITY AND THE CLIENT BOUNDARY, gates
// 6-01/6-02. Real-route-handler tests: GET never lists client_viewer as a
// configurable role, and PATCH refuses an attempt to grant client_viewer
// cost visibility -- the API-LAYER half of the two-independent-layers proof
// the work order asks for. The DB-CHECK-CONSTRAINT half was verified LIVE
// against pcrjmlpuqsbocqfwoxod via the Supabase MCP (a real INSERT rejected
// with Postgres error 23514) -- see drizzle/0596's migration header and this
// phase's PR description for the verbatim output; that half cannot be
// re-run here because bun test has no live Postgres connection on this
// machine (CLAUDE.md's documented constraint).
//
// Exercises the REAL cost-visibility-service.ts (only @/lib/db/tenant-scoped
// is mocked, matching this file's DB-mocking convention elsewhere), so this
// proves the route + service wiring together, not a route that merely
// trusts a mocked service to refuse correctly.
import { describe, test, expect, mock, beforeEach } from "bun:test"

const ORG_ID = "org-1"

function mockAuth(role: string) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuthOrApiKey: mock(async () => ({
      response: null,
      orgId: ORG_ID,
      dbUser: { id: "user-1", role },
      apiKey: null,
    })),
    requireRoleOrScope: mock(() => null),
  }))
}

function mockTenantScoped(existingRows: Array<{ orgId: string; role: string; canSeeCost: boolean }> = []) {
  const rows = [...existingRows]
  mock.module("@/lib/db/tenant-scoped", () => ({
    withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => unknown) =>
      fn({
        query: {
          costVisibilityConfig: {
            findFirst: mock(async () => rows[0] ?? null),
            findMany: mock(async () => rows.map((r) => ({ ...r, changedById: "u1", changedAt: new Date() }))),
          },
        },
        insert: () => ({
          values: (values: { orgId: string; role: string; canSeeCost: boolean; changedById: string }) => ({
            onConflictDoUpdate: () => ({
              returning: async () => {
                rows.push({ orgId: values.orgId, role: values.role, canSeeCost: values.canSeeCost })
                return [{ ...values, changedAt: new Date() }]
              },
            }),
          }),
        }),
      })
    ),
  }))
  return rows
}

function makePatchRequest(body: unknown) {
  return new Request("http://localhost/api/v1/construction/cost-visibility", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mockAuth("admin")
})

describe("GET /api/v1/construction/cost-visibility -- 6-01 layer 2", () => {
  test("client_viewer is never listed as a configurable role, and never appears in the roles array", async () => {
    mockTenantScoped([{ orgId: ORG_ID, role: "admin", canSeeCost: true }])
    const { GET } = await import("./route")
    const res = await GET(new Request("http://localhost/api/v1/construction/cost-visibility"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.configurableRoles).not.toContain("client_viewer")
    expect(body.roles.some((r: { role: string }) => r.role === "client_viewer")).toBe(false)
    expect(body.roles.some((r: { role: string }) => r.role === "admin")).toBe(true)
  })
})

describe("PATCH /api/v1/construction/cost-visibility -- 6-01/6-02: the API-level refusal", () => {
  test("granting client_viewer cost visibility is REFUSED with a 400, and nothing is persisted", async () => {
    const rows = mockTenantScoped([])
    const { PATCH } = await import("./route")
    const res = await PATCH(makePatchRequest({ role: "client_viewer", canSeeCost: true }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain("client_viewer can never be granted cost visibility")
    expect(rows.length).toBe(0)
  })

  test("granting a real internal role (member) succeeds and is reflected on a subsequent GET", async () => {
    mockTenantScoped([])
    const { PATCH } = await import("./route")
    const patchRes = await PATCH(makePatchRequest({ role: "member", canSeeCost: true }))
    expect(patchRes.status).toBe(200)
    const patchBody = await patchRes.json()
    expect(patchBody.role).toBe("member")
    expect(patchBody.canSeeCost).toBe(true)
  })

  test("a malformed body (missing canSeeCost) is refused with a 400 before any write", async () => {
    const rows = mockTenantScoped([])
    const { PATCH } = await import("./route")
    const res = await PATCH(makePatchRequest({ role: "member" }))
    expect(res.status).toBe(400)
    expect(rows.length).toBe(0)
  })
})
