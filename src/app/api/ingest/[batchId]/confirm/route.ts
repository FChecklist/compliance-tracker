/**
 * POST /api/ingest/[batchId]/confirm
 * Inserts all approved/edited staging items into compliance_items.
 * Skips: rejected items, duplicates (unless force=true), items with missing required fields.
 * This is the point of no return — batch moves to 'confirmed'.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/supabase/auth-guard'
import {
  ingestionBatches, ingestionItems,
  complianceItems, auditLogs, departments,
} from '@/lib/db'
import { withTenantContext } from '@/lib/db/tenant-scoped'
import { eq } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'

type Context = { params: Promise<{ batchId: string }> }

const VALID_TYPES = ['GST','TDS','MCA','PF','ESIC','INCOME_TAX','ROC','LABOUR','ENVIRONMENTAL','OTHER'] as const
const VALID_STATUSES = ['pending','in_progress','completed','overdue','not_applicable','draft'] as const
const VALID_PRIORITIES = ['low','medium','high','critical'] as const

export async function POST(req: NextRequest, ctx: Context) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: 'No organisation on this account' }, { status: 400 })

  const { batchId } = await ctx.params
  const body = await req.json().catch(() => ({})) as { force_duplicates?: boolean }
  const forceDuplicates = body.force_duplicates === true

  const result = await withTenantContext({ orgId }, async (db) => {
    // RLS-scoped -- 404s if this batch belongs to another org.
    const batch = await db.query.ingestionBatches.findFirst({
      where: eq(ingestionBatches.id, batchId),
      with: { items: true },
    })
    if (!batch) return { error: 'Batch not found', status: 404 as const }
    if (batch.status === 'confirmed') return { error: 'Batch already confirmed', status: 409 as const }
    if (batch.status === 'cancelled') return { error: 'Batch is cancelled', status: 409 as const }

    // Fallback department for items without one, scoped to this org.
    const fallbackDept = await db.query.departments.findFirst({ where: eq(departments.orgId, orgId), columns: { id: true } })
    if (!fallbackDept) return { error: 'Organisation not set up correctly', status: 500 as const }

    // Only process approved/edited items
    const toInsert = batch.items.filter(item => {
      if (item.reviewStatus === 'rejected') return false
      if (item.isDuplicate && !forceDuplicates) return false
      if (!item.title) return false // still can't import without a title
      return true
    })

    if (toInsert.length === 0) {
      return {
        error: 'No items to confirm. Approve at least one item first.',
        status: 400 as const,
        tip: batch.items.some(i => i.isDuplicate && i.reviewStatus !== 'rejected')
          ? 'Some items were skipped as duplicates. Pass force_duplicates: true to import them anyway.'
          : undefined,
      }
    }

    const inserted: { stagingId: string; complianceItemId: string }[] = []
    const failed: { stagingId: string; reason: string }[] = []

    for (const item of toInsert) {
      try {
        const complianceType = (VALID_TYPES as readonly string[]).includes(item.complianceType ?? '')
          ? (item.complianceType as typeof VALID_TYPES[number])
          : 'OTHER'

        const status = (VALID_STATUSES as readonly string[]).includes(item.status ?? '')
          ? (item.status as typeof VALID_STATUSES[number])
          : 'pending'

        const priority = (VALID_PRIORITIES as readonly string[]).includes(item.priority ?? '')
          ? (item.priority as typeof VALID_PRIORITIES[number])
          : 'medium'

        const dueDate = item.dueDate ? new Date(item.dueDate) : new Date()
        if (isNaN(dueDate.getTime())) {
          failed.push({ stagingId: item.id, reason: `Invalid due date: ${item.dueDate}` })
          continue
        }

        const departmentId = item.departmentId ?? fallbackDept.id

        const newItemId = createId()
        await db.insert(complianceItems).values({
          id: newItemId,
          title: item.title!,
          description: [
            item.description,
            Object.keys(JSON.parse(item.extraData ?? '{}')).length > 0
              ? `Extra data from import: ${item.extraData}`
              : null,
            `Imported from: ${batch.fileName} (row ${item.sourceRow})`,
          ].filter(Boolean).join('\n\n'),
          complianceType,
          status,
          priority,
          dueDate,
          completedAt: status === 'completed' ? new Date() : null,
          departmentId,
          assignedToId: item.assignedToId ?? null,
          orgId,
        })

        await db.insert(auditLogs).values({
          action: 'create',
          entityType: 'ComplianceItem',
          entityId: newItemId,
          userId: dbUser.id,
          details: `Imported from file: ${batch.fileName} (batch ${batchId}, row ${item.sourceRow})`,
        })

        // Mark staging item as confirmed
        await db.update(ingestionItems).set({ createdItemId: newItemId }).where(eq(ingestionItems.id, item.id))
        inserted.push({ stagingId: item.id, complianceItemId: newItemId })

      } catch (err) {
        failed.push({ stagingId: item.id, reason: (err as Error).message })
      }
    }

    // Update batch status
    await db.update(ingestionBatches).set({
      status: 'confirmed',
      confirmedCount: inserted.length,
      confirmedAt: new Date(),
    }).where(eq(ingestionBatches.id, batchId))

    return {
      confirmed: inserted.length,
      failed: failed.length,
      skippedDuplicates: toInsert.length - inserted.length - failed.length,
      inserted: inserted.map(i => i.complianceItemId),
      failures: failed,
      message: `Successfully imported ${inserted.length} compliance item${inserted.length === 1 ? '' : 's'}.${failed.length > 0 ? ` ${failed.length} items failed — check failures for details.` : ''}`,
    }
  })

  if ("error" in result) return NextResponse.json({ error: result.error, tip: "tip" in result ? result.tip : undefined }, { status: result.status })
  return NextResponse.json({ batchId, ...result })
}
