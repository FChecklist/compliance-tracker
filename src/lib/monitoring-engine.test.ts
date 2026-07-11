/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { computePerformanceScore, detectCircularDependency, type DependencyNode } from "./monitoring-engine"
import type { LoopBudgetContext, LoopBudgetResult } from "./loop-prevention"

function passedLoopBudget(iteration: number, maxIterations: number): { context: LoopBudgetContext; result: LoopBudgetResult } {
  return { context: { iteration, maxIterations }, result: { passed: true } }
}

function failedLoopBudget(iteration: number, maxIterations: number): { context: LoopBudgetContext; result: LoopBudgetResult } {
  return {
    context: { iteration, maxIterations },
    result: { passed: false, reason: "exhausted", guidance: "split the task" },
  }
}

describe("computePerformanceScore", () => {
  test("a clean execution (no error, fresh loop budget, no token usage/budget) scores a perfect 100", () => {
    const result = computePerformanceScore({
      loopBudget: passedLoopBudget(0, 10),
      completedWithoutError: true,
    })
    expect(result.score).toBe(100)
  })

  test("an execution that completed WITH an error is penalized hard, even with a fresh loop budget", () => {
    const clean = computePerformanceScore({ loopBudget: passedLoopBudget(0, 10), completedWithoutError: true })
    const errored = computePerformanceScore({ loopBudget: passedLoopBudget(0, 10), completedWithoutError: false })
    expect(errored.score).toBeLessThan(clean.score)
    expect(errored.completionComponent).toBe(0)
  })

  test("loop-budget near its limit lowers the score vs. a fresh budget, even when both technically passed", () => {
    const fresh = computePerformanceScore({ loopBudget: passedLoopBudget(1, 10), completedWithoutError: true })
    const nearLimit = computePerformanceScore({ loopBudget: passedLoopBudget(9, 10), completedWithoutError: true })
    expect(nearLimit.score).toBeLessThan(fresh.score)
  })

  test("an exhausted (failed) loop budget scores lower than a passed one at the same iteration count", () => {
    const passed = computePerformanceScore({ loopBudget: passedLoopBudget(9, 10), completedWithoutError: true })
    const failed = computePerformanceScore({ loopBudget: failedLoopBudget(10, 10), completedWithoutError: true })
    expect(failed.score).toBeLessThan(passed.score)
    expect(failed.loopBudgetComponent).toBe(0)
  })

  test("token usage near its budget lowers the score vs. usage well under budget", () => {
    const lightUsage = computePerformanceScore({
      usage: { promptTokens: 100, completionTokens: 100 },
      tokenBudget: 10_000,
      loopBudget: passedLoopBudget(0, 10),
      completedWithoutError: true,
    })
    const heavyUsage = computePerformanceScore({
      usage: { promptTokens: 9_000, completionTokens: 900 },
      tokenBudget: 10_000,
      loopBudget: passedLoopBudget(0, 10),
      completedWithoutError: true,
    })
    expect(heavyUsage.score).toBeLessThan(lightUsage.score)
  })

  test("usage without a tokenBudget does not penalize the score (no baseline to judge against)", () => {
    const withUsageNoBudget = computePerformanceScore({
      usage: { promptTokens: 50_000, completionTokens: 50_000 },
      loopBudget: passedLoopBudget(0, 10),
      completedWithoutError: true,
    })
    expect(withUsageNoBudget.score).toBe(100)
  })

  test("score is always within [0, 100]", () => {
    const worst = computePerformanceScore({
      usage: { promptTokens: 1_000_000, completionTokens: 1_000_000 },
      tokenBudget: 100,
      loopBudget: failedLoopBudget(10, 10),
      completedWithoutError: false,
    })
    expect(worst.score).toBeGreaterThanOrEqual(0)
    expect(worst.score).toBeLessThanOrEqual(100)
  })
})

describe("detectCircularDependency", () => {
  test("a genuine 2-node cycle (A depends on B, B depends on A) is correctly detected", () => {
    const nodes: DependencyNode[] = [
      { id: "A", dependsOn: ["B"] },
      { id: "B", dependsOn: ["A"] },
    ]
    const result = detectCircularDependency(nodes)
    expect(result.hasCycle).toBe(true)
    expect(result.cycleNodes.sort()).toEqual(["A", "B"])
  })

  test("a valid DAG (no cycle) is correctly NOT flagged", () => {
    const nodes: DependencyNode[] = [
      { id: "A", dependsOn: [] },
      { id: "B", dependsOn: ["A"] },
      { id: "C", dependsOn: ["A", "B"] },
      { id: "D", dependsOn: ["C"] },
    ]
    const result = detectCircularDependency(nodes)
    expect(result.hasCycle).toBe(false)
    expect(result.cycleNodes).toEqual([])
  })

  test("a longer 3-node cycle (A -> B -> C -> A) is detected with all 3 nodes reported", () => {
    const nodes: DependencyNode[] = [
      { id: "A", dependsOn: ["B"] },
      { id: "B", dependsOn: ["C"] },
      { id: "C", dependsOn: ["A"] },
    ]
    const result = detectCircularDependency(nodes)
    expect(result.hasCycle).toBe(true)
    expect(result.cycleNodes.sort()).toEqual(["A", "B", "C"])
  })

  test("a self-referencing node (A depends on itself) is detected as a cycle", () => {
    const nodes: DependencyNode[] = [{ id: "A", dependsOn: ["A"] }]
    const result = detectCircularDependency(nodes)
    expect(result.hasCycle).toBe(true)
    expect(result.cycleNodes).toEqual(["A"])
  })

  test("a cycle isolated to one branch doesn't falsely flag unrelated cycle-free nodes", () => {
    const nodes: DependencyNode[] = [
      { id: "A", dependsOn: [] },
      { id: "B", dependsOn: ["A"] },
      { id: "X", dependsOn: ["Y"] },
      { id: "Y", dependsOn: ["X"] },
    ]
    const result = detectCircularDependency(nodes)
    expect(result.hasCycle).toBe(true)
    expect(result.cycleNodes.sort()).toEqual(["X", "Y"])
  })

  test("dangling dependency references (no matching node) are ignored, not treated as a cycle", () => {
    const nodes: DependencyNode[] = [{ id: "A", dependsOn: ["ghost-node"] }]
    const result = detectCircularDependency(nodes)
    expect(result.hasCycle).toBe(false)
  })

  test("an empty node list has no cycle", () => {
    const result = detectCircularDependency([])
    expect(result.hasCycle).toBe(false)
    expect(result.cycleNodes).toEqual([])
  })
})
