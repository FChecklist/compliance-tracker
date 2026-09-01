/// <reference types="bun-types" />
// Wave 173 (GAP-DELEGATION-AUTHORITY): tests the pure validation/decision
// functions -- createDelegation()/revokeDelegation()/isDelegated() themselves
// touch the DB and are deliberately left untested here, matching this
// repo's established pattern (see task-service.test.ts's own note).
import { describe, expect, test } from "bun:test"
import { validateDelegationInput, isDelegationActive, delegationGrantsUser, resolveDelegatedAuthority, resolveDelegatedAuthorityFromAuthorizedDelegator } from "./delegation-service"

const NOW = new Date("2026-07-12T12:00:00Z")
const FUTURE = new Date("2026-08-01T00:00:00Z")
const PAST = new Date("2026-07-01T00:00:00Z")

describe("validateDelegationInput", () => {
  test("valid: a delegate user, no expiry", () => {
    expect(validateDelegationInput({ delegatorUserId: "u1", delegateUserId: "u2", delegateRoleKey: null, expiresAt: null }, NOW))
      .toEqual({ valid: true })
  })

  test("valid: a delegate role, future expiry", () => {
    expect(validateDelegationInput({ delegatorUserId: "u1", delegateUserId: null, delegateRoleKey: "manager", expiresAt: FUTURE }, NOW))
      .toEqual({ valid: true })
  })

  test("rejects when neither delegateUserId nor delegateRoleKey is set", () => {
    const result = validateDelegationInput({ delegatorUserId: "u1", delegateUserId: null, delegateRoleKey: null, expiresAt: null }, NOW)
    expect(result.valid).toBe(false)
  })

  test("rejects when BOTH delegateUserId and delegateRoleKey are set", () => {
    const result = validateDelegationInput({ delegatorUserId: "u1", delegateUserId: "u2", delegateRoleKey: "manager", expiresAt: null }, NOW)
    expect(result.valid).toBe(false)
  })

  test("rejects self-delegation", () => {
    const result = validateDelegationInput({ delegatorUserId: "u1", delegateUserId: "u1", delegateRoleKey: null, expiresAt: null }, NOW)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("yourself")
  })

  test("rejects an expiresAt in the past", () => {
    const result = validateDelegationInput({ delegatorUserId: "u1", delegateUserId: "u2", delegateRoleKey: null, expiresAt: PAST }, NOW)
    expect(result.valid).toBe(false)
  })

  test("rejects an expiresAt exactly equal to now (must be strictly future)", () => {
    const result = validateDelegationInput({ delegatorUserId: "u1", delegateUserId: "u2", delegateRoleKey: null, expiresAt: NOW }, NOW)
    expect(result.valid).toBe(false)
  })
})

describe("isDelegationActive", () => {
  test("active: no revokedAt, no expiresAt", () => {
    expect(isDelegationActive({ revokedAt: null, expiresAt: null }, NOW)).toBe(true)
  })
  test("active: expiresAt in the future", () => {
    expect(isDelegationActive({ revokedAt: null, expiresAt: FUTURE }, NOW)).toBe(true)
  })
  test("inactive: revoked, regardless of expiry", () => {
    expect(isDelegationActive({ revokedAt: PAST, expiresAt: FUTURE }, NOW)).toBe(false)
  })
  test("inactive: expired", () => {
    expect(isDelegationActive({ revokedAt: null, expiresAt: PAST }, NOW)).toBe(false)
  })
  test("inactive: expiresAt exactly now (strict expiry)", () => {
    expect(isDelegationActive({ revokedAt: null, expiresAt: NOW }, NOW)).toBe(false)
  })
})

describe("delegationGrantsUser", () => {
  test("grants when delegateUserId matches exactly", () => {
    expect(delegationGrantsUser({ delegateUserId: "u2", delegateRoleKey: null }, "u2", [])).toBe(true)
  })
  test("does not grant a different user", () => {
    expect(delegationGrantsUser({ delegateUserId: "u2", delegateRoleKey: null }, "u3", [])).toBe(false)
  })
  test("grants via role membership when delegateRoleKey is set", () => {
    expect(delegationGrantsUser({ delegateUserId: null, delegateRoleKey: "manager" }, "u3", ["manager"])).toBe(true)
  })
  test("does not grant when the user doesn't hold the delegated role", () => {
    expect(delegationGrantsUser({ delegateUserId: null, delegateRoleKey: "manager" }, "u3", ["member"])).toBe(false)
  })
  test("neither field set: never grants", () => {
    expect(delegationGrantsUser({ delegateUserId: null, delegateRoleKey: null }, "u3", ["manager"])).toBe(false)
  })
})

