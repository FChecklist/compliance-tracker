import { complianceItems, departments, notices, tasks, users } from "@/lib/db"
import { type TenantDb } from "@/lib/db/tenant-scoped"
import { eq, and, asc, gte, lte, ne, sql } from "drizzle-orm"
import { VALID_TYPES as VALID_COMPLIANCE_TYPES } from "@/lib/services/compliance-service"
import { logActivity } from "@/lib/audit"

// VERIDIAN Review Framework gap-closure (AI Engineering Quality / Code
// Structure & Modularity): extracted from task-execution-engine.ts's
// dispatchTool() -- the compliance-domain slice of that function's
// if-chain (get_compliance_stats .. get_penalty_estimate), unchanged in
// behavior, just relocated + grouped by responsibility so the calling
// function is a thin router instead of one large multi-domain if-chain.
// See gst-tools.ts / construction-tools.ts for the other two slices, and
// task-execution-engine.ts's dispatchTool() for the router that ties all
// three back together (still the single public entrypoint every existing
// call site imports -- no call-site changes needed).

export const COMPLIANCE_TOOL_CODES = new Set([
  "get_compliance_stats",
  "get_overdue_items",
  "list_departments",
  "list_compliance_items",
  "list_notices",
  "get_task_status",
  "update_compliance_status",
  "create_compliance_item",
  "get_penalty_estimate",
])

