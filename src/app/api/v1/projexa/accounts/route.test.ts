/// <reference types="bun-types" />
// Role-check regression test for API_READ_WITHOUT_ROLE_CHECK (R58 Lane 2,
// 2026-08-27): GET /api/v1/projexa/accounts previously had zero role floor
// -- any authenticated rank-1 role (viewer/client_viewer/external_auditor/
// stage_0, see ROLE_RANK in auth-guard.ts) could read the full chart of
// accounts. Exercises the REAL requireRoleOrScope()/hasRole() primitives
// from auth-guard.ts (not mocked) -- matching this codebase's own
// established pattern of testing role gates directly against the live
// ROLE_RANK enum (see permission-service.test.ts, studied before writing
// this file) -- only requireAuthOrApiKey is mocked, to control the
// session's dbUser role without touching the database.
import { describe, test, expect, mock, setDefaultTimeout } from "bun:test"
import { NextRequest } from "next/server"
import type { users } from "@/lib/db"
import type { UserRole } from "@/lib/supabase/auth-guard"

// erp-accounting-service.ts is a large module (journal entries, currencies,
// exchange rates, tax withholding, etc. all in one file) -- the first
// dynamic import() of ./route in this file pulls it in cold and can exceed
// bun's 5000ms default test timeout on a slow disk/CPU. Bump it for this
// file only, same as the module's own compile cost, not the fix under test.
setDefaultTimeout(20000)

type DbUser = typeof users.$inferSelect

function userWithRole(role: UserRole): DbUser {
  return { role } as unknown as DbUser
}

async function mockAuth(role: UserRole) {
  const actual = await import("@/lib/supabase/auth-guard")
  mock.module("@/lib/supabase/auth-guard", () => ({
    ...actual,
    requireAuthOrApiKey: mock(async () => ({
      orgId: "org-1",
      dbUser: userWithRole(role),
      apiKey: null,
      response: null,
    })),
  }))
}

async function mockAccounts(accounts: unknown[]) {
  const listAccounts = mock(async () => accounts)
  const actual = await import("@/lib/services/erp-accounting-service")
  mock.module("@/lib/services/erp-accounting-service", () => ({ ...actual, listAccounts }))
  return listAccounts
}

function getRequest() {
  return new NextRequest("http://localhost/api/v1/projexa/accounts", {
    headers: { authorization: "Bearer vk_test" },
  })
}

const sampleAccount = {
  id: "a1", accountName: "Cash", accountNumber: "1000", rootType: "asset",
  accountType: "Cash", parentAccountId: null, isGroup: false,
}

describe("GET /api/v1/projexa/accounts -- role gate (API_READ_WITHOUT_ROLE_CHECK)", () => {
  test("a rank-1 role (external_auditor) is blocked with 403 before listAccounts runs", async () => {
    await mockAuth("external_auditor")
    const listAccounts = await mockAccounts([sampleAccount])

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(403)
    expect(listAccounts).not.toHaveBeenCalled()
  })

  test("another rank-1 role (client_viewer) is also blocked with 403", async () => {
    await mockAuth("client_viewer")
    const listAccounts = await mockAccounts([sampleAccount])

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(403)
    expect(listAccounts).not.toHaveBeenCalled()
  })

  test("member -- the chosen floor -- is allowed through and reaches listAccounts", async () => {
    await mockAuth("member")
    const listAccounts = await mockAccounts([sampleAccount])

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(200)
    expect(listAccounts).toHaveBeenCalledWith({ orgId: "org-1" })
    expect(await res.json()).toEqual({ accounts: [sampleAccount] })
  })

  test("a role above the floor (manager) is also allowed through", async () => {
    await mockAuth("manager")
    const listAccounts = await mockAccounts([sampleAccount])

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(200)
    expect(listAccounts).toHaveBeenCalled()
  })
})
