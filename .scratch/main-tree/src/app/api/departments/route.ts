import { departments, organisations } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { NextRequest, NextResponse } from "next/server";
import { eq, asc } from "drizzle-orm";
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard";
import { logActivity } from "@/lib/audit";
import { createId } from "@paralleldrive/cuid2";

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ departments: [] })

  try {
    const depts = await withTenantContext({ orgId }, (db) =>
      db.query.departments.findMany({
        with: {
          head: { columns: { name: true } },
          complianceItems: { columns: { id: true, status: true } },
          users: { columns: { id: true } },
        },
        orderBy: asc(departments.name),
      })
    )

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

export async function POST(request: NextRequest) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, 'manager')
  if (roleErr) return roleErr
  if (!orgId) return NextResponse.json({ error: 'No organisation on this account' }, { status: 400 })

  try {
    const { name, description } = await request.json()
    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    const newDept = await withTenantContext({ orgId, userId: dbUser?.id }, async (db) => {
      const org = await db.query.organisations.findFirst({ where: eq(organisations.id, orgId) })
      if (!org) return null

      const inserted = await db.insert(departments).values({
        id: createId(),
        name: name.trim(),
        description: description?.trim() || null,
        orgId: org.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning()

      // dbUser is guaranteed non-null here -- requireRole() above already
      // returned a 403 if it were null, so no "first admin" fallback needed.
      await logActivity({
        tx: db,
        action: 'create',
        entityType: 'Department',
        entityId: inserted[0].id,
        details: `Created department: ${inserted[0].name}`,
        orgId,
        dbUser: dbUser!,
        request,
      })

      return inserted[0]
    })

    if (!newDept) return NextResponse.json({ error: 'No organisation found' }, { status: 500 })
    return NextResponse.json(newDept)
  } catch (error) {
    console.error('Department POST error:', error)
    return NextResponse.json({ error: 'Failed to create department' }, { status: 500 })
  }
}
