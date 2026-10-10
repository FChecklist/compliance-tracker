/// <reference types="bun-types" />
import { describe, test, expect, mock } from "bun:test"

class ServiceError extends Error {
  status: number
  constructor(m: string, s: number) {
    super(m)
    this.status = s
  }
}

type Acct = { id: string; accountName: string; accountNumber: null; accountType: string | null; isGroup: boolean }
const acct = (id: string, accountName: string, accountType: string | null, isGroup = false): Acct => ({ id, accountName, accountNumber: null, accountType, isGroup })

function setup(existing: Acct[]) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuthOrApiKey: mock(async () => ({ orgId: "org-1", dbUser: { id: "u" }, apiKey: null, response: null })),
    requireRoleOrScope: mock(() => null),
    requireOrg: mock(() => null),
    requireActingPerson: mock(async () => ({ acting: { person: { id: "u" } }, error: null })),
  }))
  const createAccount = mock(async (_c: unknown, i: { accountName: string }) => ({ id: "new-" + i.accountName, accountName: i.accountName, accountNumber: null }))
  mock.module("@/lib/services/erp-accounting-service", () => ({ listAccounts: mock(async () => existing), createAccount, ServiceError }))
  return createAccount
}

describe("tax accounts for the tax-template form", () => {
  test("GET lists only non-group accounts of type tax", async () => {
    setup([acct("1", "CGST", "tax"), acct("2", "Cash", "cash"), acct("3", "Taxes", "tax", true)])
    const { GET } = await import("./route")
    const body = await (await GET({} as any)).json()
    expect(body.taxAccounts.map((a: { id: string }) => a.id)).toEqual(["1"])
  })
  test("POST seeds only the missing GST accounts (idempotent)", async () => {
    const createAccount = setup([acct("1", "CGST", "tax")])
    const { POST } = await import("./route")
    const res = await POST({} as any)
    expect(res.status).toBe(201)
    expect(createAccount.mock.calls.map((c) => (c as any)[1].accountName)).toEqual(["SGST", "IGST"])
    expect((createAccount.mock.calls[0] as any)[1]).toMatchObject({ rootType: "liability", accountType: "tax" })
  })
  test("POST creates nothing when all three exist", async () => {
    const createAccount = setup([acct("1", "CGST", "tax"), acct("2", "SGST", "tax"), acct("3", "IGST", "tax")])
    const { POST } = await import("./route")
    const res = await POST({} as any)
    expect(res.status).toBe(200)
    expect(createAccount).not.toHaveBeenCalled()
  })
})
