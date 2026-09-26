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
//
// PROJEXA-BUILD-001 U-36 and U-37 (PMD-03, register rows BR-505 to BR-508): the last section of this file turns an uploaded
// xlsx workbook into a project and its BOQ (extractProjectFromDocument, createProjectFromDocument). It lives here, not in a
// second service, because PMD-03 says to extend this one. It reads every sheet, sends a text digest to the Supabase Edge
// Function projexa-document-extract (the only place a model is called, E-13), validates what comes back against the schema in
// document-extraction-schema.ts, and only then calls the existing createProject() and createBoq(). Anything that fails
// validation ends in an ExtractionRejectedError with a stable code and creates nothing. Re-submitting the same file returns the
// first project (a per-organisation ledger row keyed by the file's sha256, see the ledger notes below).
//
// PROJEXA-BUILD-002 WP-02 (register rows AW-111 to AW-115) made that path fit a real bill workbook (the ZOOMIES file: 22 sheets, two
// areas, notes and payment terms in single long cells, lines with a quantity and no rate):
//   * the digest keeps line breaks and cells up to 2,000 characters (EXTRACTION_DIGEST_LIMITS); a workbook that does not fit one
//     request is sent in groups of sheets, never cut;
//   * the deterministic reader (src/lib/ingest/multisheet-bill-reader.ts) runs FIRST and its lines and printed totals go to the
//     model as candidates; the model adds only what the reader cannot, and refusals for a line that was dropped, added or changed;
//   * a line with a quantity and no rate is a question, never a zero-priced line; two areas are ONE BOQ;
//   * the sum of the lines must equal the totals the file prints, or nothing is created (unless the caller acknowledges a shortfall);
//   * the ledger row is the job record: received, reading, needs_answers, ready, created, rejected. A job that has questions waits in
//     needs_answers and is finished by a second submit of the same file, with no second model call.
// The pure decisions are in document-extraction-reconcile.ts. Nothing here calls a model directly: the Edge Function does.
import { createHash } from "node:crypto"
import { inflateRawSync } from "node:zlib"
import { createId } from "@paralleldrive/cuid2"
import { documents, sourceObject, chunkPolicy } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import { resolveModelConfig } from "@/lib/orchestra-model-resolver"
import { callLLMVision, callLLMJson, type LLMUsage } from "@/lib/llm-client"
import { resolvePromptTemplate } from "@/lib/prompt-os-resolver"
import { recordOrchestraExecution } from "@/lib/orchestra-execution-logger"
import { autoClassifyDocument } from "@/lib/services/document-classification-service"
import { extractDocxRawText, extractPptxRawText } from "@/lib/officecli-client"
import { createSourceObject } from "@/lib/crr/capture"
import { chunkText, type ChunkPolicy } from "@/lib/crr/chunker"
import { storeChunkEmbeddingsBatch } from "@/lib/crr/embed"
import { recordIngestError } from "@/lib/crr/ingest-error"
import {
  EDGE_REQUEST_MAX_CHARS,
  EXTRACTION_DIGEST_LIMITS,
  EXTRACTION_SCHEMA_NAME,
  ExtractionRejectedError,
  ProjectCreatedUnlinkedError,
  ProjectCreatedWithoutBoqError,
  WORKBOOK_LIMITS,
  cleanCellText,
  cleanCellTextKeepBreaks,
  validateExtractionOutput,
  type CutCell,
  type ExtractionErrorCode,
  type ExtractionQuestion,
  type ExtractedProject,
  type WorkbookDigest,
  type WorkbookLimits,
} from "@/lib/services/document-extraction-schema"
import {
  assertReconciliationAllowed,
  buildCandidates,
  candidatesForSheets,
  checkAgainstCandidates,
  checkProjectName,
  computeReconciliation,
  cutCellQuestions,
  mergeExtractions,
  mergeQuestions,
  splitUnpricedLines,
  type Candidates,
  type Reconciliation,
} from "@/lib/services/document-extraction-reconcile"
import type { BoqLineItemInput } from "@/lib/services/construction-boq-service"
import type { ProjectInput } from "@/lib/services/construction-dashboard-service"

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
// CRR-084: the live upload route (src/app/api/documents/route.ts) now calls
// createSourceObject itself, persists documents.source_object_id, and
// passes ctx.sourceObjectId through extractDocumentContent into here -- so
// the fallback branch below (creating a source_object on the fly when
// ctx.sourceObjectId is omitted) is no longer that route's own real path,
// but is kept: the CRR-090 catch-up worker always has a sourceObjectId (so
// never hits it either), and it stays as a safety net for any other/future
// caller with no source_object yet. createSourceObject's own sha256-dedup
// contract (CRR-078) means even a caller that DOES hit this fallback twice
// for identical bytes never double-captures a second source_object row.
//
// Every failure here is caught by the caller (extractDocumentContent) and
// recorded on source_object.extract_status=FAILED / extract_error -- a
// retrieval-indexing failure must never turn an otherwise-successful
// compliance-field extraction (extractedData, already written by the time
// this runs) into a failed orchestra_executions row.
//
// CRR-081/CRR-082: chunk embedding goes through storeChunkEmbeddingsBatch
// (batched provider calls, resumable via a (source_object_id, seq)
// pre-check) instead of a plain per-chunk loop -- see that function's own
// header in embed.ts. CRR-082's own resumability contract requires a
// specific failure-status split, implemented by the two separate try/catch
// blocks below rather than one that wraps the whole function:
//   - A failure BEFORE chunking completes (policy lookup, chunkText itself)
//     has produced nothing resumable -- extract_status regresses to FAILED,
//     same as before this pass.
//   - A failure DURING/AFTER embedding (a batch's provider call throws, a
//     D-1 refusal) must NOT regress extract_status past CHUNKED -- it is
//     left exactly where the first try block already set it, so a retry of
//     this same function calls storeChunkEmbeddingsBatch again, and its own
//     pre-check skips every chunk a prior attempt already wrote (CRR-082's
//     own gate_pass: "kill the process after 50 of 120 chunks, re-run,
//     assert final count is 120 and provider was called 70 times not 170").
// CRR-083: every failure branch below writes a real compliance.
// crr_ingest_error row (via recordIngestError) instead of only a
// console.error line, before rethrowing/leaving the caller to handle it.
// Exported solely for direct integration testing (CRR-079's own gate_pass:
// "Integration test: upload a 20-page PDF, assert document_chunk count > 10
// and every row has is_real=true") and for CRR-084's future reuse when the
// upload route starts calling this directly with a real sourceObjectId --
// not meant to be a public entry point other services should call for
// day-to-day extraction (call extractDocumentContent for that).
export async function chunkAndEmbedSourceObject(ctx: {
  orgId: string
  // Optional (CRR-090): the catch-up worker drives an already-captured
  // source_object forward with no real user session behind it -- neither
  // source_object nor document_chunk's RLS policies check
  // compliance.current_user_id() (org_id-only -- confirmed against the live
  // policies before widening this), and withTenantContext itself already
  // treats a falsy userId as "don't set that GUC" (tenant-scoped.ts:
  // `if (context.userId)`), so omitting it here is a real no-op, not a
  // silently-degraded write.
  userId?: string
  // Optional (CRR-090): only read when sourceObjectId is NOT already
  // provided (the createSourceObject fallback branch's own
  // linkedEntityId) -- the catch-up worker always already has a
  // sourceObjectId (it read the row from compliance.source_object itself),
  // so it never needs to supply this.
  documentId?: string
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

  let chunks: ReturnType<typeof chunkText>

  // Phase 1: extract-recorded -> chunked. A failure anywhere in this phase
  // has produced nothing resumable yet, so it regresses extract_status to
  // FAILED (unchanged behavior from before CRR-081/082/083, plus a real
  // crr_ingest_error row per CRR-083).
  try {
    // extract_status: PENDING (createSourceObject's own DB default) -> EXTRACTED,
    // now that rawText is real, non-empty extracted content.
    await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
      db
        .update(sourceObject)
        .set({ extractStatus: "EXTRACTED", charCount: ctx.rawText.length })
        .where(eq(sourceObject.id, sourceObjectId))
    )

    // CRR-087: exact businessObjectType match against compliance.chunk_policy,
    // falling back to the always-present 'generic' row -- see
    // pickChunkPolicy's own header. Chunk-size numbers are never hard-coded
    // here; they always come from whichever policy row this resolves to.
    const policies = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
      db.select().from(chunkPolicy)
    )
    const policy = pickChunkPolicy(ctx.businessObjectType, policies)
    if (!policy) {
      throw new Error(
        `chunkAndEmbedSourceObject: no chunk_policy row for businessObjectType=${JSON.stringify(ctx.businessObjectType ?? null)} and no "generic" fallback policy exists either -- see compliance.chunk_policy`
      )
    }

    chunks = chunkText(ctx.rawText, policy as ChunkPolicy)

    await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
      db.update(sourceObject).set({ extractStatus: "CHUNKED" }).where(eq(sourceObject.id, sourceObjectId))
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await recordIngestError({ orgId: ctx.orgId, sourceObjectId, stage: "chunk", message })
    await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
      db.update(sourceObject).set({ extractStatus: "FAILED", extractError: message }).where(eq(sourceObject.id, sourceObjectId))
    ).catch(() => {
      // Never let a failed status-write mask the real error being rethrown below.
    })
    throw err
  }

  // Phase 2: chunked -> embedded. extract_status is already CHUNKED at this
  // point -- a failure here (see this function's own header) deliberately
  // does NOT write extract_status at all, leaving it at CHUNKED so a retry
  // resumes via storeChunkEmbeddingsBatch's own (source_object_id, seq)
  // pre-check (CRR-082) instead of restarting from PENDING.
  try {
    await storeChunkEmbeddingsBatch({ orgId: ctx.orgId, sourceObjectId, chunks })

    await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
      db.update(sourceObject).set({ extractStatus: "EMBEDDED" }).where(eq(sourceObject.id, sourceObjectId))
    )

    return { sourceObjectId, chunkCount: chunks.length }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await recordIngestError({ orgId: ctx.orgId, sourceObjectId, stage: "embed", message })
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
    // CRR-084: src/app/api/documents/route.ts (today's only real caller)
    // now calls createSourceObject itself and passes the real id through
    // here -- still optional on this type because the CRR-090 catch-up
    // worker's own re-drive path calls chunkAndEmbedSourceObject directly
    // (not through this function), and any other future caller with no
    // source_object yet can still omit it and let chunkAndEmbedSourceObject
    // create one on the fly (see that function's own header).
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
      //
      // CRR-083: no console.error here -- chunkAndEmbedSourceObject's own
      // catch blocks already write a real compliance.crr_ingest_error row
      // (stage="chunk"|"embed") with the real message before rethrowing, so
      // logging it again here would only be a second, less durable copy of
      // the same information.
      await chunkAndEmbedSourceObject({
        orgId: ctx.orgId, userId: ctx.userId, documentId: ctx.documentId, mimeType: ctx.mimeType,
        buffer, rawText, sourceObjectId: ctx.sourceObjectId, businessObjectType: ctx.businessObjectType,
      }).catch(() => {})

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

