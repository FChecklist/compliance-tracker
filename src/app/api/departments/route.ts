import { db, departments, organisations, users, auditLogs } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { eq, asc } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { createId } from "@paralleldrive/cuid2";

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  try {
    const depts = await db.query.departments.findMany({
      with: {
        head: { columns: { name: true } },
        complianceItems: { columns: { id: true, status: true } },
        users: { columns: { id: true } },
      },
      orderBy: asc(departments.name),
      where: orgId ? eq(departments.orgId, orgId) : undefined,
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

export async function POST(request: NextRequest) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  try {
    const { name, description } = await request.json()
    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }
    const org = orgId
      ? await db.query.organisations.findFirst({ where: eq(organisations.id, orgId) })
      : await db.query.organisations.findFirst()
    if (!org) return NextResponse.json({ error: 'No organisation found' }, { status: 500 })

    const newDept = await db.insert(departments).values({
      id: createId(),
      name: name.trim(),
      description: description?.trim() || null,
      orgId: org.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning()

    const actor = dbUser ?? await db.query.users.findFirst({ where: eq(users.role, 'admin') })
    if (actor) {
      await db.insert(auditLogs).values({
        id: createId(),
        action: 'create',
        entityType: 'Department',
        entityId: newDept[0].id,
        userId: actor.id,
        details: `Created department: ${newDept[0].name}`,
        createdAt: new Date(),
      })
    }

    return NextResponse.json(newDept[0])
  } catch (error) {
    console.error('Department POST error:', error)
    return NextResponse.json({ error: 'Failed to create department' }, { status: 500 })
  }
}
