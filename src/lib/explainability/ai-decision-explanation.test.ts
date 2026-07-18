/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { explainCrmLeadDecision, explainCrmOpportunityDecision, explainTaskPrediction } from "./ai-decision-explanation"

describe("explainCrmLeadDecision", () => {
  test("returns null when the lead has never been scored", () => {
    expect(explainCrmLeadDecision({ aiScoreReasoning: null })).toBeNull()
  })

  test("builds a full explanation from a scored lead", () => {
    const explanation = explainCrmLeadDecision({
      aiScore: 72, aiScoreReasoning: "Referral source with complete contact info.",
      aiRecommendedAction: "Call within 48 hours",
      aiConfidence: "high",
      aiAssumptions: ["Assumed the referral is warm since no notes field exists."],
      aiRejectedAlternatives: [{ option: "Send an email first", reason: "Phone converts faster for referral leads." }],
    })
    expect(explanation?.summary).toContain("72")
    expect(explanation?.confidence).toBe("high")
    expect(explanation?.recommendedAction).toBe("Call within 48 hours")
    expect(explanation?.assumptions?.length).toBe(1)
    expect(explanation?.rejectedAlternatives?.[0].option).toBe("Send an email first")
  })

  test("ignores a malformed confidence value rather than fabricating one", () => {
    const explanation = explainCrmLeadDecision({ aiScoreReasoning: "x", aiConfidence: "extremely high" })
    expect(explanation?.confidence).toBeUndefined()
  })

  test("ignores malformed rejectedAlternatives entries", () => {
    const explanation = explainCrmLeadDecision({ aiScoreReasoning: "x", aiRejectedAlternatives: [{ notOption: "bad shape" }] })
    expect(explanation?.rejectedAlternatives).toBeUndefined()
  })
})

describe("explainCrmOpportunityDecision", () => {
  test("returns null when never analyzed", () => {
    expect(explainCrmOpportunityDecision({})).toBeNull()
  })

  test("summarizes risk factors when present", () => {
    const explanation = explainCrmOpportunityDecision({
      aiWinProbability: 40, aiRiskFactors: ["No activity in 30 days", "Close date has passed"],
    })
    expect(explanation?.reasoning).toContain("No activity in 30 days")
    expect(explanation?.reasoning).toContain("Close date has passed")
  })

  test("explains no risk factors honestly rather than a blank reasoning", () => {
    const explanation = explainCrmOpportunityDecision({ aiWinProbability: 90, aiRiskFactors: [] })
    expect(explanation?.reasoning).toBe("No specific risk factors identified.")
  })
})

describe("explainTaskPrediction", () => {
  test("uses the prediction's own reason when it short-circuited (e.g. already completed)", () => {
    const explanation = explainTaskPrediction({
      sampleSize: 0, averageDurationDays: null, predictedCompletionDate: "2026-07-01", reason: "Task is already completed",
    })
    expect(explanation.summary).toBe("Task is already completed")
  })

  test("explains the historical-average method when a real prediction was computed", () => {
    const explanation = explainTaskPrediction({
      sampleSize: 8, averageDurationDays: 3.5, predictedCompletionDate: "2026-08-01", confidence: "medium",
    })
    expect(explanation.reasoning).toContain("8")
    expect(explanation.reasoning).toContain("3.5")
    expect(explanation.confidence).toBe("medium")
    expect(explanation.assumptions?.length).toBeGreaterThan(0)
  })
})
