// Wave 35 (Document AI, VOAC evaluation -- PLATFORM_STRATEGY.md §17).
// Fills a real, confirmed gap: `documents.extractedData` (M-02) has existed
// since Wave 7 with zero consumers -- nothing in this codebase has ever
// populated it. Deliberately built on VERIDIAN's own existing llm-client.ts
// (callLLMVision, added this wave) rather than adopting any external OCR
// library (Marker/Docling/Unstructured/GLM-OCR/Ollama-OCR were all
// evaluated and rejected -- Python, several GPU-dependent, none fitting a
// Vercel serverless Next.js deployment). Fire-and-forget from the upload
// route, same posture as automation-rule-service.ts's evaluateAndRunRules()
// -- extraction must never block or fail the upload it's enriching.
import { documents } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq } from "drizzle-orm"
import { resolveModelConfig } from "@/lib/orchestra-model-resolver"
import { callLLMVision, type LLMProvider } from "@/lib/llm-client"
import { resolvePromptTemplate } from "@/lib/prompt-os-resolver"
import { recordOrchestraExecution } from "@/lib/orchestra-execution-logger"

const SUPPORTED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])

// resolveModelConfig()'s platform default for customer_account_oa is
// llama-3.3-70b-versatile -- a TEXT-ONLY Groq model. Silently sending it an
// image would look like it "worked" (no error) while never actually seeing
// the document. Reuses the exact model names already established in
// llm-client.ts's own MODEL_PRICING table (Wave 23) for the providers with
// a confirmed-vision-capable entry there -- no new/guessed model name
// introduced. Groq has no vision-capable model referenced anywhere in this
// codebase, so it's deliberately left unmapped: extraction is skipped
// (logged, not silently wrong) rather than guess a Groq vision model name
// that might not exist or might already be deprecated by the time this runs.
//
// Wave 46 testing pass: Wave 45 switched the platform default provider to
// OpenRouter, but this map was never updated -- meaning extraction has been
// silently skipped for every org since Wave 45 shipped (the platform's own
// default customer_account_oa config resolves to openrouter, which had no
// entry here, so visionModel was always undefined and every extraction
// returned early with zero work done). openai/gpt-4o-mini confirmed
// vision-capable live via https://openrouter.ai/api/v1/models 2026-07-04.
//
// Load-test fix (PR #117 follow-up): the platform default for
// customer_account_oa is now groq/openai-gpt-oss-120b (text-only). Groq
// has no entry here, so the old `if (!visionModel) return` made extraction
// exit SILENTLY -- no model call, no error, no orchestra_executions row --
// leaving Document AI vision extraction completely dead and invisible for
// every org on the platform default. Now, when the resolved provider has no
// vision override, we fall back to the resolved config's own fallback
// provider (present on every resolved config) before giving up; and even in
// the genuine no-vision case we record a status="failed"
// orchestra_executions row so the skip is at minimum discoverable instead
// of invisible. See the fallback block in extractDocumentContent() below.
const VISION_MODEL_OVERRIDES: Partial<Record<LLMProvider, string>> = {
  openai: "gpt-4o",
  anthropic: "claude-sonnet-5",
  google: "gemini-2.0-flash",
  openrouter: "openai/gpt-4o-mini",
}

export type ExtractedDocumentData = {
  summary: string
  documentType: string | null
  dates: string[]
  amounts: string[]
  referenceNumbers: string[]
  parties: string[]
}

// PDF/other file types are explicitly out of scope this pass -- vision
// support for raw PDF input varies by provider (Anthropic/Google accept it
// natively, Groq/OpenAI's chat-completions vision endpoint does not), and
// getting that right per-provider is a real follow-up, not squeezed into
// this pass just to check a box.
export function isVisionExtractable(mimeType: string | null): boolean {
  return !!mimeType && SUPPORTED_MIME_TYPES.has(mimeType)
}

export async function extractDocumentContent(
  ctx: { orgId: string; userId: string; documentId: string; imageBase64: string; mimeType: string }
): Promise<void> {
  const startedAt = Date.now()
  const modelConfig = await resolveModelConfig(ctx.orgId, "customer_account_oa")
  if (!modelConfig) return // no model configured for this org -- silently skip, matches chat-service.ts's own no-model posture

  // Whatever model was resolved (default or the org's own BYO config) was
  // chosen for text tasks on this layer -- never assume it can see an image.
  // Always route to the known-vision-capable model for this provider
  // instead. If the resolved provider has no confirmed-vision-capable model
  // (e.g. the platform-default Groq), fall back to the resolved config's
  // own fallback provider (present on every resolved config) before giving
  // up. Previously this returned silently when the primary provider had no
  // override -- leaving document AI vision extraction completely dead and
  // invisible for every org on the platform default.
  let visionProvider: LLMProvider = modelConfig.provider
  let visionApiKey: string = modelConfig.apiKey
  let visionModel: string | undefined = VISION_MODEL_OVERRIDES[modelConfig.provider]

  if (!visionModel && modelConfig.fallback) {
    const fallbackVisionModel = VISION_MODEL_OVERRIDES[modelConfig.fallback.provider]
    if (fallbackVisionModel) {
      visionProvider = modelConfig.fallback.provider
      visionApiKey = modelConfig.fallback.apiKey
      visionModel = fallbackVisionModel
    }
  }

  if (!visionModel) {
    // Genuine no-vision-capable-model case: record a discoverable failed
    // row instead of exiting silently, so an operator can see WHY
    // extraction didn't run rather than the upload appearing to succeed
    // with no extracted data and no explanation.
    recordOrchestraExecution({
      orgId: ctx.orgId, userId: ctx.userId, layerKey: "customer_account_oa", eventType: "document.extract_content",
      input: { documentId: ctx.documentId, mimeType: ctx.mimeType }, status: "failed", durationMs: Date.now() - startedAt,
      output: { error: `No vision-capable model configured for provider "${modelConfig.provider}"${modelConfig.fallback ? ` or fallback provider "${modelConfig.fallback.provider}"` : ""} -- document extraction skipped` },
    })
    return
  }

  try {
    const systemPrompt = await resolvePromptTemplate("document.extract_content")
    const { content, usage } = await callLLMVision(
      visionProvider, visionModel, visionApiKey,
      systemPrompt, ctx.imageBase64, ctx.mimeType,
      "Analyze this document and respond with the required JSON.",
      { jsonMode: true, temperature: 0.1, maxTokens: 1024 }
    )
    const extracted = JSON.parse(content) as ExtractedDocumentData

    await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
      db.update(documents).set({ extractedData: extracted }).where(eq(documents.id, ctx.documentId))
    )

    recordOrchestraExecution({
      orgId: ctx.orgId, userId: ctx.userId, layerKey: "customer_account_oa", eventType: "document.extract_content",
      input: { documentId: ctx.documentId, mimeType: ctx.mimeType }, output: { documentType: extracted.documentType },
      status: "completed", durationMs: Date.now() - startedAt,
      provider: visionProvider, model: visionModel, usage,
    })
  } catch (err) {
    console.error("Document extraction failed:", err)
    recordOrchestraExecution({
      orgId: ctx.orgId, userId: ctx.userId, layerKey: "customer_account_oa", eventType: "document.extract_content",
      input: { documentId: ctx.documentId, mimeType: ctx.mimeType }, status: "failed", durationMs: Date.now() - startedAt,
      output: { error: err instanceof Error ? err.message : String(err) },
    })
  }
}
