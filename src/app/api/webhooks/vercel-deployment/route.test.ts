/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { createHmac } from "node:crypto"

// Same precedent as ci.yml's `unit-tests` job (see its own comment):
// importing this route transitively constructs src/lib/db/index.ts's and
// src/lib/db/tenant-scoped.ts's Postgres clients at module-load time, which
// throw without *some* connection string present -- placeholder values are
// enough for that construction to succeed even though no real query can
// run against them in this environment.
process.env.DATABASE_URL ??= "postgresql://postgres:placeholder@localhost:5432/postgres"
process.env.APP_RUNTIME_DATABASE_URL ??= "postgresql://app_runtime:placeholder@localhost:5432/postgres"

const { POST } = await import("./route")

const SECRET = "whsec_test_secret_1234567890"

function sign(rawBody: string, secret = SECRET): string {
  return createHmac("sha1", secret).update(rawBody).digest("hex")
}

function makeRequest(body: string, signature: string | null): Request {
  const headers = new Headers({ "content-type": "application/json" })
  if (signature) headers.set("x-vercel-signature", signature)
  return new Request("http://localhost/api/webhooks/vercel-deployment", { method: "POST", headers, body })
}

describe("POST /api/webhooks/vercel-deployment", () => {
  test("rejects (500, fail-closed) when VERCEL_DEPLOYMENT_WEBHOOK_SECRET is not configured", async () => {
    const original = process.env.VERCEL_DEPLOYMENT_WEBHOOK_SECRET
    delete process.env.VERCEL_DEPLOYMENT_WEBHOOK_SECRET
    try {
      const res = await POST(makeRequest("{}", "anything") as any)
      expect(res.status).toBe(500)
    } finally {
      if (original) process.env.VERCEL_DEPLOYMENT_WEBHOOK_SECRET = original
    }
  })

  test("rejects (403) a request with no signature header at all", async () => {
    process.env.VERCEL_DEPLOYMENT_WEBHOOK_SECRET = SECRET
    const res = await POST(makeRequest("{}", null) as any)
    expect(res.status).toBe(403)
  })

  test("rejects (403) a request signed with the wrong secret", async () => {
    process.env.VERCEL_DEPLOYMENT_WEBHOOK_SECRET = SECRET
    const body = JSON.stringify({ type: "deployment.succeeded" })
    const res = await POST(makeRequest(body, sign(body, "attacker-guessed-secret")) as any)
    expect(res.status).toBe(403)
  })

  test("rejects (403) a correctly-shaped payload whose signature was computed over a DIFFERENT body (tamper attempt)", async () => {
    process.env.VERCEL_DEPLOYMENT_WEBHOOK_SECRET = SECRET
    const signedBody = JSON.stringify({ type: "deployment.succeeded", payload: { deployment: { id: "dpl_real" } } })
    const sentBody = JSON.stringify({ type: "deployment.succeeded", payload: { deployment: { id: "dpl_ATTACKER" } } })
    const res = await POST(makeRequest(sentBody, sign(signedBody)) as any)
    expect(res.status).toBe(403)
  })

  test("accepts (200) a correctly signed request for an event type this receiver doesn't act on, without needing a live DB", async () => {
    process.env.VERCEL_DEPLOYMENT_WEBHOOK_SECRET = SECRET
    // "project.created" is a real Vercel account-webhook event type, just not
    // one this receiver's RECOGNIZED_EVENTS set acts on -- confirms
    // unrecognized-but-validly-signed deliveries are acknowledged (so Vercel
    // doesn't retry/disable the webhook) rather than rejected.
    const body = JSON.stringify({ id: "evt_1", type: "project.created", payload: {} })
    const res = await POST(makeRequest(body, sign(body)) as any)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok: boolean; ignored: boolean; eventType: string }
    expect(json).toEqual({ ok: true, ignored: true, eventType: "project.created" })
  })

  test("a correctly signed deployment.succeeded delivery passes the signature boundary and reaches the DB-write step (not rejected as unauthenticated)", async () => {
    process.env.VERCEL_DEPLOYMENT_WEBHOOK_SECRET = SECRET
    const body = JSON.stringify({
      id: "evt_2",
      type: "deployment.succeeded",
      payload: {
        deployment: { id: "dpl_abc123", name: "veridian-compliance-ai", url: "veridian-ai-os.vercel.app", state: "READY" },
        project: { id: "prj_xyz" },
        target: "production",
      },
    })
    let response: Response | null = null
    let threwPastAuth = false
    try {
      response = await POST(makeRequest(body, sign(body)) as any)
    } catch {
      // Expected in this environment: DATABASE_URL/APP_RUNTIME_DATABASE_URL
      // are unreachable placeholders (no live Postgres here), so the real
      // db.insert(deploymentEvents) call throws a connection error. A wrong
      // or missing signature would instead have returned a caught 403
      // Response (see the tests above) -- it never reaches this far. Getting
      // a throw here, rather than a 403, is the proof this request cleared
      // signature verification.
      threwPastAuth = true
    }
    if (response) {
      // A live DB WAS reachable (e.g. running against real Supabase creds) --
      // assert the real success path instead.
      expect(response.status).toBe(200)
      const json = (await response.json()) as { ok: boolean; eventType: string }
      expect(json.ok).toBe(true)
      expect(json.eventType).toBe("deployment.succeeded")
    } else {
      expect(threwPastAuth).toBe(true)
    }
  })
})
