/// <reference types="bun-types" />
// R-C17 (platform.sumeet_requirements, "Platform: Email Engine"). Same
// precedent as vercel-deployment/route.test.ts (real HMAC/crypto, no
// mocking of the signature-verification function itself -- signatures are
// computed by hand with the SAME algorithm resend-svix-signature.ts
// implements, so this file independently proves the route rejects/accepts
// exactly what a real Resend delivery would) plus boq-baseline-service.test.ts's
// "mock.module(...) spreads the real module, only db/resend/the two
// downstream services are faked" convention -- this table and
// analyzeInboundEmail() do not exist/run against a live DB in this
// environment (see drizzle/0598's own header comment), so the DB layer and
// the two downstream service calls are mocked; the signature check and the
// route's own control flow are real.
import { describe, expect, test, mock, beforeEach } from "bun:test"
import { createHmac } from "node:crypto"

process.env.DATABASE_URL ??= "postgresql://postgres:placeholder@localhost:5432/postgres"
process.env.APP_RUNTIME_DATABASE_URL ??= "postgresql://app_runtime:placeholder@localhost:5432/postgres"

import * as realDb from "@/lib/db"

const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"

function sign(id: string, timestamp: string, body: string, secret = SECRET): string {
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64")
  const sig = createHmac("sha256", secretBytes).update(`${id}.${timestamp}.${body}`).digest("base64")
  return `v1,${sig}`
}

function makeRequest(body: string, headers: { svixId?: string | null; svixTimestamp?: string | null; svixSignature?: string | null }): Request {
  const h = new Headers({ "content-type": "application/json" })
  if (headers.svixId) h.set("svix-id", headers.svixId)
  if (headers.svixTimestamp) h.set("svix-timestamp", headers.svixTimestamp)
  if (headers.svixSignature) h.set("svix-signature", headers.svixSignature)
  return new Request("http://localhost/api/webhooks/resend-inbound", { method: "POST", headers: h, body })
}

function signedRequest(body: string): Request {
  const svixId = "msg_test"
  const svixTimestamp = String(Math.floor(Date.now() / 1000))
  const svixSignature = sign(svixId, svixTimestamp, body)
  return makeRequest(body, { svixId, svixTimestamp, svixSignature })
}

// ─── Mock state ─────────────────────────────────────────────────────────
type InboundRow = Record<string, unknown> & { id: string }
let existingMessageRow: InboundRow | null = null
let insertedRows: InboundRow[] = []
let updateCalls: Array<{ values: Record<string, unknown> }> = []
let userLookupResult: { id: string; name: string; email: string } | null = { id: "user-1", name: "Test User", email: "test@example.com" }
let nextId = 1

let receivingGetResult: { data: Record<string, unknown> | null; error: { message: string } | null } = {
  data: { from: "sender@external.com", to: ["raajat.agarwal@veridian-aios.com"], subject: "Real subject", text: "Real body", html: null },
  error: null,
}

let resolveEmailAliasResult: { orgId: string; userId: string; aliasId: string } | null = { orgId: "org-1", userId: "user-1", aliasId: "alias-1" }
let analyzeInboundEmailCalls: Array<{ ctx: unknown; input: unknown }> = []
let analyzeInboundEmailShouldThrow = false

mock.module("@/lib/db", () => ({
  ...realDb,
  db: {
    query: {
      inboundEmailMessages: { findFirst: async () => existingMessageRow },
      users: { findFirst: async () => userLookupResult },
    },
    insert: (_table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => {
          const row = { id: `msg-${nextId++}`, ...values }
          insertedRows.push(row)
          return [row]
        },
      }),
    }),
    update: (_table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updateCalls.push({ values })
          return undefined
        },
      }),
    }),
  },
}))

mock.module("resend", () => ({
  Resend: class {
    emails = { receiving: { get: async (_id: string) => receivingGetResult } }
  },
}))

mock.module("@/lib/services/email-alias-service", () => ({
  resolveEmailAlias: async (_toAddress: string) => resolveEmailAliasResult,
}))

