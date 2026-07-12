// Wave 173 (GAP-UNIVERSAL-DASHBOARD). DEC-03 (ai-os/MASTER-TRACKER.yaml's
// ratified_do_not_build, RATIFIED-01) explicitly ratified AGAINST retrofitting
// ERP/PMS/Firm/Construction onto a single unified Work Object table -- this
// file does NOT revisit that decision. What it builds instead is a real,
// honest APPROXIMATION: a read-only aggregation service that queries the
// existing separate source-of-truth tables (tasks, compliance_items,
// tickets, approval_requests) and reshapes them into one cross-type response
// grouped by the 6 categories Tree 1 names (To Do/Pending/WIP/Overdue/
// Escalations/Critical), with every item tagged with its real source table.
// This is a view over what exists today, not a new source of truth --
// nothing here writes to any of the 4 source tables, and no new table is
// created by this file.
//
// Deliberately scoped to 4 source types, not "every Work Object type" the
// Tree 1 ask gestures at (PMS issues, ERP documents, construction site
// diary entries, etc. are all real but out of this first slice) --
// tasks/compliance_items/tickets/approval_requests are the 4 the task
// brief named explicitly, and ticket-service.ts/task-service.ts/
// compliance-service.ts already existed as this session's established
// per-type service layer to read from, matching veri-todo-service.ts's own
// precedent of covering "tasks only" rather than attempting full
// generality in one pass.
import { tasks, complianceItems, tickets, approvalRequests } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, notInArray } from "drizzle-orm"
import type { ReadContext } from "./context"

export const WORK_ITEM_SOURCE_TYPES = ["task", "compliance_item", "ticket", "approval_request"] as const
export type WorkItemSourceType = (typeof WORK_ITEM_SOURCE_TYPES)[number]

// The exact 6 categories Tree 1 names (main_dashboard_user.md /
// VERIDIAN.docx's Universal Work Object dashboard ask). "Blocked"/
// "Delegated"/"Waiting-dependency" (the other states DEC-03's own OPEN-05
// note flags as permanently only-approximated without a real Work Object
// retrofit) have no equivalent across all 4 source tables' status enums,
// so they're honestly left out rather than faked.
export const WORK_DASHBOARD_CATEGORIES = ["to_do", "pending", "wip", "overdue", "escalations", "critical"] as const
export type WorkDashboardCategory = (typeof WORK_DASHBOARD_CATEGORIES)[number]

export type WorkItem = {
  id: string
  sourceType: WorkItemSourceType
  title: string
  status: string
  priority: string | null
  dueDate: string | null
  category: WorkDashboardCategory
  url: string
}

export type WorkDashboardResponse = {
  categories: Record<WorkDashboardCategory, WorkItem[]>
  counts: Record<WorkDashboardCategory, number>
  totalItems: number
  generatedAt: string
}

// ─── Pure categorization (unit-testable without a DB) ──────────────────────
// One function per source type -- each encodes that type's own real status/
// priority/due-date shape rather than forcing all 4 through one generic
// rule set (a task's priority is an integer 0-3, a compliance item's is the
// 'low'|'medium'|'high'|'critical' enum, a ticket's mirrors that enum, and
// an approval_request has no priority concept at all -- collapsing these
// into one shared type would either lose information or fabricate a
// priority approval_requests doesn't have).

const TASK_URGENT_PRIORITY = 3 // matches task-service.ts's VALID_PRIORITIES: 0=Low,1=Normal,2=High,3=Urgent

export function categorizeTask(
  task: { status: string; priority: number; dueDate: Date | null },
  now: Date
): WorkDashboardCategory {
  const isOpen = task.status !== "completed" && task.status !== "cancelled"
  const isOverdue = isOpen && task.dueDate !== null && task.dueDate.getTime() < now.getTime()

  if (task.status === "failed") return "escalations"
  if (isOverdue && task.priority >= TASK_URGENT_PRIORITY) return "escalations"
  if (isOverdue) return "overdue"
  if (task.priority >= TASK_URGENT_PRIORITY) return "critical"
  if (task.status === "in_progress") return "wip"
  return "to_do"
}

const HIGH_SEVERITY_PRIORITIES = new Set(["critical", "high"])

export function categorizeComplianceItem(
  item: { status: string; priority: string; dueDate: Date | null },
  now: Date
): WorkDashboardCategory {
  // complianceStatusEnum already carries an explicit 'overdue' value
  // (denormalized by compliance-service.ts's syncOverdue) -- trusted
  // directly rather than re-deriving from dueDate, so this stays
  // consistent with whatever that sync job's own overdue definition is.
  const isOverdue = item.status === "overdue" || (item.dueDate !== null && item.dueDate.getTime() < now.getTime() && item.status !== "completed" && item.status !== "not_applicable")

  if (isOverdue && HIGH_SEVERITY_PRIORITIES.has(item.priority)) return "escalations"
  if (isOverdue) return "overdue"
  if (item.priority === "critical") return "critical"
  if (item.status === "in_progress") return "wip"
  return "to_do"
}

export function categorizeTicket(
  ticket: { status: string; priority: string; slaDeadline: Date | null },
  now: Date
): WorkDashboardCategory {
  const isOpen = ticket.status !== "resolved" && ticket.status !== "closed"
  const isOverdue = isOpen && ticket.slaDeadline !== null && ticket.slaDeadline.getTime() < now.getTime()

  if (isOverdue && HIGH_SEVERITY_PRIORITIES.has(ticket.priority)) return "escalations"
  if (isOverdue) return "overdue"
  if (ticket.priority === "critical") return "critical"
  if (ticket.status === "in_progress") return "wip"
  return "to_do"
}

