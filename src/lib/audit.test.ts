/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { deriveSessionId } from "./audit"

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