// ============================================================================================================================
// PROJEXA-BUILD-001 U-36 / U-37 (PMD-03): create a project and its BOQ from an uploaded xlsx workbook.
//
// The order is fixed and every step before the last two creates nothing:
//   1. claim the file in the ledger (a second submit of the same bytes stops here and returns the first project);
//   2. read EVERY sheet into a digest (no model, no network);
//   3. post the digest to the Edge Function projexa-document-extract, which makes the model call;
//   4. validate the returned JSON against the target schema, and the BOQ lines against createBoq()'s own rules;
//   5. createProject(), record the project against the claim, createBoq().
// A failure in steps 2 to 4 releases the claim and ends in an ExtractionRejectedError. The document is data, never instructions:
// it reaches the model only inside the digest JSON (see the Edge Function's handler.ts), and the model's answer is checked in step
// 4 before it can cause a write, so a document that talks the model into a different answer ends at step 4.
// ============================================================================================================================

const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

/** One cell as digest text. Numbers keep 15 significant digits (so 0.1 + 0.2 reads 0.3), dates read YYYY-MM-DD. */
function digestCellText(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "number") return Number.isFinite(value) ? String(Number(value.toPrecision(15))) : ""
  if (typeof value === "boolean") return value ? "true" : "false"
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return ""
    const iso = value.toISOString()
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso
  }
  return cleanCellText(String(value))
}

/** The row-preserving form of digestCellText(): a text cell keeps its line breaks; `chars` is its length before any cut. */
function digestCellTextKeepBreaks(value: unknown, maxChars: number): { text: string; chars: number } {
  if (typeof value === "string") return cleanCellTextKeepBreaks(value, maxChars)
  const text = digestCellText(value)
  return { text, chars: text.length }
}

/**
 * The checks that need no parser: the size, and that the bytes start like a zip archive ("PK"), which an xlsx file is. Older .xls
 * files and anything else are refused here, before a parser sees them and before createProjectFromDocument() claims the file.
 */
export function assertWorkbookBytes(bytes: Uint8Array, limits: WorkbookLimits = WORKBOOK_LIMITS): void {
  if (bytes.byteLength > limits.maxBytes) {
    throw new ExtractionRejectedError("workbook_too_large", `The file is larger than ${Math.round(limits.maxBytes / (1024 * 1024))} MB`)
  }
  if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new ExtractionRejectedError("unsupported_file_type", "Only .xlsx workbooks are read")
  }
}

const ZIP_END_OF_CENTRAL_DIRECTORY = Buffer.from([0x50, 0x4b, 0x05, 0x06])
const ZIP_CENTRAL_ENTRY_SIGNATURE = 0x02014b50
const ZIP_LOCAL_ENTRY_SIGNATURE = 0x04034b50

/**
 * Refuses a workbook whose parts would unpack to more than limits.maxUncompressedBytes, before the workbook parser sees it. The parts
 * of an xlsx file are deflate streams and the parser inflates each one whole, so the size of the file says little about the memory
 * a read takes. The sizes the archive declares are not used: an archive can declare small sizes and inflate to gigabytes, and the
 * parser does not compare what it inflated with what was declared. Each part is inflated here with an output ceiling instead, from
 * the same place the parser starts (the local header of each entry the central directory lists), and the outputs are added up, so
 * two entries that share one stream count twice, as they do when the parser reads them. Refusals: workbook_too_large over the
 * ceiling, workbook_unreadable for anything that is not a well-formed zip archive or whose stream does not inflate.
 */
