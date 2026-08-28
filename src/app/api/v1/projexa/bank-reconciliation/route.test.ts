/// <reference types="bun-types" />
// R58 Lane 2 (API_READ_WITHOUT_ROLE_CHECK): GET /api/v1/projexa/bank-reconciliation
// had no role floor at all -- any rank-1 role (viewer/client_viewer/
// external_auditor/stage_0, see ROLE_RANK in auth-guard.ts) could read real
// bank-statement-line amounts (debitAmount/creditAmount per transaction, via
// listLines) with only requireAuthOrApiKey (authentication, not
// authorization) standing in the way. Fixed with the exact
// requireRoleOrScope(ctx, "member", "read") pattern already used by 10+
// sibling /api/v1/projexa/** GET routes -- this route was simply missed from
// the sibling fix in #1399 (employees/vendors/dashboard).
//
// Exercises the REAL requireRoleOrScope()/hasRole() rank comparison from
// auth-guard.ts (mocking only requireAuthOrApiKey, the session/API-key
// authentication boundary, and the DB-backed service module) -- matching
// permission-service.test.ts's own established pattern of testing role
// gates against the live ROLE_RANK enum, not a reimplementation of it.
import { describe, test, expect, mock, setDefaultTimeout } from "bun:test"
import { NextRequest } from "next/server"
import type { users } from "@/lib/db"
import type { UserRole } from "@/lib/supabase/auth-guard"

setDefaultTimeout(20000)

type DbUser = typeof users.$inferSelect

async function mockAuth(role: UserRole | null) {
  const actual = await import("@/lib/supabase/auth-guard")
  mock.module("@/lib/supabase/auth-guard", () => ({
    ...actual,
    requireAuthOrApiKey: mock(async () => ({
      orgId: role ? "org-1" : null,
      dbUser: role ? ({ role } as unknown as DbUser) : null,
      apiKey: null,
      response: null,
    })),
  }))
}

function mockService() {
  mock.module("@/lib/services/erp-bank-reconciliation-service", () => ({
    listImports: mock(async () => [{ id: "imp-1", fileName: "aug-statement.csv", totalLines: 2 }]),
    listLines: mock(async () => [
      { id: "line-1", debitAmount: "0.00", creditAmount: "50000.00", description: "Client payment" },
    ]),
    ServiceError: class ServiceError extends Error {
      status: number
      constructor(message: string, status = 400) {
        super(message)
        this.status = status
      }
    },
  }))
}

function getRequest(query = "") {
  return new NextRequest(`http://localhost/api/v1/projexa/bank-reconciliation${query}`)
}

describe("GET /api/v1/projexa/bank-reconciliation -- role gate", () => {
  test("a rank-1 role (external_auditor) is blocked with 403 on statement lines, real amounts are never returned", async () => {
    mockService()
    await mockAuth("external_auditor")

    const { GET } = await import("./route")
    const res = await GET(getRequest("?importId=imp-1") as any)

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.lines).toBeUndefined()
  })

  test("a rank-1 role (client_viewer) is blocked with 403 on the imports list too", async () => {
    mockService()
    await mockAuth("client_viewer")

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.imports).toBeUndefined()
  })

  test("member (the chosen floor) succeeds and gets real bank-line amounts back", async () => {
    mockService()
    await mockAuth("member")

    const { GET } = await import("./route")
    const res = await GET(getRequest("?importId=imp-1") as any)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.lines).toEqual([
      { id: "line-1", debitAmount: "0.00", creditAmount: "50000.00", description: "Client payment" },
    ])
  })

  test("a role above the floor (manager) also succeeds on the imports list", async () => {
    mockService()
    await mockAuth("manager")

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.imports).toEqual([{ id: "imp-1", fileName: "aug-statement.csv", totalLines: 2 }])
  })
})
