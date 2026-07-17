// VERIDIAN Review Framework Wave 4 (REVIEW-FRAMEWORK-WAVE4) -- HR
// Attendance "Access Control / Role-Based Permissions" remediation.
//
// LOCAL, ATTENDANCE-ONLY PERMISSION CHECK -- explicitly NOT the shared,
// cross-cutting ERP permission utility. This same wave's dispatch plan
// (see CONTROLLER.yaml's REVIEW-FRAMEWORK-WAVE4 entry, dispatch_plan /
// TRACK 1) calls for a shared permission-check utility to be built once
// and reused across the ~21 ERP/Finance modules that share this identical
// gap (General Ledger, Fixed Assets, Sales Orders, Quotations, etc.).
// Checked fresh, immediately before writing this file, for that utility:
//   gh pr list --repo FChecklist/compliance-tracker --state all --limit 40
//   gh pr list --repo FChecklist/compliance-tracker --state open
// Neither merged history nor any open PR contains a shared permission
// utility (no `permission-service.ts` or equivalent exists anywhere in
// src/lib/services/ as of this commit either -- grepped for
// `hasPermission|checkPermission|permissionService` with zero hits). Since
// building that shared utility is explicitly a different track's job (per
// the dispatch instructions for this task), this file is scoped ONLY to
// HR attendance's two read routes (GET /api/hr/attendance and GET
// /api/hr/attendance/summary) and reuses this codebase's EXISTING role
// model (`ROLE_RANK` / the manager-rank bar already enforced on the
// mark-someone-else's-attendance and bulk-mark routes in this same
// module) rather than inventing a new one.
//
// RECONCILE: while finishing this file, incidentally observed (shared
// build scratchpad, not a merged/PR-verified source -- not depended on
// here, per this task's own instruction to only trust merged history or
// an open PR) that a concurrent sibling track appears to be building
// exactly the anticipated shared utility at
// src/lib/services/permission-service.ts: a flat `ERP_ACTION_ROLES:
// Record<string, UserRole>` policy table plus `requirePermissionForUser
// (dbUser, action)` / `requirePermission(ctx, action, scope)` gate
// functions, also built on top of the same auth-guard.ts ROLE_RANK/
// hasRole/requireRole primitives this file uses. When that (or whatever
// actually lands) is confirmed merged, reconciliation is NOT simply
// "delete this file" -- that utility is a fixed-action write GATE
// ("does this action require manager rank", returns allow/deny), whereas
// resolveAttendanceViewerScope solves a different problem: per-request
// READ scoping ("which userId should this query actually run with,
// given who's asking and who they asked for"), which a flat action->role
// table has no slot for. The right reconciliation is most likely:
// register HR attendance's write actions (mark/bulk-mark/holiday
// create-delete) in that utility's ERP_ACTION_ROLES table and call its
// gate functions from this module's write routes (they currently inline
// `requireRole(dbUser, "manager")` directly, same pattern the shared
// utility replaces elsewhere) -- while KEEPING resolveAttendanceViewerScope
// for the two read routes' self-vs-other scoping, possibly rewritten to
// delegate its internal rank check to the shared utility's role table
// instead of importing ROLE_RANK directly. Re-verify the utility's real,
// merged shape before making that call -- this note is a lead, not a
// verified fact.
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
