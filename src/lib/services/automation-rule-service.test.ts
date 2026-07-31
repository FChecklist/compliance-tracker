// Task #47 (PM feature-parity gap analysis): tests the pure, DB-free
// decision functions automation-rule-service.ts exports --
// conditionsMatch() and planRuleChain() -- rather than exercising the
// withTenantContext/live-DB-backed evaluateAndRunRules() itself, matching
// this repo's established pattern of not touching a live DB from a
// .test.ts file (see crm-service.test.ts's own header note).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { conditionsMatch, planRuleChain, type RuleRecord } from "./automation-rule-service"

describe("conditionsMatch -- single-condition (legacy) + multi-condition AND/OR", () => {
  test("no condition set (empty object) fires on every event of the trigger type", () => {
    expect(conditionsMatch({}, { status: "anything" })).toBe(true)
  })

  test("null/non-object conditions also fire on every event", () => {
    expect(conditionsMatch(null, { status: "x" })).toBe(true)
    expect(conditionsMatch(undefined, { status: "x" })).toBe(true)
  })

  test("legacy single condition -- equals match", () => {
    expect(conditionsMatch({ field: "status", value: "overdue" }, { status: "overdue" })).toBe(true)
    expect(conditionsMatch({ field: "status", value: "overdue" }, { status: "resolved" })).toBe(false)
  })

  test("legacy single condition -- not_equals operator", () => {
    expect(conditionsMatch({ field: "status", operator: "not_equals", value: "resolved" }, { status: "overdue" })).toBe(true)
    expect(conditionsMatch({ field: "status", operator: "not_equals", value: "resolved" }, { status: "resolved" })).toBe(false)
  })

  test("condition field supports dot-path lookup into nested payload", () => {
    expect(conditionsMatch({ field: "issue.priority", value: "urgent" }, { issue: { priority: "urgent" } })).toBe(true)
    expect(conditionsMatch({ field: "issue.priority", value: "urgent" }, { issue: { priority: "low" } })).toBe(false)
  })

  test("AND group -- every condition must match", () => {
    const conditions = { combinator: "AND" as const, conditions: [
      { field: "status", value: "overdue" },
      { field: "priority", value: "high" },
    ] }
    expect(conditionsMatch(conditions, { status: "overdue", priority: "high" })).toBe(true)
    expect(conditionsMatch(conditions, { status: "overdue", priority: "low" })).toBe(false)
    expect(conditionsMatch(conditions, { status: "resolved", priority: "high" })).toBe(false)
  })

  test("OR group -- any condition matching is enough", () => {
    const conditions = { combinator: "OR" as const, conditions: [
      { field: "status", value: "overdue" },
      { field: "priority", value: "urgent" },
    ] }
    expect(conditionsMatch(conditions, { status: "overdue", priority: "low" })).toBe(true)
    expect(conditionsMatch(conditions, { status: "resolved", priority: "urgent" })).toBe(true)
    expect(conditionsMatch(conditions, { status: "resolved", priority: "low" })).toBe(false)
  })

  test("empty conditions array in a group is a no-op match (fires on every event)", () => {
    expect(conditionsMatch({ combinator: "AND", conditions: [] }, { status: "anything" })).toBe(true)
  })
})

function rule(overrides: Partial<RuleRecord>): RuleRecord {
  return {
    id: overrides.id ?? "rule-1",
    name: overrides.name ?? "Test rule",
    triggerType: overrides.triggerType ?? "start",
    triggerConditions: overrides.triggerConditions ?? {},
    actionType: overrides.actionType ?? "notify_user",
    actionConfig: overrides.actionConfig ?? {},
  }
}

