import { describe, expect, test } from "bun:test"
import { evaluateAttributeCondition, evaluateAttributeConditions } from "./abac"

describe("evaluateAttributeCondition -- single-predicate ABAC evaluator", () => {
  test("numeric operators compare correctly", () => {
    expect(evaluateAttributeCondition({ field: "amount", operator: "gt", value: 100 }, { amount: 150 }, { unknownField: "match" })).toBe(true)
    expect(evaluateAttributeCondition({ field: "amount", operator: "gt", value: 100 }, { amount: 50 }, { unknownField: "match" })).toBe(false)
    expect(evaluateAttributeCondition({ field: "amount", operator: "lte", value: 100 }, { amount: 100 }, { unknownField: "match" })).toBe(true)
  })

  test("eq/neq compare as strings, tolerant of number-vs-string mismatch", () => {
    expect(evaluateAttributeCondition({ field: "region", operator: "eq", value: "uae" }, { region: "uae" }, { unknownField: "match" })).toBe(true)
    expect(evaluateAttributeCondition({ field: "code", operator: "eq", value: "42" }, { code: 42 }, { unknownField: "match" })).toBe(true)
    expect(evaluateAttributeCondition({ field: "region", operator: "neq", value: "uae" }, { region: "in" }, { unknownField: "match" })).toBe(true)
  })

  test("in matches against an array of candidates", () => {
    expect(evaluateAttributeCondition({ field: "dept", operator: "in", value: ["finance", "legal"] }, { dept: "legal" }, { unknownField: "match" })).toBe(true)
    expect(evaluateAttributeCondition({ field: "dept", operator: "in", value: ["finance", "legal"] }, { dept: "sales" }, { unknownField: "match" })).toBe(false)
  })

  test("contains matches substrings and array membership", () => {
    expect(evaluateAttributeCondition({ field: "title", operator: "contains", value: "URGENT" }, { title: "this is urgent work" }, { unknownField: "match" })).toBe(true)
    expect(evaluateAttributeCondition({ field: "tags", operator: "contains", value: "vip" }, { tags: ["standard", "vip"] }, { unknownField: "match" })).toBe(true)
  })

  test("unknownField policy governs behavior when the attribute is absent", () => {
    const condition = { field: "missing", operator: "eq" as const, value: "x" }
    expect(evaluateAttributeCondition(condition, {}, { unknownField: "match" })).toBe(true)
    expect(evaluateAttributeCondition(condition, {}, { unknownField: "no_match" })).toBe(false)
  })

  test("non-numeric values on a numeric operator fail safely rather than throwing", () => {
    expect(evaluateAttributeCondition({ field: "amount", operator: "gt", value: 100 }, { amount: "not-a-number" }, { unknownField: "match" })).toBe(false)
  })
})

describe("evaluateAttributeConditions -- AND-combined multi-attribute ABAC gate", () => {
  test("empty or absent condition list always matches", () => {
    expect(evaluateAttributeConditions(null, {}, { unknownField: "match" })).toBe(true)
    expect(evaluateAttributeConditions([], { anything: 1 }, { unknownField: "match" })).toBe(true)
  })

  test("all conditions must match (AND)", () => {
    const conditions = [
      { field: "amount", operator: "gt" as const, value: 10000 },
      { field: "department", operator: "eq" as const, value: "finance" },
    ]
    expect(evaluateAttributeConditions(conditions, { amount: 20000, department: "finance" }, { unknownField: "match" })).toBe(true)
    expect(evaluateAttributeConditions(conditions, { amount: 20000, department: "sales" }, { unknownField: "match" })).toBe(false)
    expect(evaluateAttributeConditions(conditions, { amount: 5000, department: "finance" }, { unknownField: "match" })).toBe(false)
  })
})
