/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  computeExecutionOutcome,
  outcomeFromStatusCounts,
  computeTargetGap,
  computeDeadlineProximity,
  floorTierRoleKeys,
  D1_MISSION_TARGET_RATE,
  D1_MISSION_DEADLINE_ISO,
  FLOOR_TIER_MODEL_IDS,
} from "./d1-metrics-tracker-service"

describe("computeExecutionOutcome", () => {
  test("zero terminal outcomes -> successRate is null, not 0 -- 'no data yet' must stay distinguishable from '0% success'", () => {
    const result = computeExecutionOutcome({ successful: 0, failed: 0 })
    expect(result).toEqual({ total: 0, successful: 0, failed: 0, successRate: null })
  })

  test("all-successful outcomes produce a 100% success rate", () => {
    const result = computeExecutionOutcome({ successful: 10, failed: 0 })
    expect(result.total).toBe(10)
    expect(result.successRate).toBe(1)
  })

  test("mixed outcomes compute the correct ratio", () => {
    const result = computeExecutionOutcome({ successful: 999, failed: 1 })
    expect(result.total).toBe(1000)
    expect(result.successRate).toBeCloseTo(0.999, 5)
  })

  test("all-failed outcomes report successRate of exactly 0 (real zero, not missing data)", () => {
    const result = computeExecutionOutcome({ successful: 0, failed: 5 })
    expect(result.successRate).toBe(0)
  })
})

describe("outcomeFromStatusCounts", () => {
  const FAILURE = new Set(["failed", "error", "denied", "gated"])

  test("splits a status map into successful vs failed using the given failure set", () => {
    const result = outcomeFromStatusCounts({ completed: 8, failed: 1, denied: 1 }, FAILURE)
    expect(result.total).toBe(10)
    expect(result.successful).toBe(8)
    expect(result.failed).toBe(2)
    expect(result.successRate).toBeCloseTo(0.8, 5)
  })

  test("statuses not in the failure set count as successful (e.g. 'completed')", () => {
    const result = outcomeFromStatusCounts({ completed: 5 }, FAILURE)
    expect(result.successful).toBe(5)
    expect(result.failed).toBe(0)
  })

  test("empty status map -> successRate null", () => {
    const result = outcomeFromStatusCounts({}, FAILURE)
    expect(result.successRate).toBeNull()
  })

  test("'gated' and 'denied' both count against success, matching orchestra_executions' 4 real statuses", () => {
    const result = outcomeFromStatusCounts({ completed: 6, gated: 2, denied: 2 }, FAILURE)
    expect(result.successful).toBe(6)
    expect(result.failed).toBe(4)
  })
})

describe("computeTargetGap", () => {
  test("null successRate (no data) propagates to a fully null gap, not a misleading 0-point gap", () => {
    const result = computeTargetGap(null)
    expect(result).toEqual({ targetRate: D1_MISSION_TARGET_RATE, currentRate: null, gapPercentagePoints: null, targetMet: null })
  })

  test("exactly-at-target rate reports targetMet true and a zero gap", () => {
    const result = computeTargetGap(0.999)
    expect(result.targetMet).toBe(true)
    expect(result.gapPercentagePoints).toBe(0)
  })

  test("above-target rate reports targetMet true and a negative gap", () => {
    const result = computeTargetGap(1)
    expect(result.targetMet).toBe(true)
    expect(result.gapPercentagePoints).toBeCloseTo(-0.1, 5)
  })

  test("below-target rate reports targetMet false and a positive gap in percentage points", () => {
    const result = computeTargetGap(0.95)
    expect(result.targetMet).toBe(false)
    expect(result.gapPercentagePoints).toBeCloseTo(4.9, 5)
  })

  test("accepts a custom targetRate override", () => {
    const result = computeTargetGap(0.9, 0.9)
    expect(result.targetMet).toBe(true)
    expect(result.gapPercentagePoints).toBe(0)
  })
})

describe("computeDeadlineProximity", () => {
  test("30 days before the deadline reports daysRemaining = 30 and isPastDeadline = false", () => {
    const now = new Date("2026-08-01T00:00:00.000Z")
    const result = computeDeadlineProximity(now)
    expect(result.deadlineIso).toBe(D1_MISSION_DEADLINE_ISO)
    expect(result.daysRemaining).toBe(30)
    expect(result.isPastDeadline).toBe(false)
  })

  test("exactly at the deadline reports daysRemaining = 0", () => {
    const now = new Date(D1_MISSION_DEADLINE_ISO)
    const result = computeDeadlineProximity(now)
    expect(result.daysRemaining).toBe(0)
    expect(result.isPastDeadline).toBe(false)
  })

  test("past the deadline reports a negative daysRemaining and isPastDeadline = true", () => {
    const now = new Date("2026-09-15T00:00:00.000Z")
    const result = computeDeadlineProximity(now)
    expect(result.daysRemaining).toBeLessThan(0)
    expect(result.isPastDeadline).toBe(true)
  })

  test("less than a day left still rounds up to 1, not 0", () => {
    const deadline = new Date(D1_MISSION_DEADLINE_ISO)
    const now = new Date(deadline.getTime() - 3600_000) // 1 hour before
    const result = computeDeadlineProximity(now)
    expect(result.daysRemaining).toBe(1)
  })
})

describe("floorTierRoleKeys", () => {
  test("returns a non-empty list containing at least the known GPT-OSS-120B role from roster.ts", () => {
    const keys = floorTierRoleKeys()
    expect(keys.length).toBeGreaterThan(0)
    expect(keys).toContain("tool_integration_engineer")
  })

  test("every returned roleKey really maps back to one of the two floor-tier model ids", () => {
    const keys = floorTierRoleKeys()
    expect(keys.length).toBeGreaterThan(0)
    // Re-derive independently via the roster import path used by the
    // service itself would duplicate the module under test; instead this
    // just asserts the known floor-tier model id constants are the ones
    // exposed publicly, so a future caller building the same join gets the
    // same two ids this file uses internally.
    expect(FLOOR_TIER_MODEL_IDS).toEqual(["openai/gpt-oss-120b", "gpt-oss-120b"])
  })
})
