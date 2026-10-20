/// <reference types="bun-types" />
import { describe, test, expect, mock, beforeEach, setDefaultTimeout } from "bun:test"
import { NextRequest, NextResponse } from "next/server"
import type { users } from "@/lib/db"
import type { UserRole } from "@/lib/supabase/auth-guard"

setDefaultTimeout(30000)
type DbUser = typeof users.$inferSelect

// Real requireRoleOrScope()/hasRole() are used (not mocked); only the credential lookup is controlled.
async function mockAuth(who: { role?: UserRole; scopes?: string[]; none?: boolean }) {
  const actual = await import("@/lib/supabase/auth-guard")
  mock.module("@/lib/supabase/auth-guard", () => ({
    ...actual,
    requireAuthOrApiKey: mock(async () =>
      who.none
        ? { orgId: null, dbUser: null, apiKey: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
        : who.role
          ? { orgId: "org-1", dbUser: { id: "u-session", email: "o@x.com", role: who.role } as unknown as DbUser, apiKey: null, response: null }
          : { orgId: "org-1", dbUser: null, apiKey: { id: "k1", name: "projexa-key", scopes: who.scopes ?? [] }, response: null }
    ),
  }))
}
const tenantCalls: unknown[] = []
mock.module("@/lib/db/tenant-scoped", () => ({
  withTenantContext: async (c: unknown, fn: (db: unknown) => unknown) => { tenantCalls.push(c); return fn({}) },
}))
beforeEach(() => { tenantCalls.length = 0 })
const getIssue = mock(async (_db: unknown, _org: string, id: string) => (id === "missing" ? null : { issue: { id, status: "open" }, events: [{ id: "e1", breadcrumbs: [{ step: 1 }] }] }))
const patchIssue = mock(async (_db: unknown, _org: string, id: string, patch: Record<string, unknown>, by: string | null) => {
  if (id === "missing") { const { ServiceError } = await import("@/lib/services/compliance-service"); throw new ServiceError("Issue not found", 404) }
  return { id, ...patch, fixed_by: patch.fixed_by ?? by }
})
async function mockService() {
  const actual = await import("@/lib/services/client-log-service")
  mock.module("@/lib/services/client-log-service", () => ({ ...actual, getIssueWithDb: getIssue, patchIssueWithDb: patchIssue }))
  getIssue.mockClear(); patchIssue.mockClear()
}
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const patch = (body: unknown) => new NextRequest("http://localhost/api/v1/projexa/client-logs/issues/i1", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
const read = () => new NextRequest("http://localhost/api/v1/projexa/client-logs/issues/i1")
const FIX = { status: "fixed", fix_summary: "Guard null", fix_files: [{ path: "src/a.ts", change: "null check" }], fix_commit: "abc123" }

describe("GET /api/v1/projexa/client-logs/issues/[id]", () => {
  test("admin only; 404 when missing; returns the issue and its events", async () => {
    await mockAuth({ role: "member" }); await mockService()
    expect((await (await import("./route")).GET(read(), params("i1"))).status).toBe(403)
    await mockAuth({ role: "admin" })
    const { GET } = await import("./route")
    expect((await GET(read(), params("missing"))).status).toBe(404)
    const ok = await GET(read(), params("i1"))
    expect(ok.status).toBe(200)
    expect((await ok.json()).events[0].breadcrumbs).toEqual([{ step: 1 }])
  })
})

describe("PATCH /api/v1/projexa/client-logs/issues/[id]", () => {
  test("a member is refused; an API key needs write scope", async () => {
    await mockAuth({ role: "member" }); await mockService()
    expect((await (await import("./route")).PATCH(patch(FIX), params("i1"))).status).toBe(403)
    await mockAuth({ scopes: ["read"] })
    expect((await (await import("./route")).PATCH(patch(FIX), params("i1"))).status).toBe(403)
    expect(patchIssue).not.toHaveBeenCalled()
  })

  test("'fixed' without fix_summary or fix_files is 400 and names the field", async () => {
    await mockAuth({ role: "admin" }); await mockService()
    const { PATCH } = await import("./route")
    const a = await PATCH(patch({ status: "fixed", fix_files: FIX.fix_files }), params("i1"))
    expect(a.status).toBe(400)
    expect((await a.json()).field).toBe("fix_summary")
    const b = await PATCH(patch({ status: "fixed", fix_summary: "x", fix_files: [] }), params("i1"))
    expect(b.status).toBe(400)
    expect((await b.json()).field).toBe("fix_files")
    expect(patchIssue).not.toHaveBeenCalled()
  })

  test("an API key with write scope writes the fix back; fixed_by defaults to the key's name", async () => {
    await mockAuth({ scopes: ["write"] }); await mockService()
    const { PATCH } = await import("./route")
    const res = await PATCH(patch(FIX), params("i1"))
    expect(res.status).toBe(200)
    expect((await res.json()).issue).toMatchObject({ status: "fixed", fix_commit: "abc123", fixed_by: "projexa-key" })
    expect(patchIssue.mock.calls[0][3]).toMatchObject({ status: "fixed", fix_files: FIX.fix_files })
    expect((await PATCH(patch(FIX), params("missing"))).status).toBe(404)
  })
})