export function assertWorkbookArchiveWithinLimits(bytes: Uint8Array, limits: WorkbookLimits = WORKBOOK_LIMITS): void {
  const tooLarge = () =>
    new ExtractionRejectedError("workbook_too_large", `The workbook holds more than ${Math.round(limits.maxUncompressedBytes / (1024 * 1024))} MB once unpacked`)
  const unreadable = () => new ExtractionRejectedError("workbook_unreadable", "The file could not be read as an xlsx workbook")
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  try {
    // The last end-of-central-directory signature, and its entry count of this disk (offset 8), which are the ones the parser uses.
    const end = buf.lastIndexOf(ZIP_END_OF_CENTRAL_DIRECTORY)
    if (end < 0) throw unreadable()
    const entryCount = buf.readUInt16LE(end + 8)
    let entryAt = buf.readUInt32LE(end + 16)
    let unpacked = 0
    for (let i = 0; i < entryCount; i++) {
      if (buf.readUInt32LE(entryAt) !== ZIP_CENTRAL_ENTRY_SIGNATURE) throw unreadable()
      const centralSize = buf.readUInt32LE(entryAt + 20)
      const localAt = buf.readUInt32LE(entryAt + 42)
      entryAt += 46 + buf.readUInt16LE(entryAt + 28) + buf.readUInt16LE(entryAt + 30) + buf.readUInt16LE(entryAt + 32)
      if (buf.readUInt32LE(localAt) !== ZIP_LOCAL_ENTRY_SIGNATURE) throw unreadable()
      const method = buf.readUInt16LE(localAt + 8)
      const dataAt = localAt + 30 + buf.readUInt16LE(localAt + 26) + buf.readUInt16LE(localAt + 28)
      if (method === 0) {
        // Stored, not deflated: the parser copies as many bytes as the entry says it holds.
        unpacked += Math.min(Math.max(centralSize, buf.readUInt32LE(localAt + 18)), Math.max(buf.length - dataAt, 0))
      } else if (method === 8) {
        try {
          unpacked += inflateRawSync(buf.subarray(dataAt), { maxOutputLength: Math.max(limits.maxUncompressedBytes - unpacked, 1) }).length
        } catch (err) {
          if ((err as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") throw tooLarge()
          throw unreadable()
        }
      } else {
        throw unreadable()
      }
      if (unpacked > limits.maxUncompressedBytes) throw tooLarge()
    }
  } catch (err) {
    if (err instanceof ExtractionRejectedError) throw err
    throw unreadable()
  }
}

export type DigestOptions = { keepLineBreaks?: boolean }

/**
 * Reads every worksheet of an xlsx file, hidden ones included, into a digest: the rows that hold something, each with its real
 * 1-based worksheet row number, every cell as cleaned text. Formulas are not evaluated (the value Excel last stored is read).
 * A file over a limit is refused (workbook_too_large), never cut short: a BOQ built from half a workbook would look complete.
 * The limits that bound the work of the read itself are checked before the work is done: the unpacked size (before the parser
 * runs) and, from each sheet's declared range, the columns and the cells (before any sheet is turned into rows).
 *
 * `options.keepLineBreaks` (BUILD-002 WP-02, AW-111) reads the way the model route needs: a line break inside a cell stays a line break
 * (a merged cell of a PDF-table export holds several table lines) and a cell longer than limits.maxCellChars is cut AND listed in
 * the digest's `cutCells`. Without it the digest is the one every earlier caller was written against: one space for any run of
 * whitespace, cut without a note. The model route passes EXTRACTION_DIGEST_LIMITS (2,000-character cells) with it.
 */
export async function readWorkbookDigest(
  bytes: Uint8Array,
  limits: WorkbookLimits = WORKBOOK_LIMITS,
  options: DigestOptions = {},
): Promise<WorkbookDigest> {
  assertWorkbookBytes(bytes, limits)
  assertWorkbookArchiveWithinLimits(bytes, limits)
  const mod = await import("xlsx")
  const XLSX = (mod.default ?? mod) as typeof import("xlsx")
  let workbook: import("xlsx").WorkBook
  try {
    workbook = XLSX.read(Buffer.from(bytes), {
      type: "buffer",
      cellDates: true,
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      sheetStubs: false,
      bookVBA: false,
      // Reads that many rows and sets !fullref when the sheet has more, so a sheet of maxRowsPerSheet + 1 rows is the first refused.
      sheetRows: limits.maxRowsPerSheet,
    })
  } catch {
    throw new ExtractionRejectedError("workbook_unreadable", "The file could not be read as an xlsx workbook")
  }
  const names = workbook.SheetNames
  if (names.length === 0) throw new ExtractionRejectedError("workbook_empty", "The workbook has no sheets")
  if (names.length > limits.maxSheets) {
    throw new ExtractionRejectedError("workbook_too_large", `The workbook has more than ${limits.maxSheets} sheets`)
  }
  const nameOf = (rawName: string, index: number) => cleanCellText(rawName, 120) || `Sheet ${index + 1}`

  // First pass, from what each sheet declares (its range), before any of it is built: sheet_to_json() below fills every cell of
  // the range (defval), so a range of A1:XFD5000 would cost 82 million cells even when only two of them hold anything.
  let declaredCells = 0
  names.forEach((rawName, index) => {
    const sheet = workbook.Sheets[rawName]
    if (!sheet || !sheet["!ref"]) return
    const name = nameOf(rawName, index)
    // SheetJS sets !fullref when sheetRows cut the sheet short.
    if ((sheet as Record<string, unknown>)["!fullref"] !== undefined) {
      throw new ExtractionRejectedError("workbook_too_large", `Sheet "${name}" has more than ${limits.maxRowsPerSheet} rows`)
    }
    const range = XLSX.utils.decode_range(sheet["!ref"])
    const columns = range.e.c - range.s.c + 1
    if (columns > limits.maxColumns) {
      throw new ExtractionRejectedError("workbook_too_large", `Sheet "${name}" has more than ${limits.maxColumns} columns`)
    }
    declaredCells += columns * (range.e.r - range.s.r + 1)
    if (declaredCells > limits.maxCells) {
      throw new ExtractionRejectedError("workbook_too_large", `The workbook's sheets declare more than ${limits.maxCells} cells in all`)
    }
  })

  const sheets: WorkbookDigest["sheets"] = []
  const cutCells: CutCell[] = []
  names.forEach((rawName, index) => {
    const name = nameOf(rawName, index)
    const sheet = workbook.Sheets[rawName]
    const rows: WorkbookDigest["sheets"][number]["rows"] = []
    if (sheet && sheet["!ref"]) {
      const firstRow = XLSX.utils.decode_range(sheet["!ref"]).s.r
      const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "", blankrows: true })
      grid.forEach((cells, i) => {
        const row = firstRow + i + 1
        const texts = cells.map((c, columnIndex) => {
          if (!options.keepLineBreaks) return digestCellText(c).slice(0, limits.maxCellChars)
          const kept = digestCellTextKeepBreaks(c, limits.maxCellChars)
          if (kept.chars > limits.maxCellChars) cutCells.push({ sheet: name, row, column: columnIndex + 1, chars: kept.chars })
          return kept.text
        })
        while (texts.length > 0 && texts[texts.length - 1] === "") texts.pop()
        if (texts.length > 0) rows.push({ row, cells: texts })
      })
    }
    sheets.push({ name, rows })
  })
  if (!sheets.some((s) => s.rows.length > 0)) throw new ExtractionRejectedError("workbook_empty", "The workbook has no cells with content")
  return cutCells.length > 0 ? { sheets, cutCells } : { sheets }
}

/** The JSON body posted to the Edge Function. Over the request ceiling is workbook_too_large: the same number the function enforces. */
export function buildEdgeRequestBody(fileName: string, digest: WorkbookDigest): string {
  const body = JSON.stringify({ schema: EXTRACTION_SCHEMA_NAME, fileName: cleanCellText(fileName, 200), sheets: digest.sheets })
  if (body.length > EDGE_REQUEST_MAX_CHARS) {
    throw new ExtractionRejectedError("workbook_too_large", `The workbook holds more text than one extraction reads (${EDGE_REQUEST_MAX_CHARS} characters)`)
  }
  return body
}

/** Most requests one workbook may be split into. Each is one model call, so this bounds what a single upload can cost. */
export const MAX_EDGE_REQUESTS = 8

export type EdgeRequest = {
  body: string
  /** The sheets this request carries, in workbook order. */
  sheets: string[]
  /** The candidates that belong to those sheets; null when the reader did not apply. */
  candidates: Candidates | null
}

/** What the model is shown of the reader's reading: its lines, questions and printed totals. The reader's own verdict stays here. */
function candidatePayload(c: Candidates) {
  return { projectName: c.projectName, areas: c.areas, lines: c.lines, questions: c.questions, totals: c.totals }
}

/**
 * The requests for one workbook (BUILD-002 WP-02, AW-111). One request when the whole digest fits under `maxChars` (default the Edge
 * ceiling EDGE_REQUEST_MAX_CHARS, 200,000): the ZOOMIES file is about 27,000 characters and 60,000 with the reader's candidates.
 * Otherwise the sheets are split, in order, into the fewest groups that each fit; every sheet goes into exactly one group, and
 * nothing is cut. A single sheet that does not fit alone, or a workbook that needs more than MAX_EDGE_REQUESTS groups, is refused
 * (workbook_too_large), never shortened: a BOQ built from part of a workbook would look complete.
 * Each request carries the candidates of its own sheets and the whole workbook's printed totals.
 */
export function buildEdgeRequestBodies(
  fileName: string,
  digest: WorkbookDigest,
  candidates: Candidates | null,
  maxChars: number = EDGE_REQUEST_MAX_CHARS,
): EdgeRequest[] {
  const cleanName = cleanCellText(fileName, 200)
  const bodyFor = (group: WorkbookDigest["sheets"], part: { index: number; of: number } | null): EdgeRequest => {
    const names = new Set(group.map((s) => s.name))
    const forGroup = candidates ? candidatesForSheets(candidates, names) : null
    const body = JSON.stringify({
      schema: EXTRACTION_SCHEMA_NAME,
      fileName: cleanName,
      sheets: group,
      ...(forGroup ? { candidates: candidatePayload(forGroup) } : {}),
      ...(part ? { part } : {}),
    })
    return { body, sheets: group.map((s) => s.name), candidates: forGroup }
  }
  const whole = bodyFor(digest.sheets, null)
  if (whole.body.length <= maxChars) return [whole]

  // Placeholder part numbers have the width of the final ones (MAX_EDGE_REQUESTS is one digit), so a group that fits here fits later.
  const probe = { index: 1, of: MAX_EDGE_REQUESTS }
  const groups: WorkbookDigest["sheets"][] = []
  let current: WorkbookDigest["sheets"] = []
  for (const sheet of digest.sheets) {
    const alone = bodyFor([sheet], probe).body.length
    if (alone > maxChars) {
      throw new ExtractionRejectedError("workbook_too_large", `Sheet "${sheet.name}" alone holds more text than one extraction reads (${maxChars} characters)`)
    }
    if (current.length > 0 && bodyFor([...current, sheet], probe).body.length > maxChars) {
      groups.push(current)
      current = []
    }
    current.push(sheet)
  }
  if (current.length > 0) groups.push(current)
  if (groups.length > MAX_EDGE_REQUESTS) {
    throw new ExtractionRejectedError("workbook_too_large", `The workbook needs ${groups.length} requests and one extraction sends at most ${MAX_EDGE_REQUESTS}`)
  }
  return groups.map((g, i) => bodyFor(g, { index: i + 1, of: groups.length }))
}

