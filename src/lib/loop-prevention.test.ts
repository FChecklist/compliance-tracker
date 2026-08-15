/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { checkLoopBudget, shouldPromptSelfCheck, wouldCreateCycle, type TaskEscalationEdge } from "./loop-prevention"

describe("checkLoopBudget", () => {
  test("passes while under budget", () => {
    expect(checkLoopBudget({ iteration: 0, maxIterations: 40 })).toEqual({ passed: true })
    expect(checkLoopBudget({ iteration: 39, maxIterations: 40 })).toEqual({ passed: true })
  })

  test("fails once the budget is exhausted", () => {
    const result = checkLoopBudget({ iteration: 40, maxIterations: 40 })
    expect(result.passed).toBe(false)
    if (!result.passed) {
      expect(result.reason).toContain("40/40")
      expect(result.guidance).toContain("split it into smaller")
    }
  })

  test("fails if iteration somehow exceeds max", () => {
    expect(checkLoopBudget({ iteration: 41, maxIterations: 40 }).passed).toBe(false)
  })

  test("is deterministic -- same input gives same result", () => {
    const a = checkLoopBudget({ iteration: 40, maxIterations: 40 })
    const b = checkLoopBudget({ iteration: 40, maxIterations: 40 })
    expect(a).toEqual(b)
  })
})

describe("shouldPromptSelfCheck", () => {
  test("does not fire at iteration 0 -- redundant with the governance preamble already sent once", () => {
    expect(shouldPromptSelfCheck(0, 10)).toBe(false)
  })

  test("fires on exact multiples of everyN after iteration 0", () => {
    expect(shouldPromptSelfCheck(10, 10)).toBe(true)
    expect(shouldPromptSelfCheck(20, 10)).toBe(true)
    expect(shouldPromptSelfCheck(30, 10)).toBe(true)
  })

  test("does not fire on non-multiples", () => {
    expect(shouldPromptSelfCheck(1, 10)).toBe(false)
    expect(shouldPromptSelfCheck(9, 10)).toBe(false)
    expect(shouldPromptSelfCheck(11, 10)).toBe(false)
    expect(shouldPromptSelfCheck(25, 10)).toBe(false)
  })

  test("treats everyN <= 0 as never-prompt, not a divide-by-zero throw", () => {
    expect(shouldPromptSelfCheck(10, 0)).toBe(false)
    expect(shouldPromptSelfCheck(10, -5)).toBe(false)
  })

  test("is deterministic -- same input gives same result", () => {
    expect(shouldPromptSelfCheck(20, 10)).toBe(shouldPromptSelfCheck(20, 10))
  })
})

// GP-20 Phase 2: task-dependency-graph cycle detection. Pure predicate,
// tested directly per this repo's established convention (see
// escalation-ladder.ts's evaluateEscalationClaim tests) -- the DB-touching
// wrapper (task-dependency-graph.ts's recordTaskEscalationEdge()) is not
// tested directly, same posture as claimEscalation().
describe("wouldCreateCycle -- task-dependency-graph", () => {
  test("a brand-new task with no existing edges is never a cycle", () => {
    expect(wouldCreateCycle([], "A", "B")).toBe(false)
  })

  test("a task dispatching to itself is always a cycle (self-loop)", () => {
    expect(wouldCreateCycle([], "A", "A")).toBe(true)
  })

  test("2-task cycle: A escalates to B, then B escalating back to A is caught", () => {
    const edges: TaskEscalationEdge[] = [{ fromTaskId: "A", toTaskId: "B" }]
    expect(wouldCreateCycle(edges, "B", "A")).toBe(true)
  })

  test("3-task cycle: A -> B -> C, then C escalating back to A is caught", () => {
    const edges: TaskEscalationEdge[] = [
      { fromTaskId: "A", toTaskId: "B" },
      { fromTaskId: "B", toTaskId: "C" },
    ]
    expect(wouldCreateCycle(edges, "C", "A")).toBe(true)
  })

  test("3-task cycle is also caught one hop earlier: B escalating back to A given A -> B -> C", () => {
    const edges: TaskEscalationEdge[] = [
      { fromTaskId: "A", toTaskId: "B" },
      { fromTaskId: "B", toTaskId: "C" },
    ]
    expect(wouldCreateCycle(edges, "B", "A")).toBe(true)
  })

  test("a normal, non-cyclic escalation chain (A -> B -> C, no return edge) is NOT blocked", () => {
    const edges: TaskEscalationEdge[] = [{ fromTaskId: "A", toTaskId: "B" }]
    // B escalating onward to a brand-new task C -- forward progress, not a cycle.
    expect(wouldCreateCycle(edges, "B", "C")).toBe(false)
  })

  test("a longer non-cyclic chain (A -> B -> C -> D) is NOT blocked at any step", () => {
    let edges: TaskEscalationEdge[] = []
    for (const [from, to] of [["A", "B"], ["B", "C"], ["C", "D"]] as const) {
      expect(wouldCreateCycle(edges, from, to)).toBe(false)
      edges = [...edges, { fromTaskId: from, toTaskId: to }]
    }
  })

  test("two independent chains sharing no ancestry never look cyclic to each other", () => {
    const edges: TaskEscalationEdge[] = [
      { fromTaskId: "A", toTaskId: "B" },
      { fromTaskId: "X", toTaskId: "Y" },
    ]
    expect(wouldCreateCycle(edges, "Y", "B")).toBe(false)
    expect(wouldCreateCycle(edges, "B", "X")).toBe(false)
  })

  test("a diamond-shaped dependency (A -> B, A -> C, both -> D) is NOT a cycle", () => {
    const edges: TaskEscalationEdge[] = [
      { fromTaskId: "A", toTaskId: "B" },
      { fromTaskId: "A", toTaskId: "C" },
      { fromTaskId: "B", toTaskId: "D" },
    ]
    expect(wouldCreateCycle(edges, "C", "D")).toBe(false)
  })

  test("is deterministic -- same input gives same result", () => {
    const edges: TaskEscalationEdge[] = [{ fromTaskId: "A", toTaskId: "B" }]
    expect(wouldCreateCycle(edges, "B", "A")).toBe(wouldCreateCycle(edges, "B", "A"))
  })
})
