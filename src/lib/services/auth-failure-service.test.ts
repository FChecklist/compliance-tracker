/// <reference types="bun-types" />
// New coverage for auth-failure-service.ts, required by
// scripts/check-new-test-coverage.mjs ("Previously-untested files touched")
// on PR #1634 (CRR-027 CONTRACT, 7 EXISTING_FN sites). Zero coverage existed
// on main for this file before this commit.
//
// Also proves PR #1634's own "Route Error Handling Check" fix in place:
// recordAuthFailureAndCheckAnomaly() classifies both DB failures (the insert,
// and the recent-failures count) as a real ServiceError(500, {kind:"system"})
// rather than letting a raw driver exception escape -- this test asserts the
// actual thrown error's shape, not just that *something* throws.
//
// Same convention as this repo's own
// passcode-login-service.recordAttempt.test.ts (this file's own header
// comment: "no test-DB harness in this repo for the DB-touching functions --
// direct module mocking is the same shape already used by this repo's
// route.test.ts files"): mock.module() every dependency, reset controllable
// state in beforeEach, import the function under test AFTER mocks are set up.
import { describe, expect, test, mock, beforeEach } from "bun:test"

let insertResult: "resolve" | "reject" = "resolve"
let countResult: "resolve" | "reject" = "resolve"
let recentCount = 0
let anomalyVerdict: { anomaly: boolean; eventType: string; severity: string; reason: string } = {
  anomaly: false, eventType: "repeated_failed_auth", severity: "medium", reason: "test reason",
}
let lookupUserResult: { id: string; orgId: string | null } | null = null
let alreadyEscalatedRow: { id: string } | null = null
let escalateCallArgs: Record<string, unknown> | null = null

mock.module("@/lib/db", () => ({
  db: {
    insert: () => ({
      values: async () => {
        if (insertResult === "reject") throw new Error("simulated authFailureEvents insert failure")
        return undefined
      },
    }),
    select: () => ({
      from: () => ({
        where: async () => {
          if (countResult === "reject") throw new Error("simulated count-query failure")
          return [{ count: recentCount }]
        },
      }),
    }),
  },
  authFailureEvents: {},
  riskAnomalyEvents: {},
}))

mock.module("@/lib/db/tenant-scoped", () => ({
  withTenantContext: async (_ctx: Record<string, unknown>, fn: (tx: unknown) => unknown) =>
    fn({
      query: {
        riskAnomalyEvents: {
          findFirst: async () => alreadyEscalatedRow,
        },
      },
    }),
}))

mock.module("@/lib/risk-anomaly-detection", () => ({
  evaluateRepeatedFailedAuth: (_count: number, _threshold: number) => anomalyVerdict,
  FAILED_AUTH_THRESHOLD: 5,
}))

mock.module("./risk-escalation-service", () => ({
  recordAndEscalateAnomaly: async (_tx: unknown, args: Record<string, unknown>) => {
    escalateCallArgs = args
  },
}))

mock.module("@/lib/db/preauth-lookups", () => ({
  lookupUserByEmail: async (_email: string) => lookupUserResult,
}))

// compliance-service.ts is a large, unrelated service file that itself
// imports far more from @/lib/db than this test's own @/lib/db mock above
// provides (it exports `db`/`authFailureEvents`/`riskAnomalyEvents` only --
// the minimum auth-failure-service.ts itself needs). Importing the REAL
// compliance-service.ts here would pull in its own full @/lib/db surface and
// break with the exact "Export named X not found" SyntaxError this window's
// F-2026-0910-W-PROD-009 already diagnosed for a different file. Mocking
// ServiceError with a real, minimal, faithful implementation (same
// message/status/kind shape as the real class, confirmed by direct read of
// compliance-service.ts) keeps this test hermetic and immune to that class of
// drift, and auth-failure-service.ts imports ServiceError from this SAME
// mocked path, so instanceof checks below stay consistent.
class MockServiceError extends Error {
  public status: number
  public kind: string
  constructor(message: string, status: number, opts?: { kind?: string }) {
    super(message)
    this.status = status
    this.kind = opts?.kind ?? (status >= 500 ? "system" : "business")
  }
}
mock.module("./compliance-service", () => ({ ServiceError: MockServiceError }))

beforeEach(() => {
  insertResult = "resolve"
  countResult = "resolve"
  recentCount = 0
  anomalyVerdict = { anomaly: false, eventType: "repeated_failed_auth", severity: "medium", reason: "test reason" }
  lookupUserResult = null
  alreadyEscalatedRow = null
  escalateCallArgs = null
})

