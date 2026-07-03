// Wave 11 service layer -- extracted from src/app/api/notices/{route,
// [id]/route, stats/route}.ts verbatim (behavior-identical refactor).
import { notices, departments, auditLogs, comments } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and, or, like, asc, inArray, lte, sql, type SQL } from "drizzle-orm"
import { logActivity } from "@/lib/audit"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { ServiceContext, ReadContext } from "./context"

export const VALID_NOTICE_STATUSES = ["received", "in_progress", "replied", "closed", "appealed"] as const

export type ListNoticeFilters = { search?: string; status?: string; departmentId?: string; page?: number; limit?: number }

export async function listNotices(ctx: ReadContext, filters: ListNoticeFilters) {
  const { orgId } = ctx
  const search = filters.search ?? ""
  const status = filters.status ?? ""
  const departmentId = filters.departmentId ?? ""
  const page = Math.max(1, filters.page ?? 1)
  const limit = Math.min(100, Math.max(1, filters.limit ?? 20))
  const offset = (page - 1) * limit

  const conditions: (SQL | undefined)[] = []
  conditions.push(eq(notices.orgId, orgId))
  if (search) conditions.push(or(like(notices.noticeNumber, `%${search}%`), like(notices.authority, `%${search}%`), like(notices.description, `%${search}%`)))
  if (status && (VALID_NOTICE_STATUSES as readonly string[]).includes(status)) conditions.push(eq(notices.status, status as typeof VALID_NOTICE_STATUSES[number]))
  if (departmentId) conditions.push(eq(notices.departmentId, departmentId))

  const where = and(...conditions)
  const [items, [{ count }]] = await withTenantContext({ orgId }, (db) =>
    Promise.all([
      db.query.notices.findMany({
        where: where as any,
        with: { department: { columns: { name: true } }, assignedTo: { columns: { name: true, avatarUrl: true } } },
        orderBy: asc(notices.dateReceived), limit, offset,
      }),
      db.select({ count: sql<number>`count(*)::int` }).from(notices).where(where),
    ])
  )

  return {
    notices: items.map((item) => ({
      id: item.id, noticeNumber: item.noticeNumber, authority: item.authority, dateReceived: item.dateReceived.toISOString(),
      demandAmount: item.demandAmount ?? null, replyDeadline: item.replyDeadline?.toISOString() ?? null, status: item.status,
      description: item.description, department: { name: item.department.name },
      assignedTo: item.assignedTo ? { name: item.assignedTo.name, avatarUrl: item.assignedTo.avatarUrl } : null,
      createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString(),
    })),
    total: count, page, limit, totalPages: Math.ceil(count / limit),
  }
}

export type CreateNoticeInput = {
  noticeNumber?: string; authority?: string; dateReceived: string; demandAmount?: number | string; replyDeadline?: string;
  status?: string; description?: string; departmentId: string; assignedToId?: string; complianceItemId?: string; clientId?: string
}

export async function createNotice(ctx: ServiceContext, input: CreateNoticeInput) {
  const { orgId, actor, request } = ctx
  const { noticeNumber, authority, dateReceived, demandAmount, replyDeadline, status, description, departmentId, assignedToId, complianceItemId, clientId } = input

  if (!dateReceived) throw new ServiceError("dateReceived is required", 400)
  if (!departmentId) throw new ServiceError("departmentId is required", 400)

  const userId = actor.dbUser?.id
  const result = await withTenantContext({ orgId, userId }, async (db) => {
    const dept = await db.query.departments.findFirst({ where: eq(departments.id, departmentId) })
    if (!dept) return { ok: false as const, error: "Department not found" }

    const parsedDateReceived = new Date(dateReceived)
    const parsedReplyDeadline = replyDeadline ? new Date(replyDeadline) : new Date(parsedDateReceived.getTime() + 30 * 86400000)
    const validStatus = (VALID_NOTICE_STATUSES as readonly string[]).includes(status ?? "") ? status as typeof VALID_NOTICE_STATUSES[number] : "received"

    const [notice] = await db.insert(notices).values({
      noticeNumber: noticeNumber?.trim() || null, authority: authority?.trim() || null, dateReceived: parsedDateReceived,
      demandAmount: demandAmount != null && demandAmount !== "" ? String(demandAmount) : null, replyDeadline: parsedReplyDeadline, status: validStatus, description: description?.trim() || null,
      departmentId, orgId, clientId: typeof clientId === "string" && clientId.trim() ? clientId.trim() : null,
      assignedToId: assignedToId || null, complianceItemId: complianceItemId || null,
    }).returning()

    await logActivity({
      tx: db, action: "create", entityType: "Notice", entityId: notice.id,
      details: `Created notice: ${notice.noticeNumber ?? notice.id} from ${notice.authority ?? "unknown authority"}`,
      orgId, clientId: notice.clientId, request, ...(actor.dbUser ? { dbUser: actor.dbUser } : { apiKey: actor.apiKey! }),
    })
    return { ok: true as const, notice }
  })

  if (!result.ok) throw new ServiceError(result.error, 404)
  return { id: result.notice.id, noticeNumber: result.notice.noticeNumber, status: result.notice.status }
}