mock.module("@/lib/services/email-intelligence-service", () => ({
  analyzeInboundEmail: async (ctx: unknown, input: unknown) => {
    analyzeInboundEmailCalls.push({ ctx, input })
    if (analyzeInboundEmailShouldThrow) throw new Error("simulated analyzeInboundEmail failure")
    return { id: "item-1" }
  },
}))

const { POST } = await import("./route")

beforeEach(() => {
  existingMessageRow = null
  insertedRows = []
  updateCalls = []
  userLookupResult = { id: "user-1", name: "Test User", email: "test@example.com" }
  receivingGetResult = {
    data: { from: "sender@external.com", to: ["raajat.agarwal@veridian-aios.com"], subject: "Real subject", text: "Real body", html: null },
    error: null,
  }
  resolveEmailAliasResult = { orgId: "org-1", userId: "user-1", aliasId: "alias-1" }
  analyzeInboundEmailCalls = []
  analyzeInboundEmailShouldThrow = false
  process.env.RESEND_WEBHOOK_SECRET = SECRET
  process.env.RESEND_API_KEY = "re_test_placeholder"
})

describe("POST /api/webhooks/resend-inbound -- falsifiability (both directions, required)", () => {
  test("REJECTS (403) a request with a WRONG signature", async () => {
    const body = JSON.stringify({ type: "email.received", data: { email_id: "email_1" } })
    const svixId = "msg_bad"
    const svixTimestamp = String(Math.floor(Date.now() / 1000))
    const wrongSignature = sign(svixId, svixTimestamp, body, "whsec_" + Buffer.from("wrong-secret").toString("base64"))
    const res = await POST(makeRequest(body, { svixId, svixTimestamp, svixSignature: wrongSignature }) as any)
    expect(res.status).toBe(403)
    expect(insertedRows.length).toBe(0)
    expect(analyzeInboundEmailCalls.length).toBe(0)
  })

  test("REJECTS (403) a request with NO signature header at all", async () => {
    const body = JSON.stringify({ type: "email.received", data: { email_id: "email_1" } })
    const res = await POST(makeRequest(body, {}) as any)
    expect(res.status).toBe(403)
    expect(insertedRows.length).toBe(0)
  })

  test("REJECTS (500, fail-closed) when RESEND_WEBHOOK_SECRET is not configured", async () => {
    delete process.env.RESEND_WEBHOOK_SECRET
    const body = JSON.stringify({ type: "email.received", data: { email_id: "email_1" } })
    const res = await POST(makeRequest(body, { svixId: "x", svixTimestamp: "1", svixSignature: "v1,abc" }) as any)
    expect(res.status).toBe(500)
  })

  test("ACCEPTS (200) and PROCESSES a correctly signed delivery", async () => {
    const body = JSON.stringify({
      type: "email.received",
      created_at: new Date().toISOString(),
      data: { email_id: "email_valid_1", from: "sender@external.com", to: ["raajat.agarwal@veridian-aios.com"], subject: "hi" },
    })
    const res = await POST(signedRequest(body) as any)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok: boolean; processed: boolean }
    expect(json.ok).toBe(true)
    expect(json.processed).toBe(true)
  })
})

