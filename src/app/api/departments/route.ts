import { db } from '@/lib/db'
import { departments, complianceItems, users } from '@/lib/db/schema'
import { NextResponse } from 'next/server'
import { eq, sql } from 'drizzle-orm'

export async function GET() {
  try {
    const depts = await db.query.departments.findMany({
      with: {
        head: { columns: { name: true } },
        users: { columns: { id: true } },
        compliance: { columns: { id: true, status: true } },
      },
      orderBy: (f, { asc }) => asc(f.name),
    })

    return NextResponse.json({
      departments: depts.map(dept => ({
        id: dept.id,
        name: dept.name,
        description: dept.description,
        complianceCount: dept.compliance.length,
        memberCount: dept.users.length,
        headName: dept.head?.name ?? null,
        completedCount: dept.compliance.filter(c => c.status === 'completed').length,
        createdAt: dept.createdAt.toISOString(),
        updatedAt: dept.updatedAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error('Departments API error:', error)
    return NextResponse.json({ error: 'Failed to fetch departments' }, { status: 500 })
  }
}