export async function dispatchComplianceTool(
  db: TenantDb,
  orgId: string,
  userId: string,
  codeReference: string,
  context?: { taskId?: string; inputs?: Record<string, unknown> }
): Promise<unknown> {
  if (codeReference === "get_compliance_stats") {
    const now = new Date()
    const weekEnd = new Date(Date.now() + 7 * 86400000)
    const [[total], [overdue], [completed], [dueWeek]] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(complianceItems).where(eq(complianceItems.orgId, orgId)),
      db.select({ count: sql<number>`count(*)` }).from(complianceItems).where(and(eq(complianceItems.orgId, orgId), eq(complianceItems.status, "overdue"))),
      db.select({ count: sql<number>`count(*)` }).from(complianceItems).where(and(eq(complianceItems.orgId, orgId), eq(complianceItems.status, "completed"))),
      db.select({ count: sql<number>`count(*)` }).from(complianceItems).where(
        and(eq(complianceItems.orgId, orgId), gte(complianceItems.dueDate, now), lte(complianceItems.dueDate, weekEnd), ne(complianceItems.status, "completed"))
      ),
    ])
    return { total: Number(total.count), overdue: Number(overdue.count), completed: Number(completed.count), dueThisWeek: Number(dueWeek.count) }
  }

  if (codeReference === "get_overdue_items") {
    const items = await db.query.complianceItems.findMany({
      where: and(eq(complianceItems.orgId, orgId), eq(complianceItems.status, "overdue")),
      columns: { id: true, title: true, complianceType: true, dueDate: true },
      orderBy: asc(complianceItems.dueDate),
      limit: 10,
    })
    return items.map((i) => ({ ...i, daysLate: Math.floor((Date.now() - i.dueDate.getTime()) / 86400000) }))
  }

  if (codeReference === "list_departments") {
    return db.query.departments.findMany({
      where: eq(departments.orgId, orgId),
      columns: { id: true, name: true },
    })
  }

  if (codeReference === "list_compliance_items") {
    return db.query.complianceItems.findMany({
      where: eq(complianceItems.orgId, orgId),
      columns: { id: true, title: true, complianceType: true, status: true, dueDate: true },
      orderBy: asc(complianceItems.dueDate),
      limit: 20,
    })
  }

  if (codeReference === "list_notices") {
    return db.query.notices.findMany({
      where: eq(notices.orgId, orgId),
      columns: { id: true, noticeNumber: true, authority: true, status: true, replyDeadline: true },
      orderBy: asc(notices.replyDeadline),
      limit: 20,
    })
  }

  if (codeReference === "get_task_status") {
    // Contextual, zero-argument by design -- "what's the status of the task
    // I'm in", not an arbitrary lookup (structured dispatch has no argument-
    // capture UI yet; a task-id-taking version can be added once it does).
    if (!context?.taskId) throw new Error("get_task_status requires task context")
    const task = await db.query.tasks.findFirst({
      where: eq(tasks.id, context.taskId),
      columns: { id: true, title: true, status: true, updatedAt: true },
    })
    if (!task) throw new Error("Task not found")
    return task
  }

  // A real write action -- safe to auto-dispatch here (unlike the free-text/
  // LLM-planning path's DISPATCHABLE read-only restriction) because the
  // arguments are never LLM-generated: capability-tree-service.ts's
  // Compliance Item branch bakes the exact item id + target status into the
  // leaf itself (fixedInputs), so this only ever runs with values a human
  // picked by clicking, not values an LLM guessed.
  if (codeReference === "update_compliance_status") {
    const complianceItemId = String(context?.inputs?.complianceItemId ?? "")
    const newStatus = String(context?.inputs?.newStatus ?? "")
    const validStatuses = ["pending", "in_progress", "completed", "overdue", "not_applicable", "draft"]
    if (!complianceItemId || !validStatuses.includes(newStatus)) throw new Error("Missing or invalid complianceItemId/newStatus")
    const existing = await db.query.complianceItems.findFirst({
      where: and(eq(complianceItems.id, complianceItemId), eq(complianceItems.orgId, orgId)),
      columns: { id: true, title: true, status: true },
    })
    if (!existing) throw new Error("Compliance item not found")
    const [updated] = await db.update(complianceItems)
      .set({ status: newStatus as typeof existing.status, updatedAt: new Date(), ...(newStatus === "completed" ? { completedAt: new Date() } : {}) })
      .where(eq(complianceItems.id, complianceItemId))
      .returning({ id: complianceItems.id, title: complianceItems.title, status: complianceItems.status })
    return { ...updated, previousStatus: existing.status }
  }

  // Gap closure, 2026-07-10 (CAPABILITY_COVERAGE.md): create_compliance_item
  // was registered with zero implementation. Safe to auto-dispatch here for
  // the same reason update_compliance_status is -- capability-tree-service.ts's
  // "Create New" leaf collects title/type/dueDate/amount through inputFields
  // (a validated form, never LLM-guessed) and bakes departmentId into
  // fixedInputs (a real click, not typed text). Mirrors createComplianceItem()
  // in compliance-service.ts's own validation/insert shape, inlined here
  // rather than calling that function directly since it expects a fuller
  // ServiceContext (actor/request) this dispatch path doesn't carry.
  if (codeReference === "create_compliance_item") {
    const departmentId = String(context?.inputs?.departmentId ?? "")
    const title = String(context?.inputs?.title ?? "").trim()
    const complianceType = String(context?.inputs?.complianceType ?? "")
    const dueDateRaw = String(context?.inputs?.dueDate ?? "")
    const amountRaw = context?.inputs?.amount
    if (!departmentId || !title || !(VALID_COMPLIANCE_TYPES as readonly string[]).includes(complianceType)) {
      throw new Error("Missing or invalid departmentId/title/complianceType")
    }
    const parsedDueDate = new Date(dueDateRaw)
    if (isNaN(parsedDueDate.getTime())) throw new Error("A valid dueDate (YYYY-MM-DD) is required")
    const dept = await db.query.departments.findFirst({ where: and(eq(departments.id, departmentId), eq(departments.orgId, orgId)) })
    if (!dept) throw new Error("Department not found")

    const [item] = await db.insert(complianceItems).values({
      title, complianceType: complianceType as typeof VALID_COMPLIANCE_TYPES[number],
      dueDate: parsedDueDate, departmentId, orgId,
      amount: amountRaw != null && amountRaw !== "" ? String(amountRaw) : null,
    }).returning({ id: complianceItems.id, title: complianceItems.title, dueDate: complianceItems.dueDate })

    const dbUser = await db.query.users.findFirst({ where: eq(users.id, userId) })
    if (dbUser) {
      await logActivity({ tx: db, action: "create", entityType: "ComplianceItem", entityId: item.id, details: `Created compliance item: ${item.title}`, orgId, dbUser })
    }
    return item
  }

  // Gap closure, 2026-07-10: get_penalty_estimate was registered with zero
  // implementation. Uses complianceItems.amount ("Amount for penalty
  // calculation" per its own schema comment) and the item's real due/
  // completed date to compute real days-late, then the existing generic
  // simple-interest calculator (compliance-engine.ts, already used
  // elsewhere) -- the only value a human types is the interest rate itself,
  // since statutory rates vary per compliance type and aren't modeled in
  // this schema yet.
  if (codeReference === "get_penalty_estimate") {
    const complianceItemId = String(context?.inputs?.complianceItemId ?? "")
    const annualRatePercent = Number(context?.inputs?.annualRatePercent)
    if (!complianceItemId || !Number.isFinite(annualRatePercent)) throw new Error("Missing complianceItemId or annualRatePercent")
    const item = await db.query.complianceItems.findFirst({
      where: and(eq(complianceItems.id, complianceItemId), eq(complianceItems.orgId, orgId)),
      columns: { id: true, title: true, amount: true, dueDate: true, completedAt: true },
    })
    if (!item) throw new Error("Compliance item not found")
    if (item.amount == null) throw new Error("This item has no amount set -- penalty cannot be estimated")
    const asOf = item.completedAt ?? new Date()
    const daysLate = Math.max(0, Math.floor((asOf.getTime() - item.dueDate.getTime()) / 86400000))
    const { calculateComplianceInterest } = await import("@/lib/engines/compliance-engine")
    const estimatedPenalty = calculateComplianceInterest(Number(item.amount), annualRatePercent, daysLate)
    return { itemTitle: item.title, amount: Number(item.amount), daysLate, annualRatePercent, estimatedPenalty }
  }

  throw new Error(`No dispatcher implemented for ${codeReference}`)
}
