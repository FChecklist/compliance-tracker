import { db, departments, complianceItems, users } from "@/lib/db";
import { NextResponse } from "next/server";
import { eq, asc, sql } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";

export async function GET() {
  const { response } = await requireAuth()
  if (response) return response
  try {
    const depts = await db.query.departments.findMany({
      with: {
        head: { columns: { name: true } },
        complianceItems: { columns: { id: true, status: true } },
        users: { columns: { id: true } },
      },
      orderBy: asc(departments.name),
    })

    return NextResponse.json({
      departments: depts.map((dept) => ({
        id: dept.id,
        name: dept.name,
        description: dept.description,
        complianceCount: dept.complianceItems.length,
        memberCount: dept.users.length,
        headName: dept.head?.name ?? null,
        completedCount: dept.complianceItems.filter(i => i.status === 'completed').length,
        createdAt: dept.createdAt.toISOString(),
        updatedAt: dept.updatedAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error("Departments API error:", error)
    return NextResponse.json({ error: "Failed to fetch departments" }, { status: 500 })
  }
}
