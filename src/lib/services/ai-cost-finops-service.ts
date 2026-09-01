// VERIDIAN Review Framework gap-closure (AI Cost Governance & FinOps):
// the cost layer's observability half (token-usage-service.ts) and its
// control half (cost-guard.ts) were both real before this -- but both are
// STATIC. token-usage-service.ts reports what got spent; cost-guard.ts
// enforces a fixed monthly cap (isOverLimit at the absolute cap, isNearLimit
// at 80%). Neither answers the four FinOps questions the Review Framework
// flagged:
//   1. Anomaly detection -- did spend SPIKE relative to a baseline, for a
//      single tenant or role, independent of whether it crossed the cap?
//   2. Forecast vs actual -- where is this month projected to land vs the
//      real number that came in?
//   3. FinOps reconciliation -- does the platform's own engineering cost
//      claim (this ledger) reconcile against a Finance-side figure?
//   4. Unused/idle AI capacity -- is provisioned AI spend going uncalled?
//
// Per the findings' own recommendations this is deliberately the SIMPLE,
// EXPLAINABLE first cut: ratio-vs-baseline anomaly detection (not a
// statistical model), linear run-rate projection (not an ML forecast), a
// reconciliation FRAMEWORK against a stated Finance figure (not a real
// external Finance-system integration -- deferred unless spend scale or an
// audit requirement justifies building a second independent estimate), and
// a quarterly query for idle capacity (not dedicated tooling). Escalate to
// statistical methods / dedicated tooling only if these prove insufficient
// in practice -- same honest "don't overbuild at current scale" posture as
// every other loop in src/lib/loops/.
//
// Pure-compute functions (detectSpendAnomalies, projectMonthEndSpend,
// reconcileFinOpsClaim, classifyIdleCapacity) are deliberately DB-free so
// they're unit-testable without a live Postgres -- matching this repo's own
// erp-fixed-assets-service.test.ts / permission-service.test.ts convention
// of exercising real logic, not a DB, from a .test.ts file. The DB-query
// functions below them assemble the inputs those pure functions consume.
import { db, tokenUsageLedger, customerModelConfig, organisations } from "@/lib/db"
import { eq, and, gte, sql, isNotNull, desc } from "drizzle-orm"

// ─── 1. ANOMALY DETECTION (ratio vs baseline) ─────────────────────────────
//
// A "spend anomaly" here is: this period's spend for a grouping
// (tenant/role/model) is materially higher than its own recent baseline.
// cost-guard.ts's isOverLimit/isNearLimit can't see this -- an org spending
// $2/month that suddenly spends $40/month is a 20x spike worth flagging even
// though it's nowhere near any absolute cap. That's the gap.

export type SpendDimension = "org" | "role" | "model"

export type SpendBucket = {
  /** Stable key for the bucket: orgId / roleKey / model. */
  groupKey: string
  dimension: SpendDimension
  /** Spend in the current (evaluation) window, USD. */
  currentSpendUsd: number
  /** Calls in the current window (a spike driven by 1 huge call vs many
   * small calls is a different signal -- surfaced, not collapsed). */
  currentRequests: number
  /** Average spend per period over the baseline window (the "normal"). */
  baselineSpendUsd: number
  baselineRequests: number
}

export type SpendAnomaly = {
  groupKey: string
  dimension: SpendDimension
  currentSpendUsd: number
  baselineSpendUsd: number
  /** current / baseline. 1.0 = flat, 3.0 = triple the baseline spend. */
  ratio: number
  currentRequests: number
  baselineRequests: number
  /** How far above baseline, in absolute USD. Negative would mean below. */
  deltaUsd: number
  severity: "info" | "warning" | "critical"
}

export type AnomalyThresholds = {
  /** A bucket with fewer than this many baseline-period calls has no
   * reliable "normal" to deviate from -- a single chunky call in a quiet
   * tenant shouldn't fire an anomaly. */
  minBaselineRequests: number
  /** ratio >= this => warning. */
  warningRatio: number
  /** ratio >= this => critical. */
  criticalRatio: number
  /** Absolute USD a spike must clear to count, regardless of ratio -- a
   * 10x spike on a $0.01 baseline is $0.10, not worth flagging. */
  minDeltaUsd: number
}

export const DEFAULT_ANOMALY_THRESHOLDS: AnomalyThresholds = {
  minBaselineRequests: 5,
  warningRatio: 2.5,
  criticalRatio: 5,
  minDeltaUsd: 1,
}

