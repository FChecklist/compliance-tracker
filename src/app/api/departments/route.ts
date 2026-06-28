import { db } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const departments = await db.department.findMany({
      include: {
        _count: {
          select: {
            compliance: true,
          },
        },
      },
      orderBy: {
        name: "asc",
      },
    });

    return NextResponse.json({
      departments: departments.map((dept) => ({
        id: dept.id,
        name: dept.name,
        description: dept.description,
        complianceCount: dept._count.compliance,
        createdAt: dept.createdAt.toISOString(),
        updatedAt: dept.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Departments API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch departments" },
      { status: 500 }
    );
  }
}