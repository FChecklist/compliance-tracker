/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  evaluateStage0TokenStatus,
  decideStage0UpgradeAction,
  partitionEligibleForAutoUpgrade,
} from "./stage0-service"

describe("evaluateStage0TokenStatus", () => {
  const now = new Date("2026-07-15T12:00:00Z")

  test("a fresh token is valid", () => {
    expect(evaluateStage0TokenStatus({ expiresAt: new Date("2026-07-20T00:00:00Z"), revokedAt: null }, now)).toBe("valid")
  })

  test("a token past its expiry is expired", () => {
    expect(evaluateStage0TokenStatus({ expiresAt: new Date("2026-07-10T00:00:00Z"), revokedAt: null }, now)).toBe("expired")
  })

  test("expiry boundary: exactly at expiresAt counts as expired (strict >, not >=)", () => {
    expect(evaluateStage0TokenStatus({ expiresAt: now, revokedAt: null }, now)).toBe("expired")
  })

  test("expiry boundary: one millisecond before expiresAt is still valid", () => {
    const justBefore = new Date(now.getTime() - 1)
    expect(evaluateStage0TokenStatus({ expiresAt: now, revokedAt: null }, justBefore)).toBe("valid")
  })

  test("a revoked token is revoked even if not yet expired", () => {
    expect(evaluateStage0TokenStatus({ expiresAt: new Date("2026-07-20T00:00:00Z"), revokedAt: new Date("2026-07-14T00:00:00Z") }, now)).toBe("revoked")
  })

  test("a revoked token reports revoked even past its own expiry (more specific reason wins)", () => {
    expect(evaluateStage0TokenStatus({ expiresAt: new Date("2026-07-01T00:00:00Z"), revokedAt: new Date("2026-06-01T00:00:00Z") }, now)).toBe("revoked")
  })
})

// Auto-upgrade Trigger A (person-level) -- the safety-critical decision:
// "never silently reassign someone's real home org."
describe("decideStage0UpgradeAction", () => {
  test("no existing users row at all -> not_found (caller proceeds with its own normal insert)", () => {
    expect(decideStage0UpgradeAction(null)).toBe("not_found")
  })

  test("existing row with orgId already set -> different_org (must reject, never silently reassign)", () => {
    expect(decideStage0UpgradeAction({ orgId: "org_other" })).toBe("different_org")
  })

  test("existing row with orgId IS NULL (stage-0-only) -> upgrade", () => {
    expect(decideStage0UpgradeAction({ orgId: null })).toBe("upgrade")
  })
})

// Auto-upgrade Trigger B (org-level) -- the safety-critical partition: an
// org enabling a paid branch must never silently reassign a stage-0 user
// who already has a different real home org elsewhere.
describe("partitionEligibleForAutoUpgrade", () => {
  test("orgId IS NULL users are eligible", () => {
    const { eligible, blocked } = partitionEligibleForAutoUpgrade([
      { id: "u1", orgId: null },
      { id: "u2", orgId: null },
    ])
    expect(eligible.map((u) => u.id)).toEqual(["u1", "u2"])
    expect(blocked).toEqual([])
  })

  test("users with a different real home org are blocked, never eligible", () => {
    const { eligible, blocked } = partitionEligibleForAutoUpgrade([
      { id: "u1", orgId: "org_A" },
      { id: "u2", orgId: "org_B" },
    ])
    expect(eligible).toEqual([])
    expect(blocked.map((u) => u.id)).toEqual(["u1", "u2"])
  })

  test("a mixed batch partitions correctly, preserving relative order within each bucket", () => {
    const { eligible, blocked } = partitionEligibleForAutoUpgrade([
      { id: "u1", orgId: null },
      { id: "u2", orgId: "org_A" },
      { id: "u3", orgId: null },
      { id: "u4", orgId: "org_B" },
    ])
    expect(eligible.map((u) => u.id)).toEqual(["u1", "u3"])
    expect(blocked.map((u) => u.id)).toEqual(["u2", "u4"])
  })

  test("an empty candidate list partitions to two empty arrays", () => {
    const { eligible, blocked } = partitionEligibleForAutoUpgrade([])
    expect(eligible).toEqual([])
    expect(blocked).toEqual([])
  })
})