/**
 * Pure compute: given the per-bucket current + baseline spend, return the
 * buckets whose current spend spikes materially above their own baseline.
 * No DB. Deterministic and explainable -- every flagged bucket carries the
 * exact ratio and delta that triggered it, so a reviewer can see WHY.
 *
 * `periodsInBaseline` lets the caller pass spend already averaged per
 * period (so a 28-day baseline and a 7-day current window are comparable);
 * both BucketSpend inputs must already be normalized to one period each.
 */
export function detectSpendAnomalies(
  buckets: SpendBucket[],
  thresholds: AnomalyThresholds = DEFAULT_ANOMALY_THRESHOLDS,
): SpendAnomaly[] {
  const anomalies: SpendAnomaly[] = []
  for (const b of buckets) {
    // No baseline history at all -> can't be an anomaly, just "new".
    if (b.baselineRequests < thresholds.minBaselineRequests) continue
    const ratio = b.baselineSpendUsd > 0 ? b.currentSpendUsd / b.baselineSpendUsd : b.currentSpendUsd > 0 ? Infinity : 0
    const deltaUsd = b.currentSpendUsd - b.baselineSpendUsd
    if (deltaUsd < thresholds.minDeltaUsd) continue
    let severity: SpendAnomaly["severity"] | null = null
    if (ratio >= thresholds.criticalRatio) severity = "critical"
    else if (ratio >= thresholds.warningRatio) severity = "warning"
    if (severity === null) continue
    anomalies.push({
      groupKey: b.groupKey,
      dimension: b.dimension,
      currentSpendUsd: round2(b.currentSpendUsd),
      baselineSpendUsd: round2(b.baselineSpendUsd),
      ratio: ratio === Infinity ? Infinity : round2(ratio),
      currentRequests: b.currentRequests,
      baselineRequests: b.baselineRequests,
      deltaUsd: round2(deltaUsd),
      severity,
    })
  }
  // Most material spikes first (by delta USD), so a reviewer sees the
  // dollars that matter most before the high-ratio-but-low-absolute ones.
  return anomalies.sort((a, b) => b.deltaUsd - a.deltaUsd)
}

// ─── 2. FORECAST VS ACTUAL (linear run-rate projection) ───────────────────
//
// "Where will this month land?" answered the simplest defensible way: take
// spend-so-far this month, divide by the fraction of the month elapsed, get
// a projected month-end. Compare against the ACTUAL when the month is done.
// No seasonality model, no ARIMA -- linear extrapolation, per the finding's
// own "simple linear run-rate projection first, refine only if inaccurate."

export type MonthForecastInput = {
  /** ISO date string for the first moment of the billing month (UTC). */
  monthStartIso: string
  /** ISO date string for "now" -- the projection's as-of point. */
  nowIso: string
  /** Spend recorded between monthStart and now, USD. */
  spendSoFarUsd: number
}

export type MonthForecast = {
  monthStartIso: string
  nowIso: string
  spendSoFarUsd: number
  /** Days elapsed in the month up to `now` (fractional). */
  daysElapsed: number
  /** Total days in this month. */
  daysInMonth: number
  /** Fraction of the month elapsed, 0..1. */
  fractionElapsed: number
  /** Linear run-rate projection: spendSoFar / fractionElapsed. */
  projectedMonthEndUsd: number | null
  /** How the projection compares to the monthly cap, if one is set. */
  capComparison: { monthlyCapUsd: number; projectedVsCapRatio: number; wouldExceedCap: boolean } | null
}

/**
 * Pure compute: project month-end spend from spend-so-far via linear
 * run-rate. Returns projectedMonthEndUsd=null when the month hasn't started
 * accruing yet (no spend, or `now` is at/before month start) -- an honest
 * "no signal" rather than a misleading $0 projection.
 */
