/// <reference types="bun-types" />
// DOD-C8 fix (2026-09-10, PM priority 1, "the worst thing on the list"):
// recordAttempt()'s two fire-and-forget writes previously had ZERO
// logging on failure -- the passcodeLoginAttempts insert had no rejection
// handler at all (a genuine unhandled-rejection risk, not just a swallowed
// catch), and the recordAuthFailureAndCheckAnomaly call silently dropped a
// failure to feed the same repeated-failed-auth monitor PR #1632 already
// hardened at the API-route layer -- this is the identical vulnerability
// class one layer down, at the service. Neither write's fire-and-forget
// nature (never block the login response) is changed; both now log a
// structured warning on failure. This test proves that, by mocking the two
// dependencies directly (this file's own header comment documents there is
// no test-DB harness in this repo for the DB-touching functions -- direct
// module mocking is the same shape already used by this repo's route.test.ts
// files).
import { describe, expect, test, mock, beforeEach } from "bun:test"

let insertResult: "resolve" | "reject" = "resolve"
let anomalyResult: "resolve" | "reject" = "resolve"
let warnCalls: Array<{ message: string; context: Record<string, unknown> | undefined }>
let anomalyCallArgs: Record<string, unknown> | null

mock.module("@/lib/logger", () => ({
  logger: {
    warn: (message: string, context?: Record<string, unknown>) => {
      warnCalls.push({ message, context })
    },
    error: () => {},
    info: () => {},
    debug: () => {},
  },
}))

mock.module("@/lib/db", () => ({
  db: {
    insert: () => ({
      values: async () => {
        if (insertResult === "reject") throw new Error("simulated passcodeLoginAttempts insert failure")
        return undefined
      },
    }),
  },
  users: {},
  passcodeLoginAttempts: {},
}))

mock.module("./services/auth-failure-service", () => ({
  recordAuthFailureAndCheckAnomaly: async (args: Record<string, unknown>) => {
    anomalyCallArgs = args
    if (anomalyResult === "reject") throw new Error("simulated anomaly-check failure")
  },
}))

beforeEach(() => {
  insertResult = "resolve"
  anomalyResult = "resolve"
  warnCalls = []
  anomalyCallArgs = null
})

// Fire-and-forget writes race the test's own event-loop turn: give the
// microtask queue a tick to let the un-awaited .then/.catch handlers run
// before asserting on warnCalls.
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 10))
}

describe("recordAttempt -- DOD-C8 fail-open-but-loud (service layer)", () => {
  test("insert succeeds, attempt successful: no warning, anomaly checker never called", async () => {
    const { recordAttempt } = await import("./passcode-login-service")
    await recordAttempt("user@example.com", "203.0.113.5", true)
    await flush()

    expect(warnCalls).toHaveLength(0)
    expect(anomalyCallArgs).toBeNull()
  });

  test("insert succeeds, attempt failed: anomaly checker IS called with the real args, no warning (nothing failed)", async () => {
    const { recordAttempt } = await import("./passcode-login-service")
    await recordAttempt("user@example.com", "203.0.113.5", false)
    await flush()

    expect(warnCalls).toHaveLength(0)
    expect(anomalyCallArgs).toEqual({ email: "user@example.com", method: "passcode", ipAddress: "203.0.113.5" })
  });

  test("passcodeLoginAttempts insert fails: a structured warning is logged naming the reason -- this is the bare-.then()-with-no-handler fix", async () => {
    insertResult = "reject"
    const { recordAttempt } = await import("./passcode-login-service")
    await recordAttempt("user@example.com", "203.0.113.5", true)
    await flush()

    expect(warnCalls).toHaveLength(1)
    expect(warnCalls[0].context?.reason).toBe("insert_failed")
    expect(String(warnCalls[0].context?.errorMessage)).toContain("simulated passcodeLoginAttempts insert failure")
  });

  test("recordAuthFailureAndCheckAnomaly fails on a failed attempt: a structured warning is logged naming the reason -- this is the defeated-monitor fix", async () => {
    anomalyResult = "reject"
    const { recordAttempt } = await import("./passcode-login-service")
    await recordAttempt("user@example.com", "203.0.113.5", false)
    await flush()

    const anomalyWarnings = warnCalls.filter((w) => w.context?.reason === "anomaly_check_failed")
    expect(anomalyWarnings).toHaveLength(1)
    expect(String(anomalyWarnings[0].context?.errorMessage)).toContain("simulated anomaly-check failure")
  });

  test("both writes fail: both structured warnings are logged, independently", async () => {
    insertResult = "reject"
    anomalyResult = "reject"
    const { recordAttempt } = await import("./passcode-login-service")
    await recordAttempt("user@example.com", "203.0.113.5", false)
    await flush()

    expect(warnCalls.map((w) => w.context?.reason).sort()).toEqual(["anomaly_check_failed", "insert_failed"])
  });
});