export type EdgeCallResult = { status: number; body: unknown }
/**
 * Who a request is for (BUILD-002 WP-02). The Edge Function meters every model call against an organisation and a user and answers
 * 400 attribution_required to a request that names neither, so a caller that reaches a wired model must send them: the
 * organisation, the acting person and, for the ledger row, the job (the claim id, with a suffix per part of a split workbook).
 */
export type EdgeAttribution = { orgId: string; userId: string; requestId?: string }
/** Posts the JSON body to the extraction Edge Function and returns its status and parsed body. It never throws. */
export type EdgeCaller = (bodyJson: string, attribution?: EdgeAttribution) => Promise<EdgeCallResult>

const EDGE_EXTRACT_PATH = "/functions/v1/projexa-document-extract"

/**
 * The real caller, wired only in the route from the server's environment: baseUrl is the Supabase project URL, secret the shared
 * bearer secret (PROJEXA_DOCUMENT_EXTRACT_SECRET). With either missing it answers as the not-configured case, so an environment
 * without the function set up refuses cleanly instead of failing on a bad URL.
 */
export function createEdgeExtractCaller(config: { baseUrl?: string | null; secret?: string | null; fetchImpl?: typeof fetch; timeoutMs?: number }): EdgeCaller {
  return async (bodyJson, attribution) => {
    const baseUrl = config.baseUrl?.trim()
    const secret = config.secret?.trim()
    if (!baseUrl || !secret) return { status: 503, body: { ok: false, code: "extraction_not_configured" } }
    const doFetch = config.fetchImpl ?? fetch
    try {
      const res = await doFetch(`${baseUrl.replace(/\/+$/, "")}${EDGE_EXTRACT_PATH}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secret}`,
          ...(attribution
            ? {
                "x-projexa-org-id": attribution.orgId,
                "x-projexa-user-id": attribution.userId,
                ...(attribution.requestId ? { "x-projexa-request-id": attribution.requestId } : {}),
              }
            : {}),
        },
        body: bodyJson,
        cache: "no-store",
        signal: AbortSignal.timeout(config.timeoutMs ?? 110_000),
      })
      let body: unknown = null
      try {
        body = await res.json()
      } catch {
        body = null
      }
      return { status: res.status, body }
    } catch {
      return { status: 502, body: { ok: false, code: "edge_unreachable" } }
    }
  }
}

function edgeCode(body: unknown): string {
  return typeof body === "object" && body !== null && typeof (body as { code?: unknown }).code === "string" ? (body as { code: string }).code : ""
}

/** The model's JSON from the Edge Function's answer, or the ExtractionRejectedError that answer stands for. */
function readEdgeOutput(res: EdgeCallResult): unknown {
  const body = res.body
  if (res.status === 200 && typeof body === "object" && body !== null && (body as { ok?: unknown }).ok === true && "output" in body) {
    return (body as { output: unknown }).output
  }
  const code = edgeCode(body)
  if (res.status === 503 && code === "model_not_configured") {
    throw new ExtractionRejectedError("model_not_configured", "No extraction model is configured yet, so nothing was created")
  }
  if (res.status === 503 && code === "extraction_not_configured") {
    throw new ExtractionRejectedError("extraction_not_configured", "Extraction is not set up in this environment, so nothing was created")
  }
  if (res.status === 413) throw new ExtractionRejectedError("workbook_too_large", "The workbook holds more text than one extraction reads")
  if (res.status === 502 && code === "model_output_not_json") {
    throw new ExtractionRejectedError("extraction_schema_invalid", "The extraction output is not JSON, so nothing was created", ["(root): the model reply was not a JSON value"])
  }
  if (res.status === 502 && code === "model_output_too_large") {
    throw new ExtractionRejectedError("extraction_output_too_large", "The extraction output is over the size ceiling, so nothing was created")
  }
  throw new ExtractionRejectedError("extraction_unavailable", "The extraction service could not be reached or refused the call, so nothing was created")
}

/** The validated extraction as createBoq() input lines (the source citations are for validation and review, not stored). */
export function toBoqLineItems(extracted: ExtractedProject): BoqLineItemInput[] {
  return extracted.boq.lineItems.map((l) => ({
    itemCode: l.itemCode,
    parentItemCode: l.parentItemCode,
    breakdownPercentage: l.breakdownPercentage,
    description: l.description,
    unit: l.unit,
    quantity: l.quantity ?? 0,
    rate: l.rate ?? 0,
    category: l.category,
  }))
}

/**
 * createBoq()'s own input rules, run before anything is created: the same validateLineItemInputs() and the same parent/child
 * derivation createBoq() runs inside its transaction. A BOQ that would be refused there is refused here, before createProject().
 * (Imported lazily so this file's importers do not load the BOQ service's module graph.)
 */
async function assertBoqAcceptable(extracted: ExtractedProject): Promise<void> {
  const boq = await import("@/lib/services/construction-boq-service")
  const items = toBoqLineItems(extracted)
  try {
    boq.validateLineItemInputs(items)
    const byItemCode = new Map(items.filter((i) => i.itemCode).map((i) => [i.itemCode!, i]))
    for (const item of items) boq.deriveLineItemQuantityAndRate(item, byItemCode)
  } catch (err) {
    if (err instanceof boq.ServiceError) {
      throw new ExtractionRejectedError("extraction_boq_invalid", "The extracted BOQ lines are not acceptable, so nothing was created", [err.message])
    }
    throw err
  }
}

export type ExtractionResult = {
  /** The project and the BOQ lines that will be created. A line with a quantity and no rate is not among them: it is a question. */
  extracted: ExtractedProject
  stats: { sheets: number; rows: number; lines: number }
  /** Everything a person still has to settle, once each. Nothing is created for it and nothing is guessed. */
  questions: ExtractionQuestion[]
  /** The lines held to the totals the file prints (assertReconciliationAllowed() has already passed for this result). */
  reconciliation: Reconciliation
  /** "model+reader" when the deterministic reader's candidates were sent to the model and checked; "model" when the reader did not apply. */
  source: "model" | "model+reader"
}

export type ExtractOptions = {
  /** The caller has seen that the lines add up to less than the file prints and wants the BOQ as it is. Never covers an excess. */
  acknowledgeShortfall?: boolean
  /** Characters one request may hold (default EDGE_REQUEST_MAX_CHARS). A workbook over it is sent in groups of sheets. For tests and tuning. */
  requestCeilingChars?: number
}

/**
 * The steps after the model's answer, shared by a fresh extraction and by the finishing of a parked job: unpriced lines become
 * questions, the questions of every source are merged, the lines are held to the printed totals, and createBoq()'s own rules are
 * run. Creates nothing. Throws ExtractionRejectedError.
 */
async function finishExtraction(
  answer: ExtractedProject,
  digest: WorkbookDigest,
  candidates: Candidates | null,
  options: ExtractOptions,
): Promise<ExtractionResult> {
  const split = splitUnpricedLines(answer)
  if (split.extracted.boq.lineItems.length === 0) {
    throw new ExtractionRejectedError(
      "extraction_boq_invalid",
      "No line of the workbook has both a quantity and a rate, so there is nothing to create",
      split.questions.slice(0, 5).map((q) => q.text),
    )
  }
  const questions = mergeQuestions(candidates?.questions ?? [], answer.questions ?? [], split.questions, cutCellQuestions(digest, EXTRACTION_DIGEST_LIMITS.maxCellChars))
  const extracted: ExtractedProject = { ...split.extracted, ...(questions.length > 0 ? { questions } : {}) }
  const reconciliation = computeReconciliation(extracted, candidates)
  assertReconciliationAllowed(reconciliation, options)
  await assertBoqAcceptable(extracted)
  return {
    extracted,
    stats: { sheets: digest.sheets.length, rows: digest.sheets.reduce((n, s) => n + s.rows.length, 0), lines: extracted.boq.lineItems.length },
    questions,
    reconciliation,
    source: candidates ? "model+reader" : "model",
  }
}

