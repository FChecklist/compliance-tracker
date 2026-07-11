/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { validateTightTask, assembleTightTaskPrompt, type TightTask } from "./task-tightening"

const VALID: TightTask = {
  objective: "Add real PDF and Excel export to the reports dashboard",
  scope: "Only src/app/(app)/reports/page.tsx and package.json",
  successCriteria: "Both buttons produce a file matching the CSV export's columns; typecheck passes",
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
})

describe("assembleTightTaskPrompt", () => {
  test("renders all required fields with explicit labels", () => {
    const prompt = assembleTightTaskPrompt(VALID)
    expect(prompt).toContain("Objective: " + VALID.objective)
    expect(prompt).toContain("Scope: " + VALID.scope)
    expect(prompt).toContain(VALID.successCriteria)
    expect(prompt).toContain("Success Criteria")
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
