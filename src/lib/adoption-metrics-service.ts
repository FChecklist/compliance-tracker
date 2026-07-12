// subagent/audit-lifecycle (tree4-unified/50-completion-plan Priority 2
// item 3, D27/U-D27.B2.S1 "Adoption Dashboard"): confirmed on direct
// verification that no adoption-dashboard/org-metrics aggregation existed
// anywhere -- /dashboard and /veri-todo are work-item-tracking views, not
// org-adoption analytics; OrgLimitsSection.tsx (Wave 172's admin UI) shows
// only seat/cost limits, nothing adoption-shaped. This is the real
// metrics-aggregation service the tree's own instruction names, reusing
// only real, already-existing data (no fabricated numbers) -- same raw-db
// + explicit orgId-filter posture as org-license-service.ts/cost-guard.ts
// (an org-admin-scoped aggregation query, not user-content, matching that
// precedent rather than withTenantContext's RLS-session posture).
//
// Honest scope limitation, stated here rather than silently invented:
// "Hours Saved" (one of the requirement's 10 named metrics) has NO existing
// estimation methodology anywhere in this codebase (confirmed by direct
// search) -- computing a number for it would mean inventing a counterfactual
// "time this would have taken a human" formula with no real basis, exactly
// the kind of fabricated metric this codebase's own discipline elsewhere
// refuses to build (see communication-guardrails.ts's own header for the
// same class of honest omission). hoursSaved is returned as null with an
// explicit reason rather than a made-up figure -- an Owner-defined
// estimation methodology (e.g. minutes-per-task-type assumptions) would
// need to exist first.
import { db, users, veriMeetings, tasks, conversations, savedReports, departments, tokenUsageLedger } from "@/lib/db"
import { eq, and, count, countDistinct, sql } from "drizzle-orm"

export type DepartmentAdoption = {
  departmentId: string
  departmentName: string
  activeUserCount: number
  tasksCompletedCount: number
}

export type AdoptionMetrics = {
  totalUsers: number
  activeUsers: number
  /** % of org users who have completed onboarding (users.onboardingCompleted) -- a real, deterministic adoption signal already tracked per-user. */
  adoptionPercent: number
  /** % of active users who have made at least one AI call this org has ever recorded (distinct token_usage_ledger.userId), the closest real, non-fabricated proxy for "used the AI at all." */
  aiAdoptionPercent: number
  meetingsManaged: number
  tasksCompleted: number
  /** Count of saved_reports rows owned in this org -- a real proxy for "reports generated" (report DEFINITIONS, not a separate generation-event log, which does not exist in this codebase today). */
  reportsGenerated: number
  /** conversations.isAiThread=true count for this org. */
  aiConversations: number
  departmentsActive: number
  totalDepartments: number
  /** Not computable without a defined estimation methodology -- see this module's header. Never fabricated. */
  hoursSaved: null
  hoursSavedNote: string
  departmentBreakdown: DepartmentAdoption[]
  topPerformingDepartment: DepartmentAdoption | null
  lowestAdoptionDepartment: DepartmentAdoption | null
}

/**
 * Computes the real, org-master-admin-facing adoption metrics the tree's
 * U-D27.B2.S1 names. One aggregation pass, mirrors
 * activity-log-service.ts's getGovernanceHealthCounts (a handful of
 * count(*) queries, no invented data). orgId required -- this is always a
 * single-org view (the "Org Master Admin/CEO" dashboard), never cross-org.
 */
