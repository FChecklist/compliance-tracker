import { complianceItems, departments, notices, tasks, users } from "@/lib/db"
import { type TenantDb } from "@/lib/db/tenant-scoped"
import { eq, and, asc, gte, lte, ne, sql } from "drizzle-orm"
import { decideActionAutonomy } from "@/lib/action-autonomy-decision"
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

// Deliberately excludes "create_compliance_item": that one case's
// logActivity() call is a named guardrail anchor
// (scripts/check-guardrail-presence.mjs requires "logActivity(" to appear
// literally in task-execution-engine.ts itself, "so the marker check still
// catches... its use in the core task-execution path") -- narrowing/
// relocating a named guardrail needs the owner's explicit written
// sign-off + a manifest update per AGENTS.md Operating Rule 9, which this
// refactor doesn't have. Left inline in dispatchTool() instead; see that
// function's own comment.
export const COMPLIANCE_TOOL_CODES = new Set([
  "get_compliance_stats",
  "get_overdue_items",
  "list_departments",
  "list_compliance_items",
  "list_notices",
  "get_task_status",
  "update_compliance_status",
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
      columns: { id: true, title: true, status: true, amount: true },
    })
    if (!existing) throw new Error("Compliance item not found")

    // R65 Part B: the real risk here isn't the status field itself, it's
    // silently closing out (completed) or waiving (not_applicable) an item
    // carrying a large penalty/filing amount -- the same signal
    // create_compliance_item's own gate already uses at creation time. Any
    // other transition (pending/in_progress/overdue/draft) is a routine
    // workflow move, not a financial decision, so it's left ungated --
    // matches the 80/20 intent of gating the 20% that's actually
    // consequential, not every write indiscriminately.
    const isTerminalTransition = newStatus === "completed" || newStatus === "not_applicable"
    const itemAmount = existing.amount != null ? Number(existing.amount) : null
    const autonomy = decideActionAutonomy({
      riskFactors: {
        financialAmountInr: isTerminalTransition && Number.isFinite(itemAmount) ? itemAmount : null,
        blastRadius: "single",
      },
    })
    // When the gate says review first, the item lands in 'draft' -- the
    // same "not yet an active/closed obligation" state create_compliance_item's
    // gate uses -- instead of the requested status; a human moves it on from
    // there via this same dispatch path once satisfied. Nothing is silently
    // dropped: the originally-requested status is preserved in the audit
    // log and the return value.
    const appliedStatus = autonomy.decision === "pending_review" ? "draft" : newStatus
    const [updated] = await db.update(complianceItems)
      .set({ status: appliedStatus as typeof existing.status, updatedAt: new Date(), ...(appliedStatus === "completed" ? { completedAt: new Date() } : {}) })
      .where(eq(complianceItems.id, complianceItemId))
      .returning({ id: complianceItems.id, title: complianceItems.title, status: complianceItems.status })

    const dbUser = await db.query.users.findFirst({ where: eq(users.id, userId) })
    if (dbUser) {
      await logActivity({
        tx: db, action: "update", entityType: "ComplianceItem", entityId: complianceItemId,
        details: autonomy.decision === "pending_review"
          ? `Status change ${existing.status} -> ${newStatus} held for review, applied as 'draft' instead (${autonomy.reason})`
          : `Status change: ${existing.status} -> ${updated.status}`,
        orgId, dbUser,
      })
    }
    return { ...updated, previousStatus: existing.status, requestedStatus: newStatus, autonomyDecision: autonomy.decision, autonomyReason: autonomy.reason }
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
