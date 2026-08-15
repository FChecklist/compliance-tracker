// AI Model Lifecycle & Benchmarking gap-closure, Finding 3: "Provider-
// outage historical incident correlation with role failures."
//
// Investigated before writing this: no table anywhere records a
// provider-outage window (grepped schema.ts for "outage" -- zero matches
// before this file's migration), and no query joins one against role
// failures. incidents (schema.ts, INCIDENTS & EVENTS) is a compliance
// incident-response table (stage: logged/triaged/investigating -- GST
// notices, statutory events), a different domain entirely, not reused
// here. Honestly scoped: no external provider status-page integration
// exists in this codebase to auto-populate outage windows (a real
// infrastructure decision, not something this gap-closure invents) --
// provider_outage_windows starts as an admin-recorded log; the
// CORRELATION query below is the real, automated part this finding asks
// for.
//
// Two independent failure sources are correlated, since this codebase has
// two independent call paths with two different "provider" meanings:
//   - AI Dev Team dispatches (activity_log, role_key) always transport
//     through OpenRouter (team-service.ts's runRole), but roster.ts pins
//     specific models to a preferred UPSTREAM vendor (llm-client.ts's
//     getPreferredUpstreamProvider -- "DeepInfra" for GLM-5.2, "DeepSeek"
//     for DeepSeek V4 Pro); that upstream vendor is the real thing that
//     can have an outage, so failures are resolved to it, not flattened to
//     "openrouter" for every role.
//   - Orchestra Layer executions (orchestra_executions) already carry a
//     real `provider` column directly (groq/openai/anthropic/google/
//     openrouter, aiProviderEnum) -- used as-is.
import { db, activityLog, orchestraExecutions, providerOutageWindows } from "@/lib/db"
import { and, eq, gte } from "drizzle-orm"
import { getRole } from "@/lib/ai-team/roster"
import { getPreferredUpstreamProvider } from "@/lib/llm-client"

export type FailureEvent = {
  provider: string
  occurredAt: Date
  source: "ai_team" | "orchestra"
  roleKeyOrModel: string
}

export type OutageWindow = { id: string; provider: string; startedAt: Date; endedAt: Date | null }

export type OutageCorrelationEntry = {
  windowId: string
  provider: string
  startedAt: Date
  endedAt: Date | null
  windowDurationMs: number | null
  failuresDuringWindow: number
  failuresPerHourDuringWindow: number | null
  baselineFailuresPerHourForProvider: number
  /** failuresPerHourDuringWindow / baselineFailuresPerHourForProvider -- >1 means failures ran hotter during the outage than this provider's normal rate; null when the window has no end yet or baseline is 0 (no comparable signal). */
  correlationRatio: number | null
}

const MS_PER_HOUR = 3_600_000

/**
 * Pure: for each outage window, counts real failure events whose provider
 * matches and whose timestamp falls inside [startedAt, endedAt ?? nowMs],
 * and compares the resulting per-hour rate against that provider's
 * baseline failure rate OUTSIDE any outage window (over the same overall
 * observation range) -- a raw count means nothing without a "is this
 * actually elevated" comparison.
 *
 * `nowMs` is injected (never Date.now() internally) so this stays a pure,
 * fully deterministic function -- caller-supplied "now" for an ongoing
 * (endedAt = null) window, matching this codebase's ban on Date.now() in
 * scripts/pure-core boundaries.
 */
export function correlateFailuresWithOutages(
  windows: OutageWindow[],
  failures: FailureEvent[],
  nowMs: number
): OutageCorrelationEntry[] {
  return windows.map((w) => {
    const windowEndMs = w.endedAt ? w.endedAt.getTime() : nowMs
    const windowDurationMs = Math.max(0, windowEndMs - w.startedAt.getTime())

    const providerFailures = failures.filter((f) => f.provider === w.provider)
    const duringWindow = providerFailures.filter((f) => {
      const t = f.occurredAt.getTime()
      return t >= w.startedAt.getTime() && t <= windowEndMs
    })
    const outsideWindow = providerFailures.filter((f) => !duringWindow.includes(f))

    // Baseline observation span = the full range covered by this
    // provider's failure events outside the window, so a provider with
    // sparse history doesn't get an artificially inflated/deflated rate
    // from an arbitrary fixed lookback.
    const outsideTimestamps = outsideWindow.map((f) => f.occurredAt.getTime())
    const baselineSpanMs =
      outsideTimestamps.length > 1 ? Math.max(...outsideTimestamps) - Math.min(...outsideTimestamps) : 0
    const baselineFailuresPerHourForProvider =
      baselineSpanMs > 0 ? outsideWindow.length / (baselineSpanMs / MS_PER_HOUR) : 0

    const failuresPerHourDuringWindow = windowDurationMs > 0 ? duringWindow.length / (windowDurationMs / MS_PER_HOUR) : null

    const correlationRatio =
      failuresPerHourDuringWindow !== null && baselineFailuresPerHourForProvider > 0
        ? failuresPerHourDuringWindow / baselineFailuresPerHourForProvider
        : null

    return {
      windowId: w.id,
      provider: w.provider,
      startedAt: w.startedAt,
      endedAt: w.endedAt,
      windowDurationMs,
      failuresDuringWindow: duringWindow.length,
      failuresPerHourDuringWindow,
      baselineFailuresPerHourForProvider,
      correlationRatio,
    }
  })
}

