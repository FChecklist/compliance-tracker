// Wave 155 (TaskDocx_Evaluation.md): added alongside the new
// HIGH_IMPACT_CATEGORY_GUIDANCE map -- no test file existed for this
// module before (Wave 146 shipped without one). Scoped to what changed
// this wave, not a full backfill of detectHighImpactAction's own coverage.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { HIGH_IMPACT_CATEGORY_LABELS, HIGH_IMPACT_CATEGORY_GUIDANCE, detectHighImpactAction, checkHighImpactConfirmation, type HighImpactCategory } from "./high-impact-action-detector"

describe("HIGH_IMPACT_CATEGORY_GUIDANCE", () => {
  const categories = Object.keys(HIGH_IMPACT_CATEGORY_LABELS) as HighImpactCategory[]

  test("has a guidance entry for every category that has a label", () => {
    for (const category of categories) {
      expect(HIGH_IMPACT_CATEGORY_GUIDANCE[category]).toBeDefined()
      expect(HIGH_IMPACT_CATEGORY_GUIDANCE[category].length).toBeGreaterThan(0)
    }
  })

  test("every guidance message explains what to do (confirm or cancel)", () => {
    for (const category of categories) {
      const text = HIGH_IMPACT_CATEGORY_GUIDANCE[category].toLowerCase()
      expect(text.includes("confirm") || text.includes("cancel")).toBe(true)
    }
  })

  test("guidance messages are distinct per category, not one generic sentence copy-pasted", () => {
    const values = categories.map((c) => HIGH_IMPACT_CATEGORY_GUIDANCE[c])
    const unique = new Set(values)
    expect(unique.size).toBe(categories.length)
  })
})

// AI Architecture / Explainability & Transparency gap-closure (2026-07-18):
// "Explain Impact of Decisions" -- the 3 new categories added this wave.
describe("detectHighImpactAction -- new categories", () => {
  test("detects bulk operations", () => {
    const result = detectHighImpactAction("bulk reassign all leads to Priya")
    expect(result.isHighImpact).toBe(true)
    expect(result.category).toBe("bulk_operations")
  })

  test("detects outbound communication sends", () => {
    const result = detectHighImpactAction("send email to all customers about the price change")
    expect(result.isHighImpact).toBe(true)
    expect(result.category).toBe("communication_send")
  })

  test("detects financial posting", () => {
    const result = detectHighImpactAction("post journal entry for March depreciation")
    expect(result.isHighImpact).toBe(true)
    expect(result.category).toBe("financial_posting")
  })

  test("plain informational text is not flagged", () => {
    const result = detectHighImpactAction("show me last month's compliance summary")
    expect(result.isHighImpact).toBe(false)
    expect(result.category).toBeNull()
  })
})

// Human Override & Approval (HAB-02 gap closure, 2026-07-18): checkHighImpactConfirmation
// is the extracted, reusable gate task-service.ts's createTask now calls
// instead of reimplementing detectHighImpactAction + response-shaping
// inline. Covering it here (not just via task-service's own tests) so any
// future adopter can trust this contract directly.
describe("checkHighImpactConfirmation", () => {
  test("no high-impact phrase -> needsConfirmation: false", () => {
    const result = checkHighImpactConfirmation({ text: "Write the quarterly summary" })
    expect(result).toEqual({ needsConfirmation: false })
  })

  test("a high-impact phrase with confirmed: true skips detection entirely", () => {
    const result = checkHighImpactConfirmation({ text: "Delete the old vendor records", confirmed: true })
    expect(result).toEqual({ needsConfirmation: false })
  })

  test("a high-impact phrase with no confirmation returns the category/label/phrase/guidance", () => {
    const result = checkHighImpactConfirmation({ text: "Please approve this expense report" })
    expect(result.needsConfirmation).toBe(true)
    if (result.needsConfirmation) {
      expect(result.category).toBe("approval")
      expect(result.categoryLabel).toBe(HIGH_IMPACT_CATEGORY_LABELS.approval)
      expect(result.guidance).toBe(HIGH_IMPACT_CATEGORY_GUIDANCE.approval)
      expect(result.matchedPhrase.length).toBeGreaterThan(0)
    }
  })
})
