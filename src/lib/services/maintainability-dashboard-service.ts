// VERIDIAN Review Framework gap-closure (2026-07-18), "Maintainability" --
// High: "No consolidated maintainability score/dashboard." Recommended
// approach: "Wire audit role outputs into a scored dashboard surfaced in
// ai-os/."
//
// Confirmed before writing this: no maintainability score of any kind
// exists today. monitoring-engine.ts's computeGovernanceHealthScore is the
// closest precedent (Reasoning Quality/Dependency Health/Compliance,
// derived from AI-dispatch outcomes) but has no code-quality/maintainability
// axis. VERIDIAN_AUDIT_ORGANIZATION.md's "The Chief Audit Officer" section
// explicitly declined to build the ~149 named specialist auditor roles
// (including "Maintainability Auditor", "Code Duplication Auditor",
// "Dependency Auditor") as individual roster roles -- most of what they'd
// check is already checked by CI (deterministic) or the 12 real
// Guardrail-team roles (LLM-backed, dispatchable today). This module is
// exactly that: it wires the REAL outputs those roles/CI already produce
// into one consolidated score, rather than inventing a 150th fake role.
//
// Real signals wired in (every one already persisted by existing code,
// nothing new tracked just for this dashboard):
//   1. Guardrail violation rate -- loopImprovements rows where
//      improvementType='guardrail_violation' (written by
//      guardrail-engine.ts's recordGuardrailViolation, i.e. every real
//      BLOCK/FAIL a Guardrail-team-backed check has produced), trailing
//      window. A high rate means the platform's own written standards are
//      being violated often -- the load-bearing definition of
//      "maintainability" this dashboard can actually measure today.
//   2. Continuous-improvement backlog -- loopImprovements rows still
//      isDeployed=false past a staleness window: audit-identified
//      improvements (technical debt, in VERIDIAN_AUDIT_ORGANIZATION.md's own
//      language) that were found but never acted on. A growing backlog is
//      a direct maintainability regression signal.
//   3. Dependency Health -- reuses monitoring-engine.ts's own
//      computeGovernanceHealthScore(...).dependencyHealthScore verbatim
//      (how often terminal AI-dispatched work actually fails) rather than
//      re-deriving an equivalent number a second way.
//
// Deliberately NOT invented: static-analysis metrics (cyclomatic
// complexity, duplication %, dependency freshness) have no runtime-queryable
// source anywhere in this codebase -- CI (lint/typecheck/build, AGENTS.md
// Operating Rule 15 / GP-15) is the real enforcement for those today, and
// GitHub Actions results are not persisted to this database. Recorded
// honestly in `notCovered` below, matching ai-performance-report-service.ts's
// own `notCovered` convention, rather than fabricated.
import { db, loopImprovements } from "@/lib/db"
import { gte, lt, eq, and, sql } from "drizzle-orm"
import { getGovernanceHealthCounts } from "@/lib/activity-log-service"
import { computeGovernanceHealthScore } from "@/lib/monitoring-engine"

function clamp0to100(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)))
}

export type MaintainabilityScorecard = {
  maintainabilityScore: number
  guardrailViolationScore: number
  improvementBacklogScore: number
  dependencyHealthScore: number
  counts: {
    guardrailViolationsInWindow: number
    totalLoopImprovementsInWindow: number
    staleUnactionedImprovements: number
  }
  windowDays: number
  staleBacklogAfterDays: number
  notCovered: { dimension: string; reason: string }[]
}

const DEFAULT_WINDOW_DAYS = 30
const DEFAULT_STALE_BACKLOG_AFTER_DAYS = 30

/**
 * Guardrail-violation rate, expressed as a 0-100 score (100 = zero
 * violations in the window). Normalized against total loop-improvement
 * volume in the same window so an org/platform running MORE loops isn't
 * penalized just for generating more total signal -- a violation RATE, not
 * a raw count.
 */
function computeGuardrailViolationScore(violationCount: number, totalCount: number): number {
  if (totalCount === 0) return 100
  return clamp0to100(100 * (1 - violationCount / totalCount))
}

