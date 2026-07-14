// Wave 11 service layer -- extracted from src/app/api/compliance/{route,
// [id]/route, stats/route, overdue/route}.ts verbatim (behavior-identical
// refactor, not a rewrite) so the web app, /api/v1, and MCP tools can all
// call the same real implementation instead of three/four reimplementations.
import { complianceItems, departments, auditLogs, notices, users, notifications } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and, or, like, asc, desc, not, inArray, gte, lte, lt, sql, type SQL } from "drizzle-orm"
import { logActivity } from "@/lib/audit"
import { notifyAssigned } from "@/lib/email"
import { checkAndUnlockAchievements } from "./veri-reward-service"
import type { ServiceContext, ReadContext } from "./context"

export const VALID_STATUSES = ["pending", "in_progress", "completed", "overdue", "not_applicable", "draft"] as const
export const VALID_PRIORITIES = ["low", "medium", "high", "critical"] as const
export const VALID_TYPES = ["GST", "TDS", "MCA", "PF", "ESIC", "INCOME_TAX", "ROC", "LABOUR", "ENVIRONMENTAL", "OTHER"] as const
export const VALID_RECURRENCE = ["none", "monthly", "quarterly", "half_yearly", "annually"] as const
const SORTABLE_FIELDS = ["dueDate", "createdAt", "title"] as const
type SortField = (typeof SORTABLE_FIELDS)[number]

export type ListComplianceFilters = {
  search?: string
  status?: string
  departmentId?: string
  complianceType?: string
  sortBy?: string
  page?: number
  limit?: number
}

export class ServiceError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

export async function listComplianceItems(ctx: ReadContext, filters: ListComplianceFilters) {
  const { orgId } = ctx
  const search = filters.search ?? ""
  const status = filters.status ?? ""
  const departmentId = filters.departmentId ?? ""
  const complianceType = filters.complianceType ?? ""
  const sortBy = (filters.sortBy ?? "dueDate") as SortField
  const page = Math.max(1, filters.page ?? 1)
  const limit = Math.min(100, Math.max(1, filters.limit ?? 20))
  const offset = (page - 1) * limit

  const conditions: (SQL | undefined)[] = []
  conditions.push(eq(complianceItems.orgId, orgId))
  if (search) {
    conditions.push(or(
      like(complianceItems.title, `%${search}%`),
      like(complianceItems.description, `%${search}%`),
    ))
  }
  if (status && (VALID_STATUSES as readonly string[]).includes(status)) {
    conditions.push(eq(complianceItems.status, status as typeof VALID_STATUSES[number]))
  }
  if (departmentId) conditions.push(eq(complianceItems.departmentId, departmentId))
  if (complianceType && (VALID_TYPES as readonly string[]).includes(complianceType)) {
    conditions.push(eq(complianceItems.complianceType, complianceType as typeof VALID_TYPES[number]))
  }

  const where = and(...conditions)
  const safeSortBy = SORTABLE_FIELDS.includes(sortBy) ? sortBy : "dueDate"
  const orderCol = safeSortBy === "dueDate" ? complianceItems.dueDate
    : safeSortBy === "title" ? complianceItems.title
    : complianceItems.createdAt

  const [items, [{ count }]] = await withTenantContext({ orgId }, (db) =>
    Promise.all([
      db.query.complianceItems.findMany({
        where: where as any,
        with: {
          department: { columns: { name: true } },
          assignedTo: { columns: { name: true, avatarUrl: true } },
        },
        orderBy: asc(orderCol),
        limit,
        offset,
      }),
      db.select({ count: sql<number>`count(*)::int` }).from(complianceItems).where(where),
    ])
  )

  return {
    compliance: items.map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      complianceType: item.complianceType,
      status: item.status,
      priority: item.priority,
      dueDate: item.dueDate?.toISOString(),
      period: item.period ?? null,
      acknowledgementNumber: item.acknowledgementNumber ?? null,
      department: { name: item.department.name },
      assignedTo: item.assignedTo ? { name: item.assignedTo.name, avatarUrl: item.assignedTo.avatarUrl } : null,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    })),
    total: count,
    page,
    limit,
    totalPages: Math.ceil(count / limit),
  }
}