export function projectMonthEndSpend(input: MonthForecastInput, monthlyCapUsd?: number | null): MonthForecast {
  const monthStart = new Date(input.monthStartIso)
  const now = new Date(input.nowIso)
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate()
  const daysElapsed = clamp((now.getTime() - monthStart.getTime()) / 86400_000, 0, daysInMonth)
  const fractionElapsed = daysInMonth > 0 ? daysElapsed / daysInMonth : 0

  let projectedMonthEndUsd: number | null = null
  if (fractionElapsed > 0 && input.spendSoFarUsd > 0) {
    projectedMonthEndUsd = round2(input.spendSoFarUsd / fractionElapsed)
  }

  let capComparison: MonthForecast["capComparison"] = null
  if (monthlyCapUsd != null && monthlyCapUsd > 0 && projectedMonthEndUsd != null) {
    capComparison = {
      monthlyCapUsd,
      projectedVsCapRatio: round2(projectedMonthEndUsd / monthlyCapUsd),
      wouldExceedCap: projectedMonthEndUsd > monthlyCapUsd,
    }
  }

  return {
    monthStartIso: input.monthStartIso,
    nowIso: input.nowIso,
    spendSoFarUsd: round2(input.spendSoFarUsd),
    daysElapsed: round2(daysElapsed),
    daysInMonth,
    fractionElapsed: round4(fractionElapsed),
    projectedMonthEndUsd,
    capComparison,
  }
}

/**
 * Pure compute: when a month is COMPLETE, reconcile its projected (the
 * forecast made mid-month) against the actual that landed. This is the
 * "forecasted AI spend vs actual tracked monthly" gap -- a durable record
 * of how accurate the linear projection was, so it can be refined if it's
 * systematically off. Caller persists the pair; this just computes the
 * verdict so the comparison is testable without a DB.
 */
export function reconcileForecastVsActual(input: {
  projectedUsd: number | null
  actualUsd: number
}): { projectedUsd: number | null; actualUsd: number; varianceUsd: number; variancePct: number | null; accuracyVerdict: "accurate" | "under_projected" | "over_projected" | "no_projection" } {
  const { projectedUsd, actualUsd } = input
  if (projectedUsd == null) {
    return { projectedUsd, actualUsd: round2(actualUsd), varianceUsd: 0, variancePct: null, accuracyVerdict: "no_projection" }
  }
  const varianceUsd = actualUsd - projectedUsd
  const variancePct = projectedUsd > 0 ? round2(varianceUsd / projectedUsd) : null
  // Within 15% either way is "accurate" -- a linear run-rate is never going
  // to nail a month to the cent, and that's not the bar. The bar is "is the
  // projection systematically misleading," which a >15% drift starts to be.
  const accuracyVerdict = variancePct == null ? "no_projection" : Math.abs(variancePct) <= 0.15 ? "accurate" : variancePct > 0 ? "under_projected" : "over_projected"
  return { projectedUsd, actualUsd: round2(actualUsd), varianceUsd: round2(varianceUsd), variancePct, accuracyVerdict }
}

// ─── 3. FINOPS RECONCILIATION (engineering claim vs Finance ledger) ────────
//
// The Review Framework finding: "No second, independent 'engineering cost
// claim' exists to reconcile the Finance ledger against." This ledger IS the
// engineering cost claim -- it's the platform's own per-call estimate of
// what each AI call cost. Reconciliation means comparing that against an
// INDEPENDENT figure Finance holds (e.g. the actual provider invoice for the
// month). The finding's own recommendation is to defer a second independent
// ESTIMATE unless spend scale or an audit requirement justifies it -- so
// this builds the reconciliation FRAMEWORK (compare two figures, classify
// the gap, surface it for review) without inventing a fake second estimate
// or wiring a real external Finance-system integration that isn't
// provisioned. A Finance admin enters the ledger figure; the platform
// supplies the engineering claim; the reconciliation verdict is computed.

export type FinOpsReconciliationInput = {
  /** The platform's own engineering cost claim, summed from this ledger. */
  engineeringClaimUsd: number
  /** An independent Finance-side figure (invoice, ledger entry, etc.). */
  financeLedgerUsd: number | null
  billingMonthIso: string
}

export type FinOpsReconciliation = {
  billingMonthIso: string
  engineeringClaimUsd: number
  financeLedgerUsd: number | null
  /** finance - engineering. Positive = Finance shows MORE spend than the
   * platform tracked (the platform is UNDER-reporting). Negative = the
   * platform's estimate exceeds the real invoice (OVER-reporting). */
  varianceUsd: number | null
  variancePct: number | null
  verdict: "balanced" | "platform_under_reports" | "platform_over_reports" | "no_finance_figure"
  /** Honest note on what the variance likely means. */
  note: string
}

