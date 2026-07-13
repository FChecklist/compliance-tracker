// Priority 13 (Document Correspondent/Type Auto-Classification). Tests the
// pure decision functions (evaluateRule/classifyDocument/
// validateMatchingRuleInput) directly -- the DB-touching functions
// (listMatchingRules, applyClassificationWithDb, etc.) delegate to these but
// also touch a live DB, so exercising them end-to-end would break this
// repo's established pattern of not touching a live DB from a .test.ts file
// (see asset-registry-service.test.ts, task-service.test.ts).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  evaluateRule, classifyDocument, validateMatchingRuleInput,
  type MatchingRule, type CreateMatchingRuleInput,
} from "./document-classification-service"

function rule(overrides: Partial<MatchingRule> = {}): MatchingRule {
  return {
    id: "rule_1",
    isActive: true,
    matchField: "both",
    ruleType: "any_word",
    pattern: "invoice",
    priority: 100,
    targetCorrespondentId: null,
    targetCategory: "invoice",
    targetTags: null,
    ...overrides,
  }
}

describe("evaluateRule -- the 4 Paperless-ngx-style match algorithms", () => {
  test("any_word matches if any whitespace-split word appears (case-insensitive)", () => {
    expect(evaluateRule(rule({ ruleType: "any_word", pattern: "invoice receipt" }), { fileName: "March_Invoice.pdf" })).toBe(true)
    expect(evaluateRule(rule({ ruleType: "any_word", pattern: "invoice receipt" }), { fileName: "March_Contract.pdf" })).toBe(false)
  })

  test("all_words requires every word to appear, in any order", () => {
    expect(evaluateRule(rule({ ruleType: "all_words", pattern: "annual report" }), { fileName: "Report_Annual_2026.pdf" })).toBe(true)
    expect(evaluateRule(rule({ ruleType: "all_words", pattern: "annual report" }), { fileName: "Annual_Summary.pdf" })).toBe(false)
  })

  test("exact matches the whole pattern as a single case-insensitive substring", () => {
    expect(evaluateRule(rule({ ruleType: "exact", pattern: "GST Return" }), { fileName: "Q1_gst return_filing.pdf" })).toBe(true)
    expect(evaluateRule(rule({ ruleType: "exact", pattern: "GST Return" }), { fileName: "GST_Return.pdf" })).toBe(false) // underscore, not the exact phrase "GST Return"
  })

  test("regex runs the pattern as a real case-insensitive RegExp", () => {
    expect(evaluateRule(rule({ ruleType: "regex", pattern: "^INV-\\d+" }), { fileName: "INV-2026001.pdf" })).toBe(true)
    expect(evaluateRule(rule({ ruleType: "regex", pattern: "^INV-\\d+" }), { fileName: "invoice.pdf" })).toBe(false)
  })

  test("an invalid regex pattern never matches (and never throws)", () => {
    expect(() => evaluateRule(rule({ ruleType: "regex", pattern: "(unclosed" }), { fileName: "anything.pdf" })).not.toThrow()
    expect(evaluateRule(rule({ ruleType: "regex", pattern: "(unclosed" }), { fileName: "anything.pdf" })).toBe(false)
  })

  test("matchField='filename' ignores extractedText entirely", () => {
    expect(evaluateRule(rule({ matchField: "filename", ruleType: "any_word", pattern: "invoice" }), { fileName: "scan001.pdf", extractedText: "This is an invoice from Acme" })).toBe(false)
  })

  test("matchField='content' ignores fileName entirely", () => {
    expect(evaluateRule(rule({ matchField: "content", ruleType: "any_word", pattern: "invoice" }), { fileName: "invoice_scan.pdf", extractedText: "A general receipt" })).toBe(false)
    expect(evaluateRule(rule({ matchField: "content", ruleType: "any_word", pattern: "invoice" }), { fileName: "scan001.pdf", extractedText: "This is an invoice from Acme" })).toBe(true)
  })

  test("matchField='both' (default) checks filename OR extracted text", () => {
    expect(evaluateRule(rule({ matchField: "both", ruleType: "any_word", pattern: "invoice" }), { fileName: "scan001.pdf", extractedText: "This is an invoice" })).toBe(true)
  })

  test("a 'content'/'both' rule never matches when extractedText hasn't arrived yet (real, disclosed limitation, not a crash)", () => {
    expect(evaluateRule(rule({ matchField: "content", ruleType: "any_word", pattern: "invoice" }), { fileName: "scan001.pdf" })).toBe(false)
  })
})

