import { notices, auditLogs, comments } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { logActivity } from "@/lib/audit";

const VALID_STATUSES = ['received', 'in_progress', 'replied', 'closed', 'appealed'] as const

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, context: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await context.params

    const result = await withTenantContext({ orgId }, async (db) => {
      const item = await db.query.notices.findFirst({
        where: eq(notices.id, id),
        with: {
          department: { columns: { name: true } },
          assignedTo: { columns: { name: true, avatarUrl: true } },
          complianceItem: { columns: { id: true, title: true, complianceType: true, status: true } },
          documents: {
            with: { uploadedBy: { columns: { name: true } } },
            orderBy: (d, { desc }) => desc(d.createdAt),
          },
        },
      })
      if (!item) return null

      const logs = await db.query.auditLogs.findMany({
        where: and(eq(auditLogs.entityId, id), eq(auditLogs.entityType, 'Notice')),
        with: { user: { columns: { name: true } } },
        orderBy: (l, { desc }) => desc(l.createdAt),
      })

      const noticeComments = await db.query.comments.findMany({
        where: and(eq(comments.entityId, id), eq(comments.entityType, 'notice')),
        with: { author: { columns: { name: true, avatarUrl: true } } },
        orderBy: (c, { desc }) => desc(c.createdAt),
      })

      return { item, logs, noticeComments }
    })

    if (!result) return NextResponse.json({ error: "Notice not found" }, { status: 404 })
    const { item, logs, noticeComments } = result

    return NextResponse.json({
      item: {
        id: item.id,
        noticeNumber: item.noticeNumber,
        authority: item.authority,
        dateReceived: item.dateReceived.toISOString(),
        demandAmount: item.demandAmount ?? null,
        replyDeadline: item.replyDeadline?.toISOString() ?? null,
        status: item.status,
        description: item.description,
        departmentId: item.departmentId,
        department: { name: item.department.name },
        assignedTo: item.assignedTo
          ? { name: item.assignedTo.name, avatarUrl: item.assignedTo.avatarUrl }
          : null,
        complianceItem: item.complianceItem
          ? { id: item.complianceItem.id, title: item.complianceItem.title, complianceType: item.complianceItem.complianceType, status: item.complianceItem.status }
          : null,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      },
      documents: item.documents.map((doc) => ({
        id: doc.id,
        name: doc.name,
        fileType: doc.fileType,
        fileSize: doc.fileSize,
        uploadedBy: { name: doc.uploadedBy.name },
        createdAt: doc.createdAt.toISOString(),
      })),
      comments: noticeComments.map((c) => ({
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
    console.error("Notice detail API error:", error)
    return NextResponse.json({ error: "Failed to fetch notice" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await context.params
    const body = await request.json()
    const { noticeNumber, authority, dateReceived, demandAmount, replyDeadline, status, description, assignedToId, departmentId } = body

    if (status !== undefined && !(VALID_STATUSES as readonly string[]).includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 })
    }

    const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
      const existingItem = await db.query.notices.findFirst({
        where: eq(notices.id, id),
      })
      if (!existingItem) return { error: "Notice not found", status: 404 as const }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateData: Record<string, any> = {}
      if (noticeNumber !== undefined) updateData.noticeNumber = noticeNumber?.trim() || null
      if (authority !== undefined) updateData.authority = authority?.trim() || null
      if (dateReceived !== undefined) {
        if (dateReceived === null) updateData.dateReceived = null
        else {
          const parsed = new Date(dateReceived)
          if (!isNaN(parsed.getTime())) updateData.dateReceived = parsed
        }
      }
      if (demandAmount !== undefined) updateData.demandAmount = demandAmount ?? null
      if (replyDeadline !== undefined) {
        if (replyDeadline === null) updateData.replyDeadline = null
        else {
          const parsed = new Date(replyDeadline)
          if (!isNaN(parsed.getTime())) updateData.replyDeadline = parsed
        }
      }
      if (status !== undefined) updateData.status = status
      if (description !== undefined) updateData.description = description?.trim() || null
      if (assignedToId !== undefined) updateData.assignedToId = assignedToId || null
      if (departmentId !== undefined) updateData.departmentId = departmentId

      await db.update(notices).set(updateData).where(eq(notices.id, id))

      const logChange = (action: string, details: string) => logActivity({
        tx: db, action, entityType: 'Notice', entityId: id, details,
        orgId, clientId: existingItem.clientId, dbUser, request,
      })
      if (status !== undefined && status !== existingItem.status) {
        await logChange('status_change', `Status changed from ${existingItem.status} to ${status}`)
      }
      if (assignedToId !== undefined && assignedToId !== existingItem.assignedToId) {
        await logChange(existingItem.assignedToId ? 'reassign' : 'assign', existingItem.assignedToId ? 'Reassigned from previous user' : `Assigned to user ${assignedToId}`)
      }
      if (noticeNumber !== undefined && noticeNumber !== existingItem.noticeNumber) {
        await logChange('update', 'Notice number updated')
      }

      const updated = await db.query.notices.findFirst({
        where: eq(notices.id, id),
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
      noticeNumber: item.noticeNumber,
      authority: item.authority,
      dateReceived: item.dateReceived.toISOString(),
      demandAmount: item.demandAmount ?? null,
      replyDeadline: item.replyDeadline?.toISOString() ?? null,
      status: item.status,
      description: item.description,
      department: { name: item.department.name },
      assignedTo: item.assignedTo
        ? { name: item.assignedTo.name, avatarUrl: item.assignedTo.avatarUrl }
        : null,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    })
  } catch (error) {
    console.error("Notice update API error:", error)
    return NextResponse.json({ error: "Failed to update notice" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await context.params

    const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
      const existingItem = await db.query.notices.findFirst({
        where: eq(notices.id, id),
      })
      if (!existingItem) return null

      await db.delete(notices).where(eq(notices.id, id))

      await logActivity({
        tx: db,
        action: 'delete',
        entityType: 'Notice',
        entityId: id,
        details: `Deleted notice: ${existingItem.noticeNumber ?? id}`,
        orgId,
        clientId: existingItem.clientId,
        dbUser,
        request,
      })
      return true
    })

    if (!result) return NextResponse.json({ error: "Notice not found" }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Notice delete API error:", error)
    return NextResponse.json({ error: "Failed to delete notice" }, { status: 500 })
  }
}
