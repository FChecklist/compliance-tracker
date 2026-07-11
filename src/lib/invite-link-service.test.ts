/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  evaluateInviteLinkStatus,
  generateInviteToken,
  inviteTokenPrefix,
  isInviteRole,
  INVITE_ROLES,
} from "./invite-link-service"

function row(overrides: Partial<{ expiresAt: Date; revokedAt: Date | null; maxUses: number | null; useCount: number }> = {}) {
  return {
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60_000),
    revokedAt: overrides.revokedAt ?? null,
    maxUses: overrides.maxUses ?? null,
    useCount: overrides.useCount ?? 0,
  }
}

describe("evaluateInviteLinkStatus", () => {
  const now = new Date("2026-07-11T12:00:00Z")

  test("a fresh, unused, unlimited-use link is valid", () => {
    expect(evaluateInviteLinkStatus(row({ expiresAt: new Date("2026-07-18T00:00:00Z") }), now)).toBe("valid")
  })

  test("a link past its expiry is expired", () => {
    expect(evaluateInviteLinkStatus(row({ expiresAt: new Date("2026-07-10T00:00:00Z") }), now)).toBe("expired")
  })

  test("expiry boundary: exactly at expiresAt counts as expired (strict >, not >=)", () => {
    expect(evaluateInviteLinkStatus(row({ expiresAt: now }), now)).toBe("expired")
  })

  test("expiry boundary: one millisecond before expiresAt is still valid", () => {
    const justBefore = new Date(now.getTime() - 1)
    expect(evaluateInviteLinkStatus(row({ expiresAt: now }), justBefore)).toBe("valid")
  })

  test("a revoked link is revoked even if not yet expired", () => {
    expect(evaluateInviteLinkStatus(row({ revokedAt: new Date("2026-07-11T00:00:00Z"), expiresAt: new Date("2026-07-20T00:00:00Z") }), now)).toBe("revoked")
  })

  test("a revoked link reports revoked even past its own expiry (more specific reason wins)", () => {
    expect(evaluateInviteLinkStatus(row({ revokedAt: new Date("2026-07-01T00:00:00Z"), expiresAt: new Date("2026-07-02T00:00:00Z") }), now)).toBe("revoked")
  })

  test("a maxUses=1 link with useCount=1 is exhausted", () => {
    expect(evaluateInviteLinkStatus(row({ maxUses: 1, useCount: 1 }), now)).toBe("exhausted")
  })

  test("a maxUses=1 link with useCount=0 is still valid", () => {
    expect(evaluateInviteLinkStatus(row({ maxUses: 1, useCount: 0 }), now)).toBe("valid")
  })

  test("a maxUses=5 link with useCount=4 is still valid (boundary below the limit)", () => {
    expect(evaluateInviteLinkStatus(row({ maxUses: 5, useCount: 4 }), now)).toBe("valid")
  })

  test("a maxUses=5 link with useCount=5 is exhausted (boundary at the limit)", () => {
    expect(evaluateInviteLinkStatus(row({ maxUses: 5, useCount: 5 }), now)).toBe("exhausted")
  })

  test("maxUses=null means unlimited -- never exhausted regardless of useCount", () => {
    expect(evaluateInviteLinkStatus(row({ maxUses: null, useCount: 10_000 }), now)).toBe("valid")
  })
})

describe("generateInviteToken", () => {
  test("always starts with the il_ prefix", () => {
    expect(generateInviteToken().startsWith("il_")).toBe(true)
  })

  test("produces 48 hex characters after the prefix (24 random bytes)", () => {
    const token = generateInviteToken()
    expect(token.slice(3)).toMatch(/^[0-9a-f]{48}$/)
  })

  test("two calls never produce the same token", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateInviteToken()))
    expect(seen.size).toBe(50)
  })
})

describe("inviteTokenPrefix", () => {
  test("returns exactly 11 characters -- il_ plus 8 hex chars", () => {
    const token = generateInviteToken()
    expect(inviteTokenPrefix(token)).toHaveLength(11)
    expect(inviteTokenPrefix(token)).toBe(token.slice(0, 11))
  })
})

describe("isInviteRole", () => {
  test("accepts every value in INVITE_ROLES", () => {
    for (const role of INVITE_ROLES) expect(isInviteRole(role)).toBe(true)
  })

  test("rejects roles outside the invite-link allowlist, including higher-privilege DB roles", () => {
    expect(isInviteRole("veridian_admin")).toBe(false)
    expect(isInviteRole("branch_manager")).toBe(false)
    expect(isInviteRole("not_a_role")).toBe(false)
    expect(isInviteRole("")).toBe(false)
  })
})
