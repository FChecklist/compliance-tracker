// GAP-CONTINUOUS-REPRIORITIZATION (Tree 1 D22.B2.S1, ai-os/MASTER-TRACKER.yaml
// / ai-os/tree4-unified/10-merged-governance-layer.yaml U-D22.B2.S1). The
// full requirement names 8 axes: "Deadlines, Business priorities,
// Dependencies, Resource availability, Organizational objectives, User
// preferences, Risk, SLA." This file deliberately builds ONE real, narrow,
// deterministic slice of that -- deadline proximity + already-overdue status
// on `tasks` itself -- and explains below exactly why the rest weren't
// attempted, rather than fabricating a broader engine.
//
// What's real and what isn't, checked by direct investigation before writing
// any code here:
//   - Deadlines: REAL. `tasks.dueDate` and `tasks.status` are both real
//     columns already relied on by work-dashboard-service.ts's
//     categorizeTask() and task-service.ts's isTaskOverdue(). This is the one
//     axis this file implements.
//   - SLA: NOT REAL for `tasks`. `tickets.slaDeadline` is genuine SLA data
//     (see ticket-service.ts's checkTicketSlaBreaches), but nothing links a
//     `tasks` row to a `tickets` row -- there is no ticketId/complianceItemId
//     column on `tasks`, and a repo-wide search confirms entity_relationships
//     (the one generic graph table that could carry such a link) is never
//     written with sourceType or targetType 'task' anywhere in this
//     codebase. A task cannot inherit an SLA deadline that nothing connects
//     it to.
//   - Dependencies: NOT REAL for `tasks`. Same entity_relationships search:
//     zero 'depends_on'/'blocks' edges (or any edges at all) are ever
//     written with a task on either end. task-service.ts's own comment
//     above isTaskOverdue() already documents this: "Blocked/Delegated/
//     Waiting-dependency/Inactive states have no equivalent in `tasks.status`
//     's 5-value enum ... without a schema change this pass didn't attempt."
//   - Risk, Resource availability, Organizational objectives, User
//     preferences, Business priorities: NOT REAL for `tasks`. None of these
//     has a column, enum value, or linked table on `tasks` today. Deriving
//     any of them would mean inventing a proxy signal, which is exactly the
//     "force something in" outcome the task brief said not to do.
//
// So: this is an honest, narrower slice than the full requirement, built
// because the deadline axis alone is real, checkable, and worth landing --
// not because the other 7 axes turned out easy too.
//
// Design choice: escalation-only, never downgrade. There is no real signal
// anywhere in this schema for "this task's urgency just decreased" (nothing
// records a due-date extension event or a deliberate priority-lowering
// decision) -- only two real escalation signals exist (a due date drawing
// close, and a due date already passed). Recalculating downward from those
// same two signals would mean inventing a rule with no basis ("no signal
// fired today" is not evidence urgency decreased), and would risk silently
// overriding a priority a human deliberately set high for a reason this
// engine can't see. So computeReprioritizedPriority() only ever raises
// `priority`, never lowers it -- matching this file's own "deterministic,
// real signals only" mandate rather than fabricating symmetry.
import { db, tasks } from "@/lib/db"
import { and, eq, isNotNull, notInArray } from "drizzle-orm"
import { VALID_PRIORITIES } from "./task-service"

export type ReprioritizationReason = "overdue" | "due_within_24h" | "due_within_72h"

const MS_PER_HOUR = 60 * 60 * 1000
const DUE_SOON_HOURS = 24
const DUE_APPROACHING_HOURS = 72

// Matches VALID_PRIORITIES' own "Low, Normal, High, Urgent" comment
// (task-service.ts) -- named here instead of using bare numbers so the
// escalation ladder below reads as intent, not magic constants.
const PRIORITY_URGENT = 3
const PRIORITY_HIGH = 2
const PRIORITY_NORMAL = 1

// Same terminal-status set isTaskOverdue()/checkTaskOverdue() already use --
// a completed or cancelled task has no meaningful "urgency" left to
// recalculate, regardless of how far past its due date it is.
const TERMINAL_STATUSES = ["completed", "cancelled"]

/**
 * Pure recalculation core -- unit-testable without a DB, matching this
 * repo's established pure-core/DB-shell split (validateChainDepth,
 * isTaskOverdue, categorizeTask). Returns null when no real signal applies
 * (no due date, terminal status) OR when the deterministic floor for the
 * current due-date proximity is already at or below the task's current
 * priority -- i.e. "no write needed," not "no opinion." Never returns a
 * priority outside VALID_PRIORITIES and never returns a value <= the
 * task's current priority (escalation-only, see file header).
 */
export function computeReprioritizedPriority(
  task: { status: string; dueDate: Date | null; priority: number },
  now: Date
): { priority: number; reason: ReprioritizationReason } | null {
  if (TERMINAL_STATUSES.includes(task.status)) return null
  if (!task.dueDate) return null

  const msUntilDue = task.dueDate.getTime() - now.getTime()

  let floor: number
  let reason: ReprioritizationReason
  if (msUntilDue < 0) {
    floor = PRIORITY_URGENT
    reason = "overdue"
  } else if (msUntilDue < DUE_SOON_HOURS * MS_PER_HOUR) {
    floor = PRIORITY_HIGH
    reason = "due_within_24h"
  } else if (msUntilDue < DUE_APPROACHING_HOURS * MS_PER_HOUR) {
    floor = PRIORITY_NORMAL
    reason = "due_within_72h"
  } else {
    return null // due date too far out to carry a real deadline signal
  }

  if (floor <= task.priority) return null // already at/above the deterministic floor -- no write
  return { priority: floor, reason }
}

export type ReprioritizationUpdate = {
  id: string
  orgId: string
  from: number
  to: number
  reason: ReprioritizationReason
}

/**
 * Cross-org by necessity (a cron job, not a request scoped to one tenant) --
 * same posture and raw `db` client as task-service.ts's checkTaskOverdue()
 * and ticket-service.ts's checkTicketSlaBreaches(), which this function is
 * deliberately modeled on. Real WRITE to tasks.priority (not another
 * read-only categorization -- work-dashboard-service.ts's categorizeTask()
 * already covers that half). Idempotent per row: once a task's priority has
 * been raised to the deterministic floor for its current due-date proximity,
 * later runs see floor <= priority and skip it -- no repeated writes for an
 * unchanged due date.
 */
export async function reprioritizeTasks(now: Date = new Date()): Promise<{
  evaluated: number
  updated: number
  updates: ReprioritizationUpdate[]
}> {
  const candidates = await db.query.tasks.findMany({
    where: and(isNotNull(tasks.dueDate), notInArray(tasks.status, TERMINAL_STATUSES)),
  })

  const updates: ReprioritizationUpdate[] = []
  for (const task of candidates) {
    const result = computeReprioritizedPriority(
      { status: task.status, dueDate: task.dueDate, priority: task.priority },
      now
    )
    if (!result) continue
    if (!VALID_PRIORITIES.includes(result.priority)) continue // defensive; computeReprioritizedPriority never produces this

    await db
      .update(tasks)
      .set({
        priority: result.priority,
        lastReprioritizedAt: now,
        lastReprioritizationReason: result.reason,
        updatedAt: now,
      })
      .where(eq(tasks.id, task.id))

    updates.push({ id: task.id, orgId: task.orgId, from: task.priority, to: result.priority, reason: result.reason })
  }

  return { evaluated: candidates.length, updated: updates.length, updates }
}
