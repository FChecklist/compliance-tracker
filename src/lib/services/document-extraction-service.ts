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
//
// VERIDIAN Review Framework remediation ("Supports Multiple Input Types",
// 2026-07-18): this used to be image-only (jpeg/png/webp), with PDF
// explicitly deferred pending a per-provider vision-support story
// (Anthropic/Google accept raw PDF natively, Groq/OpenAI's chat-completions
// vision endpoint does not -- see llm-client.ts's own header). This pass
// sidesteps that per-provider inconsistency entirely: PDF/Word/PowerPoint/
// email now extract to plain TEXT first (pdf-parse, already a dependency
// used elsewhere for spreadsheet/PDF ingest -- see src/lib/ingest/
// parser.ts; officecli-client.ts for docx/pptx, the same vendored-binary
// path ai-report-builder-service.ts already uses for Word), then run
// through the ordinary text callLLMJson path -- the same dual image-vs-text
// extraction shape ai-report-builder-service.ts already established for its
// own upload-to-AI flow (extractUploadContent()). Working from real text
// means every provider/model an org has configured can do this, not just
// the 2 with native PDF support.
// Video is explicitly NOT added this pass: there is no frame-extraction/
// rasterization library anywhere in this codebase or its dependencies, and
// no provider wired into llm-client.ts accepts raw video over the simple
// HTTP JSON endpoints this file already uses. Faking support by feeding a
// video's raw byte stream through as "text" would silently produce
// garbage, which this codebase's own documented discipline
// (construction-ai-service.ts's header: "a documented prior bug of an AI
// surface hallucinating generic placeholder numbers... these prompts exist
// specifically to not repeat that") treats as worse than not supporting it.
//
// CRR P3-BRIDGE (2026-08-27), platform.crr_spec CRR-079: this file used to
// write documents.extractedData and stop -- extracted text was never
// chunked or embedded, so nothing uploaded through the real upload route
// was ever retrievable. chunkAndEmbedSourceObject (below) is that missing
// bridge: chunkText (CRR-076/077) -> storeChunkEmbedding (CRR-079/080) ->
// compliance.document_chunk, with source_object.extract_status walked
// through EXTRACTED -> CHUNKED -> EMBEDDED as each stage completes. See
// chunkAndEmbedSourceObject's own header for the full design, including why
// it (still) creates its own source_object row today rather than requiring
// one from the caller (that requirement lands in CRR-084).
import { documents, sourceObject, chunkPolicy } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq } from "drizzle-orm"
import { resolveModelConfig } from "@/lib/orchestra-model-resolver"
import { callLLMVision, callLLMJson, type LLMUsage } from "@/lib/llm-client"
import { resolvePromptTemplate } from "@/lib/prompt-os-resolver"
import { recordOrchestraExecution } from "@/lib/orchestra-execution-logger"
import { autoClassifyDocument } from "@/lib/services/document-classification-service"
import { extractDocxRawText, extractPptxRawText } from "@/lib/officecli-client"
import { createSourceObject } from "@/lib/crr/capture"
import { chunkText, type ChunkPolicy } from "@/lib/crr/chunker"
import { storeChunkEmbedding } from "@/lib/crr/embed"

const VISION_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])
const PDF_MIME_TYPE = "application/pdf"
const WORD_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
const POWERPOINT_MIME_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
const EMAIL_MIME_TYPES = new Set(["message/rfc822"])
// Order reflects the recommended incremental-by-usage-frequency rollout:
// PDF (by far the most common compliance-evidence format) first, then the
// two Office formats already read/written elsewhere in this codebase, then
// email last (real, but the least frequent of the four in this domain).
const TEXT_EXTRACTABLE_MIME_TYPES = new Set<string>([PDF_MIME_TYPE, WORD_MIME_TYPE, POWERPOINT_MIME_TYPE, ...EMAIL_MIME_TYPES])

// Matches ai-report-builder-service.ts's own MAX_EXTRACTED_CHARS constant --
// same rationale (a generous ceiling for typical compliance documents while
// keeping prompt cost/latency bounded for anything unusually long).
const MAX_EXTRACTED_CHARS = 12000

export type ExtractedDocumentData = {
  summary: string
  documentType: string | null
  dates: string[]
  amounts: string[]
  referenceNumbers: string[]
  parties: string[]
}

/**
 * Image types sent directly to a vision-capable model. Unchanged from
 * before this pass -- ai-report-builder-service.ts and
 * construction-ai-service.ts both already depend on this exact meaning, so
 * this stays image-only rather than being widened to cover the new text-
 * extractable types below.
 */
