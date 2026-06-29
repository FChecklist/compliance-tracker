import { db, complianceItems, departments, auditLogs } from "@/lib/db";
import { NextResponse } from "next/server";
import { eq, and, not, inArray, gte, lte, asc, desc, sql } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";

export async function GET() {
  const { response } = await requireAuth()
  if (response) return response
  try {
    const now = new Date()
    const weekEnd = new Date(now.getTime() + 7 * 86400000)
    const monthEnd = new Date(now.getTime() + 30 * 86400000)

    const notDoneStatuses = ['completed', 'not_applicable'] as const

    const [total, completed, overdue, inProgress, pending, notApplicable, dueThisWeek, dueIn30Days] =
      await Promise.all([
        db.select({ count: sql<number>`count(*)::int` }).from(complianceItems).then(r => r[0].count),
        db.select({ count: sql<number>`count(*)::int` }).from(complianceItems).where(eq(complianceItems.status, 'completed')).then(r => r[0].count),
        db.select({ count: sql<number>`count(*)::int` }).from(complianceItems).where(eq(complianceItems.status, 'overdue')).then(r => r[0].count),
        db.select({ count: sql<number>`count(*)::int` }).from(complianceItems).where(eq(complianceItems.status, 'in_progress')).then(r => r[0].count),
        db.select({ count: sql<number>`count(*)::int` }).from(complianceItems).where(eq(complianceItems.status, 'pending')).then(r => r[0].count),
        db.select({ count: sql<number>`count(*)::int` }).from(complianceItems).where(eq(complianceItems.status, 'not_applicable')).then(r => r[0].count),
        db.select({ count: sql<number>`count(*)::int` }).from(complianceItems)
          .where(and(gte(complianceItems.dueDate, now), lte(complianceItems.dueDate, weekEnd), not(inArray(complianceItems.status, [...notDoneStatuses]))))
          .then(r => r[0].count),
        db.select({ count: sql<number>`count(*)::int` }).from(complianceItems)
          .where(and(gte(complianceItems.dueDate, now), lte(complianceItems.dueDate, monthEnd), not(inArray(complianceItems.status, ['completed', 'not_applicable', 'overdue']))))
          .then(r => r[0].count),
      ])

    const depts = await db.query.departments.findMany({
      with: { complianceItems: true },
      orderBy: asc(departments.name),
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

    const recentActivity = await db.query.auditLogs.findMany({
      with: { user: { columns: { name: true } } },
      orderBy: desc(auditLogs.createdAt),
      limit: 8,
    })

    return NextResponse.json({
      total,
      overdue,
      dueThisWeek,
      completed,
      dueIn30Days,
      safe: Math.max(0, pending + inProgress - dueIn30Days),
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
