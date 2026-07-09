// Wave 155 (TaskDocx_Evaluation.md): added alongside the new
// HIGH_IMPACT_CATEGORY_GUIDANCE map -- no test file existed for this
// module before (Wave 146 shipped without one). Scoped to what changed
// this wave, not a full backfill of detectHighImpactAction's own coverage.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { HIGH_IMPACT_CATEGORY_LABELS, HIGH_IMPACT_CATEGORY_GUIDANCE, type HighImpactCategory } from "./high-impact-action-detector"

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
