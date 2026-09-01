// AI Model Lifecycle & Benchmarking gap-closure (VERIDIAN Review Framework,
// 2026-08-15), Finding 1: "Per-role quality regression tracked over time,
// not just at launch." Investigated before writing anything (this task's
// own instruction): promptfooconfig.yaml + .github/workflows/ai-prompt-
// evals.yml is real, but PR-triggered only (zero `schedule:` blocks
// anywhere in this repo's workflows -- confirmed by grep) and scores
// PROMPT TEMPLATES, not AI Team ROLES. prompt-eval-service.ts's
// promptEvalCases/promptEvalRuns is real, DB-persisted, deterministic-
// keyword scoring (never an LLM-judge) -- but only ever manually triggered
// via POST /api/prompt-eval/cases/[id]/run, keyed to a caller-supplied
// promptVersionId, with no notion of "this role's quality this run vs its
// own history."
//
// This is the recurring counterpart: for every LLM-backed AI Team role
// (roster.ts), resolve its promptKey to the SAME prompt_templates/
// prompt_eval_cases rows prompt-eval-service.ts already uses (a role's
// promptKey IS a real template_key -- team-service.ts's runRole() already
// resolves it that exact way), run every registered case against that
// role's own live production-labeled version, score with the exact same
// scoreKeywords() (exported from prompt-eval-service.ts, not forked), and
// persist one role_quality_runs row with a rolling-baseline regression
// verdict computed against that role's own prior runs.
//
// Deliberately reuses prompt-eval-service.ts's eval-case format (no second
// eval-case schema) and checkPromptEvalBudget() (no second daily-spend
// cap) -- a role with zero eval cases registered is honestly skipped with
// a stated reason, not silently scored 100% or fabricated.
import { db, promptTemplates, promptVersions, promptEvalCases, roleQualityRuns } from "@/lib/db"
import { and, eq } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { AI_TEAM_ROSTER, type RoleDefinition } from "@/lib/ai-team/roster"
import { callLLM } from "@/lib/llm-client"
import { platformApiKeyFor } from "@/lib/orchestra-model-resolver"
import { renderTemplate, scoreKeywords } from "./prompt-eval-service"
import { checkPromptEvalBudget } from "./prompt-governance-service"
import { logTokenUsage } from "./token-usage-service"

/** How many of a role's own most recent prior runs form its rolling baseline. */
export const REGRESSION_LOOKBACK_RUNS = 5
// A drop of more than this many percentage points below the rolling
// baseline counts as a regression -- named and fixed rather than a
// silently-invented per-call threshold, same discipline as byo-model-
// audit.ts's own ESCALATION_RATE_THRESHOLD.
export const REGRESSION_THRESHOLD = 0.15

export type RegressionResult = { baselinePassRate: number | null; regressionDetected: boolean }

/**
 * Pure: baseline = mean of the prior (most recent REGRESSION_LOOKBACK_RUNS)
 * pass rates; regression = current pass rate at least REGRESSION_THRESHOLD
 * below that baseline. No prior runs -> no baseline yet, never a false
 * regression against nothing (mirrors this codebase's "absence means not
 * attempted, not zero" convention -- see schema.ts's cacheSavingsUsd
 * comment for the same principle applied elsewhere).
 */
export function computeRegression(currentPassRate: number, priorPassRates: number[]): RegressionResult {
  if (priorPassRates.length === 0) return { baselinePassRate: null, regressionDetected: false }
  const window = priorPassRates.slice(0, REGRESSION_LOOKBACK_RUNS)
  const baselinePassRate = window.reduce((sum, r) => sum + r, 0) / window.length
  const regressionDetected = currentPassRate <= baselinePassRate - REGRESSION_THRESHOLD
  return { baselinePassRate, regressionDetected }
}

export type RoleQualityCheckSkip = { roleKey: string; skipped: true; reason: string }
export type RoleQualityCheckResult = {
  roleKey: string
  skipped: false
  runId: string
  model: string
  totalCases: number
  passedCases: number
  passRate: number
  baselinePassRate: number | null
  regressionDetected: boolean
  errorNote: string | null
}

/** Every role a quality check can even be attempted for -- human/code-only roles are never LLM calls (mirrors team-service.ts's own requireCallableRole() gate). */
function eligibleRoles(): RoleDefinition[] {
  return AI_TEAM_ROSTER.filter((r) => !r.isHuman && !r.isCodeOnly && r.model && r.promptKey)
}

/**
 * Runs every registered eval case for one role's prompt template against
 * that role's own live model, scores + persists one role_quality_runs row.
 * Real LLM calls, budget-gated by the same daily cap prompt-eval-
 * service.ts's manual runEval() already enforces, so a recurring job can
 * never become an unbounded-spend loop.
 */
