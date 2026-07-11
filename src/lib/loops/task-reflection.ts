// Wave 172 (tree4-unified/50-completion-plan area 12 "Loop Engineering",
// remaining_work item 1): "Universal reflective-question mechanism running
// for EVERY completed task -- currently the CLEE pipeline (loop-improvement-
// proposer.ts) only fires on guardrail violations and audit-loop findings."
//
// This is the missing universal half: every real terminal-state write this
// codebase already makes (task-execution-engine.ts's tasks.status
// transitions, activity-log-service.ts's activity_log.lifecycle_stage
// transitions) calls runTaskReflection() once, with the db/tx it already has
// open -- no new transaction, no nested withTenantContext (see
// tenant-scoped.ts's own transaction-per-call design; opening a second one
// here would just be a second pooled connection racing the first for no
// reason). A reflection-write failure is caught here and logged, never
// re-thrown -- the same "must never block or fail the actual activity it's
// recording" discipline as activity-log-service.ts's recordActivity().
//
// Four sub-questions, two different disciplines:
//   1. What succeeded/failed and why -- outcome/summary/failureReason, the
//      real terminal status and (when failed) the real error/guardrail
//      message the caller already had. No inference.
//   2. Could this be faster/cheaper -- speedVerdict/costVerdict, pure
//      arithmetic over this table's own recent rows (comparisonAvg* is
//      stored alongside the verdict so it stays auditable, not a black box).
//      Genuinely "insufficient_data" until enough history exists -- never
//      fabricated to look decisive early.
//   3 & 4. Should a different AI/tier have done this / should this become a
//      reusable pattern -- both require real judgment (an LLM or a human
//      weighing tradeoffs this function has no basis to weigh). Matches
//      monitoring-engine.ts's PR #169 precedent ("deliberately skips LLM-
//      graded metrics" rather than fabricate a verdict): the structured
//      field is always populated with the real facts available, verdict
//      stays null.
import { taskReflections } from "@/lib/db"
import type { TenantDb } from "@/lib/db/tenant-scoped"
import { and, desc, eq } from "drizzle-orm"

export type ReflectionSourceType = "task" | "ai_team_dispatch"
export type ReflectionOutcome = "success" | "failure"
export type SpeedCostVerdict = "faster_than_recent_avg" | "slower_than_recent_avg" | "in_line" | "insufficient_data"

export type RunTaskReflectionInput = {
  orgId: string
  sourceType: ReflectionSourceType
  sourceId: string
  outcome: ReflectionOutcome
  /** ai_team_dispatch only -- the AI Dev Team role_key this dispatch ran under. Also the comparison-group key for that source type's speed/cost verdicts. */
  roleKey?: string | null
  /** Factual: task title / dispatch objective. Not a judgment. */
  summary?: string | null
  /** Populated only when outcome === 'failure' -- the real error/guardrail message the caller already had. */
  failureReason?: string | null
  /** Real wall-clock elapsed time for this unit of work, when the caller can measure it. */
  elapsedMs?: number | null
  /** Real estimated cost (estimateCostUsd), when usage + model pricing were available. */
  costUsd?: number | null
}

// Below this many comparable prior rows, a verdict would be guessing, not
// measuring -- 'insufficient_data' is the honest answer.
const MIN_COMPARABLE_SAMPLE = 3
// +/-15% band counts as "in line" -- a verdict that flips on every 2%
// fluctuation would be noise, not signal.
const VERDICT_BAND = 0.15

export function average(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

/** Exported for direct unit testing -- pure arithmetic, no DB dependency (mirrors monitoring-engine.ts's testable-pure-function discipline). */
export function verdictFor(value: number | null | undefined, comparableValues: number[]): { verdict: SpeedCostVerdict; avg: number | null } {
  if (value == null) return { verdict: "insufficient_data", avg: null }
  const avg = average(comparableValues)
  if (avg === null || comparableValues.length < MIN_COMPARABLE_SAMPLE) return { verdict: "insufficient_data", avg }
  if (value < avg * (1 - VERDICT_BAND)) return { verdict: "faster_than_recent_avg", avg }
  if (value > avg * (1 + VERDICT_BAND)) return { verdict: "slower_than_recent_avg", avg }
  return { verdict: "in_line", avg }
}

/**
 * Records one reflection row against a real terminal-state transition.
 * Caller supplies the already-open tx (task-execution-engine.ts /
 * activity-log-service.ts both already have one) so this participates in the
 * same transaction rather than opening a second one. Never throws -- a
 * reflection failure must not roll back or fail the completion it observed.
 */
export async function runTaskReflection(db: TenantDb, input: RunTaskReflectionInput): Promise<void> {
  try {
    // Comparison scope: ai_team_dispatch compares a role against its OWN
    // recent history (wildly different roles have wildly different normal
    // durations/costs); plain tasks compare against this org's own recent
    // completed tasks (no per-task "kind" column exists to group by more
    // narrowly than that).
    const comparisonScope =
      input.sourceType === "ai_team_dispatch" && input.roleKey
        ? and(eq(taskReflections.sourceType, "ai_team_dispatch"), eq(taskReflections.roleKey, input.roleKey))
        : and(eq(taskReflections.sourceType, "task"), eq(taskReflections.orgId, input.orgId))

    const recent = await db
      .select({ elapsedMs: taskReflections.elapsedMs, costUsd: taskReflections.costUsd })
      .from(taskReflections)
      .where(comparisonScope)
      .orderBy(desc(taskReflections.createdAt))
      .limit(20)

    const comparableElapsed = recent.map((r) => r.elapsedMs).filter((v): v is number => v != null)
    const comparableCost = recent.map((r) => r.costUsd).filter((v): v is string => v != null).map(Number)

    const speed = verdictFor(input.elapsedMs, comparableElapsed)
    const cost =
      input.costUsd == null
        ? { verdict: "not_applicable" as const, avg: null as number | null }
        : verdictFor(input.costUsd, comparableCost)

    await db.insert(taskReflections).values({
      orgId: input.orgId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      roleKey: input.roleKey ?? null,
      outcome: input.outcome,
      summary: input.summary ?? null,
      failureReason: input.outcome === "failure" ? (input.failureReason ?? null) : null,
      elapsedMs: input.elapsedMs ?? null,
      comparisonAvgElapsedMs: speed.avg != null ? String(speed.avg) : null,
      speedVerdict: speed.verdict,
      costUsd: input.costUsd != null ? String(input.costUsd) : null,
      comparisonAvgCostUsd: cost.avg != null ? String(cost.avg) : null,
      costVerdict: cost.verdict,
      differentAiTierFlag: {
        currentIdentifier: input.roleKey ?? null,
        needsJudgment: true,
        verdict: null,
        note: "Whether a different AI/tier should have run this requires real judgment (LLM or human review), not auto-decided by this pass -- see monitoring-engine.ts's PR #169 precedent.",
      },
      reusablePatternFlag: {
        needsJudgment: true,
        verdict: null,
        note: "Whether this should be promoted to a Worker Agent / VCEL engine requires real judgment, not auto-decided by this pass -- see monitoring-engine.ts's PR #169 precedent.",
      },
    })
  } catch (err) {
    // sourceId passed as a separate arg, not interpolated -- same log-
    // injection fix as agent-directory-service.ts's refreshAgentDirectory().
    console.error("[task-reflection] failed to record reflection (non-fatal):", input.sourceType, input.sourceId, err)
  }
}