/** Resolves an AI Dev Team activity_log row's role_key to the real upstream provider it would have called through, or null when that role's model has no pinned preference (OpenRouter picks dynamically -- no single vendor label would be honest, so it's excluded from correlation rather than mislabeled). */
export function resolveAiTeamFailureProvider(roleKey: string | null): string | null {
  if (!roleKey) return null
  const role = getRole(roleKey)
  if (!role?.model) return null
  return getPreferredUpstreamProvider(role.model)
}

export type OutageCorrelationReport = { generatedAt: Date; entries: OutageCorrelationEntry[]; totalFailureEventsConsidered: number }

/**
 * Real DB wrapper. sinceDays bounds both the outage windows considered and
 * the failure events pulled to build the baseline/window counts.
 * Platform-level (raw `db`), same posture as every other cross-org
 * governance query this gap-closure touches.
 */
export async function getOutageCorrelationReport(sinceDays = 90): Promise<OutageCorrelationReport> {
  const since = new Date(Date.now() - sinceDays * 86_400_000)
  const now = new Date()

  const windowRows = await db
    .select({ id: providerOutageWindows.id, provider: providerOutageWindows.provider, startedAt: providerOutageWindows.startedAt, endedAt: providerOutageWindows.endedAt })
    .from(providerOutageWindows)
    .where(gte(providerOutageWindows.startedAt, since))

  const aiTeamFailureRows = await db
    .select({ roleKey: activityLog.roleKey, createdAt: activityLog.createdAt })
    .from(activityLog)
    .where(and(eq(activityLog.activityType, "ai_team_dispatch"), eq(activityLog.lifecycleStage, "failed"), gte(activityLog.createdAt, since)))

  const orchestraFailureRows = await db
    .select({ provider: orchestraExecutions.provider, model: orchestraExecutions.model, createdAt: orchestraExecutions.createdAt })
    .from(orchestraExecutions)
    .where(and(eq(orchestraExecutions.status, "failed"), gte(orchestraExecutions.createdAt, since)))

  const failures: FailureEvent[] = []
  for (const row of aiTeamFailureRows) {
    const provider = resolveAiTeamFailureProvider(row.roleKey)
    if (provider) failures.push({ provider, occurredAt: row.createdAt, source: "ai_team", roleKeyOrModel: row.roleKey ?? "unknown" })
  }
  for (const row of orchestraFailureRows) {
    if (row.provider) failures.push({ provider: row.provider, occurredAt: row.createdAt, source: "orchestra", roleKeyOrModel: row.model ?? "unknown" })
  }

  const windows: OutageWindow[] = windowRows.map((w) => ({ id: w.id, provider: w.provider, startedAt: w.startedAt, endedAt: w.endedAt }))
  const entries = correlateFailuresWithOutages(windows, failures, now.getTime())

  return { generatedAt: now, entries, totalFailureEventsConsidered: failures.length }
}

export type RecordOutageWindowInput = { provider: string; startedAt: Date; endedAt?: Date | null; notes?: string | null; createdBy: string }

/** Manual entry point -- see this file's header for why there is no automated status-page feed yet. */
export async function recordOutageWindow(input: RecordOutageWindowInput): Promise<{ id: string }> {
  const [row] = await db
    .insert(providerOutageWindows)
    .values({
      provider: input.provider,
      startedAt: input.startedAt,
      endedAt: input.endedAt ?? null,
      source: "manual",
      notes: input.notes ?? null,
      createdBy: input.createdBy,
    })
    .returning({ id: providerOutageWindows.id })
  return row
}