/**
 * Register row BR-505's entry point. Reads every sheet of the workbook, asks the Edge Function for a project and BOQ, validates the
 * answer, and returns it. It creates nothing and writes nothing: whoever calls it decides what to do with a validated result.
 * Throws ExtractionRejectedError (stable `code`) for every refusal.
 *
 * BUILD-002 WP-02 (AW-111 to AW-114). The workbook is read with its line breaks and 2,000-character cells. When the file prints
 * totals the deterministic reader can check itself against, the reader's lines and totals go to the model as candidates and the
 * model's lines must be exactly those (a dropped, added or changed line is extraction_lines_diverge). A workbook too big for one
 * request goes in groups of sheets (buildEdgeRequestBodies). The lines that would be created are then held to the printed totals
 * (extraction_total_mismatch unless options.acknowledgeShortfall covers a shortfall) and the unpriced lines are returned as
 * questions.
 */
export async function extractProjectFromDocument(
  input: { fileName: string; bytes: Uint8Array; attribution?: EdgeAttribution },
  deps: { callEdge: EdgeCaller },
  options: ExtractOptions = {},
): Promise<ExtractionResult> {
  const digest = await readWorkbookDigest(input.bytes, EXTRACTION_DIGEST_LIMITS, { keepLineBreaks: true })
  const candidates = buildCandidates(digest)
  const requests = buildEdgeRequestBodies(input.fileName, digest, candidates, options.requestCeilingChars)
  const parts: ExtractedProject[] = []
  for (const [index, request] of requests.entries()) {
    // One ledger row per call: a split workbook gives each part its own request id.
    const attribution = input.attribution
      ? { ...input.attribution, ...(input.attribution.requestId && requests.length > 1 ? { requestId: `${input.attribution.requestId}-p${index + 1}` } : {}) }
      : undefined
    const answer = validateExtractionOutput(readEdgeOutput(await deps.callEdge(request.body, attribution)), digest, { minLines: requests.length > 1 ? 0 : 1 })
    if (request.candidates) {
      const problems = checkAgainstCandidates(answer, request.candidates)
      if (problems.length > 0) {
        throw new ExtractionRejectedError("extraction_lines_diverge", "The extraction's lines are not the lines the file's own reading found, so nothing was created", problems)
      }
    }
    parts.push(answer)
  }
  const whole = parts.length === 1 ? parts[0] : validateExtractionOutput(mergeExtractions(parts), digest)
  if (candidates) {
    const problems = checkProjectName(whole, candidates)
    if (problems.length > 0) {
      throw new ExtractionRejectedError("extraction_lines_diverge", "The extraction names the project differently from the file, so nothing was created", problems)
    }
  }
  return finishExtraction(whole, digest, candidates, options)
}

/** What a parked job keeps (ledger job_result): enough to finish it without a second model call. */
export type StoredExtraction = {
  v: 1
  extracted: ExtractedProject
  questions: ExtractionQuestion[]
  reconciliation: Reconciliation
  stats: ExtractionResult["stats"]
  source: ExtractionResult["source"]
  /** The person acknowledged a shortfall when the job was parked, so finishing it does not ask again. */
  acknowledgedShortfall?: boolean
}

function storedExtraction(result: ExtractionResult): StoredExtraction {
  return { v: 1, extracted: result.extracted, questions: result.questions, reconciliation: result.reconciliation, stats: result.stats, source: result.source }
}

/**
 * Finishes a parked job from what it stored, reading the same file again (no model call). The stored answer is validated again
 * against the file (shape, rows, areas), so a stored value that is out of date or was altered is not trusted: null then, and the
 * caller extracts afresh.
 */
async function resumeExtraction(stored: unknown, bytes: Uint8Array, options: ExtractOptions): Promise<ExtractionResult | null> {
  if (typeof stored !== "object" || stored === null || (stored as { v?: unknown }).v !== 1) return null
  const digest = await readWorkbookDigest(bytes, EXTRACTION_DIGEST_LIMITS, { keepLineBreaks: true })
  let answer: ExtractedProject
  try {
    answer = validateExtractionOutput((stored as { extracted?: unknown }).extracted, digest)
  } catch {
    return null
  }
  return finishExtraction(answer, digest, buildCandidates(digest), options)
}

// ------------------------------------------------------------------------------------------------------------- the ledger
//
// Idempotency without a new table: compliance.source_object already holds one row per captured file with its sha256, and
// its partial unique index (org_id, sha256) WHERE deleted_at IS NULL makes "one live row per organisation and key" a fact the
// database enforces, which is what makes a double submit safe. A ledger row is a source_object row that
//   * has origin_ref 'projexa-from-document:v1' and no storage_path (the bytes are not kept),
//   * carries the real file hash in content_sha256 and, in sha256, a key derived from it under that prefix, so it can never collide
//     with a real capture of the same bytes (compliance.documents uploads use the bare hash),
//   * has extract_status SKIPPED_UNSUPPORTED, which the catch-up worker never picks up (it takes PENDING, EXTRACTED, CHUNKED),
//   * is linked to the project through linked_entity_type 'project' and linked_entity_id.
// Life of a row: claim (insert; linked_entity_id null) -> attach (linked_entity_id = the new project id) or release (deleted_at set,
// which frees the unique index). A claim that is never attached or released (a process that died) is taken over after
// LEDGER_CLAIM_TTL_SECONDS. If a typed column on projects is preferred later, only this section changes.
//
// The same row is the JOB RECORD (BUILD-002 WP-02, migration 0646: job_state and job_result). The state is one of
//   received       the file was accepted and claimed (the insert sets it);
//   reading        the workbook is being read and the extraction is running;
//   needs_answers  the extraction is finished and has questions; nothing is created. The result is kept in job_result;
//   ready          the extraction is finished, has no open question and was asked only to prepare; nothing is created yet;
//   created        the project and the BOQ exist (linked_entity_id is the project);
//   rejected       the file was refused with a stable code (job_result holds it). A rejected row is released (deleted_at set) so
//                  the same file can be sent again, and it stays in the table so the state can still be read.
// needs_answers and ready are PARKED: the claim is kept (for LEDGER_PARKED_TTL_SECONDS, not the 15 minutes of a running job) and the
// next submit of the same file finishes the job from job_result, with no second model call (a `resume` claim). A row with no
// job_state is one written before 0646; it reads as created when it has a project and as received otherwise. Finishing a parked job
// first TAKES it (takeParked: one update that moves it to reading and answers true to one caller only), so two submits that both saw
// it parked cannot both create; a job that fails its gate again on the way is put back as it was.
//
// The same rows are the per-organisation rate limit. Every new claim is one extraction attempt and so one possible model call, and a
// released or taken-over claim stays in the table (soft-deleted), so counting the rows an organisation created inside the window
// counts its attempts, failed ones included. The exception is a claim released with modelCalled false: the refusal came before any
// model call (a workbook that is unreadable, empty or over a limit, or extraction or the model not configured), nothing was billed,
// and the row is marked extract_error 'no_model_call' so the count leaves it out. Without that, an environment with no model
// configured would answer 429 instead of the true 503 after 30 uploads, for up to an hour. A refusal that does not say the model was
// not reached (an invalid answer, an unavailable function) still counts. A second submit of a file that already has a project
// (duplicate), is being processed (in_progress) or is parked (resume) inserts nothing, costs no model call and is never counted or
// refused. The count is read before the insert and a refused attempt inserts nothing, so refusals do not lengthen the wait. Two
// attempts in flight together can each read a count that leaves out the other, so the limit can be passed by the number of concurrent
// requests. It is a spend bound, not a security boundary.

const LEDGER_ORIGIN_REF = "projexa-from-document:v1"
/** Stored in extract_error of a claim that was released before any model call; the rate limit does not count such a claim. */
export const LEDGER_NO_MODEL_CALL_MARK = "no_model_call"
export const LEDGER_CLAIM_TTL_SECONDS = 15 * 60
/** How long a job that waits for a person (needs_answers, ready) keeps its claim. A person answers in days, not minutes. */
export const LEDGER_PARKED_TTL_SECONDS = 7 * 24 * 60 * 60
/** Extraction attempts one organisation may start inside the window (a person seldom needs more than a few workbooks an hour). */
export const LEDGER_RATE_LIMIT = { maxClaims: 30, windowSeconds: 60 * 60 } as const

export const JOB_STATES = ["received", "reading", "needs_answers", "ready", "created", "rejected"] as const
export type JobState = (typeof JOB_STATES)[number]
export type ParkedState = "needs_answers" | "ready"

export type LedgerClaim =
  | { kind: "claimed"; claimId: string }
  | { kind: "duplicate"; projectId: string }
  | { kind: "resume"; claimId: string; state: ParkedState; result: unknown }
  | { kind: "in_progress" }
  | { kind: "rate_limited"; retryAfterSeconds: number }

/** What a refused job keeps in job_result. */
export type LedgerRejection = { code: string; message: string; issues?: string[] }

