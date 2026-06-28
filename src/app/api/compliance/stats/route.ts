import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

export async function GET() {
  try {
    const now = new Date();

    const [total, completed, overdue, inProgress, pending, notApplicable] =
      await Promise.all([
        db.complianceItem.count(),
        db.complianceItem.count({ where: { status: "completed" } }),
        db.complianceItem.count({ where: { status: "overdue" } }),
        db.complianceItem.count({ where: { status: "in_progress" } }),
        db.complianceItem.count({ where: { status: "pending" } }),
        db.complianceItem.count({ where: { status: "not_applicable" } }),
      ]);

    // Due this week: items due within 7 days that are not completed/NA
    const weekEnd = new Date(now.getTime() + 7 * 86400000);
    const dueThisWeek = await db.complianceItem.count({
      where: {
        dueDate: { lte: weekEnd, gte: now },
        status: { notIn: ["completed", "not_applicable"] },
      },
    });

    // Due in 30 days (for health ribbon)
    const monthEnd = new Date(now.getTime() + 30 * 86400000);
    const dueIn30Days = await db.complianceItem.count({
      where: {
        dueDate: { lte: monthEnd, gte: now },
        status: { notIn: ["completed", "not_applicable", "overdue"] },
      },
    });

    // Safe count: not overdue, not due in 30 days, not completed, not NA
    const safe = pending + inProgress - dueIn30Days;

    // Department breakdown for pendency bar chart
    const departments = await db.department.findMany({
      include: {
        compliance: true,
      },
      orderBy: { name: "asc" },
    });

    const byDepartment = departments.map((dept) => {
      const deptItems = dept.compliance;
      const overdueCount = deptItems.filter((i) => i.status === "overdue").length;
      const pendingCount = deptItems.filter(
        (i) => i.status === "pending" || i.status === "in_progress"
      ).length;
      const safeCount = deptItems.filter((i) => i.status === "completed" || i.status === "not_applicable").length;

      return {
        name: dept.name,
        total: deptItems.length,
        overdue: overdueCount,
        pending: pendingCount,
        safe: safeCount,
      };
    });

    // Upcoming deadlines (next 5 items due, not completed)
    const upcomingDeadlines = await db.complianceItem.findMany({
      where: {
        status: { notIn: ["completed", "not_applicable"] },
        dueDate: { gte: now },
      },
      include: {
        department: { select: { name: true } },
        assignedTo: { select: { name: true, avatarUrl: true } },
      },
      orderBy: { dueDate: "asc" },
      take: 5,
    });

    // Recent activity (last 8 audit logs)
    const recentActivity = await db.auditLog.findMany({
      include: {
        user: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 8,
    });

    return NextResponse.json({
      total,
      overdue,
      dueThisWeek,
      completed,
      dueIn30Days,
      safe: Math.max(0, safe),
      byDepartment,
      upcomingDeadlines: upcomingDeadlines.map((i) => ({
        id: i.id,
        title: i.title,
        department: i.department.name,
        dueDate: i.dueDate?.toISOString(),
        assignedTo: i.assignedTo?.name ?? "Unassigned",
        status: i.status,
      })),
      recentActivity: recentActivity.map((a) => ({
        id: a.id,
        action: a.action,
        entityType: a.entityType,
        details: a.details,
        userName: a.user.name,
        createdAt: a.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Stats API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}