/**
 * Backlog score: penalizes a growing pile of audit-identified, still-
 * unactioned improvements. Zero stale items -> 100. Deliberately a soft
 * decay (not a hard cliff) so a handful of items doesn't crater the score --
 * every 5 stale items costs 10 points, floors at 0.
 */
function computeBacklogScore(staleCount: number): number {
  return clamp0to100(100 - staleCount * 2)
}

/** Pure combiner -- the 3 sub-scores, unweighted average, same simple-ratio style as monitoring-engine.ts's own computeGovernanceHealthScore. */
export function computeMaintainabilityScore(inputs: {
  guardrailViolationScore: number
  improvementBacklogScore: number
  dependencyHealthScore: number
}): number {
  return clamp0to100(
    (inputs.guardrailViolationScore + inputs.improvementBacklogScore + inputs.dependencyHealthScore) / 3
  )
}

/**
 * Real DB aggregation. Guardrail violations / improvement backlog are
 * platform-wide (loop_improvements has no org_id -- loops scan across all
 * orgs by nature, same reasoning activity-log-service.ts's own header gives
 * for why loop runs aren't tenant-scoped) -- uses the direct `db` import,
 * matching every other cross-org report in this codebase
 * (ai-performance-report-service.ts, d1-metrics-tracker-service.ts).
 * Dependency Health is the one genuinely org-scoped input, via
 * getGovernanceHealthCounts(orgId).
 */
export async function getMaintainabilityScorecard(
  orgId: string,
  windowDays = DEFAULT_WINDOW_DAYS,
  staleBacklogAfterDays = DEFAULT_STALE_BACKLOG_AFTER_DAYS
): Promise<MaintainabilityScorecard> {
  const windowStart = new Date(Date.now() - windowDays * 86_400_000)
  const staleBefore = new Date(Date.now() - staleBacklogAfterDays * 86_400_000)

  const [violationRow, totalRow, staleRow, governanceCounts] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(loopImprovements)
      .where(and(gte(loopImprovements.createdAt, windowStart), eq(loopImprovements.improvementType, "guardrail_violation"))),
    db.select({ count: sql<number>`count(*)::int` }).from(loopImprovements)
      .where(gte(loopImprovements.createdAt, windowStart)),
    db.select({ count: sql<number>`count(*)::int` }).from(loopImprovements)
      .where(and(eq(loopImprovements.isDeployed, false), lt(loopImprovements.createdAt, staleBefore))),
    getGovernanceHealthCounts(orgId),
  ])

  const guardrailViolationsInWindow = violationRow[0]?.count ?? 0
  const totalLoopImprovementsInWindow = totalRow[0]?.count ?? 0
  const staleUnactionedImprovements = staleRow[0]?.count ?? 0

  const guardrailViolationScore = computeGuardrailViolationScore(guardrailViolationsInWindow, totalLoopImprovementsInWindow)
  const improvementBacklogScore = computeBacklogScore(staleUnactionedImprovements)
  const dependencyHealthScore = computeGovernanceHealthScore(governanceCounts).dependencyHealthScore

  return {
    maintainabilityScore: computeMaintainabilityScore({ guardrailViolationScore, improvementBacklogScore, dependencyHealthScore }),
    guardrailViolationScore,
    improvementBacklogScore,
    dependencyHealthScore,
    counts: { guardrailViolationsInWindow, totalLoopImprovementsInWindow, staleUnactionedImprovements },
    windowDays,
    staleBacklogAfterDays,
    notCovered: [
      { dimension: "Static analysis (cyclomatic complexity, duplication %)", reason: "No runtime-queryable source exists -- CI lint/typecheck (GP-15) is the real enforcement, not persisted to this database." },
      { dimension: "Dependency freshness (outdated npm packages)", reason: "Dependabot PRs are the real mechanism (see ai-os/boss/ACTIVE-CLAIMS.yaml's Dependabot-triage entries) -- no live inventory table exists to score against." },
      { dimension: "Individually-named specialist auditors (Maintainability/Code Duplication/Dependency Auditor etc.)", reason: "Deliberately not built as roster roles -- see VERIDIAN_AUDIT_ORGANIZATION.md 'Not built, and why'. Their real coverage is CI + the 12 Guardrail-team roles, both already wired into guardrailViolationScore above." },
    ],
  }
}