/**
 * `modelCalled` false means the attempt ended before any model call, so it does not count against the organisation's limit. Default
 * true. `rejection` is stored as the job's result and its state becomes rejected.
 */
export type LedgerReleaseOptions = { modelCalled?: boolean; rejection?: LedgerRejection }

export type ProjectSourceLedger = {
  claim(input: { contentSha256: string; fileName: string; byteSize: number }): Promise<LedgerClaim>
  attach(claimId: string, projectId: string): Promise<void>
  release(claimId: string, options?: LedgerReleaseOptions): Promise<void>
  /** Records the job's state and, when given, its result. A live row only. */
  setState(claimId: string, state: JobState, result?: unknown): Promise<void>
  /**
   * Takes a parked job (needs_answers, ready) to finish it: true when this call moved it to reading, false when it was not parked any
   * more (another request took it, or it was finished). Two submits that both saw the job parked cannot both finish it.
   */
  takeParked(claimId: string): Promise<boolean>
}

function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex")
}

/** The value stored in source_object.sha256 for a file: derived from the file hash, prefixed so it is never a real file hash. */
export function projectSourceLedgerKey(contentSha256: string): string {
  return sha256Hex(`${LEDGER_ORIGIN_REF}:${contentSha256}`)
}

function isParked(state: string | null | undefined): state is ParkedState {
  return state === "needs_answers" || state === "ready"
}

/** Claim, on an open tenant transaction. Exported so the ledger can be run against real Postgres in a test. */
export async function claimProjectSourceWithDb(
  db: TenantDb,
  args: { orgId: string; actorId: string; contentSha256: string; fileName: string; byteSize: number },
): Promise<LedgerClaim> {
  const key = projectSourceLedgerKey(args.contentSha256)
  for (let attempt = 0; attempt < 3; attempt++) {
    // Who holds the key, if anybody. Age is compared in SQL (the database clock, timestamptz), not in JavaScript. A job that was
    // just claimed is stale after LEDGER_CLAIM_TTL_SECONDS from its claim; one that is reading, after the same time from when it
    // started reading (a parked job finished long after it was claimed is not old for that); a parked one after
    // LEDGER_PARKED_TTL_SECONDS from when it was parked.
    const [existing] = await db
      .select({
        id: sourceObject.id,
        linkedEntityId: sourceObject.linkedEntityId,
        jobState: sourceObject.jobState,
        jobResult: sourceObject.jobResult,
        stale: sql<boolean>`case
          when ${sourceObject.jobState} in ('needs_answers', 'ready')
            then ${sourceObject.updatedAt} < now() - (interval '1 second' * ${LEDGER_PARKED_TTL_SECONDS})
          when ${sourceObject.jobState} = 'reading'
            then ${sourceObject.updatedAt} < now() - (interval '1 second' * ${LEDGER_CLAIM_TTL_SECONDS})
          else ${sourceObject.createdAt} < now() - (interval '1 second' * ${LEDGER_CLAIM_TTL_SECONDS}) end`,
      })
      .from(sourceObject)
      .where(and(eq(sourceObject.orgId, args.orgId), eq(sourceObject.sha256, key), isNull(sourceObject.deletedAt)))
      .limit(1)
    if (existing) {
      if (existing.linkedEntityId) return { kind: "duplicate", projectId: existing.linkedEntityId }
      if (!existing.stale) {
        if (isParked(existing.jobState)) return { kind: "resume", claimId: existing.id, state: existing.jobState, result: existing.jobResult }
        return { kind: "in_progress" }
      }
      // A claim that never reached a project and is older than the ttl: free the key, then claim it below.
      await db
        .update(sourceObject)
        .set({ deletedAt: sql`now()` })
        .where(and(eq(sourceObject.id, existing.id), isNull(sourceObject.linkedEntityId), isNull(sourceObject.deletedAt)))
    }

    // A new attempt (one possible model call): the organisation's rate limit applies here and only here. Nothing is inserted for a
    // refused attempt, so refusals never count against the window.
    const [usage] = await db
      .select({
        attempts: sql<number>`count(*)::int`,
        retryAfterSeconds: sql<number>`greatest(1, ceil(extract(epoch from (min(${sourceObject.createdAt}) + interval '1 second' * ${LEDGER_RATE_LIMIT.windowSeconds} - now()))))::int`,
      })
      .from(sourceObject)
      .where(
        and(
          eq(sourceObject.orgId, args.orgId),
          eq(sourceObject.originRef, LEDGER_ORIGIN_REF),
          sql`${sourceObject.createdAt} > now() - (interval '1 second' * ${LEDGER_RATE_LIMIT.windowSeconds})`,
          sql`${sourceObject.extractError} is distinct from ${LEDGER_NO_MODEL_CALL_MARK}`,
        ),
      )
    if (Number(usage?.attempts ?? 0) >= LEDGER_RATE_LIMIT.maxClaims) {
      return { kind: "rate_limited", retryAfterSeconds: Number(usage?.retryAfterSeconds ?? LEDGER_RATE_LIMIT.windowSeconds) }
    }

    const [inserted] = await db
      .insert(sourceObject)
      .values({
        orgId: args.orgId,
        origin: "upload",
        originRef: LEDGER_ORIGIN_REF,
        mimeType: XLSX_MIME_TYPE,
        byteSize: args.byteSize,
        storagePath: null,
        sha256: key,
        contentSha256: args.contentSha256,
        title: args.fileName,
        displayName: args.fileName,
        linkedEntityType: "project",
        linkedEntityId: null,
        extractStatus: "SKIPPED_UNSUPPORTED",
        jobState: "received",
        createdById: args.actorId,
        docUid: createId(),
      })
      .onConflictDoNothing({ target: [sourceObject.orgId, sourceObject.sha256], where: isNull(sourceObject.deletedAt) })
      .returning({ id: sourceObject.id })
    if (inserted) return { kind: "claimed", claimId: inserted.id }
    // Another request took the key between the read and the insert: read who holds it on the next pass.
  }
  return { kind: "in_progress" }
}

export async function attachProjectSourceWithDb(db: TenantDb, claimId: string, projectId: string): Promise<void> {
  const updated = await db
    .update(sourceObject)
    .set({ linkedEntityType: "project", linkedEntityId: projectId, updatedAt: sql`now()` })
    .where(and(eq(sourceObject.id, claimId), isNull(sourceObject.deletedAt)))
    .returning({ id: sourceObject.id })
  if (updated.length === 0) throw new Error("The upload claim no longer exists, so the project could not be recorded against it")
}

/**
 * Frees the key of a claim that never reached a project. A claim already linked to a project is left alone. With
 * `modelCalled: false` the row is also marked (LEDGER_NO_MODEL_CALL_MARK) so that the rate limit does not count it. With
 * `rejection` the row's state becomes rejected and its result the refusal, so the reason can still be read.
 */
export async function releaseProjectSourceWithDb(db: TenantDb, claimId: string, options: LedgerReleaseOptions = {}): Promise<void> {
  await db
    .update(sourceObject)
    .set({
      deletedAt: sql`now()`,
      ...(options.modelCalled === false ? { extractError: LEDGER_NO_MODEL_CALL_MARK } : {}),
      ...(options.rejection ? { jobState: "rejected", jobResult: options.rejection } : {}),
    })
    .where(and(eq(sourceObject.id, claimId), isNull(sourceObject.linkedEntityId), isNull(sourceObject.deletedAt)))
}

/** The job's state, and its result when one is given. A row that was released is not changed. */
export async function setProjectSourceStateWithDb(db: TenantDb, claimId: string, state: JobState, result?: unknown): Promise<void> {
  await db
    .update(sourceObject)
    .set({ jobState: state, ...(result !== undefined ? { jobResult: result } : {}), updatedAt: sql`now()` })
    .where(and(eq(sourceObject.id, claimId), isNull(sourceObject.deletedAt)))
}

/** Moves a parked job to reading, once: true for the one call that changed it, false for any other (nothing is left parked to take). */
export async function takeParkedProjectSourceWithDb(db: TenantDb, claimId: string): Promise<boolean> {
  const taken = await db
    .update(sourceObject)
    .set({ jobState: "reading", updatedAt: sql`now()` })
    .where(and(eq(sourceObject.id, claimId), isNull(sourceObject.deletedAt), isNull(sourceObject.linkedEntityId), inArray(sourceObject.jobState, ["needs_answers", "ready"])))
    .returning({ id: sourceObject.id })
  return taken.length === 1
}

