import { db, complianceItems, departments, auditLogs, notices, users } from "@/lib/db";
import { NextResponse } from "next/server";
import { eq, and, not, inArray, gte, lte, asc, desc, sql } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  try {
    const now = new Date()
    const weekEnd = new Date(now.getTime() + 7 * 86400000)
    const monthEnd = new Date(now.getTime() + 30 * 86400000)

    // Overdue sync is handled by POST /api/compliance/overdue — not in GET

    const notDoneStatuses = ['completed', 'not_applicable'] as const
    const orgFilter = eq(complianceItems.orgId, orgId ?? '')

    const [total, completed, overdue, inProgress, pending, notApplicable, dueThisWeek, dueIn30Days] =
      await Promise.all([
        db.select({ count: sql<number>`count(*)::int` }).from(complianceItems).where(orgFilter).then(r => r[0].count),
        db.select({ count: sql<number>`count(*)::int` }).from(complianceItems).where(and(orgFilter, eq(complianceItems.status, 'completed'))).then(r => r[0].count),
        db.select({ count: sql<number>`count(*)::int` }).from(complianceItems).where(and(orgFilter, eq(complianceItems.status, 'overdue'))).then(r => r[0].count),
        db.select({ count: sql<number>`count(*)::int` }).from(complianceItems).where(and(orgFilter, eq(complianceItems.status, 'in_progress'))).then(r => r[0].count),
        db.select({ count: sql<number>`count(*)::int` }).from(complianceItems).where(and(orgFilter, eq(complianceItems.status, 'pending'))).then(r => r[0].count),
        db.select({ count: sql<number>`count(*)::int` }).from(complianceItems).where(and(orgFilter, eq(complianceItems.status, 'not_applicable'))).then(r => r[0].count),
        db.select({ count: sql<number>`count(*)::int` }).from(complianceItems)
          .where(and(orgFilter, gte(complianceItems.dueDate, now), lte(complianceItems.dueDate, weekEnd), not(inArray(complianceItems.status, [...notDoneStatuses]))))
          .then(r => r[0].count),
        db.select({ count: sql<number>`count(*)::int` }).from(complianceItems)
          .where(and(orgFilter, gte(complianceItems.dueDate, now), lte(complianceItems.dueDate, monthEnd), not(inArray(complianceItems.status, ['completed', 'not_applicable', 'overdue']))))
          .then(r => r[0].count),
      ])

    const depts = await db.query.departments.findMany({
      with: { complianceItems: true },
      orderBy: asc(departments.name),
      where: orgId ? eq(departments.orgId, orgId) : undefined,
    })

    const byDepartment = depts.map((dept) => {
      const items = dept.complianceItems
      return {
        name: dept.name,
        total: items.length,
        overdue: items.filter(i => i.status === 'overdue').length,
        pending: items.filter(i => i.status === 'pending' || i.status === 'in_progress').length,
        safe: items.filter(i => i.status === 'completed' || i.status === 'not_applicable').length,
      }
    })

    const upcomingDeadlines = await db.query.complianceItems.findMany({
      where: and(
        orgFilter,
        not(inArray(complianceItems.status, [...notDoneStatuses])),
        gte(complianceItems.dueDate, now),
      ),
      with: {
        department: { columns: { name: true } },
        assignedTo: { columns: { name: true, avatarUrl: true } },
      },
      orderBy: asc(complianceItems.dueDate),
      limit: 5,
    })

    // Scope recent activity to this org's users only
    const orgUserIds = orgId
      ? (await db.select({ id: users.id }).from(users).where(eq(users.orgId, orgId))).map(u => u.id)
      : []

    const recentActivity = await db.query.auditLogs.findMany({
      where: orgUserIds.length > 0 ? inArray(auditLogs.userId, orgUserIds) : undefined,
      with: { user: { columns: { name: true } } },
      orderBy: desc(auditLogs.createdAt),
      limit: 8,
    })

    const noticeCount = await db.select({ count: sql<number>`count(*)::int` })
      .from(notices)
      .where(orgId ? eq(notices.orgId, orgId) : undefined)
      .then(r => r[0].count)

    return NextResponse.json({
      total,
      overdue,
      dueThisWeek,
      completed,
      dueIn30Days,
      safe: completed,
      noticeCount,
      byDepartment,
      upcomingDeadlines: upcomingDeadlines.map(i => ({
        id: i.id,
        title: i.title,
        department: i.department.name,
        dueDate: i.dueDate?.toISOString(),
        assignedTo: i.assignedTo?.name ?? 'Unassigned',
        status: i.status,
      })),
      recentActivity: recentActivity.map(a => ({
        id: a.id,
        action: a.action,
        entityType: a.entityType,
        details: a.details,
        userName: a.user.name,
        createdAt: a.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error("Stats API error:", error)
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: "Failed to fetch stats", debug: msg }, { status: 500 })
  }
}
