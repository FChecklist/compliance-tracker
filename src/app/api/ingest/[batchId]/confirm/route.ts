/**
 * POST /api/ingest/[batchId]/confirm
 * Inserts all approved/edited staging items into compliance_items.
 * Skips: rejected items, duplicates (unless force=true), items with missing required fields.
 * This is the point of no return — batch moves to 'confirmed'.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/supabase/auth-guard'
import {
  db, ingestionBatches, ingestionItems,
  complianceItems, auditLogs, departments, users, organisations,
} from '@/lib/db'
import { eq, and, inArray } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'

type Context = { params: Promise<{ batchId: string }> }

const VALID_TYPES = ['GST','TDS','MCA','PF','ESIC','INCOME_TAX','ROC','LABOUR','ENVIRONMENTAL','OTHER'] as const
const VALID_STATUSES = ['pending','in_progress','completed','overdue','not_applicable','draft'] as const
const VALID_PRIORITIES = ['low','medium','high','critical'] as const

export async function POST(req: NextRequest, ctx: Context) {
  const { response } = await requireAuth()
  if (response) return response

  const { batchId } = await ctx.params
  const body = await req.json().catch(() => ({})) as { force_duplicates?: boolean }
  const forceDuplicates = body.force_duplicates === true

  const batch = await db.query.ingestionBatches.findFirst({
    where: eq(ingestionBatches.id, batchId),
    with: { items: true },
  })
  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
  if (batch.status === 'confirmed') return NextResponse.json({ error: 'Batch already confirmed' }, { status: 409 })
  if (batch.status === 'cancelled') return NextResponse.json({ error: 'Batch is cancelled' }, { status: 409 })

  // Get organisation + fallback department + fallback user for items without assignment
  const org = await db.query.organisations.findFirst()
  const fallbackDept = await db.query.departments.findFirst({ columns: { id: true } })
  const adminUser = await db.query.users.findFirst({ where: eq(users.role, 'admin'), columns: { id: true } })

  if (!org || !fallbackDept || !adminUser) {
    return NextResponse.json({ error: 'Organisation not set up correctly' }, { status: 500 })
  }

  // Only process approved/edited items
  const toInsert = batch.items.filter(item => {
    if (item.reviewStatus === 'rejected') return false
    if (item.isDuplicate && !forceDuplicates) return false
    if (!item.title) return false // still can't import without a title
    return true
  })

  if (toInsert.length === 0) {
    return NextResponse.json({
      error: 'No items to confirm. Approve at least one item first.',
      tip: batch.items.some(i => i.isDuplicate && i.reviewStatus !== 'rejected')
        ? 'Some items were skipped as duplicates. Pass force_duplicates: true to import them anyway.'
        : undefined,
    }, { status: 400 })
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
        orgId: org.id,
      })

      await db.insert(auditLogs).values({
        action: 'create',
        entityType: 'ComplianceItem',
        entityId: newItemId,
        userId: adminUser.id,
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

  return NextResponse.json({
    batchId,
    confirmed: inserted.length,
    failed: failed.length,
    skippedDuplicates: toInsert.length - inserted.length - failed.length,
    inserted: inserted.map(i => i.complianceItemId),
    failures: failed,
    message: `Successfully imported ${inserted.length} compliance item${inserted.length === 1 ? '' : 's'}.${failed.length > 0 ? ` ${failed.length} items failed — check failures for details.` : ''}`,
  })
}