/**
 * Pure compute: reconcile the engineering claim against the Finance figure.
 * The recently-completed cost-estimate analysis (task-20260718-050114)
 * already flagged that this ledger's MODEL_PRICING for Groq's floor-tier
 * model understates real pricing ~3.3-4x -- so a "platform under-reports"
 * verdict here is a real, expected signal, not a bug in this logic. The
 * reconciliation makes that drift visible instead of buried.
 */
export function reconcileFinOpsClaim(input: FinOpsReconciliationInput): FinOpsReconciliation {
  const { engineeringClaimUsd, financeLedgerUsd, billingMonthIso } = input
  if (financeLedgerUsd == null) {
    return {
      billingMonthIso,
      engineeringClaimUsd: round2(engineeringClaimUsd),
      financeLedgerUsd: null,
      varianceUsd: null,
      variancePct: null,
      verdict: "no_finance_figure",
      note: "No Finance-side figure entered for this month. Enter the provider invoice total to reconcile against the platform's engineering claim.",
    }
  }
  const varianceUsd = financeLedgerUsd - engineeringClaimUsd
  const variancePct = engineeringClaimUsd > 0 ? round2(varianceUsd / engineeringClaimUsd) : null
  let verdict: FinOpsReconciliation["verdict"]
  let note: string
  // Within 10% is "balanced" -- the engineering estimate is meant to
  // approximate, not match to the cent, and provider invoices include line
  // items (e.g. cached-token discounts, free-tier credits) this ledger's
  // per-call estimate can't see.
  if (variancePct == null || Math.abs(variancePct) <= 0.10) {
    verdict = "balanced"
    note = "Engineering claim and Finance figure are within 10% -- the ledger's per-call estimate is reconciling acceptably."
  } else if (varianceUsd > 0) {
    verdict = "platform_under_reports"
    note = "Finance shows more spend than the platform tracked. Expected at current scale: this ledger's MODEL_PRICING can lag real provider pricing (see task-20260718-050114 cost-estimate analysis). Worth updating MODEL_PRICING if the drift is persistent."
  } else {
    verdict = "platform_over_reports"
    note = "The platform's estimate exceeds the real invoice. Likely provider credits/free-tier discounts the per-call estimate doesn't account for. No action needed unless the over-report is large."
  }
  return {
    billingMonthIso,
    engineeringClaimUsd: round2(engineeringClaimUsd),
    financeLedgerUsd: round2(financeLedgerUsd),
    varianceUsd: round2(varianceUsd),
    variancePct,
    verdict,
    note,
  }
}

// ─── 4. UNUSED / IDLE AI CAPACITY ──────────────────────────────────────────
//
// "Provisioned but not consumed." Two real shapes in this codebase:
//   (a) A customer_model_config row (BYO model) that's active but has had
//       zero orchestra_executions against its org+layer in the window --
//       the org provisioned a model/key and never uses it. byo-model-audit
//       already detects this per-config; we reuse its shape rather than
//       forking a second detector.
//   (b) Orgs on the platform-default floor tier that have made zero
//       product_orchestra calls at all in the window -- provisioned AI
//       capacity (a working default model, an enabled AI surface) going
//       uncalled. Per the finding: "Simple quarterly query, not worth
//       dedicated tooling at current scale" -- so this is exactly that.

export type IdleCapacityFinding = {
  kind: "unused_byo_config" | "dormant_floor_tier_org"
  orgId: string
  /** model name for unused_byo_config; floor-tier model for dormant orgs. */
  model: string | null
  provider: string | null
  layerKey: string | null
  /** Days in the lookback window this finding covers. */
  windowDays: number
  /** Calls in the window (0 for the idle cases this flags). */
  requestsInWindow: number
  note: string
}

/**
 * Pure compute: classify raw per-org / per-config activity rows into idle
 * findings. Separated from the DB so the thresholds are testable. Mirrors
 * byo-model-audit.ts's STALE_UNUSED_DAYS / "active config, zero executions"
 * logic, generalized to also catch orgs with zero AI calls at all.
 */
