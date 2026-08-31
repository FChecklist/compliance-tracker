// AI Model Lifecycle & Benchmarking gap-closure (VERIDIAN Review Framework,
// 2026-08-15), Finding 3: "Provider-outage historical incident correlation
// with role failures." Confirmed genuinely 0% before this file: no
// provider_outages/incidents table existed anywhere in schema.ts (grep for
// outage|incident|provider_status|downtime turns up only the unrelated
// compliance-domain `incidents` table and two prose comments in
// llm-client.ts/response-engine.ts). d1-metrics-tracker-service.ts's own
// "Safe Autonomy" section independently confirms the adjacent gap
// (escalation-events) for the same reason: nothing persists a queryable
// row when a provider call fails.
//
// This does NOT touch llm-client.ts's callLLM() hot path (that function is
// shared by ~20 call sites; adding a DB write there is a real blast-radius
// risk this gap-closure doesn't need to take). Instead it works from data
// that already exists: platform.dispatch_outcomes already records role_key
// + model_used + status ('success'|'failure') + dispatched_at for every
// real AI Dev Team dispatch (Stage 12, drizzle/0300) -- no new columns
// needed on that table. provider_outage_windows (this wave) is the outage-
// window table the recommended approach asked for; correlateOutageWith
// RoleFailures() below is the correlation query, comparing each role's real
// failure rate DURING a recorded window against its own failure rate in an
// equal-length window immediately BEFORE it (a same-role baseline, not a
// cross-role average) -- so "correlated" means a measured rate change, not
// just a raw failure count that could just as easily be normal background
// noise.
//
// findCandidateOutageWindows() is a pragmatic addition beyond the literal
// ask: manual outage entry alone depends on an admin's own discipline
// (checking a provider's status page and remembering to log it), so this
// also reconstructs CANDIDATE windows directly from dispatch_outcomes'
// own clustered-failure pattern -- surfaced for an admin to review and
// promote (recordOutageWindow with source='auto_detected'), never
// auto-inserted as a confirmed incident without a human decision.
import { db, dispatchOutcomes, providerOutageWindows } from "@/lib/db"
import { and, between, eq, isNull, or } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type RecordOutageWindowInput = {
  provider: string
  model?: string | null
  startedAt: Date
  endedAt?: Date | null
  source?: "manual" | "auto_detected"
  detectionNote?: string | null
  recordedById?: string | null
}

export async function recordOutageWindow(input: RecordOutageWindowInput) {
  if (!input.provider?.trim()) throw new ServiceError("provider is required", 400)
  if (!input.startedAt) throw new ServiceError("startedAt is required", 400)
  if (input.endedAt && input.endedAt < input.startedAt) throw new ServiceError("endedAt cannot be before startedAt", 400)

  const [row] = await db.insert(providerOutageWindows).values({
    provider: input.provider,
    model: input.model ?? null,
    startedAt: input.startedAt,
    endedAt: input.endedAt ?? null,
    source: input.source ?? "manual",
    detectionNote: input.detectionNote ?? null,
    recordedById: input.recordedById ?? null,
  }).returning()
  return row
}

export async function listOutageWindows(opts: { provider?: string; limit?: number } = {}) {
  return db.query.providerOutageWindows.findMany({
    where: opts.provider ? eq(providerOutageWindows.provider, opts.provider) : undefined,
    orderBy: (t, { desc }) => desc(t.startedAt),
    limit: opts.limit ?? 50,
  })
}

// ─── Correlation ──────────────────────────────────────────────────────────
export type RoleFailureCorrelationEntry = {
  roleKey: string
  duringFailures: number
  duringTotal: number
  duringFailureRate: number | null
  baselineFailures: number
  baselineTotal: number
  baselineFailureRate: number | null
  /** duringFailureRate - baselineFailureRate. null when either rate has no signal (zero dispatches in that window). Positive = failures got worse during the outage window. */
  failureRateDelta: number | null
}

