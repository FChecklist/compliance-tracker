// GST Verification & Reconciliation Engine service layer. Orchestrates the
// deterministic pipeline (import -> auto-map -> stage -> confirm -> validate
// -> reconcile -> generate return) and, only at the very last step, the one
// AI call (ai-review-report.ts). See veridian_gst_engine_design memory for
// the overall design and drizzle/0097_gst_reconciliation_engine.sql for the
// schema this reads/writes.
import {
  gstImportBatches, gstImportStagingRows, gstSourceProfiles, gstCanonicalInvoices, gstCanonicalInvoiceItems,
  gstGstinMaster, gstHsnMaster, gstValidationFindings, gstReconciliationRuns, gstReconciliationMatches,
  gstReturnPeriods, gstAiReviewReports, organisations, clientEntities, users,
} from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, inArray } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { logActivity } from "@/lib/audit"
import { adaptImportFile, type GstSourceType } from "@/lib/gst/adapters"
import type { ColumnMapping } from "@/lib/gst/column-mapper"
import { mapRowToDraft } from "@/lib/gst/adapters/spreadsheet-adapter"
import { isValidGstinChecksum } from "@/lib/engines/data-quality-engine"
import { runValidation, type ValidationInvoice } from "@/lib/gst/validation-engine"
import { reconcile, summarizeMatches, type ReconInvoice } from "@/lib/gst/reconciliation-engine"
import { generateGstr1, generateGstr3b, type ReturnInvoice } from "@/lib/gst/return-generator"
import { generateAiReviewReport } from "@/lib/gst/ai-review-report"

export type GstContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }
const SPREADSHEET_SOURCES: GstSourceType[] = ["excel_generic", "csv_generic", "busy", "zoho_books"]

async function resolveOwnGstin(db: TenantDb, orgId: string, clientId: string | null): Promise<string | null> {
  if (clientId) {
    const entity = await db.query.clientEntities.findFirst({ where: eq(clientEntities.clientId, clientId) })
    if (entity?.gstin) return entity.gstin
  }
  const org = await db.query.organisations.findFirst({ where: eq(organisations.id, orgId) })
  return org?.gstin ?? null
}

// ─── Import ──────────────────────────────────────────────────────────────
export async function importFile(
  ctx: GstContext,
  input: { sourceType: GstSourceType; direction: "sales" | "purchase" | "gstr2b"; period: string; clientId?: string | null; fileName: string; buffer: Buffer; mimeType: string }
) {
  let batchId: string | null = null
  try {
    return await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
      const [batch] = await db.insert(gstImportBatches).values({
        orgId: ctx.orgId, clientId: input.clientId ?? null, sourceType: input.sourceType, direction: input.direction,
        period: input.period, fileName: input.fileName, fileType: input.fileName.split(".").pop()?.toLowerCase() ?? "unknown",
        fileSizeBytes: input.buffer.length, uploadedById: ctx.userId, status: "processing",
      }).returning()
      batchId = batch.id

      let savedMapping: ColumnMapping | undefined
      if (SPREADSHEET_SOURCES.includes(input.sourceType)) {
        const profile = await db.query.gstSourceProfiles.findFirst({
          where: and(eq(gstSourceProfiles.orgId, ctx.orgId), eq(gstSourceProfiles.sourceType, input.sourceType), input.clientId ? eq(gstSourceProfiles.clientId, input.clientId) : undefined),
        })
        savedMapping = (profile?.columnMapping as ColumnMapping | undefined) ?? undefined
      }

      const adapted = await adaptImportFile(input.sourceType, input.buffer, input.fileName, input.mimeType, savedMapping)
      if (adapted.rows.length === 0) throw new ServiceError("No rows could be parsed from this file", 400)

      await db.insert(gstImportStagingRows).values(
        adapted.rows.map(r => ({ batchId: batch.id, sourceRow: r.sourceRow, rawData: r.rawData, mappedData: r.mappedData, mappingConfidence: r.mappingConfidence.toString() }))
      )

      await db.update(gstImportBatches).set({ status: "staged", totalRows: adapted.totalRows, stagedCount: adapted.rows.length }).where(eq(gstImportBatches.id, batch.id))
      await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "gst_import.staged", entityType: "gst_import_batch", entityId: batch.id, details: `${adapted.rows.length} rows` })

      return { batchId: batch.id, status: "staged", totalRows: adapted.totalRows, stagedCount: adapted.rows.length, mapping: adapted.mapping, confidence: adapted.confidence }
    })
  } catch (err) {
    if (batchId) {
      await withTenantContext({ orgId: ctx.orgId }, (db) =>
        db.update(gstImportBatches).set({ status: "failed", errorMessage: (err as Error).message }).where(eq(gstImportBatches.id, batchId!))
      ).catch(() => {})
    }
    throw err
  }
}

