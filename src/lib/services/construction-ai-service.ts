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
// (Cognitive Architecture: Deterministic-First Principles wave:
// detectBudgetScheduleRisk is now the one exception -- its riskLevel never
// genuinely needed AI, see classifyBudgetScheduleRisk()'s own header below,
// so "no model configured" now returns a real deterministic result instead
// of a 400. generateProgressSummary still throws -- narrative summary
// generation is genuinely open-ended text, not a label a formula can pick.)
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

// ─── Cognitive Architecture: Deterministic-First Principles ───────────────
// riskLevel used to be decided by the LLM alone even though every input
// (variance, delayedTaskCount, totalTaskCount) is a number, not free text --
// the prompt itself already says "Base riskLevel primarily on variance ...
// and the proportion of delayed tasks" (0105_wave123_construction_ai_
// prompts.sql), i.e. it's asking the model to compute a threshold a
// deterministic function can compute for real. Same "software decides which
// predefined label applies from real state" doctrine already established
// elsewhere in this codebase (risk-classification.ts's classifyRisk(),
// response-engine.ts's own header comment, report-cadence-service.ts's
// activity_log.riskLevel trail). classifyBudgetScheduleRisk() below is that
// deterministic path: pure, unit-tested, most-severe-first threshold
// checks. Thresholds are intentionally coarse and documented, not tuned
// against real incident data (none exists yet) -- same honesty discipline
// as risk-classification.ts's own thresholds.
export type BudgetScheduleRiskFactors = {
  // R67 D-02: budget (and therefore variance) is null when the project has NO
  // budget rows at all -- see construction-dashboard-service.ts's own note.
  // Coercing that to 0 here would have made every unbudgeted project read as
  // "budget 0, variance -<all spend>", i.e. infinitely overspent, which is a
  // fabricated risk assessment. The two pure functions below treat null as
  // "not assessable" and say so.
  budget: number | null
  actual: number
  variance: number | null // budget - actual (construction-reports-service.ts's budgetVsActual) -- negative means over budget
  delayedTaskCount: number
  totalTaskCount: number
}

const HIGH_OVERSPEND_RATIO = 0.20 // 20% over budget
const MEDIUM_OVERSPEND_RATIO = 0.10 // 10% over budget
const HIGH_DELAYED_RATIO = 0.40 // 40% of tasks delayed
const MEDIUM_DELAYED_RATIO = 0.20 // 20% of tasks delayed

/**
 * R67 D-02. How far over budget the project is, as a fraction of its budget.
 * 0 when there is nothing to measure against -- no budget set (null), a zero
 * budget, or no variance figure. A project with no budget is not "0% over
 * budget"; it is unassessable, and both callers below say so in words.
 */
export function overspendRatioOf(factors: BudgetScheduleRiskFactors): number {
  if (factors.budget === null || factors.budget <= 0 || factors.variance === null) return 0
  return Math.max(0, -factors.variance) / factors.budget
}

export function classifyBudgetScheduleRisk(factors: BudgetScheduleRiskFactors): "low" | "medium" | "high" {
  const overspendRatio = overspendRatioOf(factors)
  const delayedRatio = factors.totalTaskCount > 0 ? factors.delayedTaskCount / factors.totalTaskCount : 0

  if (overspendRatio >= HIGH_OVERSPEND_RATIO || delayedRatio >= HIGH_DELAYED_RATIO) return "high"
  if (overspendRatio >= MEDIUM_OVERSPEND_RATIO || delayedRatio >= MEDIUM_DELAYED_RATIO) return "medium"
  return "low"
}

// Deterministic fallback reasoning text, used when no AI model is
// configured for the org (see below) -- classification never needed AI in
// the first place, so "no model configured" no longer means "no answer."
function templateBudgetScheduleRisk(factors: BudgetScheduleRiskFactors, riskLevel: "low" | "medium" | "high"): BudgetScheduleRisk {
  const overspendPct = Math.round(overspendRatioOf(factors) * 100)
  const delayedPct = factors.totalTaskCount > 0 ? Math.round((factors.delayedTaskCount / factors.totalTaskCount) * 100) : 0
  return {
    riskLevel,
    budgetRiskReasoning: factors.budget === null || factors.budget <= 0 || factors.variance === null
      ? "No budget is set for this project, so budget risk could not be assessed."
      : factors.variance < 0
        ? `Project is ${overspendPct}% over budget (actual ${factors.actual} vs budget ${factors.budget}).`
        : `Project is within budget (actual ${factors.actual} vs budget ${factors.budget}).`,
    scheduleRiskReasoning: factors.totalTaskCount <= 0
      ? "No tasks are logged for this project yet, so schedule risk could not be assessed."
      : `${factors.delayedTaskCount} of ${factors.totalTaskCount} tasks (${delayedPct}%) are delayed.`,
    recommendedAction: riskLevel === "high"
      ? "Review budget and schedule with the project team immediately."
      : riskLevel === "medium"
        ? "Monitor budget and schedule closely over the next reporting period."
        : "No immediate action needed; continue routine monitoring.",
  }
}

export async function detectBudgetScheduleRisk(ctx: { orgId: string; userId: string }, projectId: string): Promise<BudgetScheduleRisk> {
  const startedAt = Date.now()

  const [dashboard, budgetActual] = await Promise.all([
    getProjectDashboard({ orgId: ctx.orgId }, projectId),
    budgetVsActual({ orgId: ctx.orgId }, projectId),
  ])
  const factors: BudgetScheduleRiskFactors = {
    budget: budgetActual.budget, actual: budgetActual.actual, variance: budgetActual.variance,
    delayedTaskCount: dashboard.delayedTaskCount, totalTaskCount: dashboard.taskCount,
  }
  const riskLevel = classifyBudgetScheduleRisk(factors)

  const modelConfig = await resolveModelConfig(ctx.orgId, "task_oa")
  if (!modelConfig) return templateBudgetScheduleRisk(factors, riskLevel)

  const systemPrompt = await resolvePromptTemplate("construction.detect_budget_schedule_risk")
  const userMessage = `Real aggregated data (JSON): ${JSON.stringify(factors)}`

  const { data, usage } = await callLLMJson<BudgetScheduleRisk>(
    modelConfig.provider, modelConfig.model, modelConfig.apiKey, systemPrompt, userMessage,
    { temperature: 0.2, maxTokens: 500, expectedKeys: ["riskLevel"] }, modelConfig.fallback
  )
  // riskLevel is always the deterministic value above -- the LLM's own
  // riskLevel output (whatever it decided) is discarded here, never
  // surfaced to a caller. The LLM's real job on this call is the reasoning
  // prose only.
  const result: BudgetScheduleRisk = { ...data, riskLevel }

  recordOrchestraExecution({
    orgId: ctx.orgId, userId: ctx.userId, layerKey: "task_oa", eventType: "construction.detect_budget_schedule_risk",
    input: { projectId }, output: { riskLevel: result.riskLevel },
    status: "completed", durationMs: Date.now() - startedAt,
    provider: modelConfig.provider, model: modelConfig.model, usage,
  })
  return result
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
