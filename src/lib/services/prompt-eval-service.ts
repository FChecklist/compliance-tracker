// Wave 94 (Comparison CSV 3 gap analysis: AI011 "Prompt/Model Evaluation
// Framework"). Global/platform-governed, same posture and veridian_admin
// write-gating as prompt-os-service.ts. Runs a prompt version's rendered
// content plus a fixed user message against a chosen provider/model via the
// existing llm-client.ts, using ONLY the platform's own configured API keys
// (orchestra-model-resolver.ts's platformApiKeyFor) -- this never touches
// any org's BYO key, since eval runs are an internal platform-testing tool,
// not a customer workflow. Scoring is deterministic keyword containment
// (real, verifiable pass/fail), never an LLM-judging-an-LLM call.
import { db, promptTemplates, promptVersions, promptEvalCases, promptEvalRuns, users } from "@/lib/db"
import { eq } from "drizzle-orm"
import { hasRole } from "@/lib/supabase/auth-guard"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { callLLM, estimateCostUsd, type LLMProvider } from "@/lib/llm-client"
import { platformApiKeyFor } from "@/lib/orchestra-model-resolver"

export type PromptEvalContext = { userId: string; dbUser: typeof users.$inferSelect }

export async function createEvalCase(
  ctx: PromptEvalContext,
  input: { templateKey: string; name: string; inputVariables?: Record<string, string>; userMessage: string; expectedKeywords: string[] }
) {
  if (!hasRole(ctx.dbUser, "veridian_admin")) throw new ServiceError("Creating an eval case requires veridian_admin", 403)
  if (!input.name?.trim()) throw new ServiceError("name is required", 400)
  if (!input.userMessage?.trim()) throw new ServiceError("userMessage is required", 400)
  if (!input.expectedKeywords || input.expectedKeywords.length === 0) throw new ServiceError("at least one expectedKeyword is required", 400)

  const template = await db.query.promptTemplates.findFirst({ where: eq(promptTemplates.templateKey, input.templateKey) })
  if (!template) throw new ServiceError("Unknown templateKey", 404)

  const [row] = await db.insert(promptEvalCases).values({
    promptTemplateId: template.id, name: input.name, inputVariables: input.inputVariables ?? {},
    userMessage: input.userMessage, expectedKeywords: input.expectedKeywords, createdById: ctx.userId,
  }).returning()
  return row
}

export async function listEvalCases(templateKey?: string) {
  const template = templateKey
    ? await db.query.promptTemplates.findFirst({ where: eq(promptTemplates.templateKey, templateKey) })
    : null
  if (templateKey && !template) throw new ServiceError("Unknown templateKey", 404)

  return db.query.promptEvalCases.findMany({
    where: template ? eq(promptEvalCases.promptTemplateId, template.id) : undefined,
    orderBy: (t, { desc }) => desc(t.createdAt),
  })
}

export async function listEvalRuns(evalCaseId: string) {
  return db.query.promptEvalRuns.findMany({
    where: eq(promptEvalRuns.evalCaseId, evalCaseId),
    orderBy: (t, { desc }) => desc(t.createdAt),
  })
}

function renderTemplate(content: string, variables: Record<string, string>): string {
  let rendered = content
  for (const [key, value] of Object.entries(variables)) rendered = rendered.replaceAll(`{{${key}}}`, value)
  return rendered
}

function scoreKeywords(output: string, expectedKeywords: string[]): { passed: boolean; missingKeywords: string[] } {
  const lowerOutput = output.toLowerCase()
  const missingKeywords = expectedKeywords.filter((k) => !lowerOutput.includes(k.toLowerCase()))
  return { passed: missingKeywords.length === 0, missingKeywords }
}

const EVAL_PROVIDERS: LLMProvider[] = ["groq", "openai", "anthropic", "google", "openrouter"]

export async function runEval(
  ctx: PromptEvalContext,
  input: { evalCaseId: string; promptVersionId: string; provider: string; model: string }
) {
  if (!hasRole(ctx.dbUser, "veridian_admin")) throw new ServiceError("Running an eval requires veridian_admin", 403)
  if (!EVAL_PROVIDERS.includes(input.provider as LLMProvider)) throw new ServiceError(`provider must be one of: ${EVAL_PROVIDERS.join(", ")}`, 400)
  if (!input.model?.trim()) throw new ServiceError("model is required", 400)

  const evalCase = await db.query.promptEvalCases.findFirst({ where: eq(promptEvalCases.id, input.evalCaseId) })
  if (!evalCase) throw new ServiceError("Eval case not found", 404)

  const promptVersion = await db.query.promptVersions.findFirst({ where: eq(promptVersions.id, input.promptVersionId) })
  if (!promptVersion) throw new ServiceError("Prompt version not found", 404)

  const provider = input.provider as LLMProvider
  const apiKey = platformApiKeyFor(provider)
  if (!apiKey) throw new ServiceError(`No platform API key configured for provider '${provider}'`, 400)

  const renderedPrompt = renderTemplate(promptVersion.content, evalCase.inputVariables as Record<string, string>)
  const expectedKeywords = evalCase.expectedKeywords as string[]

  const startedAt = Date.now()
  try {
    const result = await callLLM(provider, input.model, apiKey, renderedPrompt, evalCase.userMessage)
    const latencyMs = Date.now() - startedAt
    const { passed, missingKeywords } = scoreKeywords(result.content, expectedKeywords)

    const [row] = await db.insert(promptEvalRuns).values({
      evalCaseId: evalCase.id, promptVersionId: promptVersion.id, provider, model: input.model,
      renderedPrompt, output: result.content, status: "completed", passed, missingKeywords,
      latencyMs, promptTokens: result.usage.promptTokens, completionTokens: result.usage.completionTokens,
      estimatedCostUsd: estimateCostUsd(input.model, result.usage)?.toString(),
      runById: ctx.userId,
    }).returning()
    return row
  } catch (error) {
    const latencyMs = Date.now() - startedAt
    const [row] = await db.insert(promptEvalRuns).values({
      evalCaseId: evalCase.id, promptVersionId: promptVersion.id, provider, model: input.model,
      renderedPrompt, status: "error", errorMessage: error instanceof Error ? error.message : String(error),
      latencyMs, runById: ctx.userId,
    }).returning()
    return row
  }
}
