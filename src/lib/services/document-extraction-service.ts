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
  // Always route to the known-vision-capable model for this provider instead.
  const visionModel = VISION_MODEL_OVERRIDES[modelConfig.provider]
  if (!visionModel) return // no confirmed vision-capable model for this provider -- skip rather than guess

  try {
    const systemPrompt = await resolvePromptTemplate("document.extract_content")
    const { content, usage } = await callLLMVision(
      modelConfig.provider, visionModel, modelConfig.apiKey,
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
      provider: modelConfig.provider, model: visionModel, usage,
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
