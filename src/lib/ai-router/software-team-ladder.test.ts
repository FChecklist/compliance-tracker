/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  SOFTWARE_TEAM_LADDER,
  getLevelContract,
  complexityTierForLevel,
  capabilityCategoryForLevel,
  validateLevelDispatch,
  COMPLEXITY_TIER_FOR_CATEGORY,
  type SoftwareTeamLevel,
} from "./software-team-ladder"

describe("SOFTWARE_TEAM_LADDER -- static data integrity", () => {
  test("all 6 levels (L0-L5) are present", () => {
    const levels: SoftwareTeamLevel[] = ["L0", "L1", "L2", "L3", "L4", "L5"]
    for (const level of levels) {
      expect(SOFTWARE_TEAM_LADDER[level]).toBeDefined()
      expect(SOFTWARE_TEAM_LADDER[level].level).toBe(level)
    }
  })

  test("L0 and L5 have no complexityTier (not worker-level dispatches)", () => {
    expect(complexityTierForLevel("L0")).toBeNull()
    expect(complexityTierForLevel("L5")).toBeNull()
  })

  test("L1/L2 are mechanical, L3 is integrative, L4 is judgment", () => {
    expect(complexityTierForLevel("L1")).toBe("mechanical")
    expect(complexityTierForLevel("L2")).toBe("mechanical")
    expect(complexityTierForLevel("L3")).toBe("integrative")
    expect(complexityTierForLevel("L4")).toBe("judgment")
  })

  test("retry policy: 1 automatic retry for L1-L3, 0 (as-needed/continuous, not automatic) for L0/L4/L5", () => {
    expect(SOFTWARE_TEAM_LADDER.L1.maxAutomaticRetries).toBe(1)
    expect(SOFTWARE_TEAM_LADDER.L2.maxAutomaticRetries).toBe(1)
    expect(SOFTWARE_TEAM_LADDER.L3.maxAutomaticRetries).toBe(1)
    expect(SOFTWARE_TEAM_LADDER.L4.maxAutomaticRetries).toBe(0)
    expect(SOFTWARE_TEAM_LADDER.L0.maxAutomaticRetries).toBe(0)
    expect(SOFTWARE_TEAM_LADDER.L5.maxAutomaticRetries).toBe(0)
  })

  test("every capabilityCategory named on a level maps through COMPLEXITY_TIER_FOR_CATEGORY to that SAME level's own complexityTier (no contradiction between the two axes)", () => {
    for (const level of ["L1", "L2", "L3", "L4"] as const) {
      const contract = SOFTWARE_TEAM_LADDER[level]
      expect(contract.capabilityCategory).not.toBeNull()
      expect(COMPLEXITY_TIER_FOR_CATEGORY[contract.capabilityCategory!]).toBe(contract.complexityTier)
    }
  })

  test("getLevelContract returns the same object as direct lookup", () => {
    expect(getLevelContract("L3")).toBe(SOFTWARE_TEAM_LADDER.L3)
  })

  test("capabilityCategoryForLevel(L5) is planning_governance_oversight (Mother Router's own category)", () => {
    expect(capabilityCategoryForLevel("L5")).toBe("planning_governance_oversight")
  })

  // Audit round 1 (GLM-5.2, m2 finding): worker levels must carry a real,
  // non-empty base process -- previously the route derived `process` from
  // free-text `scope` alone.
  test("L1-L4 (worker-level dispatches) each carry a non-empty baseProcessSteps; L0/L5 (no worker dispatch) are empty", () => {
    for (const level of ["L1", "L2", "L3", "L4"] as const) {
      expect(SOFTWARE_TEAM_LADDER[level].baseProcessSteps.length).toBeGreaterThan(0)
    }
    expect(SOFTWARE_TEAM_LADDER.L0.baseProcessSteps).toEqual([])
    expect(SOFTWARE_TEAM_LADDER.L5.baseProcessSteps).toEqual([])
  })
})

describe("validateLevelDispatch -- fail-closed on level/tier mismatch", () => {
  test("matching tier: valid", () => {
    expect(validateLevelDispatch("L1", "mechanical")).toEqual({ valid: true })
    expect(validateLevelDispatch("L3", "integrative")).toEqual({ valid: true })
    expect(validateLevelDispatch("L4", "judgment")).toEqual({ valid: true })
  })

  test("mismatched tier: invalid with guidance naming the correct tier", () => {
    const result = validateLevelDispatch("L1", "judgment")
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.reason).toContain("mechanical")
      expect(result.guidance).toContain("mechanical")
    }
  })

  test("L0 (no AI) is never a valid worker-level dispatch target", () => {
    const result = validateLevelDispatch("L0", "mechanical")
    expect(result.valid).toBe(false)
  })

  test("L5 (Mother Router itself) is never a valid worker-level dispatch target", () => {
    const result = validateLevelDispatch("L5", "judgment")
    expect(result.valid).toBe(false)
  })
})
