// AI Model Lifecycle & Benchmarking gap-closure, Finding 1: "Per-role
// quality regression tracked over time, not just at launch."
//
// Investigated before writing this (per that task's own instruction not to
// assume the gap description is still accurate):
//   - model-scorecard-service.ts (GAP-MODEL-SCORECARD) tracks dispatch
//     count / success rate / audit-finding-rate per (model, complexity
//     tier) from activity_log -- a DISPATCH-OUTCOME signal (did the
//     dispatch complete, was it rejected on independent review), computed
//     fresh on every call and discarded, never a stored content-quality
//     score.
//   - agent-review-service.ts's agent_review_records computes a periodic
//     promote/maintain/retrain/deprecate verdict from those same
//     dispatch-outcome signals, deterministically -- its own schema
//     comment: "never an LLM judgment call."
//   - promptfooconfig.yaml (Wave 35) regression-tests VERIDIAN's seeded
//     prompt-OS templates directly, run on demand (`npm run test:prompts`)
//     -- exactly the "review" the finding says exists. Nothing turns that
//     into a recurring, persisted, per-role time series with regression
//     detection. That is the real, still-open gap this file closes.
//
// This module deliberately does NOT call an LLM judge to score responses
// (an "llm-rubric" assertion, promptfooconfig.yaml's own second test type)
// -- a judge call is itself a non-deterministic LLM call subject to the
// exact drift this is trying to detect, and it would double this feature's
// real cost on every scoring run. Scoring here is assertion-based
// (contains / not-contains / json-shape), the same deterministic assertion
// types promptfooconfig.yaml already uses for its first test, just applied
// generically across roles and persisted as a time series.
import { db, roleQualitySnapshots } from "@/lib/db"
import { desc, eq } from "drizzle-orm"
import { getRole, operationalRoles } from "@/lib/ai-team/roster"

// Bumped whenever QUALITY_PROBES changes -- a probe-set edit changing the
// pass bar isn't a real quality regression, so callers can filter it out
// rather than mistake "we tightened the test" for "the model got worse".
export const QUALITY_PROBE_SET_VERSION = "v1"

export type QualityAssertion =
  | { type: "contains"; value: string; caseSensitive?: boolean }
  | { type: "not-contains"; value: string; caseSensitive?: boolean }
  | { type: "min-length"; chars: number }
  | { type: "not-empty" }

export type QualityProbe = {
  id: string
  /** Sent as the user message to the role being scored -- deliberately generic (not role-specific) so the same fixed probe set is comparable across every role over time. */
  input: string
  assertions: QualityAssertion[]
}

// Generic, role-agnostic probes: every AI Dev Team role is instructed (via
// its own resolved prompt-OS template) to behave as a helpful, on-topic
// specialist -- these check for the failure modes that matter regardless
// of specialty: outright refusal, empty/truncated output, and a
// suspiciously short non-answer. Intentionally NOT graded against
// domain-specific "correctness" (that would need a per-role rubric this
// finding didn't ask for) -- this is a floor check, matching the
// "not just at launch" framing: did this role's basic response quality
// hold steady over time.
export const QUALITY_PROBES: QualityProbe[] = [
  {
    id: "stays-on-task",
    input: "Summarize, in 2-3 sentences, what your role is responsible for on the VERIDIAN AI Dev Team.",
    assertions: [
      { type: "not-empty" },
      { type: "min-length", chars: 20 },
      { type: "not-contains", value: "I cannot", caseSensitive: false },
      { type: "not-contains", value: "as an ai language model", caseSensitive: false },
    ],
  },
  {
    id: "handles-empty-signal-honestly",
    input: "No task has been assigned yet. Confirm you are ready and briefly state what you need from a task brief before you can act.",
    assertions: [
      { type: "not-empty" },
      { type: "min-length", chars: 15 },
      { type: "not-contains", value: "I cannot", caseSensitive: false },
    ],
  },
]

export type ProbeResult = { probeId: string; passed: boolean; failedAssertions: string[] }

/** Pure: evaluates one probe's assertions against a role's raw response text. */
export function evaluateProbeResponse(response: string, probe: QualityProbe): ProbeResult {
  const failedAssertions: string[] = []
  const haystack = response ?? ""

  for (const assertion of probe.assertions) {
    switch (assertion.type) {
      case "not-empty":
        if (haystack.trim().length === 0) failedAssertions.push("not-empty")
        break
      case "min-length":
        if (haystack.trim().length < assertion.chars) failedAssertions.push(`min-length:${assertion.chars}`)
        break
      case "contains": {
        const hay = assertion.caseSensitive ? haystack : haystack.toLowerCase()
        const needle = assertion.caseSensitive ? assertion.value : assertion.value.toLowerCase()
        if (!hay.includes(needle)) failedAssertions.push(`contains:${assertion.value}`)
        break
      }
      case "not-contains": {
        const hay = assertion.caseSensitive ? haystack : haystack.toLowerCase()
        const needle = assertion.caseSensitive ? assertion.value : assertion.value.toLowerCase()
        if (hay.includes(needle)) failedAssertions.push(`not-contains:${assertion.value}`)
        break
      }
    }
  }

  return { probeId: probe.id, passed: failedAssertions.length === 0, failedAssertions }
}

