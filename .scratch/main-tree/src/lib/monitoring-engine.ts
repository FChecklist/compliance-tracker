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

// ─── Per-Dynamic-Chain monitoring rules (ENFORCEMENT layer) ────────────────
//
// tree4-unified area 6 remaining_work: "Per-Dynamic-Chain monitoring rules
// ENFORCEMENT layer -- schema column (monitoringRules) exists from PR #169
// but nothing reads/enforces it yet." schema.ts's dynamicChains.monitoringRules
// column comment already proposed a shape ("Suggested (not yet enforced)
// shape: { rules: { metric: string; maxValue?: number; minValue?: number;
// action: 'warn' | 'escalate' }[] }") -- this implements exactly that shape
// rather than inventing a second rule language, narrowed to the two metrics
// this codebase actually has real execution data for at its one real
// chain-scoped completion chokepoint (task-execution-engine.ts's
// updateTaskStatusAndReflect): how long a run took, and how many of its
// planned steps actually completed. `action` IS the escalation-on-violation
// flag the schema comment named -- "escalate" means the caller should
// invoke escalation-ladder.ts's nextEscalationRung(), "warn" means record
// the violation without escalating.
export type MonitoringRuleMetric = "duration_ms" | "required_step_count"

export type MonitoringRule = {
  metric: MonitoringRuleMetric
  maxValue?: number
  minValue?: number
  action: "warn" | "escalate"
}

export type ChainExecutionSnapshot = {
  /** Wall-clock elapsed time for this run, same elapsedMs shape task-reflection.ts already computes. */
  durationMs: number
  /** Count of this task's task_execution_plan rows with status = 'completed'. */
  completedStepCount: number
}

export type MonitoringRuleViolation = {
  metric: MonitoringRuleMetric
  action: "warn" | "escalate"
  actualValue: number
  maxValue?: number
  minValue?: number
}

function isMonitoringRule(value: unknown): value is MonitoringRule {
  if (!value || typeof value !== "object") return false
  const r = value as Record<string, unknown>
  return (
    (r.metric === "duration_ms" || r.metric === "required_step_count") &&
    (r.action === "warn" || r.action === "escalate") &&
    (r.maxValue === undefined || typeof r.maxValue === "number") &&
    (r.minValue === undefined || typeof r.minValue === "number")
  )
}

/**
 * Parses the raw jsonb column value into a validated rule list. Malformed or
 * unrecognised entries are silently dropped rather than thrown on -- a
 * corrupt/partial monitoringRules value should degrade to "no rules
 * enforced", not crash the task-completion path that calls this.
 */
export function parseMonitoringRules(raw: unknown): MonitoringRule[] {
  if (!raw || typeof raw !== "object") return []
  const rules = (raw as { rules?: unknown }).rules
  if (!Array.isArray(rules)) return []
  return rules.filter(isMonitoringRule)
}

/**
 * Pure, deterministic rule evaluation -- no DB access, no LLM call, matching
 * this module's existing discipline. Returns every violated rule (a chain
 * can carry more than one rule, and more than one can fire on the same
 * run); callers decide what to do with each (log a warning, escalate).
 */
export function evaluateMonitoringRules(rawMonitoringRules: unknown, snapshot: ChainExecutionSnapshot): MonitoringRuleViolation[] {
  const rules = parseMonitoringRules(rawMonitoringRules)
  if (rules.length === 0) return []

  const violations: MonitoringRuleViolation[] = []
  for (const rule of rules) {
    const actualValue = rule.metric === "duration_ms" ? snapshot.durationMs : snapshot.completedStepCount
    const exceedsMax = typeof rule.maxValue === "number" && actualValue > rule.maxValue
    const belowMin = typeof rule.minValue === "number" && actualValue < rule.minValue
    if (exceedsMax || belowMin) {
      violations.push({ metric: rule.metric, action: rule.action, actualValue, maxValue: rule.maxValue, minValue: rule.minValue })
    }
  }
  return violations
}

// ─── (d) Governance Health Score (Reasoning Quality / Dependency Health /
// Instruction-Policy-Security Compliance) ──────────────────────────────────
//
// Area 6's last remaining item was deliberately NOT built as an LLM-graded
// self-assessment (this codebase's own no-self-certification norm, AGENTS.md
// Rule 7(c)/Rule 10 -- the same reason handover-protocol.ts/qa-precompletion-
// gate.ts require an INDEPENDENT reviewer, not the executing role's own
// opinion). All 3 scores below are instead derived purely from real,
// already-persisted peer-review OUTCOMES (activity_log.reviewDecision,
// .reAuditRequestedAt) -- counts a human/independent-reviewer role recorded,
// never a number this module invents or asks an LLM to self-report.
//   - reasoningQualityScore: of the dispatches an independent reviewer has
//     actually looked at, what fraction did they approve? A dispatch nobody
//     has reviewed yet contributes to neither side (unproven, not penalized).
//   - dependencyHealthScore: of all terminal dispatches, what fraction
//     actually reached 'completed' rather than 'failed' -- the direct,
//     honestly-labeled reading of "did the execution chain hold up",
//     without stretching an unrelated signal (e.g. re-audit flags, which
//     can be raised for reasons that have nothing to do with dependencies)
//     to mean something it doesn't.
//   - complianceScore: of all terminal dispatches, what fraction were
//     EITHER rejected at review (recordPeerReview()'s contract guarantees
//     real reviewNotes explaining what instruction/policy/security
//     expectation was not met) OR later flagged for re-audit
//     (activity-log-service.ts's flagForReAudit -- a post-closure signal
//     the original approval needs re-examining).
// A scope with zero reviewed/terminal dispatches yet reports a neutral 100
// (nothing proven, nothing penalized) rather than 0, mirroring
// computePerformanceScore's token-budget component's own "no baseline, no
// penalty" convention above.
export type GovernanceHealthCounts = {
  /** Terminal (completed/failed/closed) ai_team_dispatch rows in the scope. */
  totalTerminalCount: number
  /** Of those, how many reached lifecycle_stage = 'failed'. */
  failedCount: number
  /** Of those, how many have a non-null reviewDecision. */
  reviewedCount: number
  /** Of the reviewed ones, how many were 'approved'. */
  approvedCount: number
  /** Of the reviewed ones, how many were 'rejected'. */
  rejectedCount: number
  /** Of all terminal rows, how many currently carry a re-audit flag. */
  reAuditFlaggedCount: number
}

export type GovernanceHealthBreakdown = {
  reasoningQualityScore: number
  dependencyHealthScore: number
  complianceScore: number
}

/**
 * Pure, deterministic -- no DB access, no LLM call. Callers gather
 * GovernanceHealthCounts from activity_log themselves (see
 * activity-log-service.ts's getGovernanceHealthCounts) and pass real counts
 * in; this function only turns counts into 0-100 scores.
 */
export function computeGovernanceHealthScore(counts: GovernanceHealthCounts): GovernanceHealthBreakdown {
  const reasoningQualityScore = counts.reviewedCount > 0
    ? Math.round(clamp01(counts.approvedCount / counts.reviewedCount) * 100)
    : 100

  const dependencyHealthScore = counts.totalTerminalCount > 0
    ? Math.round(clamp01(1 - counts.failedCount / counts.totalTerminalCount) * 100)
    : 100

  const nonCompliantCount = counts.rejectedCount + counts.reAuditFlaggedCount
  const complianceScore = counts.totalTerminalCount > 0
    ? Math.round(clamp01(1 - nonCompliantCount / counts.totalTerminalCount) * 100)
    : 100

  return { reasoningQualityScore, dependencyHealthScore, complianceScore }
}
