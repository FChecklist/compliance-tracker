/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  evaluateJoinCodeStatus,
  generateJoinCode,
  formatJoinCode,
  normalizeJoinCode,
  isInviteRole,
  INVITE_ROLES,
} from "./org-join-code-service"

function row(overrides: Partial<{ expiresAt: Date | null; revokedAt: Date | null }> = {}) {
  return {
    expiresAt: overrides.expiresAt === undefined ? null : overrides.expiresAt,
    revokedAt: overrides.revokedAt ?? null,
  }
}

describe("evaluateJoinCodeStatus", () => {
  const now = new Date("2026-07-11T12:00:00Z")

  test("a fresh code with no expiry is valid", () => {
    expect(evaluateJoinCodeStatus(row(), now)).toBe("valid")
  })

  test("a code with a future expiry is valid", () => {
    expect(evaluateJoinCodeStatus(row({ expiresAt: new Date("2026-07-18T00:00:00Z") }), now)).toBe("valid")
  })

  test("a code past its expiry is expired", () => {
    expect(evaluateJoinCodeStatus(row({ expiresAt: new Date("2026-07-10T00:00:00Z") }), now)).toBe("expired")
  })

  test("expiry boundary: exactly at expiresAt counts as expired (strict >, not >=)", () => {
    expect(evaluateJoinCodeStatus(row({ expiresAt: now }), now)).toBe("expired")
  })

  test("expiry boundary: one millisecond before expiresAt is still valid", () => {
    const justBefore = new Date(now.getTime() - 1)
    expect(evaluateJoinCodeStatus(row({ expiresAt: now }), justBefore)).toBe("valid")
  })

  test("a revoked code is revoked even if not yet expired", () => {
    expect(evaluateJoinCodeStatus(row({ revokedAt: new Date("2026-07-11T00:00:00Z"), expiresAt: new Date("2026-07-20T00:00:00Z") }), now)).toBe("revoked")
  })

  test("a revoked code reports revoked even past its own expiry (more specific reason wins)", () => {
    expect(evaluateJoinCodeStatus(row({ revokedAt: new Date("2026-07-01T00:00:00Z"), expiresAt: new Date("2026-07-02T00:00:00Z") }), now)).toBe("revoked")
  })

  test("a revoked code with no expiry at all is still revoked", () => {
    expect(evaluateJoinCodeStatus(row({ revokedAt: new Date("2026-07-01T00:00:00Z"), expiresAt: null }), now)).toBe("revoked")
  })
})

describe("generateJoinCode", () => {
  test("produces a 12-character code formatted as 3 groups of 4, dash-separated", () => {
    const code = generateJoinCode()
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)
  })

  test("never contains visually-ambiguous characters (0, O, 1, I, L, U)", () => {
    const code = generateJoinCode()
    expect(code).not.toMatch(/[01ILUO]/)
  })

  test("two calls never produce the same code", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateJoinCode()))
    expect(seen.size).toBe(50)
  })
})

describe("formatJoinCode", () => {
  test("groups a 12-character raw string into 3 dash-separated groups of 4", () => {
    expect(formatJoinCode("ABCDEFGHJKMN")).toBe("ABCD-EFGH-JKMN")
  })
})

describe("normalizeJoinCode", () => {
  test("uppercases lowercase input", () => {
    expect(normalizeJoinCode("abcdefghjkmn")).toBe("ABCDEFGHJKMN")
  })

  test("strips dashes", () => {
    expect(normalizeJoinCode("ABCD-EFGH-JKMN")).toBe("ABCDEFGHJKMN")
  })

  test("strips internal and surrounding whitespace", () => {
    expect(normalizeJoinCode(" ABCD EFGH JKMN ")).toBe("ABCDEFGHJKMN")
  })

  test("is idempotent -- normalizing an already-normalized code is a no-op", () => {
    expect(normalizeJoinCode("ABCDEFGHJKMN")).toBe("ABCDEFGHJKMN")
  })

  test("round-trips through generateJoinCode/formatJoinCode/normalizeJoinCode", () => {
    const code = generateJoinCode()
    const raw = code.replace(/-/g, "")
    expect(normalizeJoinCode(code)).toBe(raw)
    expect(normalizeJoinCode(code.toLowerCase())).toBe(raw)
  })
})

describe("isInviteRole (re-exported from invite-link-service)", () => {
  test("accepts every value in INVITE_ROLES", () => {
    for (const role of INVITE_ROLES) expect(isInviteRole(role)).toBe(true)
  })

  test("rejects roles outside the allowlist, including higher-privilege DB roles", () => {
    expect(isInviteRole("veridian_admin")).toBe(false)
    expect(isInviteRole("branch_manager")).toBe(false)
    expect(isInviteRole("not_a_role")).toBe(false)
    expect(isInviteRole("")).toBe(false)
  })
})
