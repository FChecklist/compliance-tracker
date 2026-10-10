/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { AUDIT_SURFACES, deriveSessionId, isAuditSurface, logActivity } from "./audit"
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

// PROJEXA-BUILD-001 U-32 part A (register rows BR-415, BR-410): logActivity() takes an optional `surface`, stored in
// compliance.audit_logs.surface (drizzle/0619_build001_audit_surface.sql). Same recording stand-in as above: the values
// handed to the insert are the row that would be stored. The same function against real Postgres, with the column and
// its CHECK, is in src/lib/services/audit-surface-migration.pglite.test.ts.
describe("logActivity surface", () => {
  const person = { id: "user_1", name: "Site Manager", role: "manager" } as never
  const key = { id: "key_1", name: "PROJEXA (provisioned)" }
  // The values object logActivity() built before U-32, key for key.
  const PRE_U32_KEYS = [
    "action", "entityType", "entityId", "userId", "actorName", "actorRole", "apiKeyId", "orgId", "clientId", "details",
    "ipAddress", "userAgent", "supportSessionId", "actingOnBehalfOfUserId", "sessionId", "officeId",
  ]

  async function run(params: Record<string, unknown>) {
    const inserted: Record<string, unknown>[] = []
    const tx = {
      insert: () => ({
        values: async (v: Record<string, unknown>) => {
          inserted.push(v)
        },
      }),
    } as unknown as TenantDb
    await logActivity({ tx, action: "boq_line.approved", entityType: "construction_boq_line_item", entityId: "line_1", orgId: "org_1", ...params } as never)
    return inserted
  }

  test("each of the four keys is stored in the surface column", async () => {
    for (const surface of AUDIT_SURFACES) {
      const [row] = await run({ dbUser: person, surface })
      expect(row.surface).toBe(surface)
      expect(Object.keys(row).sort()).toEqual([...PRE_U32_KEYS, "surface"].sort())
    }
  })

  test("the surface sits next to the key-and-person actor unchanged (BR-410's row: surface s1 and a non-null user_id)", async () => {
    const [row] = await run({ dbUser: person, apiKey: key, actingViaApiKey: true, surface: "s1_one_page_ai_prepared" })
    expect(row.surface).toBe("s1_one_page_ai_prepared")
    expect(row.userId).toBe("user_1")
    expect(row.apiKeyId).toBe("key_1")
  })

  test("absent, or null, the values are exactly the pre-U-32 ones: no surface key, so the column is written as NULL", async () => {
    for (const params of [{ dbUser: person }, { apiKey: key }, { dbUser: person, surface: undefined }, { dbUser: person, surface: null }]) {
      const [row] = await run(params)
      expect(Object.keys(row)).toEqual(PRE_U32_KEYS)
      expect("surface" in row).toBe(false)
    }
    // Identical values with and without the field (sessionId is null here: no request).
    const [plain] = await run({ dbUser: person, details: "d", clientId: "c_1", officeId: "b_1" })
    const [withNull] = await run({ dbUser: person, details: "d", clientId: "c_1", officeId: "b_1", surface: null })
    expect(withNull).toEqual(plain)
  })

  test("a value that is not one of the four keys is refused before any write", async () => {
    for (const bad of ["s5_sms", "", "S1_ONE_PAGE_AI_PREPARED", "s1_one_page_ai_prepared ", "s3_ai_link", 1, true, {}]) {
      let inserted: Record<string, unknown>[] | null = null
      let message = ""
      try {
        inserted = await run({ dbUser: person, surface: bad })
      } catch (err) {
        message = (err as Error).message
      }
      expect({ bad, inserted, refused: message.includes("unknown audit surface") }).toEqual({ bad, inserted: null, refused: true })
    }
  })

  test("AUDIT_SURFACES is exactly the key list of the CHECK in drizzle/0619", () => {
    const migration = readFileSync(new URL("../../drizzle/0619_build001_audit_surface.sql", import.meta.url), "utf8")
    const check = /ADD CONSTRAINT audit_logs_surface_check\s+CHECK \(([\s\S]*?)\);/.exec(migration)
    expect(check).not.toBeNull()
    const keys = [...check![1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1])
    expect(keys).toEqual([...AUDIT_SURFACES])
    expect(AUDIT_SURFACES.every((k) => isAuditSurface(k))).toBe(true)
    expect(isAuditSurface("s5_sms")).toBe(false)
    expect(isAuditSurface(null)).toBe(false)
  })
})