type DispatchStatusRow = { roleKey: string; status: string }

/** Pure: groups already-fetched dispatch rows by role_key for both windows and computes each role's failure-rate delta. Never fabricates a rate from zero dispatches (null, not 0/1). */
export function buildCorrelation(duringRows: DispatchStatusRow[], baselineRows: DispatchStatusRow[]): RoleFailureCorrelationEntry[] {
  function countByRole(rows: DispatchStatusRow[]): Map<string, { total: number; failures: number }> {
    const counts = new Map<string, { total: number; failures: number }>()
    for (const row of rows) {
      const entry = counts.get(row.roleKey) ?? { total: 0, failures: 0 }
      entry.total += 1
      if (row.status === "failure") entry.failures += 1
      counts.set(row.roleKey, entry)
    }
    return counts
  }

  const during = countByRole(duringRows)
  const baseline = countByRole(baselineRows)
  const roleKeys = new Set([...during.keys(), ...baseline.keys()])

  const entries: RoleFailureCorrelationEntry[] = Array.from(roleKeys).map((roleKey) => {
    const d = during.get(roleKey) ?? { total: 0, failures: 0 }
    const b = baseline.get(roleKey) ?? { total: 0, failures: 0 }
    const duringFailureRate = d.total > 0 ? d.failures / d.total : null
    const baselineFailureRate = b.total > 0 ? b.failures / b.total : null
    return {
      roleKey,
      duringFailures: d.failures, duringTotal: d.total, duringFailureRate,
      baselineFailures: b.failures, baselineTotal: b.total, baselineFailureRate,
      failureRateDelta: duringFailureRate !== null && baselineFailureRate !== null ? duringFailureRate - baselineFailureRate : null,
    }
  })

  // Worst-affected role first (largest positive delta = failures spiked the most during the window).
  entries.sort((a, b) => (b.failureRateDelta ?? -Infinity) - (a.failureRateDelta ?? -Infinity))
  return entries
}

export type OutageCorrelationResult = {
  outageWindowId: string
  provider: string
  model: string | null
  startedAt: string
  endedAt: string | null
  baselineWindowStart: string
  baselineWindowEnd: string
  roles: RoleFailureCorrelationEntry[]
}

/**
 * Real DB correlation: for a recorded outage window, compares each role's
 * dispatch_outcomes failure rate DURING the window against its own
 * failure rate in an equal-length window immediately BEFORE it (same-role
 * baseline). An ongoing window (endedAt = null) uses "now" as the window
 * end for both the during-window query and the baseline duration calc.
 */
export async function correlateOutageWithRoleFailures(outageWindowId: string): Promise<OutageCorrelationResult> {
  const outage = await db.query.providerOutageWindows.findFirst({ where: eq(providerOutageWindows.id, outageWindowId) })
  if (!outage) throw new ServiceError("Outage window not found", 404)

  const windowEnd = outage.endedAt ?? new Date()
  const durationMs = Math.max(windowEnd.getTime() - outage.startedAt.getTime(), 1)
  const baselineStart = new Date(outage.startedAt.getTime() - durationMs)
  const baselineEnd = outage.startedAt

  const modelFilter = outage.model ? eq(dispatchOutcomes.modelUsed, outage.model) : undefined

  const [duringRows, baselineRows] = await Promise.all([
    db.select({ roleKey: dispatchOutcomes.roleKey, status: dispatchOutcomes.status })
      .from(dispatchOutcomes)
      .where(and(between(dispatchOutcomes.dispatchedAt, outage.startedAt, windowEnd), modelFilter)),
    db.select({ roleKey: dispatchOutcomes.roleKey, status: dispatchOutcomes.status })
      .from(dispatchOutcomes)
      .where(and(between(dispatchOutcomes.dispatchedAt, baselineStart, baselineEnd), modelFilter)),
  ])

  return {
    outageWindowId: outage.id,
    provider: outage.provider,
    model: outage.model,
    startedAt: outage.startedAt.toISOString(),
    endedAt: outage.endedAt ? outage.endedAt.toISOString() : null,
    baselineWindowStart: baselineStart.toISOString(),
    baselineWindowEnd: baselineEnd.toISOString(),
    roles: buildCorrelation(duringRows, baselineRows),
  }
}

