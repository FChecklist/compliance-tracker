/// <reference types="bun-types" />
// P6: only an organisation owner/admin can switch PROJEXA's own AI; default OFF; the switch writes the flag.
// Real: the route handler and the real service role check. Faked: the two auth entry points and the DB (an in-memory flag row).
// Falsifiability: change requireRole(acting.user, "admin") to "member" in route.ts and the member/viewer cases fail.
import { beforeEach, describe, expect, mock, test } from "bun:test"
import { NextRequest } from "next/server"

type Person = { id: string; role: string; isActive: boolean }
let acting: Person = { id: "u-admin", role: "admin", isActive: true }
let row: { isEnabled: boolean; enabledById: string | null } | null = null
const writes: Array<{ allowed: boolean; by: string }> = []

const realGuard = await import("@/lib/supabase/auth-guard")
mock.module("@/lib/supabase/auth-guard", () => ({
  ...realGuard,
  requireAuthOrApiKey: async () => ({ orgId: "org-1", dbUser: null, apiKey: { id: "k", name: "k", scopes: ["read", "write"] }, response: null }),
  resolveActingUser: async () => ({ user: acting, error: null }),
}))
mock.module("@/lib/ai/internal-ai-org-allowance-admin", () => ({
  InternalAiAllowanceError: class extends Error { status = 500 },
  getInternalAiAllowance: async () => ({ allowed: row?.isEnabled === true, changedAt: null, changedById: row?.enabledById ?? null }),
  setInternalAiAllowance: async (a: { userId: string; dbUser: { role: string } }, allowed: boolean) => {
    const real = await import("@/lib/supabase/role-rank")
    if (!real.hasRole(a.dbUser, "admin")) throw new Error("service must also refuse")
    row = { isEnabled: allowed, enabledById: a.userId }
    writes.push({ allowed, by: a.userId })
    return { allowed, changedAt: "t", changedById: a.userId }
  },
}))
const { GET, PUT } = await import("./route")

const put = (allowed: unknown) =>
  PUT(new NextRequest("http://x/api/v1/projexa/internal-ai-allowance", { method: "PUT", body: JSON.stringify({ allowed }), headers: { "content-type": "application/json" } }))

beforeEach(() => { acting = { id: "u-admin", role: "admin", isActive: true }; row = null; writes.length = 0 })

describe("internal-ai-allowance route", () => {
  test("default is OFF", async () => {
    const res = await GET(new NextRequest("http://x/api/v1/projexa/internal-ai-allowance"))
    expect((await res.json()).allowed).toBe(false)
  })
  test("an admin switches it on, and a re-read shows it persisted, stamped with who", async () => {
    const res = await put(true)
    expect(res.status).toBe(200)
    const again = await (await GET(new NextRequest("http://x/api/v1/projexa/internal-ai-allowance"))).json()
    expect(again.allowed).toBe(true)
    expect(again.changedById).toBe("u-admin")
  })
  test("an admin switches it back off", async () => {
    await put(true)
    expect((await put(false)).status).toBe(200)
    expect(row?.isEnabled).toBe(false)
  })
  for (const role of ["member", "viewer", "manager"]) {
    test(`${role} is refused and nothing is written`, async () => {
      acting = { id: "u-x", role, isActive: true }
      const res = await put(true)
      expect(res.status).toBe(403)
      expect(writes).toHaveLength(0)
    })
  }
  test("a non-boolean body is refused", async () => {
    expect((await put("yes")).status).toBe(400)
    expect(writes).toHaveLength(0)
  })
})