export function isVisionExtractable(mimeType: string | null): boolean {
  return !!mimeType && VISION_MIME_TYPES.has(mimeType)
}

/**
 * PDF/Word/PowerPoint/email types extracted to plain text before an
 * ordinary text LLM call -- see this file's own header for why these four
 * (usage-frequency order) and why video is not among them.
 */
export function isTextExtractable(mimeType: string | null): boolean {
  return !!mimeType && TEXT_EXTRACTABLE_MIME_TYPES.has(mimeType)
}

/** Either extraction path -- the one check src/app/api/documents/route.ts needs to decide whether to fire extraction at all. */
export function isDocumentExtractable(mimeType: string | null): boolean {
  return isVisionExtractable(mimeType) || isTextExtractable(mimeType)
}

// Best-effort RFC822 header+body extraction for uploaded .eml files -- NOT a
// full MIME parser (no multipart-boundary walking, no quoted-printable/
// base64 Content-Transfer-Encoding decoding, no header-folding/RFC2047
// encoded-word decoding). Handles the common real case this platform needs:
// a single-part plain-text email saved/forwarded as .eml so Document AI can
// read Subject/From/To/body the same as any other uploaded document. A
// multipart or non-plain-text .eml still parses without crashing -- the
// header block is unaffected -- but its body may include MIME boundary
// markers or an undecoded base64/quoted-printable blob rather than clean
// readable text; that's a disclosed limitation, not a silent wrong answer,
// the same honesty posture as the PDF branch below declining a scanned
// (textless) PDF rather than guessing at its content.
// Exported solely for direct unit testing (same rationale as officecli-
// client.ts's parseQueryResultToText export) -- not meant to be a public
// entry point other services should call directly.
export function extractEmailRawText(buffer: Buffer): string {
  const raw = buffer.toString("utf-8")
  const splitIndex = raw.search(/\r?\n\r?\n/)
  const headerBlock = splitIndex === -1 ? raw : raw.slice(0, splitIndex)
  const body = splitIndex === -1 ? "" : raw.slice(splitIndex).trim()

  const wantedHeaders = new Set(["subject", "from", "to", "date"])
  const headerLines: string[] = []
  for (const line of headerBlock.split(/\r?\n/)) {
    const match = line.match(/^([\w-]+):\s*(.*)$/)
    if (match && wantedHeaders.has(match[1].toLowerCase())) {
      headerLines.push(`${match[1]}: ${match[2]}`)
    }
  }
  return [...headerLines, "", body].join("\n").trim()
}

// Exported solely for direct unit testing -- see extractEmailRawText's own
// comment above for the rationale.
export async function extractRawTextForMimeType(mimeType: string, buffer: Buffer): Promise<string> {
  if (mimeType === PDF_MIME_TYPE) {
    // Same pdf-parse `PDFParse` class + call shape as src/lib/ingest/
    // parser.ts's own parsePdf() -- see that file's comment for why this is
    // a class (constructor + async getText()), not the old callable-default
    // export some pdf-parse major versions used to have.
    const { PDFParse } = await import("pdf-parse")
    const parser = new PDFParse({ data: buffer })
    try {
      const data = await parser.getText()
      if (!data.text.trim()) {
        throw new Error("This PDF has no extractable text -- it may be a scanned image with no text layer (native PDF rasterization/OCR is not supported).")
      }
      return data.text
    } finally {
      await parser.destroy()
    }
  }
  if (mimeType === WORD_MIME_TYPE) {
    const { value } = await extractDocxRawText(buffer)
    if (!value.trim()) throw new Error("This Word document has no readable text content.")
    return value
  }
  if (mimeType === POWERPOINT_MIME_TYPE) {
    const { value } = await extractPptxRawText(buffer)
    if (!value.trim()) throw new Error("This PowerPoint file has no readable text content.")
    return value
  }
  if (EMAIL_MIME_TYPES.has(mimeType)) {
    const text = extractEmailRawText(buffer)
    if (!text.trim()) throw new Error("This email file has no readable text content.")
    return text
  }
  throw new Error(`Unsupported mime type for text extraction: ${mimeType}`)
}

