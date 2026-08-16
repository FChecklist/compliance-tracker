// Owner directive 2026-07-13: report result rows need a real action flow
// (accept / send-to-todo / delegate). This service only ever records the
// action trail -- it deliberately does NOT create the delegation or task
// itself (that's delegation-service.ts's createDelegation() via
// POST /api/delegations, and task-service.ts's createTask() via
// POST /api/tasks, both real, pre-existing, unmodified services). The
// client creates the real delegation/task first, then calls this with the
// resulting id as targetId -- see ReportScheduleDialog.tsx's sibling,
// CustomReportsSection.tsx's row action handlers, for the exact call order.
//
// "accept" intentionally invents no new status on the underlying domain
// entity (compliance_items/notices/risks/pms_issues/incidents already have
// their own real status semantics -- see custom-report-service.ts's
// whitelist) -- it only marks the report row itself acknowledged.
import { reportItemActions } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export const REPORT_ITEM_ACTIONS = ["accept", "delegate", "todo"] as const
export type ReportItemActionType = (typeof REPORT_ITEM_ACTIONS)[number]

export type CreateReportItemActionInput = {
  reportId: string
  rowId: string
  action: ReportItemActionType
  targetId?: string | null
}

/** Pure validation, same shape as report-schedule-service.ts's validateReportScheduleInput. */
export function validateReportItemActionInput(
  input: Pick<CreateReportItemActionInput, "reportId" | "rowId" | "action">
): { valid: true } | { valid: false; reason: string } {
  if (!input.reportId?.trim()) return { valid: false, reason: "reportId is required" }
  if (!input.rowId?.trim()) return { valid: false, reason: "rowId is required" }
  if (!REPORT_ITEM_ACTIONS.includes(input.action)) return { valid: false, reason: `action must be one of: ${REPORT_ITEM_ACTIONS.join(", ")}` }
  return { valid: true }
}

export async function createReportItemAction(ctx: { orgId: string; userId: string }, input: CreateReportItemActionInput) {
  const check = validateReportItemActionInput(input)
  if (!check.valid) throw new ServiceError(check.reason, 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [created] = await db.insert(reportItemActions).values({
      orgId: ctx.orgId,
      reportId: input.reportId.trim(),
      rowId: input.rowId.trim(),
      userId: ctx.userId,
      action: input.action,
      targetId: input.targetId ?? null,
    }).returning()
    return created
  })
}

export async function listReportItemActions(ctx: { orgId: string }, reportId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.reportItemActions.findMany({
      where: and(eq(reportItemActions.orgId, ctx.orgId), eq(reportItemActions.reportId, reportId)),
      orderBy: (t, { desc }) => desc(t.createdAt),
    })
  )
}
