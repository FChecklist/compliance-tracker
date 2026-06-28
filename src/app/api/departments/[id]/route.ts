import { db } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const department = await db.department.findUnique({
      where: { id },
      include: {
        compliance: {
          orderBy: { dueDate: "asc" },
        },
        users: {
          select: { id: true, name: true, role: true },
        },
      },
    });

    if (!department) {
      return NextResponse.json({ error: "Department not found" }, { status: 404 });
    }

    const statusCounts = {
      pending: 0,
      in_progress: 0,
      completed: 0,
      overdue: 0,
      not_applicable: 0,
    };

    for (const item of department.compliance) {
      statusCounts[item.status as keyof typeof statusCounts]++;
    }

    return NextResponse.json({
      department: {
        id: department.id,
        name: department.name,
        description: department.description,
        complianceCount: department.compliance.length,
        statusCounts,
        users: department.users,
        complianceItems: department.compliance.map((c) => ({
          id: c.id,
          title: c.title,
          status: c.status,
          priority: c.priority,
          dueDate: c.dueDate?.toISOString() ?? null,
          complianceType: c.complianceType,
        })),
      },
    });
  } catch (error) {
    console.error("Department detail API error:", error);
    return NextResponse.json({ error: "Failed to fetch department" }, { status: 500 });
  }
}