// CRR-035 (Capture/Recall/Reuse, R-70): moved out of
// src/app/api/documents/extract/route.ts, which used to make this exact
// callLLMJson call itself with this exact prompt inline -- that route is now
// a thin transport wrapper (auth, input-shape handling, response formatting)
// with zero extraction logic of its own, per this project's "the service is
// the tested home; the route is transport" rule. Schema/prompt content is
// unchanged from the route's original -- this is a relocation, not a
// behavior change, so existing callers of that route keep the same response
// shape (noticeNumber/authority/demandAmount/pan/gstin/... fields).
export type ExtractedComplianceFields = {
  noticeNumber: string | null
  authority: string | null
  demandAmount: number | null
  pan: string | null
  gstin: string | null
  arn: string | null
  period: string | null
  dueDate: string | null
  complianceType: string | null
  description: string | null
  title: string | null
}

const COMPLIANCE_EXTRACTION_PROMPT = `You are a compliance document extraction AI for Indian regulatory filings. Extract structured information from the document text provided.

Analyze the text and return a JSON object with the following fields (use null for fields you cannot determine):

{
  "noticeNumber": "The notice/challan/reference number if found",
  "authority": "The issuing authority (e.g., CGST, ITD, EPFO, MCA, State GST, etc.)",
  "demandAmount": "The demand/tax/penalty amount as a number, or null",
  "pan": "PAN number if found (10-char alphanumeric)",
  "gstin": "GSTIN if found (15-char alphanumeric starting with digits)",
  "arn": "Acknowledgement Reference Number if found",
  "period": "The tax period (e.g., 'March 2025', 'Q4 FY2024-25', 'FY 2024-25')",
  "dueDate": "Due date in ISO 8601 format (YYYY-MM-DD) if found, or null",
  "complianceType": "One of: GST, TDS, PF, ESIC, INCOME_TAX, MCA, ROC, LABOUR, ENVIRONMENTAL, OTHER",
  "description": "A brief 1-2 sentence summary of the document content",
  "title": "A short title for this document/compliance item"
}

Rules:
- Be precise with numbers and dates
- Default complianceType to "OTHER" if you cannot determine it
- For demandAmount, extract only the numeric value without currency symbols
- Return ONLY the JSON object, no additional text`

/**
 * Compliance-specific structured-field extraction (noticeNumber/PAN/GSTIN/
 * demandAmount/...) from already-obtained plain text. Distinct from
 * extractDocumentContent above (ExtractedDocumentData: summary/dates/
 * amounts/parties, vision+text, writes straight to compliance.documents) --
 * this one is synchronous-response-shaped for a caller that needs the
 * fields back immediately (the /api/documents/extract route), not a
 * fire-and-forget background writer.
 */
export async function extractComplianceFields(
  orgId: string,
  textContent: string
): Promise<ExtractedComplianceFields> {
  const modelConfig = await resolveModelConfig(orgId, "customer_account_oa")
  if (!modelConfig) {
    throw new Error("No AI model configured for document extraction. Configure one in Settings -> AI Configuration.")
  }
  const { data } = await callLLMJson<ExtractedComplianceFields>(
    modelConfig.provider,
    modelConfig.model,
    modelConfig.apiKey,
    COMPLIANCE_EXTRACTION_PROMPT,
    textContent.slice(0, MAX_EXTRACTED_CHARS),
    { temperature: 0.1, maxTokens: 2048 },
    modelConfig.fallback
  )
  return data
}

// CRR-079 (P3-BRIDGE): picks the compliance.chunk_policy row to chunk this
// text with -- an exact match on businessObjectType when one is known and a
// policy row exists for it, else the always-present 'generic' row (see
// chunk_policy's own schema.ts comment: "Global, non-tenant-scoped chunking
// configuration"). Exported as a pure, DB-free function (same convention as
// this file's extractEmailRawText/extractRawTextForMimeType) -- the actual
// chunk_policy rows are fetched once in chunkAndEmbedSourceObject below and
// handed to this function, so the matching rule itself is unit-testable
// without a live DB.
export function pickChunkPolicy<T extends { businessObjectType: string }>(
  businessObjectType: string | null | undefined,
  policies: T[]
): T | null {
  if (businessObjectType) {
    const exact = policies.find((p) => p.businessObjectType === businessObjectType)
    if (exact) return exact
  }
  return policies.find((p) => p.businessObjectType === "generic") ?? null
}

