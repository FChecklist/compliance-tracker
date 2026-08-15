/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  evaluateConditionTree,
  validateConditionTree,
  canTransitionRuleStatus,
  ServiceError,
  type ConditionNode,
} from "./business-rules-service"

describe("evaluateConditionTree", () => {
  test("a single eq leaf matches when the field equals the value", () => {
    const node: ConditionNode = { field: "status", operator: "eq", value: "overdue" }
    expect(evaluateConditionTree(node, { status: "overdue" })).toBe(true)
    expect(evaluateConditionTree(node, { status: "closed" })).toBe(false)
  })

  test("numeric comparisons (gt/gte/lt/lte) never coerce a string into a number", () => {
    const node: ConditionNode = { field: "amount", operator: "gt", value: 1000 }
    expect(evaluateConditionTree(node, { amount: 1500 })).toBe(true)
    expect(evaluateConditionTree(node, { amount: "1500" })).toBe(false)
  })

  test("contains/not_contains operate on strings only", () => {
    expect(evaluateConditionTree({ field: "name", operator: "contains", value: "Ltd" }, { name: "Acme Ltd" })).toBe(true)
    expect(evaluateConditionTree({ field: "name", operator: "not_contains", value: "Ltd" }, { name: "Acme Ltd" })).toBe(false)
  })

  test("is_empty/is_not_empty treat undefined, null, and '' as empty", () => {
    expect(evaluateConditionTree({ field: "notes", operator: "is_empty" }, {})).toBe(true)
    expect(evaluateConditionTree({ field: "notes", operator: "is_empty" }, { notes: null })).toBe(true)
    expect(evaluateConditionTree({ field: "notes", operator: "is_empty" }, { notes: "" })).toBe(true)
    expect(evaluateConditionTree({ field: "notes", operator: "is_not_empty" }, { notes: "hi" })).toBe(true)
  })

  test("a dotted field path reads a nested value", () => {
    const node: ConditionNode = { field: "customer.tier", operator: "eq", value: "gold" }
    expect(evaluateConditionTree(node, { customer: { tier: "gold" } })).toBe(true)
  })

  test("an 'all' group requires every child to match (AND)", () => {
    const node: ConditionNode = {
      all: [
        { field: "amount", operator: "gt", value: 1000 },
        { field: "status", operator: "eq", value: "pending" },
      ],
    }
    expect(evaluateConditionTree(node, { amount: 5000, status: "pending" })).toBe(true)
    expect(evaluateConditionTree(node, { amount: 5000, status: "approved" })).toBe(false)
  })

  test("an 'any' group requires only one child to match (OR)", () => {
    const node: ConditionNode = {
      any: [
        { field: "status", operator: "eq", value: "overdue" },
        { field: "status", operator: "eq", value: "escalated" },
      ],
    }
    expect(evaluateConditionTree(node, { status: "escalated" })).toBe(true)
    expect(evaluateConditionTree(node, { status: "closed" })).toBe(false)
  })

  test("groups nest arbitrarily deep: (A OR B) AND C", () => {
    const node: ConditionNode = {
      all: [
        { any: [{ field: "region", operator: "eq", value: "IN" }, { field: "region", operator: "eq", value: "AE" }] },
        { field: "amount", operator: "gte", value: 50000 },
      ],
    }
    expect(evaluateConditionTree(node, { region: "AE", amount: 50000 })).toBe(true)
    expect(evaluateConditionTree(node, { region: "US", amount: 50000 })).toBe(false)
    expect(evaluateConditionTree(node, { region: "AE", amount: 10 })).toBe(false)
  })
})

describe("validateConditionTree", () => {
  test("accepts a well-formed leaf", () => {
    expect(() => validateConditionTree({ field: "amount", operator: "gt", value: 100 })).not.toThrow()
  })

  test("rejects an unknown operator", () => {
    expect(() => validateConditionTree({ field: "amount", operator: "between", value: 100 })).toThrow(ServiceError)
  })

  test("rejects a leaf with no field", () => {
    expect(() => validateConditionTree({ operator: "eq", value: 1 })).toThrow(ServiceError)
  })

  test("rejects an empty 'all'/'any' group", () => {
    expect(() => validateConditionTree({ all: [] })).toThrow(ServiceError)
  })

  test("accepts a nested group and validates every descendant", () => {
    const tree = { all: [{ field: "a", operator: "eq", value: 1 }, { any: [{ field: "b", operator: "eq", value: 2 }] }] }
    expect(() => validateConditionTree(tree)).not.toThrow()
  })

  test("rejects a malformed descendant inside a nested group", () => {
    const tree = { all: [{ field: "a", operator: "eq", value: 1 }, { any: [{ field: "b", operator: "not_a_real_op", value: 2 }] }] }
    expect(() => validateConditionTree(tree)).toThrow(ServiceError)
  })

  test("rejects nesting beyond depth 10", () => {
    let tree: unknown = { field: "leaf", operator: "eq", value: 1 }
    for (let i = 0; i < 11; i++) tree = { all: [tree] }
    expect(() => validateConditionTree(tree)).toThrow(ServiceError)
  })
})

describe("canTransitionRuleStatus (lifecycle state machine)", () => {
  test("draft can go active or archived", () => {
    expect(canTransitionRuleStatus("draft", "active")).toBe(true)
    expect(canTransitionRuleStatus("draft", "archived")).toBe(true)
    expect(canTransitionRuleStatus("draft", "deprecated")).toBe(false)
  })

  test("active can go deprecated or archived, never back to draft", () => {
    expect(canTransitionRuleStatus("active", "deprecated")).toBe(true)
    expect(canTransitionRuleStatus("active", "archived")).toBe(true)
    expect(canTransitionRuleStatus("active", "draft")).toBe(false)
  })

  test("deprecated can reactivate (back to active) or archive", () => {
    expect(canTransitionRuleStatus("deprecated", "active")).toBe(true)
    expect(canTransitionRuleStatus("deprecated", "archived")).toBe(true)
    expect(canTransitionRuleStatus("deprecated", "draft")).toBe(false)
  })

  test("archived is terminal -- no transition out of it", () => {
    expect(canTransitionRuleStatus("archived", "draft")).toBe(false)
    expect(canTransitionRuleStatus("archived", "active")).toBe(false)
    expect(canTransitionRuleStatus("archived", "deprecated")).toBe(false)
  })
})