export type CreateComplianceInput = {
  title: string
  description?: string
  complianceType: string
  priority?: string
  dueDate: string
  departmentId: string
  assignedToId?: string
  period?: string
  financialYear?: string
  acknowledgementNumber?: string
  registrationNumber?: string
  amount?: string | number
  filedDate?: string
  paidDate?: string
  recurrenceType?: string
  clientId?: string
}

export async function createComplianceItem(ctx: ServiceContext, input: CreateComplianceInput) {
  const { orgId, actor, request } = ctx
  const { title, description, complianceType, priority, dueDate, departmentId, assignedToId,
    period, financialYear, acknowledgementNumber, registrationNumber, amount, filedDate, paidDate,
    recurrenceType, clientId } = input

  if (!title || title.trim().length === 0) throw new ServiceError("Title is required", 400)
  if (!complianceType) throw new ServiceError("complianceType is required", 400)
  if (!departmentId) throw new ServiceError("departmentId is required", 400)
  const parsedDueDate = dueDate ? new Date(dueDate) : null
  if (!parsedDueDate || isNaN(parsedDueDate.getTime())) throw new ServiceError("A valid dueDate is required", 400)

  const userId = actor.dbUser?.id
  const result = await withTenantContext({ orgId, userId }, async (db) => {
    const dept = await db.query.departments.findFirst({ where: eq(departments.id, departmentId) })
    if (!dept) return { ok: false as const, error: "Department not found" }

    const [item] = await db.insert(complianceItems).values({
      title: title.trim(),
      description: description?.trim() || null,
      complianceType: complianceType.trim() as typeof VALID_TYPES[number],
      priority: (VALID_PRIORITIES as readonly string[]).includes(priority ?? "") ? priority as typeof VALID_PRIORITIES[number] : "medium",
      dueDate: parsedDueDate,
      departmentId,
      orgId,
      clientId: typeof clientId === "string" && clientId.trim() ? clientId.trim() : null,
      assignedToId: assignedToId || null,
      period: typeof period === "string" && period.trim() ? period.trim() : null,
      financialYear: typeof financialYear === "string" && financialYear.trim() ? financialYear.trim() : null,
      acknowledgementNumber: typeof acknowledgementNumber === "string" && acknowledgementNumber.trim() ? acknowledgementNumber.trim() : null,
      registrationNumber: typeof registrationNumber === "string" && registrationNumber.trim() ? registrationNumber.trim() : null,
      amount: amount != null && amount !== "" ? String(amount) : null,
      filedDate: filedDate ? new Date(filedDate) : null,
      paidDate: paidDate ? new Date(paidDate) : null,
      recurrenceType: (VALID_RECURRENCE as readonly string[]).includes(recurrenceType ?? "") ? recurrenceType as typeof VALID_RECURRENCE[number] : "none",
    }).returning()

    await logActivity({
      tx: db, action: "create", entityType: "ComplianceItem", entityId: item.id,
      details: `Created compliance item: ${item.title}`, orgId, clientId: item.clientId,
      request, ...(actor.dbUser ? { dbUser: actor.dbUser } : { apiKey: actor.apiKey! }),
    })

    return { ok: true as const, item }
  })

  if (!result.ok) throw new ServiceError(result.error, 404)
  return { id: result.item.id, title: result.item.title, status: result.item.status }
}

