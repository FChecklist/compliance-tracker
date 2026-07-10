// Wave 107 (VERI FM & CS AI OS) -- the flagship adoption feature: "upload
// an Excel/CSV of a physical register, or a photo of one, and AI creates
// the digital register." Deliberately reuses existing plumbing end to
// end rather than standing up a new OCR pipeline: src/lib/ingest/parser.ts
// for Excel/CSV (already handles .xlsx/.xls/.xlsm/.xlsb/.csv via the
// existing `xlsx` dependency), and callLLMVision() (the same mechanism
// document-extraction-service.ts already uses) for a photographed
// register. Nothing here ever writes to fmAssets directly -- extraction
// output lands in fmRegisterDigitizationRows as 'pending', and only an
// explicit commitDigitizationBatch() call (after human review) creates
// real asset rows. This is the direct mechanism for "reduce data
// discrepancies," not just "digitize whatever was there."
import { fmRegisterDigitizationBatches, fmRegisterDigitizationRows, fmAssets, fmAssetCategories } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, isNull } from "drizzle-orm"
import { parseFile } from "@/lib/ingest/parser"
import { resolveModelConfig } from "@/lib/orchestra-model-resolver"
import { callLLM, callLLMVision, type LLMProvider } from "@/lib/llm-client"
import { resolvePromptTemplate } from "@/lib/prompt-os-resolver"
import { recordOrchestraExecution } from "@/lib/orchestra-execution-logger"
import { requireFmEnabled } from "./fm-enablement-service"
import { normalizeAssetName } from "./fm-asset-service"
import { findDuplicateCandidates } from "./fm-asset-dedup-service"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { users } from "@/lib/db"

export type FmDigitizationContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

const LAYER_KEY = "facilities_management_register_digitize_oa"
const EVENT_TYPE = "fm.register_digitize_extract"
const BATCH_SIZE = 80 // matches extractor.ts's own row-batching size for LLM context limits

// Same reasoning as document-extraction-service.ts's VISION_MODEL_OVERRIDES:
// whatever model resolveModelConfig() returns for this layer was chosen
// for the layer's default (text) use, never assume it can see an image --
// always route to a confirmed-vision-capable model for that provider.
const VISION_MODEL_OVERRIDES: Partial<Record<LLMProvider, string>> = {
  openai: "gpt-4o",
  anthropic: "claude-sonnet-5",
  google: "gemini-2.0-flash",
  openrouter: "openai/gpt-4o-mini",
}

type ExtractedAssetRow = {
  assetName: string | null
  categoryHint: string | null
  capacitySpec: string | null
  make: string | null
  model: string | null
  locationLabel: string | null
  confidence: number
  warnings: string[]
}

function parseExtractionResponse(raw: string): ExtractedAssetRow[] {
  let parsed: { rows?: Array<Record<string, unknown>> } = {}
  try {
    parsed = JSON.parse(raw)
  } catch {
    const match = raw.match(/\{[\s\S]*\}/)
    if (match) { try { parsed = JSON.parse(match[0]) } catch { /* give up */ } }
  }
  return (parsed.rows ?? []).map((r) => ({
    assetName: r.assetName ? String(r.assetName).trim() : null,
    categoryHint: r.categoryHint ? String(r.categoryHint).trim() : null,
    capacitySpec: r.capacitySpec ? String(r.capacitySpec).trim() : null,
    make: r.make ? String(r.make).trim() : null,
    model: r.model ? String(r.model).trim() : null,
    locationLabel: r.locationLabel ? String(r.locationLabel).trim() : null,
    confidence: Math.max(0, Math.min(1, Number(r.confidence ?? 0.5))),
    warnings: Array.isArray(r.warnings) ? r.warnings.map(String) : [],
  }))
}

/** Excel/CSV path -- parses the file with the existing ingest pipeline,
 *  batches rows to the LLM (same BATCH_SIZE discipline as
 *  extractComplianceItems), and stages every extracted row as 'pending'. */
