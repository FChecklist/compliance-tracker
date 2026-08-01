/** GET /api/crm/import/[batchId] — one CRM import batch's summary. */
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getCrmImportBatch, ServiceError } from "@/lib/services/crm-import-export-service"

type Context = { params: Promise<{ batchId: string }> }

export async function GET(_req: NextRequest, ctx: Context) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const { batchId } = await ctx.params

  try {
    const batch = await getCrmImportBatch({ orgId }, batchId)
    return NextResponse.json({
      batch: {
        id: batch.id, fileName: batch.fileName, targetEntity: batch.targetEntity, status: batch.status,
        totalRows: batch.totalRows, extractedCount: batch.extractedCount, confirmedCount: batch.confirmedCount,
        rejectedCount: batch.rejectedCount, errorMessage: batch.errorMessage,
        errors: batch.extractionSummary ? JSON.parse(batch.extractionSummary).errors : [],
        uploadedBy: batch.uploadedBy.name, createdAt: batch.createdAt.toISOString(),
        confirmedAt: batch.confirmedAt?.toISOString() ?? null,
      },
    })
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status })
    throw err
  }
}