export async function getBatch(ctx: { orgId: string }, batchId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const batch = await db.query.gstImportBatches.findFirst({ where: and(eq(gstImportBatches.id, batchId), eq(gstImportBatches.orgId, ctx.orgId)) })
    if (!batch) throw new ServiceError("Import batch not found", 404)
    const rows = await db.query.gstImportStagingRows.findMany({ where: eq(gstImportStagingRows.batchId, batchId), orderBy: (r, { asc }) => asc(r.sourceRow) })
    return { batch, rows }
  })
}

export async function listBatches(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.gstImportBatches.findMany({ where: eq(gstImportBatches.orgId, ctx.orgId), orderBy: (b, { desc }) => desc(b.createdAt), limit: 100 })
  )
}

// Applies a user-corrected column mapping to every already-staged row (no
// re-upload needed) and saves it as the org's profile for this source type
// so the NEXT import from the same software auto-maps at confidence 1.0.
export async function updateMapping(ctx: GstContext, batchId: string, mapping: ColumnMapping) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const batch = await db.query.gstImportBatches.findFirst({ where: and(eq(gstImportBatches.id, batchId), eq(gstImportBatches.orgId, ctx.orgId)) })
    if (!batch) throw new ServiceError("Import batch not found", 404)
    if (!SPREADSHEET_SOURCES.includes(batch.sourceType as GstSourceType)) throw new ServiceError("Column mapping only applies to spreadsheet-based sources", 400)

    const rows = await db.query.gstImportStagingRows.findMany({ where: eq(gstImportStagingRows.batchId, batchId) })
    for (const row of rows) {
      const draft = mapRowToDraft(row.rawData as Record<string, unknown>, mapping)
      await db.update(gstImportStagingRows).set({ mappedData: draft, mappingConfidence: "1" }).where(eq(gstImportStagingRows.id, row.id))
    }

    const existing = await db.query.gstSourceProfiles.findFirst({
      where: and(eq(gstSourceProfiles.orgId, ctx.orgId), eq(gstSourceProfiles.sourceType, batch.sourceType), batch.clientId ? eq(gstSourceProfiles.clientId, batch.clientId) : undefined),
    })
    if (existing) {
      await db.update(gstSourceProfiles).set({ columnMapping: mapping, updatedAt: new Date() }).where(eq(gstSourceProfiles.id, existing.id))
    } else {
      await db.insert(gstSourceProfiles).values({ orgId: ctx.orgId, clientId: batch.clientId, sourceType: batch.sourceType, columnMapping: mapping })
    }

    return { updated: rows.length }
  })
}

export async function cancelBatch(ctx: GstContext, batchId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const batch = await db.query.gstImportBatches.findFirst({ where: and(eq(gstImportBatches.id, batchId), eq(gstImportBatches.orgId, ctx.orgId)) })
    if (!batch) throw new ServiceError("Import batch not found", 404)
    if (batch.status === "confirmed") throw new ServiceError("Cannot cancel a confirmed batch", 409)
    await db.update(gstImportBatches).set({ status: "cancelled", cancelledAt: new Date() }).where(eq(gstImportBatches.id, batchId))
    return { cancelled: true }
  })
}

