// Wave 166 (tree4-unified/10-merged-governance-layer.yaml U-D14 "Monitoring
// (multi-scope)"): closes two of the four confirmed gaps in U-D14.B1.S1 /
// U-D14.B4.S1 -- a composite Performance Score, and circular-dependency
// detection distinct from loop-prevention.ts's iteration/depth/elapsed-time
// budget (see that file's own header for why it deliberately stops short of
// graph-shaped checks: "That graph doesn't exist yet"). Dynamic Chains
// (dynamicChains in schema.ts) now carry real dependsOn-shaped data via
// their pathKeys, which is what makes this function meaningful today where
// it wasn't when loop-prevention.ts was written.
//
// Both functions here are pure and deterministic -- no DB access, no LLM
// call, matching task-tightening.ts / floor-tier-escalation.ts's discipline.
// This module does not touch loop-prevention.ts, orchestra-execution-
// logger.ts, or task-execution-engine.ts; it composes their existing output
// shapes as plain inputs instead.

import type { LLMUsage } from "@/lib/llm-client"
import type { LoopBudgetContext, LoopBudgetResult } from "@/lib/loop-prevention"

// ─── (a) Composite Performance Score ───────────────────────────────────────
//
// Combines three signals this codebase already computes elsewhere, without
// re-deriving or duplicating any of them:
//   1. Token usage vs. an optional budget (orchestra-execution-logger.ts's
//      RecordOrchestraExecutionInput.usage shape, reused directly).
//   2. Loop-budget headroom (loop-prevention.ts's checkLoopBudget() context
//      + result, reused directly -- not just pass/fail, but how close to
//      the limit, since an execution that barely survives its budget is a
//      real degradation signal even when it technically "passed").
//   3. Whether the execution completed without an unhandled error -- a
//      distinct hard-failure signal from loop-budget exhaustion (a task can
//      fail for reasons that have nothing to do with iteration count).
//
// Weights are documented, not hidden: completion is weighted heaviest
// (a hard failure should dominate the score) with loop-budget headroom and
// token-budget headroom as softer, gradient signals underneath it.
const COMPLETION_WEIGHT = 50
const LOOP_BUDGET_WEIGHT = 30
const TOKEN_BUDGET_WEIGHT = 20

export type PerformanceScoreInput = {
  /** Same shape orchestra-execution-logger.ts's usage field carries. Omit when the execution made no LLM call (e.g. a denied/gated request never reached one). */
  usage?: LLMUsage
  /**
   * The token ceiling this execution is being measured against (e.g. a
   * per-task or per-layer budget). Optional -- with no baseline to compare
   * against, usage cannot fairly lower the score, so the token component
   * defaults to full marks rather than penalizing missing data.
   */
  tokenBudget?: number
  /** The exact context checkLoopBudget() was called with, plus its returned result -- reused directly, never recomputed here. */
  loopBudget: { context: LoopBudgetContext; result: LoopBudgetResult }
  /** Did the execution finish without an unhandled error/exception? Distinct from loopBudget.result.passed. */
  completedWithoutError: boolean
}

export type PerformanceScoreBreakdown = {
  score: number
  completionComponent: number
  loopBudgetComponent: number
  tokenBudgetComponent: number
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0
  return Math.min(1, Math.max(0, n))
}

/**
 * Pure, deterministic 0-100 composite score. No LLM call, no DB access --
 * every input is a value the caller already has from elsewhere in the
 * pipeline. Higher is healthier.
 */
export function computePerformanceScore(input: PerformanceScoreInput): PerformanceScoreBreakdown {
  const completionComponent = input.completedWithoutError ? COMPLETION_WEIGHT : 0

  // Loop-budget headroom: even a "passed" execution that consumed nearly its
  // entire iteration budget is a real degradation signal, not a clean pass/
  // fail. An exhausted budget (result.passed === false) scores 0 here
  // regardless of the ratio, since checkLoopBudget() already declared it
  // failed.
  const { context, result } = input.loopBudget
  const iterationRatio = context.maxIterations > 0 ? clamp01(context.iteration / context.maxIterations) : 0
  const loopBudgetComponent = result.passed ? (1 - iterationRatio) * LOOP_BUDGET_WEIGHT : 0

  // Token-budget headroom: same shape of degradation curve as loop budget.
  // No usage or no budget to compare against -> neutral (full marks), since
  // this component cannot penalize what it has no baseline to judge.
  let tokenBudgetComponent = TOKEN_BUDGET_WEIGHT
  if (input.usage && input.tokenBudget && input.tokenBudget > 0) {
    const totalTokens = input.usage.promptTokens + input.usage.completionTokens
    const usageRatio = clamp01(totalTokens / input.tokenBudget)
    tokenBudgetComponent = (1 - usageRatio) * TOKEN_BUDGET_WEIGHT
  }

  const score = Math.round(completionComponent + loopBudgetComponent + tokenBudgetComponent)
  return { score, completionComponent, loopBudgetComponent: Math.round(loopBudgetComponent * 100) / 100, tokenBudgetComponent: Math.round(tokenBudgetComponent * 100) / 100 }
}

// ─── (c) Circular-dependency detection ─────────────────────────────────────
//
// Same node shape and same "visited Set walked via DFS" technique as
// project-management-engine.ts's calculateCriticalPath (see its
// computeEarly() -- a node re-entered while still on the current DFS path
// means a cycle). That function throws on the first cycle it finds, which
// is fine for its own use (critical-path math cannot proceed through a
// cycle at all) but wrong for a monitoring check, which needs to report
// *which* nodes are involved without throwing. This is a new, separate
// function for that reporting shape -- it does not modify or wrap
// calculateCriticalPath.

export type DependencyNode = { id: string; dependsOn: string[] }

export type CircularDependencyResult = {
  hasCycle: boolean
  /** Every node that participates in at least one cycle, deduplicated. Empty when hasCycle is false. */
  cycleNodes: string[]
}

/**
 * Pure, deterministic cycle check over a dependency graph. Dangling
 * references (a dependsOn id with no matching node) are ignored rather than
 * treated as an error -- this function's only job is cycle detection, not
 * referential-integrity validation.
 */
export function detectCircularDependency(nodes: DependencyNode[]): CircularDependencyResult {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const resolved = new Set<string>() // fully walked, confirmed cycle-free from here
  const onStack = new Set<string>() // nodes on the current DFS path
  const cycleNodes = new Set<string>()

  function visit(id: string, path: string[]): void {
    if (onStack.has(id)) {
      const cycleStart = path.indexOf(id)
      for (const n of path.slice(cycleStart)) cycleNodes.add(n)
      return
    }
    if (resolved.has(id)) return
    const node = byId.get(id)
    if (!node) return // dangling reference -- not this function's concern

    onStack.add(id)
    path.push(id)
    for (const dep of node.dependsOn) visit(dep, path)
    path.pop()
    onStack.delete(id)
    resolved.add(id)
  }

  for (const n of nodes) {
    if (!resolved.has(n.id)) visit(n.id, [])
  }

  return { hasCycle: cycleNodes.size > 0, cycleNodes: Array.from(cycleNodes) }
}
