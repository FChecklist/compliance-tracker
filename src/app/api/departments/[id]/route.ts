import { db, departments } from "@/lib/db";
import { NextResponse } from "next/server";
import { eq, asc } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { response } = await requireAuth()
  if (response) return response
  try {
    const { id } = await params

    const department = await db.query.departments.findFirst({
      where: eq(departments.id, id),
      with: {
        complianceItems: {
          orderBy: (ci, { asc }) => asc(ci.dueDate),
        },
        users: { columns: { id: true, name: true, role: true } },
      },
    })

    if (!department) {
      return NextResponse.json({ error: "Department not found" }, { status: 404 })
    }

    const statusCounts = { pending: 0, in_progress: 0, completed: 0, overdue: 0, not_applicable: 0 }
    for (const item of department.complianceItems) {
      const s = item.status as keyof typeof statusCounts
      if (s in statusCounts) statusCounts[s]++
    }

    return NextResponse.json({
      department: {
        id: department.id,
        name: department.name,
        description: department.description,
        complianceCount: department.complianceItems.length,
        statusCounts,
        users: department.users,
        complianceItems: department.complianceItems.map((c) => ({
          id: c.id,
          title: c.title,
          status: c.status,
          priority: c.priority,
          dueDate: c.dueDate?.toISOString() ?? null,
          complianceType: c.complianceType,
        })),
      },
    })
  } catch (error) {
    console.error("Department detail API error:", error)
    return NextResponse.json({ error: "Failed to fetch department" }, { status: 500 })
  }
}
