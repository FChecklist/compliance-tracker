// src/lib/services/notification-priority-service.ts
//
// audit198 RULE-043 gap closure ("Notifications shall be prioritized
// intelligently to prevent information overload while ensuring that users
// always know their next most important action"). Before this file, the
// `notifications` table (src/lib/db/schema.ts) had no priority concept at
// all -- confirmed by direct read of the schema before writing any of this
// (AI_ENGINEERING_POLICY.yaml: check existing DB capability before new
// code). It also had ~12 independent insert call sites across
// src/lib/services/*.ts and no single place that reasoned about ordering.
//
// This is a two-layer fix, not a duplicate of the DB trigger:
//   1. WRITE side (authoritative): drizzle migration 0251 adds a
//      `priority` column (reusing the existing priorityEnum, not a new
//      enum) and a `compute_notification_priority()` BEFORE INSERT
//      trigger that derives it from `type` + `metadata` server-side --
//      every existing and future insert call site gets real
//      prioritization for free, with zero changes to any of those ~12
//      call sites. That trigger is the single source of truth for WHAT
//      priority a notification gets; see that migration's header for the
//      exact CASE logic.
//   2. READ side (this file): pure, DB-agnostic ranking + overload-
//      prevention helpers the API/UI layer uses to turn "N rows with a
//      priority column" into "the user's next most important action is
//      obvious, and low-value noise doesn't bury it." This is genuinely
//      new logic (sorting + capping + summarizing), not a restatement of
//      the trigger's classification rule.
import type { notifications } from "@/lib/db/schema"

export type NotificationPriority = "critical" | "high" | "medium" | "low"

// Order matters: index 0 is shown first. Matches priorityEnum's declared
// values (low/medium/high/critical) inverted for "most important first".
const PRIORITY_RANK: Record<NotificationPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

export function priorityRank(p: string): number {
  return PRIORITY_RANK[p as NotificationPriority] ?? PRIORITY_RANK.medium
}

export type NotificationRow = Pick<
  typeof notifications.$inferSelect,
  "id" | "priority" | "isRead" | "createdAt"
>

/**
 * Stable sort: priority first (critical -> low), then most recent first
 * within the same priority. Unread notifications of equal priority sort
 * ahead of already-read ones, so a stale read `critical` item never
 * displaces a fresh unread `high` one from the top of the list -- the
 * literal "users always know their next most important ACTION" clause in
 * RULE-043's own text (read notifications require no further action).
 */
export function rankNotifications<T extends NotificationRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.isRead !== b.isRead) return a.isRead ? 1 : -1
    const rankDiff = priorityRank(a.priority) - priorityRank(b.priority)
    if (rankDiff !== 0) return rankDiff
    return b.createdAt.getTime() - a.createdAt.getTime()
  })
}

export interface OverloadCappedResult<T> {
  visible: T[]
  overflow: Partial<Record<NotificationPriority, number>>
  overflowCount: number
}

/**
 * Information-overload prevention (RULE-043's "prevent information
 * overload" clause, distinct from ranking above): critical/high items are
 * never capped -- those ARE the "next most important action" and hiding
 * one would defeat the rule. `low` (and `medium` beyond a smaller cap)
 * priority items are capped per-bucket; anything beyond the cap is
 * summarized as a count instead of silently dropped, so the caller can
 * render "+12 more low-priority updates" rather than either flooding the
 * UI or discarding data.
 */
export function capForOverload<T extends NotificationRow>(
  ranked: T[],
  caps: Partial<Record<NotificationPriority, number>> = { medium: 15, low: 5 }
): OverloadCappedResult<T> {
  const shown: Record<NotificationPriority, number> = { critical: 0, high: 0, medium: 0, low: 0 }
  const visible: T[] = []
  const overflow: Partial<Record<NotificationPriority, number>> = {}

  for (const row of ranked) {
    const p = (row.priority as NotificationPriority) ?? "medium"
    const cap = caps[p]
    if (cap === undefined || shown[p] < cap) {
      visible.push(row)
      shown[p]++
    } else {
      overflow[p] = (overflow[p] ?? 0) + 1
    }
  }

  const overflowCount = Object.values(overflow).reduce((sum, n) => sum + (n ?? 0), 0)
  return { visible, overflow, overflowCount }
}

/**
 * Convenience entry point combining both steps for the common API-route
 * case: rank, then cap for overload.
 */
export function prioritizeForDisplay<T extends NotificationRow>(
  rows: T[],
  caps?: Partial<Record<NotificationPriority, number>>
): OverloadCappedResult<T> {
  return capForOverload(rankNotifications(rows), caps)
}
