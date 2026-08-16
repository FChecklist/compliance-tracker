// VERIDIAN Review Framework Wave 4 (REVIEW-FRAMEWORK-WAVE4) -- HR
// Attendance "Access Control / Role-Based Permissions" remediation.
//
// LOCAL READ-SCOPING HELPER -- deliberately NOT superseded by the shared
// cross-cutting ERP permission utility (src/lib/services/permission-
// service.ts, merged as part of this same wave, PR #401, ERP_ACTION_ROLES
// + requirePermissionForUser/requirePermission). That utility is a
// fixed-action write GATE ("does this action require manager rank",
// allow/deny) -- it has no slot for this file's actual problem, which is
// per-request READ scoping ("which userId should this query run with,
// given who's asking and who they asked for"). So this file is NOT a
// stopgap superseded by that utility; it solves a genuinely different
// concern and is expected to keep existing alongside it.
//
// What WAS reconciled once permission-service.ts confirmed-merged (this
// same commit): this module's WRITE routes (mark-someone-else,
// bulk-mark, holiday create/delete) previously inlined
// `requireRole(dbUser, "manager")` directly -- now registered as
// `erp.hr_attendance.mark_other` / `erp.hr_attendance.holiday_manage` in
// permission-service.ts's ERP_ACTION_ROLES and gated via
// `requirePermissionForUser()`, exactly the pattern that utility's own
// header comment asks every module to follow instead of a bare role
// string literal. Only this file's own two read routes (GET
// /api/hr/attendance, GET /api/hr/attendance/summary) still use
// resolveAttendanceViewerScope() below, and still reuse this codebase's
// EXISTING role model (`ROLE_RANK` from auth-guard.ts) directly rather
// than inventing a new one -- consistent with, not competing against,
// the shared utility.
//
// History: at the time this file was first written, `gh pr list --state
// all/open` against FChecklist/compliance-tracker showed no shared
// permission utility yet (merged or open) -- built as a local fallback
// per this task's own dispatch instructions. permission-service.ts
// merged (PR #401) shortly after, from a concurrent sibling track,
// before this PR itself was opened -- rebased onto it and reconciled the
// write-route call sites above in the same commit, rather than shipping
// a competing inline check.
import { ROLE_RANK, type UserRole } from "@/lib/supabase/auth-guard"
import { ServiceError } from "./compliance-service"

export type AttendanceViewer = { id: string; role: string | null } | null

function isManagerOrAbove(viewer: AttendanceViewer): boolean {
  if (!viewer) return false
  const rank = ROLE_RANK[viewer.role as UserRole] ?? 0
  return rank >= ROLE_RANK.manager
}

/**
 * Attendance records and monthly summaries are personal HR data (check-in/
 * check-out timestamps, leave linkage, manager notes). Before this fix,
 * both GET /api/hr/attendance and GET /api/hr/attendance/summary called
 * requireAuth() only -- ANY authenticated org member could read ANY other
 * named employee's attendance (`?userId=<anyone>`) or every employee's at
 * once (no filter at all = org-wide), with zero role check. That's the
 * real Weight-5-Critical "Access Control" gap this closes for HR
 * Attendance -- contrast with the mark/bulk-mark/holiday-write routes in
 * this same module, which already correctly gate non-self writes behind
 * `requireRole(dbUser, "manager")`.
 *
 * Returns the userId the query should actually run with:
 * - manager-or-above (same rank bar already used elsewhere in this
 *   module): whatever they asked for, including `undefined` (org-wide --
 *   managers are already trusted with org-wide bulk-mark and holiday
 *   writes, so org-wide read is consistent, not a broadening).
 * - below manager: always forced to their own id. Explicitly asking for
 *   a *different* named user's id is a 403, not a silent downgrade to
 *   "your own records instead" -- a caller who asked for user X and
 *   silently got user Y's data back with a 200 could easily mistake it
 *   for a real bug rather than a permission boundary. Omitting `userId`
 *   entirely (or passing only departmentId/companyId) is silently scoped
 *   to self, since that's the same request shape a manager would use to
 *   ask for "everyone" -- there is no ambiguity to preserve there.
 */
export function resolveAttendanceViewerScope(
  viewer: AttendanceViewer,
  requestedUserId: string | undefined
): string | undefined {
  if (!viewer) throw new ServiceError("Not authenticated", 401)
  if (isManagerOrAbove(viewer)) return requestedUserId
  if (requestedUserId && requestedUserId !== viewer.id) {
    throw new ServiceError("You can only view your own attendance records", 403)
  }
  return viewer.id
}