// ─── Confirm (staged -> canonical + validation) ────────────────────────────
export async function confirmBatch(ctx: GstContext, batchId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const batch = await db.query.gstImportBatches.findFirst({ where: and(eq(gstImportBatches.id, batchId), eq(gstImportBatches.orgId, ctx.orgId)) })
    if (!batch) throw new ServiceError("Import batch not found", 404)
    if (batch.status === "confirmed") throw new ServiceError("Batch already confirmed", 409)

    const stagedRows = await db.query.gstImportStagingRows.findMany({ where: eq(gstImportStagingRows.batchId, batchId) })
    const validRows = stagedRows.filter(r => {
      const d = r.mappedData as { invoiceNumber: string | null; invoiceDate: string | null }
      return d.invoiceNumber && d.invoiceDate
    })
    if (validRows.length === 0) throw new ServiceError("No staged rows have both an invoice number and a valid date -- fix the column mapping and re-import", 400)

    const insertedIds: string[] = []
    for (const row of validRows) {
      const d = row.mappedData as {
        counterpartyGstin: string | null; counterpartyName: string | null; invoiceNumber: string; invoiceDate: string
        placeOfSupply: string | null; invoiceType: string; taxableValue: number; cgstAmount: number; sgstAmount: number
        igstAmount: number; cessAmount: number; totalValue: number
        items: { hsnSacCode: string | null; description: string | null; quantity: number; rate: number; taxableValue: number; gstRatePercent: number; cgstAmount: number; sgstAmount: number; igstAmount: number }[]
      }
      const [invoice] = await db.insert(gstCanonicalInvoices).values({
        orgId: ctx.orgId, clientId: batch.clientId, batchId: batch.id, direction: batch.direction, period: batch.period, sourceType: batch.sourceType,
        counterpartyGstin: d.counterpartyGstin, counterpartyName: d.counterpartyName, invoiceNumber: d.invoiceNumber, invoiceDate: d.invoiceDate,
        placeOfSupply: d.placeOfSupply, invoiceType: d.invoiceType,
        taxableValue: d.taxableValue.toString(), cgstAmount: d.cgstAmount.toString(), sgstAmount: d.sgstAmount.toString(),
        igstAmount: d.igstAmount.toString(), cessAmount: d.cessAmount.toString(), totalValue: d.totalValue.toString(),
      }).returning()
      insertedIds.push(invoice.id)

      if (d.items.length > 0) {
        await db.insert(gstCanonicalInvoiceItems).values(d.items.map(item => ({
          invoiceId: invoice.id, hsnSacCode: item.hsnSacCode, description: item.description,
          quantity: item.quantity.toString(), rate: item.rate.toString(), taxableValue: item.taxableValue.toString(),
          gstRatePercent: item.gstRatePercent.toString(), cgstAmount: item.cgstAmount.toString(), sgstAmount: item.sgstAmount.toString(), igstAmount: item.igstAmount.toString(),
        })))
      }

      // Cache GSTIN checksum result (upsert-by-lookup since gstin is UNIQUE)
      if (d.counterpartyGstin) {
        const existingGstin = await db.query.gstGstinMaster.findFirst({ where: eq(gstGstinMaster.gstin, d.counterpartyGstin) })
        if (!existingGstin) {
          await db.insert(gstGstinMaster).values({ gstin: d.counterpartyGstin, checksumValid: isValidGstinChecksum(d.counterpartyGstin), tradeName: d.counterpartyName }).onConflictDoNothing()
        }
      }
    }

    await db.update(gstImportBatches).set({ status: "confirmed", confirmedCount: insertedIds.length, confirmedAt: new Date() }).where(eq(gstImportBatches.id, batchId))

    // Run the deterministic validation engine against everything just confirmed.
    const invoicesForValidation = await db.query.gstCanonicalInvoices.findMany({
      where: inArray(gstCanonicalInvoices.id, insertedIds), with: { items: true },
    })
    const hsnRows = await db.query.gstHsnMaster.findMany()
    const knownHsnCodes = new Set(hsnRows.map(h => h.hsnSacCode))
    const ownGstin = await resolveOwnGstin(db, ctx.orgId, batch.clientId)

    const findings = runValidation(
      invoicesForValidation.map((inv): ValidationInvoice => ({ ...inv, items: inv.items })),
      knownHsnCodes, ownGstin
    )
    if (findings.length > 0) {
      await db.insert(gstValidationFindings).values(findings.map(f => ({
        orgId: ctx.orgId, batchId: batch.id, invoiceId: f.invoiceId, ruleCode: f.ruleCode, severity: f.severity, message: f.message, suggestedFix: f.suggestedFix,
      })))
    }

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "gst_import.confirmed", entityType: "gst_import_batch", entityId: batch.id, details: `${insertedIds.length} invoices, ${findings.length} findings` })
    return { confirmedCount: insertedIds.length, findingsCount: findings.length }
  })
}

export async function listFindings(ctx: { orgId: string }, batchId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.gstValidationFindings.findMany({ where: and(eq(gstValidationFindings.orgId, ctx.orgId), eq(gstValidationFindings.batchId, batchId)), orderBy: (f, { desc }) => desc(f.severity) })
  )
}

