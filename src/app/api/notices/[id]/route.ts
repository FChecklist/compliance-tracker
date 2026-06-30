import { db, notices, auditLogs, users, documents, comments } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";

const VALID_STATUSES = ['received', 'in_progress', 'replied', 'closed', 'appealed'] as const

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, context: RouteContext) {
  const { response } = await requireAuth()
  if (response) return response
  try {
    const { id } = await context.params

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

    if (!item) {
      return NextResponse.json({ error: "Notice not found" }, { status: 404 })
    }

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
        userName: log.user.name,
        createdAt: log.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error("Notice detail API error:", error)
    return NextResponse.json({ error: "Failed to fetch notice" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { response } = await requireAuth()
  if (response) return response
  try {
    const { id } = await context.params
    const body = await request.json()
    const { noticeNumber, authority, dateReceived, demandAmount, replyDeadline, status, description, assignedToId, departmentId } = body

    const existingItem = await db.query.notices.findFirst({
      where: eq(notices.id, id),
    })
    if (!existingItem) {
      return NextResponse.json({ error: "Notice not found" }, { status: 404 })
    }

    if (status !== undefined && !(VALID_STATUSES as readonly string[]).includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 })
    }

    const adminUser = await db.query.users.findFirst({ where: eq(users.role, 'admin') })
    if (!adminUser) {
      return NextResponse.json({ error: "No admin user found" }, { status: 500 })
    }

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

    const logEntries = []
    if (status !== undefined && status !== existingItem.status) {
      logEntries.push({
        action: 'status_change' as const,
        entityType: 'Notice',
        entityId: id,
        userId: adminUser.id,
        details: `Status changed from ${existingItem.status} to ${status}`,
      })
    }
    if (assignedToId !== undefined && assignedToId !== existingItem.assignedToId) {
      logEntries.push({
        action: (existingItem.assignedToId ? 'reassign' : 'assign') as 'reassign' | 'assign',
        entityType: 'Notice',
        entityId: id,
        userId: adminUser.id,
        details: existingItem.assignedToId ? 'Reassigned from previous user' : `Assigned to user ${assignedToId}`,
      })
    }
    if (noticeNumber !== undefined && noticeNumber !== existingItem.noticeNumber) {
      logEntries.push({
        action: 'update' as const,
        entityType: 'Notice',
        entityId: id,
        userId: adminUser.id,
        details: 'Notice number updated',
      })
    }
    if (logEntries.length > 0) {
      await db.insert(auditLogs).values(logEntries)
    }

    const result = await db.query.notices.findFirst({
      where: eq(notices.id, id),
      with: {
        department: { columns: { name: true } },
        assignedTo: { columns: { name: true, avatarUrl: true } },
      },
    })

    return NextResponse.json({
      id: result!.id,
      noticeNumber: result!.noticeNumber,
      authority: result!.authority,
      dateReceived: result!.dateReceived.toISOString(),
      demandAmount: result!.demandAmount ?? null,
      replyDeadline: result!.replyDeadline?.toISOString() ?? null,
      status: result!.status,
      description: result!.description,
      department: { name: result!.department.name },
      assignedTo: result!.assignedTo
        ? { name: result!.assignedTo.name, avatarUrl: result!.assignedTo.avatarUrl }
        : null,
      createdAt: result!.createdAt.toISOString(),
      updatedAt: result!.updatedAt.toISOString(),
    })
  } catch (error) {
    console.error("Notice update API error:", error)
    return NextResponse.json({ error: "Failed to update notice" }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { response } = await requireAuth()
  if (response) return response
  try {
    const { id } = await context.params

    const existingItem = await db.query.notices.findFirst({
      where: eq(notices.id, id),
    })
    if (!existingItem) {
      return NextResponse.json({ error: "Notice not found" }, { status: 404 })
    }

    const adminUser = await db.query.users.findFirst({ where: eq(users.role, 'admin') })
    if (!adminUser) {
      return NextResponse.json({ error: "No admin user found" }, { status: 500 })
    }

    await db.delete(notices).where(eq(notices.id, id))

    await db.insert(auditLogs).values({
      action: 'delete',
      entityType: 'Notice',
      entityId: id,
      userId: adminUser.id,
      details: `Deleted notice: ${existingItem.noticeNumber ?? id}`,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Notice delete API error:", error)
    return NextResponse.json({ error: "Failed to delete notice" }, { status: 500 })
  }
}