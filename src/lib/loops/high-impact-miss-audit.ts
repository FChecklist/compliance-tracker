// VERIDIAN Review Framework gap closure (Human-in-Control Architecture,
// 2026-08-07): "the full Intent Engine [high-impact-action-detector.ts's
// TRIGGERS keyword list is a stand-in for] is deferred (Phase 3)" -- the
// review's recommended approach is to track the detector's real
// false-negative rate (tasks that should have required confirmation but
// weren't flagged) so that decision has real evidence behind it instead of
// staying a permanently-deferred guess.
//
// Deliberately standalone (not one of the 15 canonical loop_definitions
// rows), same posture as instruction-mismatch-audit.ts / capability-index-
// freshness-audit.ts -- this audits a specific detector, it isn't a
// platform-improvement loop about the AI-OS itself, and it's cheap enough
// to piggyback on the existing daily cron (see
// /api/internal/loops/run/route.ts) rather than adding a new schedule.
//
// How it works: detectHighImpactAction() is pure and deterministic (same
// text in, same verdict out), so re-running it against a recent task's own
// title+description reproduces exactly what it decided at creation time
// (assuming TRIGGERS hasn't changed within the scan window, a reasonable
// assumption for 24h -- noted here as the one real limitation of this
// approach, not hidden). Tasks it would NOT have gated are the real
// false-negative candidates; a sample of those gets a genuine LLM judgment
// call asking "does this actually describe one of the 9 categories?". The
// resulting rate is recorded every run via the shared loop-improvement-
// proposer.ts helper (loopId 'high_impact_miss_audit') -- reviewable
// through the same review queue Continuous Software Evolution's gap
// closure built (loop-improvement-review-service.ts), not a new one-off
// report nobody reads.
import { db, tasks } from "@/lib/db"
import { gte, desc } from "drizzle-orm"
import { resolveModelConfig } from "@/lib/orchestra-model-resolver"
import { callLLMJson } from "@/lib/llm-client"
import { resolvePromptTemplate } from "@/lib/prompt-os-resolver"
import { recordOrchestraExecution } from "@/lib/orchestra-execution-logger"
import { detectHighImpactAction, type HighImpactCategory } from "@/lib/high-impact-action-detector"
import { proposeLoopImprovement } from "@/lib/loop-improvement-proposer"

const SCAN_WINDOW_HOURS = 24
const SCAN_LIMIT = 500 // bounds the initial task pull, not the (cheaper) filter below
const MAX_JUDGED_PER_RUN = 25 // bounds the real cost: one LLM call per sampled candidate
// Deliberately a starting point, not a tuned constant -- there is no prior
// data on this codebase's real false-negative rate yet (that's the whole
// point of this audit). Revisit once a few weeks of real `rate` values
// exist in loop_improvements (targetId 'phase3_intent_engine_decision').
const PHASE3_RATE_THRESHOLD = 0.05

export type HighImpactMissAuditResult = {
  scanned: number
  ungatedCandidates: number
  sampled: number
  judged: number
  missed: number
  rate: number
  skippedNoModel: number
}

export async function runHighImpactMissAudit(): Promise<HighImpactMissAuditResult> {
  const since = new Date(Date.now() - SCAN_WINDOW_HOURS * 60 * 60 * 1000)
  const recentTasks = await db.query.tasks.findMany({
    where: gte(tasks.createdAt, since),
    columns: { id: true, orgId: true, title: true, description: true },
    orderBy: desc(tasks.createdAt),
    limit: SCAN_LIMIT,
  })

  const ungated = recentTasks.filter(
    (t) => !detectHighImpactAction(`${t.title} ${t.description ?? ""}`).isHighImpact
  )
  const sample = ungated.slice(0, MAX_JUDGED_PER_RUN)

  let missed = 0
  let skippedNoModel = 0
  const examples: { taskId: string; category: HighImpactCategory | null; reason: string }[] = []

  for (const task of sample) {
    const modelConfig = await resolveModelConfig(task.orgId, "task_oa")
    if (!modelConfig) {
      skippedNoModel++
      continue
    }

    const systemPrompt = await resolvePromptTemplate("high_impact_miss_audit.judgment")
    const userMessage = `Title: ${task.title}\nDescription: ${task.description ?? "(none)"}`

    const startedAt = Date.now()
    try {
      const { data: result, usage } = await callLLMJson<{
        isActuallyHighImpact: boolean
        category: string | null
        reason: string
      }>(
        modelConfig.provider, modelConfig.model, modelConfig.apiKey, systemPrompt, userMessage,
        { temperature: 0.1, maxTokens: 150 }, modelConfig.fallback
      )
      recordOrchestraExecution({
        orgId: task.orgId, layerKey: "task_oa", eventType: "high_impact_miss_audit.judgment",
        input: { taskId: task.id }, output: { isActuallyHighImpact: result.isActuallyHighImpact },
        status: "completed", durationMs: Date.now() - startedAt,
        provider: modelConfig.provider, model: modelConfig.model, usage,
      })
      if (result.isActuallyHighImpact) {
        missed++
        if (examples.length < 5) {
          examples.push({ taskId: task.id, category: (result.category as HighImpactCategory) ?? null, reason: result.reason })
        }
      }
    } catch (err) {
      console.error(`High-impact miss audit judgment failed for task ${task.id}:`, err)
      recordOrchestraExecution({
        orgId: task.orgId, layerKey: "task_oa", eventType: "high_impact_miss_audit.judgment",
        input: { taskId: task.id }, status: "failed", durationMs: Date.now() - startedAt,
        output: { error: err instanceof Error ? err.message : String(err) },
      })
    }
  }

  const judged = sample.length - skippedNoModel
  const rate = judged > 0 ? missed / judged : 0

  // One summary row per run, always -- this is the queryable trend line
  // the finding's own recommended approach asks for. isDeployed stays
  // false (proposeLoopImprovement's own contract); a human decides via the
  // review queue whether the current rate actually warrants starting
  // Phase 3, this doesn't decide that automatically.
  await proposeLoopImprovement({
    loopId: "high_impact_miss_audit",
    improvementType: "false_negative_rate_tracking",
    targetType: "high_impact_action_detector",
    targetId: "phase3_intent_engine_decision",
    beforeState: { scanWindowHours: SCAN_WINDOW_HOURS, scanned: recentTasks.length, ungatedCandidates: ungated.length },
    afterState: { judged, missed, rate, recommendPhase3: rate > PHASE3_RATE_THRESHOLD, threshold: PHASE3_RATE_THRESHOLD, examples },
    improvementDelta: rate,
  })

  return { scanned: recentTasks.length, ungatedCandidates: ungated.length, sampled: sample.length, judged, missed, rate, skippedNoModel }
}
