import { describe, expect, test } from "bun:test"
import { parseLlamaGuardOutput } from "./layer3-runtime-guardrails"

describe("parseLlamaGuardOutput", () => {
  test("parses a safe verdict", () => {
    const result = parseLlamaGuardOutput("safe")
    expect(result.safe).toBe(true)
    expect(result.categories).toHaveLength(0)
  })

  test("parses an unsafe verdict with comma-separated categories", () => {
    const result = parseLlamaGuardOutput("unsafe\nS1,S9")
    expect(result.safe).toBe(false)
    expect(result.categories).toEqual(["S1", "S9"])
  })

  test("parses an unsafe verdict with newline-separated categories", () => {
    const result = parseLlamaGuardOutput("unsafe\nS1\nS9")
    expect(result.safe).toBe(false)
    expect(result.categories).toEqual(["S1", "S9"])
  })

  test("is tolerant of surrounding whitespace", () => {
    const result = parseLlamaGuardOutput("  safe  \n")
    expect(result.safe).toBe(true)
  })

  test("retains the raw text for audit purposes", () => {
    const result = parseLlamaGuardOutput("unsafe\nS1")
    expect(result.raw).toBe("unsafe\nS1")
  })
})
