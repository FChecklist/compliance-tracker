/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { bandConfidence } from "./confidence-banding"

describe("bandConfidence -- Constitution Guardrail 9, D18/PLAN-20", () => {
  test("98-100 bands to auto_proceed", () => {
    expect(bandConfidence(100)).toBe("auto_proceed")
    expect(bandConfidence(99)).toBe("auto_proceed")
    expect(bandConfidence(98)).toBe("auto_proceed")
  })

  test("95-97 bands to self_review_required", () => {
    expect(bandConfidence(97)).toBe("self_review_required")
    expect(bandConfidence(96)).toBe("self_review_required")
    expect(bandConfidence(95)).toBe("self_review_required")
  })

  test("90-94 bands to peer_review_required", () => {
    expect(bandConfidence(94)).toBe("peer_review_required")
    expect(bandConfidence(92)).toBe("peer_review_required")
    expect(bandConfidence(90)).toBe("peer_review_required")
  })

  test("below 90 bands to escalation_required", () => {
    expect(bandConfidence(89.9)).toBe("escalation_required")
    expect(bandConfidence(50)).toBe("escalation_required")
    expect(bandConfidence(0)).toBe("escalation_required")
  })

  test("clamps an out-of-range value above 100 rather than throwing, and fails toward the safer band", () => {
    expect(bandConfidence(101)).toBe("auto_proceed")
  })

  test("clamps a negative value rather than throwing", () => {
    expect(bandConfidence(-5)).toBe("escalation_required")
  })

  test("a non-finite input fails closed to escalation_required, the safest band", () => {
    expect(bandConfidence(NaN)).toBe("escalation_required")
  })
})
