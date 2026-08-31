import { users, gstImportStagingRows, gstReturnPeriods } from "@/lib/db"
import { type TenantDb } from "@/lib/db/tenant-scoped"
import { eq } from "drizzle-orm"
import { decideActionAutonomy } from "@/lib/action-autonomy-decision"
import { logActivity } from "@/lib/audit"

// VERIDIAN Review Framework gap-closure (AI Engineering Quality / Code
// Structure & Modularity): extracted from task-execution-engine.ts's
// dispatchTool() -- the GST Reconciliation slice of that function's
// if-chain, unchanged in behavior, just relocated + grouped by
// responsibility. See compliance-tools.ts's header for the full extraction
// rationale.

export const GST_TOOL_CODES = new Set([
  "list_gst_import_batches",
  "list_gst_returns",
  "confirm_gst_batch",
  "run_gst_reconciliation",
  "generate_gst_return",
  "generate_gst_ai_review",
])

// list_* are read-only, safe from either dispatch path. The write actions
// (confirm/reconcile/generate/review) call the *Core variants directly on
// this same `db`/transaction, matching update_compliance_status's inline
// style in compliance-tools.ts -- one atomic transaction per dispatch, not
// a second, independent one opened by calling the outer service wrapper.
export async function dispatchGstTool(
  db: TenantDb,
  orgId: string,
  userId: string,
  codeReference: string,
  context?: { inputs?: Record<string, unknown> }
): Promise<unknown> {
  if (codeReference === "list_gst_import_batches") {
    const { listBatches } = await import("@/lib/services/gst-reconciliation-service")
    return listBatches({ orgId })
  }

  if (codeReference === "list_gst_returns") {
    const { listReturns } = await import("@/lib/services/gst-reconciliation-service")
    return listReturns({ orgId })
  }

  if (codeReference === "confirm_gst_batch") {
    const batchId = String(context?.inputs?.batchId ?? "")
    if (!batchId) throw new Error("Missing batchId")
    const dbUser = await db.query.users.findFirst({ where: eq(users.id, userId) })
    if (!dbUser) throw new Error("User not found")

    // R65 Part B: confirming a batch is what turns untrusted imported rows
    // into canonical invoices everything downstream (reconciliation,
    // returns) is built on -- a real "approval" per high-impact-action-
    // detector.ts's own taxonomy (inherently medium), escalated further by
    // the real rupee value being confirmed. Computed from the same staged
    // rows confirmBatchCore itself will validate/insert, not re-derived a
    // second way.
    const stagedRows = await db.query.gstImportStagingRows.findMany({ where: eq(gstImportStagingRows.batchId, batchId) })
    const totalStagedValue = stagedRows.reduce((sum, r) => {
      const d = r.mappedData as { invoiceNumber: string | null; invoiceDate: string | null; totalValue?: number }
      return d.invoiceNumber && d.invoiceDate && Number.isFinite(d.totalValue) ? sum + Number(d.totalValue) : sum
    }, 0)
    const autonomy = decideActionAutonomy({
      riskFactors: { financialAmountInr: totalStagedValue > 0 ? totalStagedValue : null, blastRadius: "single", highImpactCategory: "approval" },
    })
    if (autonomy.decision === "pending_review") {
      // Unlike update_compliance_status, a GST batch has no safe partial/
      // draft state to fall into -- it's either confirmed (canonical rows
      // exist, validation has run) or it isn't. So the gate skips the
      // mutation entirely rather than half-applying it, and surfaces the
      // decision for a human to re-invoke this same action once reviewed.
      await logActivity({ tx: db, action: "review_required", entityType: "GstImportBatch", entityId: batchId, details: `Confirm held for review: ${autonomy.reason}`, orgId, dbUser })
      return { batchId, confirmedCount: 0, findingsCount: 0, autonomyDecision: autonomy.decision, autonomyReason: autonomy.reason }
    }
    const { confirmBatchCore } = await import("@/lib/services/gst-reconciliation-service")
    const result = await confirmBatchCore(db, { orgId, userId, dbUser }, batchId)
    return { ...result, autonomyDecision: autonomy.decision, autonomyReason: autonomy.reason }
  }

  if (codeReference === "run_gst_reconciliation") {
    const purchaseBatchId = String(context?.inputs?.purchaseBatchId ?? "")
    const gstr2bBatchId = String(context?.inputs?.gstr2bBatchId ?? "")
    const period = String(context?.inputs?.period ?? "")
    if (!purchaseBatchId || !gstr2bBatchId || !period) throw new Error("Missing purchaseBatchId/gstr2bBatchId/period")
    const dbUser = await db.query.users.findFirst({ where: eq(users.id, userId) })
    if (!dbUser) throw new Error("User not found")
    const { runReconciliationCore } = await import("@/lib/services/gst-reconciliation-service")
    const result = await runReconciliationCore(db, { orgId, userId, dbUser }, { period, purchaseBatchId, gstr2bBatchId })

    // R65 Part B: reconciliation itself is fully re-runnable and finalizes
    // nothing on its own (no return/filing depends on this run alone), so
    // it's genuinely part of the software-decided 80% -- unlike confirm/
    // generate below, there's no amount or irreversibility to gate on. The
    // one real risk worth surfacing is a *data-quality* one: if a large
    // share of invoices didn't match, the numbers this run just produced
    // aren't trustworthy yet regardless of rupee amount -- a direct check
    // on the real mismatch ratio this run computed, not a forced fit into
    // the amount/category gate (which has no ratio concept).
    const totalRows = result.summary.exactMatches + result.summary.probableMatches + result.summary.mismatches + result.summary.missingIn2b + result.summary.missingInBooks
    const unmatchedRatio = totalRows > 0 ? (result.summary.mismatches + result.summary.missingIn2b + result.summary.missingInBooks) / totalRows : 0
    const autonomy = unmatchedRatio > 0.2
      ? { decision: "pending_review" as const, reason: `${Math.round(unmatchedRatio * 100)}% of rows are mismatched/missing -- data quality too low to trust automatically, review before relying on this run.` }
      : decideActionAutonomy({ riskFactors: { blastRadius: "single" } })
    return { ...result, autonomyDecision: autonomy.decision, autonomyReason: autonomy.reason }
  }

  if (codeReference === "generate_gst_return") {
    const period = String(context?.inputs?.period ?? "")
    const returnType = String(context?.inputs?.returnType ?? "")
    if (!period || !["gstr1", "gstr3b"].includes(returnType)) throw new Error("Missing or invalid period/returnType")
    const dbUser = await db.query.users.findFirst({ where: eq(users.id, userId) })
    if (!dbUser) throw new Error("User not found")
    const { generateReturnCore, resolveOwnGstinForOrg } = await import("@/lib/services/gst-reconciliation-service")
    const gstin = await resolveOwnGstinForOrg({ orgId })
    if (!gstin) throw new Error("No GSTIN configured for this organisation -- set it in Settings before generating a return.")
    const returnPeriod = await generateReturnCore(db, { orgId, userId, dbUser }, { period, gstin, returnType: returnType as "gstr1" | "gstr3b" })

    // R65 Part B: a generated return is the actual filing artifact -- this
    // is compliance_submission per high-impact-action-detector.ts's own
    // taxonomy, inherently high regardless of amount (same bucket as
    // payment/delete). generateReturnCore already persisted it as
    // 'generated'; the gate downgrades that to 'draft' (the same "not yet
    // final" reuse as the gate above) so nothing treats it as ready-to-file
    // until a human has actually looked at it.
    const returnAutonomy = decideActionAutonomy({ riskFactors: { blastRadius: "single", highImpactCategory: "compliance_submission" } })
    if (returnAutonomy.decision === "pending_review") {
      const [heldBack] = await db.update(gstReturnPeriods).set({ status: "draft" }).where(eq(gstReturnPeriods.id, returnPeriod.id)).returning()
      await logActivity({ tx: db, action: "review_required", entityType: "GstReturnPeriod", entityId: returnPeriod.id, details: `Generated return held as draft for review: ${returnAutonomy.reason}`, orgId, dbUser })
      return { ...heldBack, autonomyDecision: returnAutonomy.decision, autonomyReason: returnAutonomy.reason }
    }
    return { ...returnPeriod, autonomyDecision: returnAutonomy.decision, autonomyReason: returnAutonomy.reason }
  }

  if (codeReference === "generate_gst_ai_review") {
    const returnPeriodId = String(context?.inputs?.returnPeriodId ?? "")
    if (!returnPeriodId) throw new Error("Missing returnPeriodId")
    const dbUser = await db.query.users.findFirst({ where: eq(users.id, userId) })
    if (!dbUser) throw new Error("User not found")
    const { generateReviewReportCore } = await import("@/lib/services/gst-reconciliation-service")
    const report = await generateReviewReportCore(db, { orgId, userId, dbUser }, returnPeriodId)

    // R65 Part B: the one AI-authored step in this whole module -- the LLM
    // already emits its own risk verdict (low/medium/high) and, per issue,
    // a real amountAtStake. A "high" verdict is never auto-trusted
    // regardless of amount (an AI's own high-risk self-assessment is
    // exactly the case guardrail-engine.ts's whole design says must reach a
    // human); otherwise the real amountAtStake numbers the AI itself
    // surfaced feed the same deterministic gate as every other handler here.
    const maxAmountAtStake = report.topIssues.reduce((max, i) => Math.max(max, i.amountAtStake ?? 0), 0)
    const autonomy = report.verdict === "high"
      ? { decision: "pending_review" as const, reason: `The AI review itself verdict'd this return "high" risk -- always surfaced for human review regardless of amount.` }
      : decideActionAutonomy({ riskFactors: { financialAmountInr: maxAmountAtStake > 0 ? maxAmountAtStake : null, blastRadius: "single" } })
    if (autonomy.decision === "pending_review") {
      await logActivity({ tx: db, action: "review_required", entityType: "GstAiReviewReport", entityId: report.id, details: `AI review needs human sign-off: ${autonomy.reason}`, orgId, dbUser })
    }
    return { ...report, autonomyDecision: autonomy.decision, autonomyReason: autonomy.reason }
  }

  throw new Error(`No dispatcher implemented for ${codeReference}`)
}
