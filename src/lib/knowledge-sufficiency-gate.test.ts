import { describe, expect, test } from "bun:test"
import { detectKnowledgeGap } from "./knowledge-sufficiency-gate"

describe("detectKnowledgeGap -- GP-06 Knowledge self-check proxy", () => {
  test("detects an explicit knowledge-gap admission", () => {
    const result = detectKnowledgeGap("I don't have access to the payroll module's internals, so I can't confirm this.")
    expect(result.insufficientKnowledge).toBe(true)
    expect(result.matchedPhrase).toBe("i don't have access to")
  })

  test("does not fire on ordinary confident output", () => {
    const result = detectKnowledgeGap("The payroll module computes tax withholding using the FY24 slab rates.")
    expect(result.insufficientKnowledge).toBe(false)
    expect(result.matchedPhrase).toBeNull()
  })

  test("handles empty text without throwing", () => {
    expect(detectKnowledgeGap("")).toEqual({ insufficientKnowledge: false, matchedPhrase: null })
  })

  test("is case-insensitive and matches mid-sentence", () => {
    const result = detectKnowledgeGap("Honestly, I AM NOT FAMILIAR WITH this integration's error codes.")
    expect(result.insufficientKnowledge).toBe(true)
  })
})