// ─── Reconciliation ─────────────────────────────────────────────────────
export async function runReconciliation(ctx: GstContext, input: { period: string; clientId?: string | null; purchaseBatchId: string; gstr2bBatchId: string }) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [purchaseInvoices, gstr2bInvoices] = await Promise.all([
      db.query.gstCanonicalInvoices.findMany({ where: and(eq(gstCanonicalInvoices.orgId, ctx.orgId), eq(gstCanonicalInvoices.batchId, input.purchaseBatchId)) }),
      db.query.gstCanonicalInvoices.findMany({ where: and(eq(gstCanonicalInvoices.orgId, ctx.orgId), eq(gstCanonicalInvoices.batchId, input.gstr2bBatchId)) }),
    ])
    if (purchaseInvoices.length === 0) throw new ServiceError("No confirmed purchase-register invoices for that batch", 400)
    if (gstr2bInvoices.length === 0) throw new ServiceError("No confirmed GSTR-2B invoices for that batch", 400)

    const matches = reconcile(purchaseInvoices as ReconInvoice[], gstr2bInvoices as ReconInvoice[])
    const summary = summarizeMatches(matches)

    const [run] = await db.insert(gstReconciliationRuns).values({
      orgId: ctx.orgId, clientId: input.clientId ?? null, period: input.period,
      purchaseBatchId: input.purchaseBatchId, gstr2bBatchId: input.gstr2bBatchId, status: "completed",
      totalPurchaseRows: purchaseInvoices.length, total2bRows: gstr2bInvoices.length,
      exactMatches: summary.exactMatches, probableMatches: summary.probableMatches, mismatches: summary.mismatches,
      missingIn2b: summary.missingIn2b, missingInBooks: summary.missingInBooks, completedAt: new Date(),
    }).returning()

    if (matches.length > 0) {
      await db.insert(gstReconciliationMatches).values(matches.map(m => ({
        runId: run.id, purchaseInvoiceId: m.purchaseInvoiceId, gstr2bInvoiceId: m.gstr2bInvoiceId, matchType: m.matchType,
        confidenceScore: m.confidenceScore.toString(), deltaAmount: m.deltaAmount.toString(), notes: m.notes,
      })))
    }

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "gst_reconciliation.run", entityType: "gst_reconciliation_run", entityId: run.id, details: JSON.stringify(summary) })
    return { runId: run.id, summary }
  })
}

export async function getReconciliationRun(ctx: { orgId: string }, runId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const run = await db.query.gstReconciliationRuns.findFirst({ where: and(eq(gstReconciliationRuns.id, runId), eq(gstReconciliationRuns.orgId, ctx.orgId)) })
    if (!run) throw new ServiceError("Reconciliation run not found", 404)
    const matches = await db.query.gstReconciliationMatches.findMany({ where: eq(gstReconciliationMatches.runId, runId) })
    return { run, matches }
  })
}

export async function listReconciliationRuns(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.gstReconciliationRuns.findMany({ where: eq(gstReconciliationRuns.orgId, ctx.orgId), orderBy: (r, { desc }) => desc(r.createdAt), limit: 50 })
  )
}

// ─── Return generation ──────────────────────────────────────────────────
export async function generateReturn(ctx: GstContext, input: { period: string; gstin: string; returnType: "gstr1" | "gstr3b"; clientId?: string | null }) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const salesInvoices = await db.query.gstCanonicalInvoices.findMany({
      where: and(eq(gstCanonicalInvoices.orgId, ctx.orgId), eq(gstCanonicalInvoices.period, input.period), eq(gstCanonicalInvoices.direction, "sales")),
      with: { items: true },
    })
    if (salesInvoices.length === 0) throw new ServiceError(`No confirmed sales invoices for period ${input.period}`, 400)

    const result = input.returnType === "gstr1"
      ? generateGstr1(input.gstin, input.period, salesInvoices as unknown as ReturnInvoice[])
      : await (async () => {
          const purchaseInvoices = await db.query.gstCanonicalInvoices.findMany({
            where: and(eq(gstCanonicalInvoices.orgId, ctx.orgId), eq(gstCanonicalInvoices.period, input.period), eq(gstCanonicalInvoices.direction, "purchase")),
            with: { items: true },
          })
          return generateGstr3b(input.gstin, input.period, salesInvoices as unknown as ReturnInvoice[], purchaseInvoices as unknown as ReturnInvoice[])
        })()

    const existing = await db.query.gstReturnPeriods.findFirst({
      where: and(eq(gstReturnPeriods.orgId, ctx.orgId), eq(gstReturnPeriods.period, input.period), eq(gstReturnPeriods.returnType, input.returnType), eq(gstReturnPeriods.gstin, input.gstin)),
    })
    const [returnPeriod] = existing
      ? await db.update(gstReturnPeriods).set({ status: "generated", generatedJson: result.json, summary: result.summary, generatedById: ctx.userId, generatedAt: new Date() }).where(eq(gstReturnPeriods.id, existing.id)).returning()
      : await db.insert(gstReturnPeriods).values({
          orgId: ctx.orgId, clientId: input.clientId ?? null, period: input.period, gstin: input.gstin, returnType: input.returnType,
          status: "generated", generatedJson: result.json, summary: result.summary, generatedById: ctx.userId, generatedAt: new Date(),
        }).returning()

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "gst_return.generated", entityType: "gst_return_period", entityId: returnPeriod.id, details: input.returnType })
    return returnPeriod
  })
}