export function classifyIdleCapacity(input: {
  byoConfigs: { id: string; orgId: string; provider: string; modelName: string | null; layerKey: string | null; requestsInWindow: number }[]
  orgFloorTierActivity: { orgId: string; model: string; provider: string; requestsInWindow: number }[]
  windowDays: number
  /** A BYO config with <= this many calls in the window is "unused." */
  unusedConfigMaxRequests?: number
  /** An org with <= this many product calls in the window is "dormant." */
  dormantOrgMaxRequests?: number
}): IdleCapacityFinding[] {
  const unusedMax = input.unusedConfigMaxRequests ?? 0
  const dormantMax = input.dormantOrgMaxRequests ?? 0
  const findings: IdleCapacityFinding[] = []

  for (const c of input.byoConfigs) {
    if (c.requestsInWindow <= unusedMax) {
      findings.push({
        kind: "unused_byo_config",
        orgId: c.orgId,
        model: c.modelName,
        provider: c.provider,
        layerKey: c.layerKey,
        windowDays: input.windowDays,
        requestsInWindow: c.requestsInWindow,
        note: `Active BYO model config (${c.provider}/${c.modelName}) with ${c.requestsInWindow} call(s) in the last ${input.windowDays} days. Provisioned AI capacity going unconsumed -- the org may be paying for a key/model it isn't using.`,
      })
    }
  }
  for (const o of input.orgFloorTierActivity) {
    if (o.requestsInWindow <= dormantMax) {
      findings.push({
        kind: "dormant_floor_tier_org",
        orgId: o.orgId,
        model: o.model,
        provider: o.provider,
        layerKey: null,
        windowDays: input.windowDays,
        requestsInWindow: o.requestsInWindow,
        note: `Org on the platform-default floor tier (${o.provider}/${o.model}) with ${o.requestsInWindow} product AI call(s) in the last ${input.windowDays} days. AI capacity is provisioned/enabled but not being exercised -- worth confirming whether this org still needs AI enabled.`,
      })
    }
  }
  return findings
}

// ─── DB QUERIES ────────────────────────────────────────────────────────────
//
// These assemble the inputs the pure functions above consume. Uses the raw
// `db` client (postgres role) deliberately -- the token usage ledger spans
// both platform-internal (no org) and per-org rows, and the FinOps dashboard
// is veridian_admin (Finance) scoped across every tenant, so this was never
// a fit for withTenantContext's single-org model. Same posture as
// token-usage-service.ts and cost-guard.ts's raw-db reads.

export type FinOpsDashboard = {
  generatedAtIso: string
  anomaly: {
    currentWindowDays: number
    baselineWindowDays: number
    thresholds: AnomalyThresholds
    findings: SpendAnomaly[]
  }
  forecast: MonthForecast
  reconciliation: FinOpsReconciliation
  idleCapacity: {
    windowDays: number
    findings: IdleCapacityFinding[]
  }
}

const AGG = {
  requests: sql<number>`count(*)::int`,
  spend: sql<number>`coalesce(sum(${tokenUsageLedger.estimatedCostUsd}), 0)::float`,
}

/** Spend per groupKey for a window, for one dimension. */
async function spendByDimension(dimension: SpendDimension, since: Date, until: Date): Promise<SpendBucket[]> {
  const groupCol =
    dimension === "org" ? tokenUsageLedger.orgId : dimension === "role" ? tokenUsageLedger.roleKey : tokenUsageLedger.model
  const rows = await db
    .select({ groupKey: groupCol, requests: AGG.requests, spend: AGG.spend })
    .from(tokenUsageLedger)
    .where(and(
      gte(tokenUsageLedger.createdAt, since),
      sql`${tokenUsageLedger.createdAt} < ${until}`,
      isNotNull(groupCol),
      // Anomaly detection is about per-org/per-role spend patterns, which
      // live in product_orchestra rows. ai_team_internal is platform-owned
      // (orgId null) and out of scope for a tenant/role spike -- same scope
      // decision cost-guard.ts makes for the cap.
      eq(tokenUsageLedger.scope, "product_orchestra"),
    ))
    .groupBy(groupCol)
  return rows.map((r) => ({
    groupKey: r.groupKey ?? "(unknown)",
    dimension,
    currentSpendUsd: Number(r.spend),
    currentRequests: Number(r.requests),
    baselineSpendUsd: 0,
    baselineRequests: 0,
  }))
}

/**
 * Detect spend anomalies across org / role / model dimensions. Current
 * window = last `currentWindowDays`; baseline = the `baselineWindowDays`
 * immediately BEFORE the current window. Both normalized to one period so
 * the ratio is apples-to-apples (a 7-day current vs 28-day baseline would
 * otherwise make everything look like a 4x under-spend).
 */