/** The ledger the route uses: each step is its own tenant transaction, none opened inside another. */
export function createDbProjectSourceLedger(ctx: { orgId: string; actorId: string }): ProjectSourceLedger {
  const tenant = { orgId: ctx.orgId, userId: ctx.actorId }
  return {
    claim: (input) => withTenantContext(tenant, (db) => claimProjectSourceWithDb(db, { orgId: ctx.orgId, actorId: ctx.actorId, ...input })),
    attach: (claimId, projectId) => withTenantContext(tenant, (db) => attachProjectSourceWithDb(db, claimId, projectId)),
    release: (claimId, options) => withTenantContext(tenant, (db) => releaseProjectSourceWithDb(db, claimId, options)),
    setState: (claimId, state, result) => withTenantContext(tenant, (db) => setProjectSourceStateWithDb(db, claimId, state, result)),
    takeParked: (claimId) => withTenantContext(tenant, (db) => takeParkedProjectSourceWithDb(db, claimId)),
  }
}

// -------------------------------------------------------------------------------------------------------- reading a job

/** What the route tells a person about a job. The stored lines are not in it (the BOQ shows them once created). */
export type JobView = {
  jobId: string
  state: JobState
  fileName: string | null
  projectId: string | null
  questions: ExtractionQuestion[]
  reconciliation: Reconciliation | null
  stats: ExtractionResult["stats"] | null
  error: LedgerRejection | null
  updatedAt: string
}

type JobRow = {
  id: string
  jobState: string | null
  linkedEntityId: string | null
  jobResult: unknown
  displayName: string | null
  deletedAt: Date | string | null
  updatedAt: Date | string
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/** The state a row is in: its own job_state, or (a row written before 0646) created with a project, rejected when released, else received. */
function jobStateOfRow(row: Pick<JobRow, "jobState" | "linkedEntityId" | "deletedAt">): JobState {
  if ((JOB_STATES as readonly string[]).includes(row.jobState ?? "")) return row.jobState as JobState
  return row.linkedEntityId ? "created" : row.deletedAt ? "rejected" : "received"
}

/** A ledger row as a JobView. Pure. A row written before job_state existed reads as created (has a project), rejected (released) or received. */
export function jobViewFromRow(row: JobRow): JobView {
  const state = jobStateOfRow(row)
  const result = isObject(row.jobResult) ? row.jobResult : null
  const stored = result && result.v === 1 ? (result as unknown as StoredExtraction) : null
  const failed = state === "rejected" && result && typeof result.code === "string" ? (result as unknown as LedgerRejection) : null
  const stats = stored?.stats ?? (result && isObject(result.stats) ? (result.stats as ExtractionResult["stats"]) : null)
  return {
    jobId: row.id,
    state,
    fileName: row.displayName,
    projectId: row.linkedEntityId ?? (result && typeof result.projectId === "string" ? result.projectId : null),
    questions: stored?.questions ?? [],
    reconciliation: stored?.reconciliation ?? null,
    stats,
    error: failed ? { code: failed.code, message: failed.message, ...(failed.issues ? { issues: failed.issues } : {}) } : null,
    updatedAt: new Date(row.updatedAt).toISOString(),
  }
}

/**
 * The job of this organisation by its id (the claim id the route returned) or by the file's sha256, newest first. A released row is
 * included: a rejected job is released and still has its reason. Null when there is none.
 */
export async function getProjectSourceJobWithDb(db: TenantDb, args: { orgId: string; jobId?: string; contentSha256?: string }): Promise<JobView | null> {
  if (!args.jobId && !args.contentSha256) return null
  const match = args.jobId ? eq(sourceObject.id, args.jobId) : eq(sourceObject.sha256, projectSourceLedgerKey(args.contentSha256!))
  const [row] = await db
    .select({
      id: sourceObject.id,
      jobState: sourceObject.jobState,
      linkedEntityId: sourceObject.linkedEntityId,
      jobResult: sourceObject.jobResult,
      displayName: sourceObject.displayName,
      deletedAt: sourceObject.deletedAt,
      updatedAt: sourceObject.updatedAt,
    })
    .from(sourceObject)
    .where(and(eq(sourceObject.orgId, args.orgId), eq(sourceObject.originRef, LEDGER_ORIGIN_REF), match))
    .orderBy(sql`${sourceObject.createdAt} desc`)
    .limit(1)
  return row ? jobViewFromRow(row) : null
}

export function getProjectSourceJob(ctx: { orgId: string; actorId: string }, args: { jobId?: string; contentSha256?: string }): Promise<JobView | null> {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.actorId }, (db) => getProjectSourceJobWithDb(db, { orgId: ctx.orgId, ...args }))
}

// ------------------------------------------------------------------------------------------------------ the orchestration

/**
 * The refusals that come before any model call, in extractProjectFromDocument(): the workbook could not be read or is over a limit
 * (nothing was sent), the Edge Function is not set up here (no request was made), or it answered that no model is configured (it
 * stops before the model). Every other refusal (an invalid or ungrounded answer, an unavailable function, a bad BOQ) may follow a
 * model call, so it counts against the organisation's limit.
 */
const NO_MODEL_CALL_CODES: ReadonlySet<ExtractionErrorCode> = new Set<ExtractionErrorCode>([
  "unsupported_file_type",
  "workbook_unreadable",
  "workbook_empty",
  "workbook_too_large",
  "extraction_not_configured",
  "model_not_configured",
])

export type CreateFromDocumentInput = {
  orgId: string
  /** A real compliance.users id (the acting person), recorded as the project lead and the BOQ creator. */
  actorId: string
  productId: string
  fileName: string
  bytes: Uint8Array
  /** Replaces the project name the model found. */
  projectName?: string
  /** The person has seen that the lines add up to less than the file prints and wants the BOQ as it is (never covers an excess). */
  acknowledgeShortfall?: boolean
  /** The person has seen the open questions and wants the project created without those lines; the questions stay on the job. */
  acknowledgeQuestions?: boolean
  /** "prepare" reads and checks the file and stops at ready or needs_answers; the default creates the project and the BOQ. */
  mode?: "create" | "prepare"
}

export type CreateFromDocumentDeps<P extends { id: string }, B extends { id: string }> = {
  callEdge: EdgeCaller
  ledger: ProjectSourceLedger
  /** construction-dashboard-service.ts createProject(): the one project-create path. */
  createProject: (ctx: { orgId: string; userId: string; isRealUser?: boolean }, input: ProjectInput) => Promise<P>
  /** construction-boq-service.ts createBoq(): the one BOQ-create path. */
  createBoq: (ctx: { orgId: string; userId: string }, input: { projectId: string; title: string; lineItems: BoqLineItemInput[] }) => Promise<B>
}

export type CreateFromDocumentResult<P, B> =
  | { duplicate: true; projectId: string }
  /** Nothing was created: the job waits (needs_answers: open questions; ready: prepared, waiting for the create call). */
  | { duplicate: false; pending: true; state: ParkedState; jobId: string; questions: ExtractionQuestion[]; reconciliation: Reconciliation; extraction: ExtractionResult["stats"] }
  | {
      duplicate: false
      pending?: false
      projectId: string
      project: P
      boq: B
      extraction: ExtractionResult["stats"]
      questions: ExtractionQuestion[]
      reconciliation: Reconciliation
    }

/** How a job starts: the file is new (claimed), was created before (duplicate), or is parked and is finished from its stored result (resume). */
export type ExtractionJobStart = { kind: "duplicate"; projectId: string } | { kind: "claimed"; claimId: string } | { kind: "resume"; claimId: string; state: ParkedState; result: unknown }

/**
 * The first half of createProjectFromDocument(): the checks that need no parser, then the claim. A second submit of a file that
 * already has a project returns it (duplicate); one that is being processed, or an organisation over its hourly limit, is refused
 * here. It reads nothing and calls no model, so a route may answer 202 straight after it and run the job with runExtractionJob().
 */
export async function startExtractionJob(input: Pick<CreateFromDocumentInput, "fileName" | "bytes">, deps: { ledger: ProjectSourceLedger }): Promise<ExtractionJobStart> {
  assertWorkbookBytes(input.bytes)
  const claim = await deps.ledger.claim({
    contentSha256: sha256Hex(input.bytes),
    fileName: cleanCellText(input.fileName, 200),
    byteSize: input.bytes.byteLength,
  })
  if (claim.kind === "duplicate") return { kind: "duplicate", projectId: claim.projectId }
  if (claim.kind === "in_progress") {
    throw new ExtractionRejectedError("duplicate_in_progress", "This file is already being processed. Wait a minute and submit again to get its project")
  }
  if (claim.kind === "rate_limited") {
    throw new ExtractionRejectedError(
      "extraction_rate_limited",
      `This organisation has started ${LEDGER_RATE_LIMIT.maxClaims} extractions in the last hour, so nothing was created. Try again later`,
      [],
      claim.retryAfterSeconds,
    )
  }
  return claim
}

