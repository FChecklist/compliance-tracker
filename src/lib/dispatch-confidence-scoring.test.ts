import { describe, expect, test } from "bun:test"
import { computeDispatchConfidencePercentage } from "./dispatch-confidence-scoring"
import { bandConfidence } from "./confidence-banding"

describe("computeDispatchConfidencePercentage -- GP-09 numeric confidence pipeline", () => {
  test("no signals fired -> 100, auto_proceed band", () => {
    const score = computeDispatchConfidencePercentage({ lowConfidenceDetected: false, knowledgeGapDetected: false, riskLevel: "low" })
    expect(score).toBe(100)
    expect(bandConfidence(score)).toBe("auto_proceed")
  })

  test("low-confidence signal alone lands below the auto-proceed floor", () => {
    const score = computeDispatchConfidencePercentage({ lowConfidenceDetected: true, knowledgeGapDetected: false, riskLevel: "low" })
    expect(score).toBe(85)
    expect(bandConfidence(score)).not.toBe("auto_proceed")
  })

  test("knowledge-gap signal alone lands below the auto-proceed floor", () => {
    const score = computeDispatchConfidencePercentage({ lowConfidenceDetected: false, knowledgeGapDetected: true, riskLevel: "low" })
    expect(score).toBe(80)
    expect(bandConfidence(score)).not.toBe("auto_proceed")
  })

  test("critical risk alone lands below the auto-proceed floor", () => {
    const score = computeDispatchConfidencePercentage({ lowConfidenceDetected: false, knowledgeGapDetected: false, riskLevel: "critical" })
    expect(score).toBe(85)
  })

  test("stacked signals compound and clamp at 0", () => {
    const score = computeDispatchConfidencePercentage({ lowConfidenceDetected: true, knowledgeGapDetected: true, riskLevel: "critical" })
    expect(score).toBe(50)
  })

  test("unknown riskLevel string applies zero penalty rather than throwing", () => {
    const score = computeDispatchConfidencePercentage({ lowConfidenceDetected: false, knowledgeGapDetected: false, riskLevel: "unknown" })
    expect(score).toBe(100)
  })
})
