// Wave 15: Home Page's Analytics tab -- one real, role-branched rollup.
// Content varies by rank (individual pace for an IC, team rollup for a
// manager, org-wide for higher ranks); the TAB ITSELF is never renamed,
// hidden, or given a different variant per rank -- only what's inside it.
import { complianceItems, tasks, users } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and, inArray, sql } from "drizzle-orm"
import { ROLE_RANK, type UserRole } from "@/lib/supabase/auth-guard"

export type AnalyticsScope = "individual" | "team" | "org"

function scopeForRole(role: string): AnalyticsScope {
  const rank = ROLE_RANK[role as UserRole] ?? 0
  if (rank >= 4) return "org" // branch_manager, admin, veridian_admin
  if (rank === 3) return "team" // manager, senior_professional
  return "individual" // member, team_member, viewer-tier
}

export async function getAnalyticsRollup(ctx: { orgId: string; userId: string; role: string }) {
  const { orgId, userId, role } = ctx
  const scope = scopeForRole(role)

  return withTenantContext({ orgId, userId }, async (db) => {
    let scopedUserIds: string[] | null = null // null == org-wide, no user filter
    if (scope === "individual") {
      scopedUserIds = [userId]
    } else if (scope === "team") {
      const reports = await db.query.users.findMany({
        where: eq(users.reportingToId, userId),
        columns: { id: true },
      })
      scopedUserIds = [userId, ...reports.map((r) => r.id)]
    }

    const complianceRows = await db
      .select({ status: complianceItems.status, count: sql<number>`count(*)::int` })
      .from(complianceItems)
      .where(
        scopedUserIds
          ? and(eq(complianceItems.orgId, orgId), inArray(complianceItems.assignedToId, scopedUserIds))
          : eq(complianceItems.orgId, orgId)
      )
      .groupBy(complianceItems.status)

    const taskRows = await db
      .select({ status: tasks.status, count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(
        scopedUserIds
          ? and(eq(tasks.orgId, orgId), inArray(tasks.userId, scopedUserIds))
          : eq(tasks.orgId, orgId)
      )
      .groupBy(tasks.status)

    return {
      scope,
      peopleCount: scopedUserIds?.length ?? null,
      complianceByStatus: Object.fromEntries(complianceRows.map((r) => [r.status, r.count])),
      taskByStatus: Object.fromEntries(taskRows.map((r) => [r.status, r.count])),
    }
  })
}