// CRR-079 (P3-BRIDGE): the missing chunk+embed bridge -- see this file's own
// header and platform.crr_spec CRR-079/CRR-080. Turns the plain text
// extractRawTextForMimeType just produced into real, retrievable
// compliance.document_chunk rows.
//
// Runs only for the text-extraction branch (rawText is this bridge's only
// real input) -- the vision branch's `extracted` JSON is a model's
// structured READ of the document, not its source text, so it is not a
// valid chunkText input; wiring vision-sourced documents into this same
// pipeline is separate, later scope.
//
// CRR-084 (not yet done as of this point's own closure) will make the live
// upload route (src/app/api/documents/route.ts) call createSourceObject
// itself, persist documents.source_object_id, and pass ctx.sourceObjectId
// into extractDocumentContent -- until then, this function creates its own
// source_object row on the fly so there is something real for chunks to
// hang off of today. createSourceObject's own sha256-dedup contract (CRR-078)
// means re-running extraction against identical bytes never double-captures
// a second source_object row. A caller that DOES already have one
// (ctx.sourceObjectId) skips capture entirely and chunks straight against it.
//
// Every failure here is caught by the caller (extractDocumentContent) and
// recorded on source_object.extract_status=FAILED / extract_error -- a
// retrieval-indexing failure must never turn an otherwise-successful
// compliance-field extraction (extractedData, already written by the time
// this runs) into a failed orchestra_executions row.
//
// Deliberately serial, one chunk embedded at a time -- CRR-081 (batch the
// provider calls) and CRR-082 (resumable / skip-already-embedded) are
// separate, later points in this same P3-BRIDGE phase; this point's own
// failure_points already discloses the large-document timeout risk that
// leaves open, and CRR-083 is where console.error here becomes a real
// compliance.crr_ingest_error row.
// Exported solely for direct integration testing (CRR-079's own gate_pass:
// "Integration test: upload a 20-page PDF, assert document_chunk count > 10
// and every row has is_real=true") and for CRR-084's future reuse when the
// upload route starts calling this directly with a real sourceObjectId --
// not meant to be a public entry point other services should call for
// day-to-day extraction (call extractDocumentContent for that).
export async function chunkAndEmbedSourceObject(ctx: {
  orgId: string
  userId: string
  documentId: string
  mimeType: string
  buffer: Buffer
  rawText: string
  sourceObjectId?: string
  businessObjectType?: string | null
}): Promise<{ sourceObjectId: string; chunkCount: number }> {
  const sourceObjectId =
    ctx.sourceObjectId ??
    (await createSourceObject({
      orgId: ctx.orgId,
      origin: "upload",
      mimeType: ctx.mimeType,
      bytes: ctx.buffer,
      linkedEntityType: "document",
      linkedEntityId: ctx.documentId,
      businessObjectType: ctx.businessObjectType ?? null,
      createdById: ctx.userId,
    }))

  try {
    // extract_status: PENDING (createSourceObject's own DB default) -> EXTRACTED,
    // now that rawText is real, non-empty extracted content.
    await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
      db
        .update(sourceObject)
        .set({ extractStatus: "EXTRACTED", charCount: ctx.rawText.length })
        .where(eq(sourceObject.id, sourceObjectId))
    )

    const policies = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
      db.select().from(chunkPolicy)
    )
    const policy = pickChunkPolicy(ctx.businessObjectType, policies)
    if (!policy) {
      throw new Error(
        `chunkAndEmbedSourceObject: no chunk_policy row for businessObjectType=${JSON.stringify(ctx.businessObjectType ?? null)} and no "generic" fallback policy exists either -- see compliance.chunk_policy`
      )
    }

    const chunks = chunkText(ctx.rawText, policy as ChunkPolicy)

    await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
      db.update(sourceObject).set({ extractStatus: "CHUNKED" }).where(eq(sourceObject.id, sourceObjectId))
    )

    for (const chunk of chunks) {
      await storeChunkEmbedding({ orgId: ctx.orgId, sourceObjectId, chunk })
    }

    await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
      db.update(sourceObject).set({ extractStatus: "EMBEDDED" }).where(eq(sourceObject.id, sourceObjectId))
    )

    return { sourceObjectId, chunkCount: chunks.length }
  } catch (err) {
    await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
      db
        .update(sourceObject)
        .set({ extractStatus: "FAILED", extractError: err instanceof Error ? err.message : String(err) })
        .where(eq(sourceObject.id, sourceObjectId))
    ).catch(() => {
      // Never let a failed status-write mask the real error being rethrown below.
    })
    throw err
  }
}