export async function getComplianceItem(ctx: ReadContext, id: string) {
  const { orgId } = ctx
  const result = await withTenantContext({ orgId }, async (db) => {
    const item = await db.query.complianceItems.findFirst({
      where: eq(complianceItems.id, id),
      with: {
        department: { columns: { name: true } },
        assignedTo: { columns: { name: true, avatarUrl: true } },
        auditPoints: { with: { assignedTo: { columns: { name: true } } }, orderBy: (ap, { asc }) => asc(ap.createdAt) },
        documents: { with: { uploadedBy: { columns: { name: true } } }, orderBy: (d, { desc }) => desc(d.createdAt) },
        comments: { with: { author: { columns: { name: true, avatarUrl: true } } }, orderBy: (c, { desc }) => desc(c.createdAt) },
      },
    })
    if (!item) return null

    const logs = await db.query.auditLogs.findMany({
      where: and(eq(auditLogs.entityId, id), eq(auditLogs.entityType, "ComplianceItem")),
      with: { user: { columns: { name: true } } },
      orderBy: (l, { desc }) => desc(l.createdAt),
    })

    return { item, logs }
  })

  if (!result) throw new ServiceError("Compliance item not found", 404)
  const { item, logs } = result

  return {
    item: {
      id: item.id, title: item.title, description: item.description, complianceType: item.complianceType,
      status: item.status, priority: item.priority, dueDate: item.dueDate?.toISOString(),
      completedAt: item.completedAt?.toISOString(), filedDate: item.filedDate?.toISOString() ?? null,
      paidDate: item.paidDate?.toISOString() ?? null, period: item.period ?? null, financialYear: item.financialYear ?? null,
      acknowledgementNumber: item.acknowledgementNumber ?? null, registrationNumber: item.registrationNumber ?? null,
      amount: item.amount ?? null, recurrenceType: item.recurrenceType, recurrenceParentId: item.recurrenceParentId ?? null,
      isTemplateSuggested: item.isTemplateSuggested, departmentId: item.departmentId,
      department: { name: item.department.name },
      assignedTo: item.assignedTo ? { name: item.assignedTo.name, avatarUrl: item.assignedTo.avatarUrl } : null,
      createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString(),
    },
    auditPoints: item.auditPoints.map((ap) => ({
      id: ap.id, title: ap.title, description: ap.description, status: ap.status,
      dueDate: ap.dueDate?.toISOString(), completedAt: ap.completedAt?.toISOString(),
      assignedTo: ap.assignedTo ? { name: ap.assignedTo.name } : null, createdAt: ap.createdAt.toISOString(),
    })),
    documents: item.documents.map((doc) => ({
      id: doc.id, name: doc.name, fileUrl: doc.fileUrl, fileType: doc.fileType, fileSize: doc.fileSize,
      uploadedBy: { name: doc.uploadedBy.name }, createdAt: doc.createdAt.toISOString(),
    })),
    comments: item.comments.map((c) => ({
      id: c.id, content: c.content, author: { name: c.author.name, avatarUrl: c.author.avatarUrl }, createdAt: c.createdAt.toISOString(),
    })),
    auditLogs: logs.map((log) => ({
      id: log.id, action: log.action, entityType: log.entityType, entityId: log.entityId, details: log.details,
      userName: log.user?.name ?? log.actorName, createdAt: log.createdAt.toISOString(),
    })),
  }
}

export type UpdateComplianceInput = Partial<Omit<CreateComplianceInput, "departmentId" | "complianceType">> & {
  status?: string
  complianceType?: string
  departmentId?: string
}

