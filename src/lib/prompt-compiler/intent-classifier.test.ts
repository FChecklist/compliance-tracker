/// <reference types="bun-types" />
// VERIDIAN_Architecture_v2.0 phase_2: engine-intent pure unit tests.
import { describe, expect, test } from "bun:test"
import { classify, extractIntent } from "./intent-classifier"

describe("classify -- category classification (port of classifier.py)", () => {
  test("classifies a code-fix message as CODE with keyword/pattern evidence", () => {
    const result = classify("Fix the authentication bug in the login function")
    expect(result.category).toBe("CODE")
    expect(result.confidence).toBeGreaterThan(0)
    expect(result.keywordsFound.length).toBeGreaterThan(0)
  })

  test("classifies a bare question as QUERY", () => {
    const result = classify("What is the deployment status?")
    expect(result.category).toBe("QUERY")
  })

  test("classifies a deploy request as OPS", () => {
    const result = classify("Deploy the server to production and configure the environment")
    expect(result.category).toBe("OPS")
  })

  test("defaults to GENERAL when the top score is below 0.05", () => {
    const result = classify("xyz qwerty zzzzz")
    expect(result.category).toBe("GENERAL")
    expect(result.confidence).toBe(0.1)
  })

  test("scores is populated for every category", () => {
    const result = classify("hello there")
    expect(Object.keys(result.scores)).toEqual(["CODE", "ANALYSIS", "OPS", "QUERY", "TASK", "GENERAL"])
  })
})

describe("extractIntent -- multi-level (primary/secondary/implicit)", () => {
  test("primary intent from the first action verb", () => {
    const intent = extractIntent("Fix the login bug")
    expect(intent.primary).toBe("FIX")
    expect(intent.implicit).toBeNull()
  })

  test("secondary intent from a second, distinct action verb (compound instruction)", () => {
    const intent = extractIntent("Fix the bug and then test the endpoint")
    expect(intent.primary).toBe("FIX")
    expect(intent.secondary).toBe("TEST")
  })

  test("no secondary when only one action verb is present", () => {
    const intent = extractIntent("Fix the login bug urgently")
    expect(intent.secondary).toBeNull()
  })

  test("implicit QUERY when no action verb is found but the text is a question", () => {
    const intent = extractIntent("Is the server healthy?")
    expect(intent.primary).toBe("UNKNOWN")
    expect(intent.implicit).toBe("QUERY")
  })

  test("implicit TASK when no action verb and no question mark", () => {
    const intent = extractIntent("The quarterly compliance report")
    expect(intent.primary).toBe("UNKNOWN")
    expect(intent.implicit).toBe("TASK")
  })
})
