/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { detectReaskOrCorrection, detectLowConfidenceResponse, checkPreCallEscalation, deriveConfidenceLabel } from "./floor-tier-escalation"

describe("detectReaskOrCorrection", () => {
  test("does not fire on a fresh conversation (no prior history), even with correction-shaped text", () => {
    const result = detectReaskOrCorrection("that's wrong", 0)
    expect(result.detected).toBe(false)
  })

  test("fires on a correction phrase when there IS prior history", () => {
    const result = detectReaskOrCorrection("No, that's wrong. Try again.", 2)
    expect(result.detected).toBe(true)
    expect(result.matchedPhrase).toBeTruthy()
  })

  test("does not fire on ordinary text with prior history", () => {
    const result = detectReaskOrCorrection("Can you also add the GST amount?", 2)
    expect(result.detected).toBe(false)
  })

  test("word-boundary matching -- a longer word containing the phrase as a substring doesn't false-positive", () => {
    // "incorrectly" contains "incorrect" as a substring but \bincorrect\b requires a
    // non-word boundary right after it, which "ly" doesn't provide.
    const result = detectReaskOrCorrection("The form was filled incorrectly by the vendor.", 2)
    expect(result.detected).toBe(false)
  })
})

describe("detectLowConfidenceResponse", () => {
  test("fires on hedging language", () => {
    const result = detectLowConfidenceResponse("I'm not sure what you mean by that, could you clarify?")
    expect(result.detected).toBe(true)
  })

  test("does not fire on a confident, ordinary answer", () => {
    const result = detectLowConfidenceResponse("Your GST filing for this quarter is due on the 20th.")
    expect(result.detected).toBe(false)
  })

  test("empty reply does not fire", () => {
    const result = detectLowConfidenceResponse("")
    expect(result.detected).toBe(false)
  })
})

describe("checkPreCallEscalation", () => {
  test("no signals -> no escalation", () => {
    const result = checkPreCallEscalation({ userMessage: "What's my leave balance?", historyLength: 0, isHighImpact: false, priorTaskFailed: false })
    expect(result.shouldEscalate).toBe(false)
    expect(result.signals).toEqual([])
  })

  test("high-impact alone escalates", () => {
    const result = checkPreCallEscalation({ userMessage: "Approve this payment", historyLength: 0, isHighImpact: true, priorTaskFailed: false })
    expect(result.shouldEscalate).toBe(true)
    expect(result.signals).toContain("high_impact")
  })

  test("prior task failure alone escalates", () => {
    const result = checkPreCallEscalation({ userMessage: "What happened?", historyLength: 1, isHighImpact: false, priorTaskFailed: true })
    expect(result.shouldEscalate).toBe(true)
    expect(result.signals).toContain("prior_task_failure")
  })

  test("multiple signals all recorded, not just the first", () => {
    const result = checkPreCallEscalation({ userMessage: "That's wrong, please approve it correctly", historyLength: 3, isHighImpact: true, priorTaskFailed: true })
    expect(result.shouldEscalate).toBe(true)
    expect(result.signals).toContain("reask_correction")
    expect(result.signals).toContain("high_impact")
    expect(result.signals).toContain("prior_task_failure")
    expect(result.signals.length).toBe(3)
  })
})

describe("deriveConfidenceLabel -- REVIEW-FRAMEWORK-WAVE4 honest confidence proxy", () => {
  test("high when the reply doesn't hedge and no pre-call signal fired", () => {
    expect(deriveConfidenceLabel("Your GST filing for this quarter is due on the 20th.", [])).toBe("high")
  })

  test("low when the delivered reply itself hedges, regardless of pre-call signals", () => {
    expect(deriveConfidenceLabel("I'm not sure what you mean by that.", [])).toBe("low")
    expect(deriveConfidenceLabel("I'm not sure what you mean by that.", ["high_impact"])).toBe("low")
  })

  test("medium when the reply doesn't hedge but a pre-call signal fired", () => {
    expect(deriveConfidenceLabel("Approving this payment now.", ["high_impact"])).toBe("medium")
  })

  test("hedging takes priority over pre-call signals -- checked first", () => {
    expect(deriveConfidenceLabel("I cannot be certain from the data available.", ["prior_task_failure", "reask_correction"])).toBe("low")
  })
})