describe("planRuleChain -- rule chaining + real cycle detection", () => {
  test("no chaining -- a plain rule just fires once for its own trigger type", () => {
    const rules = [rule({ id: "r1", triggerType: "pms_issue.status_changed", actionType: "notify_user" })]
    const plan = planRuleChain(rules, "pms_issue.status_changed", {})
    expect(plan.firings.map((f) => f.rule.id)).toEqual(["r1"])
    expect(plan.cycles).toEqual([])
  })

  test("a rule for a different trigger type never fires", () => {
    const rules = [rule({ id: "r1", triggerType: "notice.status_changed" })]
    const plan = planRuleChain(rules, "pms_issue.status_changed", {})
    expect(plan.firings).toEqual([])
  })

  test("chains through trigger_rule into a second trigger type's rules", () => {
    const rules = [
      rule({ id: "r1", triggerType: "start", actionType: "trigger_rule", actionConfig: { targetTriggerType: "middle" } }),
      rule({ id: "r2", triggerType: "middle", actionType: "notify_user" }),
    ]
    const plan = planRuleChain(rules, "start", {})
    expect(plan.firings.map((f) => f.rule.id)).toEqual(["r1", "r2"])
    expect(plan.cycles).toEqual([])
  })

  test("multi-hop chain (A -> B -> C), no cycle", () => {
    const rules = [
      rule({ id: "a", triggerType: "eventA", actionType: "trigger_rule", actionConfig: { targetTriggerType: "eventB" } }),
      rule({ id: "b", triggerType: "eventB", actionType: "trigger_rule", actionConfig: { targetTriggerType: "eventC" } }),
      rule({ id: "c", triggerType: "eventC", actionType: "notify_user" }),
    ]
    const plan = planRuleChain(rules, "eventA", {})
    expect(plan.firings.map((f) => f.rule.id)).toEqual(["a", "b", "c"])
    expect(plan.cycles).toEqual([])
  })

  test("real cycle detection stops an infinite chain (A -> B -> A)", () => {
    const rules = [
      rule({ id: "a", triggerType: "eventA", actionType: "trigger_rule", actionConfig: { targetTriggerType: "eventB" } }),
      rule({ id: "b", triggerType: "eventB", actionType: "trigger_rule", actionConfig: { targetTriggerType: "eventA" } }),
    ]
    // If cycle detection didn't work, this call would recurse forever and
    // the test would hang/time out rather than returning -- reaching the
    // assertions below is itself proof the chain terminated.
    const plan = planRuleChain(rules, "eventA", {})
    expect(plan.firings.map((f) => f.rule.id)).toEqual(["a", "b"])
    expect(plan.cycles).toEqual([{ ruleId: "b", triggerType: "eventB", targetTriggerType: "eventA" }])
  })

  test("a rule chaining directly to its own trigger type is a self-cycle, not a second firing", () => {
    const rules = [
      rule({ id: "a", triggerType: "eventA", actionType: "trigger_rule", actionConfig: { targetTriggerType: "eventA" } }),
    ]
    const plan = planRuleChain(rules, "eventA", {})
    expect(plan.firings.map((f) => f.rule.id)).toEqual(["a"])
    expect(plan.cycles).toEqual([{ ruleId: "a", triggerType: "eventA", targetTriggerType: "eventA" }])
  })

  test("fan-in (two rules chaining to the same downstream trigger type) is NOT a false-positive cycle", () => {
    const rules = [
      rule({ id: "a", triggerType: "start", actionType: "trigger_rule", actionConfig: { targetTriggerType: "shared" } }),
      rule({ id: "b", triggerType: "start", actionType: "trigger_rule", actionConfig: { targetTriggerType: "shared" } }),
      rule({ id: "c", triggerType: "shared", actionType: "notify_user" }),
    ]
    const plan = planRuleChain(rules, "start", {})
    // Both a and b fire (both match trigger "start"); "shared" (rule c)
    // only fires once even though two different rules chained into it --
    // depth-first order means c executes as part of a's chain link before
    // b's own turn, so the order is [a, c, b], not [a, b, c].
    expect(plan.firings.map((f) => f.rule.id)).toEqual(["a", "c", "b"])
    expect(plan.firings.filter((f) => f.rule.id === "c")).toHaveLength(1)
    expect(plan.cycles).toEqual([])
  })

  test("a longer cycle (A -> B -> C -> A) is still caught, not just direct 2-hop loops", () => {
    const rules = [
      rule({ id: "a", triggerType: "eventA", actionType: "trigger_rule", actionConfig: { targetTriggerType: "eventB" } }),
      rule({ id: "b", triggerType: "eventB", actionType: "trigger_rule", actionConfig: { targetTriggerType: "eventC" } }),
      rule({ id: "c", triggerType: "eventC", actionType: "trigger_rule", actionConfig: { targetTriggerType: "eventA" } }),
    ]
    const plan = planRuleChain(rules, "eventA", {})
    expect(plan.firings.map((f) => f.rule.id)).toEqual(["a", "b", "c"])
    expect(plan.cycles).toEqual([{ ruleId: "c", triggerType: "eventC", targetTriggerType: "eventA" }])
  })

  test("chaining respects multi-condition matching downstream -- non-matching target rule doesn't fire", () => {
    const rules = [
      rule({ id: "a", triggerType: "start", actionType: "trigger_rule", actionConfig: { targetTriggerType: "middle" } }),
      rule({
        id: "b", triggerType: "middle", actionType: "notify_user",
        triggerConditions: { combinator: "AND", conditions: [{ field: "priority", value: "urgent" }] },
      }),
    ]
    const matching = planRuleChain(rules, "start", { priority: "urgent" })
    expect(matching.firings.map((f) => f.rule.id)).toEqual(["a", "b"])

    const nonMatching = planRuleChain(rules, "start", { priority: "low" })
    expect(nonMatching.firings.map((f) => f.rule.id)).toEqual(["a"])
  })
})
