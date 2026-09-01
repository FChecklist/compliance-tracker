// VERIDIAN Review Framework gap-closure (AI Cost Governance & FinOps):
// Loop: Cost Anomaly Detection. A read-only, daily observational loop that
// answers the finding "Only static-threshold alerting exists; no true
// spend-anomaly (spike-relative-to-baseline) detection."
//
// cost-guard.ts's isOverLimit/isNearLimit are STATIC -- they fire against an
// absolute monthly cap. An org spending $2/month that spikes to $40/month is
// a 20x spike that crosses no cap and is invisible to cost-guard. This loop
// closes that gap by running ai-cost-finops-service.ts's
// detectSpendAnomaliesFromDb (ratio-vs-baseline across org/role/model) and
// recording every finding as a structured loopImprovements proposal
// (improvementType "investigate_spend_anomaly") for human review -- it never
// changes anyone's cap or disables anything itself (proposeLoopImprovement
// hardcodes isDeployed:false, same posture as every other loop in this dir).
//
// Per the finding's own recommendation this is the SIMPLE, EXPLAINABLE first
// cut (ratio-based deviation), not a statistical model. Escalate to
// statistical methods only if these ratios prove insufficient in practice --
// this loop's own loop_executions.analysisResult carries the raw ratios so a
// future statistical pass has real data to calibrate against, not a guess.
//
// Follows the byo-model-audit.ts / api-token-audit.ts convention: uses the
// raw `db` client (platform-level audit, sees every org's spend), records a
// loop_executions row with observation/analysis/action/measurement, and
// proposes loopImprovements for each material finding. Piggybacks the
// existing daily /api/internal/loops/run cron -- NOT a new vercel.json cron
// entry, same "this is cheap to run alongside the others" reasoning as
// capabilityIndexFreshnessAudit / purgeExpiredLlmResponseCache.
import { db, loopExecutions } from "@/lib/db"
import { detectSpendAnomaliesFromDb, type SpendAnomaly } from "@/lib/services/ai-cost-finops-service"
import { proposeLoopImprovement } from "@/lib/loop-improvement-proposer"

export async function runCostAnomalyAudit(): Promise<{
  dimensionsChecked: number
  anomalyCount: number
  criticalCount: number
  warningCount: number
  topAnomaly: SpendAnomaly | null
  executionTimeMs: number
}> {
  const startedAt = Date.now()

  const { findings, currentWindowDays, baselineWindowDays } = await detectSpendAnomaliesFromDb(7, 28)

  const critical = findings.filter((f) => f.severity === "critical")
  const warning = findings.filter((f) => f.severity === "warning")
  const topAnomaly = findings[0] ?? null

  // One structured, human-reviewable proposal per material anomaly. The
  // improvementType is "investigate_spend_anomaly" (not "raise_cap" or
  // "disable_org" -- this loop never decides that; a human does, with the
  // ratio/delta the proposal carries so the WHY is visible).
  for (const anomaly of findings) {
    await proposeLoopImprovement({
      loopId: "cost-anomaly-audit",
      improvementType: "investigate_spend_anomaly",
      targetType: anomaly.dimension === "org" ? "org" : anomaly.dimension === "role" ? "role" : "model",
      targetId: anomaly.groupKey,
      beforeState: {
        baselineSpendUsd: anomaly.baselineSpendUsd,
        baselineRequests: anomaly.baselineRequests,
        currentSpendUsd: anomaly.currentSpendUsd,
        currentRequests: anomaly.currentRequests,
        ratio: anomaly.ratio,
        deltaUsd: anomaly.deltaUsd,
        severity: anomaly.severity,
        currentWindowDays,
        baselineWindowDays,
      },
      afterState: null, // No proposed change -- this is "please look at this", not a recommended action.
      improvementDelta: anomaly.deltaUsd,
    })
  }

  const executionTimeMs = Date.now() - startedAt

  await db.insert(loopExecutions).values({
    loopId: "cost-anomaly-audit",
    triggeredBy: "scheduled",
    observationData: {
      dimensionsChecked: 3, // org / role / model
      currentWindowDays,
      baselineWindowDays,
      totalBucketsEvaluated: findings.length,
    },
    analysisResult: {
      anomalyCount: findings.length,
      criticalCount: critical.length,
      warningCount: warning.length,
      topAnomaly: topAnomaly ? {
        groupKey: topAnomaly.groupKey,
        dimension: topAnomaly.dimension,
        ratio: topAnomaly.ratio,
        deltaUsd: topAnomaly.deltaUsd,
        severity: topAnomaly.severity,
      } : null,
      findings: findings.map((f) => ({
        groupKey: f.groupKey,
        dimension: f.dimension,
        currentSpendUsd: f.currentSpendUsd,
        baselineSpendUsd: f.baselineSpendUsd,
        ratio: f.ratio,
        deltaUsd: f.deltaUsd,
        severity: f.severity,
        currentRequests: f.currentRequests,
        baselineRequests: f.baselineRequests,
      })),
    },
    actionTaken: { proposalsCreated: findings.length, autoDisabled: false, capChanged: false },
    measurementResult: {},
    executionTimeMs,
  })

  return {
    dimensionsChecked: 3,
    anomalyCount: findings.length,
    criticalCount: critical.length,
    warningCount: warning.length,
    topAnomaly,
    executionTimeMs,
  }
}
