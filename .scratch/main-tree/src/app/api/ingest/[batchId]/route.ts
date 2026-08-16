/**
 * GET  /api/ingest/[batchId]  — batch details + all staged items
 * DELETE /api/ingest/[batchId] — cancel the batch (wipes staging items)
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/supabase/auth-guard'
import { ingestionBatches, ingestionItems } from '@/lib/db'
import { withTenantContext } from '@/lib/db/tenant-scoped'
import { eq } from 'drizzle-orm'

type Context = { params: Promise<{ batchId: string }> }

export async function GET(_req: NextRequest, ctx: Context) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: 'No organisation on this account' }, { status: 400 })

  const { batchId } = await ctx.params

  const batch = await withTenantContext({ orgId }, (db) =>
    db.query.ingestionBatches.findFirst({
      where: eq(ingestionBatches.id, batchId),
      with: {
        uploadedBy: { columns: { name: true } },
        items: { orderBy: (i, { asc }) => [asc(i.sourceRow)] },
      },
    })
  )

  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

  return NextResponse.json({
    batch: {
      id: batch.id,
      fileName: batch.fileName,
      fileType: batch.fileType,
      fileSizeBytes: batch.fileSizeBytes,
      status: batch.status,
      totalRows: batch.totalRows,
      extractedCount: batch.extractedCount,
      approvedCount: batch.approvedCount,
      rejectedCount: batch.rejectedCount,
      confirmedCount: batch.confirmedCount,
      aiModel: batch.aiModel,
      extractionSummary: batch.extractionSummary ? JSON.parse(batch.extractionSummary) : null,
      errorMessage: batch.errorMessage,
      uploadedBy: batch.uploadedBy.name,
      createdAt: batch.createdAt.toISOString(),
      confirmedAt: batch.confirmedAt?.toISOString() ?? null,
    },
    items: batch.items.map(item => ({
      id: item.id,
      sourceRow: item.sourceRow,
      title: item.title,
      complianceType: item.complianceType,
      dueDate: item.dueDate,
      status: item.status,
      priority: item.priority,
      departmentName: item.departmentName,
      departmentId: item.departmentId,
      assignedToName: item.assignedToName,
      assignedToId: item.assignedToId,
      description: item.description,
      extraData: item.extraData ? JSON.parse(item.extraData) : {},
      confidence: parseFloat(item.confidence ?? '0'),
      reviewStatus: item.reviewStatus,
      warnings: item.warnings ? JSON.parse(item.warnings) : [],
      missingFields: item.missingFields ? JSON.parse(item.missingFields) : [],
      isDuplicate: item.isDuplicate,
      duplicateOfId: item.duplicateOfId,
      createdItemId: item.createdItemId,
    })),
  })
}

export async function DELETE(_req: NextRequest, ctx: Context) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: 'No organisation on this account' }, { status: 400 })

  const { batchId } = await ctx.params

  const result = await withTenantContext({ orgId }, async (db) => {
    const batch = await db.query.ingestionBatches.findFirst({
      where: eq(ingestionBatches.id, batchId),
      columns: { id: true, status: true },
    })

    if (!batch) return { error: 'Batch not found', status: 404 as const }
    if (batch.status === 'confirmed') {
      return { error: 'Cannot cancel a confirmed batch', status: 409 as const }
    }

    await db.delete(ingestionItems).where(eq(ingestionItems.batchId, batchId))
    await db.update(ingestionBatches).set({
      status: 'cancelled',
      cancelledAt: new Date(),
    }).where(eq(ingestionBatches.id, batchId))

    return { cancelled: true }
  })

  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ cancelled: true, batchId })
}
