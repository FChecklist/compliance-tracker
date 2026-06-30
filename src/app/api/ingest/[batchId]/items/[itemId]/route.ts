/**
 * PATCH /api/ingest/[batchId]/items/[itemId]
 * Human edits or approves/rejects a single staged item.
 * Editable fields: title, complianceType, dueDate, status, priority,
 *                  departmentId, assignedToId, description, reviewStatus
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/supabase/auth-guard'
import { db, ingestionItems, ingestionBatches, departments } from '@/lib/db'
import { eq, and, sql } from 'drizzle-orm'

type Context = { params: Promise<{ batchId: string; itemId: string }> }

const VALID_REVIEW_STATUSES = ['pending', 'approved', 'rejected', 'edited'] as const
const VALID_COMPLIANCE_TYPES = ['GST','TDS','MCA','PF','ESIC','INCOME_TAX','ROC','LABOUR','ENVIRONMENTAL','OTHER'] as const
const VALID_STATUSES = ['pending','in_progress','completed','overdue','not_applicable','draft'] as const
const VALID_PRIORITIES = ['low','medium','high','critical'] as const

export async function PATCH(req: NextRequest, ctx: Context) {
  const { response } = await requireAuth()
  if (response) return response

  const { batchId, itemId } = await ctx.params

  const item = await db.query.ingestionItems.findFirst({
    where: and(eq(ingestionItems.id, itemId), eq(ingestionItems.batchId, batchId)),
  })
  if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 })

  const batch = await db.query.ingestionBatches.findFirst({
    where: eq(ingestionBatches.id, batchId),
    columns: { status: true },
  })
  if (batch?.status === 'confirmed' || batch?.status === 'cancelled') {
    return NextResponse.json({ error: `Cannot edit item in a ${batch.status} batch` }, { status: 409 })
  }

  const body = await req.json() as Record<string, unknown>
  const update: Record<string, unknown> = {}

  if ('title' in body) update.title = body.title ? String(body.title).slice(0, 255).trim() : item.title
  if ('complianceType' in body) {
    const t = String(body.complianceType).toUpperCase()
    update.complianceType = (VALID_COMPLIANCE_TYPES as readonly string[]).includes(t) ? t : item.complianceType
  }
  if ('dueDate' in body) {
    const d = body.dueDate ? new Date(String(body.dueDate)) : null
    update.dueDate = d && !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null
  }
  if ('status' in body) {
    const s = String(body.status)
    update.status = (VALID_STATUSES as readonly string[]).includes(s) ? s : item.status
  }
  if ('priority' in body) {
    const p = String(body.priority)
    update.priority = (VALID_PRIORITIES as readonly string[]).includes(p) ? p : item.priority
  }
  if ('departmentId' in body) {
    if (body.departmentId) {
      const dept = await db.query.departments.findFirst({ where: eq(departments.id, String(body.departmentId)), columns: { id: true, name: true } })
      if (dept) { update.departmentId = dept.id; update.departmentName = dept.name }
    } else {
      update.departmentId = null
    }
  }
  if ('assignedToId' in body) update.assignedToId = body.assignedToId ? String(body.assignedToId) : null
  if ('description' in body) update.description = body.description ? String(body.description).slice(0, 2000) : null
  if ('reviewStatus' in body) {
    const rs = String(body.reviewStatus)
    if ((VALID_REVIEW_STATUSES as readonly string[]).includes(rs)) {
      update.reviewStatus = rs
    }
  }

  // If any data field changed and reviewStatus isn't being explicitly set, mark as edited
  const dataFieldsChanged = ['title','complianceType','dueDate','status','priority','departmentId','assignedToId','description'].some(f => f in body)
  if (dataFieldsChanged && !('reviewStatus' in body)) {
    update.reviewStatus = 'edited'
  }

  await db.update(ingestionItems).set(update).where(eq(ingestionItems.id, itemId))

  // Recalculate batch approved/rejected counts
  const [counts] = await db
    .select({
      approved: sql<number>`count(*) filter (where review_status = 'approved' or review_status = 'edited')::int`,
      rejected: sql<number>`count(*) filter (where review_status = 'rejected')::int`,
    })
    .from(ingestionItems)
    .where(eq(ingestionItems.batchId, batchId))

  await db.update(ingestionBatches).set({
    approvedCount: counts.approved,
    rejectedCount: counts.rejected,
  }).where(eq(ingestionBatches.id, batchId))

  const updated = await db.query.ingestionItems.findFirst({ where: eq(ingestionItems.id, itemId) })
  return NextResponse.json({
    id: updated!.id,
    reviewStatus: updated!.reviewStatus,
    title: updated!.title,
    complianceType: updated!.complianceType,
    dueDate: updated!.dueDate,
    status: updated!.status,
    priority: updated!.priority,
    departmentId: updated!.departmentId,
    departmentName: updated!.departmentName,
    assignedToId: updated!.assignedToId,
    description: updated!.description,
  })
}