export async function updateComplianceItem(ctx: ServiceContext, id: string, input: UpdateComplianceInput) {
  const { orgId, actor, request } = ctx
  const { title, description, status, priority, dueDate, assignedToId, period, financialYear,
    acknowledgementNumber, registrationNumber, amount, filedDate, paidDate, complianceType, departmentId } = input

  if (status !== undefined && !(VALID_STATUSES as readonly string[]).includes(status)) throw new ServiceError("Invalid status", 400)
  if (priority !== undefined && !(VALID_PRIORITIES as readonly string[]).includes(priority)) throw new ServiceError("Invalid priority", 400)

  const userId = actor.dbUser?.id
  const result = await withTenantContext({ orgId, userId }, async (db) => {
    const existingItem = await db.query.complianceItems.findFirst({ where: eq(complianceItems.id, id) })
    if (!existingItem) return { ok: false as const, error: "Compliance item not found" }

    const updateData: Record<string, unknown> = {}
    if (title !== undefined) updateData.title = title.trim()
    if (complianceType !== undefined && (VALID_TYPES as readonly string[]).includes(complianceType)) updateData.complianceType = complianceType
    if (departmentId !== undefined && departmentId.trim()) updateData.departmentId = departmentId.trim()
    if (description !== undefined) updateData.description = description
    if (priority !== undefined) updateData.priority = priority
    if (dueDate !== undefined) {
      if (dueDate === null) updateData.dueDate = null
      else { const parsed = new Date(dueDate); if (!isNaN(parsed.getTime())) updateData.dueDate = parsed }
    }
    if (assignedToId !== undefined) updateData.assignedToId = assignedToId || null
    if (period !== undefined) updateData.period = typeof period === "string" && period.trim() ? period.trim() : null
    if (financialYear !== undefined) updateData.financialYear = typeof financialYear === "string" && financialYear.trim() ? financialYear.trim() : null
    if (acknowledgementNumber !== undefined) updateData.acknowledgementNumber = typeof acknowledgementNumber === "string" && acknowledgementNumber.trim() ? acknowledgementNumber.trim() : null
    if (registrationNumber !== undefined) updateData.registrationNumber = typeof registrationNumber === "string" && registrationNumber.trim() ? registrationNumber.trim() : null
    if (amount !== undefined) updateData.amount = amount != null && amount !== "" ? String(amount) : null
    if (filedDate !== undefined) updateData.filedDate = filedDate ? new Date(filedDate) : null
    if (paidDate !== undefined) updateData.paidDate = paidDate ? new Date(paidDate) : null
    if (status !== undefined) {
      updateData.status = status
      if (status === "completed") updateData.completedAt = new Date()
      // VERI Reward: nudge the 'first_compliance_item' achievement when an
      // item is marked completed. Wrapped so a points-engine failure can
      // never break the actual compliance-item update (logged, not thrown).
      if (status === "completed") {
        try {
          await checkAndUnlockAchievements(db, { orgId, userId: userId!, achievementKey: "first_compliance_item" })
        } catch (err) {
          console.error("[veri-reward] failed to check first_compliance_item achievement", err)
        }
      }
    }

    await db.update(complianceItems).set(updateData as any).where(eq(complianceItems.id, id))

    // VERI Reward: nudge the 'weekly_task_5' achievement ("Resolve 5 tasks
    // this week") once this user's own completions in the current ISO week
    // reach 5. Runs AFTER the update above (not inside the
    // first_compliance_item block, which fires before the write lands) so
    // this item's own completion is already counted. There's no
    // completedById column on compliance_items, so "this user's tasks" is
    // approximated via assignedToId -- the closest real signal without
    // inventing a parallel tracking mechanism. date_trunc('week', ...) in
    // Postgres returns the Monday of the current ISO week, matching the
    // "this week" framing in the achievement's own description. Backed by
    // the compliance_items_weekly_completion_idx index (drizzle/0194) so
    // this stays an indexed range count, not a full table scan. Wrapped so
    // a points-engine failure can never break the actual compliance-item
    // update (logged, not thrown) -- same discipline as the
    // first_compliance_item block above.
    if (status === "completed" && userId) {
      try {
        const [{ count: weeklyCount }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(complianceItems)
          .where(
            and(
              eq(complianceItems.orgId, orgId),
              eq(complianceItems.assignedToId, userId),
              eq(complianceItems.status, "completed"),
              sql`${complianceItems.completedAt} >= date_trunc('week', now())`
            )
          )
        if (weeklyCount >= 5) {
          // >= not === : checkAndUnlockAchievements() already guards against
          // re-unlocking, so this is safe to call on every completion past 5;
          // an exact-match check would permanently miss the unlock for any
          // user whose weekly count jumps past 5 without ever equaling it
          // exactly (audit correction, 2026-07-14 -- Super Boss supervisor).
          await checkAndUnlockAchievements(db, { orgId, userId, achievementKey: "weekly_task_5", incrementBy: 5 })
        }
      } catch (err) {
        console.error("[veri-reward] failed to check weekly_task_5 achievement", err)
      }
    }

    const actorParam = actor.dbUser ? { dbUser: actor.dbUser } : { apiKey: actor.apiKey! }
    const logChange = (action: string, details: string) => logActivity({
      tx: db, action, entityType: "ComplianceItem", entityId: id, details, orgId, clientId: existingItem.clientId, request, ...actorParam,
    })
    if (status !== undefined && status !== existingItem.status) {
      await logChange("status_change", `Status changed from ${existingItem.status} to ${status}`)
      if (existingItem.assignedToId) {
        await db.insert(notifications).values({
          userId: existingItem.assignedToId,
          title: `Status changed: ${existingItem.title}`,
          message: `"${existingItem.title}" moved from ${existingItem.status} to ${status}.`,
          type: "status_change",
          metadata: { complianceItemId: id },
        })
      }
    }
    if (assignedToId !== undefined && assignedToId !== existingItem.assignedToId) {
      await logChange(existingItem.assignedToId ? "reassign" : "assign", existingItem.assignedToId ? "Reassigned from previous user" : `Assigned to user ${assignedToId}`)
    }
    if (title !== undefined && title !== existingItem.title) await logChange("update", "Title updated")

    if (assignedToId && assignedToId !== existingItem.assignedToId) {
      const assignee = await db.query.users.findFirst({ where: eq(users.id, assignedToId) })
      if (assignee?.email) notifyAssigned(assignee.email, assignee.name, existingItem.title, id).catch(() => {})
      await db.insert(notifications).values({
        userId: assignedToId,
        title: `Assigned: ${existingItem.title}`,
        message: `You were assigned to "${existingItem.title}".`,
        type: "assignment",
        metadata: { complianceItemId: id },
      })
    }

    const updated = await db.query.complianceItems.findFirst({
      where: eq(complianceItems.id, id),
      with: { department: { columns: { name: true } }, assignedTo: { columns: { name: true, avatarUrl: true } } },
    })
    return { ok: true as const, updated: updated! }
  })

  if (!result.ok) throw new ServiceError(result.error, 404)
  const item = result.updated
  return {
    id: item.id, title: item.title, description: item.description, complianceType: item.complianceType,
    status: item.status, priority: item.priority, dueDate: item.dueDate?.toISOString(),
    department: { name: item.department.name },
    assignedTo: item.assignedTo ? { name: item.assignedTo.name, avatarUrl: item.assignedTo.avatarUrl } : null,
    createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString(),
  }
}

export async function deleteComplianceItem(ctx: ServiceContext, id: string) {
  const { orgId, actor, request } = ctx
  const userId = actor.dbUser?.id
  const result = await withTenantContext({ orgId, userId }, async (db) => {
    const item = await db.query.complianceItems.findFirst({ where: and(eq(complianceItems.id, id), eq(complianceItems.orgId, orgId)) })
    if (!item) return null

    await db.delete(complianceItems).where(eq(complianceItems.id, id))

    await logActivity({
      tx: db, action: "delete", entityType: "ComplianceItem", entityId: id,
      details: `Deleted compliance item: ${item.title}`, orgId, clientId: item.clientId, request,
      ...(actor.dbUser ? { dbUser: actor.dbUser } : { apiKey: actor.apiKey! }),
    })
    return true
  })

  if (!result) throw new ServiceError("Compliance item not found", 404)
  return { success: true }
}

export async function getComplianceStats(ctx: ReadContext) {
  const { orgId } = ctx
  const now = new Date()
  const weekEnd = new Date(now.getTime() + 7 * 86400000)
  const monthEnd = new Date(now.getTime() + 30 * 86400000)
  const notDoneStatuses = ["completed", "not_applicable"] as const
  const orgFilter = eq(complianceItems.orgId, orgId)

  const result = await withTenantContext({ orgId }, async (db) => {
    const [total, completed, overdue, inProgress, pending, notApplicable, dueThisWeek, dueIn30Days] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(complianceItems).where(orgFilter).then(r => r[0].count),
      db.select({ count: sql<number>`count(*)::int` }).from(complianceItems).where(and(orgFilter, eq(complianceItems.status, "completed"))).then(r => r[0].count),
      db.select({ count: sql<number>`count(*)::int` }).from(complianceItems).where(and(orgFilter, eq(complianceItems.status, "overdue"))).then(r => r[0].count),
      db.select({ count: sql<number>`count(*)::int` }).from(complianceItems).where(and(orgFilter, eq(complianceItems.status, "in_progress"))).then(r => r[0].count),
      db.select({ count: sql<number>`count(*)::int` }).from(complianceItems).where(and(orgFilter, eq(complianceItems.status, "pending"))).then(r => r[0].count),
      db.select({ count: sql<number>`count(*)::int` }).from(complianceItems).where(and(orgFilter, eq(complianceItems.status, "not_applicable"))).then(r => r[0].count),
      db.select({ count: sql<number>`count(*)::int` }).from(complianceItems)
        .where(and(orgFilter, gte(complianceItems.dueDate, now), lte(complianceItems.dueDate, weekEnd), not(inArray(complianceItems.status, [...notDoneStatuses]))))
        .then(r => r[0].count),
      db.select({ count: sql<number>`count(*)::int` }).from(complianceItems)
        .where(and(orgFilter, gte(complianceItems.dueDate, now), lte(complianceItems.dueDate, monthEnd), not(inArray(complianceItems.status, ["completed", "not_applicable", "overdue"]))))
        .then(r => r[0].count),
    ])
    void inProgress; void pending; void notApplicable

    const depts = await db.query.departments.findMany({
      with: { complianceItems: true }, orderBy: asc(departments.name), where: eq(departments.orgId, orgId),
    })
    const byDepartment = depts.map((dept) => {
      const items = dept.complianceItems
      return {
        name: dept.name, total: items.length,
        overdue: items.filter(i => i.status === "overdue").length,
        pending: items.filter(i => i.status === "pending" || i.status === "in_progress").length,
        safe: items.filter(i => i.status === "completed" || i.status === "not_applicable").length,
      }
    })

    const upcomingDeadlines = await db.query.complianceItems.findMany({
      where: and(orgFilter, not(inArray(complianceItems.status, [...notDoneStatuses])), gte(complianceItems.dueDate, now)),
      with: { department: { columns: { name: true } }, assignedTo: { columns: { name: true, avatarUrl: true } } },
      orderBy: asc(complianceItems.dueDate), limit: 5,
    })

    const orgUserIds = (await db.select({ id: users.id }).from(users).where(eq(users.orgId, orgId))).map(u => u.id)
    const recentActivity = await db.query.auditLogs.findMany({
      where: orgUserIds.length > 0 ? inArray(auditLogs.userId, orgUserIds) : undefined,
      with: { user: { columns: { name: true } } }, orderBy: desc(auditLogs.createdAt), limit: 8,
    })

    const noticeCount = await db.select({ count: sql<number>`count(*)::int` }).from(notices).where(eq(notices.orgId, orgId)).then(r => r[0].count)

    return { total, overdue, dueThisWeek, completed, dueIn30Days, noticeCount, byDepartment, upcomingDeadlines, recentActivity }
  })

  return {
    total: result.total, overdue: result.overdue, dueThisWeek: result.dueThisWeek, completed: result.completed,
    dueIn30Days: result.dueIn30Days, safe: result.completed, noticeCount: result.noticeCount, byDepartment: result.byDepartment,
    upcomingDeadlines: result.upcomingDeadlines.map(i => ({
      id: i.id, title: i.title, department: i.department.name, dueDate: i.dueDate?.toISOString(),
      assignedTo: i.assignedTo?.name ?? "Unassigned", status: i.status,
    })),
    recentActivity: result.recentActivity.map(a => ({
      id: a.id, action: a.action, entityType: a.entityType, details: a.details,
      userName: a.user?.name ?? a.actorName, createdAt: a.createdAt.toISOString(),
    })),
  }
}

