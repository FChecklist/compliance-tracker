import { db } from '@/lib/db'
import { complianceItems, auditLogs, users } from '@/lib/db/schema'
import { NextRequest, NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'

const VALID_STATUSES = ['pending','in_progress','completed','overdue','not_applicable','draft'] as const
const VALID_PRIORITIES = ['low','medium','high','critical'] as const
type ComplianceStatus = typeof VALID_STATUSES[number]
type Priority = typeof VALID_PRIORITIES[number]
type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const { id } = await ctx.params

    const item = await db.query.complianceItems.findFirst({
      where: (f, { eq }) => eq(f.id, id),
      with: {
        department: { columns: { name: true } },
        assignedTo: { columns: { name: true, avatarUrl: true } },
        auditPoints: { with: { assignedTo: { columns: { name: true } } }, orderBy: (f, { asc }) => asc(f.createdAt) },
        documents: { with: { uploadedBy: { columns: { name: true } } }, orderBy: (f, { desc }) => desc(f.createdAt) },
        comments: { with: { author: { columns: { name: true, avatarUrl: true } } }, orderBy: (f, { desc }) => desc(f.createdAt) },
      },
    })
    if (!item) return NextResponse.json({ error: 'Compliance item not found' }, { status: 404 })

    const logs = await db.query.auditLogs.findMany({
      where: (f, { eq, and }) => and(eq(f.entityId, id), eq(f.entityType, 'ComplianceItem')),
      with: { user: { columns: { name: true } } },
      orderBy: (f, { desc }) => desc(f.createdAt),
    })

    return NextResponse.json({
      item: {
        id: item.id, title: item.title, description: item.description,
        complianceType: item.complianceType, status: item.status, priority: item.priority,
        dueDate: item.dueDate?.toISOString(), completedAt: item.completedAt?.toISOString(),
        departmentId: item.departmentId, department: { name: item.department.name },
        assignedTo: item.assignedTo ? { name: item.assignedTo.name, avatarUrl: item.assignedTo.avatarUrl } : null,
        createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString(),
      },
      auditPoints: item.auditPoints.map(ap => ({ id: ap.id, title: ap.title, description: ap.description, status: ap.status, dueDate: ap.dueDate?.toISOString(), completedAt: ap.completedAt?.toISOString(), assignedTo: ap.assignedTo ? { name: ap.assignedTo.name } : null, createdAt: ap.createdAt.toISOString() })),
      documents: item.documents.map(d => ({ id: d.id, name: d.name, fileUrl: d.fileUrl, fileType: d.fileType, fileSize: d.fileSize, uploadedBy: { name: d.uploadedBy.name }, createdAt: d.createdAt.toISOString() })),
      comments: item.comments.map(c => ({ id: c.id, content: c.content, author: { name: c.author.name, avatarUrl: c.author.avatarUrl }, createdAt: c.createdAt.toISOString() })),
      auditLogs: logs.map(l => ({ id: l.id, action: l.action, entityType: l.entityType, entityId: l.entityId, details: l.details, userName: l.user.name, createdAt: l.createdAt.toISOString() })),
    })
  } catch (error) {
    console.error('Compliance detail API error:', error)
    return NextResponse.json({ error: 'Failed to fetch compliance item' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, ctx: RouteContext) {
  try {
    const { id } = await ctx.params
    const body = await request.json()
    const { title, description, status, priority, dueDate, assignedToId } = body

    const existing = await db.query.complianceItems.findFirst({ where: (f, { eq }) => eq(f.id, id) })
    if (!existing) return NextResponse.json({ error: 'Compliance item not found' }, { status: 404 })

    if (status !== undefined && !VALID_STATUSES.includes(status)) return NextResponse.json({ error: `Invalid status` }, { status: 400 })
    if (priority !== undefined && !VALID_PRIORITIES.includes(priority)) return NextResponse.json({ error: `Invalid priority` }, { status: 400 })

    const [adminUser] = await db.query.users.findMany({ where: (f, { eq }) => eq(f.role, 'admin'), limit: 1 })
    if (!adminUser) return NextResponse.json({ error: 'No admin user found' }, { status: 500 })

    const updateData: Partial<typeof complianceItems.$inferInsert> = {}
    if (title !== undefined) updateData.title = title.trim()
    if (description !== undefined) updateData.description = description
    if (priority !== undefined) updateData.priority = priority
    if (dueDate !== undefined) updateData.dueDate = dueDate ? new Date(dueDate) : null as unknown as Date
    if (assignedToId !== undefined) updateData.assignedToId = assignedToId || null
    if (status !== undefined) { updateData.status = status; if (status === 'completed') updateData.completedAt = new Date() }

    const [updatedItem] = await db.transaction(async tx => {
      const [updated] = await tx.update(complianceItems).set(updateData).where(eq(complianceItems.id, id)).returning()
      if (status !== undefined && status !== existing.status) {
        await tx.insert(auditLogs).values({ action: 'status_change', entityType: 'ComplianceItem', entityId: id, userId: adminUser.id, details: `Status changed from ${existing.status} to ${status}` })
      }
      if (assignedToId !== undefined && assignedToId !== existing.assignedToId) {
        await tx.insert(auditLogs).values({ action: existing.assignedToId ? 'reassign' : 'assign', entityType: 'ComplianceItem', entityId: id, userId: adminUser.id, details: existing.assignedToId ? 'Reassigned' : `Assigned to ${assignedToId}` })
      }
      if (title !== undefined && title !== existing.title) {
        await tx.insert(auditLogs).values({ action: 'update', entityType: 'ComplianceItem', entityId: id, userId: adminUser.id, details: 'Title updated' })
      }
      return [updated]
    })

    const result = await db.query.complianceItems.findFirst({
      where: (f, { eq }) => eq(f.id, id),
      with: { department: { columns: { name: true } }, assignedTo: { columns: { name: true, avatarUrl: true } } },
    })

    return NextResponse.json({ id: result!.id, title: result!.title, description: result!.description, complianceType: result!.complianceType, status: result!.status, priority: result!.priority, dueDate: result!.dueDate?.toISOString(), department: { name: result!.department.name }, assignedTo: result!.assignedTo ? { name: result!.assignedTo.name, avatarUrl: result!.assignedTo.avatarUrl } : null, createdAt: result!.createdAt.toISOString(), updatedAt: result!.updatedAt.toISOString() })
  } catch (error) {
    console.error('Compliance update API error:', error)
    return NextResponse.json({ error: 'Failed to update compliance item' }, { status: 500 })
  }
}