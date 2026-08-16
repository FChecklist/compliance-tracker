// tree4-unified U-D25.B1.S1 ("Software (without AI) tracks completed vs.
// pending tasks, pushes incomplete tasks toward completion... software
// sends AI a single batched ping about all tasks (token-efficient)").
//
// Confirmed absent before this wave on two counts: (1) email.ts's
// notifyOverdue() exists but has ZERO callers anywhere in the codebase
// (confirmed by grep) -- dead code, no active nudge mechanism runs today;
// (2) llm-routing-gate.ts's check_status handler (response-engine.ts's real
// consumer) answers about exactly one task (the most recent), not "all
// tasks" -- there was no batched-summary path at all.
//
// This module builds both pieces for real, reusing existing infrastructure
// rather than inventing new shapes: `notifications` (the same table Wave 38's
// metric-alert-service.ts already writes real rows to) for delivery, and
// response-engine.ts's ShortReply vocabulary (Wave 154) for the "single
// batched ping" text -- summarizeNudgeGroup() is the batched analog of
// llm-routing-gate.ts's per-task suggestReplyForTaskStatus() call, covering
// a user's entire active-task load in one deterministic reply instead of
// one LLM/DB round trip per task.
//
// Explicitly NOT covered by this module (see 04-implementation-log.yaml's
// entry for this dispatch): "recurring AI-assisted tasks evaluated for
// automation conversion" -- the `tasks` schema has no recurrence concept at
// all (no isRecurring/recurrenceRule column), so there is nothing to
// evaluate for conversion yet; adding one is real schema work, not a narrow
// slice of this feature. "software multi-tasks for a user without AI,
// driven by the Dynamic Chain" is a SEPARATE requirement already satisfied
// elsewhere -- VeriComposer.tsx's expandPathsForSend() creates N real tasks
// from one multi-select Dynamic Chain path with a plain JS .map(), zero LLM
// call -- verified directly, no code needed for that piece.
import { db, tasks, notifications } from "@/lib/db"
import { and, inArray, isNotNull } from "drizzle-orm"
import { formatShortReply, renderShortReply, type ShortReply } from "@/lib/response-engine"

const ACTIVE_STATUSES = ["pending", "in_progress"] as const
const DUE_SOON_WINDOW_DAYS = 3

export type NudgeTaskRow = { id: string; title: string; status: string; dueDate: Date; userId: string }

export type UserNudgeGroup = { userId: string; overdue: NudgeTaskRow[]; dueSoon: NudgeTaskRow[] }

/**
 * Pure: groups active (pending/in_progress), dated tasks by user into
 * overdue/due-soon buckets relative to `now`. A task exactly at `now` is
 * NOT overdue (strict less-than) -- it becomes overdue the instant it's
 * actually past due, not preemptively.
 */
export function groupTasksForNudge(rows: NudgeTaskRow[], now: Date = new Date(), dueSoonWindowDays: number = DUE_SOON_WINDOW_DAYS): UserNudgeGroup[] {
  const byUser = new Map<string, UserNudgeGroup>()
  const dueSoonCutoff = new Date(now.getTime() + dueSoonWindowDays * 86_400_000)
  for (const row of rows) {
    let group = byUser.get(row.userId)
    if (!group) {
      group = { userId: row.userId, overdue: [], dueSoon: [] }
      byUser.set(row.userId, group)
    }
    if (row.dueDate < now) group.overdue.push(row)
    else if (row.dueDate <= dueSoonCutoff) group.dueSoon.push(row)
  }
  return [...byUser.values()]
}

/**
 * Pure: the "single batched ping" -- ONE short reply (response-engine.ts's
 * existing 4-word vocabulary) summarizing a user's entire nudge-worthy task
 * load, instead of a separate check per task. Overdue takes priority over
 * due-soon when a user has both (the more urgent signal wins the one slot).
 */
export function summarizeNudgeGroup(group: UserNudgeGroup): ShortReply {
  if (group.overdue.length > 0) {
    const detail = group.overdue.length === 1 ? group.overdue[0].title : `${group.overdue.length} tasks`
    return formatShortReply("pending", `${detail} overdue`)
  }
  if (group.dueSoon.length > 0) {
    const detail = group.dueSoon.length === 1 ? group.dueSoon[0].title : `${group.dueSoon.length} tasks`
    return formatShortReply("pending", `${detail} due soon`)
  }
  return formatShortReply("ok", "nothing due")
}

/**
 * Real DB aggregation + delivery: scans every active, dated task platform-
 * wide (this is a scheduled platform job, not an org-scoped request -- same
 * posture as metric-alert-service.ts's evaluateAllMetricAlertRules()),
 * groups per user, and for every user with at least one overdue or
 * due-soon task writes exactly ONE `notifications` row (the batched ping --
 * never one row per task). Users with nothing overdue/due-soon get no
 * notification at all, not a reassuring "all clear" ping -- the whole
 * point is reducing noise, not adding a new kind of it.
 */
export async function runTaskNudgeDigest(): Promise<{ usersNotified: number; tasksCovered: number }> {
  const rows = await db.query.tasks.findMany({
    where: and(inArray(tasks.status, [...ACTIVE_STATUSES]), isNotNull(tasks.dueDate), isNotNull(tasks.userId)),
    columns: { id: true, title: true, status: true, dueDate: true, userId: true },
  })
  const activeRows: NudgeTaskRow[] = rows
    .filter((r): r is typeof r & { userId: string; dueDate: Date } => r.userId !== null && r.dueDate !== null)
    .map((r) => ({ id: r.id, title: r.title, status: r.status, dueDate: r.dueDate, userId: r.userId }))

  const groups = groupTasksForNudge(activeRows)

  let usersNotified = 0
  let tasksCovered = 0
  for (const group of groups) {
    if (group.overdue.length === 0 && group.dueSoon.length === 0) continue
    const reply = summarizeNudgeGroup(group)
    await db.insert(notifications).values({
      userId: group.userId,
      title: "Task nudge",
      message: renderShortReply(reply),
      type: "deadline_reminder",
      metadata: {
        kind: "task_nudge_digest",
        overdueTaskIds: group.overdue.map((t) => t.id),
        dueSoonTaskIds: group.dueSoon.map((t) => t.id),
      },
    })
    usersNotified++
    tasksCovered += group.overdue.length + group.dueSoon.length
  }
  return { usersNotified, tasksCovered }
}