/** The facts the file prints that have no column of their own yet, written under the description the model gave (2,000 characters at most). */
function projectDescription(extracted: ExtractedProject): string | undefined {
  const facts: string[] = []
  if (extracted.client) facts.push(`Client: ${extracted.client}`)
  if (extracted.currency) facts.push(`Currency: ${extracted.currency}`)
  if (extracted.vat) facts.push(`VAT: ${extracted.vat.ratePercent}%`)
  const terms = extracted.paymentTerms
  if (terms?.summary) facts.push(`Payment terms: ${terms.summary}`)
  else if (terms?.milestones && terms.milestones.length > 0) {
    facts.push(`Payment milestones: ${terms.milestones.map((m) => `${m.label}${m.percent !== undefined ? ` ${m.percent}%` : ""}`).join("; ")}`)
  }
  if (facts.length === 0) return extracted.project.description
  return [extracted.project.description, ...facts].filter((t): t is string => !!t).join("\n").slice(0, 2000)
}

/** A ledger write whose failure must not undo work already done (a state label after the project exists). */
async function bestEffort(write: Promise<unknown>): Promise<void> {
  try {
    await write
  } catch {
    // The row's state is then one step behind; the project and the BOQ are what matter and they are recorded.
  }
}

/**
 * The extraction a job goes on with: for a parked job, what it stored (no model call); otherwise (a new file, or a stored result that
 * can no longer be trusted) a fresh one. A parked job is TAKEN first, so of two submits that both saw it parked only one finishes it;
 * if the stored answer is still not enough (for example a shortfall that is still not acknowledged) the job goes back to parked as it
 * was, so a corrected submit finishes it. A fresh extraction that is refused releases the claim with the reason.
 */
async function obtainExtraction(
  start: Exclude<ExtractionJobStart, { kind: "duplicate" }>,
  input: CreateFromDocumentInput,
  callEdge: EdgeCaller,
  ledger: ProjectSourceLedger,
  acknowledgedShortfall: boolean,
  release: (modelCalled: boolean, err?: unknown) => Promise<void>,
): Promise<ExtractionResult> {
  const claimId = start.claimId
  if (start.kind === "resume") {
    if (!(await ledger.takeParked(claimId))) {
      throw new ExtractionRejectedError("duplicate_in_progress", "This file is already being finished by another request. Wait a minute and submit again to get its project")
    }
    try {
      const stored = await resumeExtraction(start.result, input.bytes, { acknowledgeShortfall: acknowledgedShortfall })
      if (stored) return stored
    } catch (err) {
      await bestEffort(ledger.setState(claimId, start.state, start.result))
      throw err
    }
  }
  await bestEffort(ledger.setState(claimId, "reading"))
  try {
    return await extractProjectFromDocument(
      { fileName: input.fileName, bytes: input.bytes, attribution: { orgId: input.orgId, userId: input.actorId, requestId: claimId } },
      { callEdge },
      { acknowledgeShortfall: acknowledgedShortfall },
    )
  } catch (err) {
    // Only a refusal that says no model was reached is released as not counting; any other failure may have cost a model call.
    await release(!(err instanceof ExtractionRejectedError && NO_MODEL_CALL_CODES.has(err.code)), err)
    throw err
  }
}

/**
 * The second half of createProjectFromDocument(): everything after the claim. `start` is what startExtractionJob() returned (not a
 * duplicate). Every failure before createProject() releases the claim (recording the refusal as the job's result) and throws
 * ExtractionRejectedError, so nothing exists afterwards; the two failures that leave a project behind are described on
 * createProjectFromDocument().
 */
export async function runExtractionJob<P extends { id: string }, B extends { id: string }>(
  start: Exclude<ExtractionJobStart, { kind: "duplicate" }>,
  input: CreateFromDocumentInput,
  deps: CreateFromDocumentDeps<P, B>,
): Promise<CreateFromDocumentResult<P, B>> {
  const claimId = start.claimId
  const release = async (modelCalled: boolean, err?: unknown) => {
    try {
      const rejection = err instanceof ExtractionRejectedError ? { code: err.code, message: err.message, ...(err.issues.length > 0 ? { issues: err.issues } : {}) } : undefined
      await deps.ledger.release(claimId, { modelCalled, ...(rejection ? { rejection } : {}) })
    } catch {
      // The claim then frees itself after LEDGER_CLAIM_TTL_SECONDS; the original error is the one to report.
    }
  }

  const storedAcknowledged = start.kind === "resume" && isObject(start.result) && start.result.acknowledgedShortfall === true
  let acknowledgedShortfall = input.acknowledgeShortfall === true || storedAcknowledged

  const result = await obtainExtraction(start, input, deps.callEdge, deps.ledger, acknowledgedShortfall, release)
  acknowledgedShortfall = acknowledgedShortfall && result.reconciliation.status === "shortfall"

  const pendingState: ParkedState | null = result.questions.length > 0 && input.acknowledgeQuestions !== true ? "needs_answers" : input.mode === "prepare" ? "ready" : null
  if (pendingState) {
    try {
      await deps.ledger.setState(claimId, pendingState, { ...storedExtraction(result), acknowledgedShortfall })
    } catch (err) {
      await release(true)
      throw err
    }
    return { duplicate: false, pending: true, state: pendingState, jobId: claimId, questions: result.questions, reconciliation: result.reconciliation, extraction: result.stats }
  }

  const { extracted } = result
  let project: P
  try {
    project = await deps.createProject(
      { orgId: input.orgId, userId: input.actorId, isRealUser: true },
      {
        productId: input.productId,
        name: input.projectName?.trim() || extracted.project.name,
        description: projectDescription(extracted),
        startDate: extracted.project.startDate,
        targetDate: extracted.project.targetDate,
      },
    )
  } catch (err) {
    // A job that was parked keeps its stored extraction for the next try; a fresh one frees its claim.
    if (start.kind === "resume") await bestEffort(deps.ledger.setState(claimId, start.state, start.result))
    else await release(true)
    throw err
  }

  try {
    await deps.ledger.attach(claimId, project.id)
  } catch {
    // attach() is an update to a fixed value, so a repeat is safe. A second failure is a database fault: report the project.
    try {
      await deps.ledger.attach(claimId, project.id)
    } catch (err) {
      throw new ProjectCreatedUnlinkedError(project.id, err)
    }
  }

  let boq: B
  try {
    boq = await deps.createBoq(
      { orgId: input.orgId, userId: input.actorId },
      { projectId: project.id, title: extracted.boq.title, lineItems: toBoqLineItems(extracted) },
    )
  } catch (err) {
    await bestEffort(deps.ledger.setState(claimId, "rejected", { code: "boq_create_failed", message: "The project was created but its BOQ could not be saved", projectId: project.id }))
    throw new ProjectCreatedWithoutBoqError(project.id, err)
  }
  await bestEffort(deps.ledger.setState(claimId, "created", { projectId: project.id, boqId: boq.id, stats: result.stats, questions: result.questions.length }))
  return { duplicate: false, projectId: project.id, project, boq, extraction: result.stats, questions: result.questions, reconciliation: result.reconciliation }
}

/**
 * Register rows BR-507 and BR-508. Creates a project and its BOQ from a workbook, at most once per file: a second submit of the same
 * bytes (whatever the file is called) returns the first project's id and inserts nothing. Every failure before createProject()
 * throws ExtractionRejectedError and leaves no project, no BOQ and no claim behind; a failure of the BOQ insert after the project
 * exists throws ProjectCreatedWithoutBoqError (the project stays, and stays linked to the upload). If recording the project against
 * the upload fails (tried twice; the update is safe to repeat) it throws ProjectCreatedUnlinkedError: the project stays, the BOQ is
 * not attempted and the claim is kept, because freeing it would let the same file create a second project at once.
 *
 * BUILD-002 WP-02 (AW-112, AW-114). When the extraction has open questions and the caller has not acknowledged them, nothing is
 * created: the job is parked in needs_answers with the extraction stored, and the result says so (`pending`). The same applies to
 * mode "prepare", which parks the job in ready. A second submit of the same file (with acknowledgeQuestions, or in the default mode)
 * finishes the parked job from what it stored, with no second model call.
 */
export async function createProjectFromDocument<P extends { id: string }, B extends { id: string }>(
  input: CreateFromDocumentInput,
  deps: CreateFromDocumentDeps<P, B>,
): Promise<CreateFromDocumentResult<P, B>> {
  const start = await startExtractionJob(input, deps)
  if (start.kind === "duplicate") return { duplicate: true, projectId: start.projectId }
  return runExtractionJob(start, input, deps)
}
