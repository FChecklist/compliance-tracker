// R67 WS-H (item H-02, R-144/R-148). "On submit, mint a Task Master row
// 'Review Timesheet > Approve - 3.00 h, #12 Joinery shop drawings, Priya,
// 2 Sep' for the project's PMs and close it on the decision."
//
// WHY A SERVICE AND NOT AN INLINE INSERT IN pms-time-service.ts: the mint
// writes compliance.submissions + compliance.pipeline_tasks, which is the
// Task Master's substrate, not the timesheet's -- and it must run in its OWN
// withTenantContext transaction, never nested inside submitTimeEntry()'s
// (D-06 forbids nesting withTenantContext, and the 5-connection app_runtime
// pool is exactly what makes a nested transaction a deadlock rather than a
// style issue). The caller therefore submits first, then mints, and reports
// honestly if the second step failed instead of pretending the whole thing
// worked. See the timesheets submit/submit-day routes for that sequencing.
//
// HOW THE ROW RENDERS, and why the strings are shaped the way they are:
// PROJEXA's M24Shell builds every Task Master row from the same two fields
// (src/components/shell/M24Shell.tsx toTaskRow) --
//   verb   = verbFor(functionId)          -> "Review" for review_timesheet_entry
//   object = derivedChain.steps.join(" > ")-> "Timesheet > Approve"
//   detail = error ?? submissions.rawInput -> "3.00 h, #12 Joinery ..., Priya, 2 Sep"
// so the row reads exactly the sentence the item quotes. Nothing about the
// shell had to change for this.
//
// HONEST LIMITATION, stated rather than papered over: pipeline_tasks has no
// assignee column, and the Task Master GET scopes rows by org + project
// only. So the minted row is visible to everyone on the project rather than
// only to its PMs; the PM-only half of the requirement is enforced where it
// can actually bite -- the approve/reject routes role-gate on the resolved
// acting user (requireRole(actingUser, "manager")) and the service refuses
// self-review. Making the ROW itself PM-only needs an assignee/audience
// column on pipeline_tasks, which is a schema change outside this item.
import { pipelineTasks, submissions } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, inArray, sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

/** The pipeline function id these rows carry. verbFor() maps it to "Review". */
export const TIMESHEET_REVIEW_FUNCTION_ID = "review_timesheet_entry"

/** The chain the shell joins with " > " to build the row's object. */
export const TIMESHEET_REVIEW_CHAIN_STEPS = ["Timesheet", "Approve"] as const

// R67 WS-H (item H-03): "a rejected day returns to the designer as a 'Needs
// you' row in the Task Master carrying the reason". That is a SECOND row,
// addressed to the designer, not the reviewer's row reworded -- the
// reviewer's row is closed (they are done) and the designer's is opened
// (they are not). Both live on pipeline_tasks and are told apart by their
// function id, which is also how each is found again to close it.
export const TIMESHEET_RETURNED_FUNCTION_ID = "review_returned_timesheet_entry"
export const TIMESHEET_RETURNED_CHAIN_STEPS = ["Timesheet", "Fix"] as const

/** Statuses that mean "this review is still open" -- what closing looks for. */
const OPEN_STATUSES = ["to_do", "waiting", "in_progress"] as const

// Pinned, not locale-derived. format-date.ts already established that this
// product renders dates through a fixed formatter rather than the server's
// ambient locale (a Vercel region change must not silently reword a task
// row). "2 Sep" is the shape the item quotes.
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const

export function formatShortDay(spentOn: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(spentOn)
  if (!match) return spentOn
  const month = SHORT_MONTHS[Number(match[2]) - 1]
  if (!month) return spentOn
  return `${Number(match[3])} ${month}`
}

export type TimesheetReviewRowInput = {
  hours: string | number
  issueNumber: number | null
  issueTitle: string | null
  designerName: string
  spentOn: string
}

/**
 * The row's line 2 -- "the DECIDING information" (M24). Pure, so the exact
 * sentence is testable without a database.
 *
 * "3.00 h, #12 Joinery shop drawings, Priya, 2 Sep"
 */
export function buildTimesheetReviewDetail(input: TimesheetReviewRowInput): string {
  const hours = Number(input.hours)
  const hoursLabel = `${Number.isFinite(hours) ? hours.toFixed(2) : String(input.hours)} h`
  const task = input.issueNumber !== null && input.issueTitle
    ? `#${input.issueNumber} ${input.issueTitle}`
    : input.issueTitle ?? "task"
  return [hoursLabel, task, input.designerName, formatShortDay(input.spentOn)].join(", ")
}

export type OpenTimesheetReviewTaskInput = TimesheetReviewRowInput & {
  timeEntryId: string
  projectId: string | null
  designerId: string
}

/**
 * Mints the review row for one submitted entry. Idempotent by design: a
 * second submit of the same entry (or a retry after a network failure) finds
 * the still-open row and returns it instead of stacking duplicates in the
 * reviewer's list.
 */