// approval_requests carries no priority/due-date concept at all -- every
// pending request is, definitionally, waiting on someone else's decision,
// which is exactly what the "Pending" category means. Kept as a function
// (rather than inlined as a literal) for symmetry with the 3 above and so
// a future real priority/SLA field on approval_requests has one obvious
// place to extend.
export function categorizeApprovalRequest(): WorkDashboardCategory {
  return "pending"
}

function emptyCategoryMap<T>(fill: () => T): Record<WorkDashboardCategory, T> {
  return Object.fromEntries(WORK_DASHBOARD_CATEGORIES.map((c) => [c, fill()])) as Record<WorkDashboardCategory, T>
}

/**
 * Pure assembly: given already-fetched rows from all 4 source tables (each
 * already mapped to the minimal shape its own categorize* function needs),
 * builds the full grouped response. Split from getWorkDashboard() below so
 * the actual grouping/sorting logic is unit-testable without a DB, matching
 * this file's own categorize* functions and this repo's established
 * pure-core/DB-shell pattern (see task-service.ts's validateChainDepth).
 */
export function buildWorkDashboard(
  items: WorkItem[],
  now: Date = new Date()
): WorkDashboardResponse {
  const categories = emptyCategoryMap<WorkItem[]>(() => [])
  for (const item of items) categories[item.category].push(item)
  // Most time-sensitive first within each bucket -- items with a real
  // dueDate sort before those without one, earliest due date first.
  for (const category of WORK_DASHBOARD_CATEGORIES) {
    categories[category].sort((a, b) => {
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate)
      if (a.dueDate) return -1
      if (b.dueDate) return 1
      return 0
    })
  }
  const counts = emptyCategoryMap<number>(() => 0)
  for (const category of WORK_DASHBOARD_CATEGORIES) counts[category] = categories[category].length

  return { categories, counts, totalItems: items.length, generatedAt: now.toISOString() }
}

const OPEN_TASK_STATUSES_EXCLUDED = ["completed", "cancelled"]
// complianceItems.status is a real pg enum (complianceStatusEnum) -- typed
// (not `as const`, which produces a readonly tuple notInArray()'s typed
// overload rejects) so it matches the column's own literal union type.
const OPEN_COMPLIANCE_STATUSES_EXCLUDED: ("completed" | "not_applicable")[] = ["completed", "not_applicable"]
const OPEN_TICKET_STATUSES_EXCLUDED = ["resolved", "closed"]

/**
 * The DB-touching half: fetches open work from all 4 source tables (RLS-
 * scoped via withTenantContext, same tenant-isolation posture every other
 * service in this codebase uses), maps each row to a WorkItem carrying its
 * real source type and a deep link back to the page that owns it, then
 * hands off to buildWorkDashboard() for the pure grouping. Read-only --
 * issues zero writes to any of the 4 tables.
 */
export async function getWorkDashboard(ctx: ReadContext, now: Date = new Date()): Promise<WorkDashboardResponse> {
  const { orgId } = ctx

  const [taskRows, complianceRows, ticketRows, approvalRows] = await withTenantContext({ orgId }, (tdb) =>
    Promise.all([
      tdb.query.tasks.findMany({
        where: and(eq(tasks.orgId, orgId), notInArray(tasks.status, OPEN_TASK_STATUSES_EXCLUDED)),
      }),
      tdb.query.complianceItems.findMany({
        where: and(eq(complianceItems.orgId, orgId), notInArray(complianceItems.status, OPEN_COMPLIANCE_STATUSES_EXCLUDED)),
      }),
      tdb.query.tickets.findMany({
        where: and(eq(tickets.orgId, orgId), notInArray(tickets.status, OPEN_TICKET_STATUSES_EXCLUDED)),
      }),
      tdb.query.approvalRequests.findMany({
        where: and(eq(approvalRequests.orgId, orgId), eq(approvalRequests.status, "pending")),
      }),
    ])
  )

  const items: WorkItem[] = [
    ...taskRows.map((t): WorkItem => ({
      id: t.id, sourceType: "task", title: t.title, status: t.status,
      priority: String(t.priority), dueDate: t.dueDate?.toISOString() ?? null,
      category: categorizeTask({ status: t.status, priority: t.priority, dueDate: t.dueDate }, now),
      url: `/tasks?taskId=${t.id}`,
    })),
    ...complianceRows.map((c): WorkItem => ({
      id: c.id, sourceType: "compliance_item", title: c.title, status: c.status,
      priority: c.priority, dueDate: c.dueDate?.toISOString() ?? null,
      category: categorizeComplianceItem({ status: c.status, priority: c.priority, dueDate: c.dueDate }, now),
      url: `/compliance?itemId=${c.id}`,
    })),
    ...ticketRows.map((t): WorkItem => ({
      id: t.id, sourceType: "ticket", title: t.subject, status: t.status,
      priority: t.priority, dueDate: t.slaDeadline?.toISOString() ?? null,
      category: categorizeTicket({ status: t.status, priority: t.priority, slaDeadline: t.slaDeadline }, now),
      url: `/tickets?ticketId=${t.id}`,
    })),
    ...approvalRows.map((a): WorkItem => ({
      id: a.id, sourceType: "approval_request", title: a.description ?? `${a.requestType} approval`, status: a.status,
      priority: null, dueDate: null,
      category: categorizeApprovalRequest(),
      url: `/approvals?requestId=${a.id}`,
    })),
  ]

  return buildWorkDashboard(items, now)
}