export async function detectSpendAnomaliesFromDb(
  currentWindowDays = 7,
  baselineWindowDays = 28,
  thresholds: AnomalyThresholds = DEFAULT_ANOMALY_THRESHOLDS,
): Promise<{ currentWindowDays: number; baselineWindowDays: number; thresholds: AnomalyThresholds; findings: SpendAnomaly[] }> {
  const now = new Date()
  const currentStart = new Date(now.getTime() - currentWindowDays * 86400_000)
  const baselineStart = new Date(now.getTime() - (currentWindowDays + baselineWindowDays) * 86400_000)

  const dimensions: SpendDimension[] = ["org", "role", "model"]
  const all: SpendAnomaly[] = []
  for (const dim of dimensions) {
    const [current, baseline] = await Promise.all([
      spendByDimension(dim, currentStart, now),
      spendByDimension(dim, baselineStart, currentStart),
    ])
    // Normalize baseline to per-period-of-the-current-window-length so the
    // ratio is comparable: baseline averaged per day * currentWindowDays.
    const baselineByDay = new Map(baseline.map((b) => [b.groupKey, b]))
    const buckets: SpendBucket[] = current.map((c) => {
      const b = baselineByDay.get(c.groupKey)
      const baselinePerPeriod = b ? {
        spend: (b.currentSpendUsd / baselineWindowDays) * currentWindowDays,
        requests: Math.round((b.currentRequests / baselineWindowDays) * currentWindowDays),
      } : { spend: 0, requests: 0 }
      return { ...c, baselineSpendUsd: baselinePerPeriod.spend, baselineRequests: baselinePerPeriod.requests }
    })
    all.push(...detectSpendAnomalies(buckets, thresholds))
  }
  return { currentWindowDays, baselineWindowDays, thresholds, findings: all }
}

/** This org's month-to-date spend (product_orchestra only), for the forecast. */
async function getOrgMonthSpend(orgId: string): Promise<number> {
  const [row] = await db
    .select({ spend: AGG.spend })
    .from(tokenUsageLedger)
    .where(and(
      eq(tokenUsageLedger.orgId, orgId),
      eq(tokenUsageLedger.scope, "product_orchestra"),
      gte(tokenUsageLedger.createdAt, startOfMonthUtc(new Date())),
    ))
  return Number(row?.spend ?? 0)
}

export async function getForecastForOrg(orgId: string): Promise<MonthForecast> {
  const monthStart = startOfMonthUtc(new Date())
  const org = await db.query.organisations.findFirst({ where: eq(organisations.id, orgId) })
  const monthlyCapUsd = org?.monthlyCostCapUsd != null ? Number(org.monthlyCostCapUsd) : null
  const spendSoFar = await getOrgMonthSpend(orgId)
  return projectMonthEndSpend(
    { monthStartIso: monthStart.toISOString(), nowIso: new Date().toISOString(), spendSoFarUsd: spendSoFar },
    monthlyCapUsd,
  )
}

/** Platform-wide engineering cost claim for a billing month (every org,
 * product_orchestra scope). This is the figure reconciled against Finance. */
export async function getEngineeringClaimForMonth(monthStartIso: string): Promise<number> {
  const monthStart = new Date(monthStartIso)
  const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1))
  const [row] = await db
    .select({ spend: AGG.spend })
    .from(tokenUsageLedger)
    .where(and(
      eq(tokenUsageLedger.scope, "product_orchestra"),
      gte(tokenUsageLedger.createdAt, monthStart),
      sql`${tokenUsageLedger.createdAt} < ${monthEnd}`,
    ))
  return Number(row?.spend ?? 0)
}

/** Build the FinOps reconciliation for a given billing month. The Finance
 * ledger figure is an independent input (no Finance-system integration
 * exists -- it's entered by a Finance admin via the FinOps surface). */
export async function getFinOpsReconciliationForMonth(monthStartIso: string, financeLedgerUsd: number | null): Promise<FinOpsReconciliation> {
  const engineeringClaimUsd = await getEngineeringClaimForMonth(monthStartIso)
  return reconcileFinOpsClaim({ engineeringClaimUsd, financeLedgerUsd, billingMonthIso: monthStartIso })
}

/** Identify unused/idle AI capacity across the platform -- the quarterly
 * query the finding asked for, runnable any time. Reuses
 * byo-model-audit.ts's detection shape (active config, zero executions)
 * rather than forking a second detector. */