export async function getNotice(ctx: ReadContext, id: string) {
  const { orgId } = ctx
  const result = await withTenantContext({ orgId }, async (db) => {
    const item = await db.query.notices.findFirst({
      where: eq(notices.id, id),
      with: {
        department: { columns: { name: true } },
        assignedTo: { columns: { name: true, avatarUrl: true } },
        complianceItem: { columns: { id: true, title: true, complianceType: true, status: true } },
        documents: { with: { uploadedBy: { columns: { name: true } } }, orderBy: (d, { desc }) => desc(d.createdAt) },
      },
    })
    if (!item) return null

    const logs = await db.query.auditLogs.findMany({
      where: and(eq(auditLogs.entityId, id), eq(auditLogs.entityType, "Notice")),
      with: { user: { columns: { name: true } } }, orderBy: (l, { desc }) => desc(l.createdAt),
    })
    const noticeComments = await db.query.comments.findMany({
      where: and(eq(comments.entityId, id), eq(comments.entityType, "notice")),
      with: { author: { columns: { name: true, avatarUrl: true } } }, orderBy: (c, { desc }) => desc(c.createdAt),
    })
    return { item, logs, noticeComments }
  })

  if (!result) throw new ServiceError("Notice not found", 404)
  const { item, logs, noticeComments } = result

  return {
    item: {
      id: item.id, noticeNumber: item.noticeNumber, authority: item.authority, dateReceived: item.dateReceived.toISOString(),
      demandAmount: item.demandAmount ?? null, replyDeadline: item.replyDeadline?.toISOString() ?? null, status: item.status,
      description: item.description, departmentId: item.departmentId, department: { name: item.department.name },
      assignedTo: item.assignedTo ? { name: item.assignedTo.name, avatarUrl: item.assignedTo.avatarUrl } : null,
      complianceItem: item.complianceItem ? { id: item.complianceItem.id, title: item.complianceItem.title, complianceType: item.complianceItem.complianceType, status: item.complianceItem.status } : null,
      createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString(),
    },
    documents: item.documents.map((doc) => ({ id: doc.id, name: doc.name, fileType: doc.fileType, fileSize: doc.fileSize, uploadedBy: { name: doc.uploadedBy.name }, createdAt: doc.createdAt.toISOString() })),
    comments: noticeComments.map((c) => ({ id: c.id, content: c.content, author: { name: c.author.name, avatarUrl: c.author.avatarUrl }, createdAt: c.createdAt.toISOString() })),
    auditLogs: logs.map((log) => ({ id: log.id, action: log.action, entityType: log.entityType, entityId: log.entityId, details: log.details, userName: log.user?.name ?? log.actorName, createdAt: log.createdAt.toISOString() })),
  }
}

export type UpdateNoticeInput = Partial<Omit<CreateNoticeInput, "departmentId">> & { departmentId?: string }

