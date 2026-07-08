// The one AI-touched step in the whole GST module. Takes the deterministic
// validation findings + reconciliation results (already computed by
// validation-engine.ts / reconciliation-engine.ts) and asks an LLM only to
// explain, prioritise, and recommend -- never to recompute a number. Follows
// the same resolveModelConfig -> callLLMJson -> recordOrchestraExecution
// pattern as crm-service.ts's scoreLead/analyzeOpportunity.
import { resolveModelConfig } from "@/lib/orchestra-model-resolver"
import { callLLMJson } from "@/lib/llm-client"
import { resolvePromptTemplate } from "@/lib/prompt-os-resolver"
import { recordOrchestraExecution } from "@/lib/orchestra-execution-logger"

export type AiReviewInput = {
  period: string
  returnType: string
  findings: { ruleCode: string; severity: string; message: string }[]
  reconciliationSummary: { exactMatches: number; probableMatches: number; mismatches: number; missingIn2b: number; missingInBooks: number } | null
  reconciliationDeltas: { matchType: string; deltaAmount: number; notes: string | null }[]
  returnSummary: Record<string, unknown>
}

export type AiReviewResult = {
  verdict: "low" | "medium" | "high"
  summary: string
  topIssues: { title: string; amountAtStake: number | null; recommendation: string }[]
  reportText: string
  provider: string
  model: string
}

export class AiReviewUnavailableError extends Error {}

export async function generateAiReviewReport(orgId: string, userId: string | undefined, input: AiReviewInput): Promise<AiReviewResult> {
  const modelConfig = await resolveModelConfig(orgId, "task_oa")
  if (!modelConfig) throw new AiReviewUnavailableError("No AI provider configured for this organisation")

  const systemPrompt = await resolvePromptTemplate("gst.ai_review_report")
  const userMessage = JSON.stringify({
    period: input.period,
    returnType: input.returnType,
    validationFindings: input.findings,
    reconciliationSummary: input.reconciliationSummary,
    reconciliationDeltas: input.reconciliationDeltas.slice(0, 50), // cap payload size -- top deltas are what matter
    returnSummary: input.returnSummary,
  })

  const startedAt = Date.now()
  const { data, usage } = await callLLMJson<{ verdict: "low" | "medium" | "high"; summary: string; topIssues: { title: string; amountAtStake: number | null; recommendation: string }[]; reportText: string }>(
    modelConfig.provider, modelConfig.model, modelConfig.apiKey, systemPrompt, userMessage,
    { temperature: 0.2, maxTokens: 1200 }, modelConfig.fallback
  )

  recordOrchestraExecution({
    orgId, userId, layerKey: "task_oa", eventType: "gst.ai_review_report",
    input: { period: input.period, returnType: input.returnType, findingCount: input.findings.length },
    output: { verdict: data.verdict },
    status: "completed", durationMs: Date.now() - startedAt,
    provider: modelConfig.provider, model: modelConfig.model, usage,
  })

  return { ...data, provider: modelConfig.provider, model: modelConfig.model }
}