export async function identifyIdleAiCapacityFromDb(windowDays = 90): Promise<{ windowDays: number; findings: IdleCapacityFinding[] }> {
  const cutoff = new Date(Date.now() - windowDays * 86400_000)

  // (a) BYO configs: active, with call counts in the window.
  const configs = await db.query.customerModelConfig.findMany({
    where: eq(customerModelConfig.isActive, true),
    columns: { id: true, orgId: true, provider: true, modelName: true, orchestraLayerId: true },
  })
  const byoInputs: { id: string; orgId: string; provider: string; modelName: string | null; layerKey: string | null; requestsInWindow: number }[] = []
  for (const c of configs) {
    const [row] = await db
      .select({ requests: AGG.requests })
      .from(tokenUsageLedger)
      .where(and(
        eq(tokenUsageLedger.orgId, c.orgId),
        c.orchestraLayerId ? eq(tokenUsageLedger.layerKey, c.orchestraLayerId) : undefined,
        gte(tokenUsageLedger.createdAt, cutoff),
      ))
    byoInputs.push({ id: c.id, orgId: c.orgId, provider: c.provider, modelName: c.modelName, layerKey: c.orchestraLayerId, requestsInWindow: Number(row?.requests ?? 0) })
  }

  // (b) Orgs on the platform default that made zero product AI calls in
  // the window. floorTierOrgs derived from orgs that have NO active BYO
  // config (so they're definitely on the platform default) and whose
  // product_orchestra spend rows in the window are zero.
  const orgs = await db.select({ id: organisations.id }).from(organisations)
  const orgsWithByo = new Set(configs.map((c) => c.orgId))
  const floorOrgs = orgs.filter((o) => !orgsWithByo.has(o.id))
  const floorActivity: { orgId: string; model: string; provider: string; requestsInWindow: number }[] = []
  for (const o of floorOrgs) {
    const [row] = await db
      .select({ requests: AGG.requests })
      .from(tokenUsageLedger)
      .where(and(
        eq(tokenUsageLedger.orgId, o.id),
        eq(tokenUsageLedger.scope, "product_orchestra"),
        gte(tokenUsageLedger.createdAt, cutoff),
      ))
    floorActivity.push({ orgId: o.id, model: "openai/gpt-oss-120b", provider: "groq", requestsInWindow: Number(row?.requests ?? 0) })
  }

  const findings = classifyIdleCapacity({
    byoConfigs: byoInputs,
    orgFloorTierActivity: floorActivity,
    windowDays,
  })
  return { windowDays, findings }
}

/** The full veridian_admin (Finance) FinOps dashboard, one call. */
export async function getFinOpsDashboard(monthStartIso: string, financeLedgerUsd: number | null): Promise<FinOpsDashboard> {
  const [anomaly, reconciliation, idleCapacity] = await Promise.all([
    detectSpendAnomaliesFromDb(),
    getFinOpsReconciliationForMonth(monthStartIso, financeLedgerUsd),
    identifyIdleAiCapacityFromDb(),
  ])
  // Forecast is org-scoped (a Finance admin watching their own org's run
  // rate); the dashboard surfaces the current org's forecast. The caller
  // (the route) supplies orgId for this -- but to keep this function
  // platform-wide-reconcilable without a per-org loop, we surface the
  // platform-wide month spend as the forecast's spendSoFar instead. Done
  // inline below to avoid an extra query layer.
  const monthStart = new Date(monthStartIso)
  const [totalsRow] = await db
    .select({ spend: AGG.spend })
    .from(tokenUsageLedger)
    .where(and(
      eq(tokenUsageLedger.scope, "product_orchestra"),
      gte(tokenUsageLedger.createdAt, monthStart),
    ))
  const forecast = projectMonthEndSpend({
    monthStartIso: monthStartIso,
    nowIso: new Date().toISOString(),
    spendSoFarUsd: Number(totalsRow?.spend ?? 0),
  })
  return {
    generatedAtIso: new Date().toISOString(),
    anomaly,
    forecast,
    reconciliation,
    idleCapacity,
  }
}

// ─── small numeric helpers ─────────────────────────────────────────────────
function round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100 }
function round4(n: number): number { return Math.round((n + Number.EPSILON) * 10000) / 10000 }
function clamp(n: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, n)) }
function startOfMonthUtc(d: Date): Date { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)) }