export async function runRoleQualityCheck(
  roleKey: string,
  opts: { triggeredBy?: "scheduled" | "manual" } = {}
): Promise<RoleQualityCheckResult | RoleQualityCheckSkip> {
  const role = AI_TEAM_ROSTER.find((r) => r.roleKey === roleKey)
  if (!role) return { roleKey, skipped: true, reason: "unknown role_key" }
  if (role.isHuman || role.isCodeOnly || !role.model || !role.promptKey) {
    return { roleKey, skipped: true, reason: "not an LLM-backed role (human or code-only)" }
  }

  const template = await db.query.promptTemplates.findFirst({ where: eq(promptTemplates.templateKey, role.promptKey) })
  if (!template) return { roleKey, skipped: true, reason: `no prompt_templates row for template key '${role.promptKey}'` }

  const cases = await db.query.promptEvalCases.findMany({ where: eq(promptEvalCases.promptTemplateId, template.id) })
  if (cases.length === 0) return { roleKey, skipped: true, reason: `no eval cases registered for template '${role.promptKey}' yet -- nothing to run` }

  const productionVersion = await db.query.promptVersions.findFirst({
    where: and(eq(promptVersions.promptTemplateId, template.id), eq(promptVersions.label, "production"), eq(promptVersions.isActive, true)),
    orderBy: (t, { desc }) => desc(t.version),
  })
  if (!productionVersion) return { roleKey, skipped: true, reason: `no 'production'-labeled version for template '${role.promptKey}'` }

  const budget = await checkPromptEvalBudget()
  if (!budget.allowed) return { roleKey, skipped: true, reason: `daily eval budget exhausted: ${budget.reason}` }

  const apiKey = platformApiKeyFor("openrouter")
  if (!apiKey) return { roleKey, skipped: true, reason: "no platform OpenRouter API key configured" }

  // Generated up front (not left to the insert's own $defaultFn) so every
  // eval call's token_usage_ledger row can be tagged
  // `taskSummary = 'role_quality_run:<runId>'` -- cost-quality-service.ts's
  // exact join key back to this run.
  const runId = createId()

  let passedCases = 0
  let latencySum = 0
  let latencySamples = 0
  const errors: string[] = []

  for (const evalCase of cases) {
    const renderedPrompt = renderTemplate(productionVersion.content, evalCase.inputVariables as Record<string, string>)
    const startedAt = Date.now()
    try {
      const result = await callLLM("openrouter", role.model, apiKey, renderedPrompt, evalCase.userMessage)
      latencySum += Date.now() - startedAt
      latencySamples += 1
      const { passed } = scoreKeywords(result.content, evalCase.expectedKeywords as string[])
      if (passed) passedCases += 1
      void logTokenUsage({
        scope: "ai_team_internal",
        roleKey,
        taskSummary: `role_quality_run:${runId}`,
        provider: "openrouter",
        model: role.model,
        usage: result.usage,
        // R65 Part D -- AI Usage Ledger (drizzle/0524): runId is a real,
        // already-generated per-run identifier -- the closest real analog
        // this call site has to a "task" in the ledger's attribution
        // sense. result.durationMs is centrally measured by callLLM().
        taskId: runId,
        durationMs: result.durationMs,
      })
    } catch (error) {
      errors.push(`${evalCase.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const completedCases = cases.length - errors.length
  if (completedCases === 0) {
    return { roleKey, skipped: true, reason: `every eval case errored, nothing scored: ${errors.join("; ").slice(0, 500)}` }
  }

  const passRate = passedCases / completedCases

  const priorRuns = await db.query.roleQualityRuns.findMany({
    where: eq(roleQualityRuns.roleKey, roleKey),
    orderBy: (t, { desc }) => desc(t.createdAt),
    limit: REGRESSION_LOOKBACK_RUNS,
  })
  const { baselinePassRate, regressionDetected } = computeRegression(passRate, priorRuns.map((r) => Number(r.passRate)))

  const errorNote = errors.length > 0 ? `${errors.length}/${cases.length} eval calls errored: ${errors.join("; ").slice(0, 500)}` : null

  const [row] = await db.insert(roleQualityRuns).values({
    id: runId,
    roleKey,
    model: role.model,
    promptTemplateKey: role.promptKey,
    totalCases: completedCases,
    passedCases,
    passRate: passRate.toString(),
    avgLatencyMs: latencySamples > 0 ? Math.round(latencySum / latencySamples) : null,
    baselinePassRate: baselinePassRate !== null ? baselinePassRate.toString() : null,
    regressionDetected,
    triggeredBy: opts.triggeredBy ?? "scheduled",
    errorNote,
  }).returning()

  return {
    roleKey, skipped: false, runId: row.id, model: role.model,
    totalCases: completedCases, passedCases, passRate,
    baselinePassRate, regressionDetected, errorNote,
  }
}

export type RoleQualityRegressionSummary = {
  ranAt: string
  checked: number
  skipped: number
  regressions: RoleQualityCheckResult[]
  results: (RoleQualityCheckResult | RoleQualityCheckSkip)[]
}

/**
 * Recurring-job entry point (Vercel cron ->
 * /api/internal/role-quality-regression/run). Runs every eligible role's
 * check SEQUENTIALLY, not in parallel -- so checkPromptEvalBudget() is
 * re-checked fresh before each role's spend instead of every role racing
 * against a stale budget snapshot taken at the start.
 */
export async function runAllRoleQualityChecks(opts: { triggeredBy?: "scheduled" | "manual" } = {}): Promise<RoleQualityRegressionSummary> {
  const roles = eligibleRoles()
  const results: (RoleQualityCheckResult | RoleQualityCheckSkip)[] = []
  for (const role of roles) {
    results.push(await runRoleQualityCheck(role.roleKey, opts))
  }
  const regressions = results.filter((r): r is RoleQualityCheckResult => !r.skipped && r.regressionDetected)
  return {
    ranAt: new Date().toISOString(),
    checked: results.filter((r) => !r.skipped).length,
    skipped: results.filter((r) => r.skipped).length,
    regressions,
    results,
  }
}

/** Read-only trend query for a dashboard/report surface: one role's run history, most recent first. */
export async function getRoleQualityHistory(roleKey: string, limit = 20) {
  return db.query.roleQualityRuns.findMany({
    where: eq(roleQualityRuns.roleKey, roleKey),
    orderBy: (t, { desc }) => desc(t.createdAt),
    limit,
  })
}