describe("POST /api/webhooks/resend-inbound -- end-to-end happy path", () => {
  test("records the delivery in inboundEmailMessages and triggers analyzeInboundEmail() with the resolved tenant context", async () => {
    const body = JSON.stringify({
      type: "email.received",
      created_at: "2026-09-13T10:00:00.000Z",
      data: { email_id: "email_e2e_1", from: "webhook-from@external.com", to: ["raajat.agarwal@veridian-aios.com"], subject: "webhook subject" },
    })
    const res = await POST(signedRequest(body) as any)
    expect(res.status).toBe(200)

    // inboundEmailMessages row was written with the resolved org/user and the
    // FULL content fetched via resend.emails.receiving.get() (not just the
    // metadata-only webhook payload).
    expect(insertedRows.length).toBe(1)
    expect(insertedRows[0]).toMatchObject({
      orgId: "org-1",
      userId: "user-1",
      fromAddress: "sender@external.com", // from the mocked receiving.get() full fetch, not the webhook's own "webhook-from@external.com"
      toAddress: "raajat.agarwal@veridian-aios.com",
      subject: "Real subject",
      resendMessageId: "email_e2e_1",
      processingError: null,
    })

    // analyzeInboundEmail() was called exactly once, with the resolved
    // (orgId, userId, dbUser) context and the full fetched subject/body.
    expect(analyzeInboundEmailCalls.length).toBe(1)
    expect(analyzeInboundEmailCalls[0].ctx).toMatchObject({ orgId: "org-1", userId: "user-1" })
    expect((analyzeInboundEmailCalls[0].ctx as { dbUser?: { id: string } }).dbUser?.id).toBe("user-1")
    expect(analyzeInboundEmailCalls[0].input).toMatchObject({ subject: "Real subject", body: "Real body", senderEmail: "sender@external.com" })

    // processedAt was set (via db.update) after analyzeInboundEmail succeeded.
    expect(updateCalls.length).toBe(1)
    expect(updateCalls[0].values).toHaveProperty("processedAt")
  })

  test("an unresolvable recipient is recorded (userId/orgId null) and does NOT call analyzeInboundEmail, but still returns 200", async () => {
    resolveEmailAliasResult = null
    const body = JSON.stringify({
      type: "email.received",
      data: { email_id: "email_unresolved_1", from: "sender@external.com", to: ["nobody@veridian-aios.com"], subject: "misdirected" },
    })
    const res = await POST(signedRequest(body) as any)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok: boolean; processed: boolean }
    expect(json.processed).toBe(false)

    expect(insertedRows.length).toBe(1)
    expect(insertedRows[0].orgId).toBeNull()
    expect(insertedRows[0].userId).toBeNull()
    expect(insertedRows[0].processingError).toContain("No active alias found")
    expect(analyzeInboundEmailCalls.length).toBe(0)
  })

  test("a repeated delivery for an already-recorded resendMessageId is acknowledged without reprocessing (idempotency)", async () => {
    existingMessageRow = { id: "existing-msg-1", resendMessageId: "email_dup_1" }
    const body = JSON.stringify({ type: "email.received", data: { email_id: "email_dup_1", to: ["raajat.agarwal@veridian-aios.com"] } })
    const res = await POST(signedRequest(body) as any)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok: boolean; alreadyProcessed: boolean; id: string }
    expect(json.alreadyProcessed).toBe(true)
    expect(json.id).toBe("existing-msg-1")
    expect(insertedRows.length).toBe(0)
    expect(analyzeInboundEmailCalls.length).toBe(0)
  })

  test("an analyzeInboundEmail() failure is recorded as processingError, not silently swallowed, and still returns 200", async () => {
    analyzeInboundEmailShouldThrow = true
    const body = JSON.stringify({
      type: "email.received",
      data: { email_id: "email_fail_1", from: "sender@external.com", to: ["raajat.agarwal@veridian-aios.com"], subject: "will fail" },
    })
    const res = await POST(signedRequest(body) as any)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok: boolean; processed: boolean; error: string }
    expect(json.processed).toBe(false)
    expect(json.error).toContain("simulated analyzeInboundEmail failure")
    expect(updateCalls.length).toBe(1)
    expect(updateCalls[0].values).toMatchObject({ processingError: expect.stringContaining("simulated analyzeInboundEmail failure") })
  })

  test("an event type other than email.received is acknowledged (200) and ignored", async () => {
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: "email_other_1" } })
    const res = await POST(signedRequest(body) as any)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok: boolean; ignored: boolean }
    expect(json.ignored).toBe(true)
    expect(insertedRows.length).toBe(0)
  })

  test("invalid JSON body (but correctly signed) is rejected with 400", async () => {
    const body = "not json {{{"
    const res = await POST(signedRequest(body) as any)
    expect(res.status).toBe(400)
  })
})
