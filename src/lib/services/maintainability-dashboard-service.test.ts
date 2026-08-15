import { describe, expect, test } from "bun:test"
import { computeMaintainabilityScore } from "./maintainability-dashboard-service"

describe("computeMaintainabilityScore -- pure combiner", () => {
  test("all-100 inputs yield 100", () => {
    expect(computeMaintainabilityScore({ guardrailViolationScore: 100, improvementBacklogScore: 100, dependencyHealthScore: 100 })).toBe(100)
  })

  test("averages the 3 sub-scores", () => {
    expect(computeMaintainabilityScore({ guardrailViolationScore: 90, improvementBacklogScore: 60, dependencyHealthScore: 90 })).toBe(80)
  })

  test("clamps to [0, 100]", () => {
    expect(computeMaintainabilityScore({ guardrailViolationScore: 0, improvementBacklogScore: 0, dependencyHealthScore: 0 })).toBe(0)
  })
})