export async function computeOrgAdoptionMetrics(orgId: string): Promise<AdoptionMetrics> {
  const [
    [userCounts],
    [meetingCounts],
    [taskCounts],
    [reportCounts],
    [aiConversationCounts],
    [aiUserCounts],
    departmentRows,
    departmentBreakdown,
  ] = await Promise.all([
    db.select({
      totalUsers: count(),
      activeUsers: sql<number>`count(*) filter (where ${users.isActive} = true)::int`,
      onboardedUsers: sql<number>`count(*) filter (where ${users.onboardingCompleted} = true)::int`,
    }).from(users).where(eq(users.orgId, orgId)),
    db.select({ meetingsManaged: count() }).from(veriMeetings).where(eq(veriMeetings.orgId, orgId)),
    db.select({
      tasksCompleted: sql<number>`count(*) filter (where ${tasks.status} = 'completed')::int`,
    }).from(tasks).where(eq(tasks.orgId, orgId)),
    db.select({ reportsGenerated: count() }).from(savedReports).where(eq(savedReports.orgId, orgId)),
    db.select({ aiConversations: count() }).from(conversations).where(and(eq(conversations.orgId, orgId), eq(conversations.isAiThread, true))),
    db.select({ aiUsers: countDistinct(tokenUsageLedger.userId) }).from(tokenUsageLedger).where(eq(tokenUsageLedger.orgId, orgId)),
    db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.orgId, orgId)),
    // Per-department breakdown: active user count + completed-task count for
    // each user assigned to that department, LEFT JOINed so a department
    // with zero completed tasks still appears (0, not silently absent).
    db.select({
      departmentId: departments.id,
      departmentName: departments.name,
      activeUserCount: sql<number>`count(distinct ${users.id}) filter (where ${users.isActive} = true)::int`,
      tasksCompletedCount: sql<number>`count(distinct ${tasks.id}) filter (where ${tasks.status} = 'completed')::int`,
    })
      .from(departments)
      .leftJoin(users, eq(users.departmentId, departments.id))
      .leftJoin(tasks, and(eq(tasks.userId, users.id), eq(tasks.orgId, orgId)))
      .where(eq(departments.orgId, orgId))
      .groupBy(departments.id, departments.name),
  ])

  const totalUsers = userCounts?.totalUsers ?? 0
  const activeUsers = userCounts?.activeUsers ?? 0
  const onboardedUsers = userCounts?.onboardedUsers ?? 0
  const aiUsers = aiUserCounts?.aiUsers ?? 0

  const departmentsActive = departmentBreakdown.filter((d) => d.activeUserCount > 0).length

  // Top/lowest performing: ranked by completed-task count, matching the
  // requirement's own "Top-Performing-Team/Lowest-Adoption" pairing to a
  // real, comparable number -- only departments with at least 1 active user
  // are eligible (an empty department isn't "low adoption", it's just
  // empty, a different concept the requirement's own wording doesn't ask
  // for here).
  const eligible = departmentBreakdown.filter((d) => d.activeUserCount > 0)
  const sortedByTasks = [...eligible].sort((a, b) => b.tasksCompletedCount - a.tasksCompletedCount)
  const topPerformingDepartment = sortedByTasks[0] ?? null
  const lowestAdoptionDepartment = sortedByTasks.length > 0 ? sortedByTasks[sortedByTasks.length - 1] : null

  return {
    totalUsers,
    activeUsers,
    adoptionPercent: totalUsers > 0 ? Math.round((onboardedUsers / totalUsers) * 1000) / 10 : 0,
    aiAdoptionPercent: activeUsers > 0 ? Math.round((aiUsers / activeUsers) * 1000) / 10 : 0,
    meetingsManaged: meetingCounts?.meetingsManaged ?? 0,
    tasksCompleted: taskCounts?.tasksCompleted ?? 0,
    reportsGenerated: reportCounts?.reportsGenerated ?? 0,
    aiConversations: aiConversationCounts?.aiConversations ?? 0,
    departmentsActive,
    totalDepartments: departmentRows.length,
    hoursSaved: null,
    hoursSavedNote: "Not computed -- no estimation methodology exists anywhere in this codebase (confirmed by direct search) to convert AI-assisted activity into a counterfactual human-hours figure. Needs an Owner-defined formula (e.g. minutes-per-task-type assumptions) before this can be a real number rather than an invented one.",
    departmentBreakdown,
    topPerformingDepartment,
    lowestAdoptionDepartment,
  }
}