export async function parseAndExtractFromFile(
  ctx: FmDigitizationContext,
  input: { documentId: string; buffer: Buffer; fileName: string; mimeType: string }
) {
  await requireFmEnabled(ctx.orgId)
  const parsed = await parseFile(input.buffer, input.fileName, input.mimeType)
  if (parsed.fileType === "pdf") throw new ServiceError("PDF asset registers are not yet supported -- use Excel/CSV or a photo instead", 400)

  const modelConfig = await resolveModelConfig(ctx.orgId, LAYER_KEY)
  if (!modelConfig) throw new ServiceError("No AI provider configured for this organisation", 503)
  const systemPrompt = await resolvePromptTemplate("fm.register_digitize_extract")

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [batch] = await db.insert(fmRegisterDigitizationBatches).values({
      orgId: ctx.orgId,
      sourceDocumentId: input.documentId,
      sourceType: parsed.fileType === "csv" ? "csv" : "excel",
      createdById: ctx.userId,
    }).returning()

    let totalExtracted = 0
    for (let i = 0; i < parsed.rows.length; i += BATCH_SIZE) {
      const chunk = parsed.rows.slice(i, i + BATCH_SIZE)
      const startedAt = Date.now()
      const userMessage = `Extract asset rows from these ${chunk.length} rows of a physical asset register.\n\nCOLUMNS: ${parsed.headers.join(" | ")}\n\nDATA (JSON rows):\n${JSON.stringify(chunk.map((row, j) => ({ __row: i + j + 1, ...row })), null, 1).slice(0, 14000)}\n\nRespond with ONLY JSON: { "rows": [ ...one object per row matching the extraction schema... ] }`

      const { content, usage } = await callLLM(
        modelConfig.provider, modelConfig.model, modelConfig.apiKey,
        systemPrompt, userMessage,
        { maxTokens: 8192, temperature: 0.1, jsonMode: true },
        modelConfig.fallback
      )
      const extracted = parseExtractionResponse(content)

      if (extracted.length > 0) {
        await db.insert(fmRegisterDigitizationRows).values(
          extracted.map((row, j) => ({
            batchId: batch.id,
            orgId: ctx.orgId,
            sourceRowNumber: i + j + 1,
            extractedData: row,
            confidence: String(row.confidence),
          }))
        )
      }
      totalExtracted += extracted.length

      recordOrchestraExecution({
        orgId: ctx.orgId, userId: ctx.userId, layerKey: LAYER_KEY, eventType: EVENT_TYPE,
        input: { documentId: input.documentId, batchIndex: i / BATCH_SIZE }, output: { extractedCount: extracted.length },
        status: "completed", durationMs: Date.now() - startedAt,
        provider: modelConfig.provider, model: modelConfig.model, usage,
      })
    }

    await db.update(fmRegisterDigitizationBatches).set({ status: "under_review", totalRowsExtracted: totalRowsExtracted }).where(eq(fmRegisterDigitizationBatches.id, batch.id))
    return { batchId: batch.id, totalRowsExtracted: totalExtracted }
  })
}

/** Photo path -- a technician (or admin) photographs a physical register
 *  page; reuses the same callLLMVision() mechanism
 *  document-extraction-service.ts already uses, with FM's own prompt and
 *  target schema instead of that file's generic document-summary one. */
export async function parseAndExtractFromPhoto(
  ctx: FmDigitizationContext,
  input: { documentId: string; imageBase64: string; mimeType: string }
) {
  await requireFmEnabled(ctx.orgId)
  const modelConfig = await resolveModelConfig(ctx.orgId, LAYER_KEY)
  if (!modelConfig) throw new ServiceError("No AI provider configured for this organisation", 503)

  // Same fallback discipline as document-extraction-service.ts: if the
  // resolved provider has no confirmed-vision-capable model (e.g. the
  // platform-default Groq, which has no vision model referenced in this
  // codebase), fall back to the resolved config's own fallback provider
  // (present on every resolved config) before giving up. Unlike
  // document-extraction-service.ts (which is fire-and-forget and so records
  // a failed orchestra_executions row on the genuine no-vision case), this
  // is a synchronous request handler -- the 503 ServiceError below is
  // already the discoverable signal to the caller, so no separate failed
  // row is needed here.
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

  if (!visionModel) throw new ServiceError(`This organisation's configured AI provider${modelConfig.fallback ? ` and its fallback (${modelConfig.fallback.provider})` : ""} have no confirmed vision-capable model`, 503)

  const systemPrompt = await resolvePromptTemplate("fm.register_digitize_extract")
  const startedAt = Date.now()
  const { content, usage } = await callLLMVision(
    visionProvider, visionModel, visionApiKey,
    systemPrompt, input.imageBase64, input.mimeType,
    'Extract every identifiable asset row from this photo of a physical asset register. Respond with ONLY JSON: { "rows": [ ...one object per row matching the extraction schema... ] }',
    { jsonMode: true, temperature: 0.1, maxTokens: 2048 }
  )
  const extracted = parseExtractionResponse(content)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [batch] = await db.insert(fmRegisterDigitizationBatches).values({
      orgId: ctx.orgId, sourceDocumentId: input.documentId, sourceType: "photo",
      status: "under_review", totalRowsExtracted: extracted.length, createdById: ctx.userId,
    }).returning()

    if (extracted.length > 0) {
      await db.insert(fmRegisterDigitizationRows).values(
        extracted.map((row, i) => ({
          batchId: batch.id, orgId: ctx.orgId, sourceRowNumber: i + 1,
          extractedData: row, confidence: String(row.confidence),
        }))
      )
    }

    recordOrchestraExecution({
      orgId: ctx.orgId, userId: ctx.userId, layerKey: LAYER_KEY, eventType: EVENT_TYPE,
      input: { documentId: input.documentId, mimeType: input.mimeType }, output: { extractedCount: extracted.length },
      status: "completed", durationMs: Date.now() - startedAt,
      provider: visionProvider, model: visionModel, usage,
    })

    return { batchId: batch.id, totalRowsExtracted: extracted.length }
  })
}