export async function extractDocumentContent(
  ctx: {
    orgId: string
    userId: string
    documentId: string
    fileBase64: string
    mimeType: string
    // CRR-079: both optional and unused by today's only real caller
    // (src/app/api/documents/route.ts) -- forward-compatible with CRR-084,
    // which will start passing a real sourceObjectId once the upload route
    // itself calls createSourceObject. See chunkAndEmbedSourceObject's own
    // header for what happens when these are omitted.
    sourceObjectId?: string
    businessObjectType?: string | null
  }
): Promise<void> {
  const startedAt = Date.now()
  const isVision = isVisionExtractable(ctx.mimeType)
  // "vision_document_extraction" routes through orchestra-model-resolver.ts's
  // SOURCE_TYPE_MODEL_OVERRIDES -- whatever text model the layer/org would
  // otherwise resolve to gets swapped for a confirmed vision-capable model
  // on the same (or fallback) provider, or null if neither has one
  // registered. Only requested for image uploads -- the text-extraction
  // path below (PDF/Word/PowerPoint/email) needs an ordinary text model,
  // exactly like every other resolveModelConfig call in this codebase that
  // doesn't pass a sourceType.
  const modelConfig = await resolveModelConfig(ctx.orgId, "customer_account_oa", isVision ? "vision_document_extraction" : undefined)

  if (!modelConfig) {
    recordOrchestraExecution({
      orgId: ctx.orgId, userId: ctx.userId, layerKey: "customer_account_oa", eventType: "document.extract_content",
      input: { documentId: ctx.documentId, mimeType: ctx.mimeType }, status: "failed", durationMs: Date.now() - startedAt,
      output: {
        error: isVision
          ? "No vision-capable model available for this org (either no model is configured at all, or the resolved provider has no registered vision override) -- document extraction skipped"
          : "No AI model configured for this org -- document extraction skipped",
      },
    })
    return
  }

  try {
    const systemPrompt = await resolvePromptTemplate("document.extract_content")
    let extracted: ExtractedDocumentData
    let usage: LLMUsage

    if (isVision) {
      const result = await callLLMVision(
        modelConfig.provider, modelConfig.model, modelConfig.apiKey,
        systemPrompt, ctx.fileBase64, ctx.mimeType,
        "Analyze this document and respond with the required JSON.",
        { jsonMode: true, temperature: 0.1, maxTokens: 1024 }
      )
      extracted = JSON.parse(result.content) as ExtractedDocumentData
      usage = result.usage
    } else {
      const buffer = Buffer.from(ctx.fileBase64, "base64")
      const rawText = await extractRawTextForMimeType(ctx.mimeType, buffer)

      // CRR-079 (P3-BRIDGE): the chunk+embed bridge -- see
      // chunkAndEmbedSourceObject's own header. Independent of, and never
      // allowed to fail, the compliance-field extraction below (a retrieval-
      // indexing failure must not turn an otherwise-successful extraction
      // into a failed orchestra_executions row -- see that function's own
      // failure handling, which already records source_object.extract_status
      // =FAILED/extract_error for this exact case).
      await chunkAndEmbedSourceObject({
        orgId: ctx.orgId, userId: ctx.userId, documentId: ctx.documentId, mimeType: ctx.mimeType,
        buffer, rawText, sourceObjectId: ctx.sourceObjectId, businessObjectType: ctx.businessObjectType,
      }).catch((err) => console.error("Chunk-and-embed bridge (CRR-079) failed:", err))

      const result = await callLLMJson<ExtractedDocumentData>(
        modelConfig.provider, modelConfig.model, modelConfig.apiKey,
        systemPrompt,
        `Extracted document content (the only source of truth for this analysis):\n\n${rawText.slice(0, MAX_EXTRACTED_CHARS)}`,
        { temperature: 0.1, maxTokens: 1024 },
        modelConfig.fallback
      )
      extracted = result.data
      usage = result.usage
    }

    await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
      db.update(documents).set({ extractedData: extracted }).where(eq(documents.id, ctx.documentId))
    )

    // Priority 13 (Document Correspondent/Type Auto-Classification): now
    // that extracted text actually exists, run the content-based matching
    // pass -- strictly additive (see applyClassificationWithDb), never
    // overrides the filename-only pass that already ran at upload time
    // (src/app/api/documents/route.ts) if that one already set something.
    // Failure here must never turn a successful extraction into a failed
    // orchestra_executions row -- caught and logged, not rethrown.
    const extractedText = [extracted.summary, extracted.documentType, ...(extracted.parties ?? [])].filter(Boolean).join(" ")
    await autoClassifyDocument({ orgId: ctx.orgId }, ctx.documentId, { extractedText }).catch((err) =>
      console.error("Document auto-classification (content pass) failed:", err)
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