export type ScoredProbeRun = {
  score: number // 0-100
  testCaseCount: number
  passedCount: number
  failedCount: number
  results: ProbeResult[]
}

/** Pure: aggregates a set of probe results into a 0-100 score. testCaseCount = 0 scores 0, not NaN/null -- a role that produced nothing to grade is a real failure signal, not "no data" (unlike the null-vs-zero rate fields elsewhere in this codebase, which describe an aggregate with no rows at all). */
export function scoreProbeResults(results: ProbeResult[]): ScoredProbeRun {
  const testCaseCount = results.length
  const passedCount = results.filter((r) => r.passed).length
  const failedCount = testCaseCount - passedCount
  const score = testCaseCount > 0 ? Math.round((passedCount / testCaseCount) * 100) : 0
  return { score, testCaseCount, passedCount, failedCount, results }
}

export type RegressionVerdict = { regressionDetected: boolean; scoreDelta: number | null }

// 15-point drop is a real, adjustable threshold, not a hidden magic
// number -- matching activity-log-service.ts's STUCK_THRESHOLD_MS
// discipline of naming the constant rather than inlining it. Chosen
// because the probe set is small (2 probes today): a single flipped
// assertion on a 2-probe run already swings the score 50 points, so a
// coarse-but-real threshold is more honest than a false-precision one.
export const REGRESSION_THRESHOLD_POINTS = 15

/** Pure: null previousScore means no signal yet (first-ever run for this role), never treated as a regression. */
export function detectQualityRegression(currentScore: number, previousScore: number | null): RegressionVerdict {
  if (previousScore === null) return { regressionDetected: false, scoreDelta: null }
  const scoreDelta = currentScore - previousScore
  return { regressionDetected: scoreDelta <= -REGRESSION_THRESHOLD_POINTS, scoreDelta }
}

export type RoleCaller = (roleKey: string, input: string) => Promise<{ content: string }>
export type PreviousScoreLookup = (roleKey: string) => Promise<number | null>

export type RoleQualityAuditRow = {
  roleKey: string
  model: string
  complexityTier: string | null
  score: number
  testCaseCount: number
  passedCount: number
  failedCount: number
  previousScore: number | null
  scoreDelta: number | null
  regressionDetected: boolean
  probeSetVersion: string
  error?: string
}

/**
 * Orchestrates one scoring pass across the given roles. Callers/DB access
 * are injected so this is unit-testable without a live LLM key or DB
 * connection (this repo's established pure-core/DB-shell split -- see
 * model-scorecard-service.ts's own header). A role whose call throws
 * (rate limit, cost-policy block, RoleNotCallableError) is recorded with
 * score 0 / testCaseCount 0 and an `error` field rather than silently
 * skipped -- an unreachable role is itself a real quality signal, not
 * something to hide from the time series.
 */
