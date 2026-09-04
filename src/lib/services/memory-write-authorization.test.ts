/// <reference types="bun-types" />
// Sibling unit tests for src/lib/services/memory-write-authorization.ts.
//
// SCOPE, and how this differs from r68-phase6-write-path.test.ts. That file
// drives the gate END TO END through the real write functions, with a fake
// tx, and its assertions are about outcomes ("this write was refused and
// nothing was written"). This file tests the module's own PURE decision
// surface directly -- the role table and the client-authority-claim guard --
// where no database is involved at all and the behaviour is worth pinning on
// its own terms. Neither file is a copy of the other: delete this one and
// the minimum-role matrix stops being enumerated anywhere; delete that one
// and the gate stops being proven to actually stop a write.
import { describe, expect, test } from "bun:test"
import {
  assertNoClientAuthorityClaim,
  requiredRoleForMemoryWrite,
  MemoryWriteAuthorizationError,
  type MemoryWriteActor,
  type MemoryWriteOperation,
} from "./memory-write-authorization"
import { ROLE_RANK } from "@/lib/supabase/role-rank"

const ACTOR: MemoryWriteActor = { orgId: "org-1", userId: "user-1", actorUserId: "user-1" }

describe("requiredRoleForMemoryWrite -- the full minimum-role matrix", () => {
  test("`member` is the floor for every operation on every scope", () => {
    const scopes = ["ORGANIZATION", "DEPARTMENT", "USER", "PROJECT", "TASK", "CONVERSATION", "DOCUMENT"]
    const operations: MemoryWriteOperation[] = ["create", "supersede", "promote", "archive"]
    for (const scopeType of scopes) {
      for (const operation of operations) {
        const required = requiredRoleForMemoryWrite(ACTOR, { operation, scopeType })
        expect(ROLE_RANK[required]).toBeGreaterThanOrEqual(ROLE_RANK.member)
      }
    }
  })

  test("every rank-1 role sits BELOW that floor -- which is what makes the floor real", () => {
    for (const role of ["viewer", "client_viewer", "external_auditor", "stage_0"] as const) {
      expect(ROLE_RANK[role]).toBeLessThan(ROLE_RANK.member)
    }
  })

  test("creating an ordinary org-scoped memory needs only `member`", () => {
    for (const scopeType of ["ORGANIZATION", "PROJECT", "TASK", "CONVERSATION", "DOCUMENT"]) {
      expect(requiredRoleForMemoryWrite(ACTOR, { operation: "create", scopeType })).toBe("member")
    }
  })

  test("DEPARTMENT scope needs `manager` for every operation, create included", () => {
    for (const operation of ["create", "supersede", "promote", "archive"] as const) {
      expect(requiredRoleForMemoryWrite(ACTOR, { operation, scopeType: "DEPARTMENT" })).toBe("manager")
    }
  })

  test("CHANGING existing ORGANIZATION memory needs `manager`, though creating one needs only `member`", () => {
    expect(requiredRoleForMemoryWrite(ACTOR, { operation: "create", scopeType: "ORGANIZATION" })).toBe("member")
    for (const operation of ["supersede", "promote", "archive"] as const) {
      expect(requiredRoleForMemoryWrite(ACTOR, { operation, scopeType: "ORGANIZATION" })).toBe("manager")
    }
  })

  test("a USER-scoped write aimed at SOMEONE ELSE needs `admin`; at yourself, only `member`", () => {
    expect(
      requiredRoleForMemoryWrite(ACTOR, { operation: "create", scopeType: "USER", targetUserId: "user-2" })
    ).toBe("admin")
    expect(
      requiredRoleForMemoryWrite(ACTOR, { operation: "create", scopeType: "USER", targetUserId: "user-1" })
    ).toBe("member")
  })

  test("a USER-scoped write with no named target is treated as the caller's own", () => {
    expect(requiredRoleForMemoryWrite(ACTOR, { operation: "create", scopeType: "USER" })).toBe("member")
  })

  test("for a mutation the scope/owner is taken from the EXISTING row, not from what the caller claims", () => {
    // The caller says "ORGANIZATION"; the row on disk says it is user-2's
    // personal memory. The row wins -- otherwise a caller could pick its own
    // minimum role by mislabelling the target.
    const required = requiredRoleForMemoryWrite(ACTOR, {
      operation: "supersede",
      scopeType: "ORGANIZATION",
      targetUserId: "user-1",
      existingRecord: { id: "mem-1", orgId: "org-1", scopeType: "USER", userId: "user-2" },
    })
    expect(required).toBe("admin")
  })

  test("actorUserId (the D-05 identity bridge) is what 'yourself' means, not the raw caller id", () => {
    // userId here is an api_keys.id; actorUserId is the real user. Writing to
    // that real user's own memory must not be treated as a cross-user write.
    const bridged: MemoryWriteActor = { orgId: "org-1", userId: "key-1", actorUserId: "user-7" }
    expect(
      requiredRoleForMemoryWrite(bridged, { operation: "create", scopeType: "USER", targetUserId: "user-7" })
    ).toBe("member")
    expect(
      requiredRoleForMemoryWrite(bridged, { operation: "create", scopeType: "USER", targetUserId: "user-8" })
    ).toBe("admin")
  })
})

describe("assertNoClientAuthorityClaim -- identity in, verdicts out", () => {
  test("accepts a plain identity actor", () => {
    expect(() => assertNoClientAuthorityClaim(ACTOR)).not.toThrow()
    expect(() => assertNoClientAuthorityClaim({ ...ACTOR, chainId: "chain-1" })).not.toThrow()
  })

  test.each(["role", "roles", "authorized", "isAuthorized", "permissions", "bypassAuthorization", "allow"])(
    "rejects an actor carrying `%s`",
    (key) => {
      expect(() =>
        assertNoClientAuthorityClaim({ ...ACTOR, [key]: true } as unknown as MemoryWriteActor)
      ).toThrow(new RegExp(`client-supplied authorization claim \\(${key}\\)`))
    }
  )

  test("rejects a FALSY smuggled claim too -- the field's presence is the problem, not its value", () => {
    // `{ authorized: false }` looks harmless, but accepting it would mean the
    // shape is tolerated, and the next caller sends `true`.
    expect(() =>
      assertNoClientAuthorityClaim({ ...ACTOR, authorized: false } as unknown as MemoryWriteActor)
    ).toThrow(/client-supplied authorization claim/)
  })

  test("names every offending field at once rather than one per round trip", () => {
    expect(() =>
      assertNoClientAuthorityClaim({ ...ACTOR, role: "admin", authorized: true } as unknown as MemoryWriteActor)
    ).toThrow(/\(role, authorized\)/)
  })
})

describe("MemoryWriteAuthorizationError", () => {
  test("carries the full decision, so a caller can log WHICH boolean failed", () => {
    const decision = {
      allowed: false,
      callerContextResolves: true,
      inputsResolve: true,
      roleSufficient: false,
      chainChecked: false,
      resolvedRole: "viewer" as const,
      requiredRole: "member" as const,
      reason: "this create on a ORGANIZATION-scoped memory requires member or higher; user-1 is viewer",
    }
    const err = new MemoryWriteAuthorizationError(decision)
    expect(err.name).toBe("MemoryWriteAuthorizationError")
    expect(err.message).toContain("requires member or higher")
    expect(err.decision.roleSufficient).toBe(false)
    expect(err.decision.callerContextResolves).toBe(true)
  })
})