export async function getReturn(ctx: { orgId: string }, returnPeriodId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const returnPeriod = await db.query.gstReturnPeriods.findFirst({ where: and(eq(gstReturnPeriods.id, returnPeriodId), eq(gstReturnPeriods.orgId, ctx.orgId)) })
    if (!returnPeriod) throw new ServiceError("Return not found", 404)
    return returnPeriod
  })
}

export async function listReturns(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.gstReturnPeriods.findMany({ where: eq(gstReturnPeriods.orgId, ctx.orgId), orderBy: (r, { desc }) => desc(r.createdAt), limit: 50 })
  )
}

// ─── AI review (the one AI-touched step) ───────────────────────────────
export async function generateReviewReport(ctx: GstContext, returnPeriodId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const returnPeriod = await db.query.gstReturnPeriods.findFirst({ where: and(eq(gstReturnPeriods.id, returnPeriodId), eq(gstReturnPeriods.orgId, ctx.orgId)) })
    if (!returnPeriod) throw new ServiceError("Return not found", 404)

    const batchesInPeriod = await db.query.gstImportBatches.findMany({ where: and(eq(gstImportBatches.orgId, ctx.orgId), eq(gstImportBatches.period, returnPeriod.period)) })
    const batchIds = batchesInPeriod.map(b => b.id)
    const findings = batchIds.length > 0
      ? await db.query.gstValidationFindings.findMany({ where: and(eq(gstValidationFindings.orgId, ctx.orgId), inArray(gstValidationFindings.batchId, batchIds)) })
      : []

    const latestRun = await db.query.gstReconciliationRuns.findFirst({
      where: and(eq(gstReconciliationRuns.orgId, ctx.orgId), eq(gstReconciliationRuns.period, returnPeriod.period)),
      orderBy: (r, { desc }) => desc(r.createdAt),
    })
    const matches = latestRun ? await db.query.gstReconciliationMatches.findMany({ where: eq(gstReconciliationMatches.runId, latestRun.id) }) : []

    const result = await generateAiReviewReport(ctx.orgId, ctx.userId, {
      period: returnPeriod.period, returnType: returnPeriod.returnType,
      findings: findings.map(f => ({ ruleCode: f.ruleCode, severity: f.severity, message: f.message })),
      reconciliationSummary: latestRun ? {
        exactMatches: latestRun.exactMatches ?? 0, probableMatches: latestRun.probableMatches ?? 0, mismatches: latestRun.mismatches ?? 0,
        missingIn2b: latestRun.missingIn2b ?? 0, missingInBooks: latestRun.missingInBooks ?? 0,
      } : null,
      reconciliationDeltas: matches.filter(m => m.matchType !== "exact").map(m => ({ matchType: m.matchType, deltaAmount: parseFloat(m.deltaAmount ?? "0"), notes: m.notes })),
      returnSummary: (returnPeriod.summary as Record<string, unknown>) ?? {},
    })

    const [report] = await db.insert(gstAiReviewReports).values({
      orgId: ctx.orgId, returnPeriodId, reportText: result.reportText, riskFlags: result.topIssues, provider: result.provider, model: result.model,
    }).returning()

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "gst_return.ai_review_generated", entityType: "gst_ai_review_report", entityId: report.id, details: result.verdict })
    return { ...report, verdict: result.verdict, summary: result.summary, topIssues: result.topIssues }
  })
}

export async function getLatestReviewReport(ctx: { orgId: string }, returnPeriodId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.gstAiReviewReports.findFirst({ where: and(eq(gstAiReviewReports.orgId, ctx.orgId), eq(gstAiReviewReports.returnPeriodId, returnPeriodId)), orderBy: (r, { desc }) => desc(r.createdAt) })
  )
}
