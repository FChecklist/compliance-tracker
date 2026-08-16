/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  evaluateJoinCodeStatus,
  generateJoinCode,
  formatJoinCode,
  normalizeJoinCode,
  isInviteRole,
  INVITE_ROLES,
  isPrivilegedMinter,
  resolveAllowedMintRoles,
  resolvePeerExpiryDays,
  PEER_DEFAULT_MINT_EXPIRY_DAYS,
  PEER_MAX_MINT_EXPIRY_DAYS,
  PEER_MIN_MINT_EXPIRY_DAYS,
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

// Path D (peer-provided-code self-registration): the privilege-escalation
// guard is entirely in these 3 pure functions -- see this file's header
// comment for the full reasoning.
describe("isPrivilegedMinter", () => {
  test("admin and manager are privileged (unchanged from the old flat gate)", () => {
    expect(isPrivilegedMinter("admin")).toBe(true)
    expect(isPrivilegedMinter("manager")).toBe(true)
  })

  test("a rank-3 Wave-1 role (senior_professional) counts as privileged too -- rank, not the literal string, is what matters", () => {
    expect(isPrivilegedMinter("senior_professional")).toBe(true)
  })

  test("member/viewer/team_member/client_viewer/external_auditor are all non-privileged (peer)", () => {
    expect(isPrivilegedMinter("member")).toBe(false)
    expect(isPrivilegedMinter("viewer")).toBe(false)
    expect(isPrivilegedMinter("team_member")).toBe(false)
    expect(isPrivilegedMinter("client_viewer")).toBe(false)
    expect(isPrivilegedMinter("external_auditor")).toBe(false)
  })

  test("veridian_admin (the highest rank) is privileged", () => {
    expect(isPrivilegedMinter("veridian_admin")).toBe(true)
  })

  test("an unrecognized role string is never privileged (defensive default, rank 0)", () => {
    expect(isPrivilegedMinter("not_a_real_role")).toBe(false)
    expect(isPrivilegedMinter("")).toBe(false)
  })
})

describe("resolveAllowedMintRoles", () => {
  test("admin may mint any of the 4 INVITE_ROLES, including admin itself", () => {
    expect(resolveAllowedMintRoles("admin")).toEqual(["admin", "manager", "member", "viewer"])
  })

  test("manager may NOT mint an admin-granting code -- this is the fix for the pre-existing gap where any manager could mint an admin code", () => {
    const allowed = resolveAllowedMintRoles("manager")
    expect(allowed).not.toContain("admin")
    expect(allowed).toEqual(["manager", "member", "viewer"])
  })

  test("member may only mint member or viewer codes, never manager/admin", () => {
    expect(resolveAllowedMintRoles("member")).toEqual(["member", "viewer"])
  })

  test("viewer (lowest rank) may only mint viewer codes", () => {
    expect(resolveAllowedMintRoles("viewer")).toEqual(["viewer"])
  })

  test("an unrecognized role gets no allowed roles at all (rank 0, below even viewer's rank 1)", () => {
    expect(resolveAllowedMintRoles("not_a_real_role")).toEqual([])
  })

  test("veridian_admin (rank 6, not itself an INVITE_ROLE) is still capped to the 4 INVITE_ROLES, all of them", () => {
    expect(resolveAllowedMintRoles("veridian_admin")).toEqual(["admin", "manager", "member", "viewer"])
  })
})

describe("resolvePeerExpiryDays", () => {
  test("defaults to PEER_DEFAULT_MINT_EXPIRY_DAYS when nothing is requested", () => {
    expect(resolvePeerExpiryDays(undefined)).toBe(PEER_DEFAULT_MINT_EXPIRY_DAYS)
    expect(resolvePeerExpiryDays(null)).toBe(PEER_DEFAULT_MINT_EXPIRY_DAYS)
  })

  test("defaults for zero, negative, or non-finite input -- never silently produces a no-expiry peer code", () => {
    expect(resolvePeerExpiryDays(0)).toBe(PEER_DEFAULT_MINT_EXPIRY_DAYS)
    expect(resolvePeerExpiryDays(-5)).toBe(PEER_DEFAULT_MINT_EXPIRY_DAYS)
    expect(resolvePeerExpiryDays(NaN)).toBe(PEER_DEFAULT_MINT_EXPIRY_DAYS)
    expect(resolvePeerExpiryDays(Infinity)).toBe(PEER_DEFAULT_MINT_EXPIRY_DAYS)
  })

  test("passes through a valid in-range request unchanged", () => {
    expect(resolvePeerExpiryDays(7)).toBe(7)
  })

  test("clamps a request above the max down to PEER_MAX_MINT_EXPIRY_DAYS", () => {
    expect(resolvePeerExpiryDays(365)).toBe(PEER_MAX_MINT_EXPIRY_DAYS)
  })

  test("clamps a sub-minimum fractional request up to PEER_MIN_MINT_EXPIRY_DAYS", () => {
    expect(resolvePeerExpiryDays(0.4)).toBe(PEER_MIN_MINT_EXPIRY_DAYS)
  })

  test("floors a fractional in-range request", () => {
    expect(resolvePeerExpiryDays(5.9)).toBe(5)
  })
})