export async function listDigitizationRows(ctx: { orgId: string }, batchId: string) {
  await requireFmEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.fmRegisterDigitizationRows.findMany({
      where: and(eq(fmRegisterDigitizationRows.batchId, batchId), eq(fmRegisterDigitizationRows.orgId, ctx.orgId)),
      orderBy: (t, { asc }) => asc(t.sourceRowNumber),
    })
  })
}

export type FmDigitizationRowReview = { reviewStatus: "approved" | "edited" | "rejected"; editedData?: Record<string, unknown> | null }

/** Human review step -- mandatory before a row can ever reach
 *  commitDigitizationBatch(). Nothing auto-commits. */
export async function reviewDigitizationRow(ctx: FmDigitizationContext, rowId: string, review: FmDigitizationRowReview) {
  await requireFmEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const row = await db.query.fmRegisterDigitizationRows.findFirst({ where: and(eq(fmRegisterDigitizationRows.id, rowId), eq(fmRegisterDigitizationRows.orgId, ctx.orgId)) })
    if (!row) throw new ServiceError("Digitization row not found", 404)

    const [updated] = await db.update(fmRegisterDigitizationRows).set({
      reviewStatus: review.reviewStatus,
      editedData: review.editedData ?? null,
    }).where(eq(fmRegisterDigitizationRows.id, rowId)).returning()

    return updated
  })
}

/** Commits every 'approved'/'edited' row in a batch into real fmAssets
 *  rows, then runs duplicate-candidate detection against each newly
 *  committed asset (catches a digitized batch re-introducing something
 *  that already exists from a prior manual entry or earlier digitization
 *  run). 'rejected' and still-'pending' rows are left untouched. */
export async function commitDigitizationBatch(ctx: FmDigitizationContext, batchId: string) {
  await requireFmEnabled(ctx.orgId)
  const committedAssetIds: string[] = []

  await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const batch = await db.query.fmRegisterDigitizationBatches.findFirst({ where: and(eq(fmRegisterDigitizationBatches.id, batchId), eq(fmRegisterDigitizationBatches.orgId, ctx.orgId)) })
    if (!batch) throw new ServiceError("Digitization batch not found", 404)
    if (batch.status === "committed") throw new ServiceError("This batch has already been committed", 409)

    const rows = await db.query.fmRegisterDigitizationRows.findMany({
      where: and(eq(fmRegisterDigitizationRows.batchId, batchId), isNull(fmRegisterDigitizationRows.committedAssetId)),
    })
    const commitable = rows.filter((r) => r.reviewStatus === "approved" || r.reviewStatus === "edited")

    // Default category: the first active category whose displayName loosely
    // matches categoryHint (simple case-insensitive substring match -- the
    // final categorization is always human-adjustable post-commit, this is
    // just a reasonable starting guess, never authoritative).
    const categories = await db.query.fmAssetCategories.findMany({ where: eq(fmAssetCategories.isActive, true) })

    for (const row of commitable) {
      const data = (row.editedData ?? row.extractedData) as { assetName?: string; categoryHint?: string; capacitySpec?: string; make?: string; model?: string; locationLabel?: string }
      if (!data.assetName) continue // can't commit a row with no asset name, leave it uncommitted for further human correction

      const hint = (data.categoryHint ?? "").toLowerCase()
      const matchedCategory = categories.find((c) => hint.includes(c.displayName.toLowerCase()) || c.displayName.toLowerCase().includes(hint))
      const categoryId = matchedCategory?.id ?? categories[0]?.id
      if (!categoryId) throw new ServiceError("No asset categories are registered -- cannot commit", 500)

      const [asset] = await db.insert(fmAssets).values({
        orgId: ctx.orgId,
        categoryId,
        assetName: data.assetName,
        normalizedName: normalizeAssetName(data.assetName),
        capacitySpec: data.capacitySpec ?? null,
        make: data.make ?? null,
        model: data.model ?? null,
        locationLabel: data.locationLabel ?? null,
        sourceType: "register_digitization",
        sourceDocumentId: batch.sourceDocumentId,
        createdById: ctx.userId,
      }).returning()

      await db.update(fmRegisterDigitizationRows).set({ committedAssetId: asset.id }).where(eq(fmRegisterDigitizationRows.id, row.id))
      committedAssetIds.push(asset.id)
    }

    await db.update(fmRegisterDigitizationBatches).set({
      status: "committed", totalRowsCommitted: commitable.length, reviewedAt: new Date(),
    }).where(eq(fmRegisterDigitizationBatches.id, batchId))
  })

  // Duplicate scan runs after the commit transaction closes -- best-effort,
  // never blocks the commit itself on a scan failure.
  for (const assetId of committedAssetIds) {
    try {
      await findDuplicateCandidates(ctx, assetId)
    } catch (err) {
      console.error(`Duplicate scan failed for newly committed asset ${assetId}:`, err)
    }
  }

  return { committedCount: committedAssetIds.length }
}