// V2-11 delegation-expiry-enforcement-audit: isDelegated()'s own decision
// logic, split out as resolveDelegatedAuthority() so it's testable without
// a DB -- this is what proves an EXPIRED (or revoked) delegation is
// rejected at a real, non-listing authorization checkpoint
// (approval-workflow-service.ts's decideApprovalStep is the first real
// caller of isDelegated(), gated behind this exact function).
describe("resolveDelegatedAuthority", () => {
  test("rejects: the only candidate delegation is expired", () => {
    const expired = { revokedAt: null, expiresAt: PAST, delegateUserId: "u2", delegateRoleKey: null }
    expect(resolveDelegatedAuthority([expired], "u2", [], NOW)).toBe(false)
  })

  test("rejects: the only candidate delegation was revoked", () => {
    const revoked = { revokedAt: PAST, expiresAt: null, delegateUserId: "u2", delegateRoleKey: null }
    expect(resolveDelegatedAuthority([revoked], "u2", [], NOW)).toBe(false)
  })

  test("grants: an active delegation to this exact user", () => {
    const active = { revokedAt: null, expiresAt: FUTURE, delegateUserId: "u2", delegateRoleKey: null }
    expect(resolveDelegatedAuthority([active], "u2", [], NOW)).toBe(true)
  })

  test("grants: an active, open-ended (no expiresAt) role-level delegation", () => {
    const active = { revokedAt: null, expiresAt: null, delegateUserId: null, delegateRoleKey: "manager" }
    expect(resolveDelegatedAuthority([active], "u3", ["manager"], NOW)).toBe(true)
  })

  test("rejects: an expired delegation even alongside one that grants a different user", () => {
    const expiredForMe = { revokedAt: null, expiresAt: PAST, delegateUserId: "u2", delegateRoleKey: null }
    const activeForSomeoneElse = { revokedAt: null, expiresAt: FUTURE, delegateUserId: "u4", delegateRoleKey: null }
    expect(resolveDelegatedAuthority([expiredForMe, activeForSomeoneElse], "u2", [], NOW)).toBe(false)
  })

  test("rejects: no candidate delegations at all", () => {
    expect(resolveDelegatedAuthority([], "u2", [], NOW)).toBe(false)
  })
})

// PR #579 AUDIT: FAIL fix (2026-07-26 comment): validateDelegationInput()
// only blocks delegateUserId === delegatorUserId -- it never checks
// whether the delegator actually held the authority they're handing away.
// resolveDelegatedAuthorityFromAuthorizedDelegator() is the consumption-time
// closure of that gap: a delegation only counts if its OWN delegatorUserId
// independently satisfies the caller's authority predicate right now.
describe("resolveDelegatedAuthorityFromAuthorizedDelegator", () => {
  test("grants: an active delegation whose delegator is authorized", () => {
    const active = { revokedAt: null, expiresAt: FUTURE, delegateUserId: "u2", delegateRoleKey: null, delegatorUserId: "manager1" }
    expect(resolveDelegatedAuthorityFromAuthorizedDelegator([active], "u2", [], (id) => id === "manager1", NOW)).toBe(true)
  })

  test("rejects: an active, otherwise-matching delegation whose delegator is NOT authorized (the self-grant exploit)", () => {
    // A rank-insufficient user ('member1') delegates their own role's
    // approval_type authority to their own role -- validateDelegationInput
    // permits this (delegateRoleKey !== delegatorUserId, no self-delegation
    // check fires), but the delegator never held manager-rank authority to
    // hand away, so this must not grant it.
    const selfGrant = { revokedAt: null, expiresAt: null, delegateUserId: null, delegateRoleKey: "member", delegatorUserId: "member1" }
    expect(resolveDelegatedAuthorityFromAuthorizedDelegator([selfGrant], "member1", ["member"], (id) => id === "manager1", NOW)).toBe(false)
  })

  test("rejects: an accomplice-grant from an unauthorized delegator", () => {
    const accompliceGrant = { revokedAt: null, expiresAt: null, delegateUserId: "accomplice", delegateRoleKey: null, delegatorUserId: "member1" }
    expect(resolveDelegatedAuthorityFromAuthorizedDelegator([accompliceGrant], "accomplice", [], (id) => id === "manager1", NOW)).toBe(false)
  })

  test("rejects: delegator was authorized but the delegation itself is expired", () => {
    const expired = { revokedAt: null, expiresAt: PAST, delegateUserId: "u2", delegateRoleKey: null, delegatorUserId: "manager1" }
    expect(resolveDelegatedAuthorityFromAuthorizedDelegator([expired], "u2", [], (id) => id === "manager1", NOW)).toBe(false)
  })

  test("grants: the authorized delegator among several candidates, rejects the unauthorized ones", () => {
    const fromUnauthorized = { revokedAt: null, expiresAt: null, delegateUserId: null, delegateRoleKey: "member", delegatorUserId: "member1" }
    const fromAuthorized = { revokedAt: null, expiresAt: null, delegateUserId: null, delegateRoleKey: "member", delegatorUserId: "manager1" }
    expect(resolveDelegatedAuthorityFromAuthorizedDelegator([fromUnauthorized, fromAuthorized], "u3", ["member"], (id) => id === "manager1", NOW)).toBe(true)
  })

  test("rejects: no candidate delegations at all", () => {
    expect(resolveDelegatedAuthorityFromAuthorizedDelegator([], "u2", [], () => true, NOW)).toBe(false)
  })
})