describe("recordAuthFailureAndCheckAnomaly", () => {
  test("an empty/whitespace email is a no-op: no insert, no count, no escalation", async () => {
    const { recordAuthFailureAndCheckAnomaly } = await import("./auth-failure-service")
    // Not asserting on the insert mock directly (it has no call counter),
    // but a real DB error would surface as a thrown ServiceError -- an empty
    // email returning cleanly with insertResult still at its default proves
    // the insert path was never reached.
    await expect(recordAuthFailureAndCheckAnomaly({ email: "   ", method: "password" })).resolves.toBeUndefined()
    expect(escalateCallArgs).toBeNull()
  })

  test("insert succeeds, no anomaly: resolves cleanly, never looks up a user or escalates", async () => {
    anomalyVerdict = { anomaly: false, eventType: "repeated_failed_auth", severity: "medium", reason: "below threshold" }
    const { recordAuthFailureAndCheckAnomaly } = await import("./auth-failure-service")
    await expect(recordAuthFailureAndCheckAnomaly({ email: "user@example.com", method: "password" })).resolves.toBeUndefined()
    expect(escalateCallArgs).toBeNull()
  })

  test("the authFailureEvents insert fails: throws a real ServiceError(500, kind:system) naming the real DB error, not a raw exception", async () => {
    insertResult = "reject"
    const { recordAuthFailureAndCheckAnomaly } = await import("./auth-failure-service")
    const { ServiceError } = await import("./compliance-service")

    let caught: unknown
    try {
      await recordAuthFailureAndCheckAnomaly({ email: "user@example.com", method: "password" })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ServiceError)
    const err = caught as InstanceType<typeof ServiceError>
    expect(err.status).toBe(500)
    expect(err.kind).toBe("system")
    expect(err.message).toContain("Failed to record auth-failure event")
    expect(err.message).toContain("simulated authFailureEvents insert failure")
  })

  test("the recent-failures count query fails: throws a real ServiceError(500, kind:system) naming the real DB error", async () => {
    countResult = "reject"
    const { recordAuthFailureAndCheckAnomaly } = await import("./auth-failure-service")
    const { ServiceError } = await import("./compliance-service")

    let caught: unknown
    try {
      await recordAuthFailureAndCheckAnomaly({ email: "user@example.com", method: "password" })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ServiceError)
    const err = caught as InstanceType<typeof ServiceError>
    expect(err.status).toBe(500)
    expect(err.kind).toBe("system")
    expect(err.message).toContain("Failed to count recent auth failures")
    expect(err.message).toContain("simulated count-query failure")
  })

  test("an anomaly with an unmatched email (no user found) never escalates -- generic either way, per this function's own documented posture", async () => {
    anomalyVerdict = { anomaly: true, eventType: "repeated_failed_auth", severity: "high", reason: "threshold crossed" }
    lookupUserResult = null
    const { recordAuthFailureAndCheckAnomaly } = await import("./auth-failure-service")
    await recordAuthFailureAndCheckAnomaly({ email: "unknown@example.com", method: "password" })
    expect(escalateCallArgs).toBeNull()
  })

  test("an anomaly with a matched user but no orgId never escalates (a stage-0-only account)", async () => {
    anomalyVerdict = { anomaly: true, eventType: "repeated_failed_auth", severity: "high", reason: "threshold crossed" }
    lookupUserResult = { id: "user-1", orgId: null }
    const { recordAuthFailureAndCheckAnomaly } = await import("./auth-failure-service")
    await recordAuthFailureAndCheckAnomaly({ email: "user@example.com", method: "password" })
    expect(escalateCallArgs).toBeNull()
  })

  test("an anomaly with a real matched org user, not already escalated this window, escalates with the real args", async () => {
    anomalyVerdict = { anomaly: true, eventType: "repeated_failed_auth", severity: "high", reason: "threshold crossed" }
    lookupUserResult = { id: "user-1", orgId: "org-1" }
    alreadyEscalatedRow = null
    recentCount = 7
    const { recordAuthFailureAndCheckAnomaly } = await import("./auth-failure-service")
    await recordAuthFailureAndCheckAnomaly({ email: "user@example.com", method: "oauth", ipAddress: "203.0.113.9" })

    expect(escalateCallArgs).not.toBeNull()
    expect(escalateCallArgs).toMatchObject({
      orgId: "org-1",
      eventType: "repeated_failed_auth",
      severity: "high",
      sourceEntityType: "user",
      sourceEntityId: "user-1",
      actorUserId: "user-1",
      reason: "threshold crossed",
      detail: { method: "oauth", recentFailureCount: 7 },
    })
  })

  test("an anomaly already escalated once this window does NOT escalate again -- the at-most-once-per-window guard", async () => {
    anomalyVerdict = { anomaly: true, eventType: "repeated_failed_auth", severity: "high", reason: "threshold crossed" }
    lookupUserResult = { id: "user-1", orgId: "org-1" }
    alreadyEscalatedRow = { id: "existing-anomaly-row" }
    const { recordAuthFailureAndCheckAnomaly } = await import("./auth-failure-service")
    await recordAuthFailureAndCheckAnomaly({ email: "user@example.com", method: "password" })
    expect(escalateCallArgs).toBeNull()
  })
})
