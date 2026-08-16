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
import { callLLM, callLLMJson, callLLMVision, type LLMProvider } from "@/lib/llm-client"
import { resolvePromptTemplate } from "@/lib/prompt-os-resolver"
import { recordOrchestraExecution } from "@/lib/orchestra-execution-logger"
import { enforcePolicy, refusalMessageFor } from "@/lib/policy-enforcement-engine"
import { DEFAULT_DOMAIN } from "@/lib/purpose-bound-ai"
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

export type DrawingDescription = { drawingType: string | null; elements: string[]; dimensions: string[]; annotations: string[]; notes: string }
export type DrawingDiff = { added: string[]; removed: string[]; changed: string[]; summary: string }

// Wave 127: callLLMVision() accepts exactly one image, so a two-image diff
// is done as describe(A) + describe(B) + diff(textA, textB) -- 3 calls,
// each individually logged -- rather than extending that shared,
// platform-wide function's signature for one feature's sake.
export async function diffDrawingRevisions(
  ctx: { orgId: string; userId: string },
  input: { imageBase64A: string; mimeTypeA: string; imageBase64B: string; mimeTypeB: string }
): Promise<DrawingDiff> {
  const modelConfig = await resolveModelConfig(ctx.orgId, "customer_account_oa")
  if (!modelConfig) throw new ServiceError("No AI model is configured for this organisation", 400)
  const visionModel = VISION_MODEL_OVERRIDES[modelConfig.provider]
  if (!visionModel) throw new ServiceError("No vision-capable model available for this organisation's configured provider", 400)

  const describePrompt = await resolvePromptTemplate("construction.describe_drawing")

  async function describe(imageBase64: string, mimeType: string, label: string): Promise<DrawingDescription> {
    const startedAt = Date.now()
    const { content, usage } = await callLLMVision(
      modelConfig!.provider, visionModel!, modelConfig!.apiKey,
      describePrompt, imageBase64, mimeType,
      "Analyze this drawing and respond with the required JSON.",
      { jsonMode: true, temperature: 0.1, maxTokens: 768 }
    )
    recordOrchestraExecution({
      orgId: ctx.orgId, userId: ctx.userId, layerKey: "customer_account_oa", eventType: "construction.describe_drawing",
      input: { label }, output: {}, status: "completed", durationMs: Date.now() - startedAt,
      provider: modelConfig!.provider, model: visionModel!, usage,
    })
    return JSON.parse(content) as DrawingDescription
  }

  const [descA, descB] = await Promise.all([
    describe(input.imageBase64A, input.mimeTypeA, "revisionA"),
    describe(input.imageBase64B, input.mimeTypeB, "revisionB"),
  ])

  const diffStartedAt = Date.now()
  const diffPrompt = await resolvePromptTemplate("construction.diff_drawing_descriptions")
  const { data, usage } = await callLLMJson<DrawingDiff>(
    modelConfig.provider, modelConfig.model, modelConfig.apiKey, diffPrompt,
    `Earlier revision (JSON): ${JSON.stringify(descA)}\n\nLater revision (JSON): ${JSON.stringify(descB)}`,
    { temperature: 0.2, maxTokens: 600, expectedKeys: ["summary"] }, modelConfig.fallback
  )
  recordOrchestraExecution({
    orgId: ctx.orgId, userId: ctx.userId, layerKey: "task_oa", eventType: "construction.diff_drawing_descriptions",
    input: {}, output: { addedCount: data.added?.length ?? 0, removedCount: data.removed?.length ?? 0 },
    status: "completed", durationMs: Date.now() - diffStartedAt,
    provider: modelConfig.provider, model: modelConfig.model, usage,
  })
  return data
}

// Wave 132 (PROJEXA's Discuss pill): genuine free-form conversational chat,
// deliberately NOT part of the deterministic Chain Selector/dispatchTool()
// mechanism -- callLLM's raw-text path, not callLLMJson, since a chat reply
// isn't a structured record. No live project data is passed in (the prompt
// explicitly tells the model to defer to the Assistant actions for that),
// so unlike generateProgressSummary/detectBudgetScheduleRisk there's no
// hallucinated-numbers risk to guard against here.
export async function discussConstruction(
  ctx: { orgId: string; userId: string },
  message: string,
  history: { role: "user" | "assistant"; content: string }[] = []
): Promise<{ reply: string }> {
  const startedAt = Date.now()
  // Gap closure, 2026-07-09 (AUDIT_2026-07-09.md, Agent Framework section):
  // this is genuine free-form user chat, exactly the shape the Constitution's
  // Policy Enforcement Engine gates elsewhere (VERI Chat/FDE/Page Agent) --
  // was never wired here despite being the same risk surface.
  const policyDecision = enforcePolicy(
    { orgId: ctx.orgId, userId: ctx.userId, domain: DEFAULT_DOMAIN, layerKey: "user_assistant_oa", eventType: "construction.discuss" },
    message
  )
  if (!policyDecision.allowed) return { reply: refusalMessageFor(policyDecision) }

  const modelConfig = await resolveModelConfig(ctx.orgId, "user_assistant_oa")
  if (!modelConfig) throw new ServiceError("No AI model is configured for this organisation", 400)

  const systemPrompt = await resolvePromptTemplate("construction.discuss")
  const transcript = history.map((m) => `${m.role === "user" ? "User" : "VERI"}: ${m.content}`).join("\n")
  const userMessage = transcript ? `${transcript}\nUser: ${message}` : message

  const { content, usage } = await callLLM(
    modelConfig.provider, modelConfig.model, modelConfig.apiKey, systemPrompt, userMessage,
    { temperature: 0.4, maxTokens: 500 }, modelConfig.fallback
  )

  recordOrchestraExecution({
    orgId: ctx.orgId, userId: ctx.userId, layerKey: "user_assistant_oa", eventType: "construction.discuss",
    input: { messageLength: message.length }, output: { replyLength: content.length },
    status: "completed", durationMs: Date.now() - startedAt,
    provider: modelConfig.provider, model: modelConfig.model, usage,
  })
  return { reply: content }
}