export async function runRoleQualityAudit(
  roleKeys: string[],
  callRole: RoleCaller,
  getPreviousScore: PreviousScoreLookup,
  resolveRole: (roleKey: string) => { model: string | null; complexityTier?: string | null } | undefined
): Promise<RoleQualityAuditRow[]> {
  const rows: RoleQualityAuditRow[] = []

  for (const roleKey of roleKeys) {
    const roleInfo = resolveRole(roleKey)
    const model = roleInfo?.model ?? "unknown"
    const previousScore = await getPreviousScore(roleKey)

    try {
      const results: ProbeResult[] = []
      for (const probe of QUALITY_PROBES) {
        const { content } = await callRole(roleKey, probe.input)
        results.push(evaluateProbeResponse(content, probe))
      }
      const scored = scoreProbeResults(results)
      const regression = detectQualityRegression(scored.score, previousScore)

      rows.push({
        roleKey,
        model,
        complexityTier: roleInfo?.complexityTier ?? null,
        score: scored.score,
        testCaseCount: scored.testCaseCount,
        passedCount: scored.passedCount,
        failedCount: scored.failedCount,
        previousScore,
        scoreDelta: regression.scoreDelta,
        regressionDetected: regression.regressionDetected,
        probeSetVersion: QUALITY_PROBE_SET_VERSION,
      })
    } catch (err) {
      const regression = detectQualityRegression(0, previousScore)
      rows.push({
        roleKey,
        model,
        complexityTier: roleInfo?.complexityTier ?? null,
        score: 0,
        testCaseCount: 0,
        passedCount: 0,
        failedCount: 0,
        previousScore,
        scoreDelta: regression.scoreDelta,
        regressionDetected: regression.regressionDetected,
        probeSetVersion: QUALITY_PROBE_SET_VERSION,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return rows
}

/** Every role this audit can actually score: LLM-backed operational roles only (excludes isHuman/isCodeOnly, same eligibility team-service.ts's requireCallableRole already enforces; excludes Guardrail/Audit teams -- scoring an assurance role with a generic "summarize your job" probe would be noise, not signal, for roles whose whole output is a structured verdict). */
export function scorableRoleKeys(): string[] {
  return operationalRoles()
    .filter((r) => !r.isHuman && !r.isCodeOnly && r.model && r.promptKey)
    .map((r) => r.roleKey)
}

/**
 * Real DB + real LLM wrapper -- the recurring-job entry point (piggybacked
 * on the existing daily loop cron, GET /api/internal/loops/run, same
 * "not one of the 15 canonical loops, cheap enough to ride along" pattern
 * as capabilityIndexFreshnessAudit / llmResponseCachePurged). Platform-
 * level (raw `db`), same posture as model-scorecard-service.ts.
 *
 * roleKeys defaults to scorableRoleKeys() -- every LLM-backed operational
 * role. This is a real, non-trivial number of LLM calls per run (2 probes
 * x N roles); left uncapped deliberately per AGENTS.md Operating Rule 8's
 * 90-day quality mandate ("do not... cut a task short to save cost"), but
 * callers needing a cheaper cadence can pass a curated subset.
 */
export async function runRoleQualityRegressionAuditLive(
  roleKeys: string[] = scorableRoleKeys()
): Promise<RoleQualityAuditRow[]> {
  const { runRole: liveRunRole } = await import("@/lib/ai-team/team-service")

  const callRole: RoleCaller = async (roleKey, input) => {
    const result = await liveRunRole(roleKey, input)
    return { content: result.content }
  }

  const getPreviousScore: PreviousScoreLookup = async (roleKey) => {
    const [last] = await db
      .select({ score: roleQualitySnapshots.score })
      .from(roleQualitySnapshots)
      .where(eq(roleQualitySnapshots.roleKey, roleKey))
      .orderBy(desc(roleQualitySnapshots.createdAt))
      .limit(1)
    return last ? Number(last.score) : null
  }

  const resolveRole = (roleKey: string) => {
    const role = getRole(roleKey)
    return role ? { model: role.model, complexityTier: null } : undefined
  }

  const rows = await runRoleQualityAudit(roleKeys, callRole, getPreviousScore, resolveRole)

  if (rows.length > 0) {
    await db.insert(roleQualitySnapshots).values(
      rows.map((r) => ({
        roleKey: r.roleKey,
        model: r.model,
        complexityTier: r.complexityTier,
        score: String(r.score),
        testCaseCount: r.testCaseCount,
        passedCount: r.passedCount,
        failedCount: r.failedCount,
        previousScore: r.previousScore !== null ? String(r.previousScore) : null,
        scoreDelta: r.scoreDelta !== null ? String(r.scoreDelta) : null,
        regressionDetected: r.regressionDetected,
        triggeredBy: "scheduled",
        probeSetVersion: r.probeSetVersion,
      }))
    )
  }

  return rows
}

export type LatestRoleQualitySnapshot = {
  roleKey: string
  model: string
  complexityTier: string | null
  score: number
  scoreDelta: number | null
  regressionDetected: boolean
  createdAt: Date
}

/** Read path for the API route -- most-recent snapshot per role_key. */
export async function getLatestRoleQualitySnapshots(): Promise<LatestRoleQualitySnapshot[]> {
  const rows = await db
    .select({
      roleKey: roleQualitySnapshots.roleKey,
      model: roleQualitySnapshots.model,
      complexityTier: roleQualitySnapshots.complexityTier,
      score: roleQualitySnapshots.score,
      scoreDelta: roleQualitySnapshots.scoreDelta,
      regressionDetected: roleQualitySnapshots.regressionDetected,
      createdAt: roleQualitySnapshots.createdAt,
    })
    .from(roleQualitySnapshots)
    .orderBy(desc(roleQualitySnapshots.createdAt))

  const latestByRole = new Map<string, LatestRoleQualitySnapshot>()
  for (const row of rows) {
    if (!latestByRole.has(row.roleKey)) {
      latestByRole.set(row.roleKey, {
        roleKey: row.roleKey,
        model: row.model,
        complexityTier: row.complexityTier,
        score: Number(row.score),
        scoreDelta: row.scoreDelta !== null ? Number(row.scoreDelta) : null,
        regressionDetected: row.regressionDetected,
        createdAt: row.createdAt,
      })
    }
  }

  return Array.from(latestByRole.values()).sort((a, b) => a.score - b.score) // worst-first -- the regressions/low scorers that need attention are the point of this endpoint
}
