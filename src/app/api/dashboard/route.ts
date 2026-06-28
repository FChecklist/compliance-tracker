import { db } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const now = new Date();

    // Stats
    const [total, completed, overdue, inProgress, pending, notApplicable] =
      await Promise.all([
        db.complianceItem.count(),
        db.complianceItem.count({ where: { status: "completed" } }),
        db.complianceItem.count({ where: { status: "overdue" } }),
        db.complianceItem.count({ where: { status: "in_progress" } }),
        db.complianceItem.count({ where: { status: "pending" } }),
        db.complianceItem.count({ where: { status: "not_applicable" } }),
      ]);

    const sevenDays = new Date(now.getTime() + 7 * 86400000);
    const dueSoon = await db.complianceItem.count({
      where: {
        dueDate: { lte: sevenDays, gte: now },
        status: { notIn: ["completed", "not_applicable"] },
      },
    });

    // Department breakdown
    const departments = await db.department.findMany({
      include: {
        _count: { select: { compliance: true } },
      },
      orderBy: { compliance: { _count: "desc" } },
    });

    const departmentBreakdown = departments.map((d) => ({
      name: d.name,
      count: d._count.compliance,
    }));

    // Overdue items (top 5)
    const overdueItems = await db.complianceItem.findMany({
      where: { status: "overdue" },
      include: { department: { select: { name: true } } },
      orderBy: { dueDate: "asc" },
      take: 5,
    });

    // Recent activity (last 5 audit logs)
    const recentActivity = await db.auditLog.findMany({
      include: {
        user: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    // Status distribution for donut chart
    const statusDistribution = [
      { name: "Pending", value: pending, color: "#eab308" },
      { name: "In Progress", value: inProgress, color: "#06b6d4" },
      { name: "Completed", value: completed, color: "#10b981" },
      { name: "Overdue", value: overdue, color: "#ef4444" },
      { name: "N/A", value: notApplicable, color: "#a1a1aa" },
    ];

    return NextResponse.json({
      stats: { total, completed, overdue, inProgress, pending, dueSoon, notApplicable },
      departmentBreakdown,
      overdueItems: overdueItems.map((i) => ({
        id: i.id,
        title: i.title,
        department: i.department.name,
        dueDate: i.dueDate?.toISOString(),
        priority: i.priority,
      })),
      recentActivity: recentActivity.map((a) => ({
        id: a.id,
        action: a.action,
        entityType: a.entityType,
        details: a.details,
        userName: a.user.name,
        createdAt: a.createdAt.toISOString(),
      })),
      statusDistribution,
    });
  } catch (error) {
    console.error("Dashboard API error:", error);
    return NextResponse.json({ error: "Failed to load dashboard" }, { status: 500 });
  }
}