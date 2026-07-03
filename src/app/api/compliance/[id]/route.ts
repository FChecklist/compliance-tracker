import { complianceItems, auditLogs, users } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard";
import { logActivity } from "@/lib/audit";
import { notifyAssigned } from "@/lib/email";

const VALID_STATUSES = ['pending', 'in_progress', 'completed', 'overdue', 'not_applicable', 'draft'] as const
const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, context: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await context.params

    const result = await withTenantContext({ orgId }, async (db) => {
      const item = await db.query.complianceItems.findFirst({
        where: eq(complianceItems.id, id),
        with: {
          department: { columns: { name: true } },
          assignedTo: { columns: { name: true, avatarUrl: true } },
          auditPoints: {
            with: { assignedTo: { columns: { name: true } } },
            orderBy: (ap, { asc }) => asc(ap.createdAt),
          },
          documents: {
            with: { uploadedBy: { columns: { name: true } } },
            orderBy: (d, { desc }) => desc(d.createdAt),
          },
          comments: {
            with: { author: { columns: { name: true, avatarUrl: true } } },
            orderBy: (c, { desc }) => desc(c.createdAt),
          },
        },
      })
      if (!item) return null

      const logs = await db.query.auditLogs.findMany({
        where: and(eq(auditLogs.entityId, id), eq(auditLogs.entityType, 'ComplianceItem')),
        with: { user: { columns: { name: true } } },
        orderBy: (l, { desc }) => desc(l.createdAt),
      })

      return { item, logs }
    })

    if (!result) {
      return NextResponse.json({ error: "Compliance item not found" }, { status: 404 })
    }
    const { item, logs } = result

    return NextResponse.json({
      item: {
        id: item.id,
        title: item.title,
        description: item.description,
        complianceType: item.complianceType,
        status: item.status,
        priority: item.priority,
        dueDate: item.dueDate?.toISOString(),
        completedAt: item.completedAt?.toISOString(),
        filedDate: item.filedDate?.toISOString() ?? null,
        paidDate: item.paidDate?.toISOString() ?? null,
        period: item.period ?? null,
        financialYear: item.financialYear ?? null,
        acknowledgementNumber: item.acknowledgementNumber ?? null,
        registrationNumber: item.registrationNumber ?? null,
        amount: item.amount ?? null,
        recurrenceType: item.recurrenceType,
        recurrenceParentId: item.recurrenceParentId ?? null,
        isTemplateSuggested: item.isTemplateSuggested,
        departmentId: item.departmentId,
        department: { name: item.department.name },
        assignedTo: item.assignedTo
          ? { name: item.assignedTo.name, avatarUrl: item.assignedTo.avatarUrl }
          : null,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      },
      auditPoints: item.auditPoints.map((ap) => ({
        id: ap.id,
        title: ap.title,
        description: ap.description,
        status: ap.status,
        dueDate: ap.dueDate?.toISOString(),
        completedAt: ap.completedAt?.toISOString(),
        assignedTo: ap.assignedTo ? { name: ap.assignedTo.name } : null,
        createdAt: ap.createdAt.toISOString(),
      })),
      documents: item.documents.map((doc) => ({
        id: doc.id,
        name: doc.name,
        fileUrl: doc.fileUrl,
        fileType: doc.fileType,
        fileSize: doc.fileSize,
        uploadedBy: { name: doc.uploadedBy.name },
        createdAt: doc.createdAt.toISOString(),
      })),
      comments: item.comments.map((c) => ({
        id: c.id,
        content: c.content,
        author: { name: c.author.name, avatarUrl: c.author.avatarUrl },
        createdAt: c.createdAt.toISOString(),
      })),
      auditLogs: logs.map((log) => ({
        id: log.id,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        details: log.details,
        userName: log.user?.name ?? log.actorName,
        createdAt: log.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error("Compliance detail API error:", error)
    return NextResponse.json({ error: "Failed to fetch compliance item" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, 'member')
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await context.params
    const body = await request.json()
    const { title, description, status, priority, dueDate, assignedToId, period, financialYear, acknowledgementNumber, registrationNumber, amount, filedDate, paidDate, complianceType, departmentId } = body

    if (status !== undefined && !(VALID_STATUSES as readonly string[]).includes(status)) {
      return NextResponse.json({ error: `Invalid status` }, { status: 400 })
    }
    if (priority !== undefined && !(VALID_PRIORITIES as readonly string[]).includes(priority)) {
      return NextResponse.json({ error: `Invalid priority` }, { status: 400 })
    }

    const VALID_TYPES = ['GST', 'TDS', 'MCA', 'PF', 'ESIC', 'INCOME_TAX', 'ROC', 'LABOUR', 'ENVIRONMENTAL', 'OTHER'] as const

    const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
      const existingItem = await db.query.complianceItems.findFirst({
        where: eq(complianceItems.id, id),
      })
      if (!existingItem) return { error: "Compliance item not found", status: 404 as const }

      const updateData: Record<string, unknown> = {}
      if (title !== undefined && typeof title === "string") updateData.title = title.trim()
      if (complianceType !== undefined && (VALID_TYPES as readonly string[]).includes(complianceType)) updateData.complianceType = complianceType
      if (departmentId !== undefined && typeof departmentId === "string" && departmentId.trim()) updateData.departmentId = departmentId.trim()
      if (description !== undefined) updateData.description = description
      if (priority !== undefined) updateData.priority = priority
      if (dueDate !== undefined) {
        if (dueDate === null) updateData.dueDate = null
        else {
          const parsed = new Date(dueDate)
          if (!isNaN(parsed.getTime())) updateData.dueDate = parsed
        }
      }
      if (assignedToId !== undefined) updateData.assignedToId = assignedToId || null
      if (period !== undefined) updateData.period = typeof period === 'string' && period.trim() ? period.trim() : null
      if (financialYear !== undefined) updateData.financialYear = typeof financialYear === 'string' && financialYear.trim() ? financialYear.trim() : null
      if (acknowledgementNumber !== undefined) updateData.acknowledgementNumber = typeof acknowledgementNumber === 'string' && acknowledgementNumber.trim() ? acknowledgementNumber.trim() : null
      if (registrationNumber !== undefined) updateData.registrationNumber = typeof registrationNumber === 'string' && registrationNumber.trim() ? registrationNumber.trim() : null
      if (amount !== undefined) updateData.amount = amount != null && amount !== '' ? String(amount) : null
      if (filedDate !== undefined) updateData.filedDate = filedDate ? new Date(filedDate) : null
      if (paidDate !== undefined) updateData.paidDate = paidDate ? new Date(paidDate) : null
      if (status !== undefined) {
        updateData.status = status
        if (status === "completed") updateData.completedAt = new Date()
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await db.update(complianceItems).set(updateData as any).where(eq(complianceItems.id, id))

      const logChange = (action: string, details: string) => logActivity({
        tx: db, action, entityType: 'ComplianceItem', entityId: id, details,
        orgId, clientId: existingItem.clientId, dbUser, request,
      })
      if (status !== undefined && status !== existingItem.status) {
        await logChange('status_change', `Status changed from ${existingItem.status} to ${status}`)
      }
      if (assignedToId !== undefined && assignedToId !== existingItem.assignedToId) {
        await logChange(existingItem.assignedToId ? 'reassign' : 'assign', existingItem.assignedToId ? 'Reassigned from previous user' : `Assigned to user ${assignedToId}`)
      }
      if (title !== undefined && title !== existingItem.title) {
        await logChange('update', 'Title updated')
      }

      // Send assignment email when item is (re)assigned
      if (assignedToId && assignedToId !== existingItem.assignedToId) {
        const assignee = await db.query.users.findFirst({ where: eq(users.id, assignedToId) })
        if (assignee?.email) {
          notifyAssigned(assignee.email, assignee.name, existingItem.title, id).catch(() => {})
        }
      }

      const updated = await db.query.complianceItems.findFirst({
        where: eq(complianceItems.id, id),
        with: {
          department: { columns: { name: true } },
          assignedTo: { columns: { name: true, avatarUrl: true } },
        },
      })

      return { updated: updated! }
    })

    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status })
    const item = result.updated

    return NextResponse.json({
      id: item.id,
      title: item.title,
      description: item.description,
      complianceType: item.complianceType,
      status: item.status,
      priority: item.priority,
      dueDate: item.dueDate?.toISOString(),
      department: { name: item.department.name },
      assignedTo: item.assignedTo
        ? { name: item.assignedTo.name, avatarUrl: item.assignedTo.avatarUrl }
        : null,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    })
  } catch (error) {
    console.error("Compliance update API error:", error)
    return NextResponse.json({ error: "Failed to update compliance item" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (dbUser?.role === 'viewer' || dbUser?.role === 'member') {
    return NextResponse.json({ error: "Insufficient permissions to delete compliance items" }, { status: 403 })
  }
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await context.params

    const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
      const item = await db.query.complianceItems.findFirst({
        where: and(eq(complianceItems.id, id), eq(complianceItems.orgId, orgId)),
      })
      if (!item) return null

      await db.delete(complianceItems).where(eq(complianceItems.id, id))

      await logActivity({
        tx: db,
        action: 'delete',
        entityType: 'ComplianceItem',
        entityId: id,
        details: `Deleted compliance item: ${item.title}`,
        orgId,
        clientId: item.clientId,
        dbUser,
        request,
      })
      return true
    })

    if (!result) return NextResponse.json({ error: "Compliance item not found" }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Compliance delete API error:", error)
    return NextResponse.json({ error: "Failed to delete compliance item" }, { status: 500 })
  }
}
