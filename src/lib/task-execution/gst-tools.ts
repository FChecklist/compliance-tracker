import { users } from "@/lib/db"
import { type TenantDb } from "@/lib/db/tenant-scoped"
import { eq } from "drizzle-orm"

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
    const { confirmBatchCore } = await import("@/lib/services/gst-reconciliation-service")
    return confirmBatchCore(db, { orgId, userId, dbUser }, batchId)
  }

  if (codeReference === "run_gst_reconciliation") {
    const purchaseBatchId = String(context?.inputs?.purchaseBatchId ?? "")
    const gstr2bBatchId = String(context?.inputs?.gstr2bBatchId ?? "")
    const period = String(context?.inputs?.period ?? "")
    if (!purchaseBatchId || !gstr2bBatchId || !period) throw new Error("Missing purchaseBatchId/gstr2bBatchId/period")
    const dbUser = await db.query.users.findFirst({ where: eq(users.id, userId) })
    if (!dbUser) throw new Error("User not found")
    const { runReconciliationCore } = await import("@/lib/services/gst-reconciliation-service")
    return runReconciliationCore(db, { orgId, userId, dbUser }, { period, purchaseBatchId, gstr2bBatchId })
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
    return generateReturnCore(db, { orgId, userId, dbUser }, { period, gstin, returnType: returnType as "gstr1" | "gstr3b" })
  }

  if (codeReference === "generate_gst_ai_review") {
    const returnPeriodId = String(context?.inputs?.returnPeriodId ?? "")
    if (!returnPeriodId) throw new Error("Missing returnPeriodId")
    const dbUser = await db.query.users.findFirst({ where: eq(users.id, userId) })
    if (!dbUser) throw new Error("User not found")
    const { generateReviewReportCore } = await import("@/lib/services/gst-reconciliation-service")
    return generateReviewReportCore(db, { orgId, userId, dbUser }, returnPeriodId)
  }

  throw new Error(`No dispatcher implemented for ${codeReference}`)
}
