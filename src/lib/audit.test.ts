/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { deriveSessionId, logActivity } from "./audit"
import type { TenantDb } from "@/lib/db/tenant-scoped"

// VERIDIAN Review Framework: Audit & Governance / Complete Audit Stamp
// (Medium finding, task-20260718-075006) -- covers deriveSessionId, the
// piece of logActivity() that populates the new sessionId column. Only
// this pure function is unit-tested here (not logActivity() itself, which
// needs a real DB tx); see audit.ts's own comment for the full design
// rationale.
describe("deriveSessionId", () => {
  test("returns null when no request is passed (e.g. src/lib/monitors/* background/cron writes)", () => {
    expect(deriveSessionId(undefined)).toBeNull()
  })

  test("returns null when the request has no Cookie header (e.g. an API-key-driven write)", () => {
    const request = new Request("https://example.com/api/x")
    expect(deriveSessionId(request)).toBeNull()
  })

  test("returns a stable SHA-256 hex digest of the Cookie header, never the raw cookie value", () => {
    const request = new Request("https://example.com/api/x", {
      headers: { cookie: "sb-abc-auth-token=some-real-session-blob" },
    })
    const sessionId = deriveSessionId(request)
    expect(sessionId).not.toBeNull()
    expect(sessionId).not.toContain("some-real-session-blob")
    expect(sessionId).toMatch(/^[0-9a-f]{64}$/)
  })

  test("is deterministic -- two requests with the same Cookie header derive the same sessionId", () => {
    const cookie = "sb-abc-auth-token=same-session-across-two-requests"
    const first = new Request("https://example.com/api/a", { headers: { cookie } })
    const second = new Request("https://example.com/api/b", { headers: { cookie } })
    expect(deriveSessionId(first)).toBe(deriveSessionId(second))
  })

  test("two requests carrying different session cookies derive different sessionIds", () => {
    const requestA = new Request("https://example.com/api/x", { headers: { cookie: "sb-abc-auth-token=session-a" } })
    const requestB = new Request("https://example.com/api/x", { headers: { cookie: "sb-abc-auth-token=session-b" } })
    expect(deriveSessionId(requestA)).not.toBe(deriveSessionId(requestB))
  })
})

// PROJEXA-BUILD-001 U-20 (2026-09-25, register row BR-214): logActivity() has to be able to record an API key
// AND the person it acted for in ONE row. Before U-20 the union allowed exactly one of dbUser / apiKey, so a
// key-driven write whose acting person was resolved lost the key id, and 267 of 267 key-attributed audit rows ever
// written carried no person. logActivity() is tested through a recording stand-in for the transaction: the values it
// hands to the insert are the row that would be stored, so this asserts what is persisted, not a return value.
describe("logActivity actor columns", () => {
  const person = { id: "user_1", name: "Site Manager", role: "manager" } as never
  const key = { id: "key_1", name: "PROJEXA (provisioned)" }

  async function stored(params: Record<string, unknown>) {
    let row: Record<string, unknown> | null = null
    const tx = {
      insert: () => ({
        values: async (v: Record<string, unknown>) => {
          row = v
        },
      }),
    } as unknown as TenantDb
    await logActivity({ tx, action: "x.created", entityType: "x", entityId: "1", orgId: "org_1", ...params } as never)
    return row as unknown as Record<string, unknown>
  }

  test("a session user is recorded as a person with no key id (unchanged)", async () => {
    const r = await stored({ dbUser: person })
    expect(r.userId).toBe("user_1")
    expect(r.actorRole).toBe("manager")
    expect(r.apiKeyId).toBeNull()
  })

  test("an API key with no person is recorded as the key alone (unchanged)", async () => {
    const r = await stored({ apiKey: key })
    expect(r.userId).toBeNull()
    expect(r.actorRole).toBe("api_key")
    expect(r.apiKeyId).toBe("key_1")
    expect(r.actorName).toBe("API Key: PROJEXA (provisioned)")
  })

  test("an API key acting for a resolved person records BOTH in one row", async () => {
    const r = await stored({ dbUser: person, apiKey: key, actingViaApiKey: true })
    expect(r.userId).toBe("user_1")
    expect(r.apiKeyId).toBe("key_1")
    expect(r.actorName).toBe("Site Manager")
    expect(r.actorRole).toBe("manager")
  })

  test("the amended D-09 predicate: a key-and-person row is not a key-only row", async () => {
    const both = await stored({ dbUser: person, apiKey: key, actingViaApiKey: true })
    const keyOnly = await stored({ apiKey: key })
    const isKeyOnly = (row: Record<string, unknown>) => (row.apiKeyId !== null || row.actorRole === "api_key") && row.userId === null
    expect(isKeyOnly(both)).toBe(false)
    expect(isKeyOnly(keyOnly)).toBe(true)
  })
})