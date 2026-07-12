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
import { callLLMVision } from "@/lib/llm-client"
import { resolvePromptTemplate } from "@/lib/prompt-os-resolver"
import { recordOrchestraExecution } from "@/lib/orchestra-execution-logger"

const SUPPORTED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])

// Wave (2026-07-12, D26.B5.S1): this file used to own its own local
// VISION_MODEL_OVERRIDES map + provider-then-fallback-provider lookup logic
// (resolveModelConfig()'s platform default is a TEXT-ONLY model -- silently
// sending it an image would look like it "worked" while never actually
// seeing the document). That whole mechanism has been generalized into
// orchestra-model-resolver.ts itself as SOURCE_TYPE_MODEL_OVERRIDES /
// applySourceTypeOverride() -- the "closeable part" of the source-type-
// aware-routing gap, using this exact map as the proof case (see that
// file's own header). This service now just asks for the
// "vision_document_extraction" source type and gets back an already-vision-
// capable config, or null if none of the resolved provider/fallback
// provider pair has one -- same two-step lookup as before, just owned in
// one shared place instead of duplicated wherever a source type needs it.
//
// Behavior note (disclosed, not silent): resolveModelConfig() returning
// null now collapses two previously-distinguishable cases -- "no model
// configured for this org at all" (previously a pure silent skip, no
// orchestra_executions row) and "a model resolved but has no vision
// override" (previously a discoverable status="failed" row, added in the
// PR #117 load-test fix referenced below). Both now hit the same failed-row
// path below. This is a strictly MORE visible failure mode than before, in
// keeping with this file's own prior fix's stated goal ("leaving Document
// AI vision extraction completely dead and invisible... is a real bug") --
// not a silent regression.

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
  // "vision_document_extraction" routes through orchestra-model-resolver.ts's
  // SOURCE_TYPE_MODEL_OVERRIDES -- whatever text model the layer/org would
  // otherwise resolve to gets swapped for a confirmed vision-capable model
  // on the same (or fallback) provider, or null if neither has one
  // registered. See this file's own header for the disclosed behavior note
  // on what null now means here.
  const modelConfig = await resolveModelConfig(ctx.orgId, "customer_account_oa", "vision_document_extraction")

  if (!modelConfig) {
    recordOrchestraExecution({
      orgId: ctx.orgId, userId: ctx.userId, layerKey: "customer_account_oa", eventType: "document.extract_content",
      input: { documentId: ctx.documentId, mimeType: ctx.mimeType }, status: "failed", durationMs: Date.now() - startedAt,
      output: { error: "No vision-capable model available for this org (either no model is configured at all, or the resolved provider has no registered vision override) -- document extraction skipped" },
    })
    return
  }

  try {
    const systemPrompt = await resolvePromptTemplate("document.extract_content")
    const { content, usage } = await callLLMVision(
      modelConfig.provider, modelConfig.model, modelConfig.apiKey,
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
      provider: modelConfig.provider, model: modelConfig.model, usage,
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
