/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  evaluateSupportSessionStatus,
  generateSupportSessionToken,
  isSupportSessionActive,
} from "./support-session-service"

function row(overrides: Partial<{ expiresAt: Date; endedAt: Date | null }> = {}) {
  return {
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60_000),
    endedAt: overrides.endedAt ?? null,
  }
}

describe("evaluateSupportSessionStatus", () => {
  const now = new Date("2026-07-18T12:00:00Z")

  test("a fresh, unended session within its 1-hour window is active", () => {
    expect(evaluateSupportSessionStatus(row({ expiresAt: new Date("2026-07-18T13:00:00Z") }), now)).toBe("active")
  })

  test("a session past its expiresAt is expired", () => {
    expect(evaluateSupportSessionStatus(row({ expiresAt: new Date("2026-07-18T11:00:00Z") }), now)).toBe("expired")
  })

  test("expiry boundary: exactly at expiresAt counts as expired (strict >, not >=)", () => {
    expect(evaluateSupportSessionStatus(row({ expiresAt: now }), now)).toBe("expired")
  })

  test("expiry boundary: one millisecond before expiresAt is still active", () => {
    const justBefore = new Date(now.getTime() - 1)
    expect(evaluateSupportSessionStatus(row({ expiresAt: now }), justBefore)).toBe("active")
  })

  test("an explicitly-ended session reports ended even if not yet expired", () => {
    expect(evaluateSupportSessionStatus(row({ endedAt: new Date("2026-07-18T11:30:00Z"), expiresAt: new Date("2026-07-18T13:00:00Z") }), now)).toBe("ended")
  })

  test("an explicitly-ended session reports ended even past its own expiry (more specific reason wins)", () => {
    expect(evaluateSupportSessionStatus(row({ endedAt: new Date("2026-07-18T09:00:00Z"), expiresAt: new Date("2026-07-18T10:00:00Z") }), now)).toBe("ended")
  })
})

describe("isSupportSessionActive", () => {
  const now = new Date("2026-07-18T12:00:00Z")

  test("true only when status is active", () => {
    expect(isSupportSessionActive(row({ expiresAt: new Date("2026-07-18T13:00:00Z") }), now)).toBe(true)
  })

  test("false when expired", () => {
    expect(isSupportSessionActive(row({ expiresAt: new Date("2026-07-18T11:00:00Z") }), now)).toBe(false)
  })

  test("false when ended", () => {
    expect(isSupportSessionActive(row({ endedAt: new Date("2026-07-18T11:00:00Z"), expiresAt: new Date("2026-07-18T13:00:00Z") }), now)).toBe(false)
  })
})

describe("generateSupportSessionToken", () => {
  test("always starts with the ss_ prefix", () => {
    expect(generateSupportSessionToken().startsWith("ss_")).toBe(true)
  })

  test("produces 48 hex characters after the prefix (24 random bytes)", () => {
    const token = generateSupportSessionToken()
    expect(token.slice(3)).toMatch(/^[0-9a-f]{48}$/)
  })

  test("two calls never produce the same token", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateSupportSessionToken()))
    expect(seen.size).toBe(50)
  })
})