export async function getOverdueItems(ctx: ReadContext) {
  const { orgId } = ctx
  const { data, error } = await (async () => {
    try {
      const items = await withTenantContext({ orgId }, (db) =>
        db.query.complianceItems.findMany({
          where: and(eq(complianceItems.orgId, orgId), eq(complianceItems.status, "overdue")),
          with: { department: { columns: { name: true } }, assignedTo: { columns: { name: true } } },
          orderBy: asc(complianceItems.dueDate),
        })
      )
      return { data: items, error: null }
    } catch (e) {
      return { data: null, error: e }
    }
  })()
  if (error || !data) throw new ServiceError("Failed to fetch overdue items", 500)

  const now = Date.now()
  return data.map((item) => {
    const daysLate = Math.floor((now - item.dueDate.getTime()) / 86400000)
    return {
      id: item.id, title: item.title, complianceType: item.complianceType, dueDate: item.dueDate.toISOString(),
      department: item.department.name, assignedTo: item.assignedTo?.name ?? null, daysLate,
    }
  })
}

export async function syncOverdue(ctx: ReadContext) {
  const { orgId } = ctx
  const now = new Date()
  const result = await withTenantContext({ orgId }, (db) =>
    db.update(complianceItems).set({ status: "overdue", updatedAt: now })
      .where(and(eq(complianceItems.orgId, orgId), lt(complianceItems.dueDate, now), not(inArray(complianceItems.status, ["completed", "not_applicable", "overdue"]))))
      .returning({ id: complianceItems.id })
  )
  return { updated: result.length, updatedAt: now.toISOString() }
}
