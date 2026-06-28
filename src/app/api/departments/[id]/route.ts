import { db } from '@/lib/db'
import { departments, complianceItems } from '@/lib/db/schema'
import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const { id } = await ctx.params
    const dept = await db.query.departments.findFirst({
      where: (f, { eq }) => eq(f.id, id),
      with: {
        head: { columns: { name: true, email: true } },
        users: { columns: { id: true, name: true, role: true } },
        compliance: {
          columns: { id: true, title: true, status: true, priority: true, dueDate: true },
          orderBy: (f, { asc }) => asc(f.dueDate),
        },
      },
    })

    if (!dept) return NextResponse.json({ error: 'Department not found' }, { status: 404 })

    return NextResponse.json({
      department: {
        id: dept.id,
        name: dept.name,
        description: dept.description,
        head: dept.head ? { name: dept.head.name, email: dept.head.email } : null,
        memberCount: dept.users.length,
        members: dept.users,
        complianceCount: dept.compliance.length,
        completedCount: dept.compliance.filter(c => c.status === 'completed').length,
        compliance: dept.compliance.map(c => ({
          id: c.id, title: c.title, status: c.status, priority: c.priority,
          dueDate: c.dueDate?.toISOString(),
        })),
        createdAt: dept.createdAt.toISOString(),
        updatedAt: dept.updatedAt.toISOString(),
      },
    })
  } catch (error) {
    console.error('Department detail API error:', error)
    return NextResponse.json({ error: 'Failed to fetch department' }, { status: 500 })
  }
}