export async function openTimesheetReviewTask(ctx: { orgId: string }, input: OpenTimesheetReviewTaskInput) {
  return openTimesheetTask(ctx, input, TIMESHEET_REVIEW_FUNCTION_ID, [...TIMESHEET_REVIEW_CHAIN_STEPS], buildTimesheetReviewDetail(input))
}

/**
 * Opens the DESIGNER's row when their hours come back. The reason the
 * manager typed is the row's line 2 -- "the DECIDING information" (M24) --
 * so the designer never has to open the entry to find out what to change.
 */
export async function openTimesheetReturnedTask(
  ctx: { orgId: string },
  input: OpenTimesheetReviewTaskInput & { rejectionReason?: string | null }
) {
  const detail = `${buildTimesheetReviewDetail(input)}${input.rejectionReason ? ` - sent back: ${input.rejectionReason}` : " - sent back"}`
  return openTimesheetTask(ctx, input, TIMESHEET_RETURNED_FUNCTION_ID, [...TIMESHEET_RETURNED_CHAIN_STEPS], detail)
}

async function openTimesheetTask(
  ctx: { orgId: string },
  input: OpenTimesheetReviewTaskInput,
  functionId: string,
  steps: string[],
  detail: string
) {
  if (!input.timeEntryId) throw new ServiceError("timeEntryId is required", 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.select({ id: pipelineTasks.id })
      .from(pipelineTasks)
      .where(and(
        eq(pipelineTasks.orgId, ctx.orgId),
        eq(pipelineTasks.functionId, functionId),
        inArray(pipelineTasks.status, [...OPEN_STATUSES]),
        sql`${pipelineTasks.params}->>'timeEntryId' = ${input.timeEntryId}`
      ))
      .limit(1)
    if (existing.length > 0) return { taskId: existing[0].id, created: false }

    const [submission] = await db.insert(submissions).values({
      orgId: ctx.orgId,
      projectId: input.projectId,
      mode: "Projects",
      selectedChain: { root: "Design Studio", steps },
      rawInput: detail,
      // The submission belongs to the person whose work is being reviewed --
      // that is who raised it, and submissions.user_id is a real user id, so
      // it must never be the API key's id (the FK-mismatch class of bug
      // resolveActingUser()'s own comment in auth-guard.ts documents).
      userId: input.designerId,
      status: "in_progress",
    }).returning()

    const [task] = await db.insert(pipelineTasks).values({
      submissionId: submission.id,
      sequence: 0,
      orgId: ctx.orgId,
      projectId: input.projectId,
      projectSource: "stated",
      derivedChain: { root: "Design Studio", steps },
      functionId,
      params: { timeEntryId: input.timeEntryId, designerId: input.designerId, spentOn: input.spentOn },
      executor: "person",
      status: "to_do",
    }).returning()

    return { taskId: task.id, created: true }
  })
}

/**
 * Closes the row when the manager decides. The decision is recorded on the
 * task itself (result), so a reviewer reading Task Master's Done tab sees
 * what was decided rather than a row that merely vanished.
 *
 * Returns how many rows were closed -- 0 is a legitimate answer (an entry
 * submitted before this feature shipped has no row), never an error.
 */
export async function closeTimesheetReviewTask(
  ctx: { orgId: string; userId: string },
  timeEntryId: string,
  decision: "approved" | "rejected",
  rejectionReason?: string | null
) {
  return closeTimesheetTask(ctx, timeEntryId, TIMESHEET_REVIEW_FUNCTION_ID, decision, rejectionReason)
}

/**
 * Closes the DESIGNER's "Needs you" row when they send the corrected hours
 * back. Returns { closed: 0 } for an entry that was never returned, which is
 * the normal case and not an error.
 */
export async function closeTimesheetReturnedTask(ctx: { orgId: string; userId: string }, timeEntryId: string) {
  return closeTimesheetTask(ctx, timeEntryId, TIMESHEET_RETURNED_FUNCTION_ID, "resubmitted")
}

async function closeTimesheetTask(
  ctx: { orgId: string; userId: string },
  timeEntryId: string,
  functionId: string,
  decision: "approved" | "rejected" | "resubmitted",
  rejectionReason?: string | null
) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rows = await db.update(pipelineTasks)
      .set({
        status: "done",
        result: { decision, decidedById: ctx.userId, ...(rejectionReason ? { rejectionReason } : {}) },
        updatedAt: new Date(),
      })
      .where(and(
        eq(pipelineTasks.orgId, ctx.orgId),
        eq(pipelineTasks.functionId, functionId),
        inArray(pipelineTasks.status, [...OPEN_STATUSES]),
        sql`${pipelineTasks.params}->>'timeEntryId' = ${timeEntryId}`
      ))
      .returning({ id: pipelineTasks.id, submissionId: pipelineTasks.submissionId })

    if (rows.length > 0) {
      await db.update(submissions)
        .set({ status: "done" })
        .where(and(eq(submissions.orgId, ctx.orgId), inArray(submissions.id, rows.map((r) => r.submissionId))))
    }
    return { closed: rows.length }
  })
}