describe("classifyDocument -- first-matching-active-rule-wins, priority-ordered", () => {
  test("returns null when no rule matches", () => {
    expect(classifyDocument([rule({ pattern: "invoice" })], { fileName: "contract.pdf" })).toBeNull()
  })

  test("returns the matched rule's target fields", () => {
    const result = classifyDocument([rule({ id: "r1", pattern: "invoice", targetCategory: "invoice", targetCorrespondentId: "corr_1", targetTags: ["finance"] })], { fileName: "March_Invoice.pdf" })
    expect(result).toEqual({ matchedRuleId: "r1", correspondentId: "corr_1", category: "invoice", tags: ["finance"] })
  })

  test("inactive rules are never evaluated", () => {
    expect(classifyDocument([rule({ isActive: false, pattern: "invoice" })], { fileName: "invoice.pdf" })).toBeNull()
  })

  test("lower priority number wins when multiple rules match, regardless of array order", () => {
    const low = rule({ id: "r_low", priority: 10, pattern: "invoice", targetCategory: "priority_low" })
    const high = rule({ id: "r_high", priority: 200, pattern: "invoice", targetCategory: "priority_high" })
    expect(classifyDocument([high, low], { fileName: "invoice.pdf" })?.category).toBe("priority_low")
  })

  test("id is a deterministic tie-break when priority is equal", () => {
    const a = rule({ id: "rule_a", priority: 50, pattern: "invoice", targetCategory: "from_a" })
    const b = rule({ id: "rule_b", priority: 50, pattern: "invoice", targetCategory: "from_b" })
    expect(classifyDocument([b, a], { fileName: "invoice.pdf" })?.category).toBe("from_a")
  })

  test("does not mutate the input rules array", () => {
    const rules = [rule({ id: "r2", priority: 200 }), rule({ id: "r1", priority: 10 })]
    const original = [...rules]
    classifyDocument(rules, { fileName: "invoice.pdf" })
    expect(rules).toEqual(original)
  })
})

function validInput(overrides: Partial<CreateMatchingRuleInput> = {}): CreateMatchingRuleInput {
  return { name: "Invoices from Acme", ruleType: "any_word", pattern: "invoice", targetCategory: "invoice", ...overrides }
}

describe("validateMatchingRuleInput -- required-field + at-least-one-target gate", () => {
  test("a fully-formed input passes", () => {
    expect(validateMatchingRuleInput(validInput())).toEqual({ valid: true })
  })

  test("rejects a blank name", () => {
    const result = validateMatchingRuleInput(validInput({ name: "" }))
    expect(result.valid).toBe(false)
  })

  test("rejects a blank pattern", () => {
    const result = validateMatchingRuleInput(validInput({ pattern: "  " }))
    expect(result.valid).toBe(false)
  })

  test("rejects an invalid ruleType", () => {
    // @ts-expect-error deliberately passing an invalid ruleType to exercise the guard
    const result = validateMatchingRuleInput(validInput({ ruleType: "fuzzy" }))
    expect(result.valid).toBe(false)
  })

  test("rejects an invalid matchField", () => {
    // @ts-expect-error deliberately passing an invalid matchField to exercise the guard
    const result = validateMatchingRuleInput(validInput({ matchField: "everywhere" }))
    expect(result.valid).toBe(false)
  })

  test("rejects a rule with no target at all (correspondent, category, or tags)", () => {
    const result = validateMatchingRuleInput(validInput({ targetCategory: undefined }))
    expect(result.valid).toBe(false)
  })

  test("accepts a rule whose only target is targetTags", () => {
    expect(validateMatchingRuleInput(validInput({ targetCategory: undefined, targetTags: ["urgent"] }))).toEqual({ valid: true })
  })

  test("accepts a rule whose only target is targetCorrespondentId", () => {
    expect(validateMatchingRuleInput(validInput({ targetCategory: undefined, targetCorrespondentId: "corr_1" }))).toEqual({ valid: true })
  })

  test("rejects an invalid regex pattern when ruleType is 'regex'", () => {
    const result = validateMatchingRuleInput(validInput({ ruleType: "regex", pattern: "(unclosed" }))
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("regular expression")
  })

  test("accepts a valid regex pattern when ruleType is 'regex'", () => {
    expect(validateMatchingRuleInput(validInput({ ruleType: "regex", pattern: "^INV-\\d+" }))).toEqual({ valid: true })
  })
})
