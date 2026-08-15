/// <reference types="bun-types" />
// V2-10 (Super Boss v2 plan, CSV row #10 "Monitoring (SENTRY_DSN)"), 2026-07-20.
//
// Asserts the two halves of the plan's done criteria for the Sentry DSN
// startup check:
//   - the warning FIRES when SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN is unset, and
//   - the warning is SILENT (no call) when both are set.
//
// The check is pure (env + logger injected), so no @sentry/nextjs or db
// import is needed and no mock.module() wiring is required -- a plain
// warn spy + save/restore of the two env vars is enough, matching the
// pattern src/lib/orchestra-model-resolver.test.ts uses for env vars.
import { describe, test, expect, mock, afterEach } from "bun:test"
import { checkSentryDsnEnv, warnIfSentryDsnMissing } from "./sentry-dsn-check"

const ENV_VARS = ["SENTRY_DSN", "NEXT_PUBLIC_SENTRY_DSN"] as const
const originals = ENV_VARS.map((name) => ({ name, value: process.env[name] }))

function restoreEnv() {
  for (const { name, value } of originals) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
}

function setBlank(name: (typeof ENV_VARS)[number]) {
  delete process.env[name]
}

afterEach(restoreEnv)

describe("checkSentryDsnEnv", () => {
  test("reports missing=true + both var names when neither DSN is set", () => {
    setBlank("SENTRY_DSN")
    setBlank("NEXT_PUBLIC_SENTRY_DSN")
    const result = checkSentryDsnEnv()
    expect(result.missing).toBe(true)
    expect(result.missingVars).toEqual(["SENTRY_DSN", "NEXT_PUBLIC_SENTRY_DSN"])
  })

  test("reports missing=true with the one missing name when only one DSN is set", () => {
    process.env.SENTRY_DSN = "https://example@sentry.io/1"
    setBlank("NEXT_PUBLIC_SENTRY_DSN")
    const result = checkSentryDsnEnv()
    expect(result.missing).toBe(true)
    expect(result.missingVars).toEqual(["NEXT_PUBLIC_SENTRY_DSN"])
  })

  test("treats a whitespace-only value as missing (not as 'set')", () => {
    process.env.SENTRY_DSN = "   "
    setBlank("NEXT_PUBLIC_SENTRY_DSN")
    const result = checkSentryDsnEnv()
    expect(result.missing).toBe(true)
    expect(result.missingVars).toContain("SENTRY_DSN")
  })

  test("reports missing=false when both DSNs are set", () => {
    process.env.SENTRY_DSN = "https://example@sentry.io/1"
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://example@sentry.io/2"
    const result = checkSentryDsnEnv()
    expect(result.missing).toBe(false)
    expect(result.missingVars).toEqual([])
  })

  test("operates on the env passed by argument, not the global process.env", () => {
    // Caller-supplied env wins -- so a test passing a blank env sees missing
    // even if process.env happens to carry the vars, and vice-versa.
    const fromArg = checkSentryDsnEnv({ SENTRY_DSN: "x", NEXT_PUBLIC_SENTRY_DSN: "y" })
    expect(fromArg.missing).toBe(false)
    const fromArgBlank = checkSentryDsnEnv({})
    expect(fromArgBlank.missing).toBe(true)
  })
})

describe("warnIfSentryDsnMissing", () => {
  test("fires the warning when both DSNs are unset", () => {
    setBlank("SENTRY_DSN")
    setBlank("NEXT_PUBLIC_SENTRY_DSN")
    const warn = mock(() => {})
    const result = warnIfSentryDsnMissing(process.env, warn)
    expect(result.missing).toBe(true)
    expect(warn).toHaveBeenCalledTimes(1)
    const message = String(warn.mock.calls[0][0])
    expect(message).toContain("[sentry]")
    expect(message).toContain("SENTRY_DSN")
    expect(message).toContain("NEXT_PUBLIC_SENTRY_DSN")
  })

  test("is silent (no warn call) when both DSNs are set", () => {
    process.env.SENTRY_DSN = "https://example@sentry.io/1"
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://example@sentry.io/2"
    const warn = mock(() => {})
    const result = warnIfSentryDsnMissing(process.env, warn)
    expect(result.missing).toBe(false)
    expect(warn).not.toHaveBeenCalled()
  })

  test("names only the missing var when exactly one DSN is set", () => {
    process.env.SENTRY_DSN = "https://example@sentry.io/1"
    setBlank("NEXT_PUBLIC_SENTRY_DSN")
    const warn = mock(() => {})
    const result = warnIfSentryDsnMissing(process.env, warn)
    expect(result.missingVars).toEqual(["NEXT_PUBLIC_SENTRY_DSN"])
    expect(warn).toHaveBeenCalledTimes(1)
    const message = String(warn.mock.calls[0][0])
    expect(message).toContain("NEXT_PUBLIC_SENTRY_DSN")
    expect(message).not.toContain("SENTRY_DSN,") // SENTRY_DSN itself is set; only the public one is named
  })
})