// ─── Candidate (auto-detected) outage windows ────────────────────────────
export const MIN_CLUSTER_SIZE = 3
export const CLUSTER_GAP_MINUTES = 15

export type FailureClusterInput = { model: string; dispatchedAt: Date }
export type CandidateOutageWindow = { model: string; startedAt: Date; endedAt: Date; failureCount: number }

/**
 * Pure: greedily groups one model's consecutive failures into a cluster
 * whenever the gap between two consecutive failures is <=
 * CLUSTER_GAP_MINUTES, emitting a candidate window only when a cluster
 * reaches MIN_CLUSTER_SIZE -- an isolated single failure (the normal,
 * expected background rate) is never surfaced as a candidate outage.
 */
export function detectFailureClusters(failures: FailureClusterInput[]): CandidateOutageWindow[] {
  const byModel = new Map<string, Date[]>()
  for (const f of failures) {
    const list = byModel.get(f.model) ?? []
    list.push(f.dispatchedAt)
    byModel.set(f.model, list)
  }

  const candidates: CandidateOutageWindow[] = []
  const gapMs = CLUSTER_GAP_MINUTES * 60_000

  for (const [model, timestamps] of byModel) {
    const sorted = [...timestamps].sort((a, b) => a.getTime() - b.getTime())
    let clusterStart = sorted[0]
    let clusterEnd = sorted[0]
    let clusterSize = 1

    const flush = () => {
      if (clusterSize >= MIN_CLUSTER_SIZE) {
        candidates.push({ model, startedAt: clusterStart, endedAt: clusterEnd, failureCount: clusterSize })
      }
    }

    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i].getTime() - clusterEnd.getTime()
      if (gap <= gapMs) {
        clusterEnd = sorted[i]
        clusterSize += 1
      } else {
        flush()
        clusterStart = sorted[i]
        clusterEnd = sorted[i]
        clusterSize = 1
      }
    }
    flush()
  }

  return candidates
}

/**
 * DB-shell: real clustered-failure candidates from platform.dispatch_
 * outcomes, over the last `sinceDays`, excluding any (model, time range)
 * already covered by a recorded providerOutageWindows row for that model
 * -- so re-running this after an admin promotes a candidate doesn't keep
 * re-surfacing the same incident.
 */
export async function findCandidateOutageWindows(opts: { sinceDays?: number } = {}): Promise<CandidateOutageWindow[]> {
  const since = new Date(Date.now() - (opts.sinceDays ?? 14) * 86_400_000)

  const failureRows = await db
    .select({ model: dispatchOutcomes.modelUsed, dispatchedAt: dispatchOutcomes.dispatchedAt })
    .from(dispatchOutcomes)
    .where(and(eq(dispatchOutcomes.status, "failure"), between(dispatchOutcomes.dispatchedAt, since, new Date())))

  const failures = failureRows.filter((r): r is { model: string; dispatchedAt: Date } => r.model != null)
  const candidates = detectFailureClusters(failures)
  if (candidates.length === 0) return []

  const existingWindows = await db.query.providerOutageWindows.findMany({
    where: or(isNull(providerOutageWindows.endedAt), between(providerOutageWindows.startedAt, since, new Date())),
  })

  return candidates.filter((candidate) => {
    return !existingWindows.some((w) => {
      if (w.model && w.model !== candidate.model) return false
      const windowEnd = w.endedAt ?? new Date()
      return candidate.startedAt <= windowEnd && candidate.endedAt >= w.startedAt
    })
  })
}