export async function updateNotice(ctx: ServiceContext, id: string, input: UpdateNoticeInput) {
  const { orgId, actor, request } = ctx
  const { noticeNumber, authority, dateReceived, demandAmount, replyDeadline, status, description, assignedToId, departmentId } = input

  if (status !== undefined && !(VALID_NOTICE_STATUSES as readonly string[]).includes(status)) throw new ServiceError("Invalid status", 400)

  const userId = actor.dbUser?.id
  const result = await withTenantContext({ orgId, userId }, async (db) => {
    const existingItem = await db.query.notices.findFirst({ where: eq(notices.id, id) })
    if (!existingItem) return { ok: false as const, error: "Notice not found" }

    const updateData: Record<string, any> = {}
    if (noticeNumber !== undefined) updateData.noticeNumber = noticeNumber?.trim() || null
    if (authority !== undefined) updateData.authority = authority?.trim() || null
    if (dateReceived !== undefined) {
      if (dateReceived === null) updateData.dateReceived = null
      else { const parsed = new Date(dateReceived); if (!isNaN(parsed.getTime())) updateData.dateReceived = parsed }
    }
    if (demandAmount !== undefined) updateData.demandAmount = demandAmount ?? null
    if (replyDeadline !== undefined) {
      if (replyDeadline === null) updateData.replyDeadline = null
      else { const parsed = new Date(replyDeadline); if (!isNaN(parsed.getTime())) updateData.replyDeadline = parsed }
    }
    if (status !== undefined) updateData.status = status
    if (description !== undefined) updateData.description = description?.trim() || null
    if (assignedToId !== undefined) updateData.assignedToId = assignedToId || null
    if (departmentId !== undefined) updateData.departmentId = departmentId

    await db.update(notices).set(updateData).where(eq(notices.id, id))

    const actorParam = actor.dbUser ? { dbUser: actor.dbUser } : { apiKey: actor.apiKey! }
    const logChange = (action: string, details: string) => logActivity({ tx: db, action, entityType: "Notice", entityId: id, details, orgId, clientId: existingItem.clientId, request, ...actorParam })
    if (status !== undefined && status !== existingItem.status) await logChange("status_change", `Status changed from ${existingItem.status} to ${status}`)
    if (assignedToId !== undefined && assignedToId !== existingItem.assignedToId) {
      await logChange(existingItem.assignedToId ? "reassign" : "assign", existingItem.assignedToId ? "Reassigned from previous user" : `Assigned to user ${assignedToId}`)
    }
    if (noticeNumber !== undefined && noticeNumber !== existingItem.noticeNumber) await logChange("update", "Notice number updated")

    const updated = await db.query.notices.findFirst({
      where: eq(notices.id, id),
      with: { department: { columns: { name: true } }, assignedTo: { columns: { name: true, avatarUrl: true } } },
    })
    return { ok: true as const, updated: updated! }
  })

  if (!result.ok) throw new ServiceError(result.error, 404)
  const item = result.updated
  return {
    id: item.id, noticeNumber: item.noticeNumber, authority: item.authority, dateReceived: item.dateReceived.toISOString(),
    demandAmount: item.demandAmount ?? null, replyDeadline: item.replyDeadline?.toISOString() ?? null, status: item.status,
    description: item.description, department: { name: item.department.name },
    assignedTo: item.assignedTo ? { name: item.assignedTo.name, avatarUrl: item.assignedTo.avatarUrl } : null,
    createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString(),
  }
}

export async function deleteNotice(ctx: ServiceContext, id: string) {
  const { orgId, actor, request } = ctx
  const userId = actor.dbUser?.id
  const result = await withTenantContext({ orgId, userId }, async (db) => {
    const existingItem = await db.query.notices.findFirst({ where: eq(notices.id, id) })
    if (!existingItem) return null
    await db.delete(notices).where(eq(notices.id, id))
    await logActivity({
      tx: db, action: "delete", entityType: "Notice", entityId: id, details: `Deleted notice: ${existingItem.noticeNumber ?? id}`,
      orgId, clientId: existingItem.clientId, request, ...(actor.dbUser ? { dbUser: actor.dbUser } : { apiKey: actor.apiKey! }),
    })
    return true
  })
  if (!result) throw new ServiceError("Notice not found", 404)
  return { success: true }
}

export async function getNoticeStats(ctx: ReadContext) {
  const { orgId } = ctx
  const now = new Date()
  const orgFilter = eq(notices.orgId, orgId)

  const [total, received, inProgress, replied, closed, appealed, overdue] = await withTenantContext({ orgId }, (db) =>
    Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(notices).where(orgFilter).then(r => r[0].count),
      db.select({ count: sql<number>`count(*)::int` }).from(notices).where(and(orgFilter, eq(notices.status, "received"))).then(r => r[0].count),
      db.select({ count: sql<number>`count(*)::int` }).from(notices).where(and(orgFilter, eq(notices.status, "in_progress"))).then(r => r[0].count),
      db.select({ count: sql<number>`count(*)::int` }).from(notices).where(and(orgFilter, eq(notices.status, "replied"))).then(r => r[0].count),
      db.select({ count: sql<number>`count(*)::int` }).from(notices).where(and(orgFilter, eq(notices.status, "closed"))).then(r => r[0].count),
      db.select({ count: sql<number>`count(*)::int` }).from(notices).where(and(orgFilter, eq(notices.status, "appealed"))).then(r => r[0].count),
      db.select({ count: sql<number>`count(*)::int` }).from(notices)
        .where(and(orgFilter, lte(notices.replyDeadline, now), inArray(notices.status, ["received", "in_progress"])))
        .then(r => r[0].count),
    ])
  )

  return { total, pendingReplies: received + inProgress, overdue, replied, closed, appealed, received, inProgress }
}
