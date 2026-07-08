// Wave 123 (PROJEXA foundation) -- 3 of the 8 originally-scoped AI
// features (the ones with the strongest existing precedent in this
// codebase; see the plan for why the other 5 are deferred).
//
// estimateProgressFromPhoto follows document-extraction-service.ts's
// extractDocumentContent() shape exactly (vision call -> write back onto
// the source row -> recordOrchestraExecution), including its silent-skip
// posture when no model/vision-model is configured -- both are
// fire-and-forget-friendly, non-blocking enrichments.
//
// generateProgressSummary / detectBudgetScheduleRisk are different:
// user-invoked, on-demand report actions, not background enrichment -- so
// unlike extractDocumentContent they THROW a ServiceError when no model is
// configured rather than silently returning nothing, since the caller
// explicitly asked for this and deserves a clear error, not a blank result.
// Both are deliberately prompted (see 0105_wave123_construction_ai_prompts.sql)
// to only ever reference numbers actually present in the input -- this
// project has a documented prior bug of an AI surface hallucinating generic
// placeholder numbers that didn't match real seeded data, and these prompts
// exist specifically to not repeat that.
import { documents } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq } from "drizzle-orm"
import { resolveModelConfig } from "@/lib/orchestra-model-resolver"
import { callLLMJson, callLLMVision, type LLMProvider } from "@/lib/llm-client"
import { resolvePromptTemplate } from "@/lib/prompt-os-resolver"
import { recordOrchestraExecution } from "@/lib/orchestra-execution-logger"
import { ServiceError } from "./compliance-service"
import { getProjectDashboard } from "./construction-dashboard-service"
import { budgetVsActual } from "./construction-reports-service"
export { ServiceError }

const VISION_MODEL_OVERRIDES: Partial<Record<LLMProvider, string>> = {
  openai: "gpt-4o",
  anthropic: "claude-sonnet-5",
  google: "gemini-2.0-flash",
  openrouter: "openai/gpt-4o-mini",
}

export type ProgressPhotoEstimate = { estimatedPercentComplete: number; reasoning: string; confidence: "low" | "medium" | "high" }

export async function estimateProgressFromPhoto(
  ctx: { orgId: string; userId: string; documentId: string; imageBase64: string; mimeType: string; activityName: string }
): Promise<ProgressPhotoEstimate | null> {
  const startedAt = Date.now()
  const modelConfig = await resolveModelConfig(ctx.orgId, "customer_account_oa")
  if (!modelConfig) return null

  const visionModel = VISION_MODEL_OVERRIDES[modelConfig.provider]
  if (!visionModel) return null

  try {
    const systemPrompt = await resolvePromptTemplate("construction.estimate_progress_from_photo")
    const { content, usage } = await callLLMVision(
      modelConfig.provider, visionModel, modelConfig.apiKey,
      systemPrompt, ctx.imageBase64, ctx.mimeType,
      `This photo documents progress on the activity: "${ctx.activityName}". Respond with the required JSON.`,
      { jsonMode: true, temperature: 0.1, maxTokens: 512 }
    )
    const estimate = JSON.parse(content) as ProgressPhotoEstimate

    await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
      db.update(documents).set({ metadata: { aiProgressEstimate: estimate } }).where(eq(documents.id, ctx.documentId))
    )

    recordOrchestraExecution({
      orgId: ctx.orgId, userId: ctx.userId, layerKey: "customer_account_oa", eventType: "construction.estimate_progress_from_photo",
      input: { documentId: ctx.documentId, activityName: ctx.activityName }, output: { estimatedPercentComplete: estimate.estimatedPercentComplete },
      status: "completed", durationMs: Date.now() - startedAt,
      provider: modelConfig.provider, model: visionModel, usage,
    })
    return estimate
  } catch (err) {
    console.error("Construction photo-progress estimation failed:", err)
    recordOrchestraExecution({
      orgId: ctx.orgId, userId: ctx.userId, layerKey: "customer_account_oa", eventType: "construction.estimate_progress_from_photo",
      input: { documentId: ctx.documentId }, status: "failed", durationMs: Date.now() - startedAt,
      output: { error: err instanceof Error ? err.message : String(err) },
    })
    return null
  }
}

export type ProgressSummary = { summary: string; highlights: string[]; concerns: string[] }

export async function generateProgressSummary(ctx: { orgId: string; userId: string }, projectId: string): Promise<ProgressSummary> {
  const startedAt = Date.now()
  const modelConfig = await resolveModelConfig(ctx.orgId, "task_oa")
  if (!modelConfig) throw new ServiceError("No AI model is configured for this organisation", 400)

  const dashboard = await getProjectDashboard({ orgId: ctx.orgId }, projectId)
  const systemPrompt = await resolvePromptTemplate("construction.generate_progress_summary")
  const userMessage = `Project: ${dashboard.projectName}\nReal aggregated data (JSON): ${JSON.stringify(dashboard)}`

  const { data, usage } = await callLLMJson<ProgressSummary>(
    modelConfig.provider, modelConfig.model, modelConfig.apiKey, systemPrompt, userMessage,
    { temperature: 0.3, maxTokens: 500, expectedKeys: ["summary"] }, modelConfig.fallback
  )

  recordOrchestraExecution({
    orgId: ctx.orgId, userId: ctx.userId, layerKey: "task_oa", eventType: "construction.generate_progress_summary",
    input: { projectId }, output: { summaryLength: data.summary?.length ?? 0 },
    status: "completed", durationMs: Date.now() - startedAt,
    provider: modelConfig.provider, model: modelConfig.model, usage,
  })
  return data
}

export type BudgetScheduleRisk = { riskLevel: "low" | "medium" | "high"; budgetRiskReasoning: string; scheduleRiskReasoning: string; recommendedAction: string }

export async function detectBudgetScheduleRisk(ctx: { orgId: string; userId: string }, projectId: string): Promise<BudgetScheduleRisk> {
  const startedAt = Date.now()
  const modelConfig = await resolveModelConfig(ctx.orgId, "task_oa")
  if (!modelConfig) throw new ServiceError("No AI model is configured for this organisation", 400)

  const [dashboard, budgetActual] = await Promise.all([
    getProjectDashboard({ orgId: ctx.orgId }, projectId),
    budgetVsActual({ orgId: ctx.orgId }, projectId),
  ])
  const systemPrompt = await resolvePromptTemplate("construction.detect_budget_schedule_risk")
  const userMessage = `Real aggregated data (JSON): ${JSON.stringify({
    budget: budgetActual.budget, actual: budgetActual.actual, variance: budgetActual.variance,
    delayedTaskCount: dashboard.delayedTaskCount, totalTaskCount: dashboard.taskCount,
  })}`

  const { data, usage } = await callLLMJson<BudgetScheduleRisk>(
    modelConfig.provider, modelConfig.model, modelConfig.apiKey, systemPrompt, userMessage,
    { temperature: 0.2, maxTokens: 500, expectedKeys: ["riskLevel"] }, modelConfig.fallback
  )

  recordOrchestraExecution({
    orgId: ctx.orgId, userId: ctx.userId, layerKey: "task_oa", eventType: "construction.detect_budget_schedule_risk",
    input: { projectId }, output: { riskLevel: data.riskLevel },
    status: "completed", durationMs: Date.now() - startedAt,
    provider: modelConfig.provider, model: modelConfig.model, usage,
  })
  return data
}
