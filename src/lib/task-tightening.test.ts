/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { validateTightTask, assembleTightTaskPrompt, validateTaskBrief, detectAmbiguousLanguage, detectFieldContradiction, type TightTask } from "./task-tightening"

const VALID: TightTask = {
  objective: "Add real PDF and Excel export to the reports dashboard",
  scope: "Only src/app/(app)/reports/page.tsx and package.json",
  successCriteria: "Both buttons produce a file matching the CSV export's columns; typecheck passes",
  complexityTier: "mechanical",
  expectedOutput: "A downloadable PDF file matching the CSV export's row/column structure",
}

describe("validateTightTask", () => {
  test("accepts a fully specified task", () => {
    expect(validateTightTask(VALID)).toEqual({ valid: true })
  })

  test("rejects a missing objective", () => {
    const result = validateTightTask({ ...VALID, objective: "" })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("Objective is missing")
  })

  test("rejects a missing scope", () => {
    const result = validateTightTask({ ...VALID, scope: undefined })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("Scope is missing")
  })

  test("rejects a missing success criteria", () => {
    const result = validateTightTask({ ...VALID, successCriteria: "" })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("Success criteria is missing")
  })

  test("rejects placeholder text even if non-empty", () => {
    const result = validateTightTask({ ...VALID, scope: "TBD" })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("placeholder")
  })

  test("rejects placeholder variants (todo, n/a, ..., fill in)", () => {
    for (const placeholder of ["todo", "n/a", "...", "fill in", "  "]) {
      const result = validateTightTask({ ...VALID, objective: placeholder })
      expect(result.valid).toBe(false)
    }
  })

  test("rejects a too-short field that isn't a recognized placeholder", () => {
    const result = validateTightTask({ ...VALID, successCriteria: "done" })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("too short")
  })

  test("checks fields in order: objective before scope before success criteria", () => {
    const result = validateTightTask({})
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("Objective")
  })

  test("constraints is optional -- a valid task without it still passes", () => {
    expect(validateTightTask({ ...VALID, constraints: undefined })).toEqual({ valid: true })
  })

  test("rejects a missing expected output", () => {
    const result = validateTightTask({ ...VALID, expectedOutput: "" })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("Expected output is missing")
  })

  test("rejects a missing complexity tier", () => {
    // @ts-expect-error -- deliberately testing the missing-field case
    const result = validateTightTask({ ...VALID, complexityTier: undefined })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("Complexity tier is missing")
  })

  test("rejects an unrecognized complexity tier", () => {
    // @ts-expect-error -- deliberately testing an invalid enum value
    const result = validateTightTask({ ...VALID, complexityTier: "extreme" })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("not recognized")
  })

  test("accepts all 3 valid complexity tiers", () => {
    for (const tier of ["mechanical", "integrative", "judgment"] as const) {
      expect(validateTightTask({ ...VALID, complexityTier: tier })).toEqual({ valid: true })
    }
  })
})

describe("assembleTightTaskPrompt", () => {
  test("renders all required fields with explicit labels", () => {
    const prompt = assembleTightTaskPrompt(VALID)
    expect(prompt).toContain("Objective: " + VALID.objective)
    expect(prompt).toContain("Scope: " + VALID.scope)
    expect(prompt).toContain(VALID.successCriteria)
    expect(prompt).toContain("Success Criteria")
    expect(prompt).toContain("Complexity tier: mechanical")
    expect(prompt).toContain("Expected Output")
    expect(prompt).toContain(VALID.expectedOutput)
  })

  test("omits the Constraints line when not provided", () => {
    const prompt = assembleTightTaskPrompt(VALID)
    expect(prompt).not.toContain("Constraints:")
  })

  test("includes the Constraints line when provided", () => {
    const prompt = assembleTightTaskPrompt({ ...VALID, constraints: "Max 5 files read; do not touch ai-os/" })
    expect(prompt).toContain("Constraints: Max 5 files read; do not touch ai-os/")
  })

  test("always includes the stop-and-escalate instruction", () => {
    const prompt = assembleTightTaskPrompt(VALID)
    expect(prompt.toLowerCase()).toContain("stop and say so")
  })
})

describe("validateTaskBrief -- conservative, for real customer task titles", () => {
  test("accepts realistic short real-world task titles with no description", () => {
    for (const title of ["Follow up with vendor", "Call vendor", "Review contract", "File TDS return"]) {
      expect(validateTaskBrief({ title })).toEqual({ valid: true })
    }
  })

  test("accepts a title with a description", () => {
    expect(validateTaskBrief({ title: "Follow up", description: "Call the vendor about the delayed shipment" })).toEqual({ valid: true })
  })

  test("rejects an empty title", () => {
    const result = validateTaskBrief({ title: "" })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("no title")
  })

  test("rejects a whitespace-only title", () => {
    const result = validateTaskBrief({ title: "   " })
    expect(result.valid).toBe(false)
  })

  test("rejects a placeholder title", () => {
    const result = validateTaskBrief({ title: "TBD" })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("placeholder")
  })

  test("rejects a near-empty single-character title", () => {
    const result = validateTaskBrief({ title: "x" })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("too short")
  })

  test("does not require a description at all", () => {
    expect(validateTaskBrief({ title: "Follow up", description: undefined })).toEqual({ valid: true })
    expect(validateTaskBrief({ title: "Follow up", description: null })).toEqual({ valid: true })
  })

  test("rejects a title+description with ambiguous language", () => {
    const result = validateTaskBrief({ title: "Fix the reports page", description: "Handle edge cases as appropriate" })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("vague")
  })
})

describe("detectAmbiguousLanguage -- Wave 166, area 7", () => {
  test("detects a real hedge phrase", () => {
    expect(detectAmbiguousLanguage("Handle edge cases as appropriate")).toEqual({ detected: true, matchedPhrase: "as appropriate" })
  })
  test("detects 'use your judgment'", () => {
    expect(detectAmbiguousLanguage("If it breaks, use your judgment")).toEqual({ detected: true, matchedPhrase: "use your judgment" })
  })
  test("does not flag specific, concrete text", () => {
    expect(detectAmbiguousLanguage("Add a PDF export button next to the existing CSV export button")).toEqual({ detected: false })
  })
  test("does not flag legitimate use of common words that aren't the hedge phrases", () => {
    expect(detectAmbiguousLanguage("Some tasks need review, but this one is fully specified")).toEqual({ detected: false })
  })
})

describe("detectFieldContradiction -- Wave 166, area 7", () => {
  test("detects a real contradiction between constraints and objective", () => {
    const result = detectFieldContradiction({
      objective: "Modify the database schema to add a new column",
      constraints: "Do not modify the database schema under any circumstances",
    })
    expect(result.detected).toBe(true)
  })
  test("passes when constraints and objective don't overlap", () => {
    const result = detectFieldContradiction({
      objective: "Add a PDF export button to the reports page",
      constraints: "Do not touch the CSV export code",
    })
    expect(result).toEqual({ detected: false })
  })
  test("passes when there are no constraints at all", () => {
    expect(detectFieldContradiction({ objective: "Add a PDF export button" })).toEqual({ detected: false })
  })
  test("a real full TightTask with a genuine contradiction is rejected by validateTightTask", () => {
    const result = validateTightTask({
      ...VALID,
      objective: "Delete the deprecated legacy-report-export module entirely",
      constraints: "Do not delete the legacy-report-export module -- keep it for backward compatibility",
    })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("Constraints say not to do")
  })
})
