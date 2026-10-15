/// <reference types="bun-types" />
// D3 (2026-10-10): the public, tokenized e-sign path used to read the signer through the shared db handle, which only works when the connecting
// role bypasses RLS. Under the app_runtime role (RLS ON) a valid signing link answered 404 ("This signing link is invalid").
//
// This test models that exactly: a fake database whose TABLE reads return nothing unless a tenant context is open (RLS), while the one SECURITY DEFINER
// function esign_resolve_signer(token) works without a context. The service must (1) find the signer through the function, (2) do every other read and
// write inside withTenantContext({ orgId }) of the SIGNER'S org, and (3) never open tenant contexts nested.
// Falsifiability: reverting resolveSignerFromToken to `rawDb.query.esignatureSigners.findFirst(...)` makes "a valid link resolves" fail with 404.
import { beforeEach, describe, expect, mock, test } from "bun:test"

type Row = Record<string, unknown>
const realDb = await import("@/lib/db")
const state = {
  signers: [] as Row[],
  requests: [] as Row[],
  openOrg: null as string | null,
  depth: 0,
  maxDepth: 0,
  rpcInstalled: true,
  contexts: [] as string[],
  lastSignerId: null as string | null,
}

// A table read sees rows only inside a tenant context, and only that tenant's rows (RLS).
function visible(rows: Row[]) {
  return state.openOrg ? rows.filter((r) => r.orgId === state.openOrg) : []
}

const tableQuery = (rows: () => Row[]) => ({
  findFirst: async () => (state.lastSignerId && rows() === state.signers ? visible(rows()).find((r) => r.id === state.lastSignerId) : visible(rows())[0]),
  findMany: async () => visible(rows()),
})

const tx = {
  query: { esignatureSigners: tableQuery(() => state.signers), esignatureRequests: tableQuery(() => state.requests) },
  update: (table: unknown) => ({
    set: (values: Row) => ({
      where: () => {
        const target = table === realDb.esignatureSigners ? state.signers : table === realDb.esignatureRequests ? state.requests : []
        const hit = visible(target)[0]
        if (hit) Object.assign(hit, values)
        const done = Promise.resolve(hit ? [hit] : []) as Promise<Row[]> & { returning: () => Promise<Row[]> }
        done.returning = async () => (hit ? [hit] : [])
        return done
      },
    }),
  }),
}

const rawDb = {
  execute: async () => {
    if (!state.rpcInstalled) throw Object.assign(new Error("function does not exist"), { code: "42883" })
    const s = state.signers.find((x) => x.accessToken === currentToken)
    state.lastSignerId = s ? (s.id as string) : null
    return s ? [{ signer_id: s.id, org_id: s.orgId }] : []
  },
  // The OLD path: a table read with no tenant context. Under RLS this finds nothing.
  query: { esignatureSigners: { findFirst: async () => undefined } },
}
let currentToken = ""

mock.module("@/lib/db", () => ({ ...realDb, db: rawDb }))
mock.module("@/lib/db/tenant-scoped", () => ({
  withTenantContext: async (ctx: { orgId: string }, fn: (t: typeof tx) => Promise<unknown>) => {
    if (state.openOrg) throw new Error("nested withTenantContext")
    state.openOrg = ctx.orgId
    state.contexts.push(ctx.orgId)
    state.depth += 1
    state.maxDepth = Math.max(state.maxDepth, state.depth)
    try {
      return await fn(tx)
    } finally {
      state.openOrg = null
      state.depth -= 1
    }
  },
}))
const realDrizzle = await import("drizzle-orm")
mock.module("drizzle-orm", () => ({
  ...realDrizzle,
  and: (...a: unknown[]) => a, eq: (...a: unknown[]) => a, inArray: (...a: unknown[]) => a,
  sql: (strings: TemplateStringsArray) => strings.join("?"),
}))

const { getSigningSession, declineSignature, resolveSignerFromToken } = await import("./esignature-service")

const future = new Date(Date.now() + 86_400_000)
beforeEach(() => {
  state.openOrg = null; state.depth = 0; state.maxDepth = 0; state.rpcInstalled = true; state.contexts = []; state.lastSignerId = null
  state.signers = [
    { id: "sg1", orgId: "orgA", requestId: "rq1", name: "Asha", status: "pending", signOrder: null, accessToken: "esig_good", tokenExpiresAt: future },
    { id: "sg2", orgId: "orgB", requestId: "rq2", name: "Other", status: "pending", signOrder: null, accessToken: "esig_other", tokenExpiresAt: future },
    { id: "sg3", orgId: "orgA", requestId: "rq1", name: "Old", status: "pending", signOrder: null, accessToken: "esig_old", tokenExpiresAt: new Date(Date.now() - 1000) },
  ]
  state.requests = [
    { id: "rq1", orgId: "orgA", title: "CO-1", status: "pending", linkedEntityType: "document", linkedEntityId: "d1" },
    { id: "rq2", orgId: "orgB", title: "Other CO", status: "pending", linkedEntityType: "document", linkedEntityId: "d2" },
  ]
})

describe("public e-sign token lookup under RLS (D3)", () => {
  test("a valid link resolves even though a plain table read sees nothing", async () => {
    currentToken = "esig_good"
    const { signer, orgId } = await resolveSignerFromToken("esig_good")
    expect(signer.id).toBe("sg1")
    expect(orgId).toBe("orgA")
  })

  test("the signing session is read inside the signer's own tenant context, once, never nested", async () => {
    currentToken = "esig_good"
    const session = await getSigningSession("esig_good")
    expect(session.requestTitle).toBe("CO-1")
    expect(session.signerName).toBe("Asha")
    expect(state.contexts.every((o) => o === "orgA")).toBe(true)
    expect(state.maxDepth).toBe(1)
  })

  test("a token from another org cannot read this org's request", async () => {
    currentToken = "esig_other"
    const session = await getSigningSession("esig_other")
    expect(session.requestTitle).toBe("Other CO")
    expect(state.contexts.every((o) => o === "orgB")).toBe(true)
  })

  test("an unknown token is 404 and an expired token is 410", async () => {
    currentToken = "nope"
    await expect(resolveSignerFromToken("nope")).rejects.toMatchObject({ status: 404 })
    currentToken = "esig_old"
    await expect(resolveSignerFromToken("esig_old")).rejects.toMatchObject({ status: 410 })
  })

  test("a decline is persisted: the signer and request rows are re-read as declined", async () => {
    currentToken = "esig_good"
    await declineSignature("esig_good", "not agreed")
    expect(state.signers.find((s) => s.id === "sg1")?.status).toBe("declined")
    expect(state.requests.find((r) => r.id === "rq1")?.status).toBe("declined")
    expect(state.requests.find((r) => r.id === "rq2")?.status).toBe("pending")
  })

  test("before the migration is applied (function missing) the lookup falls back instead of failing", async () => {
    state.rpcInstalled = false
    currentToken = "esig_good"
    // the fallback uses the raw table read, which under RLS finds nothing: the answer is the honest 404, not a crash
    await expect(resolveSignerFromToken("esig_good")).rejects.toMatchObject({ status: 404 })
  })
})
